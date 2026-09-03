/** @dsh-flywheel/lexical-sqlite — v1 backend: SQLite FTS5 lexical index + edges GraphStore
 * over `.dsh/flywheel/index.sqlite` (WAL). Uses `node:sqlite` (no native dependency).
 * This package implements both `LexicalIndex` and `GraphStore` against one database. */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  GraphStore, LexicalIndex, NodeRecord, ProviderRegistry, Rel,
} from '@dsh-flywheel/core'

/** On-disk schema version stamped into `meta.schema_version` (design §4.1: 1). */
export const FLYWHEEL_SCHEMA_VERSION = 1

/** Single backend that serves lexical recall and graph hops from one sqlite file. */
export interface SqliteFlywheelStore extends LexicalIndex, GraphStore {
  /** The absolute database path this store opened. */
  readonly path: string
}

/** Open (or create) the flywheel database and apply the schema. `:memory:` for tests. */
export async function openFlywheelDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    applySchema(db, actual)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Idempotent schema application. Schema version mismatch fails loud (no in-place migration). */
function applySchema(db: DatabaseSync, path: string): void {
  // The meta table is created before the version read so the check runs on
  // first open too; a mismatched existing database is rejected before the rest.
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  const row = db.prepare("SELECT v AS schema_version FROM meta WHERE k = 'schema_version'").get() as { schema_version: number } | undefined
  const onDisk = row?.schema_version
  const current = onDisk ?? 0
  if (current !== 0 && current !== FLYWHEEL_SCHEMA_VERSION) {
    throw new Error(`flywheel database at "${path}" has schema version ${current}, incompatible with this build (${FLYWHEEL_SCHEMA_VERSION})`)
  }
  db.exec(SCHEMA_SQL)
  if (current === 0) {
    db.prepare("INSERT INTO meta (k, v) VALUES ('schema_version', ?)").run(String(FLYWHEEL_SCHEMA_VERSION))
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('project','session','artifact','claim','change')),
  project_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  path TEXT,
  mime TEXT,
  hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','stale')),
  session_id TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_project_type ON nodes(project_id, type);
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(project_id, path);
CREATE INDEX IF NOT EXISTS idx_nodes_session ON nodes(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  title, summary, body, path,
  content='nodes',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, title, summary, body, path) VALUES (new.rowid, new.title, new.summary, new.body, new.path);
END;
CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, summary, body, path) VALUES ('delete', old.rowid, old.title, old.summary, old.body, old.path);
END;
CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, summary, body, path) VALUES ('delete', old.rowid, old.title, old.summary, old.body, old.path);
  INSERT INTO nodes_fts(rowid, title, summary, body, path) VALUES (new.rowid, new.title, new.summary, new.body, new.path);
END;

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  src TEXT NOT NULL,
  rel TEXT NOT NULL CHECK (rel IN (
    'IN_PROJECT','PRODUCED','DESCRIBES','CITES','CONTINUES','SUPERSEDES','PART_OF'
  )),
  dst TEXT NOT NULL,
  turn_hint TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_src_rel ON edges(src, rel);
CREATE INDEX IF NOT EXISTS idx_edges_dst_rel ON edges(dst, rel);
`

function rowToNode(row: Record<string, unknown>): NodeRecord {
  return {
    id: row.id as string,
    type: row.type as NodeRecord['type'],
    project_id: row.project_id as string,
    title: row.title as string,
    summary: row.summary as string,
    body: row.body as string,
    path: row.path as string | undefined,
    mime: row.mime as string | undefined,
    hash: row.hash as string | undefined,
    status: row.status as NodeRecord['status'],
    session_id: row.session_id as string | undefined,
    extra: JSON.parse((row.extra_json as string) || '{}') as NodeRecord['extra'],
    updated_at: row.updated_at as number,
  }
}

/** Build the concrete store from an already-open database. */
export function createSqliteFlywheelStore(db: DatabaseSync, path: string): SqliteFlywheelStore {
  const upsertNodeStmt = db.prepare(`
    INSERT INTO nodes (id, type, project_id, title, summary, body, path, mime, hash, status, session_id, extra_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type, project_id=excluded.project_id, title=excluded.title,
      summary=excluded.summary, body=excluded.body, path=excluded.path, mime=excluded.mime,
      hash=excluded.hash, status=excluded.status, session_id=excluded.session_id,
      extra_json=excluded.extra_json, updated_at=excluded.updated_at
  `)

  return {
    path,
    id: 'sqlite-fts',

    async search(query, opts) {
      const match = query.trim()
      if (match === '') return []
      const rows = db.prepare(`
        SELECT n.id AS id
        FROM nodes_fts f
        JOIN nodes n ON n.rowid = f.rowid
        WHERE nodes_fts MATCH ? AND n.status = 'active' AND n.project_id = ?
        ORDER BY rank
        LIMIT ?
      `).all(match, opts.projectId, opts.k) as Array<{ id: string }>
      return rows.map((row, index) => ({ id: row.id, score: -(index) }))
    },

    async upsert(node) {
      upsertNodeStmt.run(
        node.id, node.type, node.project_id, node.title, node.summary, node.body,
        node.path ?? null, node.mime ?? null, node.hash ?? null, node.status,
        node.session_id ?? null, JSON.stringify(node.extra), node.updated_at,
      )
    },

    async remove(id) {
      db.prepare('DELETE FROM nodes WHERE id = ?').run(id)
    },

    async neighbors(ids, rels, extraLimit) {
      if (ids.length === 0) return []
      const placeholders = ids.map(() => '?').join(',')
      const relPlaceholders = rels.map(() => '?').join(',')
      const rows = db.prepare(`
        SELECT DISTINCT n.* FROM edges e
        JOIN nodes n ON n.id = e.dst
        WHERE e.src IN (${placeholders}) AND e.rel IN (${relPlaceholders})
        LIMIT ?
      `).all(...ids, ...rels, extraLimit) as Array<Record<string, unknown>>
      return rows.map(rowToNode)
    },

    async nodes(ids) {
      if (ids.length === 0) return new Map()
      const placeholders = ids.map(() => '?').join(',')
      const rows = db.prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`).all(...ids) as Array<Record<string, unknown>>
      return new Map(rows.map(row => [rowToNode(row).id, rowToNode(row)]))
    },

    async getNode(id) {
      const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row === undefined ? undefined : rowToNode(row)
    },

    async upsertNode(node) {
      await this.upsert(node)
    },

    async upsertEdge(edge) {
      db.prepare(`
        INSERT INTO edges (id, src, rel, dst, turn_hint, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET src=excluded.src, rel=excluded.rel, dst=excluded.dst, turn_hint=excluded.turn_hint, created_at=excluded.created_at
      `).run(edge.id, edge.src, edge.rel, edge.dst, edge.turn_hint ?? null, edge.created_at)
    },

    async supersede(nodeIds) {
      const stmt = db.prepare("UPDATE nodes SET status = 'superseded' WHERE id = ?")
      for (const id of nodeIds) stmt.run(id)
    },

    async edgesFrom(srcIds) {
      if (srcIds.length === 0) return []
      const placeholders = srcIds.map(() => '?').join(',')
      const rows = db.prepare(`SELECT * FROM edges WHERE src IN (${placeholders})`).all(...srcIds) as Array<Record<string, unknown>>
      return rows.map(row => ({
        id: row.id as string,
        src: row.src as string,
        rel: row.rel as Rel,
        dst: row.dst as string,
        turn_hint: row.turn_hint as string | undefined,
        created_at: row.created_at as number,
      }))
    },

    async recentActiveSessionNodes(sessionId, type, limit) {
      const rows = db.prepare(`
        SELECT id FROM nodes
        WHERE session_id = ? AND type = ? AND status = 'active'
        ORDER BY updated_at DESC LIMIT ?
      `).all(sessionId, type, limit) as Array<{ id: string }>
      return rows.map(row => row.id)
    },

    async close() {
      db.close()
    },
  }
}

/** One open: opens the db and returns a ready store bound to the given path. */
export async function openSqliteFlywheelStore(path: string): Promise<SqliteFlywheelStore> {
  const db = await openFlywheelDatabase(path)
  return createSqliteFlywheelStore(db, resolve(path))
}

/** Helper used by the dsh-bundle host plugin: mount this backend into a registry and return the disposer. */
export function registerSqliteFlywheel(registry: ProviderRegistry, store: SqliteFlywheelStore): () => void {
  const disposeLexical = registry.registerLexical(store)
  const disposeGraph = registry.registerGraph(store)
  return () => {
    disposeLexical()
    disposeGraph()
    void store.close()
  }
}
