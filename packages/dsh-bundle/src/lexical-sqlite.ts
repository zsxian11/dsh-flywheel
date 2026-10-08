/** `flywheel-lexical-sqlite`: mounts the v1 SQLite FTS5 + edges backend into
 * `ctx.flywheel`. The db path resolves against the session's project root, and
 * the store is re-targeted when a session names a different root. */

import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { openSqliteFlywheelStore, registerSqliteFlywheel } from '@dsh-flywheel/lexical-sqlite'
import { projectRoot } from './project.ts'
import { FLYWHEEL_SERVICE } from './service.ts'

export const name = 'flywheel-lexical-sqlite'

export const inject = [FLYWHEEL_SERVICE]

/**
 * Mount the sqlite backend, one project root at a time.
 *
 * The retrieval seam carries `projectId` on `search()` only, so the graph half
 * has no project context to route between several open databases with. The
 * backend therefore holds the store of the most recently created agent's
 * project root — which is the right one for the single-workspace desktop case —
 * and re-targets on `agent/created`. The eager mount below keeps
 * `hasLexical('sqlite-fts')` true before any session exists, so a settings save
 * right after boot is not rejected as "backend not mounted".
 * @param ctx - host context that already has `ctx.flywheel`.
 */
export async function apply(ctx: Context): Promise<void> {
  const flywheel = ctx.flywheel
  let active: { root: string; dispose: () => void } | undefined

  /** Open one store, or `undefined` when the database cannot be opened. */
  async function openStore(root: string): Promise<Awaited<ReturnType<typeof openSqliteFlywheelStore>> | undefined> {
    try {
      return await openSqliteFlywheelStore(join(root, flywheel.config().dbRelativePath))
    } catch (error: unknown) {
      // Opening the db must not fail the profile layer — that used to take down
      // session create for the whole Web host.
      ctx.logger?.warn?.(error)
      return undefined
    }
  }

  async function mount(root: string): Promise<void> {
    if (active?.root === root) return
    // Open before touching the live mount so a failure keeps the previous
    // database serving. The registry disposers delete by backend id, so the old
    // registration must be released *before* the replacement is added —
    // disposing it afterwards would delete the new entry (same `sqlite-fts` id).
    const store = await openStore(root)
    if (store === undefined) return
    active?.dispose()
    active = { root, dispose: registerSqliteFlywheel(flywheel, store) }
  }

  ctx.on('agent/created', ({ agent }) => {
    // Swallowed: an unhandled rejection here is a fatal host exit, and a failed
    // re-target must never take the session down.
    void mount(projectRoot(agent.session)).catch((error: unknown) => {
      ctx.logger?.warn?.(error)
    })
  })

  ctx.effect(() => () => {
    active?.dispose()
    active = undefined
  }, 'flywheel-lexical-sqlite: store lifecycle')

  await mount(projectRoot())
}
