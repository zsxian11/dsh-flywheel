/** Backend seams (design §6.7): LexicalIndex / VectorIndex / GraphStore interfaces and the
 * provider registry. Injection and tools depend only on `ctx.flywheel.retrieve`. */

import type { EdgeRecord, NodeRecord, Rel } from './model.ts'

/** Graph seam: edges plus node reads. sqlite edges table is the v1 default GraphStore. */
export interface GraphStore {
  /** One-hop active neighbors of the given node ids over the given relation set, bounded by extraLimit total. */
  neighbors(ids: readonly string[], rels: readonly Rel[], extraLimit: number): Promise<NodeRecord[]>
  /** Read nodes by id, returning present ones. */
  nodes(ids: readonly string[]): Promise<Map<string, NodeRecord>>
  /** Upsert a node (replace by stable id, bump updated_at). */
  upsertNode(node: NodeRecord): Promise<void>
  /** Insert an edge (replace by id). */
  upsertEdge(edge: EdgeRecord): Promise<void>
  /** Mark nodes superseded (status flips; row kept for tools). */
  supersede(nodeIds: readonly string[]): Promise<void>
  /** Edge rows whose src is one of the given ids. */
  edgesFrom(srcIds: readonly string[]): Promise<EdgeRecord[]>
  /** Nodes whose id is one of ids. */
  getNode(id: string): Promise<NodeRecord | undefined>
  /** Recent active claim/change node ids of a session, newest first. */
  recentActiveSessionNodes(sessionId: string, type: 'claim' | 'change', limit: number): Promise<string[]>
  /** Close the underlying store (called on provider disposal / process teardown). */
  close(): Promise<void>
}

/** LexicalIndex seam — v1 default `sqlite-fts` (FTS5 over the same sqlite file). */
export interface LexicalIndex {
  readonly id: string
  /** Free-text search over ACTIVE nodes of one project. `k` from config (never a constant). */
  search(query: string, opts: { projectId: string; k: number }): Promise<Array<{ id: string; score: number }>>
  /** Upsert searchable body text for one node. */
  upsert(node: NodeRecord): Promise<void>
  /** Mark searchable text gone (superseded nodes drop from recall). */
  remove(id: string): Promise<void>
}

/** VectorIndex seam — reserved for a cloud backend (P7). Not mounted in v1. */
export interface VectorIndex {
  readonly id: string
  /** Write-time embedding (or query-time when config.embedQuery is on). */
  upsert(id: string, text: string): Promise<void>
  search(query: string, opts: { projectId: string; k: number }): Promise<Array<{ id: string; score: number }>>
}

/** Registry used by provider plugins to mount backends into the flywheel store. */
export interface ProviderRegistry {
  /** Register a lexical backend under its id; returns a disposer. */
  registerLexical(index: LexicalIndex): () => void
  /** Register a vector backend under its id; returns a disposer. */
  registerVector(index: VectorIndex): () => void
  /** Register the graph store edges live in (v1: the sqlite edges table). */
  registerGraph(store: GraphStore): () => void
  lexical(id: string): LexicalIndex | undefined
  vector(id: string): VectorIndex | undefined
  graph(): GraphStore | undefined
  /** True when the id has a mounted backend of the requested kind. */
  hasLexical(id: string): boolean
  hasVector(id: string): boolean
}
