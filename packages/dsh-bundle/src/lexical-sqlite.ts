/** `flywheel-lexical-sqlite`: mounts the v1 SQLite FTS5 + edges backend into
 * `ctx.flywheel`. The db path resolves against the session's project root. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { openSqliteFlywheelStore, registerSqliteFlywheel } from '@dsh-flywheel/lexical-sqlite'
import type { SqliteFlywheelStore } from '@dsh-flywheel/lexical-sqlite'
import { projectRoot } from './project.ts'
import { FLYWHEEL_SERVICE } from './service.ts'

export const name = 'flywheel-lexical-sqlite'

export const inject = [FLYWHEEL_SERVICE]

export function apply(ctx: Context): void {
  const flywheel = ctx.flywheel
  let store: SqliteFlywheelStore | undefined
  let dispose: (() => void) | undefined

  const openStore = async (): Promise<SqliteFlywheelStore> => {
    if (store !== undefined) return store
    store = await openSqliteFlywheelStore(join(projectRoot(), flywheel.config().dbRelativePath))
    dispose = registerSqliteFlywheel(flywheel, store)
    return store
  }

  // Open eagerly at apply so a missing/version-mismatched DB fails loud here.
  ctx.effect(() => {
    void openStore().catch(error => ctx.logger?.error?.(error))
    return () => { dispose?.() }
  }, 'flywheel-lexical-sqlite: store lifecycle')
}
