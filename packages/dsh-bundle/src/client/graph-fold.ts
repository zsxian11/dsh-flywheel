/** Fold session-log facts into the session-graph snapshot. Pure: no Cordis. */

import { fileRolesOf, pathFromToolArgs } from '../paths.ts'

/** One working-set card as shown on the graph tab. */
export interface GraphCard {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly summary: string
  readonly path?: string
}

/** One path cited by a tool call. */
export interface GraphFile {
  readonly path: string
  readonly tool: string
  readonly role: 'produced' | 'opened'
}

/** Latest working set plus unique file citations for this session. */
export interface GraphSnapshot {
  readonly workingSet: readonly GraphCard[]
  readonly produced: readonly GraphFile[]
  readonly opened: readonly GraphFile[]
}

export const EMPTY_GRAPH_SNAPSHOT: GraphSnapshot = {
  workingSet: [],
  produced: [],
  opened: [],
}

export const FLYWHEEL_INJECT_PLUGIN = 'flywheel-inject'

/** One independently assembled graph fact. */
export type GraphFact =
  | { readonly kind: 'working-set'; readonly cards: readonly GraphCard[] }
  | { readonly kind: 'file'; readonly path: string; readonly tool: string; readonly roles: readonly ('produced' | 'opened')[] }

/** Minimal event fields the fold reads. */
export interface GraphEvent {
  readonly type: string
  readonly seq?: number
  readonly data: unknown
}

/**
 * Extract one graph fact from a session event, or null when unrelated.
 * @param event - a session-log event (host or client history).
 */
export function factFromEvent(event: GraphEvent): GraphFact | null {
  if (event.type === 'user/message') return workingSetFact(event.data)
  if (event.type === 'tool/call') return fileFact(event.data)
  return null
}

/**
 * Fold facts in log order. Later working sets replace earlier ones; files accumulate by path+role.
 * @param facts - facts in ascending seq order.
 */
export function foldFacts(facts: readonly GraphFact[]): GraphSnapshot {
  let workingSet: readonly GraphCard[] = []
  const produced = new Map<string, GraphFile>()
  const opened = new Map<string, GraphFile>()
  for (const fact of facts) {
    if (fact.kind === 'working-set') {
      workingSet = fact.cards
      continue
    }
    for (const role of fact.roles) {
      const file: GraphFile = { path: fact.path, tool: fact.tool, role }
      if (role === 'produced') produced.set(fact.path, file)
      else opened.set(fact.path, file)
    }
  }
  return {
    workingSet,
    produced: [...produced.values()],
    opened: [...opened.values()],
  }
}

function workingSetFact(data: unknown): GraphFact | null {
  if (typeof data !== 'object' || data === null) return null
  const source = (data as { source?: unknown }).source
  if (typeof source !== 'object' || source === null) return null
  const record = source as { kind?: unknown; plugin?: unknown; cards?: unknown }
  if (record.kind !== 'plugin' || record.plugin !== FLYWHEEL_INJECT_PLUGIN) return null
  if (Array.isArray(record.cards)) {
    const cards = record.cards.flatMap(cardFromUnknown)
    return { kind: 'working-set', cards }
  }
  const content = (data as { content?: unknown }).content
  return { kind: 'working-set', cards: parseCardsFromContent(content) }
}

function fileFact(data: unknown): GraphFact | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as { name?: unknown; arguments?: unknown }
  if (typeof record.name !== 'string') return null
  const roles = fileRolesOf(record.name)
  if (roles.length === 0) return null
  const path = pathFromToolArgs(record.arguments)
  if (path === undefined) return null
  return { kind: 'file', path, tool: record.name, roles }
}

function cardFromUnknown(value: unknown): GraphCard[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.title !== 'string') return []
  const card: GraphCard = {
    id: record.id,
    type: typeof record.type === 'string' ? record.type : 'artifact',
    title: record.title,
    summary: typeof record.summary === 'string' ? record.summary : '',
  }
  if (typeof record.path === 'string' && record.path.length > 0) {
    return [{ ...card, path: record.path }]
  }
  return [card]
}

/** Parse `- [type] title (path) — summary` lines from injected working-set text. */
export function parseCardsFromContent(content: unknown): GraphCard[] {
  if (!Array.isArray(content)) return []
  const text = content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('\n')
  const cards: GraphCard[] = []
  for (const line of text.split('\n')) {
    const match = /^- \[([^\]]+)\] (.+?)(?: \(([^)]+)\))?(?: — (.*))?$/.exec(line.trim())
    if (match === null) continue
    const type = match[1] ?? 'artifact'
    const title = match[2] ?? ''
    const path = match[3]
    const summary = match[4] ?? ''
    const card: GraphCard = { id: path ?? title, type, title, summary }
    cards.push(path !== undefined ? { ...card, path } : card)
  }
  return cards
}
