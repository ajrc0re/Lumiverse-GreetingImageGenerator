import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import style from './styles.css' with { type: 'text' }
import { greetings, resolveImage, settingsFrom, supportsReference } from './core'
import { blobDataUrl, hostRequest, localDataUrl, prepareNative } from './native'
import { DEFAULT_SETTINGS, REQUIRED, type Character, type CharacterData, type Connection, type Greeting, type Guide, type ImageOccurrence, type Job, type NativeSettings, type Prompt, type Provider, type Settings } from './types'

const labels: Record<Job['stage'], string> = { queued: 'Queued', preparing: 'Preparing prompt', generating: 'Generating', uploading: 'Uploading', saving: 'Saving', review: 'Ready to add', complete: 'Complete', failed: 'Failed', stopped: 'Stopped' }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node
}
function button(text: string, action: () => unknown, cls = '') {
  const node = el('button', `gig-button ${cls}`, text); node.type = 'button'; node.onclick = () => { action() }; return node
}
function select(options: Array<[string, string]>, value: string, change: (value: string) => void, name: string) {
  const node = el('select'); node.setAttribute('aria-label', name)
  for (const [id, label] of options) { const option = el('option', '', label); option.value = id; node.append(option) }
  node.value = value; node.onchange = () => change(node.value); return node
}
function checkbox(text: string, checked: boolean, change: (checked: boolean) => void) {
  const label = el('label', 'gig-inline-check'), input = el('input'); input.type = 'checkbox'; input.checked = checked; input.onchange = () => change(input.checked); label.append(input, document.createTextNode(text)); return label
}
function image(url: string, alt: string, cls = '') {
  const img = el('img', cls); img.src = url; img.alt = alt; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; return img
}

export function setup(ctx: SpindleFrontendContext) {
  const tab = ctx.ui.registerDrawerTab({ id: 'greeting-images', title: 'Greeting Images', shortName: 'Images', headerTitle: 'Greeting Images', description: 'Illustrate your character’s existing greetings', keywords: ['greetings', 'images', 'catbox'], iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>' })
  const root = el('div', 'gig'); tab.root.append(root)
  const removeStyle = ctx.dom.addStyle(style)
  const tabs = el('div', 'gig-tabs'); tabs.setAttribute('role', 'tablist')
  const greetingPage = el('div', 'gig-page'), settingsPage = el('div', 'gig-page')
  greetingPage.id = 'gig-greetings'; settingsPage.id = 'gig-settings'
  greetingPage.setAttribute('role', 'tabpanel'); settingsPage.setAttribute('role', 'tabpanel')
  const banner = el('div'), batchBar = el('div', 'gig-batch'); batchBar.hidden = true
  let page = 'greetings', destroyed = false, settings = structuredClone(DEFAULT_SETTINGS), hasSecret = false
  let connections: Connection[] = [], providers: Provider[] = [], native: NativeSettings = {}, parserLabel = 'Inherited from native Image Generation settings'
  let character: Character | null = null, data: CharacterData = { guide: { style: '' }, jobs: [] }, active: { characterId?: string; chatId?: string } = {}
  let granted: string[] = [], query = '', field = 'text', filter = 'all', multi = false, loading = true, nativeError = ''
  let running = false, stopRequested = false, promptAbort: AbortController | undefined, batchIds: string[] = [], batchCharacter = ''
  let loadRevision = 0, settingsTimer: ReturnType<typeof setTimeout> | undefined
  let settingsWrites: Promise<unknown> = Promise.resolve()
  const selected = new Set<number>(), expanded = new Set<number>(), previews = new Map<string, string>()
  const pending = new Map<string, { resolve: (value: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const handles: Array<{ destroy(): void }> = [], disposers: Array<() => void> = []
  let closeSheet: (() => void) | undefined
  const batchJobs = new Map<string, Job>()
  function rpc<T = any>(action: string, input: unknown = {}, timeout = 360_000): Promise<T> {
    if (destroyed) return Promise.reject(new Error('Extension closed'))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('The extension request timed out. Check recent jobs before retrying.')) }, timeout)
      pending.set(requestId, { resolve, reject, timer }); ctx.sendToBackend({ type: 'gig:request', requestId, action, input })
    })
  }
  function notify(message: string, error = false) {
    banner.replaceChildren(); root.querySelector('.gig-sheet-notice')?.remove()
    const notice = el('div', `gig-notice${error ? ' error' : ''}`, message)
    notice.setAttribute('role', error ? 'alert' : 'status'); const dismiss = button('Dismiss', () => notice.remove(), 'gig-link'); notice.append(document.createTextNode(' '), dismiss)
    const panel = root.querySelector('.gig-sheet')
    if (panel) { notice.classList.add('gig-sheet-notice'); panel.children[0]?.after(notice) } else banner.append(notice)
  }
  function safe(fn: () => unknown) { return async () => { try { await fn() } catch (e) { notify(e instanceof Error ? e.message : String(e), true) } } }
  const action = (text: string, fn: () => unknown, cls = '') => button(text, safe(fn), cls)
  function showPage(value: string) {
    page = value; greetingPage.hidden = value !== 'greetings'; settingsPage.hidden = value !== 'settings'
    for (const child of tabs.children) { const b = child as HTMLButtonElement; const chosen = b.dataset.page === value; b.setAttribute('aria-selected', String(chosen)); b.tabIndex = chosen ? 0 : -1 }
  }
  for (const [id, title] of [['greetings', 'Greetings'], ['settings', 'Settings']]) {
    const b = button(title, () => showPage(id), 'gig-tab'); b.className = 'gig-tab'; b.dataset.page = id; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', `gig-${id}`)
    b.onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); showPage(page === 'settings' ? 'greetings' : 'settings'); (tabs.querySelector('[aria-selected=true]') as HTMLElement)?.focus() } }; tabs.append(b)
  }
  root.append(tabs, banner, greetingPage, settingsPage, batchBar); showPage(page)
  function permitted() { return REQUIRED.every(p => granted.includes(p)) }
  async function requirePermissions() { granted = await ctx.permissions.getGranted(); if (!permitted()) throw new Error(`Grant extension permissions: ${REQUIRED.filter(p => !granted.includes(p)).join(', ')}`) }
  function saveSettings() {
    clearTimeout(settingsTimer)
    settingsTimer = setTimeout(() => { const snapshot = structuredClone(settings); settingsWrites = settingsWrites.then(() => rpc('settings', snapshot)).catch(e => notify(String(e), true)) }, 300)
  }
  async function saveGuide(guide: Guide) {
    if (!character) return
    const characterId = character.id; data.guide = structuredClone(guide)
    await rpc('guide', { characterId, guide })
  }
  async function loadNative() {
    try {
      const row = await hostRequest<{ value: NativeSettings }>('/settings/imageGeneration')
      native = row.value || {}; nativeError = ''
      const id = native.promptParserConnectionId
      parserLabel = id ? `Native text profile: ${id}${native.promptParserModel ? ` · ${native.promptParserModel}` : ''}` : 'Native parser uses its configured preset or Council sidecar'
      if (id) {
        try { const p = await hostRequest<{ name: string; model: string }>(`/connections/${encodeURIComponent(id)}`); parserLabel = `${p.name} · ${native.promptParserModel || p.model}` } catch { /* The profile identifier still accurately identifies the inherited configuration. */ }
      }
    } catch (e) { nativeError = `Native prompt settings unavailable: ${e instanceof Error ? e.message : String(e)}` }
  }
  async function bootstrap(initial = false) {
    granted = await ctx.permissions.getGranted()
    const boot = await rpc<{ settings: Settings; connections: Connection[]; providers: Provider[]; hasSecret: boolean }>('bootstrap')
    if (initial) settings = settingsFrom(boot.settings)
    connections = boot.connections; providers = boot.providers; hasSecret = boot.hasSecret
    if (!settings.connectionId) settings.connectionId = connections.find(c => c.is_default)?.id || connections[0]?.id || ''
    await loadNative(); renderSettings(); await loadCharacter()
  }
  async function loadCharacter() {
    const revision = ++loadRevision; const id = active.characterId
    if (!id || !permitted()) { character = null; loading = false; renderGreetings(); return }
    loading = true; renderGreetings()
    try {
      const loaded = await rpc<{ character: Character | null; data: CharacterData }>('load', { characterId: id })
      if (revision !== loadRevision || destroyed) return
      character = loaded.character; data = loaded.data; loading = false; renderGreetings(); renderSettings()
    } catch (e) { if (revision === loadRevision) { loading = false; character = null; renderGreetings(); throw e } }
  }
  function visibleGreetings() {
    return character ? greetings(character).filter(g => (filter === 'all' || (filter === 'without' ? !g.images.length : !!g.images.length)) && (field === 'title' ? g.title : g.text).toLowerCase().includes(query.toLowerCase())) : []
  }
  function currentJob(g: Greeting) { return [...data.jobs].reverse().find(j => j.index === g.index && !j.imageDeleted) }
  function renderGreetings() {
    const scroll = greetingPage.scrollTop; greetingPage.replaceChildren()
    if (!permitted()) {
      const box = el('div', 'gig-empty'); box.append(el('h2', '', 'Permissions needed'), el('p', '', 'Grant Characters, Chats, Images, and Image generation access in Lumiverse’s extension permissions.'))
      box.append(action('Check permissions', () => bootstrap())); greetingPage.append(box); return
    }
    if (!character) {
      const box = el('div', 'gig-empty'); box.append(el('div', 'gig-empty-symbol', '▧'), el('h2', '', loading ? 'Loading greetings…' : 'No character selected'), el('p', '', 'Open a character’s chat to illustrate its greetings.')); greetingPage.append(box); return
    }
    const char = character, all = greetings(char), visible = visibleGreetings()
    const heading = el('div', 'gig-heading'), headingText = el('div', 'gig-grow')
    if (char.image_id) heading.append(image(`/api/v1/images/${char.image_id}?size=sm`, '', 'gig-avatar'))
    headingText.append(el('h2', '', char.name), el('span', 'gig-muted', `${all.length} greetings · ${all.filter(g => g.images.length).length} illustrated`)); heading.append(headingText); greetingPage.append(heading)
    if (!active.chatId) greetingPage.append(el('div', 'gig-notice', 'Open this character’s chat to use the native prompt parser. Existing images can still be managed.'))
    const tools = el('div', 'gig-toolbar'), search = el('div', 'gig-search'), input = el('input')
    input.type = 'search'; input.placeholder = 'Find a greeting…'; input.value = query; input.setAttribute('aria-label', 'Search greetings')
    input.oninput = () => { const pos = input.selectionStart; query = input.value; renderGreetings(); const next = greetingPage.querySelector<HTMLInputElement>('input[type=search]'); next?.focus(); if (pos !== null) next?.setSelectionRange(pos, pos) }
    search.append(select([['text', 'Text'], ['title', 'Title']], field, value => { field = value; renderGreetings() }, 'Search field'), input)
    const controls = el('div', 'gig-row'); controls.append(select([['all', 'All greetings'], ['without', 'Without images'], ['with', 'With images']], filter, value => { filter = value; renderGreetings() }, 'Image filter'), checkbox('Multiselect', multi, value => { multi = value; if (!multi) selected.clear(); renderGreetings() }))
    tools.append(search, controls)
    if (multi) {
      const row = el('div', 'gig-row'), hidden = [...selected].filter(i => !visible.some(g => g.index === i)).length
      row.append(action('Select all', () => { visible.forEach(g => selected.add(g.index)); renderGreetings() }), action('Clear selection', () => { selected.clear(); renderGreetings() }), el('span', 'gig-muted', `${selected.size} selected${hidden ? ` · ${hidden} hidden` : ''}`))
      const generate = action(`Generate selected (${selected.size})`, () => startBatch(all.filter(g => selected.has(g.index))), 'gig-primary'); generate.disabled = running || !selected.size || !active.chatId; row.append(generate); tools.append(row)
    }
    const utility = el('div', 'gig-row'); utility.append(action('Refresh greetings', loadCharacter, 'gig-link'))
    if (data.undo) utility.append(action('Undo last image edit', async () => { await rpc('undo', { characterId: char.id }); await loadCharacter(); notify('Last image edit undone.') }, 'gig-link'))
    tools.append(utility); greetingPage.append(tools)
    const list = el('div', 'gig-list')
    if (!visible.length) list.append(el('div', 'gig-empty', 'No greetings match these filters.'))
    for (const greeting of visible) {
      const card = el('article', `gig-card${selected.has(greeting.index) ? ' is-selected' : ''}`), head = el('div', 'gig-card-header')
      if (multi) { const check = checkbox('', selected.has(greeting.index), value => { if (value) selected.add(greeting.index); else selected.delete(greeting.index); renderGreetings() }); check.querySelector('input')!.setAttribute('aria-label', `Select ${greeting.title}`); head.append(check) }
      head.append(el('span', 'gig-number', String(greeting.index + 1).padStart(2, '0')), el('h3', '', greeting.title))
      const job = currentJob(greeting)
      if (job) { const status = el('span', `gig-status ${['generating', 'preparing', 'uploading', 'saving'].includes(job.stage) ? 'busy' : job.stage}`, labels[job.stage]); status.setAttribute('aria-live', 'polite'); head.append(status) }
      card.append(head)
      // Plain text previews are intentional: card-authored HTML never executes.
      let preview = greeting.text
      for (const occurrence of [...greeting.images].reverse()) preview = preview.slice(0, occurrence.start) + preview.slice(occurrence.end)
      card.append(el('p', `gig-text${expanded.has(greeting.index) ? '' : ' collapsed'}`, preview.trim() || (greeting.text ? 'Image greeting' : 'Empty greeting')))
      if (preview.length > 220 || preview.split('\n').length > 4) card.append(action(expanded.has(greeting.index) ? 'Show less' : 'Read greeting', () => { if (expanded.has(greeting.index)) expanded.delete(greeting.index); else expanded.add(greeting.index); renderGreetings() }, 'gig-link'))
      const images = el('div', 'gig-images')
      for (const occurrence of greeting.images) {
        const resolved = resolveImage(occurrence.source, char), tile = el('div', 'gig-image')
        const view = action('', () => viewImage(char, greeting, occurrence)); view.className = ''; view.setAttribute('aria-label', `Preview ${occurrence.alt || 'greeting image'}`)
        if (resolved.url) { const img = image(resolved.url, occurrence.alt || 'Greeting image'); img.onerror = () => view.replaceChildren(document.createTextNode('Image unavailable')); view.append(img) } else view.textContent = 'Unresolved image'
        const remove = action('×', () => removeImage(char, greeting, occurrence)); remove.className = 'gig-remove'; remove.setAttribute('aria-label', 'Remove this image'); remove.disabled = running
        tile.append(view, remove); images.append(tile)
      }
      if (job && previews.has(job.id)) { const tile = el('div', 'gig-image'); tile.append(image(previews.get(job.id)!, 'Generation preview')); images.append(tile) }
      const plus = action('+', () => startBatch([greeting])); plus.className = 'gig-plus'; plus.title = 'Generate a new image'; plus.setAttribute('aria-label', `Generate an image for ${greeting.title}`); plus.disabled = running || !active.chatId; images.append(plus); card.append(images)
      const actions = el('div', 'gig-row')
      const editPrompt = action('View/edit image prompt', () => prepareForReview(greeting), 'gig-link'); editPrompt.disabled = running || !active.chatId
      const attach = action('Attach image', () => attachImage(char, greeting), 'gig-link'); attach.disabled = running
      actions.append(editPrompt, attach); card.append(actions)
      if (job?.error) card.append(el('p', 'gig-muted', job.error))
      if (job && ['review', 'failed', 'stopped', 'queued'].includes(job.stage)) card.append(recovery(job, char))
      list.append(card)
    }
    greetingPage.append(list)
    const old = data.jobs.filter(j => !j.imageDeleted && j.imageId && !j.inserted && !visible.some(g => currentJob(g)?.id === j.id))
    if (old.length) {
      const section = el('details', 'gig-section'); section.append(el('summary', '', `Saved results (${old.length})`))
      for (const job of old) { const block = el('div', 'gig-card'); block.append(el('h3', '', job.title), recovery(job, char)); section.append(block) }
      greetingPage.append(section)
    }
    greetingPage.scrollTop = scroll; renderBatch()
  }
  function recovery(job: Job, char: Character) {
    const panel = el('div', 'gig-recovery'), row = el('div', 'gig-row')
    if (job.imageId || job.publicUrl) {
      if (job.localUrl || job.publicUrl) { const thumb = image(job.publicUrl || job.localUrl!, 'Saved result', 'gig-reference'); panel.append(thumb) }
      const add = action('Apply to greeting…', () => applyResult(job, char)); add.disabled = running; row.append(add)
      if (!job.publicUrl && job.settings.host !== 'local') {
        const retry = action('Retry upload', () => retryJobs([job])); retry.disabled = running; row.append(retry)
        const local = action('Use local', () => applyResult(job, char, true)); local.disabled = running; row.append(local)
      }
      if (job.imageId) row.append(action('Use as set reference', async () => { await saveGuide({ ...data.guide, referenceId: job.imageId }); renderSettings(); notify('Set reference selected.') }, 'gig-link'))
    } else {
      const retry = action(job.prompt ? 'Generate image' : 'Retry prompt', () => retryJobs([job])); retry.disabled = running; row.append(retry)
    }
    panel.append(row); return panel
  }
  function sheet(title: string) {
    closeSheet?.(); const previous = document.activeElement as HTMLElement | null
    const panel = el('section', 'gig-sheet'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title); panel.setAttribute('aria-modal', 'true')
    const header = el('div', 'gig-row'); header.append(el('h2', 'gig-grow', title)); panel.append(header)
    greetingPage.inert = true; settingsPage.inert = true; tabs.inert = true; batchBar.inert = true
    let cancel: (() => void) | undefined
    const close = () => { cancel?.(); panel.remove(); greetingPage.inert = false; settingsPage.inert = false; tabs.inert = false; batchBar.inert = false; closeSheet = undefined; previous?.focus() }
    closeSheet = close; header.append(action('Close', close, 'gig-link'))
    panel.onkeydown = event => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]'))
        const first = focusable[0], last = focusable.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    root.append(panel); (header.querySelector('button') as HTMLElement)?.focus()
    return { panel, close, onCancel(fn: () => void) { cancel = fn } }
  }
  async function confirm(title: string, text: string, label: string): Promise<boolean> {
    const s = sheet(title); s.panel.append(el('p', '', text))
    return new Promise(resolve => {
      s.onCancel(() => resolve(false)); const row = el('div', 'gig-actions')
      row.append(action('Cancel', s.close), action(label, () => { resolve(true); s.close() }, 'gig-primary')); s.panel.append(row)
    })
  }
  async function viewImage(char: Character, greeting: Greeting, occurrence: ImageOccurrence) {
    const resolved = resolveImage(occurrence.source, char), s = sheet(occurrence.alt || greeting.title)
    if (resolved.url) s.panel.append(image(resolved.url, occurrence.alt || greeting.title))
    else s.panel.append(el('p', '', 'This asset reference could not be resolved.'))
    s.panel.append(el('p', 'gig-muted', occurrence.source))
    const row = el('div', 'gig-actions')
    row.append(action('Copy image link', async () => { await navigator.clipboard.writeText(resolved.url ? new URL(resolved.url, location.origin).href : occurrence.source); notify('Image link copied.') }))
    if (resolved.url) row.append(action('Use as set reference', async () => {
      await requirePermissions()
      let referenceId = resolved.imageId
      if (!referenceId) {
        let response: Response
        try { response = await fetch(resolved.url!, { credentials: 'omit' }) }
        catch { throw new Error('This image host blocks browser downloads. Download the image, then use Upload reference in Settings.') }
        if (!response.ok) throw new Error('Could not download this image. Use Upload reference in Settings instead.')
        const dataUrl = await blobDataUrl(await response.blob())
        referenceId = await rpc<string>('reference-upload', { characterId: char.id, dataUrl })
      }
      if (character?.id !== char.id) return
      await saveGuide({ ...data.guide, referenceId }); renderSettings(); s.close(); notify('Set reference selected.')
    }))
    s.panel.append(row)
  }
  async function removeImage(char: Character, greeting: Greeting, occurrence: ImageOccurrence) {
    const eligible = await rpc<{ local: boolean; catbox: boolean; imageId?: string }>('eligibility', { characterId: char.id, source: occurrence.source })
    const s = sheet('Remove image'), row = el('div', 'gig-actions'); let permanent = false
    s.panel.append(el('p', '', 'Remove this image occurrence from the greeting? Other image occurrences and the greeting text will remain.'))
    if (eligible.local || eligible.catbox) {
      s.panel.append(checkbox('Also permanently delete the stored file', false, value => { permanent = value }), el('p', 'gig-muted', eligible.catbox ? 'Deleting this public file breaks every shared link to it. Permanent deletion cannot be undone.' : 'Local deletion is allowed only if Lumiverse finds no remaining references. Permanent deletion cannot be undone.'))
    }
    row.append(action('Cancel', s.close), action('Remove image', async () => {
      await requirePermissions()
      await rpc('remove', { characterId: char.id, index: greeting.index, original: greeting.text, occurrence })
      let message = 'Image removed. Undo is available.', deletionError = false
      try { if (permanent) {
        // Re-check ownership immediately before the separate irreversible action.
        const verified = await rpc<typeof eligible>('eligibility', { characterId: char.id, source: occurrence.source })
        if (verified.local && verified.imageId) {
          const result = await hostRequest<{ deleted: boolean }>(`/images/${encodeURIComponent(verified.imageId)}?unused=true`, 'DELETE')
          if (result.deleted) { await rpc('deleted-local', { characterId: char.id, imageId: verified.imageId }); message = 'Image removed and local file deleted.' }
          else message = 'Image removed. The local file is still referenced elsewhere and was retained.'
        } else if (verified.catbox) { await rpc('delete-public', { characterId: char.id, source: occurrence.source }); message = 'Image removed and Catbox confirmed file deletion.' }
        else message = 'Image removed. File ownership could not be verified; the file was retained.'
      } } catch (error) { message = `The image was removed from the greeting, but file deletion could not be confirmed: ${String(error)}`; deletionError = true }
      s.close(); await loadCharacter(); notify(message, deletionError)
    }, 'gig-danger')); s.panel.append(row)
  }
  async function pickDataUrl() {
    return new Promise<string | undefined>(resolve => {
      const input = el('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif'; input.oncancel = () => resolve(undefined)
      input.onchange = () => { const file = input.files?.[0]; if (!file) return resolve(undefined); blobDataUrl(file).then(resolve).catch(e => { notify(String(e), true); resolve(undefined) }) }; input.click()
    })
  }
  function attachImage(char: Character, greeting: Greeting) {
    const s = sheet('Attach an existing image'), url = el('input'); url.type = 'url'; url.placeholder = 'https://…'; url.setAttribute('aria-label', 'Image URL')
    s.panel.append(el('p', 'gig-muted', 'Upload a local image or embed an existing public image URL. Existing URLs are used as-is; files are stored locally.'), url)
    const attach = async (input: { dataUrl?: string; url?: string }) => { await rpc('attach', { ...input, characterId: char.id, index: greeting.index, original: greeting.text, title: greeting.title, settings }); s.close(); await loadCharacter() }
    const row = el('div', 'gig-actions'); row.append(action('Choose image file', async () => { const dataUrl = await pickDataUrl(); if (dataUrl) await attach({ dataUrl }) }), action('Attach URL', () => attach({ url: url.value }), 'gig-primary')); s.panel.append(row)
  }
  async function applyResult(job: Job, char: Character, local = false) {
    const fresh = await ctx.characters.get(char.id) as Character
    const options = greetings(fresh), s = sheet('Apply saved image')
    s.panel.append(el('p', 'gig-muted', 'Choose the greeting that should receive this saved image. Its current text will be preserved.'))
    let index = Math.min(job.index, options.length - 1)
    s.panel.append(select(options.map(g => [String(g.index), g.title]), String(index), value => { index = Number(value) }, 'Destination greeting'))
    const row = el('div', 'gig-actions'); row.append(action('Cancel', s.close), action('Add image', async () => {
      await rpc('apply', { characterId: char.id, id: job.id, explicit: { index, original: options[index].text, local } }); s.close(); await loadCharacter(); notify('Saved image added.')
    }, 'gig-primary')); s.panel.append(row)
  }
  function batchContext() {
    if (!character || !active.chatId) throw new Error('Open the character’s chat first')
    return { characterId: character.id, chatId: active.chatId, settings: structuredClone(settings), guide: structuredClone(data.guide) }
  }
  async function makeJob(greeting: Greeting, snapshot = batchContext()) {
    await requirePermissions()
    const chat = await hostRequest<{ character_id: string }>(`/chats/${encodeURIComponent(snapshot.chatId)}`)
    if (chat.character_id !== snapshot.characterId) throw new Error('The active chat must belong to this character')
    if (!connections.some(c => c.id === snapshot.settings.connectionId)) throw new Error('Choose an image connection in Settings')
    if (snapshot.settings.host === 'catbox-auth' && !hasSecret) throw new Error('Save a Catbox userhash in Settings before generating, or choose Local storage')
    const job = await rpc<Job>('create', { ...snapshot, index: greeting.index, original: greeting.text, title: greeting.title })
    if (character?.id === job.characterId) data.jobs.push(job)
    batchJobs.set(job.id, job); return job
  }
  async function getPrompt(job: Job) {
    if (job.prompt) return job.prompt
    await requirePermissions()
    const chat = await hostRequest<{ character_id: string }>(`/chats/${encodeURIComponent(job.chatId)}`)
    if (chat.character_id !== job.characterId) throw new Error('The original chat is no longer available for this character')
    await loadNative(); if (nativeError) throw new Error(nativeError)
    job.stage = 'preparing'; updateJob(job)
    promptAbort = new AbortController()
    const timeout = setTimeout(() => promptAbort?.abort(), 130_000)
    try {
      const prompt = await prepareNative(job, native, hostRequest, promptAbort.signal)
      if (stopRequested) throw new Error('Stopped before image generation')
      const prepared = await rpc<Job>('prepared', { characterId: job.characterId, id: job.id, prompt }); Object.assign(job, prepared); updateJob(job); return prompt
    } finally { clearTimeout(timeout); promptAbort = undefined }
  }
  async function editPrompt(job: Job): Promise<boolean> {
    const s = sheet(`Image prompt · ${job.title}`), positive = el('textarea'), negative = el('textarea')
    positive.value = job.prompt?.prompt || ''; positive.rows = 10; positive.setAttribute('aria-label', 'Image prompt')
    negative.value = job.prompt?.negativePrompt || ''; negative.rows = 3; negative.setAttribute('aria-label', 'Negative prompt')
    s.panel.append(el('p', 'gig-muted', 'Edit the image prompt. The greeting itself will not change.'), positive, el('label', '', 'Negative prompt'), negative)
    return new Promise(resolve => {
      s.onCancel(() => resolve(false)); const row = el('div', 'gig-actions')
      row.append(action('Save prompt only', async () => { const prepared = await rpc<Job>('prepared', { characterId: job.characterId, id: job.id, prompt: { prompt: positive.value, negativePrompt: negative.value } }); Object.assign(job, prepared); updateJob(job); resolve(false); s.close() }), action('Generate image', async () => { const prepared = await rpc<Job>('prepared', { characterId: job.characterId, id: job.id, prompt: { prompt: positive.value, negativePrompt: negative.value } }); Object.assign(job, prepared); updateJob(job); resolve(true); s.close() }, 'gig-primary')); s.panel.append(row)
    })
  }
  async function prepareForReview(greeting: Greeting) {
    if (running) return
    running = true; stopRequested = false
    let job: Job | undefined
    try {
      const reusable = [...data.jobs].reverse().find(j => j.index === greeting.index && j.original === greeting.text && j.prompt && !j.generationStarted)
      job = reusable || await makeJob(greeting); batchIds = [job.id]; batchCharacter = job.characterId; batchJobs.set(job.id, job)
      await getPrompt(job)
      if (await editPrompt(job)) await executeJob(job)
    } catch (e) {
      if (job) await rpc('failed', { characterId: job.characterId, id: job.id, error: String(e) })
      throw e
    } finally { running = false; renderBatch(); await loadCharacter() }
  }
  async function startBatch(items: Greeting[]) {
    if (running || !items.length) return
    if (items.length > 50) throw new Error('Select up to 50 greetings per batch')
    const snapshot = batchContext()
    const preparedJobs = [...data.jobs]
    running = true; stopRequested = false; batchIds = []; batchJobs.clear(); renderGreetings()
    try {
      const jobs: Job[] = []
      for (const greeting of items) {
        const cached = [...preparedJobs].reverse().find(j => j.characterId === snapshot.characterId && j.index === greeting.index && j.original === greeting.text && j.prompt && !j.generationStarted && !j.inserted)
        if (stopRequested) break
        const job = cached || await makeJob(greeting, snapshot); jobs.push(job); batchIds.push(job.id); batchJobs.set(job.id, job); batchCharacter = job.characterId
      }
      for (const job of jobs) {
        if (stopRequested || destroyed) break
        try { await getPrompt(job); if (job.settings.reviewPrompt && !await editPrompt(job)) continue; if (!stopRequested) await executeJob(job) }
        catch (e) { await rpc('failed', { characterId: job.characterId, id: job.id, error: String(e) }); job.error = String(e); job.stage = stopRequested ? 'stopped' : 'failed'; updateJob(job) }
      }
    } finally { running = false; renderBatch(); await loadCharacter() }
  }
  async function executeJob(job: Job, retryGeneration = false) {
    if (stopRequested) return
    const options: { referenceDataUrl?: string; imageDataUrl?: string; retryGeneration: boolean } = { retryGeneration }
    const connection = connections.find(c => c.id === job.settings.connectionId)
    if (!job.imageId && job.guide.referenceId && connection && supportsReference(connection.provider)) options.referenceDataUrl = await localDataUrl(job.guide.referenceId)
    if (job.imageId && !job.publicUrl && job.settings.host !== 'local') options.imageDataUrl = await localDataUrl(job.imageId)
    if (stopRequested) return
    const result = await rpc<Job>('run', { characterId: job.characterId, id: job.id, options }); updateJob(result)
    if (character?.id === job.characterId) await loadCharacter()
  }
  async function retryJobs(jobs: Job[]) {
    if (running) return
    let retryGeneration = false
    if (jobs.some(j => j.generationStarted && !j.imageId)) {
      retryGeneration = await confirm('Start another generation?', 'An interrupted request may have completed at the provider. Retrying can incur another charge. Check your image library first.', 'Generate again')
      if (!retryGeneration) return
    }
    running = true; stopRequested = false; batchIds = jobs.map(j => j.id); batchJobs.clear(); jobs.forEach(j => batchJobs.set(j.id, j)); batchCharacter = jobs[0]?.characterId || ''; renderGreetings()
    try { for (const job of jobs) { if (stopRequested) break; try { await getPrompt(job); await executeJob(job, retryGeneration) } catch (e) { await rpc('failed', { characterId: job.characterId, id: job.id, error: String(e) }) } } }
    finally { running = false; await loadCharacter() }
  }
  function updateJob(job: Job) {
    if (batchIds.includes(job.id)) batchJobs.set(job.id, job)
    if (character?.id === job.characterId) { const index = data.jobs.findIndex(j => j.id === job.id); if (index >= 0) data.jobs[index] = job; else data.jobs.push(job) }
    if (!['generating'].includes(job.stage)) previews.delete(job.id)
    renderGreetings(); renderBatch()
  }
  function renderBatch() {
    batchBar.replaceChildren(); batchBar.hidden = !batchIds.length
    if (!batchIds.length) return
    const jobs = batchIds.map(id => batchJobs.get(id)).filter((j): j is Job => !!j), finished = jobs.filter(j => ['complete', 'review', 'failed', 'stopped'].includes(j.stage)).length
    const row = el('div', 'gig-row'); row.append(el('span', 'gig-grow', `${running ? 'Illustrating greetings' : 'Batch finished'} · ${finished}/${batchIds.length}`))
    if (running) row.append(action('Stop', async () => { stopRequested = true; promptAbort?.abort(); closeSheet?.(); await rpc('stop', { characterId: batchCharacter, ids: batchIds }); renderBatch() }))
    else {
      const failed = jobs.filter(j => j.stage === 'failed' || j.stage === 'stopped')
      if (failed.length) row.append(action('Retry failed', () => retryJobs(failed)))
      row.append(action('Dismiss', () => { batchIds = []; renderBatch() }, 'gig-link'))
    }
    const progress = el('progress'); progress.max = batchIds.length; progress.value = finished; progress.setAttribute('aria-label', 'Batch progress'); batchBar.append(row, progress)
    tab.setBadge(running ? String(Math.max(0, batchIds.length - finished)) : '')
  }
  function renderSettings() {
    const scroll = settingsPage.scrollTop
    const open = new Set(Array.from(settingsPage.querySelectorAll<HTMLDetailsElement>('details[open]')).map(d => d.dataset.section))
    const first = !settingsPage.children.length
    handles.splice(0).forEach(h => h.destroy()); settingsPage.replaceChildren()
    settingsPage.append(el('h2', '', 'Make it your own'), el('p', 'gig-muted', 'Use your existing Lumiverse connections. Changes are saved automatically.'))
    const section = (name: string, initially = false) => { const d = el('details', 'gig-section'); d.dataset.section = name; d.open = first ? initially : open.has(name); d.append(el('summary', '', name)); settingsPage.append(d); return d }
    const field = (parent: HTMLElement, label: string) => { const f = el('div', 'gig-field'); f.append(el('label', '', label)); const target = el('div'); f.append(target); parent.append(f); return target }
    const nativeSelect = (parent: HTMLElement, label: string, options: Array<[string, string]>, value: string, change: (v: string) => void) => {
      const target = field(parent, label)
      handles.push(ctx.components.mountSelect(target, { options: options.map(([value, label]) => ({ value, label })), value, onChange: change, ariaLabel: label, portal: false }))
    }
    const nativeText = (parent: HTMLElement, label: string, value: string, change: (v: string) => void, area = false) => {
      const target = field(parent, label)
      handles.push(area ? ctx.components.mountTextArea(target, { value, onChange: change, rows: 4, ariaLabel: label }) : ctx.components.mountTextInput(target, { value, onChange: change, ariaLabel: label }))
    }
    const generation = section('Image generation', true)
    nativeSelect(generation, 'Image connection profile', [['', 'Select a profile'], ...connections.map(c => [c.id, `${c.name} · ${c.provider}`] as [string, string])], settings.connectionId, value => { settings.connectionId = value; settings.parameters = {}; settings.model = ''; saveSettings(); renderSettings() })
    nativeText(generation, 'Model override (blank inherits profile)', settings.model, value => { settings.model = value; saveSettings() })
    generation.append(action('Refresh profiles and presets', () => bootstrap(), 'gig-link'))
    const prompts = section('Native prompt generation', true)
    prompts.append(el('p', 'gig-muted', parserLabel), el('div', 'gig-notice', 'Uses Lumiverse’s Chat-aware custom parser and its live chat context. The text profile is inherited; the image profile above is independent. An active chat for this character is required.'))
    if (nativeError) prompts.append(el('p', 'gig-muted', nativeError))
    nativeSelect(prompts, 'Native prompt preset', [['', 'Use native active preset'], ...(native.promptPresets || []).map(p => [p.id, p.name] as [string, string])], settings.presetId, value => { settings.presetId = value; saveSettings() })
    nativeText(prompts, 'Additional image instructions', settings.instructions, value => { settings.instructions = value; saveSettings() }, true)
    prompts.append(checkbox('Review prompts before generating', settings.reviewPrompt, value => { settings.reviewPrompt = value; saveSettings() }))
    const storage = section('Storage', true)
    nativeSelect(storage, 'Image storage', [['local', 'Local · Lumiverse'], ['catbox-anon', 'Catbox · anonymous'], ['catbox-auth', 'Catbox · authenticated']], settings.host, value => { settings.host = value as Settings['host']; saveSettings(); renderSettings() })
    storage.append(el('p', 'gig-muted', settings.host === 'local' ? 'Images stay on this Lumiverse server. Local URLs require access to it and are not portable card attachments.' : 'Images are public on Catbox; a local original is also retained. Anonymous uploads expire after two years without access. Catbox access can be blocked by some networks.'))
    if (settings.host === 'catbox-auth') {
      const secret = el('input'); secret.type = 'password'; secret.autocomplete = 'new-password'; secret.placeholder = hasSecret ? 'Userhash saved securely' : 'Paste your Catbox userhash'; secret.setAttribute('aria-label', 'Catbox userhash'); field(storage, 'Catbox account userhash').append(secret)
      const row = el('div', 'gig-row'); row.append(action('Save userhash', async () => { await rpc('secret', { value: secret.value }); secret.value = ''; hasSecret = true; notify('Catbox userhash saved securely.'); renderSettings() }), action('Clear', async () => { await rpc('secret-clear'); hasSecret = false; renderSettings() })); storage.append(row)
    }
    const placement = section('Image placement')
    nativeSelect(placement, 'Insert new images', [['end', 'At the end'], ['start', 'At the beginning']], settings.placement, value => { settings.placement = value as Settings['placement']; saveSettings() })
    placement.append(checkbox('Review images before adding them', settings.review, value => { settings.review = value; saveSettings() }))
    const guide = section('Consistent set', true)
    if (!character) guide.append(el('p', 'gig-muted', 'Select a character to configure its style and reference.'))
    else {
      const charId = character.id
      guide.append(el('p', 'gig-muted', `Saved for ${character.name}. Every image uses these instructions; no extra text-generation stage is added.`))
      nativeText(guide, 'Shared appearance and art direction', data.guide.style, value => { if (character?.id !== charId) return; data.guide.style = value; void rpc('guide', { characterId: charId, guide: structuredClone(data.guide) }).catch(e => notify(String(e), true)) }, true)
      if (data.guide.referenceId) guide.append(image(`/api/v1/images/${encodeURIComponent(data.guide.referenceId)}?size=sm`, 'Set reference', 'gig-reference'))
      const row = el('div', 'gig-row')
      if (character.image_id) row.append(action('Use avatar', async () => { await saveGuide({ ...data.guide, referenceId: character!.image_id! }); renderSettings() }))
      row.append(action('Upload reference', async () => { const dataUrl = await pickDataUrl(); if (!dataUrl) return; const referenceId = await rpc<string>('reference-upload', { characterId: charId, dataUrl }); if (character?.id === charId) { await saveGuide({ ...data.guide, referenceId }); renderSettings() } }), action('Clear reference', async () => { await saveGuide({ style: data.guide.style }); renderSettings() }, 'gig-link')); guide.append(row)
      const provider = connections.find(c => c.id === settings.connectionId)?.provider || ''
      guide.append(el('p', 'gig-muted', supportsReference(provider) ? 'Reference images are forwarded to this provider. Results depend on the selected model; matching appearance is not guaranteed.' : 'This provider uses shared text instructions only. Reference conditioning is supported for OpenAI, Google Gemini, and OpenRouter.'))
    }
    const advanced = section('Advanced')
    const provider = providers.find(p => p.id === connections.find(c => c.id === settings.connectionId)?.provider)
    for (const [key, schema] of Object.entries(provider?.capabilities.parameters || {})) {
      if (!['width', 'height', 'resolution', 'aspectRatio', 'aspect_ratio', 'imageSize', 'size', 'seed'].includes(key)) continue
      if (schema.options?.length) nativeSelect(advanced, `${key} override`, [['', 'Inherit profile'], ...schema.options.map(o => [o.id, o.label] as [string, string])], String(settings.parameters[key] ?? ''), value => { if (value) settings.parameters[key] = value; else delete settings.parameters[key]; saveSettings() })
      else if (schema.type === 'integer' || schema.type === 'number') {
        const target = field(advanced, `${key} override`)
        handles.push(ctx.components.mountNumericInput(target, { value: typeof settings.parameters[key] === 'number' ? settings.parameters[key] as number : null, allowEmpty: true, integer: schema.type === 'integer', min: schema.min, max: schema.max, step: schema.step, placeholder: 'Inherit profile', ariaLabel: `${key} override`, onChange: value => { if (value === null) delete settings.parameters[key]; else settings.parameters[key] = value; saveSettings() } }))
      } else nativeText(advanced, `${key} override`, String(settings.parameters[key] ?? ''), value => { if (value) settings.parameters[key] = value; else delete settings.parameters[key]; saveSettings() })
    }
    nativeText(advanced, 'Negative prompt override (provider dependent)', settings.negativePrompt, value => { settings.negativePrompt = value; saveSettings() }, true)
    advanced.append(action('Reset generation overrides', () => { settings.parameters = {}; settings.model = ''; settings.negativePrompt = ''; saveSettings(); renderSettings() }, 'gig-link'))
    settingsPage.scrollTop = scroll
  }
  disposers.push(ctx.onBackendMessage((payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const m = payload as { type: string; requestId: string; result?: unknown; error?: string; job?: Job; preview?: string }
    if (m.type === 'gig:reply') { const entry = pending.get(m.requestId); if (!entry) return; clearTimeout(entry.timer); pending.delete(m.requestId); if (m.error) entry.reject(new Error(m.error)); else entry.resolve(m.result) }
    else if (m.type === 'gig:event' && m.job) { if (m.preview) previews.set(m.job.id, m.preview); updateJob(m.job) }
  }))
  function activeChanged(next: typeof active) {
    const changed = active.characterId !== next.characterId; active = next
    if (changed) { selected.clear(); expanded.clear(); character = null; closeSheet?.(); void safe(loadCharacter)() }
    else renderGreetings()
  }
  if (ctx.state) {
    active = ctx.state.get('chat.active') as typeof active
    disposers.push(ctx.state.subscribe('chat.active', next => activeChanged(next as typeof active)))
  } else notify('This Lumiverse version does not expose the active-character selector. Update Lumiverse to use this extension.', true)
  disposers.push(tab.onActivate(() => { if (!running) void safe(loadCharacter)() }))
  disposers.push(ctx.events.on('SPINDLE_PERMISSION_CHANGED', () => { void safe(async () => { granted = await ctx.permissions.getGranted(); if (!permitted() && running) { stopRequested = true; promptAbort?.abort(); closeSheet?.(); await rpc('stop', { characterId: batchCharacter, ids: batchIds }) } await bootstrap() })() }))
  disposers.push(ctx.events.on('CHARACTER_EDITED', payload => {
    const event = payload as { id?: string }
    if (event?.id === active.characterId && !running) void safe(loadCharacter)()
  }))
  void safe(() => bootstrap(true))()
  return () => {
    destroyed = true; stopRequested = true; promptAbort?.abort(); clearTimeout(settingsTimer)
    if (running) ctx.sendToBackend({ type: 'gig:request', requestId: crypto.randomUUID(), action: 'stop', input: { characterId: batchCharacter, ids: batchIds } })
    ctx.sendToBackend({ type: 'gig:request', requestId: crypto.randomUUID(), action: 'settings', input: settings })
    closeSheet?.(); disposers.forEach(fn => fn()); handles.forEach(h => h.destroy()); pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('Extension closed')) }); pending.clear(); removeStyle(); tab.destroy()
  }
}
