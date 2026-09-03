/** Claim-flash runner (§7.3): one background auxiliary `ctx.llm.stream` call that
 * rewrites a rule-matched purpose sentence into `{ purpose ≤80, path, kind }`.
 * Never awaited in pre-step; any failure keeps the rule excerpt. Mirrors
 * session-title-llm's stream + `deadline` mechanism. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler, createUserMessage, LlmRuntime,
  type FinishReason, type GenerateOptions, type Message,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { artifactId } from '@dsh-flywheel/core'
import { parseClaimFlash, resolveFlashRoute } from './claim-flash.ts'
import type { FlywheelService } from './service.ts'

/** Auxiliary request deadline (design §6.3: flash 超时 8s). */
export const CLAIM_FLASH_TIMEOUT_MS = 8000
export const CLAIM_FLASH_TIMEOUT_CODE = 'FLYWHEEL_CLAIM_FLASH_TIMEOUT'

/** System instruction: return exactly one JSON object, no prose. */
function systemPrompt(): string {
  return [
    'Rewrite the supplied user sentence into a short artifact purpose.',
    'Return ONLY one JSON object with these keys:',
    '- purpose: string, at most 80 characters, describing what this document/file is FOR.',
    '- path: the file path it refers to, or null when the sentence names no file.',
    '- kind: one of ppt | pdf | sheet | doc | image | video | code | other.',
    'Do not add Markdown, code fences, explanation, or any other text.',
  ].join('\n')
}

/** Frame the matched sentence and this turn's written paths as a JSON user message. */
function frameInput(utterance: string, paths: readonly string[]): string {
  return JSON.stringify({ utterance, paths })
}

/** Map a terminal finish reason to a throw-away failure (keep rule excerpt). */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('flywheel claim flash: output reached the token cap')
    case 'tool-calls':
      return new Error('flywheel claim flash: model unexpectedly requested a tool')
    default:
      return new Error(`flywheel claim flash: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/**
 * Run one claim flash and, on success, update the claim node (purpose/kind) and
 * attach a DESCRIBES edge to the bound artifact. Never throws: the rule excerpt
 * was already ingested, so a failed or absent flash leaves it authoritative.
 */
export async function runClaimFlash(
  ctx: Context,
  service: FlywheelService,
  claimId: string,
  sessionId: string,
  projectId: string,
  utterance: string,
  paths: readonly string[],
): Promise<void> {
  try {
    await flashOnce(ctx, service, claimId, sessionId, projectId, utterance, paths)
  } catch {
    // Timeout, provider failure, or malformed output: the rule excerpt stays authoritative.
  }
}

async function flashOnce(
  ctx: Context,
  service: FlywheelService,
  claimId: string,
  sessionId: string,
  projectId: string,
  utterance: string,
  paths: readonly string[],
): Promise<void> {
  const config = service.config()
  if (!config.claimFlash) return
  const llm = ctx.get('llm') as LlmRuntime | undefined
  if (llm === undefined) return
  const agent = (ctx.get('agents') as AgentRegistry | undefined)?.get(SessionId(sessionId))
  const route = resolveFlashRoute(agent, config.summarizationModel)
  if (route === undefined) return

  const framed = frameInput(utterance, paths)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: framed }],
    source: { kind: 'plugin', plugin: 'flywheel-store', form: 'snapshot', sections: [{ name: 'flywheel-store', text: framed }] },
  })]
  using callDeadline = deadline(undefined, CLAIM_FLASH_TIMEOUT_MS, CLAIM_FLASH_TIMEOUT_CODE)
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages,
    system: systemPrompt(),
    maxTokens: 256,
    signal: callDeadline.signal,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream(options)) {
    callDeadline.signal.throwIfAborted()
    assembler.push(chunk)
  }
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) return
  const text = assembler.blocks()
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
  const parsed = parseClaimFlash(text)
  if (parsed === undefined) return

  const graph = service.graph()
  if (graph === undefined) return
  const node = await graph.getNode(claimId)
  if (node === undefined || node.status !== 'active') return

  // Bind the purpose to its artifact when the model names a path.
  const posixPath = parsed.path === null ? undefined : toPosixPath(parsed.path)
  const artifact = posixPath === undefined ? undefined : {
    id: artifactId(projectId, posixPath),
    type: 'artifact' as const,
    project_id: projectId,
    title: basenameOf(posixPath),
    summary: '',
    body: '',
    path: posixPath,
    status: 'active' as const,
    session_id: node.session_id,
    extra: {},
    updated_at: Date.now(),
  }
  await service.ingest(
    { ...node, extra: { ...node.extra, purpose: parsed.purpose, kind: parsed.kind } },
    artifact === undefined
      ? []
      : [{ src: claimId, rel: 'DESCRIBES', dst: artifact.id }],
  )
  if (artifact !== undefined) await service.ingest(artifact)
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function basenameOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}
