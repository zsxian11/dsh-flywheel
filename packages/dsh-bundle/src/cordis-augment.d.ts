/** Augment the installed `@deepseek-ai/cordis` Context with flywheel services.
 * This file is a module so `declare module` merges instead of replacing cordis. */

import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    flywheel: import('./service.ts').FlywheelService
    tools: { register(tool: unknown): unknown }
    settings: {
      configure(presentation: { auto?: boolean }, owner?: Context['fiber']): () => void
    }
    compaction?: {
      compactNow: (...args: unknown[]) => Promise<unknown> | unknown
      compactIfNeeded?: (...args: unknown[]) => Promise<unknown> | unknown
    }
    agentPresets?: {
      serviceFor(agent: { ctx: Context }, name: 'compaction'): Context['compaction']
    }
    systemPrompt: {
      section(spec: { name: string; order: number; text: string | (() => string) }): unknown
      context(spec: { name: string; order: number; text: string | (() => string) }): unknown
    }
  }
  interface Events {
    'agent/pre-step'(...args: any[]): any
    /** Fired for every live agent (fresh / resume / clear / compaction). DSH 0.2
     * renamed the pre-0.2 `agent/session-start` event to this one. */
    'agent/created'(...args: any[]): any
    'agent/turn-stopping'(...args: any[]): any
    'tools/result'(...args: any[]): any
    'tools/post-execute'(...args: any[]): any
    'session/event'(...args: any[]): any
  }
}
