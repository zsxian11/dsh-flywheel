/** Vitest stand-in for `@deepseek-ai/dsh-llm`. The real package is a host peer. */

export function boundContextSummary(summary: string): string {
  return summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`
}

export function createUserMessage(input: Record<string, unknown>): Record<string, unknown> {
  return { role: 'user', id: 'test-message', ...input }
}
