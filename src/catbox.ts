import { referenceParts } from './core'
const ENDPOINT = 'https://catbox.moe/user/api.php'
export function catboxFilename(url: string): string {
  const parsed = new URL(url)
  if (parsed.origin !== 'https://files.catbox.moe' || !/^\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Catbox returned an invalid image URL')
  return parsed.pathname.slice(1)
}
export async function fingerprint(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
}
export async function uploadCatbox(dataUrl: string, secret?: string, transport: typeof fetch = fetch): Promise<string> {
  const { mimeType, data } = referenceParts(dataUrl)
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
  const form = new FormData()
  form.set('reqtype', 'fileupload')
  if (secret) form.set('userhash', secret)
  form.set('fileToUpload', new Blob([bytes], { type: mimeType }), `greeting.${mimeType.split('/')[1]}`)
  const response = await transport(ENDPOINT, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Catbox upload failed (HTTP ${response.status}). Your local image is retained.`)
  const url = (await response.text()).trim()
  catboxFilename(url)
  return url
}
export async function deleteCatbox(url: string, secret: string, transport: typeof fetch = fetch) {
  const body = new URLSearchParams({ reqtype: 'deletefiles', userhash: secret, files: catboxFilename(url) })
  const response = await transport(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(30_000) })
  const reply = (await response.text()).trim()
  if (!response.ok || reply !== 'Files successfully deleted.') throw new Error('Catbox did not confirm deletion. The greeting edit was saved; the public file may remain.')
}
