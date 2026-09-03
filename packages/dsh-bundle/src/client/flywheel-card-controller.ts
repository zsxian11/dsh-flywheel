/** Flywheel settings card controller: bridges the `flywheel` settings scope onto
 * the card's staged form. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FlywheelCardForm, type CardActions, type CardShell } from './card-form.ts'

/** Namespace spelled here, matching the Host store plugin. */
export const FLYWHEEL_NS = 'flywheel'

/** State the flywheel card renders. */
export interface FlywheelCardState extends CardShell {
  values: Record<string, string>
  overridden: Record<string, boolean>
}

/** The registration-side face the card's slot entry injects. */
export interface FlywheelCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useFlywheelCard. */
    flywheelCard: SnapshotStore<FlywheelCardState>
  }
}

/** Fields the card edits (flat view over the nested schema). */
const FIELD_KEYS = [
  'enabled', 'inject', 'tools', 'ftsK', 'hop', 'hopExtra', 'maxChars',
  'lexicalBackend', 'esNode', 'esIndexPrefix', 'esApiKey',
  'vectorBackend', 'vectorProvider', 'vectorModel', 'vectorK', 'embedQuery',
  'claimFlash', 'summarizationModel', 'mediaCaption',
  'windowCompact', 'windowPendingPattern', 'supersedePattern',
] as const

export class FlywheelCardController {
  private readonly form: FlywheelCardForm
  private readonly store: SnapshotStore<FlywheelCardState>

  constructor(scope: SettingsScope<Record<string, unknown>>) {
    this.form = new FlywheelCardForm(scope)
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): FlywheelCardState {
    const values: Record<string, string> = {}
    const overridden: Record<string, boolean> = {}
    for (const field of FIELD_KEYS) {
      values[field] = this.form.value(field)
      overridden[field] = this.form.overridden(field)
    }
    return { ...this.form.shell(), values, overridden }
  }

  inject(): FlywheelCardFace {
    return { hooks: { flywheelCard: this.store }, ...this.form.actions() }
  }
}
