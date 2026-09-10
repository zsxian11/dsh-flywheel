/** `flywheel-inject`: prepends the working-set to eligible pre-step turns.
 * Mirrors time-context (prepend waterfall, `next()` first, `createUserMessage`
 * with a plugin source) — but injects ONLY on step 1 with a direct user
 * message, and skips when the retrieval digest is unchanged.
 * Working-set uses Chat `snapshot` (named sections). One-line nudges use
 * `notice` with only `summary` — V3 refuses undeclared source fields. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compaction'
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  isImplementUtterance, isPlanChangePath, PLAN_CHANGE_LOOKBACK, type GraphStore,
} from '@dsh-flywheel/core'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'
import { missingPlanNotice, workingSetChrome } from './notices.ts'
import { projectId } from './project.ts'

export const name = 'flywheel-inject'

export const inject = ['agents', FLYWHEEL_SERVICE]

export { queryUsesCjk, workingSetChrome, workingSetNoticeSummary, missingPlanNotice } from './notices.ts'

/** The most recently injected digest per session id (cleared after compaction/end). */
const lastDigest = new Map<string, string>()

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel

  ctx.on('agent/pre-step', async (
    { agent, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    try {
      const config = flywheel.config()
      if (!config.enabled || !config.inject) return decision
      // Only the first step of a turn, and only a direct human message.
      if (step !== 1) return decision
      const userText = directUserText(decision.messages)
      if (userText === undefined) return decision

      const sessionId = agent.session.id
      const extras: UserMessage[] = []

      if (isImplementUtterance(userText)) {
        let hasPlan = false
        try {
          hasPlan = await hasRecentPlanChange(flywheel.graph(), sessionId)
        } catch (error) {
          ctx.logger?.warn?.(error)
        }
        if (!hasPlan) extras.push(missingPlanMessage(userText))
      }

      let result
      try {
        result = await flywheel.retrieve({ projectId: projectId(), sessionId, query: userText })
      } catch (error) {
        ctx.logger?.warn?.(error)
        return extras.length === 0 ? decision : { ...decision, messages: [...extras, ...decision.messages] }
      }
      // Unchanged digest → nothing new to inject, unless we still need the plan notice.
      if (lastDigest.get(sessionId) === result.digest || result.text === '') {
        return extras.length === 0 ? decision : { ...decision, messages: [...extras, ...decision.messages] }
      }
      lastDigest.set(sessionId, result.digest)

      const chrome = workingSetChrome(userText)
      const snapshotText = `${chrome.title}\n${chrome.disclaimer}\n${result.text}`
      const snapshot = createUserMessage({
        content: [{ type: 'text', text: snapshotText }],
        source: {
          kind: 'plugin',
          plugin: name,
          form: 'snapshot',
          sections: [{ name, text: snapshotText }],
        },
      })

      // Place the working set BEFORE the real user message (design §6.2 ordering).
      return { ...decision, messages: [...extras, snapshot, ...decision.messages] }
    } catch (error) {
      ctx.logger?.warn?.(error)
      return decision
    }
  }, { prepend: true })

  // A compaction ends the request history: the next real user message re-injects.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'compaction/end') lastDigest.delete(session.id)
  })
}

/** The verbatim text of the turn's direct user message, or undefined when none (subagent/plugin/injected excluded). */
export function directUserText(messages: readonly UserMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== 'user' || message.source.kind !== 'user') continue
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
      .map(block => block.text)
      .join('\n')
    if (text.length > 0) return text
  }
  return undefined
}

/** Whether this session recently wrote a docs/changes plan file. */
export async function hasRecentPlanChange(
  graph: Pick<GraphStore, 'recentActiveSessionNodes' | 'nodes'> | undefined,
  sessionId: string,
  limit = PLAN_CHANGE_LOOKBACK,
): Promise<boolean> {
  if (graph === undefined) return false
  const ids = await graph.recentActiveSessionNodes(sessionId, 'change', limit)
  if (ids.length === 0) return false
  const nodes = await graph.nodes(ids)
  for (const node of nodes.values()) {
    if (isPlanChangePath(node.path)) return true
  }
  return false
}

function missingPlanMessage(query: string): UserMessage {
  const notice = missingPlanNotice(query)
  return createUserMessage({
    content: [{ type: 'text', text: notice.text }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: boundContextSummary(notice.summary),
    },
  })
}
