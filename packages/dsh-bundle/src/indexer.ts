/** `flywheel-index`: writes nodes/edges from runtime facts — project/session open,
 * file-producing tool results, claim rules on user+assistant text, and correction
 * supersede. Zero LLM on the hot path; claim flash is queued, never awaited. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  artifactId, changeNodeId, claimNodeId, claimSuffixOf, detectClaim,
  isSupersedeUtterance, projectNodeId, sessionNodeId, SUPERSEDE_RECENT_LIMIT,
  type NodeRecord,
} from '@dsh-flywheel/core'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'
import { projectId } from './project.ts'
import { pathFromToolArgs } from './paths.ts'

export const name = 'flywheel-index'

export const inject = ['agents', FLYWHEEL_SERVICE]

/** Index writes are best-effort; an unhandled rejection is a fatal host exit. */
function background(ctx: Context, work: Promise<unknown>): void {
  void work.catch((error: unknown) => {
    ctx.logger?.warn?.(error)
  })
}

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel

  ctx.on('agent/session-start', ({ agent }) => {
    try {
      const config = flywheel.config()
      if (!config.enabled) return
      const id = projectId()
      const session = agent.session
      const now = Date.now()
      background(ctx, Promise.all([
        upsertProjectNode(flywheel, id, now),
        upsertSessionNode(flywheel, id, session, now),
      ]))
    } catch (error) {
      // Indexing must never veto agent publication (new session create).
      ctx.logger?.warn?.(error)
    }
  })

  // File-producing tool results → artifact + PRODUCED edge (design §6.3).
  ctx.on('tools/result', (exec, result) => {
    const config = flywheel.config()
    if (!config.enabled) return
    if (result.isError === true) return
    const path = writtenPath(exec.name, exec.arguments)
    if (path === undefined) return
    const suffix = claimSuffixOf(path)
    if (suffix === undefined) return
    const id = artifactId(projectId(), toPosixPath(path))
    const sessionId = exec.agent?.session.id as string | undefined
    const artifact: NodeRecord = {
      id, type: 'artifact', project_id: projectId(), title: basenameOf(path),
      summary: '', body: '', path: toPosixPath(path), mime: mimeOf(suffix),
      status: 'active', extra: {}, updated_at: Date.now(),
    }
    if (sessionId !== undefined) artifact.session_id = sessionId
    const produced = { src: sessionNodeId(sessionId ?? ''), rel: 'PRODUCED' as const, dst: id }
    background(ctx, flywheel.ingest(artifact, [produced]))
  })

  // Claim rules on real user text + assistant text (queued; not awaited).
  ctx.on('session/event', (session, event) => {
    const config = flywheel.config()
    if (!config.enabled) return
    if (event.type !== 'user/message' && event.type !== 'assistant/message') return
    const data = event.data as { content?: unknown; source?: { kind?: string } }
    if (event.type === 'user/message' && data.source?.kind !== 'user') return
    const text = textOf(data.content)
    if (text === undefined || text === '') return

    // Correction: supersede this session's recent active claims/changes.
    if (event.type === 'user/message' && isSupersedeUtterance(text, config.supersedePattern)) {
      background(ctx, supersedeRecent(flywheel, session))
      return
    }

    const evidence = detectClaim(text)
    if (evidence === undefined) return
    const id = claimNodeId()
    const now = Date.now()
    background(ctx, flywheel.ingest({
      id, type: 'claim', project_id: projectId(), title: evidence.utterance.slice(0, 80),
      summary: '', body: evidence.utterance, status: 'active', session_id: session.id,
      extra: { utterance: evidence.utterance, purpose: evidence.purpose, extractor: 'generic' },
      updated_at: now,
    }))
    // Background flash rewrite; never awaited here (rule excerpt stays until it lands).
    flywheel.queueClaimExtract(id, session.id, projectId(), evidence.utterance, [])
  })

  // docs/changes/**/*.md writes become change nodes that SUPERSEDE the prior topic.
  ctx.on('tools/result', (exec, result) => {
    if (result.isError === true) return
    const path = writtenPath(exec.name, exec.arguments)
    if (path === undefined || !path.includes('docs/changes/')) return
    background(ctx, ingestChange(flywheel, path, exec.agent?.session.id))
  })
}

async function upsertProjectNode(flywheel: FlywheelService, id: string, now: number): Promise<void> {
  await flywheel.ingest({
    id: projectNodeId(id), type: 'project', project_id: id, title: id,
    summary: '', body: '', status: 'active', extra: {}, updated_at: now,
  })
}

async function upsertSessionNode(flywheel: FlywheelService, id: string, session: Session, now: number): Promise<void> {
  const title = sessionTitle(session)
  await flywheel.ingest({
    id: sessionNodeId(session.id), type: 'session', project_id: id, title,
    summary: '', body: '', status: 'active', session_id: session.id,
    extra: {}, updated_at: now,
  })
}

async function supersedeRecent(flywheel: FlywheelService, session: Session): Promise<void> {
  const graph = flywheel.graph()
  if (graph === undefined) return
  const claims = await graph.recentActiveSessionNodes(session.id, 'claim', SUPERSEDE_RECENT_LIMIT)
  const changes = await graph.recentActiveSessionNodes(session.id, 'change', SUPERSEDE_RECENT_LIMIT)
  await graph.supersede([...claims, ...changes])
}

async function ingestChange(flywheel: FlywheelService, path: string, sessionId: string | undefined): Promise<void> {
  const id = changeNodeId(toPosixPath(path))
  const node: NodeRecord = {
    id, type: 'change', project_id: projectId(), title: basenameOf(path),
    summary: '', body: '', path: toPosixPath(path), status: 'active',
    extra: {}, updated_at: Date.now(),
  }
  if (sessionId !== undefined) node.session_id = sessionId
  await flywheel.ingest(node)
}

/** Extract the written path from a tool's args when the tool name/args carry one. */
export function writtenPath(toolName: string, args: unknown): string | undefined {
  void toolName
  return pathFromToolArgs(args)
}

function textOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
    .map(block => block.text)
    .join('\n')
}

function sessionTitle(session: Session): string {
  return `session ${session.id}`
}

function basenameOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function mimeOf(suffix: string): string {
  switch (suffix) {
    case '.pptx': case '.ppt': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case '.xlsx': case '.xls': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.pdf': return 'application/pdf'
    case '.md': return 'text/markdown'
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.mp4': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    default: return 'application/octet-stream'
  }
}
