import { setup } from '../src/frontend'
import { Engine } from '../src/engine'
import { DEFAULT_SETTINGS, IDENTIFIER, type Character } from '../src/types'
import type { SpindleAPI } from 'lumiverse-spindle-types'
const fixture: Character = {
  id: 'mira', name: 'Mira Ashford', first_mes: 'The last train has already left when you reach the station.\n\nA woman in a navy coat waits beneath the clock, a folded map tucked under her arm. “You’re late,” she says, though the small smile suggests she expected it.\n\n![At the station](/api/v1/images/train)',
  alternate_greetings: [
    'Rain threads silver lines down the windows of the little bookshop. Mira looks up from a stack of maps as the bell over the door announces your arrival.\n\n“Tell me you brought coffee,” she says. “We have a long night ahead.”',
    'The mountain trail ends at a lake so still it holds the entire sky. Mira drops her pack on the shore and lets out a quiet breath.\n\n![The mountain lake](/api/v1/images/lake)\n\n“Some places are worth getting lost for.”',
    'You find her on the observatory steps after midnight. Her coat is wrapped tightly around her, and a telescope points toward a narrow break in the clouds.\n\n![Midnight](/api/v1/images/night)\n\n“You can see Saturn from here,” she says, making room beside her.',
    'The café is almost empty. A record crackles softly behind the counter as Mira slides a sealed envelope across the table. “Before you open it,” she says, “promise you’ll hear me out.”',
  ], description: 'A cartographer in a navy coat.', personality: '', scenario: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: [], creator: '', image_id: 'train', world_book_ids: [], created_at: 1, updated_at: 1,
  extensions: { greeting_tools: { mainGreeting: { title: 'The last train' }, indexMap: { 0: 'rain', 1: 'lake', 2: 'stars', 3: 'letter' }, greetings: { rain: { title: 'A rainy afternoon' }, lake: { title: 'Beyond the trail' }, stars: { title: 'Under the same stars' }, letter: { title: 'The unopened letter' } } } },
}
let card = structuredClone(fixture), active: { characterId?: string; chatId?: string } = { characterId: 'mira', chatId: 'chat' }
const store = new Map<string, unknown>(), listeners: Array<(value: any) => void> = [], stateListeners: Array<(value: any) => void> = []
let sequence = 0
const connection = { id: 'profile', name: 'Illustration studio', provider: 'openai', model: 'gpt-image-1', is_default: true, default_parameters: {} }
const api = {
  userStorage: { getJson: async (path: string, opts: any) => structuredClone(store.get(path) ?? (path === 'settings.json' ? { ...DEFAULT_SETTINGS, connectionId: 'profile' } : opts.fallback)), setJson: async (path: string, value: unknown) => { store.set(path, structuredClone(value)) } },
  characters: { get: async () => structuredClone(card), update: async (_id: string, patch: any) => { card = { ...card, ...patch }; return card } },
  imageGen: { getConnection: async () => connection, getProviders: async () => [], generate: async () => { await new Promise(r => setTimeout(r, 1200)); return { imageId: `generated-${++sequence}`, imageDataUrl: '', imageUrl: `/api/v1/images/generated-${sequence}` } } },
  images: { get: async (id: string) => ({ id, owner_extension_identifier: id.startsWith('generated') ? IDENTIFIER : null }) }, enclave: { get: async () => null },
}
const engine = new Engine(api as unknown as SpindleAPI, 'preview', (job, preview) => listeners.forEach(fn => fn({ type: 'gig:event', job, preview })))
const realFetch = window.fetch.bind(window)
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input)
  if (path === '/api/v1/settings/imageGeneration') return Response.json({ value: { activePromptPresetId: 'cinematic', promptParserConnectionId: 'text', promptPresets: [{ id: 'cinematic', name: 'Cinematic scene', prompt: 'Illustrate this scene with cinematic lighting.' }, { id: 'watercolor', name: 'Watercolor', prompt: 'Paint a soft watercolor illustration.' }] } })
  if (path.includes('/api/v1/connections/')) return Response.json({ name: 'Scene parser', model: 'Configured text model' })
  if (path.includes('/api/v1/chats/')) return Response.json({ character_id: 'mira' })
  if (path === '/api/v1/image-gen/preview-prompt') { await new Promise(r => setTimeout(r, 400)); return Response.json({ prompt: 'A cinematic illustration of a cartographer in a navy coat at a quiet railway station, warm evening light, painterly detail.', negativePrompt: 'text, watermark' }) }
  if (init?.method === 'DELETE') return Response.json({ deleted: false })
  return realFetch(input, init)
}) as typeof window.fetch
function mount(target: HTMLElement, options: any, tag: string) {
  const node = document.createElement(tag) as HTMLInputElement | HTMLSelectElement
  if (tag === 'select') for (const o of options.options || []) { const option = document.createElement('option'); option.value = o.value; option.textContent = o.label; node.append(option) }
  node.value = options.value ?? ''; node.setAttribute('aria-label', options.ariaLabel || ''); node.className = 'preview-control'
  node.addEventListener(tag === 'select' ? 'change' : 'input', () => options.onChange?.(node.type === 'number' ? node.value ? Number(node.value) : null : node.value)); target.append(node)
  return { destroy: () => node.remove(), update: (value: any) => { node.value = value.value }, getValue: () => node.value }
}
setup({
  ui: { registerDrawerTab: () => ({ root: document.querySelector('#mount'), onActivate: () => () => {}, setBadge: () => {}, destroy: () => {} }) },
  dom: { addStyle: (text: string) => { const s = document.createElement('style'); s.textContent = text; document.head.append(s); return () => s.remove() } },
  components: { mountSelect: (t: any, o: any) => mount(t, o, 'select'), mountTextInput: (t: any, o: any) => mount(t, o, 'input'), mountTextArea: (t: any, o: any) => mount(t, o, 'textarea'), mountNumericInput: (t: any, o: any) => mount(t, o, 'input') },
  state: { get: () => active, subscribe: (_id: string, fn: any) => { stateListeners.push(fn); return () => {} } },
  permissions: { getGranted: async () => ['characters', 'chats', 'images', 'image_gen'] }, characters: { get: async () => structuredClone(card) },
  events: { on: () => () => {} }, onBackendMessage: (fn: any) => { listeners.push(fn); return () => {} },
  sendToBackend: async (message: any) => {
    const p = message.input; let result: unknown, error: string | undefined
    try {
      switch (message.action) {
        case 'bootstrap': result = { settings: await engine.settings(), connections: [connection], providers: [{ id: 'openai', capabilities: { parameters: { size: { type: 'select', options: [{ id: '1024x1024', label: 'Square' }, { id: '1536x1024', label: 'Landscape' }] }, seed: { type: 'integer' } } } }], hasSecret: false }; break
        case 'load': result = { character: card, data: await engine.load(p.characterId) }; break
        case 'settings': result = await engine.saveSettings(p); break
        case 'guide': result = await engine.guide(p.characterId, p.guide); break
        case 'create': result = await engine.create(p); break
        case 'prepared': result = await engine.prepared(p.characterId, p.id, p.prompt); break
        case 'run': result = await engine.run(p.characterId, p.id, p.options); break
        case 'stop': result = await engine.stop(p.characterId, p.ids); break
        case 'failed': result = await engine.failed(p.characterId, p.id, p.error); break
        case 'undo': result = await engine.undo(p.characterId); break
        case 'remove': result = await engine.remove(p.characterId, p.index, p.original, p.occurrence); break
        case 'eligibility': result = await engine.fileEligibility(p.characterId, p.source); break
        case 'apply': result = await engine.apply(p.characterId, p.id, p.explicit); break
        default: throw new Error('This action is not enabled in the isolated preview')
      }
    } catch (e) { error = String(e) }
    const reply = structuredClone({ type: 'gig:reply', requestId: message.requestId, result, error }); queueMicrotask(() => listeners.forEach(fn => fn(reply)))
  },
} as any)
document.querySelector('#theme')!.addEventListener('click', () => { document.body.classList.toggle('light'); document.querySelector('#theme')!.textContent = document.body.classList.contains('light') ? 'Dark theme' : 'Light theme' })
document.querySelector('#width')!.addEventListener('click', () => { document.body.classList.toggle('narrow'); document.querySelector('#width')!.textContent = document.body.classList.contains('narrow') ? 'Wide drawer' : 'Narrow drawer' })
document.querySelector('#switch')!.addEventListener('click', () => { active = active.characterId ? {} : { characterId: 'mira', chatId: 'chat' }; stateListeners.forEach(fn => fn(active)) })
