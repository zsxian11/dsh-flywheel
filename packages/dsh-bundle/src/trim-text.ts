/** Deterministic bound for one model-facing tool result. Zero LLM.
 * Registered inner of DSH spill so a large `read` is usually never spilled;
 * `stripReadSpillLocator` is the outer fallback when official spill still
 * writes a file. Both tell the model to re-read the original path. */

/** UTF-16 encoding, same budget unit as working-set `maxChars`. */
export const TOOL_RESULT_TEXT_ENCODING: 'utf16' = 'utf16'

const JOIN = '\n\n'

/**
 * Build the omitted-middle marker. `omitted` is reserved at the source length
 * so the notice can never grow after the head/tail split.
 */
export function trimNotice(omitted: number, toolName: string): string {
  const hint = toolName === 'read'
    ? 'Re-read the original path with offset/limit for the omitted middle.'
    : 'Narrow the same tool call if you need the omitted middle.'
  return `[... flywheel truncated; ${omitted} chars omitted. ${hint}]`
}

/**
 * Head/tail-truncate `text` so the replacement is ≤ `maxChars` UTF-16 units.
 * @returns the bounded text, or `undefined` when no trim is needed or possible.
 */
export function trimPlainText(text: string, maxChars: number, toolName: string): string | undefined {
  if (text.length <= maxChars) return undefined
  const reserved = trimNotice(text.length, toolName)
  const overhead = reserved.length + JOIN.length * 2
  if (overhead >= maxChars) return undefined
  const budget = maxChars - overhead
  const headChars = Math.max(1, Math.ceil(budget * 0.75))
  const tailChars = Math.max(0, budget - headChars)
  const head = text.slice(0, headChars)
  const tail = tailChars === 0 ? '' : text.slice(text.length - tailChars)
  const omitted = text.length - head.length - tail.length
  if (omitted <= 0) return undefined
  const notice = trimNotice(omitted, toolName)
  const replaced = tail.length === 0 ? `${head}${JOIN}${notice}` : `${head}${JOIN}${notice}${JOIN}${tail}`
  return replaced.length < text.length && replaced.length <= maxChars ? replaced : undefined
}

/** Flatten accepted plain-text blocks, or `undefined` when any block is rich. */
export function flattenPlainText(content: readonly { type: string; text?: string }[]): string | undefined {
  let text = ''
  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') return undefined
    text += block.text
  }
  return text
}

/** Official spill-policy locator line; the model must not `read` this path. */
const SPILL_LOCATOR_RE = /Full formatted result stored at:\s+[^\n)]+/u

/**
 * Remove a spill-file locator from a model-facing `read` result.
 * @returns the rewritten text, or `undefined` when there is no locator.
 */
export function stripReadSpillLocator(text: string): string | undefined {
  if (!SPILL_LOCATOR_RE.test(text)) return undefined
  const replaced = text.replace(
    SPILL_LOCATOR_RE,
    'Re-read the original path with offset/limit for the omitted middle.',
  )
  return replaced === text ? undefined : replaced
}
