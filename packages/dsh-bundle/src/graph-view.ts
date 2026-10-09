/** Turn one session's graph facts into the node/edge view the tab draws.
 * Pure: the Host computes it, the Client renders it. */

import type { GraphSnapshot } from './graph-fold.ts'

/** What a drawn node stands for. */
export type GraphNodeKind = 'session' | 'produced' | 'opened' | 'card'

/** Relation drawn from the session node to a neighbour. */
export type GraphEdgeRel = 'produced' | 'opened' | 'injected'

/** One drawn node. `path` is present for file nodes and file-backed cards. */
export interface GraphNode {
  readonly id: string
  readonly kind: GraphNodeKind
  readonly label: string
  readonly detail: string
  readonly path?: string
}

/** One drawn edge; `src` is always the session node. */
export interface GraphEdge {
  readonly src: string
  readonly rel: GraphEdgeRel
  readonly dst: string
}

/** Counts shown next to the view title. */
export interface GraphCounts {
  readonly injected: number
  readonly produced: number
  readonly opened: number
}

/** The whole drawing: nodes, edges, and the counts derived from them. */
export interface GraphView {
  readonly sessionId: string
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly counts: GraphCounts
}

/** Node id of the session itself. */
export const SESSION_NODE_ID = 'session'

/**
 * Project a folded snapshot onto the drawn graph. A path that a session both
 * wrote and read appears once, as a produced node, and keeps both edges.
 * @param snapshot - folded facts of one session.
 * @param sessionId - owning session id (labels the root node).
 */
export function toGraphView(snapshot: GraphSnapshot, sessionId: string): GraphView {
  const producedPaths = new Set(snapshot.produced.map(file => file.path))
  const nodes: GraphNode[] = [{
    id: SESSION_NODE_ID,
    kind: 'session',
    label: sessionId,
    detail: 'session',
  }]
  const edges: GraphEdge[] = []
  const seen = new Set<string>([SESSION_NODE_ID])

  const addFile = (path: string, kind: 'produced' | 'opened', tool: string): void => {
    if (!seen.has(path)) {
      seen.add(path)
      nodes.push({ id: path, kind, label: basename(path), detail: tool, path })
    }
    edges.push({ src: SESSION_NODE_ID, rel: kind, dst: path })
  }

  for (const file of snapshot.produced) addFile(file.path, 'produced', file.tool)
  for (const file of snapshot.opened) {
    if (producedPaths.has(file.path)) {
      edges.push({ src: SESSION_NODE_ID, rel: 'opened', dst: file.path })
      continue
    }
    addFile(file.path, 'opened', file.tool)
  }

  for (const card of snapshot.workingSet) {
    const id = `card:${card.id}`
    if (!seen.has(id)) {
      seen.add(id)
      const node: GraphNode = {
        id, kind: 'card', label: card.title, detail: card.type,
        ...(card.path === undefined ? {} : { path: card.path }),
      }
      nodes.push(node)
    }
    edges.push({ src: SESSION_NODE_ID, rel: 'injected', dst: id })
  }

  return {
    sessionId,
    nodes,
    edges,
    counts: {
      injected: snapshot.workingSet.length,
      produced: snapshot.produced.length,
      opened: snapshot.opened.length,
    },
  }
}

/** Empty view for a session with nothing folded yet. */
export function emptyGraphView(sessionId: string): GraphView {
  return toGraphView({ workingSet: [], produced: [], opened: [] }, sessionId)
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}
