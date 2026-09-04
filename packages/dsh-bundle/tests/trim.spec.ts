import { describe, expect, it } from 'vitest'
import {
  flattenPlainText, stripReadSpillLocator, trimNotice, trimPlainText, trimReadWindow,
} from '../src/trim-text.ts'
import { trimAcceptedDecision } from '../src/trim.ts'

describe('trimPlainText', () => {
  it('leaves short results untouched', () => {
    expect(trimPlainText('hello', 8000, 'read')).toBeUndefined()
  })

  it('bounds a long read under the char cap and tells the model to offset-read', () => {
    const source = 'A'.repeat(20_000)
    const replaced = trimPlainText(source, 8000, 'read')
    expect(replaced).toBeDefined()
    expect(replaced!.length).toBeLessThanOrEqual(8000)
    expect(replaced!.length).toBeLessThan(source.length)
    expect(replaced).toContain('Re-read the original path with offset/limit')
    expect(replaced!.startsWith('A')).toBe(true)
    expect(replaced!.endsWith('A')).toBe(true)
  })

  it('uses a narrower-call hint for non-read tools', () => {
    const replaced = trimPlainText('B'.repeat(5000), 2000, 'grep')
    expect(replaced).toContain('Narrow the same tool call')
    expect(replaced).not.toContain('offset/limit')
  })

  it('returns undefined when the notice alone cannot fit', () => {
    expect(trimPlainText('C'.repeat(100), 20, 'read')).toBeUndefined()
  })
})

describe('trimNotice', () => {
  it('prices omitted digits into a stable read hint', () => {
    expect(trimNotice(12345, 'read')).toBe(
      '[... flywheel truncated; 12345 chars omitted. Re-read the original path with offset/limit for the omitted middle.]',
    )
  })
})

describe('flattenPlainText', () => {
  it('joins text blocks', () => {
    expect(flattenPlainText([{ type: 'text', text: 'ab' }, { type: 'text', text: 'cd' }])).toBe('abcd')
  })

  it('rejects rich content', () => {
    expect(flattenPlainText([{ type: 'image' }])).toBeUndefined()
  })
})

describe('trimReadWindow', () => {
  it('leaves a short window untouched', () => {
    expect(trimReadWindow({
      path: 'a.ts', offset: 1, totalLines: 2,
      lines: [{ number: 1, text: 'a' }, { number: 2, text: 'b' }],
    }, 8000)).toBeUndefined()
  })

  it('drops middle lines and tells the model to offset-read', () => {
    const lines = Array.from({ length: 200 }, (_, index) => ({
      number: index + 1,
      text: 'X'.repeat(40),
    }))
    const trimmed = trimReadWindow({ path: 'src/big.ts', offset: 1, totalLines: 200, lines }, 400)
    expect(trimmed).toBeDefined()
    expect(trimmed!.lines.length).toBeLessThan(200)
    expect(trimmed!.lines.some(line => line.text.includes('flywheel truncated'))).toBe(true)
    expect(trimmed!.path).toBe('src/big.ts')
    expect(trimmed!.totalLines).toBe(200)
  })
})

describe('trimAcceptedDecision', () => {
  it('replaces a huge read via canonical value so UI meta is rebuilt', () => {
    const lines = Array.from({ length: 80 }, (_, index) => ({
      number: index + 1,
      text: 'Y'.repeat(80),
    }))
    const decision = trimAcceptedDecision(
      { kind: 'accept' },
      { value: { path: 'lib/a.ts', offset: 1, totalLines: 80, lines } },
      { name: 'read' },
      500,
    )
    expect(decision).toMatchObject({ kind: 'accept' })
    expect(decision).toHaveProperty('value')
    expect(decision).not.toHaveProperty('content')
    const value = (decision as { value: { lines: unknown[] } }).value
    expect(value.lines.length).toBeLessThan(80)
  })

  it('still trims parented calls and plain-text tools', () => {
    const decision = trimAcceptedDecision(
      { kind: 'accept' },
      { content: [{ type: 'text', text: 'Z'.repeat(5000) }] },
      { name: 'grep', parent: { name: 'run_code' } },
      2000,
    )
    expect(decision).toMatchObject({ kind: 'accept' })
    expect((decision as { content: { text: string }[] }).content[0]!.text).toContain('flywheel truncated')
  })

  it('uses a decision-supplied read value over the original result', () => {
    const lines = Array.from({ length: 40 }, (_, index) => ({
      number: index + 1,
      text: 'W'.repeat(80),
    }))
    const decision = trimAcceptedDecision(
      { kind: 'accept', value: { path: 'lib/b.ts', offset: 1, totalLines: 40, lines } },
      { value: { path: 'ignored.ts', offset: 1, totalLines: 1, lines: [{ number: 1, text: 'short' }] } },
      { name: 'read' },
      400,
    )
    expect(decision).toHaveProperty('value')
    const value = (decision as { value: { path: string; lines: unknown[] } }).value
    expect(value.path).toBe('lib/b.ts')
    expect(value.lines.length).toBeLessThan(40)
  })
})

describe('stripReadSpillLocator', () => {
  it('leaves ordinary read results untouched', () => {
    expect(stripReadSpillLocator('export const x = 1')).toBeUndefined()
  })

  it('removes the official spill locator so the model cannot read the spill file', () => {
    const spilled = [
      'head of the file',
      '(Omitted 50000 bytes. Full formatted result stored at: /tmp/dsh/session-1/read-ab.txt. Use read with offset/limit, or grep this path to search within it.)',
    ].join('\n')
    const rewritten = stripReadSpillLocator(spilled)
    expect(rewritten).toContain('head of the file')
    expect(rewritten).toContain('Re-read the original path with offset/limit')
    expect(rewritten).not.toContain('Full formatted result stored at:')
    expect(rewritten).not.toContain('/tmp/dsh/session-1/read-ab.txt')
  })
})
