/** Self-owned staged form for the flywheel card. Mirrors the shipped card-form
 * contract (staged edits, revision-fenced write, read-back settlement) without
 * importing it — an out-of-repo card renders its own internals by design. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

export interface CardShell {
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
}

export interface CardActions {
  edit: (field: string, value: string) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

export type FlywheelSettings = Record<string, unknown>

export class FlywheelCardForm {
  private readonly staged = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  constructor(private readonly scope: SettingsScope<FlywheelSettings>) {
    scope.subscribe(() => { this.publish() })
  }

  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.staged.size > 0,
      saving: this.saving,
      failed: this.failed,
    }
  }

  actions(): CardActions {
    return {
      edit: (field, value) => { this.staged.set(field, value); this.failed = false; this.publish() },
      resetField: (field) => { this.staged.set(field, '') },
      save: () => { void this.save() },
      discard: () => { this.staged.clear(); this.failed = false; this.publish() },
    }
  }

  value(field: string): string {
    const staged = this.staged.get(field)
    if (staged !== undefined) return staged
    return this.section()[field] as string ?? ''
  }

  /** Whether the field carries a user-layer override (presence, not value). */
  overridden(field: string): boolean {
    const user = this.snapshot().user as Record<string, unknown> | undefined
    return user !== undefined && Object.hasOwn(user, field)
  }

  private async save(): Promise<void> {
    if (this.staged.size === 0 || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const [field, value] of this.staged) {
      try {
        await this.scope.set(field, value)
      } catch {
        landed = false
        break
      }
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private section(): Record<string, unknown> {
    return (this.snapshot().value as Record<string, unknown> | undefined) ?? {}
  }

  private snapshot(): SettingsScopeSnapshot<FlywheelSettings> {
    return this.scope.getSnapshot()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
