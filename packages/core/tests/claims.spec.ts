/** Claim rules + supersede/window heuristics (§7.2, §6.3, §6.4). */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { claimSuffixOf, detectClaim, isImplementUtterance, isPlanChangePath, isSupersedeUtterance, isWindowSwitchUtterance } from '../src/claims.ts'

describe('claim detection', () => {
  it('matches artifact suffixes', () => {
    expect(claimSuffixOf('reports/q3.pptx')).toBe('.pptx')
    expect(claimSuffixOf('sheet.xlsx')).toBe('.xlsx')
    expect(claimSuffixOf('code.ts')).toBeUndefined()
  })

  it('matches 生成/导出/制作 text rule', () => {
    expect(detectClaim('请生成一份 Q3 预算 PPT')?.rule).toBe('text-rule')
  })

  it('matches purpose deictic rule', () => {
    expect(detectClaim('这份文档是用来做季度汇报的')?.rule).toBe('purpose-rule')
  })

  it('matches 用途 marker', () => {
    expect(detectClaim('用途：给老板看')?.rule).toBe('usage-marker')
  })

  it('keeps excerpt ≤ 200 chars', () => {
    const long = `用途：${'字'.repeat(500)}`
    expect(detectClaim(long)?.utterance.length).toBeLessThanOrEqual(200)
  })
})

describe('heuristics', () => {
  it('supersede pattern from config', () => {
    expect(isSupersedeUtterance('这个不对，改成按季度', DEFAULT_CONFIG.supersedePattern)).toBe(true)
    expect(isSupersedeUtterance('作废上次的说法', DEFAULT_CONFIG.supersedePattern)).toBe(true)
    expect(isSupersedeUtterance('继续刚才的工作', DEFAULT_CONFIG.supersedePattern)).toBe(false)
  })

  it('window-switch pattern from config', () => {
    expect(isWindowSwitchUtterance('另外，帮我看看另一个需求', DEFAULT_CONFIG.windowPendingPattern)).toBe(true)
    expect(isWindowSwitchUtterance('开始实现刚才讨论的', DEFAULT_CONFIG.windowPendingPattern)).toBe(true)
  })

  it('implement-intent is a subset of the default window-switch pattern', () => {
    expect(isImplementUtterance('开始实现刚才讨论的')).toBe(true)
    expect(isImplementUtterance('开始写代码')).toBe(true)
    expect(isImplementUtterance('另外，帮我看看另一个需求')).toBe(false)
  })

  it('plan-change paths are docs/changes markdown', () => {
    expect(isPlanChangePath('docs/changes/acl.md')).toBe(true)
    expect(isPlanChangePath('src/foo.ts')).toBe(false)
    expect(isPlanChangePath(undefined)).toBe(false)
  })
})
