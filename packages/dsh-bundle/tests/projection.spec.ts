/** Host graph projection: the Client reads an already-computed, reference-stable drawing. */

import { describe, expect, it } from 'vitest'
import { applyGraphEvent, graphProjection, type GraphProjectionState } from '../src/projection.ts'
import { GRAPH_PROJECTION_KEY } from '../src/graph-key.ts'

function initial(): GraphProjectionState {
  return graphProjection.init({ id: 's1' })
}

const readCall = {
  type: 'tool/call',
  seq: 27,
  data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"src/paths.ts"}' },
}

const writeCall = {
  type: 'tool/call',
  seq: 30,
  data: { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{"file_path":"docs/x.md"}' },
}

const userMessage = {
  type: 'user/message',
  seq: 8,
  data: {
    id: 'm1',
    source: { kind: 'plugin', plugin: 'flywheel-inject', form: 'snapshot', sections: [] },
    content: [{ type: 'text', text: '- [artifact] 会话图 (docs/x.md) — 排查' }],
  },
}

describe('graph projection', () => {
  it('exposes the key the client reads', () => {
    expect(GRAPH_PROJECTION_KEY).toBe('flywheelGraph')
    expect(graphProjection.key).toBe(GRAPH_PROJECTION_KEY)
  })

  it('draws the session with its produced, opened, and injected neighbours', () => {
    let state = applyGraphEvent(initial(), readCall)
    state = applyGraphEvent(state, writeCall)
    state = applyGraphEvent(state, userMessage)

    expect(state.view.sessionId).toBe('s1')
    expect(state.view.nodes.filter(node => node.kind === 'session')).toHaveLength(1)
    expect(state.view.nodes.filter(node => node.kind === 'opened').map(node => node.path)).toEqual(['src/paths.ts'])
    expect(state.view.nodes.filter(node => node.kind === 'produced').map(node => node.path)).toEqual(['docs/x.md'])
    expect(state.view.nodes.filter(node => node.kind === 'card').map(node => node.label)).toEqual(['会话图'])
    expect(state.view.edges.map(edge => edge.rel).sort()).toEqual(['injected', 'opened', 'produced'])
    expect(state.view.counts).toEqual({ injected: 1, produced: 1, opened: 1 })
  })

  it('keeps the same state reference for unrelated events', () => {
    const state = initial()
    expect(applyGraphEvent(state, { type: 'turn/start', seq: 4, data: {} })).toBe(state)
    expect(applyGraphEvent(state, { type: 'tool/call', seq: 5, data: { name: 'bash' } })).toBe(state)
  })

  it('returns a stable view reference so the registry does not republish', () => {
    const state = applyGraphEvent(initial(), readCall)
    expect(graphProjection.wire.view(state)).toBe(graphProjection.wire.view(state))
    expect(graphProjection.wire.view(state)).toBe(state.view)
  })

  it('replaces a later working set and dedupes repeated calls', () => {
    let state = applyGraphEvent(initial(), readCall)
    state = applyGraphEvent(state, readCall)
    expect(state.view.nodes.filter(node => node.kind === 'opened')).toHaveLength(1)

    state = applyGraphEvent(state, userMessage)
    state = applyGraphEvent(state, { ...userMessage, seq: 30, data: { ...userMessage.data, id: 'm2' } })
    expect(state.view.counts.injected).toBe(1)
  })

  it('hands the registry Zod-shaped schemas (schema.parse), including a session node with no path', () => {
    let state = applyGraphEvent(initial(), readCall)
    state = applyGraphEvent(state, userMessage)
    expect(typeof graphProjection.wire.viewSchema.parse).toBe('function')
    expect(typeof graphProjection.stateSchema.parse).toBe('function')
    expect(graphProjection.wire.viewSchema.parse(state.view)).toMatchObject({
      sessionId: 's1',
      counts: { injected: 1, produced: 0, opened: 1 },
    })
    expect(graphProjection.stateSchema.parse(state).view).toBe(state.view)
    expect(() => graphProjection.wire.viewSchema.parse(initial().view)).not.toThrow()
  })
})
