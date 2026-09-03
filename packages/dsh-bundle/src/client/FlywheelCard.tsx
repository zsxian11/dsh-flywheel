/** The flywheel plugin's settings card: title 「会话飞轮」, grouped controls, all
 * copy through typed locale dictionaries. Self-drawn (no import of the shipped
 * card chrome), per the out-of-repo card ownership rule. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { FlywheelCardFace } from './flywheel-card-controller.ts'
import css from './FlywheelCard.module.css'

/** Props the renderer binds for the flywheel card. */
export type FlywheelCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.flywheel'>
  & InjectFace<FlywheelCardFace>

interface FieldProps {
  label: string
  hint?: string
  field: string
  value: string
  overridden: boolean
  disabled: boolean
  numeric?: boolean
  onEdit: (field: string, value: string) => void
  onReset: (field: string) => void
  overriddenLabel: string
  resetLabel: string
  options?: readonly string[]
}

function Field(props: FieldProps) {
  const { field, label, value, overridden, disabled, numeric, onEdit, onReset, overriddenLabel, resetLabel } = props
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.label} htmlFor={`flywheel-${field}`}>{label}</label>
        {overridden && <span className={css.overridden}>{overriddenLabel}</span>}
        {overridden && (
          <button type="button" className={css.reset} disabled={disabled} onClick={() => { onReset(field) }}>
            {resetLabel}
          </button>
        )}
      </div>
      <input
        id={`flywheel-${field}`}
        className={css.input}
        inputMode={numeric ? 'numeric' : undefined}
        disabled={disabled}
        value={value}
        onChange={(event) => { onEdit(field, event.currentTarget.value) }}
      />
      {props.hint !== undefined && <p className={css.hint}>{props.hint}</p>}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
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

  return (
    <div className={css.card}>
      <header className={css.cardHead}>
        <h2 className={css.cardTitle}>{t('cardTitle')}</h2>
        <p className={css.cardDescription}>{t('cardDescription')}</p>
      </header>

      <Group title={t('groupWorkingSet')}>
        <Field label={t('enabled')} field="enabled" value={state.values.enabled ?? ''} overridden={state.overridden.enabled ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('inject')} field="inject" value={state.values.inject ?? ''} overridden={state.overridden.inject ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('tools')} field="tools" value={state.values.tools ?? ''} overridden={state.overridden.tools ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('ftsK')} field="ftsK" numeric value={state.values.ftsK ?? ''} overridden={state.overridden.ftsK ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('hop')} field="hop" numeric value={state.values.hop ?? ''} overridden={state.overridden.hop ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('hopExtra')} field="hopExtra" numeric value={state.values.hopExtra ?? ''} overridden={state.overridden.hopExtra ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('maxChars')} field="maxChars" numeric value={state.values.maxChars ?? ''} overridden={state.overridden.maxChars ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
      </Group>

      <Group title={t('groupLexical')}>
        <Field label={t('lexicalBackend')} field="lexicalBackend" value={state.values.lexicalBackend ?? ''} overridden={state.overridden.lexicalBackend ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} options={['sqlite-fts', 'elasticsearch']} />
        <Field label={t('esNode')} field="esNode" value={state.values.esNode ?? ''} overridden={state.overridden.esNode ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('esIndexPrefix')} field="esIndexPrefix" value={state.values.esIndexPrefix ?? ''} overridden={state.overridden.esIndexPrefix ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('esApiKey')} field="esApiKey" value={state.values.esApiKey ?? ''} overridden={state.overridden.esApiKey ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
      </Group>

      <Group title={t('groupVector')}>
        <Field label={t('vectorBackend')} field="vectorBackend" value={state.values.vectorBackend ?? ''} overridden={state.overridden.vectorBackend ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} options={['off', 'cloud']} />
        <Field label={t('vectorProvider')} field="vectorProvider" value={state.values.vectorProvider ?? ''} overridden={state.overridden.vectorProvider ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('vectorModel')} field="vectorModel" value={state.values.vectorModel ?? ''} overridden={state.overridden.vectorModel ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('vectorK')} field="vectorK" numeric value={state.values.vectorK ?? ''} overridden={state.overridden.vectorK ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('embedQuery')} hint={t('embedQueryHint')} field="embedQuery" value={state.values.embedQuery ?? ''} overridden={state.overridden.embedQuery ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
      </Group>

      <Group title={t('groupClaim')}>
        <Field label={t('claimFlash')} field="claimFlash" value={state.values.claimFlash ?? ''} overridden={state.overridden.claimFlash ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('summarizationModel')} field="summarizationModel" value={state.values.summarizationModel ?? ''} overridden={state.overridden.summarizationModel ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('mediaCaption')} field="mediaCaption" value={state.values.mediaCaption ?? ''} overridden={state.overridden.mediaCaption ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
      </Group>

      <Group title={t('groupWindow')}>
        <Field label={t('windowCompact')} field="windowCompact" value={state.values.windowCompact ?? ''} overridden={state.overridden.windowCompact ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('windowPendingPattern')} field="windowPendingPattern" value={state.values.windowPendingPattern ?? ''} overridden={state.overridden.windowPendingPattern ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
        <Field label={t('supersedePattern')} field="supersedePattern" value={state.values.supersedePattern ?? ''} overridden={state.overridden.supersedePattern ?? false} disabled={disabled} onEdit={edit} onReset={props.resetField} overriddenLabel={t('overridden')} resetLabel={t('reset')} />
      </Group>

      <footer className={css.cardFoot}>
        {state.failed && <p className={css.failed}>{t('backendNotMounted')}</p>}
        <div className={css.actions}>
          <button type="button" className={css.discard} disabled={disabled || !state.dirty} onClick={props.discard}>{t('discard')}</button>
          <button type="button" className={css.save} disabled={disabled || !state.dirty || state.saving} onClick={props.save}>
            {state.saving ? t('saving') : t('save')}
          </button>
        </div>
      </footer>
    </div>
  )
}
