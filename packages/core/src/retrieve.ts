/** Retrieval orchestration — the ONLY hot-path algorithm (§4.3). Zero LLM. */

import type { FlywheelConfig } from './model.ts'
import { retrievalDigest } from './ids.ts'
import type { NodeCard, NodeRecord, Rel, RetrieveRequest, RetrieveResult } from './model.ts'
import type { GraphStore, LexicalIndex, VectorIndex } from './seams.ts'

/** Edges used in the single retrieval hop. IN_PROJECT is excluded: membership is not a working-set hop. */
export const HOP_RELS: readonly Rel[] = [
  'PRODUCED', 'DESCRIBES', 'CITES', 'SUPERSEDES', 'CONTINUES', 'PART_OF',
]

/** Summary budget for a foreign-session card (title + summary only, ≤200 chars each). */
export const FOREIGN_SESSION_TEXT_BUDGET = 200

export interface RetrieveDeps {
  graph: GraphStore
  lexical: LexicalIndex
  /** Undefined until a vector backend mounts (P7). */
  vector?: VectorIndex
}

export type RetrieveConfig = Pick<
  FlywheelConfig, 'ftsK' | 'vector' | 'hop' | 'hopExtra' | 'maxChars' | 'lexicalBackend'
>

/**
 * Run one retrieval: lexical recall (mandatory) → optional vector RRF → one-hop
 * expansion → supersede pruning → card rendering under maxChars → digest.
 * `retrieve` never talks to a chat model and never rewrites the query.
 * @returns the card set plus a stable digest; the caller decides `changed`
 * by comparing with the digest it last injected.
 */
export async function retrieve(
  deps: RetrieveDeps,
  config: RetrieveConfig,
  req: RetrieveRequest,
): Promise<RetrieveResult> {
  const fused = await fuseRecall(deps, config, req)
  const hitIds = fused.map(hit => hit.id)

  // One-hop expansion (schema locks hop to 1): neighbors of the recall hits.
  const hopNodes = await deps.graph.neighbors(hitIds, HOP_RELS, config.hopExtra)

  const presentNodes = await deps.graph.nodes(hitIds)
  const candidates = new Map<string, NodeRecord>()
  for (const hit of fused) {
    const node = presentNodes.get(hit.id)
    if (node === undefined || node.status !== 'active') continue
    candidates.set(hit.id, node)
  }
  for (const node of hopNodes) {
    if (node.status === 'active' && !candidates.has(node.id)) candidates.set(node.id, node)
  }

  // Step 5 (§4.3): a SUPERSEDES dst still active must be dropped (superseded work never re-enters the set).
  const edges = await deps.graph.edgesFrom([...candidates.keys()])
  const supersededDst = new Set(edges.filter(edge => edge.rel === 'SUPERSEDES').map(edge => edge.dst))
  const cards: NodeCard[] = []
  for (const node of candidates.values()) {
    if (supersededDst.has(node.id)) continue
    const foreignSession = node.session_id !== undefined && node.session_id !== req.sessionId
    const card: NodeCard = {
      id: node.id,
      type: node.type,
      title: node.title,
      summary: foreignSession ? node.summary.slice(0, FOREIGN_SESSION_TEXT_BUDGET) : node.summary,
      foreignSession,
    }
    if (node.path !== undefined) card.path = node.path
    cards.push(card)
  }

  cards.sort((a, b) => a.title.localeCompare(b.title))
  const text = renderCards(cards, config.maxChars)
  const digest = retrievalDigest(cards.map(card => card.id).sort(), req.query, config.lexicalBackend)
  return { cards, text, digest }
}

/**
 * Recall stage: mandatory lexical top-`ftsK`, then — only when a vector backend
 * is mounted AND `embedQuery` is on — vector top-`vectorK` fused by RRF and
 * truncated back to `ftsK`. Purely lexical when `vectorBackend === 'off'`.
 */
async function fuseRecall(deps: RetrieveDeps, config: RetrieveConfig, req: RetrieveRequest) {
  const lexicalHits = await deps.lexical.search(req.query, { projectId: req.projectId, k: config.ftsK })
  const vector = config.vector
  if (vector === undefined || vector.embedQuery === false || deps.vector === undefined) return lexicalHits
  const vectorHits = await deps.vector.search(req.query, { projectId: req.projectId, k: vector.vectorK })
  return rrfFuse(lexicalHits, vectorHits, config.ftsK)
}

/** Reciprocal-rank fusion of two id-ranked lists, truncated to `limit`. */
export function rrfFuse<T extends { id: string }>(
  a: readonly T[],
  b: readonly T[],
  limit: number,
): T[] {
  const score = new Map<string, number>()
  const byId = new Map<string, T>()
  const accumulate = (list: readonly T[]) => {
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i] as T
      byId.set(item.id, item)
      score.set(item.id, (score.get(item.id) ?? 0) + 1 / (60 + i))
    }
  }
  accumulate(a)
  accumulate(b)
  return [...score.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id) as T)
}

/** Card text budget in UTF-16 code units (chosen and fixed here; see design §4.3 step 7). */
export const CARD_TEXT_ENCODING: 'utf16' = 'utf16'

/** Render cards as one compact block, hard-truncated to maxChars UTF-16 units. */
export function renderCards(cards: readonly NodeCard[], maxChars: number): string {
  let text = ''
  for (const card of cards) {
    const line = `- [${card.type}] ${card.title}${card.path ? ` (${card.path})` : ''}${card.summary ? ` — ${card.summary}` : ''}`
    if (text.length + line.length + 1 > maxChars) break
    text += text.length === 0 ? line : `\n${line}`
  }
  return text
}
