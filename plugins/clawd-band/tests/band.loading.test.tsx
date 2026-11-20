import { expect, mock, test } from 'claude-code/testing'

import { loadingRuns } from '../hooks/bar'
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
