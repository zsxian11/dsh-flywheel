/** Head-of-file digest for index cards. A file node used to carry only its
 * basename, so a Chinese utterance could never recall it (the trigram index has
 * no text to match). Reading the first bytes of a written document gives the
 * card a real title and summary. Pure text handling; IO in `readFileDigest`. */

import { open } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/** How much of a written file is read for its digest. */
export const DIGEST_READ_BYTES = 8192

/** Card title budget in UTF-16 code units. */
export const DIGEST_TITLE_CHARS = 80

/** Card summary budget in UTF-16 code units (mirrors the foreign-session budget). */
export const DIGEST_SUMMARY_CHARS = 200

/** Text suffixes worth reading; binary formats and media are skipped. */
const TEXT_SUFFIXES = ['.md', '.markdown', '.mdx', '.txt', '.text']

/** Whether a path points at a document this module can read. */
export function hasReadableText(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return TEXT_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

/** Title and summary taken from the head of one document. */
export interface FileDigest {
  readonly title?: string
  readonly summary: string
}

/**
 * Extract a card digest from the head of a text document: the first markdown
 * heading becomes the title, the first paragraph of prose becomes the summary.
 * @param text - the decoded head of the file (may be truncated mid-file).
 */
export function digestOfText(text: string): FileDigest {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let title: string | undefined
  let summary = ''
  let inFence = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || line === '') {
      if (summary !== '') break
      continue
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading !== null) {
      if (title === undefined) {
        title = clamp(heading[1] ?? '', DIGEST_TITLE_CHARS)
        continue
      }
      if (summary !== '') break
      continue
    }
    if (summary === '') {
      summary = clamp(stripMarkup(line), DIGEST_SUMMARY_CHARS)
      if (title !== undefined) break
      continue
    }
    break
  }
  if (title === undefined && summary !== '') title = clamp(summary, DIGEST_TITLE_CHARS)
  return title === undefined ? { summary } : { title, summary }
}

/**
 * Read the head of one written file and digest it. Best-effort: an unreadable
 * file, a binary suffix, or a path outside the project root yields undefined.
 * @param root - the project root the relative path is resolved against.
 * @param filePath - the path as carried in the tool arguments.
 */
export async function readFileDigest(root: string, filePath: string): Promise<FileDigest | undefined> {
  if (!hasReadableText(filePath)) return undefined
  const rootAbsolute = resolve(root)
  const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(rootAbsolute, filePath)
  const rel = relative(rootAbsolute, absolute)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(absolute, 'r')
    const buffer = Buffer.alloc(DIGEST_READ_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, DIGEST_READ_BYTES, 0)
    return digestOfText(buffer.subarray(0, bytesRead).toString('utf8'))
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** Drop the leading list/quote/emphasis markers a prose line may carry. */
function stripMarkup(line: string): string {
  return line
    .replace(/^[>#\-*+\d.\s]+/, '')
    .replace(/[*_`]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
}

function clamp(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= max ? collapsed : collapsed.slice(0, max)
}
