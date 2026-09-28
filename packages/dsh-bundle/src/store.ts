/** `flywheel-store`: provides `ctx.flywheel` and keeps its config live through the
 * volatile settings form keyed by entry id `flywheel-store`. No sqlite import
 * here — the lexical/vector providers mount themselves (design §6.1). */

import { FiberState, type Context, type Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { validateFlywheelConfig } from '@dsh-flywheel/core'
import { Config, resolveConfig, type Config as FlywheelSettings } from './config.ts'
import { FLYWHEEL_PERSONA } from './persona.ts'
import { runClaimFlash } from './claim-flash-run.ts'
import {
  BackendNotMountedError, createFlywheelService, FLYWHEEL_SERVICE,
  type FlywheelService,
} from './service.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'flywheel-store'

/** No hard deps: settings is optional (falls back to cordis config). */
export const inject: string[] = []

export { Config }

/** The config `apply` receives from the composition layer (base, schema-defaulted). */
export type { FlywheelSettings }

/** Plain section, or the volatile reference DSH passes into `apply`. */
type LiveSection = FlywheelSettings | { get(): FlywheelSettings }

/** Read the current section. Volatile references update in place; plain objects do not. */
function readSection(config: LiveSection): FlywheelSettings {
  if (typeof config === 'object' && config !== null && 'get' in config && typeof config.get === 'function') {
    return config.get()
  }
  return config as FlywheelSettings
}

/**
 * Reject a settings write the schema accepts but flywheel will not run:
 * field rules, plus a backend that is not mounted. Runs only while the fiber
 * is already active, so the first activation is not blocked on providers
 * that mount after this plugin.
 */
function assertSavable(service: FlywheelService, raw: unknown): void {
  const parsed = Config(raw as FlywheelSettings)
  const resolved = resolveConfig(readSection(parsed as LiveSection))
  const fieldErrors = validateFlywheelConfig(resolved as unknown as Record<string, unknown>)
  if (fieldErrors.length > 0) {
    throw new TypeError(`flywheel: ${fieldErrors.map(error => `${error.field}: ${error.message}`).join('; ')}`)
  }
  if (!service.hasLexical(resolved.lexicalBackend)) {
    throw new BackendNotMountedError('lexical', resolved.lexicalBackend)
  }
  if (resolved.vectorBackend !== 'off' && !service.hasVector('cloud')) {
    throw new BackendNotMountedError('vector', 'cloud')
  }
}

/**
 * Register the settings page policy and provide `ctx.flywheel`. The composition
 * entry stays authoritative until a settings write commits into the volatile
 * config reference.
 */
export function apply(ctx: Context, config: LiveSection): void {
  const source = () => readSection(config)

  const service: FlywheelService = createFlywheelService({
    config: () => resolveConfig(source()),
    runClaimFlash: (claimId, sessionId, projectId, utterance, paths) =>
      runClaimFlash(ctx, service, claimId, sessionId, projectId, utterance, paths),
  })

  ctx.provide(FLYWHEEL_SERVICE, service)

  ctx.on('internal/config', function (this: Fiber, _raw: unknown, next: () => unknown) {
    const raw = next()
    if (this !== ctx.fiber || this.state !== FiberState.ACTIVE) return raw
    assertSavable(service, raw)
    return raw
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    // Late system section (not runtime context): DSH wraps context snapshots in
    // an English "Current runtime context…" envelope, and tool docs / harness
    // identity are English. Order 9900 sits after those so language rules win.
    promptCtx.systemPrompt.section({
      name: 'flywheel:persona',
      order: 9900,
      text: () => source().enabled === false ? '' : FLYWHEEL_PERSONA,
    })
  })

  ctx.inject(['settings'], (settingsCtx) => {
    // Custom page owns the section; the generated form would duplicate it.
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
