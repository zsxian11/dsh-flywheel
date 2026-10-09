/** Indexer: written paths land as cards with file-head digests, and the project
 * graph gains its membership / produced / cites / supersede edges. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  artifactId, DEFAULT_CONFIG, projectNodeId, sessionNodeId,
  type EdgeRecord, type NodeRecord,
} from '@dsh-flywheel/core'
import { apply } from '../src/indexer.ts'

interface Recorded {
  readonly node: NodeRecord
  readonly edges: readonly { src: string; rel: string; dst: string }[]
}

type Handler = (first: unknown, second: unknown) => void

interface HarnessOptions {
  readonly enabled?: boolean
  readonly stale?: readonly NodeRecord[]
  readonly existing?: readonly NodeRecord[]
  readonly claimIds?: readonly string[]
  readonly changeIds?: readonly string[]
}

function harness(options: HarnessOptions = {}) {
  const handlers = new Map<string, Handler[]>()
  const ingested: Recorded[] = []
  const edges: EdgeRecord[] = []
  const ctx = {
    flywheel: {
      config: () => ({ ...DEFAULT_CONFIG, enabled: options.enabled ?? true }),
      ingest: async (node: NodeRecord, written: readonly { src: string; rel: string; dst: string }[] = []) => {
        ingested.push({ node, edges: written })
      },
      graph: () => ({
        fileNodesNeedingDigest: async (_project: string, limit: number) => (options.stale ?? []).slice(0, limit),
        getNode: async (id: string) => (options.existing ?? []).find(node => node.id === id),
        upsertEdge: async (edge: EdgeRecord) => { edges.push(edge) },
        recentActiveSessionNodes: async (_session: string, type: string, limit: number) =>
          (type === 'claim' ? options.claimIds ?? [] : options.changeIds ?? []).slice(0, limit),
        supersede: async () => {},
      }),
      queueClaimExtract: () => {},
    },
    // Cordis keeps every listener for one event; the harness must too, because
    // the indexer registers several `tools/result` handlers.
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    logger: { warn: () => {} },
  }
  apply(ctx as unknown as Context)
  const emit = (event: string, first?: unknown, second?: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(first, second)
  }
  return { emit, ingested, edges }
}

async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for background ingest')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function toolExec(root: string, name: string, args: unknown) {
  return { name, arguments: args, agent: { session: { id: 's1', header: { cwd: root } } } }
}

describe('flywheel-index tools/result', () => {
  it('gives a docs/changes write a card digest and membership edges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      await writeFile(join(root, 'plan.md'), '# 会话图无数据排查\n\n修好客户端解析与中文检索。\n', 'utf8')
      const { emit, ingested } = harness()
      emit('tools/result', toolExec(root, 'write', { file_path: 'plan.md' }), { isError: false })
      await waitFor(() => ingested.length >= 1)

      const artifact = ingested.find(item => item.node.type === 'artifact')
      expect(artifact?.node.title).toBe('会话图无数据排查')
      expect(artifact?.node.summary).toBe('修好客户端解析与中文检索。')
      expect(artifact?.node.project_id).toBe(basename(root))
      expect(artifact?.edges.map(edge => edge.rel).sort()).toEqual(['IN_PROJECT', 'PRODUCED'])
      expect(artifact?.edges.find(edge => edge.rel === 'IN_PROJECT')?.dst).toBe(projectNodeId(basename(root)))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('indexes arguments carried as model-produced JSON text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      await writeFile(join(root, 'plan.md'), '# 标题\n\n正文。\n', 'utf8')
      const { emit, ingested } = harness()
      emit('tools/result', toolExec(root, 'write', '{"file_path":"plan.md"}'), { isError: false })
      await waitFor(() => ingested.length >= 1)
      expect(ingested[0]?.node.summary).toBe('正文。')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the basename when the file head is not readable text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      await writeFile(join(root, 'deck.pptx'), 'binary-ish', 'utf8')
      const { emit, ingested } = harness()
      emit('tools/result', toolExec(root, 'write', { file_path: 'deck.pptx' }), { isError: false })
      await waitFor(() => ingested.length >= 1)
      expect(ingested[0]?.node.title).toBe('deck.pptx')
      expect(ingested[0]?.node.summary).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cites an already-indexed artifact when a read-class tool opens it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      const project = basename(root)
      const target = artifactId(project, 'src/a.ts')
      const { emit, edges } = harness({
        existing: [{
          id: target, type: 'artifact', project_id: project, title: 'a.ts',
          summary: '', body: '', path: 'src/a.ts', status: 'active', extra: {}, updated_at: 1,
        }],
      })
      emit('tools/result', toolExec(root, 'read', { file_path: 'src/a.ts' }), { isError: false })
      await waitFor(() => edges.length >= 1)
      expect(edges[0]?.rel).toBe('CITES')
      expect(edges[0]?.src).toBe(sessionNodeId('s1'))
      expect(edges[0]?.dst).toBe(target)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not cite a path the flywheel never indexed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      const { emit, edges } = harness()
      emit('tools/result', toolExec(root, 'read', { file_path: 'src/unknown.ts' }), { isError: false })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(edges).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes nothing while the flywheel is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      await writeFile(join(root, 'plan.md'), '# 标题\n', 'utf8')
      const { emit, ingested } = harness({ enabled: false })
      emit('tools/result', toolExec(root, 'write', { file_path: 'plan.md' }), { isError: false })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(ingested).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores a failed tool result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      const { emit, ingested } = harness()
      emit('tools/result', toolExec(root, 'write', { file_path: 'plan.md' }), { isError: true })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(ingested).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('flywheel-index corrections', () => {
  it('records who superseded the session cards it revokes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      const { emit, edges } = harness({ claimIds: ['clm:1'], changeIds: ['chg:1'] })
      emit('session/event', { id: 's1', header: { cwd: root } }, {
        type: 'user/message',
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: '不对，改成另一种口径' }] },
      })
      await waitFor(() => edges.length >= 2)
      expect(edges.map(edge => edge.rel)).toEqual(['SUPERSEDES', 'SUPERSEDES'])
      expect(edges.map(edge => edge.dst).sort()).toEqual(['chg:1', 'clm:1'])
      expect(edges[0]?.src).toBe(sessionNodeId('s1'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('flywheel-index digest backfill', () => {
  it('repairs an old card from the file head when a session opens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      await writeFile(join(root, 'plan.md'), '# 会话图无数据排查\n\n补上卡片正文。\n', 'utf8')
      const stale = {
        id: 'chg:1', type: 'change', project_id: basename(root), title: 'plan.md',
        summary: '', body: '', path: 'plan.md', status: 'active', extra: {}, updated_at: 1,
      } as NodeRecord
      const { emit, ingested } = harness({ stale: [stale] })
      emit('agent/created', { agent: { session: { id: 's1', header: { cwd: root } } } })
      await waitFor(() => ingested.some(item => item.node.id === 'chg:1'))

      const repaired = ingested.find(item => item.node.id === 'chg:1')?.node
      expect(repaired?.title).toBe('会话图无数据排查')
      expect(repaired?.summary).toBe('补上卡片正文。')
      expect(repaired?.status).toBe('active')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('marks a session as a member of its project when it opens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      const { emit, ingested } = harness()
      emit('agent/created', { agent: { session: { id: 's1', header: { cwd: root } } } })
      await waitFor(() => ingested.some(item => item.node.id === sessionNodeId('s1')))
      const session = ingested.find(item => item.node.id === sessionNodeId('s1'))
      expect(session?.edges).toEqual([{
        src: sessionNodeId('s1'), rel: 'IN_PROJECT', dst: projectNodeId(basename(root)),
      }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves a card alone when its file is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flywheel-index-'))
    try {
      const stale = {
        id: 'chg:missing', type: 'change', project_id: basename(root), title: 'gone.md',
        summary: '', body: '', path: 'gone.md', status: 'active', extra: {}, updated_at: 1,
      } as NodeRecord
      const { emit, ingested } = harness({ stale: [stale] })
      emit('agent/created', { agent: { session: { id: 's1', header: { cwd: root } } } })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(ingested.some(item => item.node.id === 'chg:missing')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
