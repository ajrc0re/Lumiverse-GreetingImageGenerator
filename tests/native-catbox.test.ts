import { describe, expect, mock, test } from 'bun:test'
import { catboxFilename, deleteCatbox, fingerprint, uploadCatbox } from '../src/catbox'
import { prepareNative, promptRequest } from '../src/native'
import { DEFAULT_SETTINGS, type Job } from '../src/types'
const job: Job = { id: 'j', characterId: 'c', chatId: 'chat', index: 0, original: 'The old train arrives.', title: 'Station', settings: { ...DEFAULT_SETTINGS, instructions: 'Watercolor', presetId: 'p' }, guide: { style: 'Blue coat' }, stage: 'queued', createdAt: 1 }
describe('native prompt reuse', () => {
  test('calls only the native prompt endpoint with existing prose and preset', async () => {
    const request = mock(async () => ({ prompt: 'Train station', negativePrompt: 'blurry' }))
    expect(await prepareNative(job, { promptPresets: [{ id: 'p', name: 'Scene', prompt: '{{character_prompt}} cinematic' }] }, request as any)).toEqual({ prompt: 'Train station', negativePrompt: 'blurry' })
    expect(request).toHaveBeenCalledTimes(1)
    const args = request.mock.calls[0] as any
    expect(args[0]).toBe('/image-gen/preview-prompt'); expect(args[2]).toMatchObject({ chatId: 'chat', promptMode: 'parsed_custom', promptPresetId: 'p' })
    expect(args[2].prompt).toContain('{{character_prompt}} cinematic'); expect(args[2].prompt).toContain(job.original); expect(args[2].prompt).toContain('Blue coat')
    expect(args[2]).not.toHaveProperty('connection_id')
  })
  test('uses native active preset when no explicit preset is selected', () => {
    const input = promptRequest({ ...job, settings: { ...job.settings, presetId: '' } }, { activePromptPresetId: 'active', promptPresets: [{ id: 'active', name: 'A', prompt: 'Native text' }] })
    expect(input.promptPresetId).toBe('active'); expect(input.prompt).toContain('Native text')
  })
  test('rejects empty parser results', async () => { await expect(prepareNative(job, {}, (async () => ({ prompt: '' })) as any)).rejects.toThrow('empty') })
})
describe('Catbox transport', () => {
  test.each([undefined, 'account123'])('multipart upload with account %s', async secret => {
    const transport = mock(async (_url: any, input: any) => {
      expect(input.body.get('reqtype')).toBe('fileupload'); expect(input.body.get('userhash')).toBe(secret || null)
      expect(input.body.get('fileToUpload')).toBeInstanceOf(Blob)
      return new Response('https://files.catbox.moe/abc123.png\n')
    })
    expect(await uploadCatbox('data:image/png;base64,AAAA', secret, transport as any)).toBe('https://files.catbox.moe/abc123.png')
  })
  test('rejects HTTP errors and forged or malformed success URLs', async () => {
    await expect(uploadCatbox('data:image/png;base64,AAAA', undefined, (async () => new Response('error', { status: 503 })) as any)).rejects.toThrow('503')
    for (const url of ['https://evil.test/a.png', 'https://files.catbox.moe/a.php', 'https://files.catbox.moe/a.png?x=1']) expect(() => catboxFilename(url)).toThrow()
  })
  test('authenticated deletion requires an affirmative success response', async () => {
    const transport = mock(async (_url: any, input: any) => { expect(input.body.get('files')).toBe('abc.png'); return new Response('Files successfully deleted.') })
    await deleteCatbox('https://files.catbox.moe/abc.png', 'secret', transport as any)
    await expect(deleteCatbox('https://files.catbox.moe/abc.png', 'secret', (async () => new Response('Invalid userhash')) as any)).rejects.toThrow('did not confirm')
  })
  test('stores a fingerprint, not the account credential', async () => { const hash = await fingerprint('secret'); expect(hash).toHaveLength(64); expect(hash).not.toContain('secret'); expect(hash).toBe(await fingerprint('secret')) })
})
