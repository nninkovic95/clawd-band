import type { On, SessionContextBreakdown } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { rowsOf } from '../hooks/rows'
import { pill } from '../hooks/pill'
import { BAND as KIT_BAND, core, imageOf, NOW, pixelOf, replied, REPLIED_AT, usageOf } from './kit'
import type { Drawn } from './kit'
import { settings } from '../hooks/settings'

// The kit's band, two columns narrower: a row's label, two dots and figure take 2 + 2 + 3 cells,
// not the 3 + 2 + 4 of a padded label beside blank cells, so its bars keep the width these tests count in.
const BAND = { ...KIT_BAND, props: { ...KIT_BAND.props, bodyColumns: KIT_BAND.props.bodyColumns - 2 } }

// A session at 320k of a 1M window, as /context broke one down: 21100 loaded
// before the conversation, compacting itself at 667k of a 700k compaction window.
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

// A session the engine answers for; counts the readings and the breakdowns the mod asks of it.
const sessionOf = (on: On, context: { window: number; tokens?: number; percent?: number } = CONTEXT, breakdown = BREAKDOWN) => {
  const asked = { breakdowns: 0, readings: 0 }
  replied(on)
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.usage', ($, e) => {
    if (!e.breakdown) {
      asked.readings += 1
      return usageOf([], context)
    }
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

test("the context row's line of detail says what the window holds", () => {
  const rowAt = (tokens: number) => {
    const context = { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }
    return rowsOf({ usage: null, context, cacheAt: REPLIED_AT, now: NOW }, settings({})).at(-1)
  }
  expect(rowAt(320_807)?.detail).toBe('320.8k of 1M')
  expect(rowAt(450_000)?.detail).toBe('450k of 1M')
  // A window the engine gives no figure for holds nothing to say.
  expect(rowsOf({ usage: null, context: { window: 200_000 }, cacheAt: REPLIED_AT, now: NOW }, settings({})).at(-1)?.detail).toBe(undefined)
})

// The context row of the session of CONTEXT, its bar in a style.
const contextRowIn = (bar_style: 'pill' | 'blocks') =>
  rowsOf({ usage: null, context: CONTEXT, cacheAt: REPLIED_AT, now: NOW }, settings({ bar_style })).at(-1)

test("in a picture's style and in text the context row's line of detail says what the window holds, and nothing more", () => {
  for (const style of ['pill', 'blocks'] as const) {
    const row = contextRowIn(style)
    expect(row?.detail).toBe('320.8k of 1M')
    expect(Object.keys(row ?? {}).filter(key => key.startsWith('mark'))).toEqual([])
  }
})

test(
  'where the session compacts itself the context bar is its empty part, and nothing is drawn there for the pointer',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // 667000 of the million is 371 * 0.667 = 247.457 of the 371 pixels, a line 2 thick. 2 lines
    // either side, 243.457 to 251.457, and a line more, 241.457 to 253.457: every whole pixel
    // there is the bar's empty part, at mid height and a line in from the bar's top.
    expect([242, 244, 247, 250, 252].map(x => pixelOf(bar, x, 14))).toEqual([TRACK, TRACK, TRACK, TRACK, TRACK])
    expect(pixelOf(bar, 247, 5)).toEqual(TRACK)
    // The row holds its bar and nothing keyed beside it; the one line of detail is the row's.
    expect((await keysIn(ui, 'row-1m')).filter(key => key !== undefined)).toEqual(['bar-1m'])
    expect(keysUnder(await ui.drawn()).filter(key => key.startsWith('detail'))).toEqual(['detail-1m'])
    await ui.unmount()
  },
)

// A band of 71 columns: beside Clawd's 16 its context bar is 31 cells. At a cell 2.34 times as
// tall as wide that is a picture 371 pixels by 28, every line of it 2 thick.
const PILLS = { ...BAND, props: { ...BAND.props, bodyColumns: 69 } }
const TRACK = [153, 153, 153, 102]
// The row's own colour, bar_color_context's default: Claude's orange.
const ORANGE = [215, 119, 87, 255]

test(
  'the context bar of a session that loaded every kind of memory is one fill from its start',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // The fill runs from the bar's start to 118.7.
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    expect(pixelOf(bar, 125, 14)).toEqual(TRACK)
    await ui.unmount()
  },
)

test(
  "with the options as they come the context bar of a session that loaded every kind of memory is the picture of a plain bar, one fill in the row's own colour",
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // 31 cells at the usual 2.2, 32% used, one segment, none warned: the context's orange on the
    // faint grey, the warning the theme's error red.
    const plain = pill({ columns: 31, ratio: 2.2, percent: 32, segments: 1, warned: 0, fill: [215, 119, 87, 255], track: [153, 153, 153, 102], warn: [255, 107, 128, 255] })
    expect([bar.columns, bar.source.width, bar.source.height]).toEqual([31, plain.width, plain.height])
    expect(bar.source.rgba === plain.rgba).toBe(true)
    await ui.unmount()
  },
)

test(
  "in blocks the context bar of a session that loaded every kind of memory is one fill in the row's own colour, then its empty part",
  { options: { bar_style: 'blocks' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    // The bar is the row's children between the dot after its label and the dot before its figure.
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    const cells = row.children.slice(2, row.children.map(textIn).indexOf('·', 2))
    expect([...new Set(cells.map(cell => cell.props.color))]).toEqual(['claude', 'inactive'])
    await ui.unmount()
  },
)

test(
  'a context row with no reading draws no fill',
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

test('a bar in text is one fill from its start', { options: { bar_style: 'dots' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
  // 31 cells of three steps each: 32% of 93 steps is 29.76, rounded to 30, ten whole cells.
  expect(row.children.slice(2, 4).map(cell => [textIn(cell), cell.props.color])).toEqual([
    ['⣿'.repeat(10), 'claude'],
    ['⣀'.repeat(21), 'inactive'],
  ])
  await ui.unmount()
})

// A session at 450k of a 1M window.
const INSIDE = { window: 1_000_000, tokens: 450_000, percent: 45 }

// Every key in the tree as drawn, depth first.
const keysUnder = (node: unknown): string[] => {
  if (typeof node !== 'object' || node === null) return []
  const at = node as DrawnNode
  const key = at.key ?? at.props?.key
  return [...(typeof key === 'string' ? [key] : []), ...(at.children ?? []).flatMap(keysUnder)]
}

test(
  'a session at 450k of 1M fills the context bar in its own colour from its start, under a top row of the probe alone',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, INSIDE)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // The fill starts at the bar's start and ends where 45% of the 371 pixels does, 166.95, less
    // the inset of 6: 160.95. At mid height it is the row's own orange throughout.
    expect([14, 100, 150, 157].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE, ORANGE, ORANGE])
    // Its clear ring, then the bar's empty part as ever, along to the bar's end.
    expect(pixelOf(bar, 161, 14)[3]).toBe(0)
    expect([pixelOf(bar, 164, 14), pixelOf(bar, 300, 14), pixelOf(bar, 300, 5), pixelOf(bar, 365, 14)]).toEqual([TRACK, TRACK, TRACK, TRACK])
    // The top row is the probe alone, and nothing drawn is keyed for a zone or its words.
    expect((await keysIn(ui, 'band'))[0]).toBe('probe')
    expect(await ui.find({ key: 'top' })).toBe(undefined)
    const keys = keysUnder(await ui.drawn())
    expect(keys).toContain('bar-1m')
    expect(keys.filter(key => key.startsWith('zone') || key.startsWith('dumb-memory'))).toEqual([])
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
  expect(line && textIn(line)).toBe('320.8k of 1M'.padEnd(67))
  expect(await hoverAt(ui, 'row-1m')).toEqual({ scope: 'clawd-band-1m' })
  // The session of this test is told nothing of its usage: those rows have no line.
  expect(await ui.find({ key: 'detail-7d' })).toBe(undefined)
  await ui.unmount()
})

test(
  "in blocks a bar's cells carry no hover of their own: the pointer anywhere on the row brings up the row's line of detail",
  { options: { bar_style: 'blocks' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(1000)
    // The bar is drawn in text, all 31 of its cells.
    expect(textBarCells((await ui.find({ key: 'row-1m' })) as unknown as Tree)).toBe(31)
    const row = keyed(await ui.drawn(), 'row-1m')
    const hoverOf = (node: unknown) => (node as DrawnNode).hover ?? (node as DrawnNode).props?.hover
    expect(hoverOf(row)).toEqual({ scope: 'clawd-band-1m' })
    // Nothing in the row, a cell of the bar least of all, is a place of its own for the pointer.
    expect((row?.children ?? []).filter(child => typeof child === 'object' && hoverOf(child) !== undefined)).toEqual([])
    expect(await hoverAt(ui, 'detail-1m')).toEqual({ scope: 'clawd-band-1m', display: 'flex' })
    await ui.unmount()
  },
)

test(
  "in the pill style with no picture drawn, the bar in text, the row's line of detail says what the window holds",
  { options: { bar_style: 'pill' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    replied(on)
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
    const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
    expect(line && textIn(line)).toBe('320.8k of 1M'.padEnd(67))
    await ui.unmount()
  },
)

// The keys of what the element keyed `key` holds, in the order it is drawn.
const keysIn = async (ui: { drawn: () => Promise<unknown> }, key: string): Promise<unknown[]> =>
  (keyed(await ui.drawn(), key)?.children ?? []).map(child => (child as DrawnNode).key ?? (child as DrawnNode).props?.key)

test('a session whose window a reply has measured is asked for no breakdown', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  const ui = await $.ui.mount(BAND)
  await clock.advance(10_000)
  expect(asked.breakdowns).toBe(0)
  await ui.unmount()
})

test(
  'with the options as they come a session a reply has measured is never asked for its breakdown, and the context bar is the plain one',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const asked = sessionOf(on)
    const ui = await $.ui.mount(PILLS)
    await clock.advance(61_000)
    expect(asked.breakdowns).toBe(0)
    const bar = (await imageOf(ui, 'bar-1m'))!
    // One fill from the bar's start to 32% of 371 pixels, 118.7, in its own colour.
    expect([14, 100].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE])
    expect(pixelOf(bar, 125, 14)).toEqual(TRACK)
    // Along to the bar's end, its empty part.
    expect([pixelOf(bar, 300, 5), pixelOf(bar, 365, 14)]).toEqual([TRACK, TRACK])
    // At 247.5 of the 371 pixels, and at 242, the empty part too.
    expect([pixelOf(bar, 242, 14), pixelOf(bar, 247, 14)]).toEqual([TRACK, TRACK])
    const line = (await ui.find({ key: 'detail-1m' })) as Tree | undefined
    expect(line && textIn(line)).toBe('320.8k of 1M'.padEnd(67))
    await ui.unmount()
  },
)

test(
  'a session the engine gives no figure for is estimated from its breakdown, and its bar is one plain fill',
  { options: { bar_style: 'dots' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // No percentage in the plain figures: the breakdown is asked for its estimate, 320807 of the million.
    sessionOf(on, { window: 1_000_000 })
    const ui = await $.ui.mount(PILLS)
    await clock.advance(3000)
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    // 32% of 31 cells is 10, one fill from the bar's start.
    expect(row.children.slice(2, 4).map(cell => [textIn(cell), cell.props.color])).toEqual([
      ['⣿'.repeat(10), 'claude'],
      ['⣀'.repeat(21), 'inactive'],
    ])
    await ui.unmount()
  },
)

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
// with a cell either side; "1m", a dot, the bar's 4 cells, a dot, "45%" and the edge: 23.
const NARROWEST = { ...BAND, props: { ...BAND.props, bodyColumns: 23 } }
// The band whose bars first reach 255 cells, the most an Image takes: a cell, Clawd's 16 and a
// cell, "1m", a dot, 255 cells, a dot, "45%", " 06d-23h-59m" and the edge: 293.
const WIDEST = { ...BAND, props: { ...BAND.props, bodyColumns: 293 } }

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
  'at the narrowest band that draws bars, with dots on, no row is wider than the band and each bar is a whole picture of 4 cells',
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, INSIDE)
    const ui = await $.ui.mount(NARROWEST)
    await clock.advance(1000)
    const drawn = (await ui.drawn()) as Laid
    expect(cellsAcross(drawn)).toBeLessThanOrEqual(25)
    expect(overhangs(drawn, 25)).toEqual([])
    // 4 cells at the usual 2.2 are 4 times 28 pixels over 2.2 across, 51, and a row of 28 down.
    const bars = await picturedBars(ui)
    expect(bars.map(bar => bar[0])).toContain('bar-1m')
    expect(bars.map(bar => bar.slice(1))).toEqual(bars.map(() => [4, 1, 51, 28, true]))
    await ui.unmount()
  },
)

test(
  'at the widest bar, with dots on, no row is wider than the band and each bar is a whole picture of 255 cells',
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
  'bars drawn as dots, at the narrowest band that draws them and at the widest bar, keep every row within the band and every bar to its cells',
  { options: { bar_style: 'dots' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on, INSIDE)
    const widths: [number, number][] = [
      [23, 4],
      [293, 255],
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
// fill would. The fill is one plain fill from the bar's start: at 32% it holds inside the rim at
// all three.
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
    { options: { cell_ratio: ratio } },
    async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      sessionOf(on)
      const ui = await $.ui.mount(NARROWEST)
      await clock.advance(1000)
      const bar = (await imageOf(ui, 'bar-1m'))!
      expect([bar.columns, bar.source.width, bar.source.height]).toEqual([4, width, 28])
      // The fill stands first inside the bar, at 10, at every shape.
      expect(pixelOf(bar, 10, 14)).toEqual(ORANGE)
      // From where the inside ends to the bar's end, at mid height, not a pixel of the fill's
      // colour, whole or in part.
      const past = Array.from({ length: 6 }, (_, k) => pixelOf(bar, width - 6 + k, 14))
      expect(past.filter(colour => sameRgb(colour, ORANGE))).toEqual([])
      // The rim, whole: both its pixels the empty part's colour.
      expect([width - 4, width - 3].map(x => pixelOf(bar, x, 14))).toEqual([TRACK, TRACK])
      await ui.unmount()
    },
  )
}

test(
  'at its widest, 255 cells, a full context bar ends its fill where the inside ends and draws its rim whole',
  {},
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

test(
  'at the narrowest bar, 4 cells, the context bar of a session that loaded every kind of memory is one plain fill from the bar\'s start',
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(NARROWEST)
    await clock.advance(1000)
    // 51 pixels by 28, at mid height. The fill is 32% of
    // 51, 16.3, shorter than it is high, so a circle 16 across from the bar's inside at 6, to 22,
    // and its clear ring from 22 to 24.
    const bar = (await imageOf(ui, 'bar-1m'))!
    expect([10, 15, 20].map(x => pixelOf(bar, x, 14))).toEqual([ORANGE, ORANGE, ORANGE])
    expect(pixelOf(bar, 22, 14)[3]).toBe(0)
    expect(pixelOf(bar, 25, 14)).toEqual(TRACK)
    // After it, on to the rim, and at 0.667 of 51, 34.0, among it: the empty part, nothing over it.
    expect([29, 31, 34, 37, 39, 41, 43].map(x => pixelOf(bar, x, 14))).toEqual([TRACK, TRACK, TRACK, TRACK, TRACK, TRACK, TRACK])
    await ui.unmount()
  },
)

test(
  'at the narrowest bar in dots the context bar of a session that loaded every kind of memory is one plain fill from the bar\'s start',
  { options: { bar_style: 'dots' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    sessionOf(on)
    const ui = await $.ui.mount(NARROWEST)
    await clock.advance(1000)
    // 4 cells of three steps each: 32% of 12 steps is 3.84, rounded to 4, a whole cell and a
    // third of the next from the start; the other two empty.
    const row = (await ui.find({ key: 'row-1m' })) as unknown as { children: Tree[] }
    expect(row.children.slice(2, 4).map(cell => [textIn(cell), cell.props.color])).toEqual([
      ['⣿⣤', 'claude'],
      ['⣀⣀', 'inactive'],
    ])
    expect(textIn(row.children[4]!)).toBe('·')
    await ui.unmount()
  },
)

// A session whose breakdowns answer when the test says: the nth ask waits the
// nth of `waits` on the test's clock, none past the list, and answers the nth
// of `breakdowns`, BREAKDOWN past it. Its id and what it measures may change;
// `asked` is the id each breakdown was asked under.
const heldSessionOf = (on: On, clock: ReturnType<typeof mock.clock>, waits: number[], breakdowns: SessionContextBreakdown[] = []) => {
  const session = { id: 'one', context: CONTEXT as { window: number; tokens?: number; percent?: number }, asked: [] as string[] }
  replied(on)
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

// What a session the engine has no figure for answers: the window, and no figure of its own.
const NO_FIGURE = { window: 1_000_000 }
// A wait no test reaches the end of.
const NEVER = 600_000
// The context row's figure as drawn: its percentage, or `--` with none.
const figureOf = async (ui: { find: (query: { key: string }) => Promise<unknown> }) => {
  const words = (node: unknown): string =>
    typeof node === 'string' ? node : ((node as { children?: unknown[] } | undefined)?.children ?? []).map(words).join('')
  return words(await ui.find({ key: 'row-1m' })).match(/\d+%|--/)?.[0]
}

test('an estimate the session refuses is asked for again the next second', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  let asked = 0
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.usage', ($, e) => {
    if (!e.breakdown) return usageOf([], NO_FIGURE)
    asked += 1
    return asked === 1 ? { deny: 'not now' } : usageOf([], { ...NO_FIGURE, breakdown: BREAKDOWN })
  })
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(PILLS)
  await clock.advance(5000)
  // The one that failed, and the one that answered: 320807 of the million. None after it.
  expect(asked).toBe(2)
  expect(await figureOf(ui)).toBe('32%')
  await ui.unmount()
})

test('a session id lookup that fails once the session is known is no new session: its estimate is not asked for again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  let asked = 0
  let hasId = true
  on('session.id', () => (hasId ? { value: 'one' } : { deny: 'no id now' }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.usage', ($, e) => {
    if (!e.breakdown) return usageOf([], NO_FIGURE)
    asked += 1
    return usageOf([], { ...NO_FIGURE, breakdown: BREAKDOWN })
  })
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(PILLS)
  await clock.advance(2000)
  expect(asked).toBe(1)
  hasId = false
  await clock.advance(5000)
  // Still the one estimate, still drawn: 320807 of the million.
  expect(asked).toBe(1)
  expect(await figureOf(ui)).toBe('32%')
  await ui.unmount()
})

test('an estimate that never answers lets the band draw, is given up ten seconds after it was asked, and the next pass asks a new one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [NEVER])
  session.context = NO_FIGURE
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  // The row, with no figure yet.
  expect(await figureOf(ui)).toBe('--')
  await clock.advance(8000)
  expect(session.asked.length).toBe(1)
  await clock.advance(4000)
  // The new one answers at once: 320807 of the million.
  expect(session.asked.length).toBe(2)
  expect(await figureOf(ui)).toBe('32%')
  await ui.unmount()
})

test('an estimate that answers after it was given up is dropped: not kept, not drawn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first answers fifteen seconds on, the one asked after it never.
  const session = heldSessionOf(on, clock, [15_000, NEVER])
  session.context = NO_FIGURE
  const ui = await $.ui.mount(PILLS)
  await clock.advance(16_000)
  expect(session.asked.length).toBe(2)
  expect(await figureOf(ui)).toBe('--')
  await ui.unmount()
})

test('a new session id clears the kept estimate at once and asks its own; an empty id, a lookup that failed, is no new session', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first answers at once, the second never.
  const session = heldSessionOf(on, clock, [0, NEVER])
  session.context = NO_FIGURE
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  expect(await figureOf(ui)).toBe('32%')
  session.id = ''
  await clock.advance(3000)
  expect(session.asked).toEqual(['one'])
  expect(await figureOf(ui)).toBe('32%')
  // A frame every 400ms: the first pass of the next second is at most that late.
  session.id = 'two'
  await clock.advance(2000)
  expect(session.asked).toEqual(['one', 'two'])
  expect(await figureOf(ui)).toBe('--')
  await ui.unmount()
})

test("an estimate asked for one session that answers once the id is another's is dropped, and the new session is asked its own", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first answers 2.5s on, the second 2s on.
  const session = heldSessionOf(on, clock, [2500, 2000])
  session.context = NO_FIGURE
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1500)
  session.id = 'two'
  // A frame every 400ms: the pass of second 2 is at 2000, of second 3 at 3200.
  // At 2600 the first has answered, and no pass has followed.
  await clock.advance(1100)
  expect(session.asked).toEqual(['one'])
  expect(await figureOf(ui)).toBe('--')
  await clock.advance(4000)
  expect(session.asked).toEqual(['one', 'two'])
  expect(await figureOf(ui)).toBe('32%')
  await ui.unmount()
})

test('a session whose figure the engine gives is asked for no breakdown in a minute, nor when a turn ends', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [])
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(PILLS)
  await clock.advance(61_000)
  expect(session.asked).toEqual([])
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.advance(3000)
  expect(session.asked).toEqual([])
  // The engine's own figure: 32 of the hundred.
  expect(await figureOf(ui)).toBe('32%')
  await ui.unmount()
})

test('a session with no figure of its own is asked for its estimate once, and not again as the minutes pass', { options: { animate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = heldSessionOf(on, clock, [])
  session.context = NO_FIGURE
  const ui = await $.ui.mount(PILLS)
  await clock.advance(180_000)
  expect(session.asked).toEqual(['one'])
  expect(await figureOf(ui)).toBe('32%')
  await ui.unmount()
})

test("a session's estimate is dropped once the engine gives its figure, and asked for once again when the figure goes missing", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The first estimate is 320807 of the million, the second 450000.
  const session = heldSessionOf(on, clock, [], [BREAKDOWN, { ...BREAKDOWN, totalTokens: 450_000 }])
  session.context = NO_FIGURE
  const ui = await $.ui.mount(PILLS)
  await clock.advance(3000)
  expect(session.asked).toEqual(['one'])
  expect(await figureOf(ui)).toBe('32%')
  // The engine's own figure arrives: it is drawn, and nothing is asked.
  session.context = { window: 1_000_000, tokens: 600_000, percent: 60 }
  await clock.advance(3000)
  expect(session.asked).toEqual(['one'])
  expect(await figureOf(ui)).toBe('60%')
  // It goes missing again: one more estimate, within the first pass after.
  session.context = NO_FIGURE
  await clock.advance(1400)
  expect(session.asked).toEqual(['one', 'one'])
  expect(await figureOf(ui)).toBe('45%')
  await clock.advance(5000)
  expect(session.asked).toEqual(['one', 'one'])
  await ui.unmount()
})

test("the session's usage is read once a second, by the context's estimate and the band's rows together", { options: { animate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  asked.readings = 0
  // Nothing on the band moves: no countdown runs, the figure stays.
  await clock.advance(10_000)
  expect(asked.readings).toBe(10)
  expect(await figureOf(ui)).toBe('32%')
  await ui.unmount()
})

test("a second whose rows moved is drawn from the rows that second built: the session's usage is read once for both", { options: { animate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = sessionOf(on)
  // A reply a minute ago: the cache's countdown steps each second, and the band is drawn again.
  on('state.get', { key: 'cacheAt' }, () => ({ value: { value: NOW - 60_000, version: 1 } }))
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1000)
  asked.readings = 0
  await clock.advance(10_000)
  // A frame every 400ms: the last pass is of second 10, 3530 seconds before the hour is out.
  expect(await ui.find({ type: 'Text', text: /00h-58m-50s$/ })).toBeDefined()
  expect(asked.readings).toBe(10)
  await ui.unmount()
})
