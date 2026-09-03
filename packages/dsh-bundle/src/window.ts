/** `flywheel-window`: stage-switch compaction. NOT a phase state machine — when a
 * correction or window-switch heuristic fired since the last compaction, run
 * `compactNow` once the agent returns to idle. Never compacts in `agent/pre-step`.
 *
 * Compaction is optional and resolved at idle: Web mounts the engine inside
 * each preset isolate, so a host `inject: ['compaction']` never activates. */

import type { Context } from '@deepseek-ai/cordis'
import { isWindowSwitchUtterance } from '@dsh-flywheel/core'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'

export const name = 'flywheel-window'

export const inject = ['agents', FLYWHEEL_SERVICE]

/** The subset of the compaction seam this plugin calls. */
export interface CompactNow {
  compactNow: (agent: unknown, signal: AbortSignal) => Promise<unknown>
}

/** An agent whose scope context can key a preset-isolated service lookup. */
export interface CompactableAgent {
  ctx: Context
}

/** Optional roster that reads a preset-isolated service for one agent. */
interface AgentPresetRoster {
  serviceFor(agent: CompactableAgent, name: 'compaction'): CompactNow | undefined
}

/**
 * The compaction engine that can compact this agent, or undefined when the
 * composition mounts none (host-disabled Web `minimal`, or no engine at all).
 * @param ctx - host plugin context; `get` reads the global store.
 * @param agent - the idle agent about to close a turn.
 */
export function compactionOf(ctx: Context, agent: CompactableAgent): CompactNow | undefined {
  const host = ctx.get('compaction') as CompactNow | undefined
  if (host !== undefined) return host
  const presets = ctx.get('agentPresets') as AgentPresetRoster | undefined
  return presets?.serviceFor(agent, 'compaction')
}

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel
  let pending = false

  // Observe the direct user sentence for a window switch. Detection only; the
  // actual compaction waits for turn-stop so it cannot race pressure compaction.
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'user/message') return
    const data = event.data as { content?: unknown; source?: { kind?: string } }
    if (data.source?.kind !== 'user') return
    const text = textOf(data.content)
    if (text === undefined || text === '') return
    const config = flywheel.config()
    if (config.windowCompact && isWindowSwitchUtterance(text, config.windowPendingPattern)) {
      pending = true
    }
  })

  // The correction path sets pending through a shared signal; here it flushes at
  // turn stop (serial event: the turn is about to close).
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const config = flywheel.config()
    if (!pending || !config.windowCompact) return
    // /compact is idle-only by contract; turn-stopping is the idle boundary.
    const compaction = compactionOf(ctx, agent)
    if (compaction === undefined) {
      // This agent cannot compact (e.g. Web `minimal`); drop the flag.
      pending = false
      return
    }
    try {
      await compaction.compactNow(agent, signal)
      pending = false
    } catch (error) {
      // Busy: keep pending so the next idle boundary retries.
      ctx.logger?.debug?.(error)
    }
  })
}

function textOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
    .map(block => block.text)
    .join('\n')
}
