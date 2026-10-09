/** Host-side session projection for the graph tab.
 *
 * The Client must not fold session events itself; it reads a value the Host has
 * already computed (`wire.view`). This module keeps that value in the projection
 * state so the view is a stable reference — the registry compares consecutive
 * `view` results with `Object.is`, and a view that recomputed per call would
 * publish on every read. */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import {
  factFromEvent, foldFacts,
  type GraphEvent, type GraphFact,
} from './graph-fold.ts'
import { emptyGraphView, toGraphView, type GraphView } from './graph-view.ts'
import { GRAPH_PROJECTION_KEY } from './graph-key.ts'

export const name = 'flywheel-graph-projection'

/** Host services required before the projection can be registered. */
export const inject = ['sessionProjections']

/**
 * Host `SessionProjectionRegistry` always calls `schema.parse` (Zod).
 * Schemastery schemas are callables and have no `.parse`; registering them
 * verbatim makes every session load fail with
 * `wire.viewSchema.parse is not a function`.
 */
function wireSchema<T>(schema: (data?: unknown) => T): { parse(data: unknown): T } {
  return {
    parse(data: unknown): T {
      return schema(data)
    },
  }
}

const nodeSchema = z.object({
  id: z.string(),
  kind: z.union([z.const('session'), z.const('produced'), z.const('opened'), z.const('card')]),
  label: z.string(),
  detail: z.string(),
  path: z.string(),
})

const edgeSchema = z.object({
  src: z.string(),
  rel: z.union([z.const('produced'), z.const('opened'), z.const('injected')]),
  dst: z.string(),
})

/** Wire schema: the drawing the Client receives. */
const graphViewSchema = z.object({
  sessionId: z.string(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  counts: z.object({
    injected: z.number(),
    produced: z.number(),
    opened: z.number(),
  }),
})

/** Projection state: the folded facts plus the drawing handed to the Client. */
export interface GraphProjectionState {
  readonly sessionId: string
  readonly order: readonly string[]
  readonly facts: Readonly<Record<string, GraphFact>>
  readonly view: GraphView
}

/**
 * Local shape of a projection definition. The schema fields stay `unknown` so
 * this module's public types do not leak schemastery's internal references.
 */
export interface GraphProjectionDefinition {
  readonly key: string
  readonly stateSchema: { parse(data: unknown): GraphProjectionState }
  readonly stateVersion: number
  readonly init: (header?: { id?: string }) => GraphProjectionState
  readonly apply: (state: GraphProjectionState, event: GraphEvent) => GraphProjectionState
  readonly wire: {
    readonly viewSchema: { parse(data: unknown): GraphView }
    readonly view: (state: GraphProjectionState) => GraphView
  }
}

/** Fact identity: one event yields at most one fact, keyed like the old client fold. */
function factKeyOf(event: GraphEvent): string | undefined {
  const data = event.data
  if (event.type === 'tool/call') {
    const callId = typeof data === 'object' && data !== null ? (data as { callId?: unknown }).callId : undefined
    return typeof callId === 'string' && callId.length > 0 ? `tool:${callId}` : undefined
  }
  if (event.type === 'user/message') {
    const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined
    const seq = typeof event.seq === 'number' ? event.seq : 0
    return `inject:${typeof id === 'string' && id.length > 0 ? id : `seq:${seq}`}`
  }
  return undefined
}

/** Fold one event into the state, returning the same reference when unrelated. */
export function applyGraphEvent(state: GraphProjectionState, event: GraphEvent): GraphProjectionState {
  const fact = factFromEvent(event)
  if (fact === null) return state
  const key = factKeyOf(event)
  if (key === undefined) return state
  if (state.facts[key] === fact) return state
  const order = key in state.facts ? state.order : [...state.order, key]
  const facts = { ...state.facts, [key]: fact }
  const snapshot = foldFacts(order.map(id => facts[id] as GraphFact))
  return { sessionId: state.sessionId, order, facts, view: toGraphView(snapshot, state.sessionId) }
}

/** The projection definition registered on the Host. */
export const graphProjection: GraphProjectionDefinition = {
  key: GRAPH_PROJECTION_KEY,
  stateSchema: wireSchema(z.any() as (data?: unknown) => GraphProjectionState),
  stateVersion: 1,
  init: (header?: { id?: string }): GraphProjectionState => ({
    sessionId: header?.id ?? '',
    order: [],
    facts: {},
    view: emptyGraphView(header?.id ?? ''),
  }),
  apply: applyGraphEvent,
  wire: {
    viewSchema: wireSchema(graphViewSchema as (data?: unknown) => GraphView),
    view: (state: GraphProjectionState): GraphView => state.view,
  },
}

/**
 * Register the graph projection. Host-only: the browser half reads the value
 * through the conversation slot's `useProjection` hook.
 * @param ctx - host context that has `sessionProjections`.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const registry = (ctx as unknown as { sessionProjections: { register(d: unknown): unknown } }).sessionProjections
    const disposed = registry.register(graphProjection)
    return typeof disposed === 'function' ? disposed as () => void : () => {}
  }, 'flywheel-graph: session projection')
}
