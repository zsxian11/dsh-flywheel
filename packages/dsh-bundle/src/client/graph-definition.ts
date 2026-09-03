/** Conversation Definitions that fold flywheel inject and file tools into the graph tab. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  EMPTY_GRAPH_SNAPSHOT, factFromEvent, foldFacts, type GraphFact, type GraphSnapshot,
} from './graph-fold.ts'

export const GRAPH_TARGET = 'flywheel-graph'

interface GraphFactState {
  readonly fact: GraphFact
}

interface GraphViewNode extends ConversationViewNode {
  readonly target: typeof GRAPH_TARGET
  readonly data: GraphFact
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    'flywheel-graph': GraphSnapshot
  }
}

function callIdOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const callId = (data as { callId?: unknown }).callId
  return typeof callId === 'string' && callId.length > 0 ? callId : undefined
}

function messageIdOf(data: unknown, seq: number): string {
  if (typeof data === 'object' && data !== null) {
    const id = (data as { id?: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return `seq:${seq}`
}

export const graphFactDefinition: ConversationNodeDefinition<GraphFactState> = {
  kind: 'flywheel-graph-fact',
  target: GRAPH_TARGET,
  match(event) {
    if (event.type === 'tool/call') {
      if (factFromEvent(event) === null) return null
      const callId = callIdOf(event.data)
      return callId === undefined ? null : { id: `tool:${callId}`, role: 'start' }
    }
    if (event.type === 'user/message') {
      if (factFromEvent(event) === null) return null
      const seq = typeof event.seq === 'number' ? event.seq : 0
      return { id: `inject:${messageIdOf(event.data, seq)}`, role: 'start' }
    }
    return null
  },
  start(_context, match) {
    const fact = factFromEvent(match.event)
    if (fact === null) throw new Error('flywheel-graph start requires a graph fact')
    return { fact }
  },
  update: context => context.state,
  buildViewNode(context): GraphViewNode | null {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: context.kind,
      id: context.id,
      target: GRAPH_TARGET,
      data: context.state.fact,
    }
  },
}

class GraphSnapshotBuilder {
  readonly empty: GraphSnapshot = EMPTY_GRAPH_SNAPSHOT
  private readonly facts = new Map<string, GraphFact>()
  private order: string[] = []

  replace(input: { readonly nodes: readonly ConversationViewNode[] }): GraphSnapshot {
    this.facts.clear()
    this.order = []
    for (const node of input.nodes) this.upsert(node)
    return this.snapshot()
  }

  apply(input: { readonly upserts: readonly ConversationViewNode[] }): GraphSnapshot {
    for (const node of input.upserts) this.upsert(node)
    return this.snapshot()
  }

  private upsert(node: ConversationViewNode): void {
    if (node.target !== GRAPH_TARGET) return
    if (!this.facts.has(node.id)) this.order.push(node.id)
    this.facts.set(node.id, node.data as GraphFact)
  }

  private snapshot(): GraphSnapshot {
    return foldFacts(this.order.flatMap(id => {
      const fact = this.facts.get(id)
      return fact === undefined ? [] : [fact]
    }))
  }
}

const graphViewDefinition: ConversationViewDefinition<GraphViewNode, GraphSnapshot> = {
  target: GRAPH_TARGET,
  create: () => new GraphSnapshotBuilder(),
  isActive: snapshot => snapshot.workingSet.length + snapshot.produced.length + snapshot.opened.length > 0,
}

/**
 * Register the graph target builder and per-fact Definitions.
 * @param ctx - client context that has `uiConversation`.
 */
export function registerGraphConversation(ctx: Context): void {
  ctx.uiConversation.events.register(graphFactDefinition)
  ctx.uiConversation.views.register(graphViewDefinition)
}
