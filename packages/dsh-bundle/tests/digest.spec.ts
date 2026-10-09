/** File-head digests: a written document becomes a recallable card title/summary. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DIGEST_SUMMARY_CHARS, DIGEST_TITLE_CHARS, digestOfText, hasReadableText, readFileDigest,
} from '../src/digest.ts'

describe('hasReadableText', () => {
  it('accepts markdown and plain text', () => {
    expect(hasReadableText('docs/changes/plan.MD')).toBe(true)
    expect(hasReadableText('notes.txt')).toBe(true)
  })

  it('rejects binary and media suffixes', () => {
    expect(hasReadableText('deck.pptx')).toBe(false)
    expect(hasReadableText('cover.png')).toBe(false)
  })
})

describe('digestOfText', () => {
  it('takes the first heading as title and the first paragraph as summary', () => {
    const digest = digestOfText('# 会话图一直没有数据\n\n修好客户端解析与中文检索。\n\n## 细节\n更多。\n')
    expect(digest.title).toBe('会话图一直没有数据')
    expect(digest.summary).toBe('修好客户端解析与中文检索。')
  })

  it('falls back to the first paragraph as title when there is no heading', () => {
    const digest = digestOfText('这个项目的会话图没有数据，需要排查。\n第二行。\n')
    expect(digest.title).toBe('这个项目的会话图没有数据，需要排查。')
    expect(digest.summary).toBe('这个项目的会话图没有数据，需要排查。')
  })

  it('skips fenced code before the prose', () => {
    const digest = digestOfText('```ts\nconst a = 1\n```\n\n真正的说明文字。\n')
    expect(digest.summary).toBe('真正的说明文字。')
  })

  it('strips list and emphasis markup', () => {
    expect(digestOfText('- **重点** 说明').summary).toBe('重点 说明')
  })

  it('clamps title and summary budgets', () => {
    const digest = digestOfText(`# ${'标'.repeat(300)}\n\n${'文'.repeat(500)}`)
    expect(digest.title?.length).toBe(DIGEST_TITLE_CHARS)
    expect(digest.summary.length).toBe(DIGEST_SUMMARY_CHARS)
  })

  it('returns an empty digest for blank text', () => {
    expect(digestOfText('\n\n')).toEqual({ summary: '' })
  })
})

describe('readFileDigest', () => {
  it('reads a relative path under the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-digest-'))
    try {
      await writeFile(join(root, 'plan.md'), '# 方案\n\n先修检索。\n', 'utf8')
      expect(await readFileDigest(root, 'plan.md')).toEqual({ title: '方案', summary: '先修检索。' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses paths outside the project root and unreadable suffixes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-digest-'))
    try {
      expect(await readFileDigest(root, '../escape.md')).toBeUndefined()
      expect(await readFileDigest(root, 'deck.pptx')).toBeUndefined()
      expect(await readFileDigest(root, 'missing.md')).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
