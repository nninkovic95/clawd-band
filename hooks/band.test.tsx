import type { Hook, On, SessionContextUsage, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { barRuns, cacheCountdown, countdown, loadingRuns, windowLabel } from './band'
import { poseFor, shortModel, shownPose, withoutEffort } from './register'
import { BAR_STYLES, settings } from './settings'
import {
  CLAUDE_ORANGE,
  lengthOf,
  picturesIn,
  PICTURE_ROWS,
  PIXEL_HEIGHT,
  PIXEL_WIDTH,
  POSES,
  SCALE,
  SCENES,
  TEXT_COLUMNS,
  TEXT_ROWS,
  textIn,
} from './sprite'
import type { Pose } from '../types'
import { parseAccountUsage } from './usage/account'
import { askKey, expiredKey, mergeUsage, resetExpired, sameUsage, toUsage } from './usage/model'

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

// The bars as text, whatever the terminal draws: the tests of their cells.
const TEXT_BARS = { options: { bar_style: 'blocks' } } as const
// Still bars: a row with no reading holds one frame, so a long wait costs no redraw each frame.
const STILL_BARS = { options: { bar_style: 'blocks', animate: false } } as const

// The moment every test's clock starts at.
const NOW = Date.parse('2026-10-11T15:00:00Z')

// A whole `$.session.usage()` answer: the engine always reports a window.
const usageOf = (rateLimits: SessionRateLimit[] = [], context: SessionContextUsage = { window: 200_000 }) => ({
  value: { startedAt: 0, context, rateLimits },
})

// The tests' stand-in for the engine's own drawing: an empty box, since a
// stand-in that draws nothing is refused.
const core: Hook<'ui.render'> = ($, e) => {
  const { Box } = $.ui.resolve(e)
  return <Box />
}

test('tool names pick the pose', async () => {
  expect(poseFor('AskUserQuestion')).toBe('questioning')
  expect(poseFor('mcp__claude_ai_Claude_Docs__read')).toBe('reading')
  expect(poseFor('mcp__claude_ai_Claude_Docs__update')).toBe('writing')
  expect(poseFor('Grep')).toBe('reading')
  expect(poseFor('Edit')).toBe('writing')
  expect(poseFor('Bash')).toBe('running')
  expect(poseFor('WebSearch')).toBe('searching')
  expect(poseFor('Agent')).toBe('delegating')
  expect(poseFor('TodoWrite')).toBe('working')
})

test('usage windows come from the rate limits', async () => {
  expect(toUsage([])).toBe(null)
  const usage = toUsage([
    { kind: 'five_hour', percentUsed: 72.5, resetsAt: '2026-10-11T18:00:00Z' },
    { kind: 'seven_day', percentUsed: 31 },
  ])
  expect(usage?.fiveHour?.percentUsed).toBe(72.5)
  expect(usage?.sevenDay?.resetsAt).toBe(null)
})

test('model names are shortened', async () => {
  expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(shortModel('claude-haiku-5-5-20261001')).toBe('Haiku 5.5')
  expect(shortModel('claude-fable-5-2')).toBe('Fable 5.2')
  expect(shortModel('Opus 5.5')).toBe('Opus 5.5')
})

test('countdown and colours', async () => {
  const now = NOW
  expect(countdown('2026-10-11T18:04:05Z', now)).toBe('03h-04m-05s')
  expect(countdown('2026-10-11T14:00:00Z', now)).toBe('00h-00m-00s')
  expect(countdown(null, now)).toBe('--h---m---s')
  expect(countdown(null, now, true)).toBe('--d---h---m')
  expect(countdown('2026-10-14T19:30:00Z', now, true)).toBe('03d-04h-30m')
  expect(countdown('2026-10-14T19:30:00Z', now, true).length).toBe(countdown('2026-10-11T18:04:05Z', now).length)
  const defaults = settings({})
  expect([defaults.weeklyColor.text, defaults.fiveHourColor.text, defaults.contextColor.text]).toEqual([
    'autoAccept',
    'suggestion',
    'claude',
  ])
})

test('the context row: window label and cache countdown', async () => {
  expect(windowLabel(1_000_000)).toBe('1m')
  expect(windowLabel(200_000)).toBe('200k')
  expect(windowLabel(undefined)).toBe('cx')
  const now = NOW
  const hour = settings({}).cacheTtlMs
  expect(hour).toBe(3_600_000)
  expect(settings({ cache_ttl: '5m' }).cacheTtlMs).toBe(300_000)
  expect(cacheCountdown(null, hour, now)).toBe('--h---m---s')
  expect(cacheCountdown(now - 48_000, hour, now)).toBe('00h-59m-12s')
  expect(cacheCountdown(now - hour, hour, now)).toBe('cold')
  expect(settings({}).cold.text).toBe('blue')
})

test('the effort pill leaves the hint line', async () => {
  expect(withoutEffort('● high · /effort')).toBe('')
  expect(withoutEffort('? for shortcuts · ● xhigh · /effort')).toBe('? for shortcuts')
  expect(withoutEffort('● max · /effort · ? for shortcuts')).toBe('? for shortcuts')
  expect(withoutEffort('esc to interrupt')).toBe(null)
})

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
  // The weekly row's bar: its Texts between the label and the percentage.
  const row = bars ? nodes(nodes(bars)[0]!) : []
  const cells = row.slice(2, row.findIndex(run => words(run).includes('%')) - 1)
  const marks = (empty: boolean) =>
    cells
      .filter(run => (run.props.color === 'inactive') === empty)
      .reduce((n, run) => n + [...words(run)].filter(c => c === ' ').length, 0)
  // 75 columns with the test's "200k " label and a blank cell either side: a 29-cell bar, 23 day
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
]) {
  test(`the last 3 days of the weekly bar warn only within them, when the week is used ahead of time (${used}%, ${days} days left)`, TEXT_BARS, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const resetsAt = new Date(NOW + days! * 86_400_000).toISOString()
    on('session.usage', () => usageOf([{ kind: 'seven_day', percentUsed: used!, resetsAt }]))
    on('ui.render', core)
    on('ui.blit', () => ({ value: {} }))
    const ui = await $.ui.mount(BAND)
    await clock.advance(1)
    // 75 columns with the "200k " label and a blank cell either side: a 33-cell bar, 27 day cells
    // and 6 marks, the last 3 days from day cell 15. 60% with 4 days to go leaves 2.8 days'
    // worth, ahead of time, but the week is not yet in its last 3 days: nothing warns. 30% is not
    // ahead. 85% with 2 days to go leaves 1.05: the fill ends at cell 23, and the 4 unused cells
    // after it warn.
    expect(await warnedCells(ui)).toBe(warned)
    await ui.unmount()
  })
}

test('a cold cache turns the context row blue', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.usage', () => usageOf([], { window: 1_000_000, tokens: 120_000, percent: 12 }))
  on('ui.render', core)
  on('state.get', { key: 'cacheAt' }, () => ({ value: { value: Date.parse('2026-10-11T13:00:00Z'), version: 1 } }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: /^1m/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /cold$/ }))?.props.color).toBe('blue')
  await ui.unmount()
})

test('options are checked, a bad colour falls back to its default', async () => {
  const defaults = settings({})
  expect(defaults.showModel).toBe(true)
  expect(defaults.spriteColor).toBe('claude')
  expect(settings({ sprite_color: '#d77757' }).spriteColor).toBe('claude')
  const custom = settings({
    show_model: false,
    sprite_color: '3af',
    bar_color_weekly: '#00ff00',
    bar_color_five_hour: 'not a colour!',
    bar_color_warning: 'magenta',
    bar_color_empty: 'subtle',
  })
  expect(custom.showModel).toBe(false)
  expect(custom.spriteRgb).toEqual([0x33, 0xaa, 0xff])
  expect(custom.spriteColor).toBe('#33aaff')
  expect([custom.weeklyColor.text, custom.fiveHourColor.text]).toEqual(['#00ff00', 'suggestion'])
  expect(custom.warning.text).toBe('magenta')
  expect(settings({ bar_color_warning: 'red; drop' }).warning.text).toBe('error')
  expect(custom.empty.text).toBe('subtle')
  expect(settings({ sprite_color: 'not a colour' }).spriteRgb).toEqual(CLAUDE_ORANGE)
})

test('a sprite colour repaints the body only', async () => {
  const px = Uint8Array.fromBase64(picturesIn([0, 0, 255])('plain', 0, 0).rgba)
  const orange = Uint8Array.fromBase64(picturesIn(CLAUDE_ORANGE)('plain', 0, 0).rgba)
  expect(px.length).toBe(orange.length)
  let body = 0
  for (let i = 0; i < px.length; i += 4) {
    if (orange[i] === 215 && orange[i + 1] === 119 && orange[i + 2] === 87) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([0, 0, 255])
      body += 1
    }
  }
  expect(body > 0).toBe(true)
})

const POSE_NAMES = Object.keys(POSES) as Pose[]

// Every frame of every variant of every pose, as what a drawing is asked for.
const everyFrame = (): [Pose, number, number][] =>
  POSE_NAMES.flatMap(pose =>
    POSES[pose].variants.flatMap((_, roll) =>
      Array.from({ length: lengthOf(pose, roll) }, (_, n): [Pose, number, number] => [pose, roll, n]),
    ),
  )

test('every frame of every pose is a whole RGBA picture, and every pose has its alt', async () => {
  const bytes = PIXEL_WIDTH * PIXEL_HEIGHT * 4
  // 14 cells of two art pixels by 4 rows of four, each art pixel 5 by 5.
  expect([PIXEL_WIDTH, PIXEL_HEIGHT]).toEqual([140, 80])
  const picture = picturesIn(CLAUDE_ORANGE)
  for (const [pose, roll, n] of everyFrame()) expect(Uint8Array.fromBase64(picture(pose, roll, n).rgba).length).toBe(bytes)
  for (const pose of POSE_NAMES) expect(POSES[pose].alt.startsWith('Clawd ')).toBe(true)
})

test('no frame draws in art column 0, which neither form shows', async () => {
  for (const [scene, { variants }] of Object.entries(SCENES)) {
    variants.forEach((frames, roll) =>
      frames.forEach((art, n) => {
        for (const [form, grid] of Object.entries(art)) {
          const column = grid.map(row => row[0]).join('')
          expect(`${scene} ${roll} ${n} ${form}: ${column}`).toBe(`${scene} ${roll} ${n} ${form}: ${'.'.repeat(14)}`)
        }
      }),
    )
  }
})

// A node of the drawn band: a Text's own string is among its children.
type Drawn = { props: Record<string, unknown>; children: (Drawn | string)[] }
const nodes = (node: Drawn) => node.children.filter((child): child is Drawn => typeof child !== 'string')
const words = (node: Drawn) => node.children.filter(child => typeof child === 'string').join('')

test(
  'the body lights the same cells in the picture as in the text, one row lower for the props above',
  { options: { animate: false, random_poses: false } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    on('ui.render', core)
    on('ui.blit', () => ({ value: {} }))
    // The same frame twice: as the picture in a wide band, as text in a narrow one.
    const wide = await $.ui.mount(BAND)
    await clock.advance(1)
    const source = (await wide.find({ key: 'clawd' }))?.props.source as { rgba: string; width: number } | undefined
    await wide.unmount()
    const slim = await $.ui.mount(narrow(30))
    await clock.advance(1)
    const column = (await slim.find({ key: 'clawd-text' })) as Drawn | undefined
    await slim.unmount()
    // A text cell is the body's when it shows a block in the body's colour.
    const text = (column ? nodes(column) : []).map(row =>
      nodes(row)
        .flatMap(run => [...words(run)].map(c => (c !== ' ' && run.props.color === 'claude' ? 'x' : ' ')))
        .join(''),
    )
    // A picture cell is 10 by 20 pixels of the art, which sits in the middle of a wider
    // canvas; it is the body's when any of its pixels has the body's colour.
    const px = Uint8Array.fromBase64(source?.rgba ?? '')
    const width = source?.width ?? 0
    const isOrange = (at: number) => px[at] === 215 && px[at + 1] === 119 && px[at + 2] === 87 && px[at + 3] === 255
    // The art starts two and a half cells left of the body: the logo's arm row is `  ▝▜█████▛▘`.
    const armRow = 2 * 20 + 5
    const left = Array.from({ length: width }, (_, x) => x).find(x => isOrange((armRow * width + x) * 4))! - 25
    const isBody = (cell: number, row: number) =>
      Array.from({ length: 20 }, (_, dy) => (row * 20 + dy) * width + left + cell * 10).some(start =>
        Array.from({ length: 10 }, (_, dx) => (start + dx) * 4).some(isOrange),
      )
    const picture = [1, 2, 3].map(row => Array.from({ length: 14 }, (_, cell) => (isBody(cell, row) ? 'x' : ' ')).join(''))
    expect(picture).toEqual(text)
    expect(text.join('').includes('x')).toBe(true)
  },
)

test('a roll picks among the variants, and a pose that plays once says so', async () => {
  const picture = picturesIn(CLAUDE_ORANGE)
  expect(POSES.working.variants.length).toBe(3)
  expect(picture('working', 0, 0) === picture('working', 1, 0)).toBe(false)
  expect(picture('working', 3, 0)).toBe(picture('working', 0, 0))
  expect(POSE_NAMES.filter(pose => POSES[pose].once)).toEqual(['finished', 'interrupted', 'refused', 'failed'])
})

test('outside a turn a pose of the turn shows as rest; a compaction and an ending show', async () => {
  expect(shownPose('working', true)).toBe('working')
  expect(shownPose('working', false)).toBe('idle')
  expect(shownPose('waiting', false)).toBe('idle')
  expect(shownPose('compacting', false)).toBe('compacting')
  expect(shownPose('finished', false)).toBe('finished')
})

const rowsOf = (frame: readonly (readonly { text: string }[])[]) => frame.map(runs => runs.map(run => run.text).join(''))

test('the plain Clawd, in text, is the logo the CLI prints', async () => {
  const first = textIn('claude')('plain', 0, 0)
  expect(rowsOf(first).map(row => row.trimEnd())).toEqual(['   ▐▛███▜▌', '  ▝▜█████▛▘', '    ▘▘ ▝▝'])
  expect(first.flat().map(run => run.color)).toEqual(['claude', 'claude', 'claude'])
})

test('every pose has text frames of three whole rows, and a prop keeps its colour', async () => {
  const text = textIn('#0000ff')
  for (const [pose, roll, n] of everyFrame()) {
    expect(rowsOf(text(pose, roll, n)).map(row => row.length)).toEqual([TEXT_COLUMNS, TEXT_COLUMNS, TEXT_COLUMNS])
  }
  const colors = new Set(text('questioning', 0, 0).flat().map(run => run.color))
  expect([...colors].sort()).toEqual(['#0000ff', '#f0be3c'])
  // Equal pictures are one value, so the band can tell a frame that changes nothing.
  expect(text('questioning', 0, 0)).toBe(text('questioning', 0, 1))
})

test('a window used up reads 99%, never 100%, and its bar is full', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 100, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: ' 99%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /100%/ })).toBe(undefined)
  // 75 columns: 1, 16 for Clawd, 1, "200k " 5 (the test's context window), the bar,
  // a blank cell either side 2, " 99%" 4, " 01h-00m-00s" 12, 1 at the edge: the bar is 33,
  // its ends caps.
  expect(await ui.find({ type: 'Text', text: /^█{31}$/ })).toBeDefined()
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

test('each bar has a dim dot either side and a blank row parts each two, under an empty row on top', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 40, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  const bars = (await ui.find({ key: 'bars' })) as Drawn | undefined
  const rows = (bars ? nodes(bars) : []).map(textOf)
  // 75 columns: 1, 16 for Clawd, 1, "200k " 5, a blank cell either side of the bar 2, " 99%" 4,
  // " 00h-59m-59s" 12, 1 at the edge: the bar is 33.
  expect(rows.length).toBe(5)
  expect([rows[1], rows[3]].map(row => row?.trim())).toEqual(['', ''])
  // The label, a dot, the bar from its first cap to its last, a dot, the percentage. The
  // dots are dim: they lead the eye from a label to its bar and on to its figure.
  const framed = /^(7d {3}|5h {3}|200k )·(?:.{31}|[/ ]{33})· +(\d+%|--|[-\\|/])/
  expect([rows[0], rows[2], rows[4]].map(row => framed.test(row ?? ''))).toEqual([true, true, true])
  expect((await ui.find({ type: 'Text', text: '·' }))?.props.dimColor).toBe(true)
  // The band's first row is empty to the eye, so it stands clear of the line above it: it holds
  // only the one-cell picture the terminal is asked through, whose alt is a space.
  const top = (await ui.find({ key: 'band' })) as Drawn | undefined
  const first = top?.children[0] as { type?: string; props: Record<string, unknown> } | undefined
  expect([first?.type, first?.props.columns, first?.props.rows, first?.props.alt]).toEqual(['Image', 1, 1, ' '])
  await ui.unmount()
})

test('the band draws the sprite, both bars and the countdown', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
  // No refresh buttons and no row icons: the countdown follows the percent.
  expect(await ui.find({ type: 'Button' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /[↻☀❄]/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '--' })).toBeDefined()
  expect(await ui.find({ key: 'model' })).toBeDefined()
  await ui.unmount()
})

test('show_model off drops the model line', { options: { show_model: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ key: 'model' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeDefined()
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

test('the band yields to a survey', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'survey' })).toBeDefined()
  await ui.unmount()
})

test('a window that has reset reads 0% with no reset time', async () => {
  const now = NOW
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(resetExpired(usage, now)).toEqual({ fiveHour: { percentUsed: 0, resetsAt: null }, sevenDay: usage.sevenDay })
  expect(resetExpired(null, now)).toBe(null)
})

test('a reading missing a window keeps the last one', async () => {
  const current = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  const merged = mergeUsage(current, toUsage([{ kind: 'seven_day', percentUsed: 33, resetsAt: '2026-10-14T00:00:00Z' }]))
  expect(merged?.fiveHour).toEqual(current.fiveHour)
  expect(merged?.sevenDay?.percentUsed).toBe(33)
  expect(mergeUsage(current, toUsage([]))).toEqual(current)
})

test('readings compare by percent and reset time', async () => {
  const usage = {
    fiveHour: { percentUsed: 1, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(sameUsage(usage, { ...usage })).toBe(true)
  expect(sameUsage(usage, { ...usage, fiveHour: { percentUsed: 1, resetsAt: '2026-10-11T19:00:00Z' } })).toBe(false)
  expect(sameUsage(null, usage)).toBe(false)
  expect(sameUsage(null, undefined)).toBe(true)
})

test('a new reset time at the same percent shows after the turn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let resetsAt = '2026-10-11T14:00:00Z'
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 1, resetsAt }]))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: '--h---m---s' })).toBeDefined()
  // The window reset and a request opened a new one, still at 1%: no session.measure.
  resetsAt = '2026-10-11T19:00:00Z'
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /^03h-59m-5\ds$/ })).toBeDefined()
  await ui.unmount()
})

test('expired windows make the key one fetch on reset answers', async () => {
  const now = NOW
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(expiredKey(usage, now)).toBe('2026-10-11T14:00:00Z')
  expect(expiredKey({ ...usage, fiveHour: { percentUsed: 0, resetsAt: null } }, now)).toBe(null)
  expect(expiredKey(null, now)).toBe(null)
})

const accountUsage = (fiveHour: string | null) =>
  JSON.stringify({
    five_hour: fiveHour ? { utilization: 1, resets_at: fiveHour } : null,
    seven_day: { utilization: 31, resets_at: '2026-10-14T00:00:00Z' },
  })

test('a window that runs out mid-session is fetched again, no reply needed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let next: string | null = '2026-10-11T15:00:10Z'
  let fetches = 0
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ value: { kind: 'bearer', handle: 'test' } }))
  on('http.fetch', () => {
    fetches += 1
    return { value: { status: 200, ok: true, headers: {}, text: accountUsage(next) } }
  })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(fetches).toBe(1) // the startup fetch
  // The window runs out at 15:00:10; the account has the next one a few seconds later.
  next = '2026-10-11T20:00:10Z'
  await clock.advance(20_000)
  expect(fetches).toBe(2)
  expect(await ui.find({ type: 'Text', text: /^04h-59m-\d\ds$/ })).toBeDefined()
  await ui.unmount()
})

// A signed-in session whose account request is answered by `answer`; resolves
// to how many requests were made.
const account = (on: On, answer: () => { status: number; text: string }) => {
  const count = { fetches: 0 }
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ value: { kind: 'bearer', handle: 'test' } }))
  on('ui.log', () => ({ value: undefined }))
  on('http.fetch', () => {
    count.fetches += 1
    const { status, text } = answer()
    return { value: { status, ok: status === 200, headers: {}, text } }
  })
  on('ui.render', core)
  return count
}

test('an answer with no open window is not asked for again', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let next: string | null = '2026-10-11T15:00:10Z'
  const count = account(on, () => ({ status: 200, text: accountUsage(next) }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  // Nothing is sent after the reset, so the account has no five-hour window.
  next = null
  await clock.advance(30 * 60_000)
  expect(count.fetches).toBe(1 + 1)
  await ui.unmount()
})

test('a request that fails is tried again, five times at most', STILL_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const count = account(on, () => ({ status: 500, text: '' }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(30 * 60_000)
  expect(count.fetches).toBe(5)
  await ui.unmount()
})

test('a first request that fails and then works fills the bars without a reply', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let status = 500
  const count = account(on, () => ({ status, text: accountUsage('2026-10-11T18:00:00Z') }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: ' 31%' })).toBe(undefined)
  status = 200
  await clock.advance(65_000)
  expect(count.fetches).toBe(2)
  expect(await ui.find({ type: 'Text', text: ' 31%' })).toBeDefined()
  await ui.unmount()
})

test('a 429 ends the tries', STILL_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const count = account(on, () => ({ status: 429, text: '' }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(30 * 60_000)
  expect(count.fetches).toBe(1)
  await ui.unmount()
})

// No reply, no request, no write: only the clock moves, and the band with it.
test('a countdown moves on each second with nothing else happening', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, {
    usage: {
      fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
      sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
    },
  })
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: '02h-59m-59s' })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: '02h-59m-58s' })).toBeDefined()
  await ui.unmount()
})

// The session's figure comes with no word of its change: the next second shows it.
test('a context that fills with no reply shows on the next second', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let percent = 10
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf([], { window: 200_000, percent }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /^ *10%$/ })).toBeDefined()
  percent = 40
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /^ *40%$/ })).toBeDefined()
  await ui.unmount()
})

test("another session's newer reading shows without a reply or a request", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const reading = (percentUsed: number, readAt: number) => ({
    fiveHour: { percentUsed, resetsAt: '2026-10-11T18:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
    readAt,
  })
  let stored = reading(40, NOW - 1000)
  on('store.get', ($, e) => ({ value: e.key === 'usage' ? stored : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: ' 40%' })).toBeDefined()
  // Another session stores what its reply reported.
  stored = reading(42, NOW + 2000)
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: ' 42%' })).toBeDefined()
  await ui.unmount()
})

test('the account is asked only while the reading is not live', async () => {
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(askKey(null, false, NOW)).toBe('none')
  expect(askKey(usage, false, NOW)).toBe('2026-10-11T14:00:00Z')
  const live = { ...usage, fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' } }
  expect(askKey(live, false, NOW)).toBe(null)
  expect(askKey(live, true, NOW)).toBe('stale')
})

// kitty fits a picture into its box whole, its pixels square: the scale is
// whichever of width and height runs out first. Cells are `aspect` times as
// tall as wide; one cell is 10 pixels wide here.
const kittyFit = (box: { columns: number; rows: number }, source: { width: number; height: number }, aspect: number) => {
  const scale = Math.min((box.columns * 10) / source.width, (box.rows * 10 * aspect) / source.height)
  return { width: source.width * scale, height: source.height * scale, boxWidth: box.columns * 10, boxHeight: box.rows * 10 * aspect }
}

test(
  'at the cell ratio set the fitted picture is its whole box; on squatter cells it still fills its rows',
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    on('ui.render', core)
    on('ui.blit', () => ({ value: {} }))
    const ui = await $.ui.mount(BAND)
    await clock.advance(1)
    const props = (await ui.find({ key: 'clawd' }))?.props as {
      columns: number
      rows: number
      source: { width: number; height: number }
    }
    expect(props.rows).toBe(3)
    // kitty draws the picture whole with square pixels, centred in its box (measured on kitty
    // 0.50); the engine's types say it is scaled to fill the box. Within half a pixel, the two
    // are one picture at the ratio set. Squatter cells leave room beside it; taller ones over it.
    const fit = (aspect: number) => {
      const { width, height, boxWidth, boxHeight } = kittyFit(props, props.source, aspect)
      return [Math.abs(width - boxWidth) < 0.5, Math.abs(height - boxHeight) < 0.5]
    }
    expect([2, 2.34, 2.6].map(fit)).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ])
    await ui.unmount()
  },
)

test('the bars take every cell left, with a one-cell gap either side of Clawd', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  // Fixed: Clawd's box 16, "5h " 3, a blank cell either side of the bars 2, " 99%" 4,
  // " 04h-59m-59s" 12, one cell at the right edge, and the gaps before and after Clawd at 1
  // each: 40. The bars take the rest.
  for (const [columns, bar, before, after] of [
    [75, 35, 1, 1],
    [80, 40, 1, 1],
    [100, 60, 1, 1],
    [120, 80, 1, 1],
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
  on('ui.render', core)
  let refuse = false
  on('ui.blit', () => ({ value: refuse ? { deny: 'the Image draws its alt here: no pictures in a test' } : {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  // 75 columns: 1, 16 for Clawd, 1 gap, "5h ", a blank cell either side of the bar, " 99%",
  // " 04h-59m-59s", 1 at the edge leave 35, and the bar takes them all. The five-hour bar, empty: the weekly one has marks.
  const empty = () => emptyBar(ui)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await empty()).toBe(35)
  refuse = true
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await empty()).toBe(35)
  await ui.unmount()
})

test('both forms of Clawd sit on the same centre of his column', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  let refuse = false
  on('ui.blit', () => ({ value: refuse ? { deny: 'the Image draws its alt here: no pictures in a test' } : {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  // Where Clawd's box starts in his 16-cell column, pinned to its left so the margin is all the offset.
  const placed = async () => {
    const place = (await ui.find({ key: 'clawd-place' }))?.props
    return [place?.alignSelf, place?.marginLeft]
  }
  // The picture's box is 16 cells: centre 8. The text Clawd is the CLI logo's 14: 1 in, centre 8.
  expect(await placed()).toEqual(['flex-start', 0])
  refuse = true
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await placed()).toEqual(['flex-start', 1])
  await ui.unmount()
})

// The band at a given width, Clawd drawn as a picture.
const narrow = (bodyColumns: number) => ({ ...BAND, props: { ...BAND.props, bodyColumns } })

test('a band too narrow for whole countdowns shows their two biggest units', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(41))
  await clock.advance(1)
  // 41 cells: 1, 16 for Clawd, 1 gap, "5h ", 5 of bar and its 2 blank cells, " 99%", " --h---m", 1 at the edge.
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /--h---m---s/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /--h---m$/ }))?.text).toBe('--h---m')
  expect(await emptyBar(ui)).toBe(5)
  await ui.unmount()
})

test('narrower still, the countdowns go and the bars keep the room', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(34))
  await clock.advance(1)
  // 34 cells: 1, 16 for Clawd, 1 gap, "5h ", 6 of bar and its 2 blank cells, " 99%", 1 at the edge.
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /--[hd]/ })).toBe(undefined)
  expect(await emptyBar(ui)).toBe(6)
  await ui.unmount()
})

test('narrower again, Clawd turns to the 14-cell text and the bars keep the room', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(31))
  await clock.advance(1)
  // 31 cells: 1, 14 for Clawd in text, 1 gap, "5h ", 5 of bar and its 2 blank cells, " 99%", 1 at the edge.
  // The 16-cell picture would leave the bar 3, under its least.
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBeDefined()
  expect(await emptyBar(ui)).toBe(5)
  await ui.unmount()
})

test('in a band too narrow for the picture, no picture is sent and the text Clawd moves', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  let blits = 0
  on('ui.blit', (_, e) => {
    // Clawd's own pictures: the band's probe is swapped beside them.
    if (e.key === 'clawd') blits += 1
    return { value: {} }
  })
  const ui = await $.ui.mount(narrow(30))
  await clock.advance(2000)
  // Two loops of the mug's four frames, wherever in the loop the first falls.
  const shut: boolean[] = []
  for (let frame = 0; frame < 8; frame++) {
    shut.push((await ui.find({ type: 'Text', text: '▐█████▌' })) !== undefined)
    await clock.advance(400)
  }
  expect(shut.filter(Boolean).length).toBe(4)
  expect(blits).toBe(0)
  await ui.unmount()
})

test('Clawd keeps moving while a question waits on the person', { options: { random_poses: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  const sent: string[] = []
  on('ui.blit', ($, e) => {
    if ('source' in e && 'rgba' in e.source) sent.push(e.source.rgba)
    return { value: {} }
  })
  // The question stays open until the person answers it.
  let answer = () => {}
  on('tool.call', () => new Promise(resolve => (answer = () => resolve(DONE))))
  // A question comes mid-turn: outside one, a turn's poses show as rest.
  const ui = await $.ui.mount(WORKING_BAND)
  await clock.advance(1)
  const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await clock.advance(1)
  const before = sent.length
  const poses = await posesOver(ui, clock, 8)
  // The picture stays up, the asking pose plays, and its frames go on changing.
  expect(poses.every(pose => pose === 'questioning')).toBe(true)
  expect(new Set(sent.slice(before)).size >= 2).toBe(true)
  answer()
  await asked
  await ui.unmount()
})

test('a picture that has not changed is not sent again', { options: { animate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  let blits = 0
  on('ui.blit', (_, e) => {
    // Clawd's own pictures: the band's probe is swapped beside them.
    if (e.key === 'clawd') blits += 1
    return { value: {} }
  })
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  expect(blits).toBe(1)
  await ui.unmount()
})

test('a picture the band refused is sent again on the next tick', { options: { animate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  let blits = 0
  on('ui.blit', (_, e) => {
    if (e.key !== 'clawd') return { value: {} }
    blits += 1
    return { value: blits === 1 ? { deny: 'no band to draw in yet' } : {} }
  })
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  expect(blits).toBe(2)
  await ui.unmount()
})

test('narrowest, Clawd hides; the model line stays and the bars keep the room', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(narrow(23))
  await clock.advance(1)
  // 23 cells: 1, "--" for the model not yet known, 1 gap, "5h ", 9 of bar and its 2 blank cells, " 99%", 1 at the edge.
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
  // 18 cells: 1, "--", 1 gap, "5h ", 4 of bar and its 2 blank cells, " 99%", 1 at the edge. One
  // fewer and no row fits.
  for (const [columns, shows] of [
    [18, true],
    [17, false],
  ] as const) {
    const ui = await $.ui.mount(narrow(columns))
    await clock.advance(1)
    const drawn = [await ui.find({ key: 'bars' }), await ui.find({ type: 'Text' })].map(node => node !== undefined)
    expect([columns, ...drawn]).toEqual([columns, shows, shows])
    await ui.unmount()
  }
})

test('a terminal that refuses the picture gets the text Clawd', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: { deny: 'the Image draws its alt here: no pictures in a test' } }))
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBeDefined()
  await ui.unmount()
})

test('the text Clawd moves: resting with a mug, the eyes are shut half the time', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: { deny: 'the Image draws its alt here: no pictures in a test' } }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  // Two loops of the mug's four frames, wherever in the loop the first falls.
  const shut: boolean[] = []
  for (let frame = 0; frame < 8; frame++) {
    shut.push((await ui.find({ type: 'Text', text: '▐█████▌' })) !== undefined)
    await clock.advance(400)
  }
  expect(shut.filter(Boolean).length).toBe(4)
  await ui.unmount()
})

test('the account usage response gives both windows', async () => {
  const limits = parseAccountUsage(
    JSON.stringify({
      five_hour: { utilization: 2.04, resets_at: '2026-10-15T22:10:00.412345+00:00' },
      seven_day: { utilization: 30, resets_at: '2026-10-18T03:00:00+00:00' },
      seven_day_opus: null,
    }),
  )
  expect(limits).toEqual([
    { kind: 'five_hour', percentUsed: 2, resetsAt: '2026-10-15T22:10:00.412345+00:00' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00+00:00' },
  ])
  expect(parseAccountUsage(JSON.stringify({ five_hour: null, seven_day: { utilization: 5 } }))).toEqual([
    { kind: 'seven_day', percentUsed: 5, resetsAt: undefined },
  ])
  expect(parseAccountUsage('not json')).toEqual([])
})

test('a new session id (a /clear) loads the usage again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let id = 'before-clear'
  on('session.id', () => ({ value: id }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('session.usage', () =>
    usageOf(id === 'before-clear' ? [] : [{ kind: 'seven_day', percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' }]),
  )
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: ' 31%' })).toBe(undefined)
  id = 'after-clear'
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: ' 31%' })).toBeDefined()
  await ui.unmount()
})

test('at startup a cached 5h window that has reset shows 0%, not --', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, {
    usage: {
      fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
      sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
    },
  })
  // A context reading too, so no row of the band reads `--`.
  on('session.usage', () => usageOf([], { window: 1_000_000, tokens: 50_000, percent: 5 }))
  on('ui.render', core)
  const first = await $.ui.mount(BAND)
  await clock.advance(1)
  await first.unmount()
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: ' 31%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '   --' })).toBe(undefined)
  await ui.unmount()
})

// Every pose the mod writes, in order. A write the store turns down for its
// version is made again, and counts once.
const posesWritten = (on: On): unknown[] => {
  const poses: unknown[] = []
  on('state.set', { key: 'pose' }, async ($, e, next) => {
    const result = await next(e)
    if ('value' in result && result.value?.isSet) poses.push(e.value)
    return result
  })
  return poses
}

const TURN_END = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const

// The frames of a pose's longest variant: which one plays is rolled.
const longest = (pose: Pose): number => Math.max(...POSES[pose].variants.map(variant => variant.length))

test('a turn sets Clawd waiting for its first reply; its end plays once, then he rests', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete(TURN_END)
  expect(poses).toEqual(['waiting', 'finished'])
  await clock.advance(400 * (longest('finished') + 1))
  expect(poses).toEqual(['waiting', 'finished', 'idle'])
})

test('how a turn ended picks its ending', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ ...TURN_END, isAborted: true, reason: 'aborted' })
  await $.turn.complete({ ...TURN_END, reason: 'error' })
  await $.turn.complete({ ...TURN_END, reason: 'refusal', refusal: { category: null, explanation: null } })
  expect(poses).toEqual(['interrupted', 'failed', 'refused'])
})

test('a subagent turn changes nothing; its tool gets a glance, then the pose goes back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.start({ text: 'look', turnId: 't2', agentId: 'agent-1' })
  await $.turn.complete({ ...TURN_END, turnId: 't2', agentId: 'agent-1' })
  expect(poses).toEqual(['waiting'])
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'agent-1' })
  expect(poses).toEqual(['waiting', 'running'])
  await clock.advance(1100)
  expect(poses).toEqual(['waiting', 'running', 'waiting'])
})

test('a glance at a subagent does not undo a newer pose', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'agent-1' })
  await $.turn.complete(TURN_END)
  await clock.advance(1100)
  expect(poses).toEqual(['running', 'finished'])
})

test('a tool that ends after the turn leaves the ending be', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async () => {
    await $.turn.complete({ ...TURN_END, isAborted: true, reason: 'aborted' })
    return { result: { stdout: '', stderr: '', interrupted: true } }
  })
  await $.tool.call({ tool: 'Bash', command: 'sleep 60' })
  expect(poses).toEqual(['running', 'interrupted'])
})

const SPINNER = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'Spinner',
  props: { word: 'Working', message: null, suffix: '', mode: 'requesting' },
} as const

test('the spinner saying it compacts sets the pose, and its end takes it back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  const poses = posesWritten(on)
  // The engine counts a compaction as work under way.
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })
  const plain = await $.ui.mount(SPINNER)
  await plain.unmount()
  await clock.advance(1)
  expect(poses).toEqual([])
  const busy = await $.ui.mount({ ...SPINNER, props: { ...SPINNER.props, message: 'Compacting conversation' } })
  await busy.unmount()
  await clock.advance(1)
  expect(poses).toEqual(['compacting'])
  const after = await $.ui.mount(SPINNER)
  await after.unmount()
  await clock.advance(1)
  expect(poses).toEqual(['compacting', 'waiting'])
  await band.unmount()
})

test('the reply stream: waiting, then thinking, working and the tool pose', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on) // the step also stores the model it names
  const poses = posesWritten(on)
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: '' }
    yield { kind: 'text', index: 1, text: '' }
    yield { kind: 'tool', index: 2, id: 'tool-1', name: 'Grep' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const chunk of stream) expect(chunk.kind).toBeDefined()
  expect(poses).toEqual(['waiting', 'thinking', 'working', 'reading'])
})

test('a tool call holds its pose while it runs, then Clawd waits for the next reply', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  let during: unknown[] = []
  on('tool.call', () => {
    during = [...poses]
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(during).toEqual(['running'])
  expect(poses).toEqual(['running', 'waiting'])
})

const DONE = { result: { stdout: '', stderr: '', interrupted: false } }

test('a tool that ends beside one still running hands the pose to it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash') await clock.sleep(1000)
    return DONE
  })
  const long = $.tool.call({ tool: 'Bash', command: 'sleep 1' })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: 'x' })
  expect(poses).toEqual(['running', 'reading', 'running'])
  await clock.advance(1000)
  await long
  expect(poses).toEqual(['running', 'reading', 'running', 'waiting'])
})

test("a subagent's tool call leaves the turn's ending be", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => DONE)
  await $.turn.complete(TURN_END)
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'agent-1' })
  await clock.advance(1100)
  expect(poses).toEqual(['finished'])
})

// The band of a turn under way: a turn's poses show only then.
const WORKING_BAND = { ...BAND, props: { ...BAND.props, isWorking: true } }

// The pose on screen after each of the next ticks, read from the alt text of
// Clawd's picture: a picture goes out only when it changes, so the pictures
// sent do not count the ticks. `first` is how far off the first tick is.
const ALT_POSES = new Map(Object.entries(SCENES).map(([scene, { alt }]) => [alt, scene]))
type Screen = { find: (query: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }
const posesOver = async (ui: Screen, clock: { advance: (ms: number) => Promise<unknown> }, ticks: number, first = 400) => {
  const poses: (string | undefined)[] = []
  for (let tick = 0; tick < ticks; tick++) {
    await clock.advance(tick === 0 ? first : 400)
    poses.push(ALT_POSES.get(String((await ui.find({ key: 'clawd' }))?.props.alt)))
  }
  return poses
}

// One reply that thinks, writes a line and calls Read, all within one tick.
const replyOf = (on: On) =>
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: '' }
    yield { kind: 'text', index: 1, text: '' }
    yield { kind: 'tool', index: 2, id: 'tool-1', name: 'Read' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })

test('a burst of poses within a tick reaches the screen as one change, after the hold', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.render', core)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', () => DONE)
  replyOf(on)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(WORKING_BAND)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    expect(chunk.kind).toBeDefined()
  }
  await $.tool.call({ tool: 'Read', file_path: 'x' })
  // Eleven ticks: the first comes with the timer's start.
  const shown = await posesOver(ui, clock, 11, 1)
  const four = (name: string) => [name, name, name, name]
  // Neither thinking nor working showed; waiting came back only after the tool's pose had its turn.
  expect(shown).toEqual([...four('waiting'), 'plain', ...four('reading'), 'plain', 'waiting'])
  await ui.unmount()
})

// Without the roll, the ending and the rest after it are each pose's first variant.
const FIRST_VARIANTS = { options: { random_poses: false } }

test('an ending cuts in on the screen mid-loop and plays through to rest', FIRST_VARIANTS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(WORKING_BAND)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  const seen = await posesOver(ui, clock, 3, 1)
  await $.turn.complete({ ...TURN_END, isAborted: true, reason: 'aborted' })
  // Drawn at once, before any tick.
  const drawn = await ui.find({ key: 'clawd' })
  expect(drawn?.props.alt).toBe(POSES.interrupted.alt)
  const length = lengthOf('interrupted', 0)
  seen.push(...(await posesOver(ui, clock, length + 1)))
  expect(seen).toEqual(['waiting', 'waiting', 'waiting', ...Array(length).fill('interrupted'), 'idle'])
  await ui.unmount()
})

test('a compaction shows after the hold, and waiting follows its end', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(WORKING_BAND)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  const busy = await $.ui.mount({ ...SPINNER, props: { ...SPINNER.props, message: 'Compacting conversation' } })
  await busy.unmount()
  expect(await posesOver(ui, clock, 7, 1)).toEqual([
    'waiting',
    'waiting',
    'waiting',
    'waiting',
    'plain',
    'compacting',
    'compacting',
  ])
  const after = await $.ui.mount(SPINNER)
  await after.unmount()
  // The pose lingers while waiting is new, then gives way to it.
  expect(await posesOver(ui, clock, 6)).toEqual(['compacting', 'compacting', 'compacting', 'compacting', 'plain', 'waiting'])
  await ui.unmount()
})

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
