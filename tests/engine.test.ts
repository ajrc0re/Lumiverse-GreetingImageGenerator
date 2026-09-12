import { describe, expect, mock, test } from 'bun:test'
import type { SpindleAPI } from 'lumiverse-spindle-types'
import { Engine } from '../src/engine'
import { DEFAULT_SETTINGS, IDENTIFIER, type Job } from '../src/types'
import { character } from './core.test'
const PNG = 'data:image/png;base64,iVBORw0KGgo='
export function fixture() {
  let card = character()
  const store = new Map<string, unknown>(), events: Job[] = []
  const api = {
    userStorage: { getJson: async (path: string, options: any) => structuredClone(store.get(path) ?? options.fallback), setJson: async (path: string, value: unknown) => { store.set(path, structuredClone(value)) } },
    characters: { get: async () => structuredClone(card), update: mock(async (_: string, patch: any) => { card = { ...card, ...patch }; return card }) },
    imageGen: { getConnection: async () => ({ id: 'image-profile', provider: 'openai' }), getProviders: async () => [], generate: mock(async (_input: unknown) => ({ imageId: 'i1', imageUrl: '/api/v1/image-gen/results/i1', imageDataUrl: PNG })) },
    images: { uploadFromDataUrl: mock(async () => ({ id: 'fallback' })), get: async () => ({ id: 'i1', owner_extension_identifier: IDENTIFIER }) },
    enclave: { get: async () => null },
  }
  const engine = new Engine(api as unknown as SpindleAPI, 'u1', job => events.push(job))
  const create = async () => {
    const job = await engine.create({ characterId: 'c1', chatId: 'chat', index: 0, original: 'Hello', title: 'Main', settings: { ...DEFAULT_SETTINGS, connectionId: 'image-profile' }, guide: { style: '' } })
    return engine.prepared('c1', job.id, { prompt: 'A portrait', negativePrompt: 'blurry' })
  }
  return { engine, api, create, events, store, card: () => card, edit: (patch: any) => { card = { ...card, ...patch } } }
}
describe('image job lifecycle', () => {
  test('uses independent image profile, local persistence, and an isolated greeting patch', async () => {
    const f = fixture(), job = await f.create(); const done = await f.engine.run('c1', job.id)
    expect(done.stage).toBe('complete'); expect(f.api.imageGen.generate).toHaveBeenCalledTimes(1)
    expect(f.api.imageGen.generate.mock.calls[0][0]).toMatchObject({ connection_id: 'image-profile', owner_character_id: 'c1', prompt: 'A portrait' })
    expect(f.api.images.uploadFromDataUrl).not.toHaveBeenCalled()
    expect(f.card().first_mes).toBe('Hello\n\n![Main](</api/v1/image-gen/results/i1>)')
    expect(f.card().alternate_greetings).toEqual(['Second'])
    await f.engine.run('c1', job.id); expect(f.api.imageGen.generate).toHaveBeenCalledTimes(1)
  })
  test('failed save retains image and explicit reapplication never regenerates', async () => {
    const f = fixture(), job = await f.create(); f.edit({ first_mes: 'Edited elsewhere' })
    const failed = await f.engine.run('c1', job.id); expect(failed.stage).toBe('failed'); expect(failed.imageId).toBe('i1'); expect(f.card().first_mes).toBe('Edited elsewhere')
    await f.engine.apply('c1', job.id, { index: 0, original: 'Edited elsewhere' })
    expect(f.api.imageGen.generate).toHaveBeenCalledTimes(1)
  })
  test('review mode saves without inserting and undo is guarded', async () => {
    const f = fixture(), job = await f.create(); (await f.engine.load('c1')).jobs[0].settings.review = true
    expect((await f.engine.run('c1', job.id)).stage).toBe('review'); expect(f.card().first_mes).toBe('Hello')
    await f.engine.apply('c1', job.id); await f.engine.undo('c1'); expect(f.card().first_mes).toBe('Hello')
    await f.engine.apply('c1', job.id, { index: 0, original: 'Hello' }); f.edit({ first_mes: 'New content' })
    await expect(f.engine.undo('c1')).rejects.toThrow('changed'); expect(f.card().first_mes).toBe('New content')
  })
  test('stop during a non-abortable generation retains a late image without insertion', async () => {
    const f = fixture(), job = await f.create()
    let finish!: (value: any) => void, started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    f.api.imageGen.generate = mock(async () => { started(); return new Promise<any>(resolve => { finish = resolve }) })
    const running = f.engine.run('c1', job.id); await ready; await f.engine.stop('c1', [job.id])
    finish({ imageId: 'late', imageDataUrl: PNG })
    const result = await running; expect(result.stage).toBe('stopped'); expect(result.imageId).toBe('late'); expect(f.card().first_mes).toBe('Hello')
  })
  test('streaming cancellation aborts the upstream signal', async () => {
    const f = fixture(), job = await f.create(); const api = f.api as any
    api.imageGen.getProviders = async () => [{ id: 'openai', capabilities: { websocketPreviewStreaming: true } }]
    let signal!: AbortSignal, started!: () => void
    const ready = new Promise<void>(r => { started = r })
    api.imageGen.generateStream = async function* (input: any) { signal = input.signal; started(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve())); throw new Error('aborted') }
    const promise = f.engine.run('c1', job.id); await ready; await f.engine.stop('c1', [job.id]); expect((await promise).stage).toBe('stopped'); expect(signal.aborted).toBe(true)
  })
  test('a second simultaneous run is rejected', async () => {
    const f = fixture(), job = await f.create(); let finish!: (v: any) => void
    f.api.imageGen.generate = mock(async () => new Promise<any>(r => { finish = r }))
    const running = f.engine.run('c1', job.id)
    while (!finish) await new Promise(r => setTimeout(r, 1))
    await expect(f.engine.run('c1', job.id)).rejects.toThrow('Another image')
    finish({ imageId: 'i1', imageDataUrl: PNG }); await running
  })
  test('restart marks pending work stopped and cannot silently repeat a provider call', async () => {
    const f = fixture(), job = await f.create(); const data = await f.engine.load('c1'); data.jobs[0].stage = 'generating'; data.jobs[0].generationStarted = true
    f.store.set('characters/c1.json', structuredClone(data))
    const reloaded = new Engine(f.api as any, 'u1', () => {})
    expect((await reloaded.load('c1')).jobs[0].stage).toBe('stopped')
    await expect(reloaded.run('c1', job.id)).rejects.toThrow('previous request may have completed')
    expect(f.api.imageGen.generate).not.toHaveBeenCalled()
  })
  test('simultaneous callers cannot race the initial asynchronous job lookup', async () => {
    const f = fixture(), job = await f.create()
    const results = await Promise.allSettled([f.engine.run('c1', job.id), f.engine.run('c1', job.id)])
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(f.api.imageGen.generate).toHaveBeenCalledTimes(1)
  })
  test('forwards references with the actual provider wire shape', async () => {
    const f = fixture(), job = await f.create(); (await f.engine.load('c1')).jobs[0].guide.referenceId = 'ref'
    await f.engine.run('c1', job.id, { referenceDataUrl: PNG })
    expect((f.api.imageGen.generate.mock.calls[0][0] as any).parameters.referenceImages).toEqual([{ data: 'iVBORw0KGgo=', mimeType: 'image/png' }])
  })
  test('unsupported providers do not get a reference or change their workflow', async () => {
    const f = fixture(), job = await f.create(); f.api.imageGen.getConnection = async () => ({ id: 'image-profile', provider: 'comfyui' });
    (await f.engine.load('c1')).jobs[0].guide.referenceId = 'ref'; await f.engine.run('c1', job.id)
    expect((f.api.imageGen.generate.mock.calls[0][0] as any).parameters).toEqual({})
  })
  test('missing host persistence uses one fallback upload', async () => {
    const f = fixture(), job = await f.create(); f.api.imageGen.generate = mock(async () => ({ imageDataUrl: PNG }) as any)
    await f.engine.run('c1', job.id); expect(f.api.images.uploadFromDataUrl).toHaveBeenCalledTimes(1)
  })
  test('authenticated hosting without a secret fails after local persistence', async () => {
    const f = fixture(), job = await f.create(); (await f.engine.load('c1')).jobs[0].settings.host = 'catbox-auth'
    const result = await f.engine.run('c1', job.id); expect(result.stage).toBe('failed'); expect(result.imageId).toBe('i1'); expect(result.error).toContain('userhash')
    await f.engine.apply('c1', job.id, { index: 0, original: 'Hello', local: true }); expect(f.api.imageGen.generate).toHaveBeenCalledTimes(1)
  })
  test('Catbox upload retry resumes the saved bytes even when the old profile is gone', async () => {
    const f = fixture(), job = await f.create(), previousFetch = globalThis.fetch
    ;(await f.engine.load('c1')).jobs[0].settings.host = 'catbox-anon'
    try {
      globalThis.fetch = (async () => new Response('Unavailable', { status: 503 })) as unknown as typeof fetch
      const failed = await f.engine.run('c1', job.id); expect(failed.imageId).toBe('i1'); expect(failed.stage).toBe('failed'); expect(f.card().first_mes).toBe('Hello')
      f.api.imageGen.getConnection = async () => null as any
      globalThis.fetch = (async () => new Response('https://files.catbox.moe/upload.png')) as unknown as typeof fetch
      const result = await f.engine.run('c1', job.id, { imageDataUrl: PNG })
      expect(result.stage).toBe('complete'); expect(f.card().first_mes).toContain('https://files.catbox.moe/upload.png'); expect(f.api.imageGen.generate).toHaveBeenCalledTimes(1)
    } finally { globalThis.fetch = previousFetch }
  })
  test('authenticated upload deletion is tied to the original account fingerprint', async () => {
    const f = fixture(), job = await f.create(), previousFetch = globalThis.fetch
    ;(await f.engine.load('c1')).jobs[0].settings.host = 'catbox-auth'
    const enclave = f.api.enclave as any; enclave.get = async () => 'accountA'
    try {
      globalThis.fetch = (async () => new Response('https://files.catbox.moe/auth.png')) as unknown as typeof fetch
      await f.engine.run('c1', job.id)
      expect((await f.engine.fileEligibility('c1', 'https://files.catbox.moe/auth.png')).catbox).toBe(true)
      enclave.get = async () => 'accountB'
      await expect(f.engine.deletePublic('c1', 'https://files.catbox.moe/auth.png')).rejects.toThrow('not a verified')
      enclave.get = async () => 'accountA'
      globalThis.fetch = (async () => new Response('Files successfully deleted.')) as unknown as typeof fetch
      await f.engine.deletePublic('c1', 'https://files.catbox.moe/auth.png')
      expect((await f.engine.load('c1')).undo).toBeUndefined()
      expect((await f.engine.load('c1')).jobs[0].imageId).toBe('i1')
    } finally { globalThis.fetch = previousFetch }
  })
  test('permanent local deletion clears undo and prevents reapplication', async () => {
    const f = fixture(), job = await f.create(); await f.engine.run('c1', job.id)
    await f.engine.deletedLocal('c1', 'i1')
    expect((await f.engine.load('c1')).undo).toBeUndefined()
    await expect(f.engine.apply('c1', job.id, { index: 0, original: f.card().first_mes })).rejects.toThrow('permanently deleted')
  })
  test('only verified owned assets qualify for deletion; a set reference is retained', async () => {
    const f = fixture(), job = await f.create(); await f.engine.run('c1', job.id)
    expect((await f.engine.fileEligibility('c1', '/api/v1/image-gen/results/i1')).local).toBe(true)
    expect((await f.engine.fileEligibility('c1', 'https://unowned/image.png')).local).toBe(false)
    await f.engine.guide('c1', { style: '', referenceId: 'i1' }); expect((await f.engine.fileEligibility('c1', '/api/v1/image-gen/results/i1')).local).toBe(false)
  })
  test('history stays bounded without evicting queued jobs', async () => {
    const f = fixture(); const data = await f.engine.load('c1')
    for (let i = 0; i < 55; i++) { const job = await f.create(); (await f.engine.load('c1')).jobs.find(j => j.id === job.id)!.stage = 'complete' }
    await f.engine.guide('c1', { style: 'shared' }); expect(data.jobs.length).toBe(50)
  })
})
