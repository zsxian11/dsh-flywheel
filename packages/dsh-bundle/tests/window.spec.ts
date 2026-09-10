/** Host-plane compaction lookup: Web isolates the engine per preset. */

import { describe, expect, it, vi } from 'vitest'
import {
  appendWindowCompactNotice, compactAtTurnStart, compactionOf, name, type CompactNow,
} from '../src/window.ts'

function ctxWith(services: Record<string, unknown>): { get(name: string): unknown } {
  return { get: (name: string) => services[name] }
}

const engine: CompactNow = { compactNow: async () => null }
const agent = { ctx: {} as never, session: { append: () => undefined } }
const signal = new AbortController().signal

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

  it('returns an engine that can expose compactIfNeeded', () => {
    const forced: CompactNow = {
      compactNow: async () => null,
      compactIfNeeded: async () => ({ ok: true }),
    }
    expect(compactionOf(ctxWith({ compaction: forced }) as never, agent)?.compactIfNeeded).toBeTypeOf('function')
  })

  it('returns undefined when this agent has no engine (Web minimal)', () => {
    const presets = { serviceFor: () => undefined }
    expect(compactionOf(ctxWith({ agentPresets: presets }) as never, agent)).toBeUndefined()
    expect(compactionOf(ctxWith({}) as never, agent)).toBeUndefined()
  })
})

describe('compactAtTurnStart', () => {
  it('returns null when the engine has no compactIfNeeded', async () => {
    expect(await compactAtTurnStart(engine, agent, signal)).toBeNull()
  })

  it('uses forced and does not call overflow when forced compacts', async () => {
    const compactIfNeeded = vi.fn(async (_agent: unknown, trigger: string) => (
      trigger === 'forced' ? { ok: true } : null
    ))
    const result = await compactAtTurnStart({ compactNow: async () => null, compactIfNeeded }, agent, signal)
    expect(result).toEqual({ ok: true })
    expect(compactIfNeeded).toHaveBeenCalledOnce()
    expect(compactIfNeeded.mock.calls[0]?.[1]).toBe('forced')
  })

  it('falls back to context-overflow when official DSH rejects forced', async () => {
    const compactIfNeeded = vi.fn(async (_agent: unknown, trigger: string) => {
      if (trigger === 'forced') throw new Error('unknown trigger')
      if (trigger === 'context-overflow') return { overflow: true }
      return null
    })
    const result = await compactAtTurnStart({ compactNow: async () => null, compactIfNeeded }, agent, signal)
    expect(result).toEqual({ overflow: true })
    expect(compactIfNeeded.mock.calls.map(call => call[1])).toEqual(['forced', 'context-overflow'])
  })

  it('falls back to context-overflow when forced is treated as pressure and returns null', async () => {
    const compactIfNeeded = vi.fn(async (_agent: unknown, trigger: string) => (
      trigger === 'context-overflow' ? { overflow: true } : null
    ))
    const result = await compactAtTurnStart({ compactNow: async () => null, compactIfNeeded }, agent, signal)
    expect(result).toEqual({ overflow: true })
    expect(compactIfNeeded.mock.calls.map(call => call[1])).toEqual(['forced', 'context-overflow'])
  })

  it('returns null when neither trigger compacts', async () => {
    const compactIfNeeded = vi.fn(async () => null)
    expect(await compactAtTurnStart({ compactNow: async () => null, compactIfNeeded }, agent, signal)).toBeNull()
    expect(compactIfNeeded).toHaveBeenCalledTimes(2)
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
    expect(data.source).not.toHaveProperty('cards')
    expect(data.source).not.toHaveProperty('sections')
  })
})
