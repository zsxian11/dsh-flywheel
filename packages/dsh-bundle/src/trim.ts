/** `flywheel-trim`: bound oversized tool results (including `read`) at
 * `tools/post-execute` so later steps do not replay full file bodies.
 * This is not compaction: it is append-only, deterministic, and never calls
 * a model.
 *
 * Two waterfall arms, so this works on official npm DSH without replacing
 * `spill-policy`:
 * - Inner (no prepend): trim before spill sees the full text, so a `read`
 *   usually stays under `maxInlineBytes` and is never written to a spill file.
 * - Outer (prepend): if official spill still wrote a locator (UTF-8 bytes can
 *   exceed the cap after a UTF-16 char trim), strip that path from `read`. */

import type { Context } from '@deepseek-ai/cordis'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'
import { flattenPlainText, stripReadSpillLocator, trimPlainText } from './trim-text.ts'

export const name = 'flywheel-trim'

export const inject = ['tools', FLYWHEEL_SERVICE]

export {
  flattenPlainText, stripReadSpillLocator, trimNotice, trimPlainText,
} from './trim-text.ts'

function acceptedPlainText(
  decision: PostToolDecision,
  result: { content?: unknown } | undefined,
  exec: { name?: unknown; parent?: unknown },
): { toolName: string; text: string } | undefined {
  if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return undefined
  if (exec?.parent !== undefined) return undefined
  const toolName = typeof exec?.name === 'string' ? exec.name : ''
  const content = decision.content ?? result?.content
  if (!Array.isArray(content)) return undefined
  const text = flattenPlainText(content)
  if (text === undefined) return undefined
  return { toolName, text }
}

function acceptText(decision: PostToolDecision, text: string): PostToolDecision {
  return {
    kind: 'accept',
    content: [{ type: 'text', text }],
    ...decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts },
  }
}

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const config = flywheel.config()
    if (!config.enabled || !config.trimToolResults) return decision
    const accepted = acceptedPlainText(decision, result, exec)
    if (accepted === undefined) return decision
    const replacedText = trimPlainText(accepted.text, config.maxToolResultChars, accepted.toolName)
    if (replacedText === undefined) return decision
    return acceptText(decision, replacedText)
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const config = flywheel.config()
    if (!config.enabled || !config.trimToolResults) return decision
    const accepted = acceptedPlainText(decision, result, exec)
    if (accepted === undefined || accepted.toolName !== 'read') return decision
    const replacedText = stripReadSpillLocator(accepted.text)
    if (replacedText === undefined) return decision
    return acceptText(decision, replacedText)
  }, { prepend: true })
}
