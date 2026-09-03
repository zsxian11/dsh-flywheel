/** Claim-flash pure helpers (§7.3): parsing/validating the model's JSON output and
 * resolving the auxiliary route. No DSH runtime import, so the LLM boundary is
 * unit-testable without a model. */

/** Claim kind discriminants the model may return (§7.3). */
export const CLAIM_KINDS = ['ppt', 'pdf', 'sheet', 'doc', 'image', 'video', 'code', 'other'] as const
export type ClaimKind = typeof CLAIM_KINDS[number]

/** Parsed + validated flash output. */
export interface ClaimFlashResult {
  /** Purpose sentence, ≤80 chars. */
  purpose: string
  /** Bound artifact path, or null when the claim does not name a file. */
  path: string | null
  kind: ClaimKind
}

/** Claim purpose budget (§7.3). */
export const CLAIM_PURPOSE_MAX_CHARS = 80

/** Structural slice of an Agent the flash route needs; the real Agent satisfies it. */
export interface FlashRouteAgent {
  session: { requestHeader(): { config?: { provider?: string } } | undefined }
  options: { provider?: string }
}

/**
 * Parse and validate the model's JSON output. Returns undefined on any malformed
 * or out-of-contract value, so the caller keeps the rule excerpt.
 */
export function parseClaimFlash(text: string): ClaimFlashResult | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const purpose = record['purpose']
  if (typeof purpose !== 'string' || purpose.length === 0 || purpose.length > CLAIM_PURPOSE_MAX_CHARS) return undefined
  const path = record['path']
  if (path !== null && typeof path !== 'string') return undefined
  const kind = record['kind']
  if (typeof kind !== 'string' || !(CLAIM_KINDS as readonly string[]).includes(kind)) return undefined
  return { purpose, path: path as string | null, kind: kind as ClaimKind }
}

/**
 * Resolve the auxiliary route: provider follows the session's routed config
 * (falling back to the agent's own option), model is fixed to the flywheel
 * `summarizationModel`. Returns undefined when either side is absent, so the
 * caller keeps the rule excerpt instead of touching the main conversation model.
 */
export function resolveFlashRoute(
  agent: FlashRouteAgent | undefined,
  summarizationModel: string,
): { provider: string; model: string } | undefined {
  if (summarizationModel.length === 0) return undefined
  const provider = agent?.session.requestHeader()?.config?.provider
    ?? agent?.options.provider
  if (provider === undefined || provider.length === 0) return undefined
  return { provider, model: summarizationModel }
}
