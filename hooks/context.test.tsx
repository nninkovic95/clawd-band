import type { On, SessionContextBreakdown } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { barRuns, rowsOf } from './band'
import { BAND, core, imageOf, NOW, pixelOf, usageOf } from './kit'
import type { Drawn } from './kit'
import { BAR_STYLES, settings } from './settings'

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

// The context bar's three extras are off unless turned on: the tests of what they draw turn
// all three on.
const SHOWN = { show_context_kinds: true, show_dumb_memory: true, show_autocompact: true } as const
// The little bars alone: the tests of the breakdown and of what it draws turn them on.
const LITTLE = { show_context_kinds: true } as const

// A session the engine answers for; counts the breakdowns the mod asks of it.
const sessionOf = (on: On, context: { window: number; tokens?: number; percent?: number } = CONTEXT, breakdown = BREAKDOWN) => {
  const asked = { breakdowns: 0 }
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.usage', ($, e) => {
    if (!e.breakdown) return usageOf([], context)
    asked.breakdowns += 1
    return usageOf([], { ...context, breakdown })
  })
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  return asked
}

test('a session is asked for its context by category once while nothing happens', { options: LITTLE }, async ($, on) => {
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
  return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100 }, settings(SHOWN)).at(-1)?.zone
}

test('Dumb Memory starts at what the session loaded plus two fifths of the room left in the window', () => {
  // 21100 + 40% of 978900 is 412660 of the million.
  expect(zoneAt(320_807)).toEqual({ from: 0.41266, isIn: false })
  // The session is in it by its own tokens, one past the start.
  expect(zoneAt(412_660)?.isIn).toBe(false)
  expect(zoneAt(412_661)).toEqual({ from: 0.41266, isIn: true })
})

const DAY = 86_400_000

test('the usage rows each carry a line of detail for the pointer: when the window ends and how long it lasts', () => {
  const detailsOf = (weekUsed: number) => {
    const usage = {
      sevenDay: { percentUsed: weekUsed, resetsAt: new Date(NOW + 5 * DAY).toISOString() },
      fiveHour: { percentUsed: 12, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString() },
    }
    return rowsOf({ usage, context: null, cacheAt: null, now: NOW }, settings({})).map(row => row.detail)
  }
  // Two of the week's seven days are gone and 44% is used: 22% a day, so the 56% left lasts
  // 2.5 days. The time of day is the person's own, so only its form is checked.
  const [week, hours] = detailsOf(44)
  expect(week).toMatch(/^week 44% · resets [A-Z][a-z]{2} \d\d:\d\d · 2\.5 days left at this pace$/)
  expect(hours).toMatch(/^five hours 12% · resets \d\d:\d\d$/)
  // At 10% in two days the week lasts well past its end: said so, not as a count of days.
  expect(detailsOf(10)[0]).toMatch(/^week 10% · resets [A-Z][a-z]{2} \d\d:\d\d · enough to the reset$/)
  // A row nothing is known of has no line.
  expect(rowsOf({ usage: null, context: null, cacheAt: null, now: NOW }, settings({})).map(row => row.detail)).toEqual([undefined, undefined, undefined])
})

test("the context row's line of detail says what the window holds and where its marks are; Dumb Memory has a line of its own once the session is in it", () => {
  const rowAt = (tokens: number, options: Parameters<typeof settings>[0] = SHOWN) => {
    const context = { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100, compactAt: 667_000 }, settings(options)).at(-1)
  }
  const short = rowAt(320_807)
  // Short of it Dumb Memory has a line of its own: where it starts and how far off that is.
  expect([short?.detail, short?.zoneDetail, short?.zoneLine]).toEqual([
    '320.8k of 1M',
    undefined,
    'Dumb Memory from 412.7k · 91.9k to go · answers get worse past it',
  ])
  // 450000 is 37340 past the start at 412660.
  const inside = rowAt(450_000)
  expect([inside?.detail, inside?.zoneDetail]).toEqual([
    '450k of 1M',
    // What stands either side of its name on the band.
    { before: '37.3k inside', after: '/compact or /new' },
  ])
  expect(rowAt(320_807, { show_dumb_memory: false, show_autocompact: false })?.detail).toBe('320.8k of 1M')
  // A window no reply has measured holds nothing to say.
  expect(rowsOf({ usage: null, context: { window: 200_000 }, cacheAt: null, now: NOW }, settings({})).at(-1)?.detail).toBe(undefined)
})

// The context row of the session of CONTEXT, auto-compaction at 667k, its bar in a style.
const markRowAt = (tokens: number, bar_style: 'pill' | 'blocks') => {
  const context = { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }
  return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100, compactAt: 667_000 }, settings({ ...SHOWN, bar_style })).at(-1)
}

test("in the picture style auto-compaction's words leave the row's line for a line of their own, the pill's; a bar in text keeps them in the row's line", () => {
  const pictured = markRowAt(320_807, 'pill')
  // 667000 - 320807 is 346193 still to go.
  expect([pictured?.detail, pictured?.markLine]).toEqual(['320.8k of 1M', 'auto-compact at 667k · 346.2k to go'])
  const text = markRowAt(320_807, 'blocks')
  expect([text?.detail, text?.markLine]).toEqual(['320.8k of 1M · auto-compact at 667k', undefined])
})

test("once the session has reached auto-compaction the pill's line says only where it runs", () => {
  expect(markRowAt(667_000, 'pill')?.markLine).toBe('auto-compact at 667k')
  expect(markRowAt(690_000, 'pill')?.markLine).toBe('auto-compact at 667k')
  // One short of it, a token is still to go.
  expect(markRowAt(666_999, 'pill')?.markLine).toBe('auto-compact at 667k · 1 to go')
})

test("the context row carries a little bar for every kind of memory the session loaded, in /context's order and colours", () => {
  const context = { window: 1_000_000, tokens: 320_807, percent: 32 }
  const categories = [
    { name: 'System prompt', tokens: 3512, color: 'promptBorder' },
    { name: 'MCP tools', tokens: 0, color: 'cyan_FOR_SUBAGENTS_ONLY' },
    { name: 'Memory files', tokens: 3293, color: 'claude' },
    { name: 'Messages', tokens: 299_707, color: 'purple_FOR_SUBAGENTS_ONLY' },
  ]
  const piecesOf = (reading: object) => rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100, ...reading }, settings({})).at(-1)?.pieces
  // Each is its share of the window, in the colour a Text takes and the one a picture is
  // drawn in. The conversation is the fill's own, and a kind that holds nothing has no bar.
  expect(piecesOf({ categories })).toEqual([
    { share: 0.003512, paint: { text: 'promptBorder', rgba: [136, 136, 136, 255] } },
    { share: 0.003293, paint: { text: 'claude', rgba: [215, 119, 87, 255] } },
  ])
  expect(piecesOf({})).toBe(undefined)
})

test('with show_dumb_memory off the context row has no Dumb Memory', () => {
  const zoneWith = (options: Parameters<typeof settings>[0]) => {
    const context = { window: 1_000_000, tokens: 450_000, percent: 45 }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100 }, settings(options)).at(-1)?.zone
  }
  expect(zoneWith(SHOWN)).toBeDefined()
  expect(zoneWith({ show_dumb_memory: false })).toBe(undefined)
})

test('auto-compaction is marked where it runs along the window', () => {
  const markOf = (compactAt: number | null) => {
    const context = { window: 1_000_000, tokens: 320_807, percent: 32 }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100, compactAt }, settings(SHOWN)).at(-1)?.mark
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
  expect(markWith(SHOWN)).toBe(0.667)
  expect(markWith({ show_autocompact: false })).toBe(undefined)
})

test(
  'auto-compaction is a short grey pill in the context bar, a clear ring round it',
  { options: { ...SHOWN, cell_ratio: '2.34' } },
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
// The row's own colour, bar_color_context's default: Claude's orange.
const ORANGE = [215, 119, 87, 255]
// The colours of three kinds of memory in the pictures below.
const [GREY, LIGHT, AMBER] = [[136, 136, 136, 255], [153, 153, 153, 255], [255, 193, 7, 255]]

// A breakdown that loaded the given kinds, each a theme colour and its tokens, before a conversation.
const loadedOf = (...kinds: [string, number][]) =>
  ({
    ...BREAKDOWN,
    categories: [
      ...kinds.map(([color, tokens], k) => ({ name: `Kind ${k}`, tokens, color, isDeferred: false, kind: 'used' })),
      { name: 'Messages', tokens: 20_000, color: 'purple_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    ],
  }) as unknown as SessionContextBreakdown

// A little pill from `from` to `to` along the picture, at mid height: the pixel before it
// clear, its first and last pixels in its colour, the pixel after it clear.
const spanOf = (bar: Drawn, from: number, to: number) => [
  pixelOf(bar, from - 1, 14)[3],
  pixelOf(bar, from, 14),
  pixelOf(bar, to - 1, 14),
  pixelOf(bar, to, 14)[3],
]

test(
  'Dumb Memory is an outline inside the context bar, black while the session is short of it',
  { options: { ...SHOWN, cell_ratio: '2.34' } },
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
  "short of Dumb Memory the conversation's fill is drawn after the little pills, in the row's own colour",
  { options: { ...SHOWN, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // The last little pill ends at 86, the fill starts a gap of 4 after it, at 90. It ends where
    // 32% of the 371 pixels does, 118.7, less the inset of 6: 112.7. Then its clear ring.
    expect([91, 100, 110].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE, ORANGE])
    expect([89, 113].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0])
    expect(pixelOf(bar, 116, 14)).toEqual(TRACK)
    expect(bar.alt).toBe('1m 32%')
    await ui.unmount()
  },
)

test(
  "the conversation's fill is never shorter than 16 pixels, longer than any little pill",
  { options: { ...LITTLE, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 3% of the 371 pixels is 11: the fill would end before the little pills do.
    sessionOf(on, { window: 1_000_000, tokens: 30_000, percent: 3 })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // From 90 to 106: eight lines of 2. Its round ends are blends; within them, orange.
    expect([91, 98, 104].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE, ORANGE])
    expect([89, 106].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0])
    expect(pixelOf(bar, 109, 14)).toEqual(TRACK)
    await ui.unmount()
  },
)

test(
  'with show_context_kinds off the context bar is one fill from its start, as ever',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // No little pills, no Dumb Memory: the fill runs from the bar's start to 118.7.
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    expect(pixelOf(bar, 125, 14)).toEqual(TRACK)
    await ui.unmount()
  },
)

test(
  'a context bar with Dumb Memory and no little pills shows one plain fill from its start, in its own colour short of it',
  { options: { ...SHOWN, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // Nothing loaded but the conversation: Dumb Memory starts at 400000, the session at 320807.
    // The fill runs from the bar's start to 32% of 371 pixels, 118.7, as with the little bars off.
    sessionOf(on, CONTEXT, loadedOf())
    const short = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(short, 'bar-1m'))!
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    expect(pixelOf(bar, 125, 14)).toEqual(TRACK)
    await short.unmount()
  },
)

test(
  'a context bar in Dumb Memory with no little pills shows one plain fill from its start, in the warning colour',
  { options: { ...SHOWN, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // Nothing loaded but the conversation: Dumb Memory starts at 400000, the session at 450000.
    // The fill runs from the bar's start to 45% of 371 pixels, 167; the outline starts at 148.4.
    sessionOf(on, INSIDE, loadedOf())
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    const RED = [255, 107, 128, 255]
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([RED, RED])
    await ui.unmount()
  },
)

test(
  'a context row with no reading draws no fill after its little pills',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // No figure from the engine, and none /context would estimate: the breakdown has no total.
    sessionOf(on, { window: 1_000_000 }, { ...BREAKDOWN, totalTokens: undefined } as unknown as SessionContextBreakdown)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect(bar.alt).toBe('1m --')
    expect([91, 100].map(x => pixelOf(bar, x, 14))).toEqual([TRACK, TRACK])
    await ui.unmount()
  },
)

test(
  'a little pill is as long as its kind holds against the largest: 6 pixels for almost nothing, 14 for the largest',
  { options: { ...LITTLE, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 8000, 4000 and 1000 of the million are each under 3 pixels of 371: they are 6 + 8 x 1,
    // 6 + 8 x 0.5 and 6 + 8 x 0.125 long, 14, 10 and 7, from 10 with a gap of 4 between two.
    sessionOf(on, { window: 1_000_000, tokens: 33_000, percent: 3 }, loadedOf(['promptBorder', 8000], ['inactive', 4000], ['warning', 1000]))
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect(spanOf(bar, 10, 24)).toEqual([0, GREY, GREY, 0])
    expect(spanOf(bar, 28, 38)).toEqual([0, LIGHT, LIGHT, 0])
    expect(spanOf(bar, 42, 49)).toEqual([0, AMBER, AMBER, 0])
    // The fill a gap after the last, at its least, 53 to 69.
    expect([54, 67].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    expect([52, 69].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0])
    await ui.unmount()
  },
)

test(
  'little pills of kinds that hold the same are as long as each other',
  { options: { ...LITTLE, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 4000, 4000 and 8000: 10, 10 and 14 long.
    sessionOf(on, { window: 1_000_000, tokens: 36_000, percent: 4 }, loadedOf(['promptBorder', 4000], ['inactive', 4000], ['warning', 8000]))
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect(spanOf(bar, 10, 20)).toEqual([0, GREY, GREY, 0])
    expect(spanOf(bar, 24, 34)).toEqual([0, LIGHT, LIGHT, 0])
    expect(spanOf(bar, 38, 52)).toEqual([0, AMBER, AMBER, 0])
    await ui.unmount()
  },
)

test(
  'a little pill whose kind holds more than its scaled length is as long as what it holds',
  { options: { ...LITTLE, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 100000 of the million is 37.1 of 371 pixels, more than 14: 37. 30000 is 11.1, more than
    // 6 + 8 x 0.3 = 8.4: 11. 1000 is 0.4, less than 6 + 8 x 0.01 = 6.08: 6.
    sessionOf(on, { window: 1_000_000, tokens: 200_000, percent: 20 }, loadedOf(['promptBorder', 100_000], ['inactive', 30_000], ['warning', 1000]))
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect(spanOf(bar, 10, 47)).toEqual([0, GREY, GREY, 0])
    expect(spanOf(bar, 51, 62)).toEqual([0, LIGHT, LIGHT, 0])
    expect(spanOf(bar, 66, 72)).toEqual([0, AMBER, AMBER, 0])
    // The 6 pixel one is whole: as tall as the others, 6 to 22 down.
    expect(pixelOf(bar, 68, 7)).toEqual(AMBER)
    await ui.unmount()
  },
)

test(
  'once the session is in Dumb Memory the fill shows, red like the outline, striped with black within it, the rest of its inside faintly red',
  { options: { ...SHOWN, cell_ratio: '2.34' } },
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
    // The fill shows only now, and in the warning colour from the bar's start. Inside the
    // outline it and black show by turns, in slanting stripes 4 pixels wide: a point where
    // across and down add up to 168 to 171 is red, one where they add up to 172 to 175 black.
    expect(pixelOf(bar, 100, 14)).toEqual(RED)
    expect(pixelOf(bar, 157, 11)).toEqual(RED)
    expect(pixelOf(bar, 158, 14)).toEqual(BLACK)
    // Past the fill's end the inside is the warning colour at two fifths solid, as the empty part is.
    expect(pixelOf(bar, 300,14)).toEqual([255, 107, 128, 102])
    // Short of the outline the empty part does not change: there is none left here, so the bar's edge.
    expect(pixelOf(bar, 100, 3)).toEqual(TRACK)
    await ui.unmount()
  },
)

test(
  'each kind of memory the session loaded is a little pill of its own at the start of the context bar',
  { options: { ...LITTLE, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // Six kinds, none a hundredth of the window: each is 6 + 8 x its share of the largest's,
    // System tools' 8045, rounded: 9, 14, 6, 7, 9 and 11 pixels, 4 clear pixels between two.
    // They start 10 pixels in, a gap further than a fill does, so that the ring round the
    // first keeps clear of the bar's round end: 10 to 19, 23 to 37, 41 to 47, 51 to 58, 62
    // to 71 and 75 to 86, in /context's order and colours.
    const middles = [14, 30, 44, 54, 66, 80].map(x => pixelOf(bar, x, 14))
    expect(middles).toEqual([
      [136, 136, 136, 255],
      [153, 153, 153, 255],
      [22, 163, 74, 255],
      [177, 185, 249, 255],
      [215, 119, 87, 255],
      [255, 193, 7, 255],
    ])
    expect([20, 38, 48, 59, 72].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0, 0, 0, 0])
    // The bar's rim is whole round its end: at the first pill's upper left the bar's own
    // colour, not the clear of a ring cut through it.
    expect(pixelOf(bar, 6, 6)).toEqual(TRACK)
    // After the last, a clear gap, then the conversation's fill.
    expect(pixelOf(bar, 88, 14)[3]).toBe(0)
    expect(pixelOf(bar, 94, 14)).toEqual(ORANGE)
    await ui.unmount()
  },
)

test(
  "in Dumb Memory the conversation's fill starts after the little pills, a clear gap between",
  { options: { ...SHOWN, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, { window: 1_000_000, tokens: 450_000, percent: 45 })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // The last little pill ends at 86; the fill runs from 90 to where it always ended.
    expect(pixelOf(bar, 80, 14)).toEqual([255, 193, 7, 255])
    expect(pixelOf(bar, 88, 14)[3]).toBe(0)
    expect(pixelOf(bar, 94, 14)).toEqual([255, 107, 128, 255])
    await ui.unmount()
  },
)

test('a bar in text leads with a full cell for each little bar, and fills on after them', () => {
  // Ten cells, three little bars, nothing filled: three full squares of their own, then the empty part.
  expect(barRuns(10, 0, BAR_STYLES.squares, 1, 0, 3)).toEqual([
    { text: '■', part: 'filled', piece: 0 },
    { text: '■', part: 'filled', piece: 1 },
    { text: '■', part: 'filled', piece: 2 },
    { text: '□□□□□□□', part: 'empty' },
  ])
  // Half full: the fill's five cells hold the three, so two more are the fill's own.
  expect(barRuns(10, 50, BAR_STYLES.squares, 1, 0, 3).map(run => run.text)).toEqual(['■', '■', '■', '■■', '□□□□□'])
})

test('a bar in text with little bars gives any fill at least two of their units of its own', () => {
  // 5% of ten cells is half of one, under the three little bars: the fill is still two cells.
  expect(barRuns(10, 5, BAR_STYLES.squares, 1, 0, 3).map(run => [run.text, run.part])).toEqual([
    ['■', 'filled'],
    ['■', 'filled'],
    ['■', 'filled'],
    ['■■', 'filled'],
    ['□□□□□', 'empty'],
  ])
  // A little bar in circles is one circle, two cells: the fill is two circles after it.
  expect(barRuns(10, 2, BAR_STYLES.circles, 1, 0, 1).map(run => run.text).join('')).toBe(`${WHOLE} ${WHOLE} ${WHOLE} ${OPEN} ${OPEN} `)
  // Nothing used, nothing filled.
  expect(barRuns(10, 0, BAR_STYLES.squares, 1, 0, 3).at(-1)).toEqual({ text: '□□□□□□□', part: 'empty' })
})

// What a full cell is in each style of bar drawn in text; the first cell of `blocks` is its round end.
const FULL = { blocks: ['\ue0b6', '█'], dots: ['⣿', '⣿'], squares: ['■', '■'], line: ['━', '━'] } as const
const KINDS = ['promptBorder', 'inactive', 'green_FOR_SUBAGENTS_ONLY', 'permission', 'claude', 'warning']
// The cells of the conversation's fill: those in the row's colour after the six little bars.
const fillOf = (children: Tree[]): number =>
  children
    .slice(8)
    .filter(cell => cell?.props?.color === 'claude')
    .map(textIn)
    .join('').length


for (const [style, [first, full]] of Object.entries(FULL)) {
  test(`bars drawn as ${style} show each kind of memory as one cell in its colour`, { options: { ...SHOWN, bar_style: style } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    // The row is its label, a dot, the bar's runs, a dot and the figures.
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    const cells = row.children.slice(2, 8)
    expect(cells.map(cell => cell.props.color)).toEqual(KINDS)
    expect(cells.map(textIn)).toEqual([first, full, full, full, full, full])
    // The conversation's fill follows them in the row's own colour, short of Dumb Memory too:
    // 32% of 31 cells is 10, four after the six.
    expect(row.children[8]?.props.color).toBe('claude')
    expect(fillOf(row.children)).toBe(4)
    await ui.unmount()
  })

  test(`bars drawn as ${style} give the conversation's fill at least two cells after the little bars`, { options: { ...LITTLE, bar_style: style } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 3% of 31 cells is one, which the little bars would hide.
    sessionOf(on, { window: 1_000_000, tokens: 30_000, percent: 3 })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    expect(row.children[8]?.props.color).toBe('claude')
    expect(fillOf(row.children)).toBe(2)
    await ui.unmount()
  })
}

test('with show_context_kinds off a bar in text is one fill from its start, as ever', { options: { bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
  expect(row.children.slice(2, 4).map(cell => [textIn(cell), cell.props.color])).toEqual([
    ['■'.repeat(10), 'claude'],
    ['□'.repeat(21), 'inactive'],
  ])
  await ui.unmount()
})

test('with show_dumb_memory alone a bar in squares has no little bars: its fill starts in its first cell', { options: { bar_style: 'squares', show_dumb_memory: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
  // 32% of 31 cells is 10, from the bar's first cell, in the row's own colour.
  expect([textIn(row.children[2]!), row.children[2]?.props.color]).toEqual(['■'.repeat(10), 'claude'])
  // No cell anywhere in the row is in a colour of the little bars.
  const colors = row.children.map(cell => cell.props?.color)
  expect(colors.filter(color => KINDS.includes(color as string) && color !== 'claude' && color !== 'inactive')).toEqual([])
  await ui.unmount()
})

test('a bar too short for a cell each shows what was loaded as one cell, in the first kind\'s colour', { options: { ...LITTLE, bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  // 52 columns leave the bar 12 cells: six little bars would be half of it.
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 52 } })
  await clock.advance(1000)
  const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
  // The fill after it in the row's colour: 32% of 12 cells is 4, three after the one.
  expect(row.children.slice(2, 5).map(cell => [textIn(cell), cell.props.color])).toEqual([
    ['■', 'promptBorder'],
    ['■■■', 'claude'],
    ['□□□□□□□□', 'inactive'],
  ])
  await ui.unmount()
})

const [OPEN, HALF, WHOLE] = ['\u{F0766}', '\u{F1396}', '\u{F0765}']

test('a circle is two cells, each half of it a cell: empty, half filled or full', () => {
  // Eight cells are four circles of two halves. Half used: two full circles.
  expect(barRuns(8, 50, BAR_STYLES.circles)).toEqual([
    { text: WHOLE, part: 'filled', half: 0 },
    { text: ' ', part: 'filled', half: 1 },
    { text: WHOLE, part: 'filled', half: 2 },
    { text: ' ', part: 'filled', half: 3 },
    { text: OPEN, part: 'empty', half: 4 },
    { text: ' ', part: 'empty', half: 5 },
    { text: OPEN, part: 'empty', half: 6 },
    { text: ' ', part: 'empty', half: 7 },
  ])
  // Three halves of the eight: the second circle is half filled, its right half empty.
  expect(barRuns(8, 37.5, BAR_STYLES.circles).slice(2, 4)).toEqual([
    { text: HALF, part: 'filled', half: 2 },
    { text: ' ', part: 'empty', half: 3 },
  ])
  // A cell left over is a blank at the bar's end.
  expect(barRuns(5, 0, BAR_STYLES.circles).map(run => run.text).join('')).toBe(`${OPEN} ${OPEN}  `)
})

test(
  'in the circles style every half of a circle is a place for the pointer, with a line of its own',
  { options: { ...LITTLE, bar_style: 'circles' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    // The 31 cells are 15 circles, 30 halves of 3.3% each. At 32% the first ten are used:
    // the half numbered 9 is 30% to 33%, the next 33% to 37%.
    const lineOf = async (half: number) => (await ui.find({ key: `detail-1m-${half}` })) as Tree | undefined
    const [used, free, loaded] = [await lineOf(9), await lineOf(10), await lineOf(0)]
    expect([used?.props.display, used?.props.position, used?.props.top, used?.props.left]).toEqual(['none', 'absolute', 0, 1])
    expect(await hoverAt(ui, 'detail-1m-9')).toEqual({ scope: 'clawd-band-1m-9', display: 'flex' })
    expect(used && textIn(used)).toBe('1m · 30% to 33% · used'.padEnd(69))
    expect(free && textIn(free)).toBe('1m · 33% to 37% · free'.padEnd(69))
    // What the session loaded is the first circle here: six little bars are too many for 15.
    expect(loaded && textIn(loaded)).toBe('1m · 0% to 3% · loaded'.padEnd(69))
    // The half itself is in its line's group: the row is its label, a dot, then the halves.
    const row = keyed(await ui.drawn(), 'row-1m')
    expect((row?.children?.[2 + 9] as { hover?: unknown } | undefined)?.hover).toEqual({ scope: 'clawd-band-1m-9' })
    const first = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    // The conversation's fill follows in the row's colour: 10 halves, the four circles after it.
    expect([textIn(first.children[2]!), first.children[2]?.props.color, textIn(first.children[4]!), first.children[4]?.props.color]).toEqual([
      WHOLE,
      'promptBorder',
      WHOLE,
      'claude',
    ])
    await ui.unmount()
  },
)

test("in the circles style the conversation's fill is at least two circles after the little bars", { options: { ...LITTLE, bar_style: 'circles' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // 3% of 30 halves is one: under the one circle of what was loaded.
  sessionOf(on, { window: 1_000_000, tokens: 30_000, percent: 3 })
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
  expect(row.children.slice(4, 9).map(cell => [textIn(cell), cell.props.color])).toEqual([
    [WHOLE, 'claude'],
    [' ', 'claude'],
    [WHOLE, 'claude'],
    [' ', 'claude'],
    [OPEN, 'inactive'],
  ])
  await ui.unmount()
})

// A session past Dumb Memory's start at 412660.
const INSIDE = { window: 1_000_000, tokens: 450_000, percent: 45 }

test('the words Dumb Memory stand in the top row over where the zone starts once the session is in it: a button, in the warning colour', { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on, INSIDE)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const words = await ui.find({ key: 'dumb-memory' })
  expect([words?.type, words?.props.label, words?.props.plain]).toEqual(['Button', 'Dumb Memory', true])
  expect((await ui.find({ type: 'Text', text: 'Dumb Memory' }))?.props.color).toBe('error')
  // The bars start 22 cells in: 1, Clawd's 16, 1, "1m " and a blank. The zone starts 0.41266
  // along the 31 cells of the bar, in its cell 12, so 34 cells in: the probe's cell and 33 more.
  expect((await ui.find({ key: 'dumb-memory-before' }))?.props.width).toBe(33)
  await ui.unmount()
})

test('short of Dumb Memory the top row holds no words, only the outline tells of it', { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  expect(await ui.find({ key: 'dumb-memory' })).toBe(undefined)
  expect(await ui.find({ key: 'bar-1m' })).toBeDefined()
  await ui.unmount()
})

test(
  'with show_dumb_memory off the context bar fills in its own colour at any level',
  { options: { cell_ratio: '2.34', show_dumb_memory: false } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect(pixelOf((await imageOf(ui, 'bar-1m'))!, 100, 14)).toEqual([215, 119, 87, 255])
    await ui.unmount()
  },
)

type Tree = { props: Record<string, unknown>; children: (Tree | string)[] }
// The hover of the element keyed `key`, read from the tree as drawn: what `find`
// describes leaves a hover out.
type DrawnNode = { key?: unknown; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
const keyed = (node: unknown, key: string): DrawnNode | undefined => {
  if (typeof node !== 'object' || node === null) return undefined
  const at = node as DrawnNode
  if (at.key === key || at.props?.key === key) return at
  for (const child of at.children ?? []) {
    const found = keyed(child, key)
    if (found) return found
  }
  return undefined
}
const hoverAt = async (ui: { drawn: () => Promise<unknown> }, key: string): Promise<unknown> => {
  const node = keyed(await ui.drawn(), key)
  return node?.hover ?? node?.props?.hover
}
const textIn = (node: Tree | string): string => (typeof node === 'string' ? node : node.children.map(textIn).join(''))

test("a row's line of detail is drawn hidden over the top row, in one hover group with its row", { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
  // Placed over the top row, so that showing it moves nothing, a cell in from the band's edge.
  expect([line?.props.display, line?.props.position, line?.props.top, line?.props.left]).toEqual(['none', 'absolute', 0, 1])
  expect(await hoverAt(ui, 'detail-1m')).toEqual({ scope: 'clawd-band-1m', display: 'flex' })
  // As wide as the band's 71 columns leave, so that it covers what the top row holds.
  expect(line && textIn(line)).toBe('320.8k of 1M'.padEnd(69))
  expect(await hoverAt(ui, 'row-1m')).toEqual({ scope: 'clawd-band-1m' })
  // The session of this test is told nothing of its usage: those rows have no line.
  expect(await ui.find({ key: 'detail-7d' })).toBe(undefined)
  await ui.unmount()
})

test(
  "in the pill style with no picture drawn, the bar in text, the row's line of detail says where auto-compaction runs",
  { options: { ...SHOWN, bar_style: 'pill' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    on('session.id', () => ({ value: 'one' }))
    on('session.model', () => ({ value: 'claude-fable-5-2' }))
    on('session.usage', ($, e) => usageOf([], e.breakdown ? { ...CONTEXT, breakdown: BREAKDOWN } : CONTEXT))
    on('session.authorize', () => ({ deny: 'no account in a test' }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('ui.render', core)
    on('ui.blit', () => ({ value: { deny: 'the Image draws its alt here: no pictures in a test' } }))
    const ui = await $.ui.mount(PILLS)
    await clock.advance(2000)
    // No pill is drawn, so no line of its own: the row's line names it.
    expect(await ui.find({ key: 'detail-mark' })).toBe(undefined)
    const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
    expect(line && textIn(line)).toBe('320.8k of 1M · auto-compact at 667k'.padEnd(69))
    await ui.unmount()
  },
)

test('the pointer on the zone itself, the framed part of the context bar, shows where Dumb Memory starts', { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  // A picture is one place for the pointer, so an empty box lies over the zone's cells of
  // the bar: after the label's three cells and the dot, from the bar's cell 12 to its last.
  const over = await ui.find({ key: 'zone-over' })
  expect([over?.props.position, over?.props.top, over?.props.left, over?.props.width, over?.props.height]).toEqual(['absolute', 0, 16, 19, 1])
  expect(await hoverAt(ui, 'zone-over')).toEqual({ scope: 'clawd-band-zone' })
  // Its line is hidden over the top row, as a row's is.
  const line = (await ui.find({ key: 'detail-zone' })) as Tree | undefined
  expect([line?.props.display, line?.props.position, line?.props.top, line?.props.left]).toEqual(['none', 'absolute', 0, 1])
  expect(await hoverAt(ui, 'detail-zone')).toEqual({ scope: 'clawd-band-zone', display: 'flex' })
  expect(line && textIn(line)).toBe('Dumb Memory from 412.7k · 91.9k to go · answers get worse past it'.padEnd(69))
  await ui.unmount()
})

// The keys of what the element keyed `key` holds, in the order it is drawn.
const keysIn = async (ui: { drawn: () => Promise<unknown> }, key: string): Promise<unknown[]> =>
  (keyed(await ui.drawn(), key)?.children ?? []).map(child => (child as DrawnNode).key ?? (child as DrawnNode).props?.key)

test('the pointer on the auto-compaction pill itself, and only there, says where auto-compaction runs and how far off it is', { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  // The bar is 31 cells, a row of 28 pixels at a cell ratio of 2.2: the picture is
  // round(31 * 28 / 2.2) = 395 pixels across, a cell 395 / 31 = 12.742 of them, a line
  // round(28 / 12) = 2. The pill's middle is at 395 * 0.667 = 263.465; with its clear ring it
  // runs 3 lines either side, 257.465 to 269.465: cell 257.465 / 12.742 = 20.2 to cell
  // 269.465 / 12.742 = 21.1. After the label's three cells and the dot, from 24, two wide.
  const over = await ui.find({ key: 'mark-over' })
  expect([over?.props.position, over?.props.top, over?.props.left, over?.props.width, over?.props.height]).toEqual(['absolute', 0, 24, 2, 1])
  // A group of its own: neither the row's nor the zone's.
  expect(await hoverAt(ui, 'mark-over')).toEqual({ scope: 'clawd-band-mark' })
  // Drawn after the zone's box, so that where the pill lies in Dumb Memory its box is on top.
  const row = await keysIn(ui, 'row-1m')
  expect(row.indexOf('mark-over')).toBeGreaterThan(row.indexOf('zone-over'))
  expect(row.indexOf('zone-over')).toBeGreaterThan(-1)
  // Its line is hidden over the top row, as the zone's is, and drawn after it.
  const line = (await ui.find({ key: 'detail-mark' })) as Tree | undefined
  expect([line?.props.display, line?.props.position, line?.props.top, line?.props.left]).toEqual(['none', 'absolute', 0, 1])
  expect(await hoverAt(ui, 'detail-mark')).toEqual({ scope: 'clawd-band-mark', display: 'flex' })
  expect(line && textIn(line)).toBe('auto-compact at 667k · 346.2k to go'.padEnd(69))
  const band = await keysIn(ui, 'band')
  expect(band.indexOf('detail-mark')).toBeGreaterThan(band.indexOf('detail-zone'))
  expect(band.indexOf('detail-zone')).toBeGreaterThan(-1)
  await ui.unmount()
})

test("a bar in text draws no auto-compaction pill: the row's own line says where auto-compaction runs", { options: { ...SHOWN, bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  expect(await ui.find({ key: 'mark-over' })).toBe(undefined)
  expect(await ui.find({ key: 'detail-mark' })).toBe(undefined)
  const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
  expect(line && textIn(line)).toBe('320.8k of 1M · auto-compact at 667k'.padEnd(69))
  await ui.unmount()
})

test("the place for the pointer on a pill at the bar's end ends with the bar's last cell", { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on, CONTEXT, { ...BREAKDOWN, autoCompactThreshold: 999_000 })
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  // The pill's middle is at 395 * 0.999 = 394.605 of the 395 pixels; its ring runs from
  // 388.605, in cell 388.605 / 12.742 = 30.5, to 400.605, past the picture's end: the box is
  // the last cell alone, 30, after the label's three cells and the dot at 34.
  const over = await ui.find({ key: 'mark-over' })
  expect([over?.props.left, over?.props.width]).toEqual([34, 1])
  await ui.unmount()
})

test('with the options as they come there is no auto-compaction pill, so no place for the pointer on it and no line of its own', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  expect(await ui.find({ key: 'mark-over' })).toBe(undefined)
  expect(await ui.find({ key: 'detail-mark' })).toBe(undefined)
  await ui.unmount()
})

test("Dumb Memory's own detail stands hidden either side of its name, which stays free for a press", { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on, INSIDE)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const shown = { scope: 'clawd-band-zone', display: 'flex' }
  const before = (await ui.find({ key: 'zone-before' })) as Tree | undefined
  const after = (await ui.find({ key: 'zone-after' })) as Tree | undefined
  expect([before?.props.display, await hoverAt(ui, 'zone-before')]).toEqual(['none', shown])
  expect([after?.props.display, await hoverAt(ui, 'zone-after')]).toEqual(['none', shown])
  expect([before && textIn(before), after && textIn(after)]).toEqual(['37.3k inside · ', ' · /compact or /new'])
  // The name is in their group, and the cells before it are as wide as they were: nothing moves.
  expect(await hoverAt(ui, 'dumb-memory')).toEqual({ scope: 'clawd-band-zone' })
  // The zone in the bar is in the same group: the pointer on it brings up the same words.
  expect(await hoverAt(ui, 'zone-over')).toEqual({ scope: 'clawd-band-zone' })
  expect(await ui.find({ key: 'detail-zone' })).toBe(undefined)
  const spacer = await ui.find({ key: 'dumb-memory-before' })
  expect([spacer?.props.width, spacer?.props.justifyContent]).toEqual([33, 'flex-end'])
  await ui.unmount()
})

test('a press on the words opens the Dumb Memory pane and hands it the keyboard', { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on, INSIDE)
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

test('the Dumb Memory pane lists the context by category and says where the zone starts for this session', { options: LITTLE }, async ($, on) => {
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

test("the pane ends on a button that opens /usage, where the recommendations are, and fits its rows to a narrow pane", { options: LITTLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ran: string[] = []
  on('command.run', { command: 'usage' }, ($, e) => {
    ran.push(`${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  const band = await $.ui.mount(PILLS)
  await clock.advance(1000)
  // A pane 38 cells wide: a row is a square, the name in 21 cells, the tokens in 6 and the share in 6.
  const pane = await $.ui.mount({ ...ZONE_PANE, props: { ...ZONE_PANE.props, bodyColumns: 38 } })
  expect(await pane.find({ type: 'Text', text: ` System prompt${' '.repeat(11)}3.5k   0.4%` })).toBeDefined()
  expect((await pane.find({ key: 'usage' }))?.props.label).toBe("See /usage's recommendations")
  await pane.press({ key: 'usage' })
  expect(ran).toEqual(['usage'])
  await pane.unmount()
  await band.unmount()
})

test('a breakdown the session refuses is asked for again the next second', { options: LITTLE }, async ($, on) => {
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

test('a session at rest is asked again once a minute, no sooner', { options: LITTLE }, async ($, on) => {
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

test("the end of the conversation's own turn asks for the breakdown again, a subagent's does not", { options: LITTLE }, async ($, on) => {
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

test('with the three switches off a session whose window a reply has measured is asked for none', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  const ui = await $.ui.mount(BAND)
  await clock.advance(10_000)
  expect(asked.breakdowns).toBe(0)
  await ui.unmount()
})

test(
  'with the three switches as they come the breakdown is never asked for, and the context bar is the plain one',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const asked = sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(61_000)
    expect(asked.breakdowns).toBe(0)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // No little bars: one fill from the bar's start to 32% of 371 pixels, 118.7, in its own colour.
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    expect(pixelOf(bar, 125, 14)).toEqual(TRACK)
    // No outline: where its upper edge and its end would run, the bar's empty part.
    expect([pixelOf(bar, 300, 5), pixelOf(bar, 365, 14)]).toEqual([TRACK, TRACK])
    expect(await ui.find({ key: 'dumb-memory' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'Dumb Memory' })).toBe(undefined)
    // No pill: at 247.5 of the 371 pixels, and its ring at 242, the empty part.
    expect([pixelOf(bar, 242, 14), pixelOf(bar, 247, 14)]).toEqual([TRACK, TRACK])
    expect(await ui.find({ key: 'detail-mark' })).toBe(undefined)
    const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
    expect(line && textIn(line)).toBe('320.8k of 1M'.padEnd(69))
    await ui.unmount()
  },
)

test(
  'show_context_kinds alone asks for the breakdown and draws the little bars, with no outline and no pill',
  { options: { show_context_kinds: true, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const asked = sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect(asked.breakdowns).toBe(1)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // The first little bar, System prompt's grey, from 10 to 19; after the last, at 86, a clear
    // gap and the conversation's fill from 90 to 112.7.
    expect(pixelOf(bar, 14, 14)).toEqual(GREY)
    expect(pixelOf(bar, 88, 14)[3]).toBe(0)
    expect(pixelOf(bar, 100, 14)).toEqual(ORANGE)
    // No outline from 153.1 on, no pill at 247.5: the bar's empty part.
    expect([pixelOf(bar, 300, 5), pixelOf(bar, 365, 14), pixelOf(bar, 242, 14), pixelOf(bar, 247, 14)]).toEqual([TRACK, TRACK, TRACK, TRACK])
    expect(await ui.find({ key: 'dumb-memory' })).toBe(undefined)
    expect(await ui.find({ key: 'detail-mark' })).toBe(undefined)
    await ui.unmount()
  },
)

test(
  "show_dumb_memory alone asks for the breakdown and draws the outline, with no little bars and no pill: the conversation's fill starts at the bar's start",
  { options: { show_dumb_memory: true, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const asked = sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect(asked.breakdowns).toBe(1)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // The outline from 0.41266 of the 371 pixels, 153.1: its left end at mid height, its upper edge.
    expect([pixelOf(bar, 154, 14), pixelOf(bar, 300, 5)]).toEqual([BLACK, BLACK])
    // No little bars: where System prompt's would be, at 14, the fill, which runs from the bar's
    // start to 32% of the 371 pixels, 118.7, as a bar with no breakdown.
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    expect(pixelOf(bar, 125, 14)).toEqual(TRACK)
    // No pill at 247.5, nor its ring at 242: inside the outline, the bar's empty part.
    expect([pixelOf(bar, 242, 14), pixelOf(bar, 247, 14)]).toEqual([TRACK, TRACK])
    expect(await ui.find({ key: 'detail-mark' })).toBe(undefined)
    await ui.unmount()
  },
)

test(
  'show_autocompact alone asks for the breakdown and draws the pill, with no little bars and no outline',
  { options: { show_autocompact: true, cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const asked = sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect(asked.breakdowns).toBe(1)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // 667000 of the million is 247.5 of the 371 pixels: the pill from 243.5 to 251.5 in the
    // buffer's grey, a clear ring at 242 and 252.
    expect([245, 249].map(x => pixelOf(bar, x, 14))).toEqual([LIGHT, LIGHT])
    expect([242, 252].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0])
    expect(await ui.find({ key: 'detail-mark' })).toBeDefined()
    // No little bars: the fill from the bar's start to 118.7.
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    // No outline: where its left end, upper edge and end would run, the bar's empty part.
    expect([pixelOf(bar, 154, 14), pixelOf(bar, 300, 5), pixelOf(bar, 365, 14)]).toEqual([TRACK, TRACK, TRACK])
    expect(await ui.find({ key: 'dumb-memory' })).toBe(undefined)
    await ui.unmount()
  },
)

test('a dumb_zone of 50 starts Dumb Memory at what the session loaded plus half the room left', () => {
  const zoneAt = (tokens: number) => {
    const context = { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 100_000 }, settings({ ...SHOWN, dumb_zone: 50 })).at(-1)?.zone
  }
  // 100000 + 50% of 900000 is 550000 of the million.
  expect(zoneAt(550_000)).toEqual({ from: 0.55, isIn: false })
  expect(zoneAt(550_001)).toEqual({ from: 0.55, isIn: true })
})

test(
  'with dumb_zone 0 there is no Dumb Memory: no outline, no words, no warning colour, no line for the pointer',
  { options: { ...SHOWN, cell_ratio: '2.34', dumb_zone: 0 } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // Inside the zone at the usual 40, which would start at 412660.
    sessionOf(on, INSIDE)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect(await ui.find({ key: 'dumb-memory' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'Dumb Memory' })).toBe(undefined)
    expect(await ui.find({ key: 'zone-over' })).toBe(undefined)
    expect(await ui.find({ key: 'detail-zone' })).toBe(undefined)
    const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
    expect(line && textIn(line)).not.toContain('Dumb Memory')
    const bar = (await imageOf(ui, 'bar-1m'))!
    // Where the outline would run, upper edge and end, the bar's empty part as ever.
    expect(pixelOf(bar, 300, 5)).toEqual(TRACK)
    expect(pixelOf(bar, 300, 14)).toEqual(TRACK)
    // The fill, 45% of 371 pixels, is not in the warning colour.
    expect(pixelOf(bar, 100, 14)).not.toEqual([255, 107, 128, 255])
    await ui.unmount()
  },
)

test(
  'with show_context_kinds off a session no reply has measured is estimated from its breakdown, and its bar still has no little bars',
  { options: { bar_style: 'squares' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // No percentage in the plain figures: the breakdown is asked for its estimate, 320807 of the million.
    sessionOf(on, { window: 1_000_000 })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(3000)
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    // 32% of 31 cells is 10, one fill from the bar's start.
    expect(row.children.slice(2, 4).map(cell => [textIn(cell), cell.props.color])).toEqual([
      ['■'.repeat(10), 'claude'],
      ['□'.repeat(21), 'inactive'],
    ])
    await ui.unmount()
  },
)

test('a session id lookup that fails once the session is known is no new session: its breakdown is not asked for again', { options: LITTLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let asked = 0
  let hasId = true
  on('session.id', () => (hasId ? { value: 'one' } : { deny: 'no id now' }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.usage', ($, e) => {
    if (!e.breakdown) return usageOf([], CONTEXT)
    asked += 1
    return usageOf([], { ...CONTEXT, breakdown: BREAKDOWN })
  })
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  expect(asked).toBe(1)
  hasId = false
  await clock.advance(5000)
  expect(asked).toBe(1)
  await ui.unmount()
})
// The cells a drawn node takes across, measured as band.test.tsx measures a row: a row its
// children's together, a column its widest, a Box at least the width it sets, an Image its
// columns, each with its margins. A box laid over the others, at an absolute place, takes none
// of its parent's: it is measured by `overhangs`.
type Laid = { type?: string; key?: unknown; props?: Record<string, unknown>; children?: (Laid | string)[] }
const isOver = (node: Laid | string): boolean => typeof node !== 'string' && node.props?.position === 'absolute'
const cellsAcross = (node: Laid | string): number => {
  if (typeof node === 'string') return [...node].length
  const props = node.props ?? {}
  const kids = (node.children ?? []).filter(kid => !isOver(kid))
  const number = (value: unknown) => (typeof value === 'number' ? value : 0)
  const inner =
    node.type === 'Image'
      ? number(props.columns)
      : props.flexDirection === 'column'
        ? Math.max(0, ...kids.map(cellsAcross))
        : kids.map(cellsAcross).reduce((sum, cells) => sum + cells, 0)
  return number(props.marginLeft) + Math.max(number(props.width), inner) + number(props.marginRight)
}

// Each box laid over another that reaches past it, its key, its last cell from its box's start
// and its box's width: a box over a row ends within the row. A node is `width` cells across: in
// a column it stretches to the column's width less its margins, in a row it takes its own.
const overhangs = (node: Laid | string, width: number): string[] => {
  if (typeof node === 'string') return []
  const props = node.props ?? {}
  const kids = node.children ?? []
  const number = (value: unknown) => (typeof value === 'number' ? value : 0)
  const reach = (kid: Laid) => number(kid.props?.left) + cellsAcross(kid)
  const own = kids
    .filter(isOver)
    .map(kid => kid as Laid)
    .filter(kid => reach(kid) > width)
    .map(kid => `${String(kid.props?.key ?? kid.key)}: ${reach(kid)} of ${width}`)
  const widthOf = (kid: Laid | string): number =>
    typeof kid !== 'string' && props.flexDirection === 'column' && !isOver(kid)
      ? width - number(kid.props?.marginLeft) - number(kid.props?.marginRight)
      : cellsAcross(kid)
  return [...own, ...kids.flatMap(kid => overhangs(kid, widthOf(kid)))]
}

// The narrowest band that draws bars: Clawd hidden, his column the model's name, "Fable 5.2",
// with a cell either side; "1m ", a dot, the bar's 4 cells, a dot, " 45%" and the edge: 25.
const NARROWEST = { ...BAND, props: { ...BAND.props, bodyColumns: 25 } }
// The band whose bars first reach 255 cells, the most an Image takes: a cell, Clawd's 16 and a
// cell, "1m ", a dot, 255 cells, a dot, " 45%", " 06d-23h-59m" and the edge: 295.
const WIDEST = { ...BAND, props: { ...BAND.props, bodyColumns: 295 } }

// Every bar the band drew as a picture: its cells, its rows, its pixels across and down, and
// whether its bytes are every pixel of that size whole, within the 2 MiB an Image takes.
const picturedBars = async (ui: { findAll: (query: { type: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Image' }))
    .filter(image => image.key?.startsWith('bar-'))
    .map(image => {
      const { columns, rows, source } = image.props as Drawn
      const bytes = Uint8Array.fromBase64(source.rgba).length
      return [image.key, columns, rows, source.width, source.height, bytes === source.width * source.height * 4 && bytes <= 2 * 1024 * 1024]
    })

test(
  'at the narrowest band that draws bars, with little bars, mark, zone and dots on, no row is wider than the band and each bar is a whole picture of 4 cells',
  { options: SHOWN },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, INSIDE)
    const ui = await $.ui.mount(NARROWEST)
    await clock.advance(1000)
    const drawn = (await ui.drawn()) as Laid
    expect(cellsAcross(drawn)).toBeLessThanOrEqual(25)
    expect(overhangs(drawn, 25)).toEqual([])
    // The auto-compaction pill's box is among what is measured.
    expect(await ui.find({ key: 'mark-over' })).toBeDefined()
    // 4 cells at the usual 2.2 are 4 times 28 pixels over 2.2 across, 51, and a row of 28 down.
    const bars = await picturedBars(ui)
    expect(bars.map(bar => bar[0])).toContain('bar-1m')
    expect(bars.map(bar => bar.slice(1))).toEqual(bars.map(() => [4, 1, 51, 28, true]))
    await ui.unmount()
  },
)

test(
  'at the widest bar, with little bars, mark, zone and dots on, no row is wider than the band and each bar is a whole picture of 255 cells',
  { options: SHOWN },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, INSIDE)
    // A band wider still keeps its bars at 255 cells.
    for (const columns of [295, 400]) {
      const ui = await $.ui.mount({ ...WIDEST, props: { ...WIDEST.props, bodyColumns: columns } })
      await clock.advance(1000)
      const drawn = (await ui.drawn()) as Laid
      expect(cellsAcross(drawn)).toBeLessThanOrEqual(columns)
      expect(overhangs(drawn, columns)).toEqual([])
      // 255 cells take a row of fewer pixels, so that the picture stays within the 2048 an Image
      // takes across: 2048 times 2.2 over 255 is 17.67, a row of 17; across, 255 times 17 over 2.2.
      const bars = await picturedBars(ui)
      expect(bars.map(bar => bar[0])).toContain('bar-1m')
      expect(bars.map(bar => bar.slice(1))).toEqual(bars.map(() => [255, 1, 1970, 17, true]))
      await ui.unmount()
    }
  },
)

// The cells of a bar drawn in text: its row's children between the dot after the label and the
// dot before the figure.
const textBarCells = (row: Tree): number => {
  const textOf = (node: Tree | string): string => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''))
  const texts = row.children.map(textOf)
  return [...texts.slice(2, texts.indexOf('·', 2)).join('')].length
}

test(
  'bars drawn as squares, at the narrowest band that draws them and at the widest bar, keep every row within the band and every bar to its cells',
  { options: { ...SHOWN, bar_style: 'squares' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, INSIDE)
    const widths: [number, number][] = [
      [25, 4],
      [295, 255],
      [400, 255],
    ]
    for (const [columns, cells] of widths) {
      const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns } })
      await clock.advance(1000)
      const drawn = (await ui.drawn()) as Laid
      expect(cellsAcross(drawn)).toBeLessThanOrEqual(columns)
      expect(overhangs(drawn, columns)).toEqual([])
      const rows = await Promise.all(['row-7d', 'row-5h', 'row-1m'].map(key => ui.find({ key })))
      expect(rows.map(row => row && textBarCells(row as unknown as Tree))).toEqual([cells, cells, cells])
      await ui.unmount()
    }
  },
)

// A bar's 4 cells at a cell shape, and the pixels that makes across: 4 times a row of 28 over
// the shape. Every line is 2 thick, the air round the bar 2: the bar's rim at its right end is the
// 2 pixels before its last 2, and what is inside the bar ends 6 short of its end, where a full
// fill would. Its one little bar runs from 10 to 24 whatever the shape: 6 lines and the gap.
// The fill after it, a gap on, is never under 8 lines: 28 to 44, and its clear ring to 46.
// At 2.34 the bar is 48 pixels: the ring cuts the rim, at 44 and 45, away. At 2.8 it is 40: the
// fill runs on through the rim to the bar's end. So under 5 cells there are no little bars: the
// fill is one plain fill from the bar's start, and all three hold.
const NARROW_SHAPES: [string, number, boolean][] = [
  ['2.2', 51, true],
  ['2.34', 48, true],
  ['2.8', 40, true],
]
const sameRgb = (one: number[], other: number[]) => one.slice(0, 3).join() === other.slice(0, 3).join()

for (const [ratio, width, holds] of NARROW_SHAPES) {
  // The engine's tests have no skip: a case that does not hold yet is left out of the run.
  if (!holds) continue
  test(
    `at its narrowest, 4 cells at a cell shape of ${ratio}, the context bar holds its fill inside its rim`,
    { options: { ...SHOWN, cell_ratio: ratio } },
    async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      sessionOf(on)
      const ui = await $.ui.mount(NARROWEST)
      await clock.advance(1000)
      const bar = (await imageOf(ui, 'bar-1m'))!
      expect([bar.columns, bar.source.width, bar.source.height]).toEqual([4, width, 28])
      // What stands first inside the bar: at 10 lies a little bar or the fill at every shape,
      // short of Dumb Memory's outline, which starts at 16.5 at the narrowest.
      const piece = pixelOf(bar, 10, 14)
      expect(piece[3]).toBe(255)
      // From where the inside ends to the bar's end, at mid height, not a pixel of the fill's
      // colour or the little bar's, whole or in part.
      const past = Array.from({ length: 6 }, (_, k) => pixelOf(bar, width - 6 + k, 14))
      expect(past.filter(colour => sameRgb(colour, ORANGE) || sameRgb(colour, piece))).toEqual([])
      // The rim, whole: both its pixels the empty part's colour.
      expect([width - 4, width - 3].map(x => pixelOf(bar, x, 14))).toEqual([TRACK, TRACK])
      await ui.unmount()
    },
  )
}

test(
  'at its widest, 255 cells, a full context bar ends its fill where the inside ends and draws its rim whole',
  { options: { show_dumb_memory: false } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, { window: 1_000_000, tokens: 1_000_000, percent: 100 })
    const ui = await $.ui.mount(WIDEST)
    await clock.advance(1000)
    // 1970 pixels by 17: every line 1 thick, the air round the bar 1. A full fill ends 3 short of
    // the end, at 1967, its clear ring to 1968; the rim is 1968 to 1969.
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect([bar.columns, bar.source.width, bar.source.height]).toEqual([255, 1970, 17])
    expect(pixelOf(bar, 1966, 8)).toEqual(ORANGE)
    expect([1967, 1968, 1969].map(x => sameRgb(pixelOf(bar, x, 8), ORANGE))).toEqual([false, false, false])
    expect(pixelOf(bar, 1968, 8)).toEqual(TRACK)
    await ui.unmount()
  },
)

for (const style of ['pill', 'squares']) {
  test(
    `inside Dumb Memory, drawn as ${style}, the words stand whole within the band or not at all, shortened to Dumb M… on a bar narrower than they are, at every width from the narrowest to the widest bar`,
    { options: { ...SHOWN, bar_style: style } },
    async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      sessionOf(on, INSIDE)
      const wrong: string[] = []
      // What the words read at each width of the context bar, in cells.
      const read: Record<number, string> = {}
      for (const columns of [...Array.from({ length: 16 }, (_, k) => 25 + k), 295]) {
        const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns } })
        await clock.advance(1000)
        const top = (await ui.find({ key: 'top' })) as unknown as Laid | undefined
        const words = (await ui.find({ key: 'dumb-memory' })) as unknown as Laid | undefined
        // The bar's cells: the picture's, or the glyphs between the dots either side of it.
        const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
        const runs = () => row.children.slice(2, row.children.findIndex((kid, k) => k > 1 && textIn(kid) === '·'))
        const cells = style === 'pill' ? ((await imageOf(ui, 'bar-1m'))?.columns ?? 0) : runs().map(textIn).join('').length
        // Under 11 cells, the eleven letters' own length, they are seven: "Dumb M" and an ellipsis.
        const want = cells < 11 ? 'Dumb M…' : 'Dumb Memory'
        // Where they are drawn they are whole, and the band, the top row with them, ends within its width.
        const band = cellsAcross((await ui.drawn()) as Laid)
        // Left out is allowed where there is no room; at the widest bar there is.
        if (!words || !top) {
          if (columns === 295) wrong.push(`${columns}: not drawn`)
        } else {
          const text = textIn(words as unknown as Tree)
          read[cells] = text
          if (text !== want || cellsAcross(words) !== want.length || band > columns)
            wrong.push(`${columns}: a bar of ${cells}, "${text}" in ${cellsAcross(words)} cells, the band ${band}`)
        }
        await ui.unmount()
      }
      expect(wrong).toEqual([])
      expect([read[4], read[10], read[11], read[255]]).toEqual(['Dumb M…', 'Dumb M…', 'Dumb Memory', 'Dumb Memory'])
    },
  )
}

test('on the narrowest bar a press on the shortened words opens the Dumb Memory pane all the same', { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on, INSIDE)
  const opened: unknown[] = []
  on('ui.open', ($, e) => {
    opened.push([e.id, e.title, e.focus, e.closeOnEscape])
    return { value: { isPlaced: true } }
  })
  const ui = await $.ui.mount(NARROWEST)
  await clock.advance(1000)
  const words = (await ui.find({ key: 'dumb-memory' })) as unknown as Tree
  expect(textIn(words)).toBe('Dumb M…')
  await ui.press({ key: 'dumb-memory' })
  expect(opened).toEqual([['clawd-context', 'Dumb Memory', true, true]])
  await ui.unmount()
})

test(
  'at the narrowest bar, 4 cells, a session that loaded every kind of memory shows no little bar: one plain fill from the bar\'s start',
  { options: SHOWN },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(NARROWEST)
    await clock.advance(1000)
    // 51 pixels by 28, at mid height. Under 5 cells there are no little bars: the fill is 32% of
    // 51, 16.3, shorter than it is high, so a circle 16 across from the bar's inside at 6, to 22.
    // Dumb Memory's outline starts at 0.41266 of 51, 21.0, and lies over it to 23; the fill's
    // clear ring ends at 24.
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect([10, 15, 20, 22].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE, ORANGE, BLACK])
    expect(pixelOf(bar, 25, 14)).toEqual(TRACK)
    // Auto-compaction's mark at 0.667 of 51, 34.0: 30 to 38, a clear ring to 40. No fill after it.
    expect([31, 37].map(x => pixelOf(bar, x, 14))).toEqual([LIGHT, LIGHT])
    expect([29, 39].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0])
    expect([41, 43].map(x => pixelOf(bar, x, 14))).toEqual([TRACK, TRACK])
    // No kind's colour anywhere along it.
    const row = Array.from({ length: 51 }, (_, x) => pixelOf(bar, x, 14))
    expect(row.filter(colour => sameRgb(colour, GREY) || sameRgb(colour, AMBER))).toEqual([])
    await ui.unmount()
  },
)

test(
  'at 5 cells a session that loaded every kind of memory shows one little bar for all of it, in the first kind\'s colour',
  { options: LITTLE }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    // A column more than the narrowest band: the bar is 5 cells.
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 26 } })
    await clock.advance(1000)
    // Six kinds want six little bars, more than a third of 5 cells: one stands for them all,
    // from 10 to 24 whatever the width, in the first kind's grey.
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect(bar.columns).toBe(5)
    expect(pixelOf(bar, 17, 14)).toEqual(GREY)
    await ui.unmount()
  },
)

test(
  'at the narrowest bar in squares a session that loaded every kind of memory shows no little bar: one plain fill from the bar\'s start',
  { options: { bar_style: 'squares' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(NARROWEST)
    await clock.advance(1000)
    // 4 cells of two steps each: 32% of 8 steps is 2.56, rounded to 3, a whole cell and a
    // half one from the start; the other two empty. No cell in a kind's colour.
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    expect(row.children.slice(2, 4).map(cell => [textIn(cell), cell.props.color])).toEqual([
      ['■▣', 'claude'],
      ['□□', 'inactive'],
    ])
    expect(textIn(row.children[4]!)).toBe('·')
    await ui.unmount()
  },
)

// Longer than any test runs: a reading that waits this long never answers.
const NEVER = 600_000

// A session whose breakdowns answer when the test says: the nth ask waits the
// nth of `waits` on the test's clock, none past the list, and answers the nth
// of `breakdowns`, BREAKDOWN past it. Its id and what it measures may change;
// `asked` is the id each breakdown was asked under.
const heldSessionOf = (on: On, clock: ReturnType<typeof mock.clock>, waits: number[], breakdowns: SessionContextBreakdown[] = []) => {
  const session = { id: 'one', context: CONTEXT as { window: number; tokens?: number; percent?: number }, asked: [] as string[] }
  on('session.id', () => ({ value: session.id }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.usage', async ($, e) => {
    if (!e.breakdown) return usageOf([], session.context)
    const n = session.asked.push(session.id) - 1
    const context = { ...session.context, breakdown: breakdowns[n] ?? BREAKDOWN }
    if (waits[n]) await clock.sleep(waits[n])
    return usageOf([], context)
  })
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  return session
}

// The context row as drawn in a style of cells, and the colours of the six
// cells after its label and dot: the little bars' own while a reading is kept.
const rowOf = async (ui: { find: (query: { key: string }) => Promise<unknown> }) => (await ui.find({ key: 'row-1m' })) as unknown as Tree
const kindsOf = async (ui: { find: (query: { key: string }) => Promise<unknown> }) =>
  (await rowOf(ui)).children.slice(2, 8).map(cell => (cell as Tree | undefined)?.props?.color)

test(
  'a breakdown that never answers lets the band draw, is given up ten seconds after it was asked, and the next pass asks a new one',
  { options: { ...LITTLE, bar_style: 'squares' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const session = heldSessionOf(on, clock, [NEVER])
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    // The row and its figures, without the little bars.
    expect(textIn(await rowOf(ui))).toContain('32%')
    expect(await kindsOf(ui)).not.toEqual(KINDS)
    await clock.advance(8000)
    expect(session.asked.length).toBe(1)
    await clock.advance(4000)
    expect(session.asked.length).toBe(2)
    expect(await kindsOf(ui)).toEqual(KINDS)
    await ui.unmount()
  },
)

test('a breakdown that answers after it was given up is dropped: not kept, not drawn', { options: { ...LITTLE, bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first answers fifteen seconds on, the one asked after it never.
  const session = heldSessionOf(on, clock, [15_000, NEVER])
  const ui = await $.ui.mount(PILLS)
  await clock.advance(16_000)
  expect(session.asked.length).toBe(2)
  expect(await kindsOf(ui)).not.toEqual(KINDS)
  await ui.unmount()
})

test("a new session id clears the kept breakdown at once and asks its own; an empty id, a lookup that failed, is no new session", { options: { ...LITTLE, bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first answers at once, the second never.
  const session = heldSessionOf(on, clock, [0, NEVER])
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  expect(await kindsOf(ui)).toEqual(KINDS)
  session.id = ''
  await clock.advance(3000)
  expect(session.asked).toEqual(['one'])
  expect(await kindsOf(ui)).toEqual(KINDS)
  // A frame every 400ms: the first pass of the next second is at most that late.
  session.id = 'two'
  await clock.advance(2000)
  expect(session.asked).toEqual(['one', 'two'])
  expect(await kindsOf(ui)).not.toEqual(KINDS)
  await ui.unmount()
})

test("a breakdown asked for one session that answers once the id is another's is dropped, and the new session is asked its own", { options: { ...LITTLE, bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first answers 2.5s on, the second 2s on.
  const session = heldSessionOf(on, clock, [2500, 2000])
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1500)
  session.id = 'two'
  // A frame every 400ms: the pass of second 2 is at 2000, of second 3 at 3200.
  // At 2600 the first has answered, and no pass has followed.
  await clock.advance(1100)
  expect(session.asked).toEqual(['one'])
  expect(await kindsOf(ui)).not.toEqual(KINDS)
  await clock.advance(4000)
  expect(session.asked).toEqual(['one', 'two'])
  expect(await kindsOf(ui)).toEqual(KINDS)
  await ui.unmount()
})

// A compaction of the conversation, as /compact starts one, and what it gives.
// A compaction leaves at least one message.
const COMPACTION = { trigger: 'manual' as const, instructions: 'the plan', messages: [{ role: 'user' as const, text: 'hello', toolUses: [] }] }
const COMPACTED = { messages: [{ role: 'user' as const, text: 'a summary', toolUses: [] }], tokensBefore: 320_807, tokensAfter: 20_000 }

test(
  'a compaction clears the kept breakdown as it starts, asks none while it runs and a new one once it is done, and passes on what it is given and gives',
  { options: { ...LITTLE, bar_style: 'squares' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const session = heldSessionOf(on, clock, [])
    const received: unknown[] = []
    // The engine's compaction, done 65 seconds on.
    on('session.compact', async ($, e) => {
      received.push(e)
      await clock.sleep(65_000)
      return COMPACTED
    })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect(await kindsOf(ui)).toEqual(KINDS)
    const compacted = $.session.compact(COMPACTION)
    await clock.settle()
    expect(await kindsOf(ui)).not.toEqual(KINDS)
    // Past the minute at which a session at rest is asked again.
    await clock.advance(64_000)
    expect(session.asked).toEqual(['one'])
    await clock.advance(3000)
    expect(await compacted).toEqual(COMPACTED)
    expect(received).toEqual([COMPACTION])
    expect(session.asked).toEqual(['one', 'one'])
    expect(await kindsOf(ui)).toEqual(KINDS)
    await ui.unmount()
  },
)

test('a compaction worked out ahead of time installs nothing: it clears nothing and asks nothing', { options: { ...LITTLE, bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [])
  const AHEAD = { messages: COMPACTED.messages }
  on('session.compact', async () => {
    await clock.sleep(5000)
    return AHEAD
  })
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const compacted = $.session.compact({ ...COMPACTION, trigger: 'precompute' as const })
  await clock.settle()
  expect(await kindsOf(ui)).toEqual(KINDS)
  await clock.advance(7000)
  expect(await compacted).toEqual(AHEAD)
  expect(session.asked).toEqual(['one'])
  expect(await kindsOf(ui)).toEqual(KINDS)
  await ui.unmount()
})

// The engine's spinner, saying a compaction runs or not. Its message is all a
// mod hears of a compaction where a module above sends session.compact on past it.
const spinnerSaying = (message: string | null) =>
  ({
    plugin: 'clawd-band',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Working', message, suffix: '', mode: 'requesting' },
  }) as const
const tellSpinner = async ($: Engine, message: string | null) => (await $.ui.mount(spinnerSaying(message))).unmount()
// The band while the engine counts work under way, as it does through a compaction.
const WORKING_PILLS = { ...PILLS, props: { ...PILLS.props, isWorking: true } }

test(
  'a compaction the spinner tells of asks for the breakdown again once its message ends, and keeps the little bars drawn till then',
  { options: { ...LITTLE, bar_style: 'squares' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const session = heldSessionOf(on, clock, [])
    const ui = await $.ui.mount(WORKING_PILLS)
    await clock.advance(1000)
    expect(session.asked).toEqual(['one'])
    await tellSpinner($, 'Compacting conversation')
    await clock.advance(3000)
    expect(session.asked).toEqual(['one'])
    expect(await kindsOf(ui)).toEqual(KINDS)
    await tellSpinner($, null)
    await clock.advance(1400)
    expect(session.asked).toEqual(['one', 'one'])
    await clock.advance(10_000)
    expect(session.asked).toEqual(['one', 'one'])
    await ui.unmount()
  },
)

test(
  "a compaction whose end the spinner never tells asks for the breakdown again once no turn runs, and the spinner's next message asks nothing more",
  { options: LITTLE },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const session = heldSessionOf(on, clock, [])
    // No turn running: the pose leaves compacting by the once-a-second rule.
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect(session.asked).toEqual(['one'])
    await tellSpinner($, 'Compacting conversation')
    await clock.advance(2000)
    expect(session.asked).toEqual(['one', 'one'])
    // The spinner of a later turn, saying nothing of a compaction: that one was over.
    await tellSpinner($, null)
    await clock.advance(10_000)
    expect(session.asked).toEqual(['one', 'one'])
    await ui.unmount()
  },
)

test('a compaction both session.compact and the spinner tell of asks for the breakdown once, not twice', { options: LITTLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [])
  on('session.compact', async () => {
    await clock.sleep(5000)
    return COMPACTED
  })
  const ui = await $.ui.mount(WORKING_PILLS)
  await clock.advance(1000)
  const compacted = $.session.compact(COMPACTION)
  await tellSpinner($, 'Compacting conversation')
  // The compaction is done, and asked for, while the spinner still says it runs.
  await clock.advance(6000)
  expect(await compacted).toEqual(COMPACTED)
  expect(session.asked).toEqual(['one', 'one'])
  await tellSpinner($, null)
  await clock.advance(10_000)
  expect(session.asked).toEqual(['one', 'one'])
  await ui.unmount()
})

test('with the options as they come a compaction the spinner tells of asks for no breakdown', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [])
  const ui = await $.ui.mount(WORKING_PILLS)
  await clock.advance(1000)
  await tellSpinner($, 'Compacting conversation')
  await clock.advance(3000)
  await tellSpinner($, null)
  await clock.advance(26_000)
  expect(session.asked).toEqual([])
  await ui.unmount()
})

test("a session whose window changes, a change of model, is asked for its breakdown again, once", { options: LITTLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [])
  const ui = await $.ui.mount(PILLS)
  await clock.advance(3000)
  expect(session.asked.length).toBe(1)
  session.context = { window: 200_000, tokens: 20_000, percent: 10 }
  await clock.advance(2000)
  expect(session.asked.length).toBe(2)
  await clock.advance(10_000)
  expect(session.asked.length).toBe(2)
  await ui.unmount()
})

// BREAKDOWN as a session that loaded `loaded` tokens before its conversation
// reads it: its memory files make up the difference from 21100.
const loading = (loaded: number) =>
  ({
    ...BREAKDOWN,
    categories: BREAKDOWN.categories.map(row => (row.name === 'Memory files' ? { ...row, tokens: row.tokens + loaded - 21_100 } : row)),
  }) as SessionContextBreakdown

// Where the band's hidden line and the pane say Dumb Memory starts, and the
// pane's row of memory files, which follows the latest reading.
const zoneSaid = async ($: Engine, band: { find: (query: { key: string }) => Promise<unknown> }) => {
  const line = (await band.find({ key: 'detail-zone' })) as Tree | undefined
  const pane = await $.ui.mount(ZONE_PANE)
  const said = (await pane.find({ type: 'Text', text: /^Dumb Memory starts at / })) as unknown as Tree | undefined
  const memory = (await pane.find({ type: 'Text', text: /^ Memory files / })) as unknown as Tree | undefined
  await pane.unmount()
  return [line && textIn(line).split(' · ')[0], said && textIn(said), memory && textIn(memory).replace(/ +/g, ' ')]
}

test(
  "Dumb Memory's start is pinned by the session's first reading: what loads later moves the little bars, not the zone",
  { options: SHOWN },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const session = heldSessionOf(on, clock, [], [loading(100_000), loading(150_000)])
    const band = await $.ui.mount(PILLS)
    await clock.advance(1000)
    // 100k loaded and 40% of the 900k left make 460k.
    expect(await zoneSaid($, band)).toEqual([
      'Dumb Memory from 460k',
      'Dumb Memory starts at 460k (loaded 100k + 40% of the room left):',
      ' Memory files 82.2k 8.2%',
    ])
    // Asked again a minute on: 150k loaded now, which would start it at 490k.
    await clock.advance(61_000)
    expect(session.asked).toEqual(['one', 'one'])
    expect(await zoneSaid($, band)).toEqual([
      'Dumb Memory from 460k',
      'Dumb Memory starts at 460k (loaded 100k + 40% of the room left):',
      ' Memory files 132.2k 13.2%',
    ])
    await band.unmount()
  },
)

test('a reading dropped because the session moved on, or given up, pins nothing: the next one kept pins', { options: SHOWN }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first, of 100k loaded, answers 2.5s on, once the id is another's; the
  // second, of 120k, never; the third, of 150k, at once.
  const session = heldSessionOf(on, clock, [2500, NEVER], [loading(100_000), loading(120_000), loading(150_000)])
  const band = await $.ui.mount(PILLS)
  await clock.advance(1500)
  session.id = 'two'
  // The first answers at 2600 and is dropped; the second is asked at 3200 and given up at
  // 13200; the third is asked on the pass of the next second.
  await clock.advance(13_500)
  expect(session.asked).toEqual(['one', 'two', 'two'])
  // 150k loaded and 40% of the 850k left make 490k.
  expect(await zoneSaid($, band)).toEqual([
    'Dumb Memory from 490k',
    'Dumb Memory starts at 490k (loaded 150k + 40% of the room left):',
    ' Memory files 132.2k 13.2%',
  ])
  await band.unmount()
})

// The mod's pin in $.state: what a module loaded before left there, and each write.
const pinStoreOf = (on: On, left: { session: string; tokens: number }) => {
  const store = { value: left, version: 1, written: [] as unknown[] }
  on('state.get', { key: 'loaded' }, () => ({ value: { value: store.value, version: store.version } }))
  on('state.set', { key: 'loaded' }, ($, e) => {
    store.value = e.value as typeof left
    store.version += 1
    store.written.push(e.value)
    return { value: { isSet: true as const, version: store.version } }
  })
  return store
}

for (const { left, said, written } of [
  // 100k loaded and 40% of the 900k left make 460k.
  { left: 'one', said: '460k (loaded 100k', written: [] },
  // 150k loaded and 40% of the 850k left make 490k.
  { left: 'zero', said: '490k (loaded 150k', written: [{ session: 'one', tokens: 150_000 }] },
]) {
  test(`a module loaded again mid-session takes up the pin a module before it left for session ${left}, only if that is its session`, { options: LITTLE }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const store = pinStoreOf(on, { session: left, tokens: 100_000 })
    heldSessionOf(on, clock, [], [loading(150_000)])
    const band = await $.ui.mount(PILLS)
    await clock.advance(1000)
    expect((await zoneSaid($, band))[1]).toBe(`Dumb Memory starts at ${said} + 40% of the room left):`)
    // The pin is the session's id and one number, written once a session.
    expect(store.written).toEqual(written)
    await band.unmount()
  })
}

test('a compaction leaves the pin: what was loaded before the conversation is not what it changes', { options: LITTLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [], [loading(100_000), loading(150_000)])
  on('session.compact', async () => {
    await clock.sleep(5000)
    return COMPACTED
  })
  const band = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const compacted = $.session.compact(COMPACTION)
  await clock.advance(7000)
  await compacted
  expect(session.asked).toEqual(['one', 'one'])
  // 100k loaded and 40% of the 900k left make 460k, as before it.
  expect((await zoneSaid($, band))[1]).toBe('Dumb Memory starts at 460k (loaded 100k + 40% of the room left):')
  await band.unmount()
})

test('a new session id, a /clear, pins anew', { options: LITTLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [], [loading(100_000), loading(200_000)])
  const band = await $.ui.mount(PILLS)
  await clock.advance(1000)
  session.id = 'two'
  await clock.advance(2000)
  expect(session.asked).toEqual(['one', 'two'])
  // 200k loaded and 40% of the 800k left make 520k.
  expect((await zoneSaid($, band))[1]).toBe('Dumb Memory starts at 520k (loaded 200k + 40% of the room left):')
  await band.unmount()
})

test('a breakdown with no row named Messages pins all it has in use, and the debug log says so once a session, in fixed words', { options: LITTLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const unnamed = {
    ...BREAKDOWN,
    categories: BREAKDOWN.categories.map(row => (row.name === 'Messages' ? { ...row, name: 'Conversation' } : row)),
  } as SessionContextBreakdown
  const session = heldSessionOf(on, clock, [], [unnamed, unnamed])
  const logged: unknown[] = []
  on('ui.log', ($, e) => {
    // The account's own line aside: a test has no account.
    if (!e.text.startsWith('clawd-band: account usage')) logged.push([e.text, e.to])
    return { value: undefined }
  })
  const band = await $.ui.mount(PILLS)
  await clock.advance(1000)
  // Asked again a minute on, with no row named Messages still.
  await clock.advance(61_000)
  expect(session.asked).toEqual(['one', 'one'])
  // 320807 in use and 40% of the 679193 left make 592484.
  expect((await zoneSaid($, band))[1]).toBe('Dumb Memory starts at 592.5k (loaded 320.8k + 40% of the room left):')
  expect(logged).toEqual([['clawd-band: the context breakdown has no row named Messages: Dumb Memory counts all of it in use as loaded', 'debug']])
  await band.unmount()
})

test("a subagent's own compaction changes nothing of the conversation's context: it clears nothing and asks nothing", { options: { ...LITTLE, bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [])
  const received: unknown[] = []
  on('session.compact', async ($, e) => {
    received.push(e)
    await clock.sleep(5000)
    return COMPACTED
  })
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const subagents = { ...COMPACTION, agentId: 'agent-1' }
  const compacted = $.session.compact(subagents)
  await clock.settle()
  expect(await kindsOf(ui)).toEqual(KINDS)
  await clock.advance(7000)
  expect(await compacted).toEqual(COMPACTED)
  expect(received).toEqual([subagents])
  expect(session.asked).toEqual(['one'])
  expect(await kindsOf(ui)).toEqual(KINDS)
  await ui.unmount()
})
