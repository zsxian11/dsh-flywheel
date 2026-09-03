/** Core retrieval tests. A fake in-memory LexicalIndex + GraphStore replaces sqlite and
 * retrieve() must stay green (design P1 acceptance: "zero network; swap sqlite for a fake and it still passes"). */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { retrieve } from '../src/retrieve.ts'
import type { EdgeRecord, NodeRecord, Rel } from '../src/model.ts'
import type { GraphStore, LexicalIndex } from '../src/seams.ts'

/** In-memory backend that serves nodes and edges keyed by id. */
class FakeBackend implements LexicalIndex, GraphStore {
  readonly id = 'sqlite-fts'
  nodeRows = new Map<string, NodeRecord>()
  edges = new Map<string, EdgeRecord>()

  async search(query: string, opts: { projectId: string; k: number }): Promise<Array<{ id: string; score: number }>> {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    const hits: Array<{ id: string; score: number }> = []
    for (const node of this.nodeRows.values()) {
      if (node.status !== 'active' || node.project_id !== opts.projectId) continue
      const hay = `${node.title} ${node.summary} ${node.body}`.toLowerCase()
      const score = tokens.reduce((sum, t) => sum + (hay.includes(t) ? 1 : 0), 0)
      if (score > 0) hits.push({ id: node.id, score })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.k)
  }

  async upsert(node: NodeRecord): Promise<void> { this.nodeRows.set(node.id, node) }
  async remove(id: string): Promise<void> { this.nodeRows.delete(id) }

  async neighbors(ids: readonly string[], rels: readonly Rel[], extraLimit: number): Promise<NodeRecord[]> {
    const result: NodeRecord[] = []
    const seen = new Set<string>()
    for (const edge of this.edges.values()) {
      if (!ids.includes(edge.src) || !(rels as string[]).includes(edge.rel)) continue
      const dst = this.nodeRows.get(edge.dst)
      if (dst === undefined || seen.has(dst.id)) continue
      seen.add(dst.id)
      result.push(dst)
      if (result.length >= extraLimit) break
    }
    return result
  }

  async nodes(ids: readonly string[]): Promise<Map<string, NodeRecord>> {
    return new Map(ids.map(id => [id, this.nodeRows.get(id)]).filter((x): x is [string, NodeRecord] => x[1] !== undefined))
  }

  async upsertNode(node: NodeRecord): Promise<void> { this.nodeRows.set(node.id, node) }
  async upsertEdge(edge: EdgeRecord): Promise<void> { this.edges.set(edge.id, edge) }
  async supersede(nodeIds: readonly string[]): Promise<void> {
    for (const id of nodeIds) {
      const node = this.nodeRows.get(id)
      if (node !== undefined) this.nodeRows.set(id, { ...node, status: 'superseded' })
    }
  }
  async edgesFrom(srcIds: readonly string[]): Promise<EdgeRecord[]> {
    return [...this.edges.values()].filter(edge => srcIds.includes(edge.src))
  }
  async getNode(id: string): Promise<NodeRecord | undefined> { return this.nodeRows.get(id) }
  async recentActiveSessionNodes(): Promise<string[]> { return [] }
  async close(): Promise<void> {}
}

function node(partial: Partial<NodeRecord> & { id: string; type: NodeRecord['type']; project_id: string }): NodeRecord {
  return {
    title: partial.id, summary: '', body: '', status: 'active',
    extra: {}, updated_at: 0, ...partial,
  } as NodeRecord
}

const cfg = {
  ...DEFAULT_CONFIG,
  ftsK: 8, hop: 1 as const, hopExtra: 5, maxChars: 3000,
  vector: DEFAULT_CONFIG.vector, lexicalBackend: 'sqlite-fts',
}

describe('retrieve orchestration', () => {
  it('recalls only active nodes of the current project', async () => {
    const backend = new FakeBackend()
    await backend.upsert(node({ id: 'a', type: 'claim', project_id: 'p', title: 'budget ppt', summary: 'budget deck' }))
    await backend.upsert(node({ id: 'b', type: 'claim', project_id: 'p', title: 'budget ppt', summary: 'x', status: 'superseded' }))
    await backend.upsert(node({ id: 'c', type: 'claim', project_id: 'other', title: 'budget ppt', summary: 'other project' }))

    const result = await retrieve({ graph: backend, lexical: backend }, cfg, { projectId: 'p', sessionId: 's', query: 'budget' })
    expect(result.cards.map(card => card.id)).toEqual(['a'])
  })

  it('one-hop expansion bounded by hopExtra and active-only', async () => {
    const backend = new FakeBackend()
    await backend.upsert(node({ id: 'a', type: 'claim', project_id: 'p', title: 'Q3 budget' }))
    await backend.upsert(node({ id: 'art', type: 'artifact', project_id: 'p', title: 'budget.xlsx' }))
    await backend.upsertEdge({ id: 'e1', src: 'a', rel: 'DESCRIBES', dst: 'art', created_at: 1 })
    const result = await retrieve({ graph: backend, lexical: backend }, cfg, { projectId: 'p', sessionId: 's', query: 'Q3 budget' })
    expect(result.cards.map(card => card.id).sort()).toEqual(['a', 'art'])
  })

  it('drops a SUPERSEDES dst that is still active', async () => {
    const backend = new FakeBackend()
    await backend.upsert(node({ id: 'old', type: 'claim', project_id: 'p', title: 'old claim' }))
    await backend.upsert(node({ id: 'new', type: 'claim', project_id: 'p', title: 'new claim' }))
    await backend.upsertEdge({ id: 'e1', src: 'new', rel: 'SUPERSEDES', dst: 'old', created_at: 1 })
    const result = await retrieve({ graph: backend, lexical: backend }, cfg, { projectId: 'p', sessionId: 's', query: 'claim' })
    expect(result.cards.map(card => card.id)).toEqual(['new'])
  })

  it('digest is stable for equal runs and differs when the query differs', async () => {
    const backend = new FakeBackend()
    await backend.upsert(node({ id: 'a', type: 'claim', project_id: 'p', title: 'same card' }))
    const r1 = await retrieve({ graph: backend, lexical: backend }, cfg, { projectId: 'p', sessionId: 's', query: 'card' })
    const r2 = await retrieve({ graph: backend, lexical: backend }, cfg, { projectId: 'p', sessionId: 's', query: 'card' })
    const r3 = await retrieve({ graph: backend, lexical: backend }, cfg, { projectId: 'p', sessionId: 's', query: 'other' })
    expect(r1.digest).toBe(r2.digest)
    expect(r1.digest).not.toBe(r3.digest)
  })

  it('foreign-session nodes truncate to title + summary only', async () => {
    const backend = new FakeBackend()
    await backend.upsert(node({
      id: 'f', type: 'claim', project_id: 'p', session_id: 'other',
      title: 'far', summary: 'long'.repeat(300), body: 'SECRET-BODY-SHOULD-NOT-RENDER',
    }))
    const result = await retrieve({ graph: backend, lexical: backend }, cfg, { projectId: 'p', sessionId: 's', query: 'far' })
    expect(result.text).not.toContain('SECRET-BODY-SHOULD-NOT-RENDER')
    expect(result.cards[0]?.foreignSession).toBe(true)
  })
})
