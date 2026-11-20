import { expect, mock, test } from 'claude-code/testing'

import { CLAUDE_ORANGE } from '../hooks/color'
import { lengthOf, picturesIn, PIXEL_HEIGHT, PIXEL_WIDTH, POSES, SCENES, TEXT_COLUMNS, textIn } from '../hooks/sprite'
import type { Pose } from '../types'
import { BAND, core, type Drawn, narrow, nodes, NOW, words } from './band.fixtures'

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
    const slim = await $.ui.mount(narrow(28))
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

test('in a band too narrow for the picture, no picture is sent and the text Clawd moves', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  let blits = 0
  on('ui.blit', (_, e) => {
    // Clawd's own pictures: the band's probe is swapped beside them.
    if (e.key === 'clawd') blits += 1
    return { value: {} }
  })
  const ui = await $.ui.mount(narrow(28))
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
