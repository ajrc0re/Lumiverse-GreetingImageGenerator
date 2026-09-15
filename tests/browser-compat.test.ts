import { expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { copyText, createRequestId } from '../src/browser-compat'

test('request IDs remain distinct when randomUUID is unavailable over HTTP', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } })
  try {
    expect(globalThis.crypto.randomUUID).toBeUndefined()
    const ids = Array.from({ length: 1000 }, createRequestId)
    expect(new Set(ids).size).toBe(1000)
    expect(ids.every(id => /^[0-9a-f]{32}$/.test(id))).toBe(true)
  } finally { Object.defineProperty(globalThis, 'crypto', original) }
})

test.each(['native', 'http', 'denied', 'unavailable'])('image link copying handles %s browser support and restores focus', async mode => {
  const win = new Window({ url: 'http://192.168.1.3:4318' })
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const key of ['document', 'navigator']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value: (win as any)[key] })
  }
  let selected = ''
  const native = mock(async () => { if (mode === 'denied') throw new Error('NotAllowedError') })
  Object.defineProperty(win.navigator, 'clipboard', { value: ['native', 'denied'].includes(mode) ? { writeText: native } : undefined })
  const legacy = mock(() => {
    const field = document.activeElement as HTMLTextAreaElement
    selected = field.value.slice(field.selectionStart, field.selectionEnd)
    return mode !== 'unavailable'
  })
  Object.defineProperty(win.document, 'execCommand', { value: legacy })
  const panel = document.createElement('div'), button = document.createElement('button')
  document.body.append(panel); panel.append(button); button.focus()
  try {
    expect(await copyText('http://host/image.png', panel)).toBe(mode !== 'unavailable')
    expect(document.activeElement).toBe(button)
    expect(panel.querySelector('textarea')).toBeNull()
    if (mode === 'native') { expect(native).toHaveBeenCalledWith('http://host/image.png'); expect(legacy).not.toHaveBeenCalled() }
    else { expect(legacy).toHaveBeenCalledWith('copy'); expect(selected).toBe('http://host/image.png') }
  } finally {
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]
    await win.happyDOM.close()
  }
})
