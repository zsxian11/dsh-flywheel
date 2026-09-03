/** Shared host-side flywheel service + registry. The `flywheel` service is what
 * `flywheel-inject`, `flywheel-index`, `flywheel-window`, and `tool-flywheel`
 * inject; providers mount backends into it. */

import type {
  FlywheelConfig, GraphStore, LexicalIndex, NewEdge,
  NodeRecord, ProviderRegistry, RetrieveRequest, RetrieveResult, VectorIndex,
} from '@dsh-flywheel/core'
import {
  DEFAULT_CONFIG, ExtractorRegistry, genericExtractor, retrieve as coreRetrieve,
} from '@dsh-flywheel/core'

/** The small service surface every consumer depends on (design §6.1). */
export interface FlywheelService extends ProviderRegistry {
  /** Current resolved config (re-read from the settings source each call; live). */
  config(): FlywheelConfig
  /** Run one retrieval over the mounted lexical + graph (+ optional vector). */
  retrieve(req: RetrieveRequest): Promise<RetrieveResult>
  /** Upsert a node and its outgoing edges. */
  ingest(node: NodeRecord, edges?: readonly NewEdge[]): Promise<void>
  /** Enqueue a background claim flash-extract (non-blocking; never awaited in pre-step). */
  queueClaimExtract(claimId: string, sessionId: string, projectId: string, utterance: string, paths: readonly string[]): void
  /** Extractor registry for domain enrichment. */
  extractors: ExtractorRegistry
}

/** Service-name consumers inject. Keep it namespaced: one small surface, not six memory tools. */
export const FLYWHEEL_SERVICE = 'flywheel'

/** Namespace key for the settings section + card pairing (never localized). */
export const FLYWHEEL_SETTINGS_NAMESPACE = 'flywheel'

declare module '@deepseek-ai/cordis' {
  interface Context {
    [FLYWHEEL_SERVICE]: FlywheelService
  }
}

/** A backend id that may be selected but has no mounted provider (fail-loud on save). */
export class BackendNotMountedError extends Error {
  constructor(kind: 'lexical' | 'vector', id: string) {
    super(`flywheel ${kind} backend "${id}" is not mounted`)
    this.name = 'BackendNotMountedError'
  }
}

interface BackendState {
  lexical: Map<string, LexicalIndex>
  vector: Map<string, VectorIndex>
  graph: GraphStore | undefined
}

export interface FlywheelServiceOptions {
  /** Live source of resolved config. */
  config: () => FlywheelConfig
  /** Run the flash extraction for one claim (background; falls back to rule excerpt on failure). */
  runClaimFlash?: (claimId: string, sessionId: string, projectId: string, utterance: string, paths: readonly string[]) => Promise<void>
}

/** Build the service. Registry disposers are captured in closures owned by the plugin fiber. */
export function createFlywheelService(options: FlywheelServiceOptions): FlywheelService {
  const state: BackendState = { lexical: new Map(), vector: new Map(), graph: undefined }
  const extractors = new ExtractorRegistry()
  extractors.register(genericExtractor)

  const selectLexical = (): LexicalIndex => {
    const config = options.config()
    const index = state.lexical.get(config.lexicalBackend)
    if (index === undefined) throw new BackendNotMountedError('lexical', config.lexicalBackend)
    return index
  }

  const service: FlywheelService = {
    config: () => ({ ...DEFAULT_CONFIG, ...options.config() }),

    async retrieve(req: RetrieveRequest): Promise<RetrieveResult> {
      const config = this.config()
      const lexical = selectLexical()
      const graph = state.graph
      if (graph === undefined) throw new BackendNotMountedError('lexical', 'graph')
      const vector = config.vectorBackend === 'off' ? undefined : state.vector.get('cloud')
      if (config.vectorBackend !== 'off' && vector === undefined) {
        throw new BackendNotMountedError('vector', 'cloud')
      }
      return coreRetrieve({ graph, lexical, vector }, config, req)
    },

    async ingest(node: NodeRecord, edges: readonly NewEdge[] = []): Promise<void> {
      const lexical = selectLexical()
      const graph = state.graph
      if (graph === undefined) throw new BackendNotMountedError('lexical', 'graph')
      await graph.upsertNode(node)
      await lexical.upsert(node)
      for (const edge of edges) {
        await graph.upsertEdge({ id: `${edge.src}:${edge.rel}:${edge.dst}`, ...edge, created_at: Date.now() })
      }
    },

    queueClaimExtract(claimId, sessionId, projectId, utterance, paths) {
      const run = options.runClaimFlash
      if (run !== undefined) void run(claimId, sessionId, projectId, utterance, paths)
    },

    extractors,

    registerLexical(index: LexicalIndex): () => void {
      state.lexical.set(index.id, index)
      return () => { state.lexical.delete(index.id) }
    },
    registerVector(index: VectorIndex): () => void {
      state.vector.set(index.id, index)
      return () => { state.vector.delete(index.id) }
    },
    registerGraph(store: GraphStore): () => void {
      state.graph = store
      return () => { if (state.graph === store) state.graph = undefined }
    },
    lexical: id => state.lexical.get(id),
    vector: id => state.vector.get(id),
    graph: () => state.graph,
    hasLexical: id => state.lexical.has(id),
    hasVector: id => state.vector.has(id),
  }

  return service
}
