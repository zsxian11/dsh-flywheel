/** The flywheel plugin's settings card: title 「会话飞轮」, grouped controls, all
 * copy through typed locale dictionaries. Self-drawn (no import of the shipped
 * card chrome), per the out-of-repo card ownership rule. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { FlywheelCardFace } from './flywheel-card-controller.ts'
import css from './FlywheelCard.module.css'

/** Props the renderer binds for the flywheel card. */
export type FlywheelCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.flywheel'>
  & InjectFace<FlywheelCardFace>

type FieldKind = 'text' | 'number' | 'boolean' | 'select' | 'secret'

interface FieldProps {
  label: string
  hint?: string
  field: string
  value: string
  overridden: boolean
  invalid: boolean
  disabled: boolean
  kind?: FieldKind
  options?: readonly { value: string; label: string }[]
  onEdit: (field: string, value: string) => void
  onReset: (field: string) => void
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
}

function Field(props: FieldProps) {
  const {
    field, label, value, overridden, invalid, disabled, kind = 'text',
    options, onEdit, onReset, overriddenLabel, resetLabel, invalidLabel,
  } = props
  const id = `flywheel-${field}`
  const controlClass = invalid ? css.inputInvalid : css.input
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.label} htmlFor={id}>{label}</label>
        {overridden && kind !== 'secret' && <span className={css.overridden}>{overriddenLabel}</span>}
        {overridden && kind !== 'secret' && (
          <button type="button" className={css.reset} disabled={disabled} onClick={() => { onReset(field) }}>
            {resetLabel}
          </button>
        )}
      </div>
      {kind === 'boolean' ? (
        <input
          id={id}
          className={css.checkbox}
          type="checkbox"
          disabled={disabled}
          checked={value === 'true'}
          aria-invalid={invalid || undefined}
          onChange={(event) => { onEdit(field, String(event.currentTarget.checked)) }}
        />
      ) : kind === 'select' && options !== undefined ? (
        <select
          id={id}
          className={controlClass}
          disabled={disabled}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(event) => { onEdit(field, event.currentTarget.value) }}
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={controlClass}
          type={kind === 'secret' ? 'password' : 'text'}
          autoComplete={kind === 'secret' ? 'off' : undefined}
          inputMode={kind === 'number' ? 'numeric' : undefined}
          disabled={disabled}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(event) => { onEdit(field, event.currentTarget.value) }}
        />
      )}
      {(props.hint !== undefined || invalid) && (
        <p className={invalid ? css.invalid : css.hint}>{invalid ? invalidLabel : props.hint}</p>
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={css.group}>
      <h3 className={css.groupTitle}>{title}</h3>
      {children}
    </section>
  )
}

export function FlywheelCard(props: FlywheelCardProps) {
  const { t } = props
  const state = props.useFlywheelCard(snapshot => snapshot)
  if (!state.available) return null
  const disabled = !state.writable
  const edit = props.edit
  const shared = {
    disabled,
    onEdit: edit,
    onReset: props.resetField,
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    invalidLabel: t('invalid'),
  }

  return (
    <div className={css.card}>
      <header className={css.cardHead}>
        <h2 className={css.cardTitle}>{t('cardTitle')}</h2>
        <p className={css.cardDescription}>{t('cardDescription')}</p>
      </header>

      <Group title={t('groupWorkingSet')}>
        <Field label={t('enabled')} field="enabled" kind="boolean" value={state.values.enabled ?? ''} overridden={state.overridden.enabled ?? false} invalid={state.invalid.enabled ?? false} {...shared} />
        <Field label={t('inject')} field="inject" kind="boolean" value={state.values.inject ?? ''} overridden={state.overridden.inject ?? false} invalid={state.invalid.inject ?? false} {...shared} />
        <Field label={t('tools')} field="tools" kind="boolean" value={state.values.tools ?? ''} overridden={state.overridden.tools ?? false} invalid={state.invalid.tools ?? false} {...shared} />
        <Field label={t('ftsK')} field="ftsK" kind="number" value={state.values.ftsK ?? ''} overridden={state.overridden.ftsK ?? false} invalid={state.invalid.ftsK ?? false} {...shared} />
        <Field label={t('hop')} hint={t('hopHint')} field="hop" kind="number" value={state.values.hop ?? ''} overridden={state.overridden.hop ?? false} invalid={state.invalid.hop ?? false} {...shared} disabled />
        <Field label={t('hopExtra')} field="hopExtra" kind="number" value={state.values.hopExtra ?? ''} overridden={state.overridden.hopExtra ?? false} invalid={state.invalid.hopExtra ?? false} {...shared} />
        <Field label={t('maxChars')} field="maxChars" kind="number" value={state.values.maxChars ?? ''} overridden={state.overridden.maxChars ?? false} invalid={state.invalid.maxChars ?? false} {...shared} />
      </Group>

      <Group title={t('groupLexical')}>
        <Field
          label={t('lexicalBackend')}
          field="lexicalBackend"
          kind="select"
          options={[
            { value: 'sqlite-fts', label: t('lexicalSqlite') },
            { value: 'elasticsearch', label: t('lexicalElasticsearch') },
          ]}
          value={state.values.lexicalBackend ?? ''}
          overridden={state.overridden.lexicalBackend ?? false}
          invalid={state.invalid.lexicalBackend ?? false}
          {...shared}
        />
        <Field label={t('esNode')} field="esNode" value={state.values.esNode ?? ''} overridden={state.overridden.esNode ?? false} invalid={state.invalid.esNode ?? false} {...shared} />
        <Field label={t('esIndexPrefix')} field="esIndexPrefix" value={state.values.esIndexPrefix ?? ''} overridden={state.overridden.esIndexPrefix ?? false} invalid={state.invalid.esIndexPrefix ?? false} {...shared} />
        <Field label={t('esApiKey')} field="esApiKey" kind="secret" value={state.values.esApiKey ?? ''} overridden={false} invalid={false} {...shared} />
      </Group>

      <Group title={t('groupVector')}>
        <Field
          label={t('vectorBackend')}
          field="vectorBackend"
          kind="select"
          options={[
            { value: 'off', label: t('vectorOff') },
            { value: 'cloud', label: t('vectorCloud') },
          ]}
          value={state.values.vectorBackend ?? ''}
          overridden={state.overridden.vectorBackend ?? false}
          invalid={state.invalid.vectorBackend ?? false}
          {...shared}
        />
        <Field label={t('vectorProvider')} field="vectorProvider" value={state.values.vectorProvider ?? ''} overridden={state.overridden.vectorProvider ?? false} invalid={state.invalid.vectorProvider ?? false} {...shared} />
        <Field label={t('vectorModel')} field="vectorModel" value={state.values.vectorModel ?? ''} overridden={state.overridden.vectorModel ?? false} invalid={state.invalid.vectorModel ?? false} {...shared} />
        <Field label={t('vectorK')} field="vectorK" kind="number" value={state.values.vectorK ?? ''} overridden={state.overridden.vectorK ?? false} invalid={state.invalid.vectorK ?? false} {...shared} />
        <Field label={t('embedQuery')} hint={t('embedQueryHint')} field="embedQuery" kind="boolean" value={state.values.embedQuery ?? ''} overridden={state.overridden.embedQuery ?? false} invalid={state.invalid.embedQuery ?? false} {...shared} />
      </Group>

      <Group title={t('groupClaim')}>
        <Field label={t('claimFlash')} field="claimFlash" kind="boolean" value={state.values.claimFlash ?? ''} overridden={state.overridden.claimFlash ?? false} invalid={state.invalid.claimFlash ?? false} {...shared} />
        <Field label={t('summarizationModel')} field="summarizationModel" value={state.values.summarizationModel ?? ''} overridden={state.overridden.summarizationModel ?? false} invalid={state.invalid.summarizationModel ?? false} {...shared} />
        <Field label={t('mediaCaption')} field="mediaCaption" kind="boolean" value={state.values.mediaCaption ?? ''} overridden={state.overridden.mediaCaption ?? false} invalid={state.invalid.mediaCaption ?? false} {...shared} />
      </Group>

      <Group title={t('groupWindow')}>
        <Field label={t('windowCompact')} field="windowCompact" kind="boolean" value={state.values.windowCompact ?? ''} overridden={state.overridden.windowCompact ?? false} invalid={state.invalid.windowCompact ?? false} {...shared} />
        <Field label={t('windowPendingPattern')} field="windowPendingPattern" value={state.values.windowPendingPattern ?? ''} overridden={state.overridden.windowPendingPattern ?? false} invalid={state.invalid.windowPendingPattern ?? false} {...shared} />
        <Field label={t('supersedePattern')} field="supersedePattern" value={state.values.supersedePattern ?? ''} overridden={state.overridden.supersedePattern ?? false} invalid={state.invalid.supersedePattern ?? false} {...shared} />
      </Group>

      <footer className={css.cardFoot}>
        {state.failed && <p className={css.failed}>{t('backendNotMounted')}</p>}
        <div className={css.actions}>
          <button type="button" className={css.discard} disabled={disabled || !state.dirty} onClick={props.discard}>{t('discard')}</button>
          <button type="button" className={css.save} disabled={disabled || !state.dirty || state.saving || state.invalid} onClick={props.save}>
            {state.saving ? t('saving') : t('save')}
          </button>
        </div>
      </footer>
    </div>
  )
}
