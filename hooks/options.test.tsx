import type { Hook, SessionContextUsage, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { barRuns, rowsOf } from './band'
import { BAR_STYLES, settings } from './settings'

const BAND = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 75,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const SPINNER = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'Spinner',
  props: { word: 'Working', message: null, suffix: '', mode: 'requesting' },
} as const

const NOW = Date.parse('2026-10-11T15:00:00Z')

const usageOf = (rateLimits: SessionRateLimit[] = [], context: SessionContextUsage = { window: 200_000 }) => ({
  value: { startedAt: 0, context, rateLimits },
})

// The tests' stand-in for the engine's own drawing, told apart by its word.
const core: Hook<'ui.render'> = ($, e) => {
  const { Text } = $.ui.resolve(e)
  return <Text>core</Text>
}

const READING = {
  usage: {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  },
  context: { window: 200_000, percent: 12 },
  cacheAt: null,
  now: NOW,
}

test('a bar style fills its cells one after another, step by step', async () => {
  expect(barRuns(4, 50, BAR_STYLES.circles)).toEqual([
    { text: '●●', part: 'filled' },
    { text: '○○', part: 'empty' },
  ])
  expect(barRuns(4, 30, BAR_STYLES.circles)).toEqual([
    { text: '●◔', part: 'filled' },
    { text: '○○', part: 'empty' },
  ])
  expect(barRuns(4, 100, BAR_STYLES.squares)).toEqual([{ text: '■■■■', part: 'filled' }])
  expect(barRuns(2, 25, BAR_STYLES.line)).toEqual([
    { text: '╾', part: 'filled' },
    { text: '─', part: 'empty' },
  ])
  expect(barRuns(3, 150, BAR_STYLES.dots)).toEqual([{ text: '⣿⣿⣿', part: 'filled' }])
})

test('every style marks the days between them', async () => {
  expect(barRuns(5, 0, BAR_STYLES.circles, 2)).toEqual([{ text: '○○ ○○', part: 'empty' }])
  expect(barRuns(5, 100, BAR_STYLES.circles, 2)).toEqual([{ text: '●● ●●', part: 'filled' }])
})

test('bar_style and sprite take one of their choices, or a random one', async () => {
  expect(settings({}).barStyle).toBe(BAR_STYLES.blocks)
  expect(settings({ bar_style: 'circles' }).barStyle).toBe(BAR_STYLES.circles)
  expect(settings({ bar_style: 'stripes' }).barStyle).toBe(BAR_STYLES.blocks)
  expect(settings({ bar_style: 'random' }, () => 0).barStyle).toBe(BAR_STYLES.blocks)
  expect(settings({ bar_style: 'random' }, () => 0.99).barStyle).toBe(BAR_STYLES.line)
  expect(settings({}).sprite).toBe('picture')
  expect(settings({ sprite: 'off' }).sprite).toBe('off')
  expect(settings({ sprite: 'huge' }).sprite).toBe('picture')
  // A random Clawd is never no Clawd.
  expect(settings({ sprite: 'random' }, () => 0).sprite).toBe('picture')
  expect(settings({ sprite: 'random' }, () => 0.99).sprite).toBe('text')
})

test('the rows are the ones left on, top to bottom', async () => {
  const labels = (options: Parameters<typeof settings>[0]) => rowsOf(READING, settings(options)).map(row => row.label)
  expect(labels({})).toEqual(['7d', '5h', '200k'])
  expect(labels({ show_weekly: false })).toEqual(['5h', '200k'])
  expect(labels({ show_five_hour: false, show_context: false })).toEqual(['7d'])
  const [weekly, fiveHour, context] = rowsOf(READING, settings({}))
  expect(weekly).toEqual({ label: '7d', percent: 31, own: 'autoAccept', timer: '02d-09h-00m', isLive: true, segments: 7 })
  expect(fiveHour?.timer).toBe('03h-00m-00s')
  expect(context).toEqual({
    label: '200k',
    percent: 12,
    own: 'claude',
    timer: '--h---m---s',
    isLive: false,
    color: undefined,
  })
})

test('bar_style draws the bars in that style', { options: { bar_style: 'circles' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^○+$/ })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'bars' }))).not.toContain('█')
  await ui.unmount()
})

test('sprite text draws the text Clawd from the start', { options: { sprite: 'text' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBeDefined()
  await ui.unmount()
})

test('sprite off leaves the model line and the bars', { options: { sprite: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let swaps = 0
  on('ui.blit', () => {
    swaps += 1
    return { value: {} }
  })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  expect(swaps).toBe(0)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBe(undefined)
  expect(await ui.find({ key: 'model' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeDefined()
  await ui.unmount()
})

test(
  'with both usage rows off the account is not asked',
  { options: { show_weekly: false, show_five_hour: false } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    let fetches = 0
    on('session.id', () => ({ value: 'one' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.usage', () => usageOf())
    on('session.authorize', () => ({ value: { kind: 'bearer', handle: 'test' } }))
    on('http.fetch', () => {
      fetches += 1
      return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
    })
    on('ui.render', core)
    const ui = await $.ui.mount(BAND)
    await clock.advance(2000)
    expect(fetches).toBe(0)
    expect(await ui.find({ type: 'Text', text: /^7d/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^5h/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^200k/ })).toBeDefined()
    await ui.unmount()
  },
)

test(
  'with everything off the row above the prompt is left alone',
  { options: { sprite: 'off', show_model: false, show_weekly: false, show_five_hour: false, show_context: false } },
  async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', core)
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: 'core' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /%/ })).toBe(undefined)
    await ui.unmount()
  },
)

test('the spinner line is emptied', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(SPINNER)
  expect(await ui.find({ type: 'Text', text: 'core' })).toBe(undefined)
  await ui.unmount()
})

test('keep_spinner leaves the spinner line as it is', { options: { keep_spinner: true } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(SPINNER)
  expect(await ui.find({ type: 'Text', text: 'core' })).toBeDefined()
  await ui.unmount()
})

test('the motion options are on unless turned off', async () => {
  const defaults = settings({})
  expect([defaults.animate, defaults.randomPoses, defaults.turnEndings]).toEqual([true, true, true])
  const off = settings({ animate: false, random_poses: false, turn_endings: false })
  expect([off.animate, off.randomPoses, off.turnEndings]).toEqual([false, false, false])
})

test('animate off holds Clawd still', { options: { sprite: 'text', animate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  let shut = 0
  for (let frame = 0; frame < 8; frame++) {
    if (await ui.find({ type: 'Text', text: '▐█████▌' })) shut += 1
    await clock.advance(400)
  }
  // The mug's loop shuts the eyes; held on its first frame, they stay open.
  expect(shut).toBe(0)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBeDefined()
  await ui.unmount()
})

test('turn_endings off sends the end of a turn straight to rest', { options: { turn_endings: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses: unknown[] = []
  on('state.set', { key: 'pose' }, async ($, e, next) => {
    const result = await next(e)
    if ('value' in result && result.value?.isSet) poses.push(e.value)
    return result
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(poses).toEqual(['waiting', 'idle'])
})
