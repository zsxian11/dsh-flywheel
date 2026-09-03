/** `flywheel-lexical-sqlite`: mounts the v1 SQLite FTS5 + edges backend into
 * `ctx.flywheel`. The db path resolves against the session's project root. */

import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { openSqliteFlywheelStore, registerSqliteFlywheel } from '@dsh-flywheel/lexical-sqlite'
import { projectRoot } from './project.ts'
import { FLYWHEEL_SERVICE } from './service.ts'

export const name = 'flywheel-lexical-sqlite'

export const inject = [FLYWHEEL_SERVICE]

/**
 * Open and register the sqlite backend before this fiber becomes ACTIVE.
 * @param ctx - host context that already has `ctx.flywheel`.
 */
export async function apply(ctx: Context): Promise<void> {
  const flywheel = ctx.flywheel
  const store = await openSqliteFlywheelStore(join(projectRoot(), flywheel.config().dbRelativePath))
  const dispose = registerSqliteFlywheel(flywheel, store)
  ctx.effect(() => () => {
    dispose()
  }, 'flywheel-lexical-sqlite: store lifecycle')
}
