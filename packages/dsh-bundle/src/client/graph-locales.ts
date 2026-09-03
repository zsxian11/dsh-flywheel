/** Locale dictionaries for the session-graph conversation tab. */

export type GraphLocaleKey =
  | 'viewLabel'
  | 'empty'
  | 'emptyHint'
  | 'workingSet'
  | 'produced'
  | 'opened'
  | 'loadOlder'
  | 'sessionNode'

export const graphEn: Record<GraphLocaleKey, string> = {
  viewLabel: 'Session graph',
  empty: 'No citations in the loaded history yet.',
  emptyHint: 'Working-set cards, files this session wrote, and files it opened with read / grep / edit appear here.',
  workingSet: 'Working set for this turn',
  produced: 'Written this session',
  opened: 'Opened this session',
  loadOlder: 'Load earlier history',
  sessionNode: 'This session',
}

export const graphZh: Record<GraphLocaleKey, string> = {
  viewLabel: '会话图',
  empty: '已加载的历史里还没有引用。',
  emptyHint: '本轮工作集卡片、本会话写出的文件、以及 read / grep / edit 打开过的路径会列在这里。',
  workingSet: '本轮工作集',
  produced: '本会话写出',
  opened: '本会话读过',
  loadOlder: '加载更早记录',
  sessionNode: '本会话',
}
