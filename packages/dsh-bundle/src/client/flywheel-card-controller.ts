/** Flywheel settings card controller: bridges the `flywheel` settings scope onto
 * the card's staged form. Nested elasticsearch / vector fields keep their
 * schema paths; the card ids stay flat for the renderer. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  booleanField, enumField, FlywheelCardForm, numberField, textField,
  type CardActions, type CardShell,
} from './card-form.ts'

/** Namespace spelled here, matching the Host store plugin. */
export const FLYWHEEL_NS = 'flywheel'

/** State the flywheel card renders. */
export interface FlywheelCardState extends CardShell {
  values: Record<string, string>
  overridden: Record<string, boolean>
  invalid: Record<string, boolean>
}

/** The registration-side face the card's slot entry injects. */
export interface FlywheelCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useFlywheelCard. */
    flywheelCard: SnapshotStore<FlywheelCardState>
  }
}

const SPECS = [
  booleanField('enabled'),
  booleanField('inject'),
  booleanField('tools'),
  numberField('ftsK', { min: 1 }),
  numberField('hop', { min: 1, max: 1 }),
  numberField('hopExtra', { min: 0 }),
  numberField('maxChars', { min: 500, max: 8000 }),
  enumField('lexicalBackend', ['sqlite-fts', 'elasticsearch']),
  textField('esNode', ['elasticsearch', 'node']),
  textField('esIndexPrefix', ['elasticsearch', 'indexPrefix']),
  enumField('vectorBackend', ['off', 'cloud']),
  textField('vectorProvider', ['vector', 'provider']),
  textField('vectorModel', ['vector', 'model']),
  numberField('vectorK', { path: ['vector', 'vectorK'], min: 1 }),
  booleanField('embedQuery', ['vector', 'embedQuery']),
  booleanField('claimFlash'),
  textField('summarizationModel'),
  booleanField('mediaCaption'),
  booleanField('windowCompact'),
  textField('windowPendingPattern'),
  textField('supersedePattern'),
]

const SECRETS = [{ field: 'esApiKey', path: ['elasticsearch', 'apiKey'] }]

const FIELD_KEYS = [...SPECS.map(spec => spec.field), ...SECRETS.map(spec => spec.field)] as const

export class FlywheelCardController {
  private readonly form: FlywheelCardForm
  private readonly store: SnapshotStore<FlywheelCardState>

  constructor(scope: SettingsScope<Record<string, unknown>>) {
    this.form = new FlywheelCardForm(scope, SPECS, SECRETS)
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): FlywheelCardState {
    const values: Record<string, string> = {}
    const overridden: Record<string, boolean> = {}
    const invalid: Record<string, boolean> = {}
    for (const field of FIELD_KEYS) {
      const state = this.form.field(field)
      values[field] = state.text
      overridden[field] = state.overridden
      invalid[field] = state.invalid
    }
    return { ...this.form.shell(), values, overridden, invalid }
  }

  inject(): FlywheelCardFace {
    return { hooks: { flywheelCard: this.store }, ...this.form.actions() }
  }
}
