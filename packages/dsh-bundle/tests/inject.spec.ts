/** Working-set chrome follows the user sentence's script. */

import { describe, expect, it } from 'vitest'
import { queryUsesCjk, workingSetChrome } from '../src/inject.ts'

describe('workingSetChrome', () => {
  it('uses Chinese chrome when the user sentence contains CJK', () => {
    const chrome = workingSetChrome('把 ACL 方案写进文档')
    expect(queryUsesCjk('把 ACL 方案写进文档')).toBe(true)
    expect(chrome.title).toBe('## 会话飞轮工作集')
    expect(chrome.disclaimer).toContain('索引卡片')
  })

  it('uses English chrome when the user sentence has no CJK', () => {
    const chrome = workingSetChrome('Write the ACL plan into the docs')
    expect(queryUsesCjk('Write the ACL plan into the docs')).toBe(false)
    expect(chrome.title).toBe('## Flywheel working set')
    expect(chrome.disclaimer).toContain('Untrusted index cards')
  })
})
