import type { On, SessionContextBreakdown } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { barRuns, rowsOf } from './band'
import { BAND, core, imageOf, NOW, pixelOf, usageOf } from './kit'
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
  const rowAt = (tokens: number, options: Parameters<typeof settings>[0] = {}) => {
    const context = { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }
    return rowsOf({ usage: null, context, cacheAt: null, now: NOW, loaded: 21_100, compactAt: 667_000 }, settings(options)).at(-1)
  }
  const short = rowAt(320_807)
  expect([short?.detail, short?.zoneDetail]).toEqual(['320.8k of 1M · Dumb Memory from 412.7k · auto-compact at 667k', undefined])
  // 450000 is 37340 past the start at 412660.
  const inside = rowAt(450_000)
  expect([inside?.detail, inside?.zoneDetail]).toEqual([
    '450k of 1M · auto-compact at 667k',
    // What stands either side of its name on the band.
    { before: '37.3k inside', after: '/compact or /new' },
  ])
  expect(rowAt(320_807, { show_dumb_memory: false, show_autocompact: false })?.detail).toBe('320.8k of 1M')
  // A window no reply has measured holds nothing to say.
  expect(rowsOf({ usage: null, context: { window: 200_000 }, cacheAt: null, now: NOW }, settings({})).at(-1)?.detail).toBe(undefined)
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
  'the context bar shows no fill while the session is short of Dumb Memory',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // 32% of the 371 pixels is 119: a fill would lie over the pixel 100 along.
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect(pixelOf(bar, 100, 14)).toEqual(TRACK)
    // The percentage beside the bar still says how full the window is.
    expect(bar.alt).toBe('1m 32%')
    await ui.unmount()
  },
)

test(
  'once the session is in Dumb Memory the fill shows, red like the outline, striped with black within it, the rest of its inside faintly red',
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
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // Six kinds, none a hundredth of the window: each is drawn 8 pixels long, the least a
    // pill is, 4 clear pixels between two. They start where a fill would, 6 pixels in: 6 to
    // 14, 18 to 26 and so on to 74, in /context's order and colours.
    const middles = [10, 22, 34, 46, 58, 70].map(x => pixelOf(bar, x, 14))
    expect(middles).toEqual([
      [136, 136, 136, 255],
      [153, 153, 153, 255],
      [22, 163, 74, 255],
      [177, 185, 249, 255],
      [215, 119, 87, 255],
      [255, 193, 7, 255],
    ])
    expect([16, 28, 40, 52, 64].map(x => pixelOf(bar, x, 14)[3])).toEqual([0, 0, 0, 0, 0])
    // After the last, the bar's empty part: the conversation shows only in Dumb Memory.
    expect(pixelOf(bar, 80, 14)).toEqual(TRACK)
    await ui.unmount()
  },
)

test(
  "in Dumb Memory the conversation's fill starts after the little pills, a clear gap between",
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, { window: 1_000_000, tokens: 450_000, percent: 45 })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // The last little pill ends at 74; the fill runs from 78 to where it always ended.
    expect(pixelOf(bar, 70, 14)).toEqual([255, 193, 7, 255])
    expect(pixelOf(bar, 76, 14)[3]).toBe(0)
    expect(pixelOf(bar, 82, 14)).toEqual([255, 107, 128, 255])
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

// What a full cell is in each style of bar drawn in text; the first cell of `blocks` is its round end.
const FULL = { blocks: ['\ue0b6', '█'], dots: ['⣿', '⣿'], squares: ['■', '■'], line: ['━', '━'] } as const
const KINDS = ['promptBorder', 'inactive', 'green_FOR_SUBAGENTS_ONLY', 'permission', 'claude', 'warning']


for (const [style, [first, full]] of Object.entries(FULL)) {
  test(`bars drawn as ${style} show each kind of memory as one cell in its colour`, { options: { bar_style: style } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    // The row is its label, a dot, the bar's runs, a dot and the figures.
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    const cells = row.children.slice(2, 8)
    expect(cells.map(cell => cell.props.color)).toEqual(KINDS)
    expect(cells.map(textIn)).toEqual([first, full, full, full, full, full])
    // Short of Dumb Memory nothing follows them but the empty part.
    expect(row.children[8]?.props.color).toBe('inactive')
    await ui.unmount()
  })
}

test('a bar too short for a cell each shows what was loaded as one cell, in the first kind\'s colour', { options: { bar_style: 'squares' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  // 52 columns leave the bar 12 cells: six little bars would be half of it.
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 52 } })
  await clock.advance(1000)
  const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
  expect(row.children.slice(2, 4).map(cell => [textIn(cell), cell.props.color])).toEqual([
    ['■', 'promptBorder'],
    ['□□□□□□□□□□□', 'inactive'],
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
  { options: { bar_style: 'circles' } },
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
    expect([textIn(first.children[2]!), first.children[2]?.props.color, textIn(first.children[4]!), first.children[4]?.props.color]).toEqual([
      WHOLE,
      'promptBorder',
      OPEN,
      'inactive',
    ])
    await ui.unmount()
  },
)

// A session past Dumb Memory's start at 412660.
const INSIDE = { window: 1_000_000, tokens: 450_000, percent: 45 }

test('the words Dumb Memory stand in the top row over where the zone starts once the session is in it: a button, in the warning colour', async ($, on) => {
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

test('short of Dumb Memory the top row holds no words, only the outline tells of it', async ($, on) => {
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

test("a row's line of detail is drawn hidden over the top row, in one hover group with its row", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
  // Placed over the top row, so that showing it moves nothing, a cell in from the band's edge.
  expect([line?.props.display, line?.props.position, line?.props.top, line?.props.left]).toEqual(['none', 'absolute', 0, 1])
  expect(await hoverAt(ui, 'detail-1m')).toEqual({ scope: 'clawd-band-1m', display: 'flex' })
  // As wide as the band's 71 columns leave, so that it covers what the top row holds.
  expect(line && textIn(line)).toBe('320.8k of 1M · Dumb Memory from 412.7k · auto-compact at 667k'.padEnd(69))
  expect(await hoverAt(ui, 'row-1m')).toEqual({ scope: 'clawd-band-1m' })
  // The session of this test is told nothing of its usage: those rows have no line.
  expect(await ui.find({ key: 'detail-7d' })).toBe(undefined)
  await ui.unmount()
})

test("Dumb Memory's own detail stands hidden either side of its name, which stays free for a press", async ($, on) => {
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
  const spacer = await ui.find({ key: 'dumb-memory-before' })
  expect([spacer?.props.width, spacer?.props.justifyContent]).toEqual([33, 'flex-end'])
  await ui.unmount()
})

test('a press on the words opens the Dumb Memory pane and hands it the keyboard', async ($, on) => {
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

test("the pane ends on a button that opens /usage, where the recommendations are, and fits its rows to a narrow pane", async ($, on) => {
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
