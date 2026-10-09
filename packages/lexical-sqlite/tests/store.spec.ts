/** End-to-end backend test: real node:sqlite (in-memory) exercises DDL, FTS5, and edges. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { FLYWHEEL_SCHEMA_VERSION, ftsMatch, openSqliteFlywheelStore } from '../src/index.ts'
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

  it('recalls a CJK card from a verbatim Chinese sentence', async () => {
    const store = await openSqliteFlywheelStore(':memory:')
    try {
      await store.upsertNode(node({
        id: 'c1', type: 'claim', project_id: 'p',
        title: '会话图一直没有数据', body: '排查会话图无数据的根因',
      }))
      const hits = await store.search('这个项目的会话图一直没有数据排查下是哪里出的问题', { projectId: 'p', k: 5 })
      expect(hits.map(hit => hit.id)).toEqual(['c1'])
    } finally {
      await store.close()
    }
  })

  it('quotes query terms so punctuation cannot break the MATCH expression', async () => {
    const store = await openSqliteFlywheelStore(':memory:')
    try {
      await store.upsertNode(node({ id: 'a1', type: 'artifact', project_id: 'p', title: 'session-graph-no-data.md' }))
      const hits = await store.search('session-graph-no-data', { projectId: 'p', k: 5 })
      expect(hits.map(hit => hit.id)).toEqual(['a1'])
      expect(ftsMatch('budget - deck')).toBe('"budget" OR "deck"')
    } finally {
      await store.close()
    }
  })

  it('recalls short queries through the LIKE fallback', async () => {
    const store = await openSqliteFlywheelStore(':memory:')
    try {
      await store.upsertNode(node({ id: 'c1', type: 'claim', project_id: 'p', title: '预算表' }))
      expect((await store.search('预算', { projectId: 'p', k: 5 })).map(hit => hit.id)).toEqual(['c1'])
    } finally {
      await store.close()
    }
  })

  it('lists active file nodes that still lack a digest', async () => {
    const store = await openSqliteFlywheelStore(':memory:')
    try {
      await store.upsertNode(node({ id: 'a1', type: 'artifact', project_id: 'p', path: 'docs/a.md' }))
      await store.upsertNode(node({ id: 'b1', type: 'artifact', project_id: 'p', path: 'docs/b.md', summary: '有正文' }))
      await store.upsertNode(node({ id: 's1', type: 'session', project_id: 'p' }))
      await store.upsertNode(node({ id: 'a2', type: 'artifact', project_id: 'q', path: 'docs/c.md' }))
      expect((await store.fileNodesNeedingDigest('p', 10)).map(entry => entry.id)).toEqual(['a1'])
      expect((await store.fileNodesNeedingDigest('p', 10))[0]?.path).toBe('docs/a.md')
    } finally {
      await store.close()
    }
  })

  it('rebuilds a v1 database onto the trigram index', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flywheel-v1-'))
    const path = join(dir, 'index.sqlite')
    try {
      makeV1Database(path)
      const store = await openSqliteFlywheelStore(path)
      try {
        expect(store.path).toBe(path)
        const hits = await store.search('这个项目的会话图一直没有数据排查下是哪里出的问题', { projectId: 'p', k: 5 })
        expect(hits.map(hit => hit.id)).toEqual(['c1'])
      } finally {
        await store.close()
      }
      expect(FLYWHEEL_SCHEMA_VERSION).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/** Build a schema-v1 database (unicode61 FTS) so the migration path is exercised. */
function makeV1Database(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      INSERT INTO meta (k, v) VALUES ('schema_version', '1');
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('project','session','artifact','claim','change')),
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        path TEXT, mime TEXT, hash TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','stale')),
        session_id TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE nodes_fts USING fts5(
        title, summary, body, path, content='nodes', content_rowid='rowid'
      );
      CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, title, summary, body, path) VALUES (new.rowid, new.title, new.summary, new.body, new.path);
      END;
      INSERT INTO nodes (id, type, project_id, title, summary, body, updated_at)
        VALUES ('c1', 'claim', 'p', '会话图一直没有数据', '', '排查会话图无数据', 1);
    `)
  } finally {
    db.close()
  }
}
