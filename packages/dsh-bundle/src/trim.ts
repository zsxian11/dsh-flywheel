/** `flywheel-trim`: bound oversized tool results (including `read`) at
 * `tools/post-execute` so later steps do not replay full file bodies.
 * This is not compaction: it is append-only, deterministic, and never calls
 * a model.
 *
 * Official DSH `read` stores the full window on canonical `value` and UI
 * `meta`. Replacing only `content` leaves the huge window in those fields, so
 * Chat and any later re-render still look untruncated. For a `read` window we
 * therefore replace `value` (registry re-renders content + meta). Other tools
 * still replace `content`. Nested/parented calls are trimmed too. */

import type { Context } from '@deepseek-ai/cordis'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'
import {
  flattenPlainText, isReadWindowValue, stripReadSpillLocator, trimPlainText, trimReadWindow,
} from './trim-text.ts'

export const name = 'flywheel-trim'

export const inject = ['tools', FLYWHEEL_SERVICE]

export {
  flattenPlainText, isReadWindowValue, stripReadSpillLocator, trimNotice, trimPlainText,
  trimReadWindow,
} from './trim-text.ts'

function withContexts<T extends { kind: 'accept' }>(decision: PostToolDecision, body: T): T {
  if (decision.additionalContexts === undefined) return body
  return { ...body, additionalContexts: decision.additionalContexts }
}

/**
 * Bound one accepted post-execute decision, or `undefined` when nothing changes.
 * Replaces `read` via canonical `value` so UI meta matches the model-facing text.
 */
export function trimAcceptedDecision(
  decision: PostToolDecision,
  result: { content?: unknown; value?: unknown } | undefined,
  exec: { name?: unknown },
  maxChars: number,
): PostToolDecision | undefined {
  if (decision.kind !== 'accept') return undefined
  const toolName = typeof exec?.name === 'string' ? exec.name : ''
  const value = Object.hasOwn(decision, 'value') ? (decision as { value?: unknown }).value : result?.value
  if (toolName === 'read' && isReadWindowValue(value)) {
    const trimmed = trimReadWindow(value, maxChars)
    if (trimmed === undefined) return undefined
    return withContexts(decision, { kind: 'accept', value: trimmed })
  }

  const content = Object.hasOwn(decision, 'content') ? decision.content : result?.content
  if (!Array.isArray(content)) return undefined
  const text = flattenPlainText(content)
  if (text === undefined) return undefined
  const replacedText = trimPlainText(text, maxChars, toolName)
  if (replacedText === undefined) return undefined
  return withContexts(decision, {
    kind: 'accept',
    content: [{ type: 'text', text: replacedText }],
  })
}

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const config = flywheel.config()
    if (!config.enabled || !config.trimToolResults) return decision
    return trimAcceptedDecision(decision, result, exec, config.maxToolResultChars) ?? decision
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const config = flywheel.config()
    if (!config.enabled || !config.trimToolResults) return decision
    const toolName = typeof exec?.name === 'string' ? exec.name : ''
    if (toolName !== 'read') return decision
    // A value replace already re-renders content + UI meta. Falling back to
    // original `result.content` here would undo that and restore the huge card.
    if (Object.hasOwn(decision, 'value')) return decision
    const content = decision.content ?? result?.content
    if (!Array.isArray(content)) return decision
    const text = flattenPlainText(content)
    if (text === undefined) return decision
    const replacedText = stripReadSpillLocator(text)
    if (replacedText === undefined) return decision
    return {
      kind: 'accept',
      content: [{ type: 'text', text: replacedText }],
      ...decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts },
    }
  }, { prepend: true })
}
