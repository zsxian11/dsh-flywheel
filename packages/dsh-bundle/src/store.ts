/** `flywheel-store`: registers the `flywheel` settings namespace, provides the
 * `ctx.flywheel` service, and hot-swaps providers on settings change. No sqlite
 * import here — the lexical/vector providers mount themselves (design §6.1). */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { validateFlywheelConfig } from '@dsh-flywheel/core'
import { Config, resolveConfig, type Config as FlywheelSettings } from './config.ts'
import { runClaimFlash } from './claim-flash-run.ts'
import {
  BackendNotMountedError, createFlywheelService, FLYWHEEL_SERVICE, FLYWHEEL_SETTINGS_NAMESPACE,
  type FlywheelService,
} from './service.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'flywheel-store'

/** No hard deps: settings is optional (falls back to cordis config). */
export const inject: string[] = []

export { Config }

/** The config `apply` receives from the composition layer (base, schema-defaulted). */
export type { FlywheelSettings }

/**
 * Register the namespace and provide `ctx.flywheel`. Without a settings provider
 * the composition entry stays authoritative (same fallback as bash / web-search).
 */
export function apply(ctx: Context, config: FlywheelSettings): void {
  // The live source. installSection swaps this to the settings scope when one attaches.
  let source: () => FlywheelSettings = () => config

  const service: FlywheelService = createFlywheelService({
    config: () => resolveConfig(source()),
    runClaimFlash: (claimId, sessionId, projectId, utterance, paths) =>
      runClaimFlash(ctx, service, claimId, sessionId, projectId, utterance, paths),
  })

  ctx.provide(FLYWHEEL_SERVICE, service)

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, FLYWHEEL_SETTINGS_NAMESPACE, Config, config, {
      setSource: (current) => { source = current },
      validate: (value) => {
        const resolved = resolveConfig(value)
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
      },
      onChange: () => {
        // Live re-read: consumers call `service.config()` each pre-step, so no
        // provider rebuild is required for K/maxChars. A backend switch is
        // rejected at write time, so a hot mount always stays consistent.
      },
    })
  })
}
