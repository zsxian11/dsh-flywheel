/** Browser half of the flywheel bundle: registers the settings card keyed by the
 * `flywheel` namespace and its typed zh/en dictionaries. */

// Type-only: the settings shell's SlotMap merge (`settings.plugin.item`) and the
// settingsScope Context merge. Cross-plugin collaboration goes through services,
// never a value import.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { FlywheelCard } from './FlywheelCard.tsx'
import { FLYWHEEL_NS, FlywheelCardController } from './flywheel-card-controller.ts'
import { en, zh, type FlywheelLocaleKey } from './locales.ts'

/** Dictionary namespace owned by this card. */
const NS = 'settings.flywheel'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.flywheel': FlywheelLocaleKey
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope']

/** Register the flywheel card into the plugin configuration section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'flywheel-card: dictionaries')

  const card = new FlywheelCardController(ctx.settingsScope.bind({ namespace: FLYWHEEL_NS }))

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: FLYWHEEL_NS,
    locale: NS,
    inject: () => card.inject(),
  }, FlywheelCard))
}
