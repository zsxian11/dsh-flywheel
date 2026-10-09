/** File paths carried in tool arguments, shared by the indexer and the graph fold. */

/**
 * Tool arguments as a plain object. Host-side `tools/result` hands over the
 * parsed object, while a session's `tool/call` event carries the model-produced
 * JSON **text** (`arguments: string`), so both shapes must be accepted.
 * @param args - parsed arguments object, or the raw JSON text of one.
 */
export function toolArgsObject(args: unknown): Record<string, unknown> | undefined {
  if (typeof args === 'string') {
    const text = args.trim()
    if (text === '') return undefined
    try {
      const parsed: unknown = JSON.parse(text)
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
    } catch {
      return undefined
    }
  }
  if (typeof args !== 'object' || args === null) return undefined
  return args as Record<string, unknown>
}

/** A workspace-relative path in a tool's JSON arguments, when one is present. */
export function pathFromToolArgs(args: unknown): string | undefined {
  const record = toolArgsObject(args)
  if (record === undefined) return undefined
  for (const key of ['file_path', 'path', 'filePath', 'to', 'destination']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0 && !value.startsWith('http')) return value.replace(/\\/g, '/')
  }
  return undefined
}

/** How a named tool contributes to the session-graph file lists. */
export type ToolFileRole = 'produced' | 'opened' | 'both'

/**
 * Classify a tool name for the session graph. Unknown names are omitted so
 * incidental tools with a path argument do not flood the tab.
 * @param toolName - the tool's registered name.
 */
export function toolFileRole(toolName: string): ToolFileRole | undefined {
  const name = toolName.toLowerCase()
  if (name === 'edit' || name === 'str_replace' || name === 'strreplace') return 'both'
  if (name === 'write' || name === 'create_file') return 'produced'
  if (name === 'read' || name === 'grep' || name === 'glob' || name === 'search') return 'opened'
  return undefined
}

/** The graph list memberships for one tool name. */
export function fileRolesOf(toolName: string): readonly ('produced' | 'opened')[] {
  const role = toolFileRole(toolName)
  if (role === 'both') return ['produced', 'opened']
  if (role === undefined) return []
  return [role]
}
