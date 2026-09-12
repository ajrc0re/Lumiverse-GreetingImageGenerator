import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { setup } from '../src/frontend'
import { fixture } from './engine.test'
import { DEFAULT_SETTINGS, type Job } from '../src/types'

test.each(['selector', 'unwired', 'legacy'])('drawer workflow with %s active-character API: prompt reuse, removal/undo, filters, and switching', async mode => {
  const win = new Window({ url: 'http://localhost:4318' }), saved = new Map<string, PropertyDescriptor | undefined>()
  for (const key of ['document', 'window', 'location', 'navigator', 'HTMLElement', 'FileReader']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value: (win as any)[key] || (key === 'window' ? win : undefined), configurable: true, writable: true })
  }
  const previousFetch = globalThis.fetch, f = fixture(), replies: Array<(payload: any) => void> = [], states: Array<(payload: any) => void> = [], events = new Map<string, () => void>()
  let active: any = { characterId: 'c1', chatId: 'chat' }, promptCalls = 0
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes('/settings/')) return Response.json({ value: {} })
    if (String(url).includes('/chats/')) return Response.json({ character_id: 'c1' })
    if (String(url).includes('/preview-prompt')) { promptCalls++; return Response.json({ prompt: 'Original image prompt' }) }
    throw new Error(`Unexpected request: ${url}`)
  }) as typeof fetch
  const mount = document.createElement('div'); document.body.append(mount)
  function mounted(target: Element, options: any, tag = 'input') {
    const node = document.createElement(tag) as HTMLInputElement
    node.value = options.value || ''; node.setAttribute('aria-label', options.ariaLabel || '')
    node.oninput = () => options.onChange?.(node.value); target.append(node)
    return { destroy: () => node.remove(), getValue: () => node.value }
  }
  let cleanup: (() => void) | undefined
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 1)) }
  const find = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === text && !b.closest('[hidden]'))!
  try {
    cleanup = setup({
      ui: { registerDrawerTab: () => ({ root: mount, onActivate: () => () => {}, setBadge: () => {}, destroy: () => mount.remove() }) },
      dom: { addStyle: () => () => {} }, components: { mountSelect: mounted, mountTextInput: mounted, mountTextArea: (t: any, o: any) => mounted(t, o, 'textarea'), mountNumericInput: mounted },
      state: mode === 'legacy' ? undefined : { get: () => { if (mode === 'unwired') throw new Error('PERMISSION_DENIED:spindle_authority_map_unwired — chat.active requires the spindle_authority_map_unwired permission'); return active }, subscribe: (_key: string, fn: any) => { states.push(fn); return () => {} } },
      getActiveChat: () => active,
      permissions: { getGranted: async () => ['characters', 'chats', 'images', 'image_gen'] },
      events: { on: (key: string, fn: any) => { events.set(key, fn); return () => {} } }, characters: { get: async () => f.card() },
      onBackendMessage: (fn: any) => { replies.push(fn); return () => {} },
      sendToBackend: async (message: any) => {
        const p = message.input; let result: unknown, error: string | undefined
        try {
          switch (message.action) {
            case 'bootstrap': result = { settings: { ...DEFAULT_SETTINGS, connectionId: 'image-profile' }, connections: [{ id: 'image-profile', name: 'Profile', provider: 'openai' }], providers: [], hasSecret: false }; break
            case 'load': result = { character: f.card(), data: await f.engine.load('c1') }; break
            case 'create': result = await f.engine.create(p); break
            case 'prepared': result = await f.engine.prepared(p.characterId, p.id, p.prompt); break
            case 'run': result = await f.engine.run(p.characterId, p.id, p.options); break
            case 'eligibility': result = await f.engine.fileEligibility(p.characterId, p.source); break
            case 'remove': result = await f.engine.remove(p.characterId, p.index, p.original, p.occurrence); break
            case 'undo': result = await f.engine.undo(p.characterId); break
            case 'settings': break
            default: throw new Error(`Unexpected action ${message.action}`)
          }
        } catch (e) { error = String(e) }
        queueMicrotask(() => replies.forEach(fn => fn(structuredClone({ type: 'gig:reply', requestId: message.requestId, result, error }))))
      },
    } as any)
    await flush(); expect(mount.textContent).toContain('Mira'); expect(mount.querySelectorAll('.gig-card')).toHaveLength(2)
    find('View/edit image prompt').click(); await flush()
    const prompt = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Image prompt"]')!; expect(prompt.value).toBe('Original image prompt'); prompt.value = 'Edited image prompt'
    find('Save prompt only').click(); await flush(); expect(promptCalls).toBe(1)
    document.querySelector<HTMLButtonElement>('[aria-label="Generate an image for Main greeting"]')!.click(); await flush()
    expect(promptCalls).toBe(1); expect(f.api.imageGen.generate.mock.calls[0][0]).toMatchObject({ prompt: 'Edited image prompt' })
    expect(f.card().first_mes).toContain('!['); expect(f.card().alternate_greetings).toEqual(['Second'])
    document.querySelector<HTMLButtonElement>('[aria-label="Remove this image"]')!.click(); await flush(); find('Remove image').click(); await flush(); expect(f.card().first_mes.trim()).toBe('Hello')
    find('Undo last image edit').click(); await flush(); expect(f.card().first_mes).toContain('![')
    const filter = document.querySelector<HTMLSelectElement>('[aria-label="Image filter"]')!; filter.value = 'without'; filter.dispatchEvent(new win.Event('change') as any)
    expect(mount.querySelectorAll('.gig-card')).toHaveLength(1)
    const multi = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).find(i => i.parentElement?.textContent === 'Multiselect')!; multi.click(); find('Select all').click(); expect(mount.textContent).toContain('1 selected')
    expect(document.querySelector<HTMLInputElement>('[aria-label="Select Greeting 2"]')?.checked).toBe(true)
    expect(events.has('SPINDLE_PERMISSION_CHANGED')).toBe(true)
    active = {}; states.forEach(fn => fn(active)); events.get('CHAT_SWITCHED')?.(); await flush(); expect(mount.textContent).toContain('No character selected')
  } finally {
    cleanup?.(); await flush(); globalThis.fetch = previousFetch
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]
    await win.happyDOM.close()
  }
})
