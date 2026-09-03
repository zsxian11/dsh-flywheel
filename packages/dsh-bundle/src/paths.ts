/** File paths carried in tool arguments, shared by the indexer and the graph fold. */

/** A workspace-relative path in a tool's JSON arguments, when one is present. */
export function pathFromToolArgs(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
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
