/** Project-root resolution and the session-open hook.
 *
 * Both regressions this covers were live against DSH 0.2.x: `projectRoot()`
 * fell back to `process.cwd()` (the profile directory in the Desktop app, so
 * every workspace shared one index), and `flywheel-index` still listened for
 * the pre-0.2 `agent/session-start` event, which no longer fires, so project
 * and session nodes stopped being written. */

import { afterEach, describe, expect, it } from 'vitest'
import { projectId, projectRoot } from '../src/project.ts'
import { apply, name } from '../src/indexer.ts'

const ENV = 'DSH_FLYWHEEL_ROOT'
const originalEnv = process.env[ENV]

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV]
  else process.env[ENV] = originalEnv
})

describe('projectRoot', () => {
  it('prefers the explicit DSH_FLYWHEEL_ROOT override over the session', () => {
    process.env[ENV] = '/override/root'
    expect(projectRoot({ header: { cwd: '/session/root' } })).toBe('/override/root')
    expect(projectId({ header: { cwd: '/session/root' } })).toBe('root')
  })

  it('uses the session cwd when no override is set', () => {
    delete process.env[ENV]
    expect(projectRoot({ header: { cwd: '/Users/me/proj-a' } })).toBe('/Users/me/proj-a')
    expect(projectId({ header: { cwd: '/Users/me/proj-a' } })).toBe('proj-a')
  })

  it('falls back to process.cwd() without a session or session cwd', () => {
    delete process.env[ENV]
    expect(projectRoot()).toBe(process.cwd())
    expect(projectRoot({})).toBe(process.cwd())
    expect(projectRoot({ header: {} })).toBe(process.cwd())
    expect(projectRoot({ header: { cwd: '' } })).toBe(process.cwd())
  })
})

describe('flywheel-index session open', () => {
  it('subscribes to the real DSH hook agent/created', () => {
    const { listeners } = harness()
    expect(listeners.has('agent/created')).toBe(true)
    expect(listeners.has('agent/session-start')).toBe(false)
  })

  it('writes project and session nodes against the session workspace project id', async () => {
    const { listeners, ingested } = harness()
    listeners.get('agent/created')!({ agent: { session: { id: 'session-1', header: { cwd: '/work/proj-a' } } } })
    await flush()

    const byType = new Map(ingested.map(node => [node.type, node]))
    expect(byType.get('project')?.project_id).toBe('proj-a')
    expect(byType.get('session')?.project_id).toBe('proj-a')
    expect(byType.get('session')?.session_id).toBe('session-1')
  })
})

/** Minimal host/agent doubles: the indexer touches only these members. */
function harness(): {
  listeners: Map<string, (payload: unknown) => void>
  ingested: Array<Record<string, unknown>>
} {
  const listeners = new Map<string, (payload: unknown) => void>()
  const ingested: Array<Record<string, unknown>> = []
  const flywheel = {
    config: () => ({ enabled: true }),
    ingest: async (node: Record<string, unknown>) => { ingested.push(node) },
    graph: () => undefined,
    queueClaimExtract: () => undefined,
  }
  const ctx = {
    flywheel,
    on: (event: string, listener: (payload: unknown) => void) => { listeners.set(event, listener) },
    logger: { warn: () => undefined },
  }
  expect(name).toBe('flywheel-index')
  apply(ctx as never)
  return { listeners, ingested }
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
