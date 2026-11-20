import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { loadingRuns } from '../hooks/bar'
import { rowsOf } from '../hooks/rows'
import { settings } from '../hooks/settings'
import { BAND, core, NOW, STILL_BARS, TEXT_BARS, usageOf } from './band.fixtures'

test('the bar of a row still loading is slashes with a gap in each four, moving a cell a frame to the right', () => {
  const at = (phase: number) => loadingRuns(12, phase).map(run => run.text).join('')
  expect(at(0)).toBe('/// /// /// ')
  expect(at(1)).toBe(' /// /// ///')
  expect(at(2)).toBe('/ /// /// //')
  expect(at(4)).toBe(at(0))
  expect(loadingRuns(12, 3).every(run => run.part === 'loading')).toBe(true)
  expect(loadingRuns(5, 7).map(run => run.text).join('').length).toBe(5)
})

// The row as drawn, in one string.
const wordsOf = (node: unknown): string =>
  typeof node === 'string' ? node : ((node as { children?: unknown[] } | undefined)?.children ?? []).map(wordsOf).join('')

const SPIN = ['-', '\\', '|', '/']

test('a usage row with no reading spins its dashes, - \\ | /, and its bar is slashes', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.usage', () => usageOf())
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  const glyphs: string[] = []
  for (let frame = 0; frame < 9; frame++) {
    await clock.advance(400)
    const row = wordsOf(await ui.find({ key: 'row-5h' }))
    // The percentage and the countdown spin together: every dash is the frame's glyph.
    const [, glyph] = /(.)\s+\1\1h\1\1\1m\1\1\1s$/.exec(row) ?? []
    expect(glyph).toBeDefined()
    glyphs.push(glyph ?? '')
    expect(row.includes('/')).toBe(true)
  }
  // One step of - \ | / a frame, round and round.
  const start = SPIN.indexOf(glyphs[0] ?? '')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(glyphs).toEqual(glyphs.map((_, frame) => SPIN[(start + frame) % 4]))
  await ui.unmount()
})

test('a usage row with a reading does not spin', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 40, resetsAt }, { kind: 'seven_day', percentUsed: 31, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  for (let frame = 0; frame < 4; frame++) {
    await clock.advance(400)
    expect(wordsOf(await ui.find({ key: 'row-5h' }))).toMatch(/40%/)
    expect(wordsOf(await ui.find({ key: 'row-5h' })).includes('/')).toBe(false)
  }
  await ui.unmount()
})

// A session the engine has measured at 20% of a 200k window.
const MEASURED = { window: 200_000, tokens: 40_000, percent: 20 }

test('until the first reply the context row is loading whole: no figure, no estimate, no line of detail', () => {
  const contextRow = (cacheAt: number | null) => rowsOf({ usage: null, context: MEASURED, cacheAt, now: NOW }, settings({})).at(-1)
  const before = contextRow(null)
  expect(before?.isLoading).toBe(true)
  expect(before?.percent).toBe(undefined)
  expect(before?.detail).toBe(undefined)
  expect(before?.timer).toBe('--h---m---s')
  const after = contextRow(NOW - 60_000)
  expect(after?.isLoading).toBe(undefined)
  expect(after?.percent).toBe(20)
  expect(after?.detail).toBe('40k of 200k')
})

// The session's replies: each one comes back having read the cache.
const replies = (on: On) => {
  mock.store(on) // a reply's step stores the model it names
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: '' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } as never }
  })
}

test('before the first reply the drawn context row is slashes, a mark for its percent and its dashes, and no line under the pointer', STILL_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replies(on)
  on('session.usage', () => usageOf([], MEASURED))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  for (let second = 0; second < 8; second++) {
    await clock.advance(1000)
    const row = wordsOf(await ui.find({ key: 'row-200k' }))
    // Still bars hold the first mark, `-`: one where the percent goes, and the countdown's dashes.
    expect(row).toMatch(/\/\/\/.*\s-\s+--h---m---s$/)
    expect(row.includes('%')).toBe(false)
    expect(await ui.find({ key: 'detail-200k' })).toBe(undefined)
  }
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) expect(chunk.kind).toBe('text')
  await clock.advance(1000)
  const row = wordsOf(await ui.find({ key: 'row-200k' }))
  expect(row).toMatch(/20%/)
  expect(row.includes('/')).toBe(false)
  expect(wordsOf(await ui.find({ key: 'detail-200k' }))).toMatch(/40k of 200k/)
  await ui.unmount()
})

test('with animate off a row with no reading holds its first frame', STILL_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.usage', () => usageOf())
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(400)
  const first = wordsOf(await ui.find({ key: 'row-5h' }))
  await clock.advance(1600)
  expect(wordsOf(await ui.find({ key: 'row-5h' }))).toBe(first)
  expect(first.includes('/')).toBe(true)
  await ui.unmount()
})
