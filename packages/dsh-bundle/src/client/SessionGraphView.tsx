/** Session-graph conversation tab: working-set cards and file citations. */

import { useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { type GraphCard, type GraphFile, type GraphSnapshot } from '../graph-fold.ts'
import { layoutGraph, NODE_WIDTH, NODE_HEIGHT } from '../graph-layout.ts'
import type { GraphEdgeRel, GraphNode, GraphNodeKind, GraphView } from '../graph-view.ts'
import { GRAPH_PROJECTION_KEY } from '../graph-key.ts'
import type { GraphLocaleKey } from './graph-locales.ts'
import css from './SessionGraphView.module.css'

/** Session-bound graph snapshot and history paging. */
export interface SessionGraphInjected {
  hooks: {
    graph: ObservableSnapshot<GraphSnapshot>
  }
  loadOlder: () => Promise<boolean>
}

/** The conversation slot binds the Host projection store into this hook. */
type ProjectionProps = {
  useProjection?: (key: string) => GraphView | undefined
}

export type SessionGraphViewProps =
  ConvViewProps
  & ProjectionProps
  & PropsLocale<'conversation.flywheel-graph'>
  & InjectFace<SessionGraphInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'conversation.flywheel-graph': GraphLocaleKey
  }
}

/**
 * The graph tab. The snapshot is computed on the Host (`wire.view`); the
 * injected hook below stays as a fallback for a shell that exposes no
 * projection hook, so the tab degrades instead of disappearing.
 * @param props - conversation view props plus the projection hook.
 */
export function SessionGraphView(props: SessionGraphViewProps) {
  // Called unconditionally: the injected face always provides the hook, and a
  // conditional hook call would break the rules of hooks.
  const fallback = props.useGraph(value => value)
  return typeof props.useProjection === 'function'
    ? <ProjectedGraph {...props} useProjection={props.useProjection} fallback={fallback} />
    : <GraphPanel props={props} snapshot={fallback} />
}

function ProjectedGraph(props: SessionGraphViewProps & ProjectionProps & { fallback: GraphSnapshot }) {
  const view = props.useProjection?.(GRAPH_PROJECTION_KEY)
  const [selected, setSelected] = useState<GraphNode | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const { t } = props

  // No projection value (plugin inactive, or an empty session): fall back to
  // the client fold so a missing Host value never blanks the tab.
  if (view === undefined || view.edges.length === 0) {
    return <GraphPanel props={props} snapshot={props.fallback} />
  }

  const layout = layoutGraph(view)
  const empty = view.edges.length === 0

  return (
    <div className={css.root}>
      <div className={css.legend}>
        <Legend className={css.legendInjected} label={`${t('workingSet')} · ${view.counts.injected}`} />
        <Legend className={css.legendProduced} label={`${t('produced')} · ${view.counts.produced}`} />
        <Legend className={css.legendOpened} label={`${t('opened')} · ${view.counts.opened}`} />
      </div>

      {empty ? (
        <div className={css.section}>
          <p className={css.empty}>{t('empty')}</p>
          <p className={css.hint}>{t('emptyHint')}</p>
        </div>
      ) : (
        <div className={css.canvas}>
          <svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
          >
            {layout.edges.filter(edge => !edge.hidden).map((edge, index) => (
              <path
                key={`edge:${index}`}
                className={`${css.edge} ${edgeClass(css, edge.rel)}`}
                d={edge.path}
              />
            ))}
            {layout.nodes.map(placed => (
              <g
                key={placed.node.id}
                className={css.nodeHit}
                transform={`translate(${placed.x}, ${placed.y})`}
                onClick={() => { setSelected(placed.node) }}
              >
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={6}
                  className={`${css.nodeBox} ${nodeClass(css, placed.node.kind)}`
                    + (selected?.id === placed.node.id ? ` ${css.nodeBoxSelected}` : '')}
                />
                <text x={8} y={11} className={css.nodeLabel}>{clip(placed.node.label, 20)}</text>
                <text x={8} y={21} className={css.nodeDetail}>{clip(placed.node.detail, 26)}</text>
              </g>
            ))}
          </svg>
        </div>
      )}

      {selected !== undefined && (
        <div className={css.detail}>
          <span className={css.title}>{selected.label}</span>
          <span className={css.meta}>{selected.detail}</span>
          {selected.path !== undefined && <span className={css.detailPath}>{selected.path}</span>}
          {selected.path !== undefined && (
            <button
              type="button"
              className={css.copy}
              onClick={() => { void navigator.clipboard?.writeText(selected.path ?? '') }}
            >
              {t('copyPath')}
            </button>
          )}
        </div>
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

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className={css.legendItem}>
      <span className={`${css.legendSwatch} ${className}`} />
      {label}
    </span>
  )
}

function edgeClass(styles: Record<string, string>, rel: GraphEdgeRel): string {
  if (rel === 'produced') return styles.edgeProduced ?? ''
  if (rel === 'opened') return styles.edgeOpened ?? ''
  return styles.edgeInjected ?? ''
}

function nodeClass(styles: Record<string, string>, kind: GraphNodeKind): string {
  if (kind === 'session') return styles.nodeBoxSession ?? ''
  if (kind === 'card') return styles.nodeBoxCard ?? ''
  return ''
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** The client-fold rendering, kept as the fallback path (and for old shells). */
function GraphPanel({ props, snapshot }: { props: SessionGraphViewProps; snapshot: GraphSnapshot }) {
  const { t } = props
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
