import { describe, expect, test } from 'bun:test'
import { greetingPatch, greetings, imageOccurrences, insertImage, referenceParts, removeOccurrence, resolveImage, settingsFrom, supportsReference, targetIndex } from '../src/core'
import type { Character } from '../src/types'
export const character = (overrides: Partial<Character> = {}): Character => ({ id: 'c1', name: 'Mira', first_mes: 'Hello', alternate_greetings: ['Second'], description: '', personality: '', scenario: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: [], creator: '', image_id: null, world_book_ids: [], extensions: {}, created_at: 1, updated_at: 1, ...overrides })

describe('source-preserving greeting images', () => {
  test('keeps titles and main/alternate order', () => {
    const c = character({ extensions: { greeting_tools: { mainGreeting: { title: 'Opening' }, indexMap: { 0: 'stable' }, greetings: { stable: { title: 'Return' } } } } })
    expect(greetings(c).map(g => g.title)).toEqual(['Opening', 'Return'])
  })
  test.each([
    ['before ![A](https://host/a.png "title") after', 'https://host/a.png'],
    ['![A](<https://host/a(1).png>)', 'https://host/a(1).png'],
    ['![A](https://host/a(1).png)', 'https://host/a(1).png'],
    ['![A\\]](https://host/a\\(1\\).png)', 'https://host/a(1).png'],
    ['<img class="x" alt="a > b" src="https://host/a.png?a=1&amp;b=2" width="30">', 'https://host/a.png?a=1&b=2'],
    ["<img='embeded://happy.png'>", 'embeded://happy.png'],
    ['<IMG SRC=/api/v1/images/abc>', '/api/v1/images/abc'],
    ['![A][pic]\n\n[pic]: <https://host/a.png> "title"', 'https://host/a.png'],
    ['![pic][]\n\n[pic]: https://host/a.png', 'https://host/a.png'],
    ['![pic]\n\n[pic]: https://host/a.png', 'https://host/a.png'],
  ])('parses %s', (text, source) => { const list = imageOccurrences(text); expect(list).toHaveLength(1); expect(list[0].source).toBe(source); expect(text.slice(list[0].start, list[0].end)).toBe(list[0].markup) })
  test('ignores fenced, inline, and indented code', () => {
    const text = '```md\n![a](x.png)\n```\n`![b](y.png)`\n    <img src="z.png">\n![real](r.png)'
    expect(imageOccurrences(text).map(x => x.source)).toEqual(['r.png'])
  })
  test('ignores an unclosed fence', () => expect(imageOccurrences('```\n![a](x.png)')).toHaveLength(0))
  test('handles nested inline backticks and does not confuse HTML attribute contents', () => {
    expect(imageOccurrences('`` example ` ![x](no.png) `` <!-- <img src="no.png"> -->')).toHaveLength(0)
    expect(imageOccurrences(`<img data-src="wrong.png" alt="src='also-wrong.png'" src="right.png">`)[0].source).toBe('right.png')
    expect(resolveImage('/api/v1/images/%invalid', character())).toEqual({})
  })
  test('removes only the second duplicate, preserving every other byte', () => {
    const text = 'First\r\n![a](https://h/a.png)\n**text** ![a](https://h/a.png) End'
    const occurrence = imageOccurrences(text)[1]
    expect(removeOccurrence(text, occurrence)).toBe('First\r\n![a](https://h/a.png)\n**text**  End')
    expect(() => removeOccurrence('Prefix' + text, occurrence)).toThrow('changed')
  })
  test('supports gallery and Risu asset references safely', () => {
    const c = character({ extensions: { risu_asset_map: { 'gallery://x': 'img-x', happy: 'img-y' } } })
    expect(resolveImage('gallery://x', c).imageId).toBe('img-x')
    expect(resolveImage('embeded://happy.png', c).imageId).toBe('img-y')
    expect(resolveImage('javascript:alert(1)', c)).toEqual({})
    expect(resolveImage('//foreign/path', c)).toEqual({})
    expect(resolveImage('/api/v1/image-gen/results/abc', c).imageId).toBe('abc')
  })
  test('insertion preserves whitespace and escapes alt labels', () => {
    expect(insertImage('Text \n', '/api/v1/images/x', 'A[ ]', 'end')).toBe('Text \n\n\n![A](</api/v1/images/x>)')
    expect(insertImage('Text', 'https://h/a.png', 'A', 'start')).toBe('![A](<https://h/a.png>)\n\nText')
    expect(() => insertImage('text', 'javascript:a', 'A', 'end')).toThrow()
  })
  test('detects stale/reordered greetings and patches only one field', () => {
    const c = character(); expect(() => targetIndex(c, 1, 'Changed')).toThrow('changed')
    expect(greetingPatch(c, 1, 'New')).toEqual({ alternate_greetings: ['New'] })
    expect(c.alternate_greetings).toEqual(['Second'])
  })
  test('validates settings and reference schemas', () => {
    expect(settingsFrom({ host: 'bad', parameters: { workflow: 'evil', seed: 12 } }).parameters).toEqual({ seed: 12 })
    expect(referenceParts('data:image/png;base64,AAAA')).toEqual({ data: 'AAAA', mimeType: 'image/png' })
    expect(() => referenceParts('data:text/html;base64,AAAA')).toThrow()
    expect(supportsReference('openai')).toBe(true); expect(supportsReference('comfyui')).toBe(false)
  })
})
