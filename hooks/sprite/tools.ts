// Running a command and searching the web.
import { type Loop, type Spots, type Body, type Art, stamp, fill, tall, dots, marks, TOP, SIDE, scene, art, HOP } from './core.ts'

// Running: he runs, a stride then a bound, speed lines and dust behind him.
const stride = (pose: Body): Art => art(dots(scene({ ...pose, legs: 'stride' }, [['ww'], 1, 6], [['ww'], 1, 10]), [[3, 13], [1, 12]], 'm'))
const bound = art(scene({ y: HOP }, [['ww'], 1, 4], [['ww'], 1, 8]))
export const running: Loop<Art> = [stride({ left: 'up' }), bound, stride({ right: 'up' }), bound]

// Running, at a prompt: a ">" and a cursor, the command typed out, then what it printed.
const typed = (chars: number, output: number, pose: Body = {}): Art => {
  const picture = scene({ eyes: 'right', ...pose }, [fill(6, 8, 'd'), SIDE - 1, 4], [['mmmmmm'], SIDE - 1, 3], [['c ', ' c', 'c '], SIDE, 5])
  stamp(picture, ['w'.repeat(chars)], SIDE + 3, 6)
  if (chars < 2) stamp(picture, ['w', 'w'], SIDE + 3 + chars, 5)
  for (let line = 0; line < output; line++) stamp(picture, [line % 2 ? 'cccc' : 'ccccc'], SIDE, 9 + line * 2 - 0)
  const text = scene({ eyes: 'right', ...pose }, [tall(fill(5, 4, 'd')), SIDE, TOP + 2])
  marks(text, [[SIDE, TOP + 2]], 'c')
  if (chars > 0) marks(text, [[SIDE + 2, TOP + 2]], 'w')
  if (output > 0) marks(text, [[SIDE, TOP + 6]], 'c')
  return art(picture, text)
}
export const prompting: Loop<Art> = [
  typed(0, 0),
  typed(1, 0, { left: 'up' }),
  typed(2, 0, { right: 'up' }),
  typed(3, 0, { left: 'up' }),
  typed(3, 1, { eyes: 'wide' }),
  typed(3, 2),
  typed(3, 2, { eyes: 'shut' }),
]

// Running, as a player does: a screen with a "play" triangle, pressed, then
// green, and a bar under it filling while the command runs.
const PLAYER = ['mmmmmm', 'mtdddm', 'mttddm', 'mtdddm', 'mmmmmm']
const BAR_PIXELS = 6 // the bar's width in the picture
const TEXT_BAR_PIXELS = BAR_PIXELS - 1 // and in the text, which has no room for more
// `lit` of the picture's bar pixels are filled; the text's bar shows as much of its own.
const play = (pose: Body, isPressed: boolean, lit: number, rays: Spots = []): Art => {
  const triangle = isPressed ? 'w' : 'c'
  const screen = PLAYER.map(row => row.replaceAll('t', triangle))
  const bar = (width: number, filled: number) => 'c'.repeat(filled) + 'm'.repeat(width - filled)
  const textLit = Math.round((lit * TEXT_BAR_PIXELS) / BAR_PIXELS)
  return art(
    dots(scene(pose, [screen, SIDE - 1, 2], [[bar(BAR_PIXELS, lit)], SIDE - 1, 10]), rays, 'w'),
    scene(
      pose,
      [tall(['t    ', 'ttt  ', 't    '].map(row => row.replaceAll('t', triangle))), SIDE, TOP],
      [tall([bar(TEXT_BAR_PIXELS, textLit)]), SIDE, TOP + 8],
    ),
  )
}
const pressed = play({ eyes: 'right', right: 'up' }, true, 0, [[SIDE - 2, 1], [SIDE + 2, 1], [SIDE + 4, 2]])
export const playing: Loop<Art> = [
  pressed,
  play({ eyes: 'right' }, false, 2),
  play({ eyes: 'right' }, false, 4),
  play({ eyes: 'right' }, false, 6),
]

// Searching: a magnifying glass held up on one side, then the other, the eyes
// going with it.
const LENS_RING = [' gggg ', 'gw   g', 'g    g', 'g    g', 'g    g', ' gggg ']
const TEXT_RING = tall([' ggg ', 'g   g', 'g   g', ' ggg '])
const glassRight = art(
  dots(scene({ eyes: 'right' }, [LENS_RING, SIDE - 1, 0]), [[SIDE - 1, 6], [SIDE - 2, 7]], 'l'),
  scene({ eyes: 'right' }, [TEXT_RING, SIDE, TOP], [tall(['l']), SIDE - 1, TOP + 8]),
)
const glassLeft = art(
  dots(scene({ eyes: 'left' }, [LENS_RING, 1, 0]), [[6, 6], [7, 7]], 'l'),
  scene({ eyes: 'left' }, [TEXT_RING, 1, TOP], [tall(['l']), 6, TOP + 8]),
)
export const searching: Loop<Art> = [glassRight, glassRight, glassLeft, glassLeft]

// Searching, the web being wide: the world turning beside him, its land going by.
const SEA = ['  uuu  ', ' uuuuu ', 'uuuuuuu', 'uuuuuuu', 'uuuuuuu', ' uuuuu ', '  uuu  ']
// The land all the way round, twice as wide as the face that shows.
const LAND = ['              ', ' cc      c    ', 'ccc     ccc   ', ' ccc    cc    ', '  cc     ccc  ', '  c       c   ', '              ']
const world = (turn: number, textGlobe: string[]): Art => {
  const globe = SEA.map((row, y) =>
    row.replace(/u/g, (_, x: number) => (LAND[y]?.[(x + 14 - turn * 3) % 14] === 'c' ? 'c' : 'u')),
  )
  return art(scene({ eyes: 'right' }, [globe, SIDE - 2, 0]), scene({ eyes: 'right' }, [tall(textGlobe), SIDE, TOP]))
}
export const browsing: Loop<Art> = [
  world(0, [' cuu ', 'ccuuu', 'uuuuu', ' uuu ']),
  world(1, [' ucc ', 'uuccu', 'uuuuu', ' uuu ']),
  world(2, [' uuu ', 'uuuuc', 'uuuuc', ' uuc ']),
  world(3, [' uuu ', 'uuuuu', 'ccuuu', ' cuu ']),
]

// Searching, as a fetch: a signal going out, arc after arc, and its answer
// flashing back.
const signal = (dot: string, inner: string, outer: string, eyes: Body['eyes'] = 'right'): Art => {
  const paint = (rows: string[], key: string) => (key ? rows.map(row => row.replaceAll('x', key)) : [])
  return art(
    scene(
      { eyes },
      [paint(['   x   '], dot), SIDE - 2, 7],
      [paint(['  xxx  ', ' x   x '], inner), SIDE - 2, 4],
      [paint([' xxxxx ', 'x     x'], outer), SIDE - 2, 1],
    ),
    scene(
      { eyes },
      [paint(tall(['  x  ']), dot), SIDE, TOP + 8],
      [paint(tall([' xxx ']), inner), SIDE, TOP + 4],
      [paint(tall(['xxxxx', 'x   x']), outer), SIDE, TOP],
    ),
  )
}
// The signal goes out arc by arc; the answer comes back in as a white arc, the
// outer one first.
export const fetchingWeb: Loop<Art> = [
  signal('u', '', ''),
  signal('u', 'u', ''),
  signal('u', 'u', 'u'),
  signal('u', 'u', 'u'),
  signal('u', 'u', 'w'),
  signal('u', 'w', 'u'),
  signal('w', 'u', 'u', 'wide'),
  signal('w', '', '', 'wide'),
]
