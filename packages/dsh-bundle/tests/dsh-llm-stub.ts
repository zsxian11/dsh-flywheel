/** Vitest stand-in for `@deepseek-ai/dsh-llm`. The real package is a host peer. */

export function createUserMessage(input: Record<string, unknown>): Record<string, unknown> {
  return { role: 'user', id: 'test-message', ...input }
}
