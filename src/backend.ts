import type { SpindleAPI } from 'lumiverse-spindle-types'
import { Engine } from './engine'
import { REQUIRED } from './types'
declare const spindle: SpindleAPI

const engines = new Map<string, Engine>()
function engine(userId?: string) {
  const key = userId || 'owner'
  if (!engines.has(key)) engines.set(key, new Engine(spindle, userId, (job, preview) => spindle.sendToFrontend({ type: 'gig:event', job, preview }, userId)))
  return engines.get(key)!
}
spindle.onFrontendMessage(async (raw: unknown, userId?: string) => {
  if (!raw || typeof raw !== 'object') return
  const message = raw as { type?: string; requestId?: string; action?: string; input?: any }
  if (message.type !== 'gig:request' || typeof message.requestId !== 'string') return
  const reply = (result?: unknown, error?: string) => spindle.sendToFrontend({ type: 'gig:reply', requestId: message.requestId, result, error }, userId)
  try {
    const e = engine(userId), input = message.input ?? {}
    const needs = ['bootstrap', 'settings', 'secret', 'secret-clear', 'stop'].includes(message.action || '') ? [] : REQUIRED
    for (const permission of needs) if (!spindle.permissions.has(permission)) throw new Error(`Grant ${permission} permission to use this action`)
    let result: unknown
    switch (message.action) {
      case 'bootstrap': result = { settings: await e.settings(), hasSecret: await spindle.enclave.has('catbox_userhash', userId), connections: spindle.permissions.has('image_gen') ? await spindle.imageGen.listConnections(userId) : [], providers: spindle.permissions.has('image_gen') ? await spindle.imageGen.getProviders(userId) : [] }; break
      case 'settings': result = await e.saveSettings(input); break
      case 'secret': {
        const value = String(input.value || '').trim()
        if (!/^[a-zA-Z0-9]{8,256}$/.test(value)) throw new Error('Enter the userhash from your Catbox account (letters and numbers)')
        await spindle.enclave.put('catbox_userhash', value, userId); result = true; break
      }
      case 'secret-clear': result = await spindle.enclave.delete('catbox_userhash', userId); break
      case 'load': result = { character: await spindle.characters.get(input.characterId, userId), data: await e.load(input.characterId) }; break
      case 'guide': result = await e.guide(input.characterId, input.guide); break
      case 'create': result = await e.create(input); break
      case 'prepared': result = await e.prepared(input.characterId, input.id, input.prompt); break
      case 'failed': result = await e.failed(input.characterId, input.id, input.error); break
      case 'run': result = await e.run(input.characterId, input.id, input.options); break
      case 'stop': result = await e.stop(input.characterId, input.ids); break
      case 'apply': result = await e.apply(input.characterId, input.id, input.explicit); break
      case 'remove': result = await e.remove(input.characterId, input.index, input.original, input.occurrence); break
      case 'undo': result = await e.undo(input.characterId); break
      case 'eligibility': result = await e.fileEligibility(input.characterId, input.source); break
      case 'delete-public': result = await e.deletePublic(input.characterId, input.source); break
      case 'deleted-local': result = await e.deletedLocal(input.characterId, input.imageId); break
      case 'attach': result = await e.attach(input); break
      case 'reference-upload': {
        const { referenceParts } = await import('./core'); referenceParts(input.dataUrl)
        const image = await spindle.images.uploadFromDataUrl(input.dataUrl, { originalFilename: 'set-reference.png', owner_character_id: input.characterId, userId }); result = image.id; break
      }
      default: throw new Error('Unknown extension request')
    }
    reply(result)
  } catch (error) { reply(undefined, error instanceof Error ? error.message : String(error)) }
})
spindle.log.info('Greeting Image Generator loaded.')
