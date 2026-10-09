/** `flywheel-index`: writes nodes/edges from runtime facts — project/session open,
 * file-producing tool results, claim rules on user+assistant text, and correction
 * supersede. Zero LLM on the hot path; claim flash is queued, never awaited. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  artifactId, changeNodeId, claimNodeId, claimSuffixOf, detectClaim,
  isSupersedeUtterance, projectNodeId, sessionNodeId, SUPERSEDE_RECENT_LIMIT,
  type NewEdge, type NodeRecord,
} from '@dsh-flywheel/core'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'
import { projectId, projectRoot } from './project.ts'
import { fileRolesOf, pathFromToolArgs } from './paths.ts'
import { readFileDigest } from './digest.ts'

export const name = 'flywheel-index'

export const inject = ['agents', FLYWHEEL_SERVICE]

/** Index writes are best-effort; an unhandled rejection is a fatal host exit. */
function background(ctx: Context, work: Promise<unknown>): void {
  void work.catch((error: unknown) => {
    ctx.logger?.warn?.(error)
  })
}

/** How many undigested file nodes one session-open backfill pass repairs. */
export const DIGEST_BACKFILL_LIMIT = 200

/** Project roots already repaired in this host process. */
const backfilledRoots = new Set<string>()

/**
 * Write graph edges through the mounted store. Repeated writes are idempotent —
 * the edge id is derived from src+rel+dst, and the store upserts by id.
 * @param flywheel - the host service.
 * @param edges - edges to record; skipped silently when no graph is mounted.
 */
async function linkEdges(flywheel: FlywheelService, edges: readonly NewEdge[]): Promise<void> {
  const graph = flywheel.graph()
  if (graph === undefined) return
  for (const edge of edges) {
    await graph.upsertEdge({ id: `${edge.src}:${edge.rel}:${edge.dst}`, ...edge, created_at: Date.now() })
  }
}

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel

  // `agent/created` is the live-agent hook in DSH 0.2.x (fresh / resume / clear
  // / compaction). The pre-0.2 name `agent/session-start` no longer fires — it
  // is absent from the installed DSH — so project and session nodes stopped
  // being written once the host moved to 0.2.
  ctx.on('agent/created', ({ agent }) => {
    try {
      const config = flywheel.config()
      if (!config.enabled) return
      const session = agent.session
      const id = projectId(session)
      const now = Date.now()
      background(ctx, Promise.all([
        upsertProjectNode(flywheel, id, now),
        upsertSessionNode(flywheel, id, session, now),
      ]))
      // Cards written before digests existed carry no recallable text; repair
      // them once per root so old sessions show up in the working set too.
      const root = projectRoot(session)
      if (!backfilledRoots.has(root)) {
        backfilledRoots.add(root)
        background(ctx, backfillDigests(flywheel, root, id))
      }
    } catch (error) {
      // Indexing must never veto agent publication (new session create).
      ctx.logger?.warn?.(error)
    }
  })

  // One written path → artifact (+PRODUCED edge) and/or a docs/changes change
  // node. The card digest is read once from the file head so the node carries a
  // real title/summary instead of only a basename (see `digest.ts`).
  ctx.on('tools/result', (exec, result) => {
    const config = flywheel.config()
    if (!config.enabled) return
    if (result.isError === true) return
    const path = writtenPath(exec.name, exec.arguments)
    if (path === undefined) return
    const posixPath = toPosixPath(path)
    if (claimSuffixOf(posixPath) === undefined && !posixPath.includes('docs/changes/')) return
    const session = exec.agent?.session
    background(ctx, ingestWrittenPath(flywheel, {
      path: posixPath, root: projectRoot(session), session,
    }))
  })

  // A read-class tool cites the artifact it opened, so the graph records which
  // session looked at which file (the same relation the graph tab lists).
  ctx.on('tools/result', (exec, result) => {
    const config = flywheel.config()
    if (!config.enabled) return
    if (result.isError === true) return
    if (!fileRolesOf(exec.name).includes('opened')) return
    const session = exec.agent?.session
    const sessionId = session?.id
    if (sessionId === undefined) return
    const path = pathFromToolArgs(exec.arguments)
    if (path === undefined) return
    const project = projectId(session)
    const target = artifactId(project, toPosixPath(path))
    const source = sessionNodeId(sessionId)
    background(ctx, (async () => {
      const graph = flywheel.graph()
      if (graph === undefined) return
      // Only link paths the flywheel already knows; otherwise the graph would
      // fill with dangling artifact nodes for every file the agent greps.
      if (await graph.getNode(target) === undefined) return
      await linkEdges(flywheel, [{ src: source, rel: 'CITES', dst: target }])
    })())
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
      id, type: 'claim', project_id: projectId(session), title: evidence.utterance.slice(0, 80),
      summary: '', body: evidence.utterance, status: 'active', session_id: session.id,
      extra: { utterance: evidence.utterance, purpose: evidence.purpose, extractor: 'generic' },
      updated_at: now,
    }))
    // Background flash rewrite; never awaited here (rule excerpt stays until it lands).
    flywheel.queueClaimExtract(id, session.id, projectId(session), evidence.utterance, [])
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
  const nodeId = sessionNodeId(session.id)
  await flywheel.ingest({
    id: nodeId, type: 'session', project_id: id, title,
    summary: '', body: '', status: 'active', session_id: session.id,
    extra: {}, updated_at: now,
  }, [{ src: nodeId, rel: 'IN_PROJECT', dst: projectNodeId(id) }])
}

async function supersedeRecent(flywheel: FlywheelService, session: Session): Promise<void> {
  const graph = flywheel.graph()
  if (graph === undefined) return
  const claims = await graph.recentActiveSessionNodes(session.id, 'claim', SUPERSEDE_RECENT_LIMIT)
  const changes = await graph.recentActiveSessionNodes(session.id, 'change', SUPERSEDE_RECENT_LIMIT)
  await graph.supersede([...claims, ...changes])
  // The status flip is what excludes them from recall; the edge records who
  // revoked them, which is what a graph view can draw.
  const source = sessionNodeId(session.id)
  await linkEdges(flywheel, [...claims, ...changes].map(dst => ({ src: source, rel: 'SUPERSEDES' as const, dst })))
}

/**
 * Give already-indexed artifact/change cards the digest they were written
 * without. Best-effort and bounded; unreadable files simply stay as they are.
 * @param flywheel - the host service (graph + lexical ingest).
 * @param root - project root the stored relative paths resolve against.
 * @param project - project id whose file nodes are repaired.
 */
async function backfillDigests(flywheel: FlywheelService, root: string, project: string): Promise<void> {
  const graph = flywheel.graph()
  if (graph === undefined) return
  const nodes = await graph.fileNodesNeedingDigest(project, DIGEST_BACKFILL_LIMIT)
  for (const node of nodes) {
    if (node.path === undefined) continue
    const digest = await readFileDigest(root, node.path)
    if (digest === undefined || digest.summary === '') continue
    await flywheel.ingest({
      ...node,
      title: digest.title ?? node.title,
      summary: digest.summary,
      updated_at: Date.now(),
    })
  }
}

/** One written path awaiting indexing. */
interface WrittenPath {
  readonly path: string
  /** Project root the relative path resolves against (also the digest read root). */
  readonly root: string
  readonly session: Session | undefined
}

/**
 * Index one written file: a claim-suffix path becomes an artifact with a
 * PRODUCED edge, a `docs/changes/` path becomes a change node, and both carry
 * the file-head digest so the card is recallable by its own words.
 * @param flywheel - the host service (graph + lexical ingest).
 * @param input - written path, project root, and owning session.
 */
async function ingestWrittenPath(flywheel: FlywheelService, input: WrittenPath): Promise<void> {
  const digest = await readFileDigest(input.root, input.path)
  const project = projectId(input.session)
  const sessionId = input.session?.id
  const now = Date.now()
  const title = digest?.title ?? basenameOf(input.path)
  const summary = digest?.summary ?? ''

  const suffix = claimSuffixOf(input.path)
  if (suffix !== undefined) {
    const id = artifactId(project, input.path)
    const artifact: NodeRecord = {
      id, type: 'artifact', project_id: project, title, summary, body: '',
      path: input.path, mime: mimeOf(suffix), status: 'active', extra: {}, updated_at: now,
    }
    if (sessionId !== undefined) artifact.session_id = sessionId
    const edges: NewEdge[] = [
      { src: id, rel: 'IN_PROJECT', dst: projectNodeId(project) },
    ]
    if (sessionId !== undefined) edges.push({ src: sessionNodeId(sessionId), rel: 'PRODUCED', dst: id })
    await flywheel.ingest(artifact, edges)
  }

  if (input.path.includes('docs/changes/')) {
    const id = changeNodeId(input.path)
    const node: NodeRecord = {
      id, type: 'change', project_id: project, title, summary,
      body: '', path: input.path, status: 'active', extra: {}, updated_at: now,
    }
    if (sessionId !== undefined) node.session_id = sessionId
    const edges: NewEdge[] = [
      { src: id, rel: 'IN_PROJECT', dst: projectNodeId(project) },
    ]
    if (sessionId !== undefined) edges.push({ src: sessionNodeId(sessionId), rel: 'PRODUCED', dst: id })
    await flywheel.ingest(node, edges)
  }
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
