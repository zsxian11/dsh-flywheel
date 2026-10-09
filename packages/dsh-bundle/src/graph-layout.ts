/** Lay the session graph out in columns: the session on the left, neighbours
 * grouped by relation to its right. Pure geometry, so the Client only paints. */

import { SESSION_NODE_ID, type GraphEdge, type GraphNode, type GraphNodeKind, type GraphView } from './graph-view.ts'

/** Column order and left offset of each node kind. */
export const COLUMN_X: Readonly<Record<GraphNodeKind, number>> = {
  session: 24,
  produced: 236,
  opened: 456,
  card: 676,
}

/** Node box and vertical rhythm. */
export const NODE_WIDTH = 164
export const NODE_HEIGHT = 26
export const ROW_HEIGHT = 38
export const PADDING_Y = 24

/** Per-column cap: beyond it the layout reports the overflow instead of growing. */
export const COLUMN_LIMIT = 14

/** One node with its box position. */
export interface PlacedNode {
  readonly node: GraphNode
  readonly x: number
  readonly y: number
}

/** One edge as an SVG path between two placed nodes. */
export interface PlacedEdge {
  readonly rel: GraphEdge['rel']
  readonly path: string
  readonly hidden: boolean
}

/** A laid-out drawing plus its canvas size and hidden-node counts. */
export interface GraphLayout {
  readonly width: number
  readonly height: number
  readonly nodes: readonly PlacedNode[]
  readonly edges: readonly PlacedEdge[]
  readonly hidden: Readonly<Record<GraphNodeKind, number>>
}

/**
 * Place every node and route every edge.
 * @param view - the drawing computed on the Host.
 */
export function layoutGraph(view: GraphView): GraphLayout {
  const byKind = new Map<GraphNodeKind, GraphNode[]>([
    ['session', []], ['produced', []], ['opened', []], ['card', []],
  ])
  for (const node of view.nodes) byKind.get(node.kind)?.push(node)

  const hidden: Record<GraphNodeKind, number> = { session: 0, produced: 0, opened: 0, card: 0 }
  const rows = Math.max(1, ...[...byKind.values()].map(list =>
    list.length === 0 ? 0 : Math.min(list.length, COLUMN_LIMIT)))
  const height = PADDING_Y * 2 + (rows - 1) * ROW_HEIGHT + NODE_HEIGHT
  const centerY = height / 2

  const placed = new Map<string, PlacedNode>()
  const nodes: PlacedNode[] = []
  for (const [kind, list] of byKind) {
    hidden[kind] = Math.max(0, list.length - COLUMN_LIMIT)
    const visible = kind === 'session' ? list.slice(0, 1) : list.slice(0, COLUMN_LIMIT)
    const span = (visible.length - 1) * ROW_HEIGHT
    visible.forEach((node, index) => {
      const placed_ = {
        node,
        x: COLUMN_X[kind],
        y: kind === 'session' ? centerY - NODE_HEIGHT / 2 : centerY - span / 2 + index * ROW_HEIGHT - NODE_HEIGHT / 2,
      }
      placed.set(node.id, placed_)
      nodes.push(placed_)
    })
  }

  const root = placed.get(SESSION_NODE_ID)
  const edges: PlacedEdge[] = view.edges.map(edge => {
    const from = placed.get(edge.src)
    const to = placed.get(edge.dst)
    if (from === undefined || to === undefined) return { rel: edge.rel, path: '', hidden: true }
    return { rel: edge.rel, path: edgePath(from, to), hidden: false }
  })

  return {
    width: COLUMN_X.card + NODE_WIDTH + 24,
    height: root === undefined ? height : Math.max(height, PADDING_Y * 2 + NODE_HEIGHT),
    nodes,
    edges,
    hidden,
  }
}

/** Cubic path from the right edge of one box to the left edge of another. */
function edgePath(from: PlacedNode, to: PlacedNode): string {
  const x0 = from.x + NODE_WIDTH
  const y0 = from.y + NODE_HEIGHT / 2
  const x1 = to.x
  const y1 = to.y + NODE_HEIGHT / 2
  const bend = Math.max(24, (x1 - x0) / 2)
  return `M ${x0} ${y0} C ${x0 + bend} ${y0}, ${x1 - bend} ${y1}, ${x1} ${y1}`
}

/** Human label for one relation, for the legend and node tooltips. */
export function relLabel(rel: GraphEdge['rel']): string {
  switch (rel) {
    case 'produced': return 'produced'
    case 'opened': return 'opened'
    case 'injected': return 'injected'
  }
}
