/** Browser half of the flywheel bundle: settings section plus the session-graph tab. */

// Type-only: SlotMap merges and Context services. Cross-plugin collaboration
// goes through cordis services, never a value import.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FlywheelCard } from './FlywheelCard.tsx'
import { FLYWHEEL_NS, FlywheelCardController } from './flywheel-card-controller.ts'
import { en, zh, type FlywheelLocaleKey } from './locales.ts'
import { registerGraphConversation, GRAPH_TARGET } from './graph-definition.ts'
import { EMPTY_GRAPH_SNAPSHOT } from './graph-fold.ts'
import { graphEn, graphZh } from './graph-locales.ts'
import { SessionGraphView, type SessionGraphInjected } from './SessionGraphView.tsx'

/** Graph tab with no Session binding yet — never throw into the conversation shell. */
function emptyGraphInjected(): SessionGraphInjected {
  return {
    hooks: {
      graph: {
        getSnapshot: () => EMPTY_GRAPH_SNAPSHOT,
        subscribe: () => () => {},
      },
    },
    loadOlder: async () => false,
  }
}

/** Dictionary namespace owned by the settings section. */
const CARD_NS = 'settings.flywheel'

/** Dictionary namespace owned by the session-graph tab. */
const GRAPH_NS = 'conversation.flywheel-graph'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.flywheel': FlywheelLocaleKey
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'flywheel-web'

/** Required services (cordis fiber inject). Conversation is optional so the section still loads alone. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Register the settings section; the graph tab waits for the conversation shell. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(CARD_NS, { zh, en }), 'flywheel-card: dictionaries')

  const card = new FlywheelCardController(ctx.settingsScope.bind({ namespace: FLYWHEEL_NS }))
  const tNav = ctx.locale.bind(CARD_NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'flywheel',
    order: 16,
    label: () => tNav('nav'),
    locale: CARD_NS,
    inject: () => card.inject(),
  }, FlywheelCard))

  ctx.inject(['uiConversation', 'sessions'], (inner) => {
    inner.effect(() => inner.locale.register(GRAPH_NS, { zh: graphZh, en: graphEn }), 'flywheel-graph: dictionaries')
    registerGraphConversation(inner)
    const t = inner.locale.bind(GRAPH_NS)
    inner.slots.inject('conversation.view', () => inner.slots.register({
      name: 'conversation.view',
      id: GRAPH_TARGET,
      order: 20,
      locale: GRAPH_NS,
      label: () => t('viewLabel'),
      inject: (sessionId: SessionId): SessionGraphInjected => {
        try {
          const binding = inner.sessions.binding(sessionId)
          if (binding === undefined) return emptyGraphInjected()
          const target = inner.uiConversation.binding(binding).target(GRAPH_TARGET)
          return {
            hooks: {
              graph: {
                getSnapshot: () => target.getSnapshot() ?? EMPTY_GRAPH_SNAPSHOT,
                subscribe: listener => target.subscribe(listener),
              },
            },
            loadOlder: async () => {
              const before = target.getSnapshot()
              await binding.session.loadOlder()
              return target.getSnapshot() !== before
            },
          }
        } catch (error) {
          inner.logger?.warn?.(error)
          return emptyGraphInjected()
        }
      },
    }, SessionGraphView))
  })
}
