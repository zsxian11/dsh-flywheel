/** Host-plane compaction lookup: Web isolates the engine per preset. */

import { describe, expect, it, vi } from 'vitest'
import { appendWindowCompactNotice, compactionOf, name, type CompactNow } from '../src/window.ts'

function ctxWith(services: Record<string, unknown>): { get(name: string): unknown } {
  return { get: (name: string) => services[name] }
}

const engine: CompactNow = { compactNow: async () => null }
const agent = { ctx: {} as never, session: { append: () => undefined } }

describe('compactionOf', () => {
  it('uses the host engine when the global store has one (TUI/headless)', () => {
    expect(compactionOf(ctxWith({ compaction: engine }) as never, agent)).toBe(engine)
  })

  it('falls back to the agent preset isolate (Web standard/ptc/cordis)', () => {
    const isolated: CompactNow = { compactNow: async () => null }
    const presets = {
      serviceFor: (_agent: { ctx: unknown }, name: string) => name === 'compaction' ? isolated : undefined,
    }
    expect(compactionOf(ctxWith({ agentPresets: presets }) as never, agent)).toBe(isolated)
  })

  it('prefers the host engine over a preset isolate', () => {
    const isolated: CompactNow = { compactNow: async () => null }
    const presets = { serviceFor: () => isolated }
    expect(compactionOf(ctxWith({ compaction: engine, agentPresets: presets }) as never, agent)).toBe(engine)
  })

  it('returns undefined when this agent has no engine (Web minimal)', () => {
    const presets = { serviceFor: () => undefined }
    expect(compactionOf(ctxWith({ agentPresets: presets }) as never, agent)).toBeUndefined()
    expect(compactionOf(ctxWith({}) as never, agent)).toBeUndefined()
  })
})

describe('appendWindowCompactNotice', () => {
  it('appends a surface notice after compact so Chat can show the topic-switch row', () => {
    const append = vi.fn()
    appendWindowCompactNotice({ append }, '另外做 ACL')
    expect(append).toHaveBeenCalledOnce()
    const [type, data, opts] = append.mock.calls[0]!
    expect(type).toBe('user/message')
    expect(opts).toEqual({ surfaceOp: 'append' })
    expect(data).toMatchObject({
      source: {
        kind: 'plugin',
        plugin: name,
        form: 'notice',
        summary: '会话飞轮 · 换题后压缩历史',
      },
    })
  })
})
