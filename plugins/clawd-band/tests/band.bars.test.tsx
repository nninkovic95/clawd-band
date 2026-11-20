import { expect, mock, test } from 'claude-code/testing'

import { barRuns } from '../hooks/bar'
import { BAR_STYLES } from '../hooks/settings'
import { BAND, core, type Drawn, narrow, nodes, NOW, replied, TEXT_BARS, usageOf, words } from './band.fixtures'

// The blocks style without its round ends, for the tests of days and marks: the ends have
// their own test.
const PLAIN = { steps: BAR_STYLES.blocks.steps }

test('the weekly bar is seven equal days with a mark between each, in one colour', async () => {
  // 27 cells: 7 days of 3 and 6 marks. 10 of the 21 day cells used: the fill takes the marks
  // it runs past, so a mark is the fill's colour there and the empty part's after it.
  expect(barRuns(27, (10 / 21) * 100, PLAIN, 7)).toEqual([
    { text: '███ ███ ███ █', part: 'filled' },
    { text: '██ ███ ███ ███', part: 'empty' },
  ])
  // A fill that ends with a day leaves the next mark to the empty part.
  expect(barRuns(27, (9 / 21) * 100, PLAIN, 7)).toEqual([
    { text: '███ ███ ███', part: 'filled' },
    { text: ' ███ ███ ███ ███', part: 'empty' },
  ])
  // The last 3 days warn; the marks between them stay the empty part's.
  expect(barRuns(27, 0, PLAIN, 7, 3)).toEqual([
    { text: '███ ███ ███ ███ ', part: 'empty' },
    { text: '███', part: 'empty', warn: true },
    { text: ' ', part: 'empty' },
    { text: '███', part: 'empty', warn: true },
    { text: ' ', part: 'empty' },
    { text: '███', part: 'empty', warn: true },
  ])
  expect(barRuns(10, 30, PLAIN)).toEqual([
    { text: '███', part: 'filled' },
    { text: '███████', part: 'empty' },
  ])
})

test('a weekly bar under 13 cells is whole; over it, its days differ by a cell at most, spread out', async () => {
  for (const width of [7, 12]) {
    expect(barRuns(width, 0, PLAIN, 7)).toEqual([{ text: '█'.repeat(width), part: 'empty' }])
  }
  expect(barRuns(13, 0, PLAIN, 7)).toEqual([{ text: '█ █ █ █ █ █ █', part: 'empty' }])
  expect(barRuns(20, 0, PLAIN, 7)).toEqual([{ text: '██ ██ ██ ██ ██ ██ ██', part: 'empty' }])
  expect(barRuns(28, 0, PLAIN, 7)).toEqual([{ text: '███ ███ ███ ████ ███ ███ ███', part: 'empty' }])
  expect(barRuns(33, 0, PLAIN, 7)).toEqual([{ text: '████ ████ ████ ███ ████ ████ ████', part: 'empty' }])
})

test('the blocks style draws the empty part solid, told from the fill by colour alone', async () => {
  expect(barRuns(10, 30, PLAIN)).toEqual([
    { text: '███', part: 'filled' },
    { text: '███████', part: 'empty' },
  ])
  expect(barRuns(13, 0, PLAIN, 7)).toEqual([{ text: '█ █ █ █ █ █ █', part: 'empty' }])
})

test("the blocks style rounds the bar's ends, each in the colour of its part", async () => {
  // The powerline half circles (a Nerd Font's): left U+E0B6, right U+E0B4.
  expect(barRuns(10, 0, BAR_STYLES.blocks)).toEqual([{ text: '████████', part: 'empty' }])
  expect(barRuns(10, 100, BAR_STYLES.blocks)).toEqual([{ text: '████████', part: 'filled' }])
  // Another style keeps square ends.
  expect(barRuns(4, 0, BAR_STYLES.dots)).toEqual([{ text: '⣀⣀⣀⣀', part: 'empty' }])
})

test("the blocks style rounds the fill's end into what lies behind it", async () => {
  const [L, R] = ['', '']
  // 10 cells, 3 used: the third is a right cap on the empty part's colour.
  expect(barRuns(10, 30, BAR_STYLES.blocks)).toEqual([
    { text: `${L}█`, part: 'filled' },
    { text: R, part: 'filled', behind: 'empty' },
    { text: `██████${R}`, part: 'empty' },
  ])
  // 20 cells, days of 2, 2 used: a day gap follows the fill, so nothing lies behind its end.
  expect(barRuns(20, (2 / 14) * 100, BAR_STYLES.blocks, 7)).toEqual([
    { text: `${L}${R}`, part: 'filled' },
    { text: ` ██ ██ ██ ██ ██ █${R}`, part: 'empty' },
  ])
  // 27 cells, days of 3, the last 3 warned from day cell 12; 13 used: the fill ends on a warned cell.
  expect(barRuns(27, (13 / 21) * 100, BAR_STYLES.blocks, 7, 3)).toEqual([
    { text: `${L}██ ███ ███ ███ `, part: 'filled' },
    { text: R, part: 'filled', behind: 'warn' },
    { text: '██', part: 'empty', warn: true },
    { text: ' ', part: 'empty' },
    { text: '███', part: 'empty', warn: true },
    { text: ' ', part: 'empty' },
    { text: `██${R}`, part: 'empty', warn: true },
  ])
})

// The unused cells of the weekly bar drawn in the error colour.
const warnedCells = async (ui: { find: (query: { key: string }) => Promise<unknown> }) => {
  const bars = (await ui.find({ key: 'bars' })) as Drawn | undefined
  const weekly = bars ? nodes(bars)[0] : undefined
  return (weekly ? nodes(weekly) : [])
    .filter(run => run.props?.color === 'error')
    .reduce((cells, run) => cells + [...words(run)].filter(c => c === '█' || c === '').length, 0)
}

// The first bar drawn whole in the empty colour, in cells: where nothing is used, the
// five-hour bar (the weekly one has marks). Read inside the bars, by colour, since the fill
// and the text Clawd draw the same block.
const emptyBar = async (ui: { find: (query: { key: string }) => Promise<unknown> }) => {
  const bars = (await ui.find({ key: 'bars' })) as Drawn | undefined
  const run = (bars ? nodes(bars) : [])
    .flatMap(row => nodes(row))
    .find(run => run.props?.color === 'inactive' && /^[█]+$/.test(words(run)))
  return run ? words(run).length : undefined
}

test('a day mark is drawn in the colour of the part it sits in, and no bar is drawn dim', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const resetsAt = new Date(NOW + 6 * 86_400_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'seven_day', percentUsed: 40, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  const bars = (await ui.find({ key: 'bars' })) as Drawn | undefined
  // The weekly row's bar: its Texts between the dot after the label and the dot before the percentage.
  const row = bars ? nodes(nodes(bars)[0]!) : []
  const cells = row.slice(2, row.findIndex(run => words(run).includes('%')) - 1)
  const marks = (empty: boolean) =>
    cells
      .filter(run => (run.props.color === 'inactive') === empty)
      .reduce((n, run) => n + [...words(run)].filter(c => c === ' ').length, 0)
  // 75 columns with the test's "200k" label and a dim dot either side: a 31-cell bar, 23 day
  // cells starting at 0, 3, 7, 10, 13, 16, 20. 40% is 9 cells: the fill runs past the marks
  // before cells 3 and 7.
  expect([marks(false), marks(true)]).toEqual([2, 4])
  // Claude Code draws `dimColor` in the theme's grey, whatever the colour.
  expect(cells.filter(run => run.props.dimColor).length).toBe(0)
  await ui.unmount()
})

for (const [used, days, warned] of [
  [60, 4, 0],
  [30, 4, 0],
  [85, 2, 4],
  [80, 2.5, 6],
  [75, 2.2, 7],
  [72, 3, 8],
  [71, 3, 0],
  [80, 1, 0],
  [80, 1.5, 6],
  [80, 1.4, 0],
  [90, 1, 3],
]) {
  test(`the weekly bar warns once its fill is in the last 2 segments and fewer segments are left than days to the reset (${used}%, ${days} days left)`, TEXT_BARS, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const resetsAt = new Date(NOW + days! * 86_400_000).toISOString()
    on('session.usage', () => usageOf([{ kind: 'seven_day', percentUsed: used!, resetsAt }]))
    on('ui.render', core)
    on('ui.blit', () => ({ value: {} }))
    const ui = await $.ui.mount(BAND)
    await clock.advance(1)
    // 75 columns with the "200k" label and a dim dot either side: a 35-cell bar, 29 day cells
    // and 6 marks, the last 2 segments 8 cells (day cells 21 to 28), a cell to each block. The
    // rule is by fill, not by the time to the reset: the unused cells of the last 2 segments warn
    // when the fill is inside them and the segments left are fewer than the days left. 60% (2.8
    // segments left) and 30% are not inside them. 85% with 2 days leaves 1.05 segments: 4 cells
    // warn; 80% with 2.5 days fills 23 cells (23.2), so 6; 75% with
    // 2.2 days, 7; 72% with 3 days (1.96), 8. 71% leaves 2.03 segments, outside them; 80% with
    // 1 day leaves 1.4, more than the day left; 90% with 1 day leaves 0.7: 3 cells warn.
    // 80% always leaves 1.4 segments (7 * 20 / 100) and fills the same 23 cells: with 1.5 days to go
    // the segments left are fewer, so 6 cells warn; with 1.4 days they are equal, which is on pace, so none.
    expect(await warnedCells(ui)).toBe(warned)
    await ui.unmount()
  })
}

test('a window used up reads 99%, never 100%, and its bar is full', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 100, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: '99%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /100%/ })).toBe(undefined)
  // 75 columns: 1, 16 for Clawd, 1, "200k" 4 (the test's context window), a dim dot either side of the bar 2,
  // "99%" 3, " 01h-00m-00s" 12, 1 at the edge: the bar is 35,
  // its ends caps.
  expect(await ui.find({ type: 'Text', text: /^█{33}$/ })).toBeDefined()
  await ui.unmount()
})

// A node's text, its children's in order.
const textOf = (node: Drawn | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''))

test("the fill's rounded end is drawn on the empty part's colour", TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 40, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  // The five-hour bar's fill ends in a right cap: the fill's colour on the empty part's.
  const end = await ui.find({ type: 'Text', text: /^$/ })
  expect([end?.props.color, end?.props.backgroundColor]).toEqual(['suggestion', 'inactive'])
  await ui.unmount()
})

test('each bar has a dim dot either side, no blank cell parts a label, bar and figure, and a blank row parts each two, under an empty row on top', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 40, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  const bars = (await ui.find({ key: 'bars' })) as Drawn | undefined
  const rows = (bars ? nodes(bars) : []).map(textOf)
  // 75 columns: 1, 16 for Clawd, 1, "200k" 4, a dim dot either side of the bar 2, "99%" 3,
  // " 00h-59m-59s" 12, 1 at the edge: the bar is 35.
  expect(rows.length).toBe(5)
  expect([rows[1], rows[3]].map(row => row?.trim())).toEqual(['', ''])
  // The label, a dot, the bar from its first cap to its last, a dot, the percentage: no blank
  // cell between them. The dots are dim: they lead the eye from a label to its bar and on to its
  // figure. The percentage is always two digits.
  const framed = /^(7d {2}|5h {2}|200k)·(?:.{35}|[/ ]{35})· *(\d\d%|--|[-\\|/])/
  expect([rows[0], rows[2], rows[4]].map(row => framed.test(row ?? ''))).toEqual([true, true, true])
  expect((await ui.find({ type: 'Text', text: '·' }))?.props.dimColor).toBe(true)
  // The band's first row is empty to the eye, so it stands clear of the line above it: it holds
  // only the one-cell picture the terminal is asked through, whose alt is a space.
  const top = (await ui.find({ key: 'band' })) as Drawn | undefined
  const first = top?.children[0] as { type?: string; props: Record<string, unknown> } | undefined
  expect([first?.type, first?.props.columns, first?.props.rows, first?.props.alt]).toEqual(['Image', 1, 1, ' '])
  await ui.unmount()
})

// Each row's fill colour, top to bottom: the first run of a bar not in the empty colour.
const fillColours = async (ui: { find: (query: { key: string }) => Promise<unknown> }) => {
  const bars = (await ui.find({ key: 'bars' })) as Drawn | undefined
  return (bars ? nodes(bars) : []).filter((_, at) => at % 2 === 0).map(
    row => nodes(row).find(run => /^[█ ]+$/.test(words(run)) && /[█]/.test(words(run)) && run.props?.color !== 'inactive')?.props.color,
  )
}

for (const [used, colours] of [
  [[31, 40, 12], ['autoAccept', 'suggestion', 'claude']],
  [[70, 90, 95], ['autoAccept', 'suggestion', 'claude']],
] as const) {
  test(`each bar keeps its own colour at any level (${used.join(', ')}%)`, TEXT_BARS, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    replied(on)
    const resetsAt = new Date(NOW + 3_600_000).toISOString()
    on('session.usage', () =>
      usageOf(
        [
          { kind: 'seven_day', percentUsed: used[0], resetsAt },
          { kind: 'five_hour', percentUsed: used[1], resetsAt },
        ],
        { window: 200_000, percent: used[2] },
      ),
    )
    on('ui.render', core)
    on('ui.blit', () => ({ value: {} }))
    const ui = await $.ui.mount(BAND)
    await clock.advance(1)
    expect(await fillColours(ui)).toEqual([...colours])
    await ui.unmount()
  })
}

test(
  'the bars take the configured colours',
  { options: { bar_style: 'blocks', bar_color_five_hour: '#00ff00', bar_color_empty: 'gray' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {
      usage: {
        fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
        sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
      },
    })
    on('ui.render', core)
    const first = await $.ui.mount(BAND)
    await clock.advance(1)
    await first.unmount()
    const ui = await $.ui.mount(BAND)
    const colours = new Set((await ui.findAll({ type: 'Text', text: /^[█ ]*[█][█ ]*$/ })).map(run => run.props.color))
    expect([colours.has('#00ff00'), colours.has('gray')]).toEqual([true, true])
    await ui.unmount()
  },
)

test('the bars take every cell left, with a one-cell gap either side of Clawd', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  // Fixed: Clawd's box 16, "5h" 2, a dim dot either side of the bars 2, "99%" 3,
  // " 04h-59m-59s" 12, one cell at the right edge, and the gaps before and after Clawd at 1
  // each: 38. The bars take the rest.
  for (const [columns, bar, before, after] of [
    [75, 37, 1, 1],
    [80, 42, 1, 1],
    [100, 62, 1, 1],
    [120, 82, 1, 1],
  ]) {
    const ui = await $.ui.mount(narrow(columns!))
    await clock.advance(1)
    // The five-hour bar, empty and whole; the weekly one has marks.
    const empty = await emptyBar(ui)
    const clawd = (await ui.find({ key: 'clawd-column' }))?.props
    const bars = (await ui.find({ key: 'bars' }))?.props
    expect([columns, empty, clawd?.marginLeft, bars?.marginLeft, bars?.marginRight]).toEqual([columns, bar, before, after, 1])
    await ui.unmount()
  }
})

test('the bars leave Clawd 16 columns and a gap, in either form', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  on('ui.render', core)
  let refuse = false
  on('ui.blit', () => ({ value: refuse ? { deny: 'the Image draws its alt here: no pictures in a test' } : {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  // 75 columns: 1, 16 for Clawd, 1 gap, "5h", a dim dot either side of the bar, "99%",
  // " 04h-59m-59s", 1 at the edge leave 37, and the bar takes them all. The five-hour bar, empty: the weekly one has marks.
  const empty = () => emptyBar(ui)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await empty()).toBe(37)
  refuse = true
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await empty()).toBe(37)
  await ui.unmount()
})

test('a band too narrow for whole countdowns shows their two biggest units', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(39))
  await clock.advance(1)
  // 39 cells: 1, 16 for Clawd, 1 gap, "5h", 5 of bar and a dim dot either side, "99%", " --h---m", 1 at the edge.
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /--h---m---s/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /--h---m$/ }))?.text).toBe('--h---m')
  expect(await emptyBar(ui)).toBe(5)
  await ui.unmount()
})

test('narrower still, the countdowns go and the bars keep the room', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(32))
  await clock.advance(1)
  // 32 cells: 1, 16 for Clawd, 1 gap, "5h", 6 of bar and a dim dot either side, "99%", 1 at the edge.
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /--[hd]/ })).toBe(undefined)
  expect(await emptyBar(ui)).toBe(6)
  await ui.unmount()
})

test('narrower again, Clawd turns to the 14-cell text and the bars keep the room', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(29))
  await clock.advance(1)
  // 29 cells: 1, 14 for Clawd in text, 1 gap, "5h", 5 of bar and a dim dot either side, "99%", 1 at the edge.
  // The 16-cell picture would leave the bar 3, under its least.
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBeDefined()
  expect(await emptyBar(ui)).toBe(5)
  await ui.unmount()
})

test('narrowest, Clawd hides; the model line stays and the bars keep the room', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  replied(on)
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(21))
  await clock.advance(1)
  // 21 cells: 1, "--" for the model not yet known, 1 gap, "5h", 9 of bar and a dim dot either side, "99%", 1 at the edge.
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBe(undefined)
  expect(await ui.find({ key: 'model' })).toBeDefined()
  expect(await emptyBar(ui)).toBe(9)
  await ui.unmount()
})

// The cells a drawn node takes across: a row its children's together, a column
// its widest, a Box at least the width it sets, an Image its columns, each with
// its margins.
type Laid = { type?: string; props?: Record<string, unknown>; children?: (Laid | string)[] }
const cellsAcross = (node: Laid | string): number => {
  if (typeof node === 'string') return [...node].length
  const props = node.props ?? {}
  const kids = node.children ?? []
  const number = (value: unknown) => (typeof value === 'number' ? value : 0)
  const inner =
    node.type === 'Image'
      ? number(props.columns)
      : props.flexDirection === 'column'
        ? Math.max(0, ...kids.map(cellsAcross))
        : kids.map(cellsAcross).reduce((sum, cells) => sum + cells, 0)
  return number(props.marginLeft) + Math.max(number(props.width), inner) + number(props.marginRight)
}

test('at every width from 10 to 90 columns, no row is wider than the band', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const over: string[] = []
  for (let columns = 10; columns <= 90; columns++) {
    const ui = await $.ui.mount(narrow(columns))
    await clock.advance(1)
    const cells = cellsAcross((await ui.drawn()) as Laid)
    if (cells > columns) over.push(`${columns}: ${cells}`)
    await ui.unmount()
  }
  expect(over).toEqual([])
})

test('narrower than its narrowest layout, the band draws nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  // 16 cells: 1, "--", 1 gap, "5h", 4 of bar and a dim dot either side, "99%", 1 at the edge. One
  // fewer and no row fits.
  for (const [columns, shows] of [
    [16, true],
    [15, false],
  ] as const) {
    const ui = await $.ui.mount(narrow(columns))
    await clock.advance(1)
    const drawn = [await ui.find({ key: 'bars' }), await ui.find({ type: 'Text' })].map(node => node !== undefined)
    expect([columns, ...drawn]).toEqual([columns, shows, shows])
    await ui.unmount()
  }
})
