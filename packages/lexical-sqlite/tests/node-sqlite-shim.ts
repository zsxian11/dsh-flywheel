/** Vitest-only bridge for the experimental `node:sqlite` module.
 *
 * Vite decides "builtin" from `module.builtinModules`, which does not list the
 * experimental `sqlite` entry, so it tries to resolve `node:sqlite` as a
 * package and fails. Aliasing that specifier to this file keeps the import in
 * CommonJS land, where the real builtin resolves. */

import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

const require_ = createRequire(import.meta.url)

/** Re-export of the real `node:sqlite` constructor. */
export const DatabaseSync = require_('node:sqlite').DatabaseSync as typeof DatabaseSyncType
