/** Project identity shared by the bundle plugins: root dir + project id.
 * Root precedence: `DSH_FLYWHEEL_ROOT` → the session's creation cwd → `process.cwd()`.
 * The Desktop app boots its host with cwd = the profile directory, so the session
 * cwd is the only per-project source there; a CLI/tui launch from a project dir
 * still resolves through the cwd fallback. v1 projectId is the root's basename,
 * so two roots sharing a basename share one project id. */

import { basename } from 'node:path'

/** The slice of a DSH session this module reads (`Session.header.cwd`), kept
 * structural so consumers need no `@deepseek-ai/dsh-session` import. */
export interface SessionWorkspace {
  readonly header?: { readonly cwd?: string } | undefined
}

export function projectRoot(session?: SessionWorkspace | undefined): string {
  const env = process.env.DSH_FLYWHEEL_ROOT
  if (env !== undefined && env.length > 0) return env
  const cwd = session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  return process.cwd()
}

export function projectId(session?: SessionWorkspace | undefined): string {
  return basename(projectRoot(session))
}
