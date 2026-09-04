import { describe, expect, it } from 'vitest'
import {
  flattenPlainText, stripReadSpillLocator, trimNotice, trimPlainText,
} from '../src/trim-text.ts'

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
