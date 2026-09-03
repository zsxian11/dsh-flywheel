/** `tool-flywheel`: three manual cross-session tools. Auto injection never calls
 * these; they are model-invocable on a `coding-search`-class preset only. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FLYWHEEL_SERVICE, type FlywheelService } from './service.ts'
import { projectId } from './project.ts'

export const name = 'tool-flywheel'

export const inject = ['tools', FLYWHEEL_SERVICE]

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/** Hard cap for `session_read` (design §6.5). */
const SESSION_READ_MAX_CHARS = 4000

export function apply(ctx: Context): void {
  const flywheel: FlywheelService = ctx.flywheel

  if (!flywheel.config().tools) return

  ctx.tools.register(defineTool({
    name: 'project_search',
    description: 'Search flywheel index cards (artifacts, claims, changes) for this project. Not a substitute for grep/glob/read on the repo.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text query; matched against node title/summary/body.' },
      limit: { type: 'integer', description: 'Max results. Defaults to 10.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const { query, limit } = args as { query: string; limit?: number }
      const graph = flywheel.graph()
      if (graph === undefined) return 'Flywheel index is not mounted.'
      const lexical = flywheel.lexical(flywheel.config().lexicalBackend)
      if (lexical === undefined) return 'Flywheel index is not mounted.'
      const hits = await lexical.search(query, { projectId: projectId(), k: limit ?? 10 })
      const nodes = await graph.nodes(hits.map(hit => hit.id))
      return renderNodes(nodes.values())
    },
    isConcurrencySafe: () => true,
  }))

  ctx.tools.register(defineTool({
    name: 'session_search',
    description: 'Search other sessions of this project by title/summary cards. Never returns transcripts. Not a substitute for in-repo grep.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text query.' },
      limit: { type: 'integer', description: 'Max results. Defaults to 10.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const { query, limit } = args as { query: string; limit?: number }
      const lexical = flywheel.lexical(flywheel.config().lexicalBackend)
      if (lexical === undefined) return 'Flywheel index is not mounted.'
      const graph = flywheel.graph()
      if (graph === undefined) return 'Flywheel index is not mounted.'
      const hits = await lexical.search(query, { projectId: projectId(), k: limit ?? 10 })
      const nodes = await graph.nodes(hits.map(hit => hit.id))
      const sessions = [...nodes.values()].filter(node => node.type === 'session')
      return renderNodes(sessions)
    },
    isConcurrencySafe: () => true,
  }))

  ctx.tools.register(defineTool({
    name: 'session_read',
    description: 'Read one session card (summary and recent claims). Never returns the raw transcript.',
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Target session id.' },
      claims: { type: 'integer', description: 'Max recent claims to include. Defaults to 3.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const { sessionId, claims } = args as { sessionId: string; claims?: number }
      const graph = flywheel.graph()
      if (graph === undefined) return 'Flywheel index is not mounted.'
      const node = await graph.getNode(`sess:${sessionId}`)
      if (node === undefined) return `No session card for ${sessionId}.`
      const claimIds = await graph.recentActiveSessionNodes(sessionId, 'claim', claims ?? 3)
      const claimNodes = await graph.nodes(claimIds)
      const head = `- [session] ${node.title}\n${node.summary}`.trim()
      const lines = [head, ...renderNodes(claimNodes.values()).split('\n').filter(line => line.length > 0)]
      return lines.join('\n').slice(0, SESSION_READ_MAX_CHARS)
    },
    isConcurrencySafe: () => true,
  }))
}

function renderNodes(nodes: Iterable<{ type: string; title: string; summary: string; path?: string }>): string {
  const lines: string[] = []
  for (const node of nodes) {
    lines.push(`- [${node.type}] ${node.title}${node.path ? ` (${node.path})` : ''}${node.summary ? ` — ${node.summary}` : ''}`)
  }
  return lines.join('\n')
}
