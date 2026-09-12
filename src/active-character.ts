import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export type ActiveCharacter = { characterId?: string | null; chatId?: string | null }

// Some host builds expose state selectors before wiring their authority map.
// Keep using public APIs on those builds instead of losing the entire drawer.
export function watchActiveCharacter(ctx: SpindleFrontendContext, changed: (value: ActiveCharacter) => void, report: (error: unknown) => void): () => void {
  try {
    if (ctx.state) {
      const initial = ctx.state.get<ActiveCharacter>('chat.active')
      const unsubscribe = ctx.state.subscribe<ActiveCharacter>('chat.active', changed)
      changed(initial)
      return unsubscribe
    }
  } catch (error) {
    if (!/spindle_authority_map_unwired|SELECTOR_UNKNOWN/.test(String(error))) {
      report(error)
      return () => {}
    }
  }
  let previous: ActiveCharacter | undefined
  const refresh = () => {
    try {
      const next = ctx.getActiveChat()
      if (!previous || previous.characterId !== next.characterId || previous.chatId !== next.chatId) {
        previous = next
        changed(next)
      }
    } catch (error) { report(error) }
  }
  refresh()
  const unsubscribe = ctx.events.on('CHAT_SWITCHED', refresh)
  // The legacy API has no subscription for character selection without a chat.
  const timer = setInterval(refresh, 750)
  return () => { clearInterval(timer); unsubscribe() }
}
