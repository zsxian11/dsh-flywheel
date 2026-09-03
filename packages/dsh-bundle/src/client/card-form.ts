/**
 * Self-owned staged form for the flywheel card. Mirrors the shipped card-form
 * (staged edits, parse-gated save, revision-fenced write, read-back settlement)
 * without importing it — an out-of-repo card renders its own internals.
 *
 * Nested settings (`elasticsearch.node`, `vector.embedQuery`) are addressed
 * with a path; `scope.set`/`unset` only take a top-level key, so writes go
 * through `scope.mutate`.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The write one field's staged text performs when the card is saved. */
export type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
export interface CardFieldSpec {
  /** Card-local field id (flat; used as the control's key). */
  field: string
  /** Settings document path this control writes. */
  path: readonly string[]
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /**
   * The write this draft text stages, or undefined when the text is not a
   * value this field accepts — which blocks the save rather than discarding it.
   */
  parse: (text: string) => FieldWrite | undefined
}

/**
 * A control whose value never round-trips. A blank draft writes nothing, so a
 * stored secret is kept rather than cleared.
 */
export interface CardSecretSpec {
  /** Card-local field id. */
  field: string
  /** Settings document path this control writes. */
  path: readonly string[]
}

/** One field as a card's control renders it. */
export interface CardFieldState {
  /** Draft text the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}

/** Form state every plugin card shares. */
export interface CardShell {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** The write actions every plugin card's slot entry injects. */
export interface CardActions {
  /** Stage draft text for one field. */
  edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One field's staged edit. */
interface StagedEdit {
  /** Draft text the control renders. */
  text: string
  /** True when this edit clears the field whatever text it shows. */
  clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  field: string
  /**
   * Perform the write and report whether the Host holds the staged value
   * afterwards; undefined when the draft is not a value the field accepts.
   */
  run: (() => Promise<boolean>) | undefined
}

/**
 * A boolean field. Draft text is `true` / `false`; empty clears.
 * @param field - card-local field id.
 * @param path - settings document path; defaults to `[field]`.
 * @returns the field's conversion spec.
 */
export function booleanField(field: string, path: readonly string[] = [field]): CardFieldSpec {
  return {
    field,
    path,
    format: value => value === true ? 'true' : value === false ? 'false' : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/**
 * A whole-number field. An empty draft clears; any other non-finite draft
 * blocks the save. Optional min/max also block rather than clamp.
 * @param field - card-local field id.
 * @param options - path and inclusive numeric bounds.
 * @returns the field's conversion spec.
 */
export function numberField(
  field: string,
  options: { path?: readonly string[]; min?: number; max?: number } = {},
): CardFieldSpec {
  const path = options.path ?? [field]
  return {
    field,
    path,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return undefined
      if (options.min !== undefined && parsed < options.min) return undefined
      if (options.max !== undefined && parsed > options.max) return undefined
      return { kind: 'set', value: parsed }
    },
  }
}

/**
 * A free-text field. An empty draft clears the field.
 * @param field - card-local field id.
 * @param path - settings document path; defaults to `[field]`.
 * @returns the field's conversion spec.
 */
export function textField(field: string, path: readonly string[] = [field]): CardFieldSpec {
  return {
    field,
    path,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * A closed-string field. An empty draft clears; any other value not in
 * `allowed` blocks the save.
 * @param field - card-local field id.
 * @param allowed - accepted stored values.
 * @param path - settings document path; defaults to `[field]`.
 * @returns the field's conversion spec.
 */
export function enumField(
  field: string,
  allowed: readonly string[],
  path: readonly string[] = [field],
): CardFieldSpec {
  return {
    field,
    path,
    format: value => typeof value === 'string' && allowed.includes(value) ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return allowed.includes(trimmed) ? { kind: 'set', value: trimmed } : undefined
    },
  }
}

/**
 * Stages one card's edits over one settings namespace and writes them on save.
 */
export class FlywheelCardForm {
  private readonly specs: Map<string, CardFieldSpec>
  private readonly secretSpecs: Map<string, CardSecretSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for this card's namespace.
   * @param specs - the section fields this card edits.
   * @param secrets - write-only controls whose values never round-trip.
   */
  constructor(
    private readonly scope: SettingsScope<Record<string, unknown>>,
    specs: CardFieldSpec[],
    secrets: CardSecretSpec[] = [],
  ) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    this.secretSpecs = new Map(secrets.map(spec => [spec.field, spec]))
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Publish a projection of this form, rebuilt whenever the scope or a draft changes.
   * @param project - build the card's state from the form's current reads.
   * @returns the store the card's component reads through its bound selector.
   */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * Read the card-level state: what the Host serves, and what a save would do.
   * @returns the form state every card shares.
   */
  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /**
   * Read one control's state.
   * @param field - field name of a section field or of a write-only control.
   * @returns the draft text, whether a save would leave an override, and whether it is invalid.
   */
  field(field: string): CardFieldState {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.spec(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(spec.path)), overridden: this.stored(spec.path), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    }
  }

  /**
   * Build the edit, reset, save, and discard actions bound to this form.
   * @returns the actions a card's slot entry injects.
   */
  actions(): CardActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        const spec = this.spec(field)
        this.stage(field, { text: spec.format(this.baseValue(spec.path)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * Write every staged edit, then re-seed from what the Host accepted.
   * A save that did not land keeps its drafts.
   */
  async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) {
      landed = await write() && landed
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') plan.push({ field, run: () => this.storeSecret(secret.path, value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(spec.path)) plan.push({ field, run: () => this.clear(spec.path) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(spec.path))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, run: undefined })
      else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(spec.path) })
      else plan.push({ field, run: () => this.store(spec.path, write.value) })
    }
    return plan
  }

  private async clear(path: readonly string[]): Promise<boolean> {
    try {
      await this.scope.mutate([{ op: 'unset', path: [...path] }])
      return !this.stored(path)
    } catch {
      // Host validation refused the clear; keep the draft.
      return false
    }
  }

  private async store(path: readonly string[], value: unknown): Promise<boolean> {
    try {
      await this.scope.mutate([{ op: 'set', path: [...path], value: value as never }])
      return this.stored(path) && getAt(this.userLayer(), path) === value
    } catch {
      // Host validation (or a missing backend) refused the write; keep the draft.
      return false
    }
  }

  private async storeSecret(path: readonly string[], value: string): Promise<boolean> {
    try {
      await this.scope.mutate([{ op: 'set', path: [...path], value }])
      return true
    } catch {
      // Host validation (or a missing backend) refused the write; keep the draft.
      return false
    }
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): CardFieldSpec {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`flywheel card has no field ${field}`)
    return spec
  }

  private snapshotOf(): SettingsScopeSnapshot<Record<string, unknown>> {
    return this.scope.getSnapshot()
  }

  private sectionValue(path: readonly string[]): unknown {
    return getAt(this.snapshotOf().value, path)
  }

  private baseValue(path: readonly string[]): unknown {
    return getAt(this.snapshotOf().base, path)
  }

  private userLayer(): unknown {
    return this.snapshotOf().user
  }

  private stored(path: readonly string[]): boolean {
    return hasAt(this.userLayer(), path)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

function getAt(root: unknown, path: readonly string[]): unknown {
  let current = root
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function hasAt(root: unknown, path: readonly string[]): boolean {
  let current = root
  for (const key of path) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}
