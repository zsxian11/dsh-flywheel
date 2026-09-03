/** Project identity shared by the bundle plugins: root dir + project id.
 * v1: root = DSH_FLYWHEEL_ROOT ?? process.cwd(); projectId = basename(root).
 * The design's git-toplevel refinement and `.dsh/project.yml` override plug in here. */

import { basename } from 'node:path'

export function projectRoot(): string {
  const env = process.env.DSH_FLYWHEEL_ROOT
  if (env !== undefined && env.length > 0) return env
  return process.cwd()
}

export function projectId(): string {
  return basename(projectRoot())
}
