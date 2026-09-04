/** @dsh-flywheel/dsh-bundle — package root.
 *
 * Host plugins stay on subpath exports (store / lexical-sqlite / inject /
 * index / window / tools). This module is also the Loader row the Web client
 * scanner accepts: `dsh.client` is discovered only from a package-root
 * specifier, so the empty `apply` exists solely to make that row a plugin.
 * The schema object `Config` is not re-exported here — a root-row Config
 * would validate this plugin's own config, not the `flywheel` settings
 * namespace. */

export * from './service.ts'
export { resolveConfig, type Config } from './config.ts'
export * from './project.ts'
export * from './claim-flash.ts'
export * from './claim-flash-run.ts'
export * as flywheelStore from './store.ts'
export * as flywheelLexicalSqlite from './lexical-sqlite.ts'
export * as flywheelInject from './inject.ts'
export * as flywheelIndex from './indexer.ts'
export * as flywheelWindow from './window.ts'
export * as flywheelTrim from './trim.ts'
export * as toolFlywheel from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'flywheel-web'

/** Empty host body: the browser half is `exports["./client"]` + `dsh.client`. */
export function apply(): void {}
