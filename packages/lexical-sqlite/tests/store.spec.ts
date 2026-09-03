/** End-to-end backend test: real node:sqlite (in-memory) exercises DDL, FTS5, and edges. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openSqliteFlywheelStore } from '../src/index.ts'
import { projectNodeId } from '@dsh-flywheel/core'
import type { NodeRecord } from '@dsh-flywheel/core'

function node(partial: Partial<NodeRecord> & { id: string; type: NodeRecord['type']; project_id: string }): NodeRecord {
  return {
    title: partial.id, summary: '', body: '', status: 'active',
    extra: {}, updated_at: Date.now(), ...partial,
  } as NodeRecord
}

describe('sqlite flywheel backend', () => {
  it('round-trips nodes and recalls via FTS5 on title/summary/body', async () => {
    const store = await openSqliteFlywheelStore(':memory:')
    try {
      await store.upsertNode(node({ id: projectNodeId('p'), type: 'project', project_id: 'p', title: 'project p' }))
      await store.upsertNode(node({ id: 'c1', type: 'claim', project_id: 'p', title: 'Q3 budget deck', summary: 'quarterly budget ppt' }))
      const hits = await store.search('budget', { projectId: 'p', k: 5 })
      expect(hits.map(hit => hit.id)).toEqual(['c1'])
    } finally {
      await store.close()
    }
  })

  it('filters superseded nodes out of recall but keeps them for reads', async () => {
    const store = await openSqliteFlywheelStore(':memory:')
    try {
      await store.upsertNode(node({ id: 'c1', type: 'claim', project_id: 'p', title: 'budget old' }))
      await store.supersede(['c1'])
      expect(await store.search('budget', { projectId: 'p', k: 5 })).toEqual([])
      expect((await store.getNode('c1'))?.status).toBe('superseded')
    } finally {
      await store.close()
    }
  })

  it('hops neighbors over edge relations', async () => {
    const store = await openSqliteFlywheelStore(':memory:')
    try {
      await store.upsertNode(node({ id: 'c1', type: 'claim', project_id: 'p', title: 'claim' }))
      await store.upsertNode(node({ id: 'a1', type: 'artifact', project_id: 'p', title: 'deck.pptx', path: 'deck.pptx' }))
      await store.upsertEdge({ id: 'e1', src: 'c1', rel: 'DESCRIBES', dst: 'a1', created_at: 1 })
      const neighbors = await store.neighbors(['c1'], ['DESCRIBES'], 5)
      expect(neighbors.map(n => n.id)).toEqual(['a1'])
    } finally {
      await store.close()
    }
  })

  it('reopens a file-backed database whose meta.v is the TEXT "1"', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flywheel-'))
    const path = join(dir, 'index.sqlite')
    try {
      const first = await openSqliteFlywheelStore(path)
      await first.close()
      const second = await openSqliteFlywheelStore(path)
      await second.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
