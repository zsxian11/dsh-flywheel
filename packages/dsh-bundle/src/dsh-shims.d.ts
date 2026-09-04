/** Isolated-build stubs for Host DSH packages that are not installed from npm.
 * This file is a script (no import/export) so the declarations define those
 * modules instead of trying to augment packages that are not in node_modules. */

declare module '@deepseek-ai/dsh-settings' {}

declare module '@deepseek-ai/dsh-compaction' {}

declare module '@deepseek-ai/dsh-system-prompt' {}

declare module '@deepseek-ai/dsh-session' {
  export type Session = {
    id: string
    append(type: string, data: unknown, opts?: { surfaceOp?: string }): unknown
    [key: string]: unknown
  }
  export function SessionId(id: string): string
}

declare module '@deepseek-ai/dsh-agent' {
  export type AgentRegistry = {
    get(id: string): unknown
  }
  export type PreStepDecision = {
    kind: string
    messages?: unknown[]
    [key: string]: unknown
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export type FinishReason = {
    kind: string
    failure?: { message: string; code?: string }
  }
  export type Message = unknown
  export type UserMessage = {
    role?: string
    content: Array<{ type: 'text'; text: string } | { type: string }>
    source: { kind?: string }
  }
  export type GenerateOptions = Record<string, unknown>
  export class BlockAssembler {
    push(chunk: unknown): void
    finish: FinishReason
    blocks(): Array<{ type: 'text'; text: string } | { type: string }>
  }
  export type LlmRuntime = {
    stream(options: GenerateOptions): AsyncIterable<unknown>
  }
  export function createUserMessage(input: unknown): UserMessage
}

declare module '@deepseek-ai/dsh-timeout' {
  export function deadline(
    upstream: AbortSignal | undefined,
    timeoutMs: number,
    code: string,
  ): Disposable & { signal: AbortSignal & { throwIfAborted(): void } }
}

declare module '@deepseek-ai/dsh-tools' {
  export type PostToolDecision = {
    kind: 'accept' | 'block' | string
    content?: Array<{ type: string; text?: string }>
    value?: unknown
    additionalContexts?: unknown
    [key: string]: unknown
  }
  export function defineTool(spec: {
    name: string
    description: string
    parameters: unknown
    output: unknown
    execute: (args: unknown) => unknown
    isConcurrencySafe?: boolean | (() => boolean)
  }): unknown
}
