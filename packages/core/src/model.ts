/** Node kinds in the project flywheel. Domains (java, office, media) are extractors writing into this same table, never separate graphs. */
export type NodeType = 'project' | 'session' | 'artifact' | 'claim' | 'change'

/** Node lifecycle states. `superseded` keeps history searchable by tools while excluding the node from injection; `stale` marks content that changed on disk. */
export type NodeStatus = 'active' | 'superseded' | 'stale'

/** Allowed extra metadata keys on a node (`extra_json`). Unknown keys are ignored on ingest. */
export interface NodeExtra {
  /** Claim purpose sentence (≤80 chars after a flash extract). */
  purpose?: string
  /** Claim kind: `ppt | pdf | sheet | doc | image | video | code | other`. */
  kind?: string
  /** Source hash when this node mirrors a file (artifact `hash` column is the primary copy). */
  source_hash?: string
  /** The user utterance that produced this claim. */
  utterance?: string
  /** Extractor id that wrote this node (`generic`, `java-symbols`, …). */
  extractor?: string
}

/** One node row, byte-compatible with the sqlite `nodes` table. */
export interface NodeRecord {
  id: string
  type: NodeType
  project_id: string
  title: string
  summary: string
  body: string
  path?: string
  mime?: string
  hash?: string
  status: NodeStatus
  session_id?: string
  extra: NodeExtra
  updated_at: number
}

/** A hit returned by a lexical or vector search; carries enough for card rendering and graph hops. */
export interface NodeHit {
  node: NodeRecord
  /** Relevance score from the backend that produced the hit (unused by the renderer). */
  score: number
}

/** Edge relation kinds. The hop edge set is the fixed list minus IN_PROJECT (project linking is not a hop). */
export type Rel =
  | 'IN_PROJECT'
  | 'PRODUCED'
  | 'DESCRIBES'
  | 'CITES'
  | 'CONTINUES'
  | 'SUPERSEDES'
  | 'PART_OF'

/** One edge row, byte-compatible with the sqlite `edges` table. */
export interface EdgeRecord {
  id: string
  src: string
  rel: Rel
  dst: string
  /** Optional short trace of when the edge was written (e.g. `turn 3`). */
  turn_hint?: string
  created_at: number
}

/** Serialized form of an {@link EdgeRecord} plus its concrete source/destination node ids. */
export interface NewEdge {
  src: string
  rel: Rel
  dst: string
  turn_hint?: string
}

/** Card projection of one node. Other-session nodes expose only title + summary. */
export interface NodeCard {
  id: string
  type: NodeType
  title: string
  summary: string
  path?: string
  /** Marks a node that lives in another session (never includes its body). */
  foreignSession: boolean
}

/** One retrieve run over a real user utterance. */
export interface RetrieveRequest {
  projectId: string
  sessionId: string
  /** The real user sentence, verbatim; never an LLM rewrite. */
  query: string
}

/** Outcome of one {@link retrieve}. */
export interface RetrieveResult {
  /** Cards to inject, already bounded and rendered; empty when unchanged. */
  cards: NodeCard[]
  /** Rendered card text (≤ maxChars UTF-16 code units), or '' when unchanged. */
  text: string
  /** sha256(sorted node ids + query + lexical backend id); the inject side compares it with the last injected digest to decide `unchanged`. */
  digest: string
}

/** Server-facing config knobs (values validated; see CONFIG_SPEC in schema.ts). */
export interface FlywheelConfig {
  enabled: boolean
  inject: boolean
  tools: boolean
  /** Path of the sqlite file, relative to the project root. */
  dbRelativePath: string
  ftsK: number
  /** v1 schema locks hop to 1. */
  hop: 1
  hopExtra: number
  maxChars: number
  lexicalBackend: string
  elasticsearch: {
    node: string
    indexPrefix: string
    /** Secret; never stored/read back through settings responses. */
    apiKey: string
  }
  vectorBackend: 'off' | 'cloud'
  vector: {
    provider: string
    model: string
    vectorK: number
    embedQuery: boolean
  }
  claimFlash: boolean
  summarizationModel: string
  extractors: string[]
  mediaCaption: boolean
  windowCompact: boolean
  windowPendingPattern: string
  supersedePattern: string
}
