/** Extractor registry (§7.4). Domains register rules that enrich a node's body/summary;
 * they are NOT separate graphs — every domain writes into the same nodes table. */

import type { NodeRecord } from './model.ts'

/** One extractor: given an artifact node, return enriched body text or undefined. */
export interface Extractor {
  readonly id: string
  /** Whether this extractor needs an LLM pass for the given node (flash budget only). */
  needsLlm(node: NodeRecord): boolean
  /** Deterministic enrichment (zero LLM). Must not mutate `node`. */
  enrich(node: NodeRecord): Promise<string | undefined>
}

/** Registry holding mounted extractors. Unknown ids fail loud at config validate. */
export class ExtractorRegistry {
  private readonly byId = new Map<string, Extractor>()

  register(extractor: Extractor): () => void {
    this.byId.set(extractor.id, extractor)
    return () => { this.byId.delete(extractor.id) }
  }

  get(id: string): Extractor | undefined {
    return this.byId.get(id)
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  ids(): readonly string[] {
    return [...this.byId.keys()]
  }
}

/** v1 built-in: mime + path only, no LLM. */
export const genericExtractor: Extractor = {
  id: 'generic',
  needsLlm: () => false,
  enrich: async node => node.path === undefined ? undefined : `path: ${node.path}`,
}
