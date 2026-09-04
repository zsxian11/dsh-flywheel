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

/** Line-numbered `read` canonical value (dsh-tool-fs). Truncating this rebuilds
 * both model-facing `content` and UI `meta`; content-only replace leaves the
 * full window in `value`/`meta` after recent DSH structured-output updates. */
export interface ReadWindowValue {
  path: string
  offset: number
  lines: readonly { number: number; text: string }[]
  totalLines: number
}

/** Whether `value` is a filesystem `read` window we can bound. */
export function isReadWindowValue(value: unknown): value is ReadWindowValue {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.path !== 'string' || typeof record.offset !== 'number'
    || typeof record.totalLines !== 'number' || !Array.isArray(record.lines)) return false
  return record.lines.every(line => (
    typeof line === 'object' && line !== null
    && typeof (line as { number?: unknown }).number === 'number'
    && typeof (line as { text?: unknown }).text === 'string'
  ))
}

function windowBody(lines: readonly { number: number; text: string }[]): string {
  return lines.map(line => line.text).join('\n')
}

/**
 * Drop middle lines so the concatenated body is under `maxChars`.
 * @returns a smaller window, or `undefined` when no trim is needed or possible.
 */
export function trimReadWindow(value: ReadWindowValue, maxChars: number): ReadWindowValue | undefined {
  const body = windowBody(value.lines)
  if (body.length <= maxChars) return undefined
  const marker = trimNotice(body.length, 'read')
  if (marker.length >= maxChars) return undefined
  const budget = maxChars - marker.length - 1
  if (budget < 1) return undefined
  const headBudget = Math.max(1, Math.ceil(budget * 0.75))
  const tailBudget = Math.max(0, budget - headBudget)
  const head: { number: number; text: string }[] = []
  let headChars = 0
  for (const line of value.lines) {
    const extra = head.length === 0 ? line.text.length : line.text.length + 1
    if (headChars + extra > headBudget) break
    head.push({ number: line.number, text: line.text })
    headChars += extra
  }
  if (head.length === 0) return undefined
  const tail: { number: number; text: string }[] = []
  if (tailBudget > 0) {
    let tailChars = 0
    for (let index = value.lines.length - 1; index >= head.length; index -= 1) {
      const line = value.lines[index]
      if (line === undefined) break
      const extra = tail.length === 0 ? line.text.length : line.text.length + 1
      if (tailChars + extra > tailBudget) break
      tail.unshift({ number: line.number, text: line.text })
      tailChars += extra
    }
  }
  const kept = new Set([...head, ...tail].map(line => line.number))
  if (kept.size >= value.lines.length) return undefined
  const omittedStart = (head.at(-1)?.number ?? value.offset) + 1
  const omittedEnd = tail[0]?.number ?? value.totalLines
  const markerLine = {
    number: omittedStart,
    text: `${marker} (lines ${omittedStart}–${omittedEnd}; use offset/limit)`,
  }
  return {
    path: value.path,
    offset: value.offset,
    totalLines: value.totalLines,
    lines: [...head, markerLine, ...tail],
  }
}

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
