/** Stable node-id rules and the sha256 digest used for dedupe. Pure node:crypto. */

import { createHash, randomUUID } from 'node:crypto'

/** Build the stable artifact id for a project + posix path. */
export function artifactId(projectId: string, posixPath: string): string {
  return `art:${sha256Hex(`${projectId}\0${posixPath}`)}`
}

/** Project node id. */
export function projectNodeId(projectId: string): string {
  return `proj:${projectId}`
}

/** Session node id. */
export function sessionNodeId(sessionId: string): string {
  return `sess:${sessionId}`
}

/** Fresh claim node id. */
export function claimNodeId(): string {
  return `clm:${randomUUID()}`
}

/** Fresh change node id (or a path-stable id when sourced from docs/changes). */
export function changeNodeId(path?: string): string {
  if (path !== undefined) return `chg:${sha256Hex(path)}`
  return `chg:${randomUUID()}`
}

/** Fresh edge id. */
export function edgeId(): string {
  return randomUUID()
}

/** Hex sha256 of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Hex sha256 over an array of id strings, a query, and the lexical backend discriminator. */
export function retrievalDigest(sortedIds: readonly string[], query: string, lexicalBackend: string): string {
  return sha256Hex(`${sortedIds.join('|')}\0${query}\0${lexicalBackend}`)
}
