/** Zero-LLM claim detection (§7.2), correction/supersede heuristic (§6.3), and
 * window-switch heuristic (§6.4). All regex matching is case-insensitive Unicode. */

/** File suffixes that make an artifact claim-worthy when a tool writes them (§7.2). */
export const CLAIM_ARTIFACT_SUFFIXES: readonly string[] = [
  '.pptx', '.ppt', '.pdf', '.xlsx', '.xls', '.docx', '.md',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm',
]

/** Claim-verb + artifact-type co-occurrence (§7.2): 生成|导出|制作 AND PPT/PDF/表格/制度/封面/提示词/视频. */
export const CLAIM_TEXT_RE = /(生成|导出|制作)/u
export const CLAIM_ARTIFACT_RE = /(PPT|ppt|PDF|pdf|表格|制度|封面|提示词|视频)/u

/** Deictic purpose sentence pattern: 这份/该(文档|文件|PPT|PDF|表格) + 是|用于|用来. */
export const CLAIM_PURPOSE_RE = /这份|该\s*(文档|文件|PPT|PPTX|PDF|表格)\s*(是|用于|用来)/u

/** Explicit `用途:` marker. */
export const CLAIM_USAGE_MARK_RE = /用途\s*[:：]/u

/** Matched claim evidence extracted from one sentence, kept ≤200 chars (§7.2 rule excerpt). */
export interface ClaimEvidence {
  /** The matched sentence, truncated to the rule-excerpt budget. */
  utterance: string
  /** Initial purpose = the utterance itself until a flash model rewrites it. */
  purpose: string
  /** Regex discriminator that matched (kept for tests/trace only). */
  rule: 'artifact-suffix' | 'text-rule' | 'purpose-rule' | 'usage-marker'
}

/** Rule-excerpt budget for a claim body/purpose (§7.2: 命中句 ≤200 字). */
export const CLAIM_EXCERPT_MAX_CHARS = 200

/** Detect whether a written path triggers artifact claim ingestion. */
export function claimSuffixOf(path: string): string | undefined {
  const lower = path.toLowerCase()
  return CLAIM_ARTIFACT_SUFFIXES.find(suffix => lower.endsWith(suffix))
}

/** Detect claim-worthy text from a user utterance or assistant reply. Returns undefined when no rule fires. */
export function detectClaim(text: string): ClaimEvidence | undefined {
  const sentence = excerpt(sanitize(text))
  if (sentence === '') return undefined
  if (CLAIM_USAGE_MARK_RE.test(sentence)) return { utterance: sentence, purpose: sentence, rule: 'usage-marker' }
  if (CLAIM_PURPOSE_RE.test(sentence)) return { utterance: sentence, purpose: sentence, rule: 'purpose-rule' }
  if (CLAIM_TEXT_RE.test(sentence) && CLAIM_ARTIFACT_RE.test(sentence)) return { utterance: sentence, purpose: sentence, rule: 'text-rule' }
  return undefined
}

/** Correction heuristic (§6.3). The pattern comes from config.supersedePattern, not a constant. */
export function isSupersedeUtterance(text: string, pattern: string): boolean {
  return new RegExp(pattern, 'iu').test(sanitize(text))
}

/** Window-switch heuristic (§6.4). The pattern comes from config.windowPendingPattern. */
export function isWindowSwitchUtterance(text: string, pattern: string): boolean {
  return new RegExp(pattern, 'u').test(sanitize(text))
}

/** Implement-intent heuristic: user asked to start coding after a design discussion. */
export const IMPLEMENT_UTTERANCE_RE = /开始实现|开始写代码/u

/** Detect an implement-intent sentence that should look for a docs/changes plan file. */
export function isImplementUtterance(text: string): boolean {
  return IMPLEMENT_UTTERANCE_RE.test(sanitize(text))
}

/** Path fragment that makes a change node a durable plan file. */
export const PLAN_CHANGE_PATH = 'docs/changes/'

/** Whether a stored path is a flywheel plan-change file. */
export function isPlanChangePath(path: string | undefined): boolean {
  return path !== undefined && path.replace(/\\/g, '/').includes(PLAN_CHANGE_PATH)
}

/** How many recent change nodes to inspect for a docs/changes plan. */
export const PLAN_CHANGE_LOOKBACK = 8

/** Recent nodes to supersede on a correction: this session's last `limit` active claims/changes. */
export const SUPERSEDE_RECENT_LIMIT = 3

function sanitize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

function excerpt(text: string): string {
  return text.length <= CLAIM_EXCERPT_MAX_CHARS ? text : `${text.slice(0, CLAIM_EXCERPT_MAX_CHARS - 1)}…`
}
