/** Host-plane compaction lookup: Web isolates the engine per preset. */

import { describe, expect, it } from 'vitest'
import { compactionOf, type CompactNow } from '../src/window.ts'

function ctxWith(services: Record<string, unknown>): { get(name: string): unknown } {
  return { get: (name: string) => services[name] }
}

const engine: CompactNow = { compactNow: async () => null }
const agent = { ctx: {} as never }

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
