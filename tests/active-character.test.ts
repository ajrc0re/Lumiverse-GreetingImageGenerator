import { expect, mock, test } from 'bun:test'
import { watchActiveCharacter } from '../src/active-character'

test('legacy fallback waits for character hydration, ignores unchanged snapshots, and stops polling on cleanup', async () => {
  let active = { characterId: null as string | null, chatId: 'chat' }
  const changed = mock(() => {}), report = mock(() => {}), unsubscribe = mock(() => {})
  const read = mock(() => ({ ...active }))
  const dispose = watchActiveCharacter({
    state: { get: () => { throw new Error('PERMISSION_DENIED:spindle_authority_map_unwired') } },
    getActiveChat: read,
    events: { on: () => unsubscribe },
  } as any, changed, report)
  try {
    expect(changed).toHaveBeenCalledTimes(1)
    active = { characterId: 'character', chatId: 'chat' }
    await new Promise(resolve => setTimeout(resolve, 800))
    expect(changed).toHaveBeenLastCalledWith(active)
    await new Promise(resolve => setTimeout(resolve, 800))
    expect(changed).toHaveBeenCalledTimes(2)
    dispose()
    const reads = read.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 800))
    expect(read).toHaveBeenCalledTimes(reads)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  } finally { dispose() }
})

test('actual permission denial is reported without switching to a fallback API', () => {
  const read = mock(() => ({})), report = mock(() => {})
  watchActiveCharacter({ state: { get: () => { throw new Error('PERMISSION_DENIED:characters') } }, getActiveChat: read } as any, () => {}, report)()
  expect(report).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
})
