import type { Hook, SessionContextBreakdown, SessionContextUsage, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { barRuns, rowsOf } from './band'
import { imageOf, pixelOf } from './kit'
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
  expect(barRuns(4, 50, BAR_STYLES.dots)).toEqual([
    { text: '⣿⣿', part: 'filled' },
    { text: '⣀⣀', part: 'empty' },
  ])
  // 30% of four cells of three steps each is 4 steps: a full cell and a third of the next.
  expect(barRuns(4, 30, BAR_STYLES.dots)).toEqual([
    { text: '⣿⣤', part: 'filled' },
    { text: '⣀⣀', part: 'empty' },
  ])
  expect(barRuns(4, 100, BAR_STYLES.squares)).toEqual([{ text: '■■■■', part: 'filled' }])
  expect(barRuns(2, 25, BAR_STYLES.line)).toEqual([
    { text: '╾', part: 'filled' },
    { text: '─', part: 'empty' },
  ])
  expect(barRuns(3, 150, BAR_STYLES.dots)).toEqual([{ text: '⣿⣿⣿', part: 'filled' }])
})

test('every style marks the days between them', async () => {
  expect(barRuns(5, 0, BAR_STYLES.squares, 2)).toEqual([{ text: '□□ □□', part: 'empty' }])
  expect(barRuns(5, 100, BAR_STYLES.squares, 2)).toEqual([{ text: '■■ ■■', part: 'filled' }])
  // Circles too: nine cells are a gap and four circles of two cells, two a day.
  const [OPEN, WHOLE] = ['\u{F0766}', '\u{F0765}']
  expect(barRuns(9, 0, BAR_STYLES.circles, 2).map(run => run.text).join('')).toBe(`${OPEN} ${OPEN}  ${OPEN} ${OPEN} `)
  expect(barRuns(9, 100, BAR_STYLES.circles, 2).map(run => run.text).join('')).toBe(`${WHOLE} ${WHOLE}  ${WHOLE} ${WHOLE} `)
})

test('bar_style and sprite take one of their choices, or a random one', async () => {
  expect(settings({}).barStyle).toBe(BAR_STYLES.pill)
  expect(settings({ bar_style: 'circles' }).barStyle).toBe(BAR_STYLES.circles)
  expect(settings({ bar_style: 'stripes' }).barStyle).toBe(BAR_STYLES.pill)
  expect(settings({ bar_style: 'random' }, () => 0).barStyle).toBe(BAR_STYLES.pill)
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
  // A row's colour as a Text takes it; a picture's form of it has its own tests.
  const [weekly, fiveHour, context] = rowsOf(READING, settings({})).map(({ detail, ...row }) => ({ ...row, own: row.own.text }))
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

test('a window whose time is up reads 0% and "reset", not a row of dashes', async () => {
  // As the band is handed it: the five hours ran out, so that window is at 0% with nothing to count to.
  const usage = { fiveHour: { percentUsed: 0, resetsAt: null }, sevenDay: READING.usage.sevenDay }
  const [weekly, fiveHour] = rowsOf({ ...READING, usage }, settings({}))
  expect([fiveHour?.percent, fiveHour?.timer, fiveHour?.isLive]).toEqual([0, 'reset', false])
  expect(weekly?.timer).toBe('02d-09h-00m')
  // A window nothing is known of keeps its dashes.
  const [, unknown] = rowsOf({ ...READING, usage: { fiveHour: null, sevenDay: null } }, settings({}))
  expect([unknown?.percent, unknown?.timer]).toEqual([undefined, '--h---m---s'])
})

test('before its first reply a session shows the context the engine estimates', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // No reply has measured the window yet, so the plain figures hold no percentage; the
  // estimate /context makes is 24000 tokens of 200000.
  let estimates = 0
  on('session.usage', ($, e) => {
    if (!e.breakdown) return usageOf()
    estimates += 1
    const breakdown = { totalTokens: 24_000 } as SessionContextBreakdown
    return usageOf([], { window: 200_000, breakdown })
  })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: ' 12%' })).toBeDefined()
  // Asked for once, however often the band is drawn.
  expect(estimates).toBe(1)
  await ui.unmount()
})

test('bar_style draws the bars in that style', { options: { bar_style: 'circles' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  // An empty circle: a Nerd Font's outline, as the round ends of `blocks` are a Nerd Font's.
  expect(await ui.find({ type: 'Text', text: '\u{F0766}' })).toBeDefined()
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

test('sprite off leaves the model line and the bars', { options: { sprite: 'off', bar_style: 'blocks' } }, async ($, on) => {
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

// The text a drawn node shows, its children's one after another.
type Shown = { children?: (Shown | string)[] }
const textOf = (node: Shown | string): string =>
  typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('')

test('under Clawd a middle dot parts the model from its effort', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { model: { name: 'claude-opus-5-5', effort: 'high' } })
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(textOf((await ui.find({ key: 'model' })) as Shown)).toBe('Opus 5.5 · high')
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

test('the little bars of what fills the context are off unless show_context_kinds is true', async () => {
  expect(settings({}).showContextKinds).toBe(false)
  expect(settings({ show_context_kinds: true }).showContextKinds).toBe(true)
  expect(settings({ show_context_kinds: false }).showContextKinds).toBe(false)
  // A value that is no boolean leaves them off.
  for (const value of ['true', 1, 'yes']) expect(settings({ show_context_kinds: value }).showContextKinds).toBe(false)
})

test('Dumb Memory and the auto-compaction pill are off unless their option is true', async () => {
  const shown = (options: Parameters<typeof settings>[0]) => {
    const { showDumbMemory, showAutocompact } = settings(options)
    return [showDumbMemory, showAutocompact]
  }
  expect(shown({})).toEqual([false, false])
  expect(shown({ show_dumb_memory: true, show_autocompact: true })).toEqual([true, true])
  expect(shown({ show_dumb_memory: true })).toEqual([true, false])
  expect(shown({ show_autocompact: true })).toEqual([false, true])
  // A value that is no boolean leaves them off.
  for (const value of ['true', 1, 'yes']) {
    expect(shown({ show_dumb_memory: value, show_autocompact: value })).toEqual([false, false])
  }
})

test(
  'a band with no options draws the context bar inside Dumb Memory with no outline, no words, no auto-compaction pill, its fill in its own colour',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 450000 of a million, nothing loaded before the conversation: past where Dumb Memory would
    // start at the usual 40, 400000; auto-compaction runs at 667000.
    const breakdown = {
      categories: [{ name: 'Messages', tokens: 450_000, color: 'purple_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' }],
      totalTokens: 450_000,
      rawMaxTokens: 700_000,
      autoCompactThreshold: 667_000,
      isAutoCompactEnabled: true,
    } as unknown as SessionContextBreakdown
    const context = { window: 1_000_000, tokens: 450_000, percent: 45 }
    on('session.id', () => ({ value: 'one' }))
    on('session.model', () => ({ value: 'claude-fable-5-2' }))
    on('session.usage', ($, e) => usageOf([], e.breakdown ? { ...context, breakdown } : context))
    on('session.authorize', () => ({ deny: 'no account in a test' }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('ui.render', core)
    on('ui.blit', () => ({ value: {} }))
    // 71 columns give a context bar of 31 cells: at 2.34, a picture 371 pixels by 28.
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 71 } })
    await clock.advance(1000)
    expect(await ui.find({ key: 'dumb-memory' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'Dumb Memory' })).toBe(undefined)
    expect(await ui.find({ key: 'zone-over' })).toBe(undefined)
    const bar = (await imageOf(ui, 'bar-1m'))!
    const TRACK = [153, 153, 153, 102]
    // Where the outline's upper edge and its end would run, the bar's empty part.
    expect([pixelOf(bar, 300, 5), pixelOf(bar, 365, 14)]).toEqual([TRACK, TRACK])
    // Two thirds along, 247.5 of the 371 pixels, and its ring at 242: the empty part, no pill.
    expect([pixelOf(bar, 242, 14), pixelOf(bar, 247, 14)]).toEqual([TRACK, TRACK])
    // The fill, to 45% of the bar less its inset, 161: one plain fill in Claude's orange.
    const ORANGE = [215, 119, 87, 255]
    expect([14, 100, 155].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE, ORANGE])
    await ui.unmount()
  },
)

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

test('dumb_zone is where Dumb Memory starts, in percent of the room left: 40 unless it is a number from 0 to 100', async () => {
  expect(settings({}).dumbZone).toBe(40)
  expect([0, 50, 12.5, 100].map(share => settings({ dumb_zone: share }).dumbZone)).toEqual([0, 50, 12.5, 100])
  expect([-1, 101, 'many', '', Number.NaN, true].map(share => settings({ dumb_zone: share }).dumbZone)).toEqual([40, 40, 40, 40, 40, 40])
})
