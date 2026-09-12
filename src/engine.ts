import type { SpindleAPI } from 'lumiverse-spindle-types'
import { fingerprint, uploadCatbox, deleteCatbox } from './catbox'
import { greetingPatch, insertImage, removeOccurrence, resolveImage, settingsFrom, supportsReference, targetIndex, referenceParts } from './core'
import { IDENTIFIER, type Character, type CharacterData, type Guide, type ImageOccurrence, type Job, type Prompt, type Settings } from './types'

export class Engine {
  private data = new Map<string, CharacterData>()
  private busy = false
  private stopped = new Set<string>()
  private abort?: AbortController
  private transient = new Map<string, string>()
  private writes: Promise<unknown> = Promise.resolve()
  private storageWrites: Promise<unknown> = Promise.resolve()
  constructor(private api: SpindleAPI, private userId: string | undefined, private changed: (job: Job, preview?: string) => void) {}
  private path(id: string) { return `characters/${encodeURIComponent(id)}.json` }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writes.then(fn, fn); this.writes = result.catch(() => {}); return result
  }
  async load(id: string): Promise<CharacterData> {
    if (!this.data.has(id)) {
      const saved = await this.api.userStorage.getJson<CharacterData>(this.path(id), { fallback: { guide: { style: '' }, jobs: [] }, userId: this.userId })
      for (const job of saved.jobs) if (['queued', 'preparing', 'generating', 'uploading', 'saving'].includes(job.stage)) {
        job.stage = 'stopped'; job.stopped = true; job.error = 'Interrupted by an extension restart. Review before retrying; a provider request may have completed.'
      }
      if (!this.data.has(id)) this.data.set(id, saved)
    }
    return this.data.get(id)!
  }
  private async persist(id: string) {
    const value = this.data.get(id)!
    const active = value.jobs.filter(j => ['queued', 'preparing', 'generating', 'uploading', 'saving'].includes(j.stage))
    const recent = value.jobs.filter(j => !active.includes(j)).slice(-50)
    value.jobs = [...active, ...recent].sort((a, b) => a.createdAt - b.createdAt)
    const snapshot = structuredClone(value)
    const write = this.storageWrites.then(() => this.api.userStorage.setJson(this.path(id), snapshot, { userId: this.userId }))
    this.storageWrites = write.catch(() => {}); await write
  }
  private async stage(job: Job, stage: Job['stage']) { job.stage = stage; await this.persist(job.characterId); this.changed(structuredClone(job)) }
  async settings() { return settingsFrom(await this.api.userStorage.getJson('settings.json', { fallback: {}, userId: this.userId })) }
  async saveSettings(settings: Settings) { const value = settingsFrom(settings); await this.api.userStorage.setJson('settings.json', value, { userId: this.userId }); return value }
  async guide(id: string, guide: Guide) {
    return this.serial(async () => { const data = await this.load(id); data.guide = { style: String(guide.style || ''), referenceId: guide.referenceId || undefined }; await this.persist(id) })
  }
  async create(input: { characterId: string; chatId: string; index: number; original: string; title: string; settings: Settings; guide: Guide }) {
    return this.serial(async () => {
      const char = await this.character(input.characterId); targetIndex(char, input.index, input.original)
      const job: Job = { ...input, settings: settingsFrom(input.settings), guide: structuredClone(input.guide), id: crypto.randomUUID(), stage: 'queued', createdAt: Date.now() }
      const data = await this.load(input.characterId); data.jobs.push(job); await this.persist(input.characterId); return structuredClone(job)
    })
  }
  private async find(characterId: string, id: string) {
    const job = (await this.load(characterId)).jobs.find(j => j.id === id)
    if (!job) throw new Error('Job is no longer available')
    return job
  }
  async prepared(characterId: string, id: string, prompt: Prompt) {
    const job = await this.find(characterId, id)
    if (job.imageId || job.generationStarted) throw new Error('This image job already started')
    if (!prompt.prompt?.trim()) throw new Error('The native parser returned an empty prompt')
    job.prompt = { prompt: prompt.prompt.trim(), negativePrompt: prompt.negativePrompt }; job.error = undefined
    await this.stage(job, 'queued'); return structuredClone(job)
  }
  async failed(characterId: string, id: string, error: string) {
    const job = await this.find(characterId, id); job.error = String(error); await this.stage(job, this.stopped.has(id) ? 'stopped' : 'failed')
  }
  async stop(characterId: string, ids: string[]) {
    for (const id of ids) {
      this.stopped.add(id)
      const job = await this.find(characterId, id); job.stopped = true
      if (!job.inserted) await this.stage(job, 'stopped')
    }
    this.abort?.abort()
  }
  async run(characterId: string, id: string, options: { referenceDataUrl?: string; imageDataUrl?: string; retryGeneration?: boolean } = {}) {
    if (this.busy) throw new Error('Another image job is running. Wait for it to finish.')
    const job = await this.find(characterId, id)
    if (this.busy) throw new Error('Another image job is running. Wait for it to finish.')
    if (job.inserted) return structuredClone(job)
    if (job.imageDeleted) throw new Error('This image was permanently deleted')
    if (!job.prompt) throw new Error('Prepare an image prompt first')
    if (job.generationStarted && !job.imageId && !this.transient.has(id) && !options.retryGeneration) throw new Error('The previous request may have completed. Confirm a new generation before retrying.')
    this.busy = true; this.stopped.delete(id); job.stopped = false; job.error = undefined
    try {
      let dataUrl = this.transient.get(id) || options.imageDataUrl
      if (!job.imageId && !dataUrl) {
        const connection = await this.api.imageGen.getConnection(job.settings.connectionId, this.userId)
        if (!connection) throw new Error('Select an available image connection profile in Settings')
        await this.character(job.characterId)
        if (this.stopped.has(id)) { await this.stage(job, 'stopped'); return structuredClone(job) }
        const parameters: Record<string, unknown> = { ...job.settings.parameters }
        if (job.guide.referenceId && supportsReference(connection.provider)) {
          if (!options.referenceDataUrl) throw new Error('The set reference could not be loaded')
          parameters.referenceImages = [referenceParts(options.referenceDataUrl)]
          // Override inherited pre-resolved sources so this explicit reference wins.
          parameters.resolvedSourceImages = parameters.referenceImages
        }
        job.generationStarted = true; await this.stage(job, 'generating')
        const input = { prompt: job.prompt.prompt, negativePrompt: job.settings.negativePrompt || job.prompt.negativePrompt, connection_id: connection.id, model: job.settings.model || undefined, parameters, owner_character_id: job.characterId, includeDataUrl: true, userId: this.userId }
        const providers = await this.api.imageGen.getProviders(this.userId)
        if (this.stopped.has(id)) { await this.stage(job, 'stopped'); return structuredClone(job) }
        let result: Awaited<ReturnType<SpindleAPI['imageGen']['generate']>> | undefined
        if (providers.find(p => p.id === connection.provider)?.capabilities.websocketPreviewStreaming) {
          this.abort = new AbortController()
          for await (const event of this.api.imageGen.generateStream({ ...input, signal: this.abort.signal })) {
            if (event.type === 'preview' && !this.stopped.has(id)) this.changed(structuredClone(job), event.imageDataUrl)
            if (event.type === 'done') result = event.result
          }
        } else result = await this.api.imageGen.generate(input)
        if (!result) throw new Error('Generation ended without a final image')
        dataUrl = result.imageDataUrl
        if (dataUrl) this.transient.set(id, dataUrl)
        job.imageId = result.imageId; job.localUrl = result.imageUrl
      }
      if (!job.imageId) {
        if (!dataUrl) throw new Error('The provider returned no usable image')
        const image = await this.api.images.uploadFromDataUrl(dataUrl, { originalFilename: 'greeting.png', owner_character_id: job.characterId, userId: this.userId })
        job.imageId = image.id
      }
      job.localUrl ||= `/api/v1/image-gen/results/${encodeURIComponent(job.imageId)}`
      await this.persist(characterId)
      if (this.stopped.has(id)) { await this.stage(job, 'stopped'); return structuredClone(job) }
      if (job.settings.host !== 'local' && !job.publicUrl) {
        if (!dataUrl) throw new Error('Local image is safe. Retry upload to load its bytes.')
        await this.stage(job, 'uploading')
        const secret = job.settings.host === 'catbox-auth' ? await this.api.enclave.get('catbox_userhash', this.userId) : undefined
        if (job.settings.host === 'catbox-auth' && !secret) throw new Error('Save your Catbox userhash in Settings; then retry upload')
        const accountFingerprint = secret ? await fingerprint(secret) : undefined
        job.publicUrl = await uploadCatbox(dataUrl, secret || undefined)
        job.accountFingerprint = accountFingerprint
        await this.persist(characterId)
      }
      this.transient.delete(id)
      if (this.stopped.has(id)) await this.stage(job, 'stopped')
      else if (job.settings.review) await this.stage(job, 'review')
      else await this.apply(characterId, id)
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error)
      await this.stage(job, this.stopped.has(id) ? 'stopped' : 'failed')
    } finally { this.busy = false; this.abort = undefined }
    return structuredClone(job)
  }
  private async character(id: string) { const char = await this.api.characters.get(id, this.userId); if (!char) throw new Error('Character no longer exists'); return char }
  async apply(characterId: string, id: string, explicit?: { index: number; original: string; local?: boolean }) {
    return this.serial(async () => {
      const job = await this.find(characterId, id)
      if (job.imageDeleted) throw new Error('This image was permanently deleted')
      if (job.inserted && !explicit) return structuredClone(job)
      if (!explicit && this.stopped.has(id)) { await this.stage(job, 'stopped'); return structuredClone(job) }
      const char = await this.character(characterId)
      const index = explicit?.index ?? job.index; const original = explicit?.original ?? job.original
      targetIndex(char, index, original)
      const url = explicit?.local ? job.localUrl : job.publicUrl || job.localUrl
      if (!url) throw new Error('There is no saved image to insert')
      const after = insertImage(original, url, job.title, job.settings.placement)
      await this.stage(job, 'saving')
      if (!explicit && this.stopped.has(id)) { await this.stage(job, 'stopped'); return structuredClone(job) }
      await this.api.characters.update(characterId, greetingPatch(char, index, after), this.userId)
      const data = await this.load(characterId); data.undo = { index, before: original, after }
      job.inserted = true; job.stopped = false; job.error = undefined
      await this.stage(job, 'complete'); return structuredClone(job)
    })
  }
  async remove(characterId: string, index: number, original: string, occurrence: ImageOccurrence) {
    return this.serial(async () => {
      const char = await this.character(characterId); targetIndex(char, index, original)
      const after = removeOccurrence(original, occurrence)
      await this.api.characters.update(characterId, greetingPatch(char, index, after), this.userId)
      const data = await this.load(characterId); data.undo = { index, before: original, after }; await this.persist(characterId)
      return { ...resolveImage(occurrence.source, char), source: occurrence.source }
    })
  }
  async undo(characterId: string) {
    return this.serial(async () => {
      const data = await this.load(characterId); if (!data.undo) throw new Error('Nothing to undo')
      const { index, before, after } = data.undo
      const char = await this.character(characterId); targetIndex(char, index, after)
      await this.api.characters.update(characterId, greetingPatch(char, index, before), this.userId)
      delete data.undo; await this.persist(characterId)
    })
  }
  async fileEligibility(characterId: string, source: string) {
    const char = await this.character(characterId)
    const resolved = resolveImage(source, char)
    const data = await this.load(characterId)
    const job = [...data.jobs].reverse().find(j => !j.imageDeleted && (j.publicUrl === source || !!resolved.imageId && j.imageId === resolved.imageId))
    if (!job) return { local: false, catbox: false }
    const image = job.imageId ? await this.api.images.get(job.imageId, { onlyOwned: true, userId: this.userId }) : null
    const secret = await this.api.enclave.get('catbox_userhash', this.userId)
    return {
      local: !!resolved.imageId && data.guide.referenceId !== resolved.imageId && image?.owner_extension_identifier === IDENTIFIER,
      catbox: !!job.publicUrl && source === job.publicUrl && !!secret && job.accountFingerprint === await fingerprint(secret),
      jobId: job.id, imageId: resolved.imageId,
    }
  }
  async deletePublic(characterId: string, source: string) {
    const eligible = await this.fileEligibility(characterId, source)
    if (!eligible.catbox || !eligible.jobId) throw new Error('This is not a verified upload owned by the configured Catbox account')
    await deleteCatbox(source, (await this.api.enclave.get('catbox_userhash', this.userId))!)
    const job = await this.find(characterId, eligible.jobId); job.publicUrl = undefined
    const data = await this.load(characterId); delete data.undo; await this.persist(characterId)
  }
  async deletedLocal(characterId: string, imageId: string) {
    const data = await this.load(characterId)
    for (const job of data.jobs) if (job.imageId === imageId) job.imageDeleted = true
    if (data.guide.referenceId === imageId) delete data.guide.referenceId
    delete data.undo; await this.persist(characterId)
  }
  async attach(input: { characterId: string; index: number; original: string; title: string; settings: Settings; dataUrl?: string; url?: string }) {
    if (this.busy) throw new Error('Wait for the running generation before attaching an image')
    if (input.dataUrl) referenceParts(input.dataUrl)
    else if (!['https:', 'http:'].includes(new URL(input.url || '').protocol)) throw new Error('Use an HTTP or HTTPS image URL')
    const job = await this.create({ ...input, chatId: '', guide: { style: '' } })
    const stored = await this.find(input.characterId, job.id)
    if (input.dataUrl) {
      referenceParts(input.dataUrl)
      const image = await this.api.images.uploadFromDataUrl(input.dataUrl, { originalFilename: 'greeting-upload.png', owner_character_id: input.characterId, userId: this.userId })
      stored.imageId = image.id; stored.localUrl = `/api/v1/image-gen/results/${image.id}`
    } else {
      const url = new URL(input.url || '')
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS image URL')
      stored.publicUrl = url.href
    }
    await this.persist(input.characterId)
    // Existing attachments are inserted as supplied; external URLs are never claimed as owned.
    return this.apply(input.characterId, job.id)
  }
}
