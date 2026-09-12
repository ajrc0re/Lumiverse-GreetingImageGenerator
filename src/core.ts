import type { Character, Greeting, ImageOccurrence, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'

export function settingsFrom(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Partial<Settings> : {}
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(['connectionId', 'model', 'presetId', 'instructions', 'negativePrompt'].map(k => [k, typeof (v as any)[k] === 'string' ? (v as any)[k] : ''])),
    host: ['local', 'catbox-anon', 'catbox-auth'].includes(v.host ?? '') ? v.host! : 'local',
    placement: v.placement === 'start' ? 'start' : 'end', review: v.review === true, reviewPrompt: v.reviewPrompt === true,
    parameters: Object.fromEntries(Object.entries(v.parameters ?? {}).filter(([k, x]) => ['width', 'height', 'resolution', 'aspectRatio', 'aspect_ratio', 'imageSize', 'size', 'seed'].includes(k) && (typeof x === 'string' || typeof x === 'number' && Number.isFinite(x)))),
  }
}

// Mask code while preserving source offsets. All edits operate on the original string.
function maskCode(text: string): string {
  let masked = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*(?:\n|$)|(?![\s\S]))/gm, s => ' '.repeat(s.length))
    .replace(/<!--[\s\S]*?(?:-->|$)/g, s => ' '.repeat(s.length))
    .replace(/^(?: {4}|\t).*/gm, s => ' '.repeat(s.length))
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '`' || masked[i - 1] === '\\') continue
    let end = i; while (masked[end] === '`') end++
    const delimiter = masked.slice(i, end)
    let close = masked.indexOf(delimiter, end)
    while (close !== -1 && (masked[close - 1] === '`' || masked[close + delimiter.length] === '`')) close = masked.indexOf(delimiter, close + delimiter.length)
    if (close !== -1) { const after = close + delimiter.length; masked = masked.slice(0, i) + ' '.repeat(after - i) + masked.slice(after); i = after - 1 }
    else i = end - 1
  }
  return masked
}
function unescape(s: string): string { return s.replace(/\\([\\()[\]<>])/g, '$1').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'") }
export function imageOccurrences(text: string): ImageOccurrence[] {
  const masked = maskCode(text)
  const result: ImageOccurrence[] = []
  const add = (start: number, end: number, source: string, alt = '') => result.push({ start, end, source: unescape(source), alt: unescape(alt), markup: text.slice(start, end) })
  const html = /<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi
  for (const match of masked.matchAll(html)) {
    const tag = match[0]
    const risu = /^<img\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const attributes = new Map<string, string>()
    for (const attr of tag.slice(4, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '')
    const src = risu ? risu[1] ?? risu[2] ?? risu[3] : attributes.get('src')
    if (src) add(match.index!, match.index! + tag.length, src, attributes.get('alt') ?? '')
  }
  const definitions = new Map<string, string>()
  for (const m of masked.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)) definitions.set(m[1].trim().toLowerCase(), m[2] ?? m[3])
  for (let i = 0; i < masked.length - 3; i++) {
    if (masked.slice(i, i + 2) !== '![' || (i > 0 && masked[i - 1] === '\\') || result.some(r => i >= r.start && i < r.end)) continue
    let p = i + 2, depth = 1
    for (; p < masked.length; p++) {
      if (masked[p] === '\\') { p++; continue }
      if (masked[p] === '[') depth++
      if (masked[p] === ']') { depth--; if (depth === 0) break }
    }
    if (p >= masked.length) continue
    const alt = text.slice(i + 2, p)
    let q = p + 1
    if (masked[q] === '(') {
      q++; while (/\s/.test(masked[q] ?? '') && q < masked.length) q++
      const begin = q; let source = ''
      if (masked[q] === '<') { const end = masked.indexOf('>', q + 1); if (end < 0) continue; source = text.slice(q + 1, end); q = end + 1 }
      else {
        let nesting = 0
        for (; q < masked.length; q++) {
          if (masked[q] === '\\') { q++; continue }
          if (masked[q] === '(') nesting++
          if (masked[q] === ')') { if (!nesting) break; nesting-- }
          if (/\s/.test(masked[q]) && !nesting) break
        }
        source = text.slice(begin, q)
      }
      while (/\s/.test(masked[q] ?? '') && q < masked.length) q++
      if (masked[q] === '"' || masked[q] === "'") {
        const quote = masked[q++]; while (q < masked.length && masked[q] !== quote) { if (masked[q] === '\\') q++; q++ } q++
        while (/\s/.test(masked[q] ?? '') && q < masked.length) q++
      }
      if (masked[q] === ')' && source) { add(i, q + 1, source, alt); i = q }
    } else if (masked[q] === '[') {
      const end = masked.indexOf(']', q + 1)
      if (end < 0) continue
      const source = definitions.get((text.slice(q + 1, end) || alt).trim().toLowerCase())
      if (source) { add(i, end + 1, source, alt); i = end }
    } else {
      const source = definitions.get(alt.trim().toLowerCase())
      if (source) { add(i, p + 1, source, alt); i = p }
    }
  }
  return result.sort((a, b) => a.start - b.start)
}
export function greetings(character: Character): Greeting[] {
  const tools = character.extensions?.greeting_tools
  return [character.first_mes, ...character.alternate_greetings].map((text, index) => {
    const metadata = index === 0 ? tools?.mainGreeting : tools?.greetings?.[tools?.indexMap?.[String(index - 1)]]
    const title = typeof metadata?.title === 'string' ? metadata.title.trim() : ''
    return { index, text, title: title || (index === 0 ? 'Main greeting' : `Greeting ${index + 1}`), images: imageOccurrences(text) }
  })
}
export function resolveImage(source: string, character: Character): { url?: string; imageId?: string } {
  const map = character.extensions?.risu_asset_map ?? {}
  const clean = source.replace(/^embeded:\/\//, '')
  const stem = clean.split('/').pop()?.replace(/\.[^.]*$/, '') ?? clean
  const imageId = map[source] || map[clean] || map[stem]
  if (typeof imageId === 'string') return { imageId, url: `/api/v1/images/${encodeURIComponent(imageId)}` }
  const local = /^\/api\/v1\/(?:images|image-gen\/results)\/([^/?#]+)/.exec(source)
  if (local) { try { return { imageId: decodeURIComponent(local[1]), url: source } } catch { return {} } }
  return /^(https?:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|webp|gif|avif);base64,)/i.test(source) ? { url: source } : {}
}
export function insertImage(text: string, url: string, title: string, position: Settings['placement']): string {
  if (!/^(https?:\/\/|\/api\/v1\/)/i.test(url) || /[\s<>]/.test(url)) throw new Error('Unsupported image URL')
  const alt = title.replace(/[\\\[\]\r\n]/g, ' ').trim()
  const markup = `![${alt}](<${url}>)`
  return !text ? markup : position === 'start' ? `${markup}\n\n${text}` : `${text}\n\n${markup}`
}
export function removeOccurrence(text: string, occurrence: ImageOccurrence): string {
  const exact = imageOccurrences(text).find(x => x.start === occurrence.start && x.end === occurrence.end && x.markup === occurrence.markup)
  if (!exact) throw new Error('Greeting changed. Refresh before removing this image.')
  return text.slice(0, exact.start) + text.slice(exact.end)
}
export function targetIndex(character: Character, index: number, original: string): number {
  const all = greetings(character)
  if (all[index]?.text === original) return index
  throw new Error('Greeting changed or moved. The image is retained; choose Apply to a current greeting.')
}
export function greetingPatch(character: Character, index: number, text: string) {
  if (index === 0) return { first_mes: text }
  const alternate_greetings = [...character.alternate_greetings]; alternate_greetings[index - 1] = text
  return { alternate_greetings }
}
export const supportsReference = (provider: string) => ['openai', 'google_gemini', 'openrouter'].includes(provider)
export function referenceParts(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
  if (!match) throw new Error('Use a PNG, JPEG, WebP, or GIF image')
  if (match[2].length > 28_000_000) throw new Error('Image must be smaller than 20 MB')
  return { mimeType: match[1], data: match[2] }
}
