import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { BAND, core, imageOf, NOW, pixelOf, usageOf } from './kit'
import { pill } from './pill'
import { settings } from './settings'

const ORANGE = [215, 119, 87, 255]

test(
  "Clawd's picture has the shape of its box of cells, so fitting it in and stretching it draw the same Clawd",
  { options: { cell_ratio: '2.34' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    on('ui.render', core)
    on('ui.blit', () => ({ value: {} }))
    const ui = await $.ui.mount(BAND)
    await clock.advance(1)
    const clawd = await imageOf(ui, 'clawd')
    // 16 cells by 3, each 2.34 times as tall as wide, is 16 : 7.02. At 80 pixels high that is 182 wide.
    expect([clawd?.columns, clawd?.rows, clawd?.source.width, clawd?.source.height]).toEqual([16, 3, 182, 80])
    await ui.unmount()
  },
)

test('Clawd is as tall as the three pill bars and stands level with them, the model line under him', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  const bars = (await ui.find({ key: 'bars' })) as { children?: unknown[] } | undefined
  expect([(await imageOf(ui, 'clawd'))?.rows, bars?.children?.length]).toEqual([3, 3])
  // Both start at the top of the row they share, so the model line is the one row under them.
  expect((await ui.find({ key: 'beside' }))?.props.alignItems).toBe('flex-start')
  await ui.unmount()
})

test("Clawd's body stands on the middle of his picture", { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  const clawd = (await imageOf(ui, 'clawd'))!
  // The row of his arms, the widest of him: 16 art pixels of 5, so 80 of the canvas's 182.
  const y = 45
  const body = Array.from({ length: clawd.source.width }, (_, x) => x).filter(x => pixelOf(clawd, x, y).join() === ORANGE.join())
  const [first, last] = [body[0]!, body[body.length - 1]!]
  // 102 pixels are left over: 51 before him and 51 after.
  expect([first, clawd.source.width - 1 - last]).toEqual([51, 51])
  await ui.unmount()
})

const NO_PICTURES = { deny: 'the Image draws its alt here: no pictures in a test' }

test('a terminal that draws pictures again gets the picture back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  let refuse = true
  on('ui.blit', () => ({ value: refuse ? NO_PICTURES : {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ key: 'clawd-text' })).toBeDefined()
  refuse = false
  // It is asked once a second, on a tick.
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ key: 'clawd-text' })).toBe(undefined)
  await ui.unmount()
})

test('a terminal that refuses pictures gets the bars in text, a blank row between each two', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: NO_PICTURES }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  expect(await ui.find({ key: 'bar-5h' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
  // Three bars and the two blank rows that part them.
  const bars = (await ui.find({ key: 'bars' })) as { children?: unknown[] } | undefined
  expect(bars?.children?.length).toBe(5)
  await ui.unmount()
})

test('with Clawd off the pill bars still ask the terminal, and follow its answer', { options: { sprite: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  let refuse = true
  on('ui.blit', () => ({ value: refuse ? NO_PICTURES : {} }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  expect(await ui.find({ key: 'bar-5h' })).toBe(undefined)
  expect(await ui.find({ key: 'probe' })).toBeDefined()
  refuse = false
  await clock.advance(2000)
  expect(await ui.find({ key: 'bar-5h' })).toBeDefined()
  await ui.unmount()
})

// A band of 71 columns: beside Clawd's 16 its bars are 29 cells.
const PILLS = { ...BAND, props: { ...BAND.props, bodyColumns: 69 } }

// That band, its five-hour window used by `percent`.
const withFiveHour = (on: On, percent: number) => {
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: percent, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
}

test('a bar is a picture the shape of its cells', { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withFiveHour(on, 40)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bar = await imageOf(ui, 'bar-5h')
  // 29 cells by 1, each 2.34 times as tall as wide, is 29 : 2.34. At 28 pixels high that is 347 wide.
  expect([bar?.columns, bar?.rows, bar?.source.width, bar?.source.height]).toEqual([29, 1, 347, 28])
  expect(bar?.alt).toBe('5h 40%')
  await ui.unmount()
})

test('in a very wide window a bar stays a picture an Image takes', { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withFiveHour(on, 40)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 330 } })
  await clock.advance(1)
  const bar = await imageOf(ui, 'bar-5h')
  // An Image is at most 255 cells and 2048 pixels across. 255 cells at 28 pixels a row would be
  // 3051 across; at 18 a row they are 255 x 18 / 2.34 = 1962.
  expect([bar?.columns, bar?.rows, bar?.source.width, bar?.source.height]).toEqual([255, 1, 1962, 18])
  await ui.unmount()
})

// What a pixel of a bar shows, by the dark theme's colours: the bar's own, the empty part's, or nothing.
const KINDS: Record<string, string> = {
  '177,185,249': 'fill',
  '175,135,255': 'fill',
  '153,153,153': 'track',
  '255,107,128': 'warn',
}
const kindAt = (bar: NonNullable<Awaited<ReturnType<typeof imageOf>>>, x: number, y: number): string => {
  const [red, green, blue, solid] = pixelOf(bar, x, y)
  return solid === 0 ? 'clear' : (KINDS[[red, green, blue].join()] ?? `rgba(${[red, green, blue, solid].join()})`)
}

test('the fill lies inside the bar, a clear ring between it and the edge', { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withFiveHour(on, 50)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bar = (await imageOf(ui, 'bar-5h'))!
  // 347 by 28 pixels, every line 2 thick. Along the middle: air, the edge, the ring, the fill;
  // where the fill ends, at half of 347 less the lines round it, the ring again and the empty part.
  expect([1, 3, 5, 7, 166, 168, 170, 340].map(x => kindAt(bar, x, 14))).toEqual([
    'clear',
    'track',
    'clear',
    'fill',
    'fill',
    'clear',
    'track',
    'track',
  ])
  // The bar's own ends are round: its corners are clear.
  expect([kindAt(bar, 0, 0), kindAt(bar, 346, 27)]).toEqual(['clear', 'clear'])
  await ui.unmount()
})

// The same band, its weekly window used by `percent` and resetting in `days`.
const withWeekly = (on: On, percent: number, days: number) => {
  const resetsAt = new Date(NOW + days * 86_400_000).toISOString()
  on('session.usage', () => usageOf([{ kind: 'seven_day', percentUsed: percent, resetsAt }]))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
}

test("a clear hairline parts the weekly bar's days, through the fill and the empty part alike", { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withWeekly(on, 34, 6)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bar = (await imageOf(ui, 'bar-7d'))!
  // 347 pixels in seven days: the days meet at 49.6, 99.1, 148.7, 198.3, 247.9 and 297.4, and a
  // line 2 thick about each covers these pixels whole, from the bar's top edge to its bottom.
  const lines = [49, 99, 148, 198, 247, 297]
  expect([3, 14, 24].flatMap(y => lines.map(x => kindAt(bar, x, y)))).toEqual(Array.from({ length: 18 }, () => 'clear'))
  // Beside the first line the fill goes on; beside the fourth, the empty part.
  expect([47, 52, 195, 201].map(x => kindAt(bar, x, 14))).toEqual(['fill', 'fill', 'track', 'track'])
  await ui.unmount()
})

test("the weekly bar's last three days warn in the picture too: its empty part and its edge", { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // 85% used with two days to go: ahead of time, within the last three days.
  withWeekly(on, 85, 2)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bar = (await imageOf(ui, 'bar-7d'))!
  // The last three days start at four sevenths of 347, 198.3. The fill ends at 295.
  expect([150, 250].map(x => kindAt(bar, x, 2))).toEqual(['track', 'warn'])
  expect([250, 300, 340].map(x => kindAt(bar, x, 14))).toEqual(['fill', 'warn', 'warn'])
  await ui.unmount()
})

test("a bar's empty part is see-through, its fill solid", { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withFiveHour(on, 50)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bar = (await imageOf(ui, 'bar-5h'))!
  // The dark theme's grey at two fifths solid, 102 of 255; the bar's own colour whole.
  expect(pixelOf(bar, 340, 14)).toEqual([153, 153, 153, 102])
  expect(pixelOf(bar, 100, 14)).toEqual([177, 185, 249, 255])
  await ui.unmount()
})

test('a hex colour says itself how solid the empty part is', () => {
  const emptyOf = (color: string) => settings({ bar_color_empty: color }).empty.rgba
  // Six digits are solid; two more are how solid, 0x40 a quarter. A theme key stays see-through.
  expect(emptyOf('#808080')).toEqual([128, 128, 128, 255])
  expect(emptyOf('#80808040')).toEqual([128, 128, 128, 64])
  expect(emptyOf('success')).toEqual([78, 186, 101, 102])
  // The colours of what is used, and of the days that warn, are solid.
  expect(settings({}).warning.rgba).toEqual([255, 107, 128, 255])
})

test('an unused window has no fill', { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withFiveHour(on, 0)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bar = (await imageOf(ui, 'bar-5h'))!
  expect([5, 14, 100].map(x => kindAt(bar, x, 14))).toEqual(['track', 'track', 'track'])
  await ui.unmount()
})

test('the least use shows as a round dot: a fill starts and ends with an arc', { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withFiveHour(on, 1)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bar = (await imageOf(ui, 'bar-5h'))!
  // 1% of 347 pixels is under 4, but the fill is as long as its row is high, 28: a circle of
  // radius 8 about (14, 14), the ring round it to 10, the edge to 12, then air.
  const across = ['clear', 'track', 'clear', 'fill', 'fill', 'fill', 'clear', 'track']
  expect([1, 3, 5, 7, 14, 21, 23, 25].map(x => kindAt(bar, x, 14))).toEqual(across)
  expect([1, 3, 5, 7, 14, 21, 23, 25].map(y => kindAt(bar, 14, y))).toEqual(across)
  await ui.unmount()
})

test('pill bars sit in rows one under the other, a little air over and under each', { options: { cell_ratio: '2.34' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  withFiveHour(on, 50)
  const ui = await $.ui.mount(PILLS)
  await clock.advance(1)
  const bars = (await ui.find({ key: 'bars' })) as { children?: unknown[] } | undefined
  // Three bars, three rows: no blank row between two.
  expect(bars?.children?.length).toBe(3)
  const bar = (await imageOf(ui, 'bar-5h'))!
  // Down through the fill, 28 pixels: 2 of air, then edge, ring, fill, ring, edge, and 2 of air.
  expect([0, 1, 2, 4, 6, 14, 21, 23, 25, 26, 27].map(y => kindAt(bar, 60, y))).toEqual([
    'clear',
    'clear',
    'track',
    'clear',
    'fill',
    'fill',
    'fill',
    'clear',
    'track',
    'clear',
    'clear',
  ])
  await ui.unmount()
})

const SILVER = [190, 195, 205, 255]

test('a pill still loading is silver slashes that move a step a frame and come round in four, with none of the fill', () => {
  const spec = { columns: 12, ratio: 2.2, percent: 0, segments: 1, warned: 0, fill: [255, 0, 0, 255], track: [30, 30, 30, 102], warn: [0, 255, 0, 255] }
  const count = (rgba: string, colour: number[]): number => {
    const bytes = Uint8Array.fromBase64(rgba)
    let found = 0
    for (let at = 0; at < bytes.length; at += 4) if (colour.every((value, channel) => bytes[at + channel] === value)) found++
    return found
  }
  const frames = [0, 1, 2, 3, 4].map(loading => pill({ ...spec, loading } as never).rgba)
  expect(count(frames[0] ?? '', SILVER)).toBeGreaterThan(50)
  expect(count(frames[0] ?? '', [255, 0, 0, 255])).toBe(0)
  expect(new Set(frames.slice(0, 4)).size).toBe(4)
  expect(frames[4]).toBe(frames[0])
})
