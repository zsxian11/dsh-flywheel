/** Session-graph conversation tab: working-set cards and file citations. */

import { useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { GraphCard, GraphFile, GraphSnapshot } from './graph-fold.ts'
import type { GraphLocaleKey } from './graph-locales.ts'
import css from './SessionGraphView.module.css'

/** Session-bound graph snapshot and history paging. */
export interface SessionGraphInjected {
  hooks: {
    graph: ObservableSnapshot<GraphSnapshot>
  }
  loadOlder: () => Promise<boolean>
}

export type SessionGraphViewProps =
  ConvViewProps
  & PropsLocale<'conversation.flywheel-graph'>
  & InjectFace<SessionGraphInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'conversation.flywheel-graph': GraphLocaleKey
  }
}

export function SessionGraphView(props: SessionGraphViewProps) {
  const { t } = props
  const snapshot = props.useGraph(value => value)
  const [loading, setLoading] = useState(false)
  const empty = snapshot.workingSet.length === 0
    && snapshot.produced.length === 0
    && snapshot.opened.length === 0

  return (
    <div className={css.root}>
      <div className={css.dag} aria-hidden={empty}>
        <div className={css.session}>{t('sessionNode')}</div>
        <Stat count={snapshot.workingSet.length} label={t('workingSet')} />
        <Stat count={snapshot.produced.length} label={t('produced')} />
        <Stat count={snapshot.opened.length} label={t('opened')} />
      </div>

      {empty ? (
        <div className={css.section}>
          <p className={css.empty}>{t('empty')}</p>
          <p className={css.hint}>{t('emptyHint')}</p>
        </div>
      ) : (
        <>
          <Section title={t('workingSet')} items={snapshot.workingSet.map(cardRow)} empty={t('empty')} />
          <Section title={t('produced')} items={snapshot.produced.map(fileRow)} empty={t('empty')} />
          <Section title={t('opened')} items={snapshot.opened.map(fileRow)} empty={t('empty')} />
        </>
      )}

      <button
        type="button"
        className={css.load}
        disabled={loading}
        onClick={() => {
          setLoading(true)
          void props.loadOlder().finally(() => { setLoading(false) })
        }}
      >
        {t('loadOlder')}
      </button>
    </div>
  )
}

function Stat({ count, label }: { count: number; label: string }) {
  return (
    <div className={css.stat}>
      <span className={css.statValue}>{count}</span>
      <span className={css.statLabel}>{label}</span>
    </div>
  )
}

function Section({ title, items, empty }: { title: string; items: readonly ReturnType<typeof cardRow>[]; empty: string }) {
  return (
    <section className={css.section}>
      <h2 className={css.sectionTitle}>{title}</h2>
      {items.length === 0
        ? <p className={css.hint}>{empty}</p>
        : <ul className={css.list}>{items}</ul>}
    </section>
  )
}

function cardRow(card: GraphCard) {
  return (
    <li key={card.id} className={css.item}>
      <span className={css.title}>{card.title}</span>
      {card.path !== undefined && <span className={css.path}>{card.path}</span>}
      {card.summary !== '' && <span className={css.meta}>{card.summary}</span>}
    </li>
  )
}

function fileRow(file: GraphFile) {
  return (
    <li key={`${file.role}:${file.path}`} className={css.item}>
      <span className={css.title}>{file.path}</span>
      <span className={css.meta}>{file.tool}</span>
    </li>
  )
}
