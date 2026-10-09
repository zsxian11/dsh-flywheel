/** Graph view projection and layout: pure functions the Host computes and the tab paints. */

import { describe, expect, it } from 'vitest'
import { emptyGraphView, toGraphView } from '../src/graph-view.ts'
import { COLUMN_LIMIT, COLUMN_X, NODE_WIDTH, layoutGraph } from '../src/graph-layout.ts'

const snapshot = {
  workingSet: [{ id: 'docs/x.md', type: 'artifact', title: '会话图', summary: '排查', path: 'docs/x.md' }],
  produced: [{ path: 'docs/x.md', tool: 'write', role: 'produced' as const }],
  opened: [
    { path: 'src/paths.ts', tool: 'read', role: 'opened' as const },
    { path: 'docs/x.md', tool: 'read', role: 'opened' as const },
  ],
}

describe('toGraphView', () => {
  it('draws one node per path and one edge per relation', () => {
    const view = toGraphView(snapshot, 's1')
    expect(view.nodes.map(node => node.id).sort()).toEqual(['card:docs/x.md', 'docs/x.md', 'session', 'src/paths.ts'])
    expect(view.edges.map(edge => `${edge.rel}:${edge.dst}`).sort()).toEqual([
      'injected:card:docs/x.md', 'opened:docs/x.md', 'opened:src/paths.ts', 'produced:docs/x.md',
    ])
  })

  it('labels file nodes with the basename and keeps the full path', () => {
    const file = toGraphView(snapshot, 's1').nodes.find(node => node.id === 'src/paths.ts')
    expect(file?.label).toBe('paths.ts')
    expect(file?.path).toBe('src/paths.ts')
    expect(file?.detail).toBe('read')
  })

  it('reports the counts shown beside the title', () => {
    expect(toGraphView(snapshot, 's1').counts).toEqual({ injected: 1, produced: 1, opened: 2 })
  })

  it('still draws the session node for an empty session', () => {
    const view = emptyGraphView('s9')
    expect(view.sessionId).toBe('s9')
    expect(view.nodes.map(node => node.kind)).toEqual(['session'])
    expect(view.edges).toEqual([])
  })
})

describe('layoutGraph', () => {
  it('puts the session in the first column and neighbours to its right', () => {
    const layout = layoutGraph(toGraphView(snapshot, 's1'))
    const session = layout.nodes.find(placed => placed.node.kind === 'session')
    const produced = layout.nodes.find(placed => placed.node.kind === 'produced')
    const opened = layout.nodes.find(placed => placed.node.kind === 'opened')
    expect(session?.x).toBe(COLUMN_X.session)
    expect(produced?.x).toBe(COLUMN_X.produced)
    expect(opened?.x).toBe(COLUMN_X.opened)
    expect(layout.width).toBeGreaterThan(COLUMN_X.card)
  })

  it('routes every edge from the session to a placed node', () => {
    const layout = layoutGraph(toGraphView(snapshot, 's1'))
    expect(layout.edges.filter(edge => edge.hidden)).toEqual([])
    for (const edge of layout.edges) expect(edge.path.startsWith('M ')).toBe(true)
  })

  it('caps a busy column and reports the overflow', () => {
    const many = Array.from({ length: COLUMN_LIMIT + 3 }, (_, index) => ({
      path: `src/f${index}.ts`, tool: 'read', role: 'opened' as const,
    }))
    const layout = layoutGraph(toGraphView({ workingSet: [], produced: [], opened: many }, 's1'))
    expect(layout.nodes.filter(placed => placed.node.kind === 'opened')).toHaveLength(COLUMN_LIMIT)
    expect(layout.hidden.opened).toBe(3)
    expect(layout.height).toBeLessThan(COLUMN_LIMIT * 40 + 100)
  })

  it('keeps a node inside the canvas width', () => {
    const layout = layoutGraph(toGraphView(snapshot, 's1'))
    for (const placed of layout.nodes) {
      expect(placed.x + NODE_WIDTH).toBeLessThanOrEqual(layout.width)
    }
  })
})
