/** `flywheel-window`: stage-switch compaction. NOT a phase state machine — when a
 * correction or window-switch heuristic fires, compact on step 1 (before the
 * model call) via `compactIfNeeded`. Prefer `'forced'` (patched / future DSH);
 * official npm DSH only has `'context-overflow'`, which already bypasses the
 * pressure threshold. `compactNow` stays idle-only and is the turn-stopping
 * fallback. Never call `compactNow` in `agent/pre-step`.
 *
 * Compaction is optional and resolved per agent: Web mounts the engine inside
 * each preset isolate, so a host `inject: ['compaction']` never activates.
 * A successful compact is followed by a Chat `notice` so the row is not
 * mistaken for /compact or pressure compaction. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { isWindowSwitchUtterance } from '@dsh-flywheel/core'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'
import { directUserText } from './inject.ts'
import { windowCompactNotice } from './notices.ts'

export const name = 'flywheel-window'

export const inject = ['agents', FLYWHEEL_SERVICE]

/** The subset of the compaction seam this plugin calls. */
export interface CompactEngine {
  compactNow: (agent: unknown, signal: AbortSignal) => Promise<unknown>
  compactIfNeeded?: (agent: unknown, trigger: string, signal: AbortSignal) => Promise<unknown>
}

/**
 * Turn-start triggers, in order. `'forced'` is the named bypass on patched DSH;
 * `'context-overflow'` is the same mechanical bypass on the official engine.
 */
export const WINDOW_COMPACT_TRIGGERS = ['forced', 'context-overflow'] as const

/**
 * Compact below the pressure threshold without calling idle-only `compactNow`.
 * @returns the engine result, or `null` when no in-turn compact ran.
 */
export async function compactAtTurnStart(
  engine: CompactEngine,
  agent: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const compactIfNeeded = engine.compactIfNeeded
  if (compactIfNeeded === undefined) return null
  for (const trigger of WINDOW_COMPACT_TRIGGERS) {
    try {
      const result = await compactIfNeeded(agent, trigger, signal)
      if (result != null) return result
    } catch {
      // Official DSH `assertNever`s unknown `'forced'`; try the next trigger.
    }
  }
  return null
}

/** @deprecated Use {@link CompactEngine}. */
export type CompactNow = CompactEngine

/** An agent whose scope context can key a preset-isolated service lookup. */
export interface CompactableAgent {
  ctx: Context
  session: {
    id?: string
    append(type: string, data: unknown, opts?: { surfaceOp: 'append' }): unknown
  }
}

/**
 * Chat `notice` after a successful topic-switch compact. Must run after
 * compaction so the replacement span does not swallow it; `user/message`
 * is surface-eligible and requires `surfaceOp: 'append'`.
 * @param session - the compacted agent's session.
 * @param query - the user sentence that tripped the window-switch heuristic.
 */
export function appendWindowCompactNotice(
  session: CompactableAgent['session'],
  query: string,
): void {
  const notice = windowCompactNotice(query)
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: notice.text }],
    source: { kind: 'plugin', plugin: name, form: 'notice', summary: notice.summary },
  }), { surfaceOp: 'append' })
}

/** Optional roster that reads a preset-isolated service for one agent. */
interface AgentPresetRoster {
  serviceFor(agent: CompactableAgent, name: 'compaction'): CompactEngine | undefined
}

/**
 * The compaction engine that can compact this agent, or undefined when the
 * composition mounts none (host-disabled Web `minimal`, or no engine at all).
 * @param ctx - host plugin context; `get` reads the global store.
 * @param agent - the agent about to compact.
 */
export function compactionOf(ctx: Context, agent: CompactableAgent): CompactEngine | undefined {
  const host = ctx.get('compaction') as CompactEngine | undefined
  if (host !== undefined) return host
  const presets = ctx.get('agentPresets') as AgentPresetRoster | undefined
  return presets?.serviceFor(agent, 'compaction')
}

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel
  let pending = false
  let pendingQuery = ''
  let compactedAtTurnStart = false

  // Step 1 claimed user text is visible here; session `user/message` is not
  // appended until after pre-step, so turn-start compact must happen now.
  ctx.on('agent/pre-step', async (
    { agent, step, signal, messages },
    next,
  ): Promise<PreStepDecision> => {
    const config = flywheel.config()
    if (config.windowCompact && step === 1) {
      const text = claimedUserText(messages)
      if (text !== undefined && isWindowSwitchUtterance(text, config.windowPendingPattern)) {
        const compaction = compactionOf(ctx, agent)
        if (compaction !== undefined) {
          const result = await compactAtTurnStart(compaction, agent, signal)
          if (result != null) {
            compactedAtTurnStart = true
            pending = false
            pendingQuery = ''
            appendWindowCompactNotice(agent.session, text)
          } else {
            pending = true
            pendingQuery = text
          }
        } else {
          pending = true
          pendingQuery = text
        }
      }
    }
    return next()
  }, { prepend: true })

  // Observe the direct user sentence for a window switch when step-1 compact
  // did not run (no engine, or in-turn compactIfNeeded returned nothing).
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'user/message') return
    if (compactedAtTurnStart) return
    const data = event.data as { content?: unknown; source?: { kind?: string } }
    if (data.source?.kind !== 'user') return
    const text = textOf(data.content)
    if (text === undefined || text === '') return
    const config = flywheel.config()
    if (config.windowCompact && isWindowSwitchUtterance(text, config.windowPendingPattern)) {
      pending = true
      pendingQuery = text
    }
  })

  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const config = flywheel.config()
    if (compactedAtTurnStart) {
      compactedAtTurnStart = false
      return
    }
    if (!pending || !config.windowCompact) return
    // /compact is idle-only by contract; turn-stopping is the idle boundary.
    const compaction = compactionOf(ctx, agent)
    if (compaction === undefined) {
      pending = false
      pendingQuery = ''
      return
    }
    try {
      const result = await compaction.compactNow(agent, signal)
      pending = false
      const query = pendingQuery
      pendingQuery = ''
      if (result != null) appendWindowCompactNotice(agent.session, query)
    } catch (error) {
      // Busy: keep pending so the next idle boundary retries.
      ctx.logger?.debug?.(error)
    }
  })
}

function claimedUserText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  return directUserText(messages as UserMessage[])
}

function textOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
    .map(block => block.text)
    .join('\n')
}
