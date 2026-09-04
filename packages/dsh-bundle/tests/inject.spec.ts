/** Working-set chrome and collapsed Chat-row summaries follow the user script. */

import { describe, expect, it } from 'vitest'
import {
  queryUsesCjk, windowCompactNotice, workingSetChrome, workingSetNoticeSummary,
  missingPlanNotice,
} from '../src/notices.ts'
import { hasRecentPlanChange } from '../src/inject.ts'

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

describe('workingSetNoticeSummary', () => {
  it('names the card count in Chinese for a CJK sentence', () => {
    expect(workingSetNoticeSummary('换个需求', 8)).toBe('会话飞轮 · 8 张卡')
  })

  it('names the card count in English otherwise', () => {
    expect(workingSetNoticeSummary('switch topics', 3)).toBe('Session flywheel · 3 cards')
  })
})

describe('windowCompactNotice', () => {
  it('labels a CJK topic-switch compaction', () => {
    expect(windowCompactNotice('另外做 ACL').summary).toBe('会话飞轮 · 换题后压缩历史')
  })

  it('labels an English topic-switch compaction', () => {
    expect(windowCompactNotice('new requirement').summary).toContain('topic switch')
  })
})

describe('missingPlanNotice', () => {
  it('asks in Chinese to write docs/changes before implementing', () => {
    const notice = missingPlanNotice('开始实现刚才讨论的')
    expect(notice.summary).toContain('方案文件')
    expect(notice.text).toContain('docs/changes')
  })

  it('asks in English when the sentence has no CJK', () => {
    const notice = missingPlanNotice('start implementing')
    expect(notice.summary).toContain('plan file')
    expect(notice.text).toContain('docs/changes')
  })
})

describe('hasRecentPlanChange', () => {
  it('is false without a graph or without a docs/changes path', async () => {
    expect(await hasRecentPlanChange(undefined, 's1')).toBe(false)
    const graph = {
      recentActiveSessionNodes: async () => ['c1'],
      nodes: async () => new Map([['c1', { path: 'src/foo.ts' }]]),
    }
    expect(await hasRecentPlanChange(graph as never, 's1')).toBe(false)
  })

  it('is true when a recent change node lives under docs/changes', async () => {
    const graph = {
      recentActiveSessionNodes: async () => ['c1'],
      nodes: async () => new Map([['c1', { path: 'docs/changes/acl.md' }]]),
    }
    expect(await hasRecentPlanChange(graph as never, 's1')).toBe(true)
  })
})
