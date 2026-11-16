import type { On, SessionContextBreakdown } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { rowsOf } from './band'
import { BAND, core, imageOf, NOW, pixelOf, usageOf } from './kit'
import { settings } from './settings'

// A session at 320k of a 1M window, as /context broke one down: 21100 loaded
// before the conversation, auto-compaction at 667k of a 700k compaction window.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3512, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 8045, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'MCP server instructions', tokens: 456, color: 'green_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    { name: 'System tools (deferred)', tokens: 13864, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'Custom agents', tokens: 1258, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 3293, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Skills', tokens: 4536, color: 'warning', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 299707, color: 'purple_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', isDeferred: false, kind: 'buffer' },
    { name: 'Free space', tokens: 346193, color: 'promptBorder', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 320807,
  rawMaxTokens: 700_000,
  autoCompactThreshold: 667_000,
  isAutoCompactEnabled: true,
} as unknown as SessionContextBreakdown

const CONTEXT = { window: 1_000_000, tokens: 320807, percent: 32 }

// A session the engine answers for; counts the breakdowns the mod asks of it.
const sessionOf = (on: On, context = CONTEXT) => {
  const asked = { breakdowns: 0 }
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.usage', ($, e) => {
    if (!e.breakdown) return usageOf([], context)
    asked.breakdowns += 1
    return usageOf([], { ...context, breakdown: BREAKDOWN })
  })
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  return asked
}

test('a session is asked for its context by category once while nothing happens', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  const ui = await $.ui.mount(BAND)
  await clock.advance(10_000)
  expect(asked.breakdowns).toBe(1)
  await ui.unmount()
})

// The context row of a session of a 1M window that loaded 21100 tokens before its conversation.
const zoneAt = (tokens: number) => {
  const context = { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }
  return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100 }, settings({})).at(-1)?.zone
}

test('Dumb Memory starts at what the session loaded plus two fifths of the room left in the window', () => {
  // 21100 + 40% of 978900 is 412660 of the million.
  expect(zoneAt(320_807)).toEqual({ from: 0.41266, isIn: false })
  // The session is in it by its own tokens, one past the start.
  expect(zoneAt(412_660)?.isIn).toBe(false)
  expect(zoneAt(412_661)).toEqual({ from: 0.41266, isIn: true })
})

test('with show_dumb_memory off the context row has no Dumb Memory', () => {
  const zoneWith = (options: Parameters<typeof settings>[0]) => {
    const context = { window: 1_000_000, tokens: 450_000, percent: 45 }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100 }, settings(options)).at(-1)?.zone
  }
  expect(zoneWith({})).toBeDefined()
  expect(zoneWith({ show_dumb_memory: false })).toBe(undefined)
})

test('auto-compaction is marked where it runs along the window', () => {
  const markOf = (compactAt: number | null) => {
    const context = { window: 1_000_000, tokens: 320_807, percent: 32 }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100, compactAt }, settings({})).at(-1)?.mark
  }
  expect(markOf(667_000)).toBe(0.667)
  // No mark with auto-compaction off, nor where it would run at the window's end or past it.
  expect([markOf(null), markOf(1_000_000), markOf(1_200_000)]).toEqual([undefined, undefined, undefined])
})

test('with show_autocompact off the context row has no auto-compaction mark', () => {
  const markWith = (options: Parameters<typeof settings>[0]) => {
    const context = { window: 1_000_000, tokens: 320_807, percent: 32 }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100, compactAt: 667_000 }, settings(options)).at(-1)?.mark
  }
  expect(markWith({})).toBe(0.667)
  expect(markWith({ show_autocompact: false })).toBe(undefined)
})

test(
  'auto-compaction is a short grey pill in the context bar, a clear ring round it',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // 667000 of the million is 247.5 of the 371 pixels. The pill is 8 wide, 243.5 to 251.5,
    // as tall as the fill, in the grey /context gives the buffer, solid.
    const GREY = [153, 153, 153, 255]
    expect([245, 247, 249].map(x => pixelOf(bar, x, 14))).toEqual([GREY, GREY, GREY])
    // Round it a clear ring 2 wide parts it from the bar, and from Dumb Memory's outline over it.
    expect([242, 252].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0])
    expect(pixelOf(bar, 247, 5)[3]).toBe(0)
    // Either side the bar is as it was.
    expect([pixelOf(bar, 238, 14), pixelOf(bar, 257, 14)]).toEqual([TRACK, TRACK])
    await ui.unmount()
  },
)

// A band of 71 columns: beside Clawd's 16 its context bar is 31 cells. At a cell 2.34 times as
// tall as wide that is a picture 371 pixels by 28, every line of it 2 thick.
const PILLS = { ...BAND, props: { ...BAND.props, bodyColumns: 71 } }
const TRACK = [153, 153, 153, 102]
const BLACK = [0, 0, 0, 255]

test(
  'Dumb Memory is an outline inside the context bar, black while the session is short of it',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect([bar.source.width, bar.source.height]).toEqual([371, 28])
    // It starts at 0.41266 of the 371 pixels, 153.1: its left end at mid height, and its
    // upper edge further along, where the fill's clear ring would lie.
    expect(pixelOf(bar, 154, 14)).toEqual(BLACK)
    expect(pixelOf(bar, 300,5)).toEqual(BLACK)
    // It runs to the bar's end, whether or not auto-compaction is on.
    expect(pixelOf(bar, 365, 14)).toEqual(BLACK)
    // Before it, and inside it, the bar's empty part is as ever.
    expect(pixelOf(bar, 150, 14)).toEqual(TRACK)
    expect(pixelOf(bar, 300,14)).toEqual(TRACK)
    await ui.unmount()
  },
)

test(
  'once the session is in Dumb Memory the outline is red, the fill within it striped with red, the rest of its inside faintly red',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 450000 of the million: past the start at 412660. The fill ends at 45% of 371 pixels, 167.
    sessionOf(on, { window: 1_000_000, tokens: 450_000, percent: 45 })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    const RED = [255, 107, 128, 255]
    expect(pixelOf(bar, 300,5)).toEqual(RED)
    expect(pixelOf(bar, 365, 14)).toEqual(RED)
    // The fill keeps its own colour up to the outline. Inside it the bar and the red show by
    // turns, in slanting stripes 4 pixels wide: a point where across and down add up to 168
    // to 171 is the bar's orange, one where they add up to 172 to 175 is red.
    expect(pixelOf(bar, 100, 14)).toEqual([215, 119, 87, 255])
    expect(pixelOf(bar, 157, 11)).toEqual([215, 119, 87, 255])
    expect(pixelOf(bar, 158, 14)).toEqual(RED)
    // Past the fill's end the inside is the warning colour at two fifths solid, as the empty part is.
    expect(pixelOf(bar, 300,14)).toEqual([255, 107, 128, 102])
    // Short of the outline the empty part does not change: there is none left here, so the bar's edge.
    expect(pixelOf(bar, 100, 3)).toEqual(TRACK)
    await ui.unmount()
  },
)

test('the words Dumb Memory stand in the top row over where the zone starts, a button, dim until the session is in it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const words = await ui.find({ key: 'dumb-memory' })
  expect([words?.type, words?.props.label, words?.props.plain, words?.props.dimColor]).toEqual(['Button', 'Dumb Memory', true, true])
  // The bars start 22 cells in: 1, Clawd's 16, 1, "1m " and a blank. The zone starts 0.41266
  // along the 31 cells of the bar, in its cell 12, so 34 cells in: the probe's cell and 33 more.
  expect((await ui.find({ key: 'dumb-memory-before' }))?.props.width).toBe(33)
  await ui.unmount()
})

test('a press on the words opens the Dumb Memory pane and hands it the keyboard', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const opened: unknown[] = []
  on('ui.open', ($, e) => {
    opened.push([e.id, e.title, e.focus, e.closeOnEscape])
    return { value: { isPlaced: true } }
  })
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  await ui.press({ key: 'dumb-memory' })
  expect(opened).toEqual([['clawd-context', 'Dumb Memory', true, true]])
  await ui.unmount()
})

const ZONE_PANE = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'clawd-context',
  props: {
    title: 'Dumb Memory',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the Dumb Memory pane lists the context by category and says where the zone starts for this session', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const band = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const pane = await $.ui.mount(ZONE_PANE)
  const has = async (text: string) => (await pane.find({ type: 'Text', text })) !== undefined
  expect(await has('Context · Fable 5.2')).toBe(true)
  expect(await has(' 320.8k of 1M tokens (32%)')).toBe(true)
  // Each row in use, its tokens and its share of the window; the deferred rows stay out.
  expect(await has(' System prompt              3.5k   0.4%')).toBe(true)
  expect(await has(' Messages                 299.7k  30.0%')).toBe(true)
  expect(await pane.find({ type: 'Text', text: /deferred/ })).toBe(undefined)
  // 21100 loaded and 40% of the 978900 left make 412660; the session is 91853 short of it.
  expect(await has('Dumb Memory starts at 412.7k (loaded 21.1k + 40% of the room left):')).toBe(true)
  expect(await has('a rule of thumb for where answers get worse.')).toBe(true)
  expect(await has('This session is 91.9k short of it. Past it: /compact or /new.')).toBe(true)
  expect(await has('Auto-compaction runs at 667k (the grey pill).')).toBe(true)
  await pane.unmount()
  await band.unmount()
})

test('a breakdown the session refuses is asked for again the next second', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let asked = 0
  on('session.id', () => ({ value: 'one' }))
  on('session.usage', ($, e) => {
    if (!e.breakdown) return usageOf([], CONTEXT)
    asked += 1
    return asked === 1 ? { deny: 'not now' } : usageOf([], { ...CONTEXT, breakdown: BREAKDOWN })
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(5000)
  // The one that failed, and the one that answered; none after it.
  expect(asked).toBe(2)
  await ui.unmount()
})

test('a session at rest is asked again once a minute, no sooner', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  const ui = await $.ui.mount(BAND)
  await clock.advance(59_000)
  expect(asked.breakdowns).toBe(1)
  await clock.advance(3000)
  expect(asked.breakdowns).toBe(2)
  await clock.advance(57_000)
  expect(asked.breakdowns).toBe(2)
  await ui.unmount()
})

const TURN_END = { answer: '', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

test("the end of the conversation's own turn asks for the breakdown again, a subagent's does not", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  await $.turn.complete({ ...TURN_END, turnId: 'turn-2', agentId: 'agent-1' })
  await clock.advance(1000)
  expect(asked.breakdowns).toBe(1)
  await $.turn.complete(TURN_END)
  await clock.advance(1000)
  expect(asked.breakdowns).toBe(2)
  await ui.unmount()
})

test('with context_detail off a session whose window a reply has measured is asked for none', { options: { context_detail: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  const ui = await $.ui.mount(BAND)
  await clock.advance(10_000)
  expect(asked.breakdowns).toBe(0)
  await ui.unmount()
})
