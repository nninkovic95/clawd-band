import type { Pose } from '../types'
// Types alone from another file: the render scripts run this one in node as
// it stands, which resolves no import written without its extension.
import type { Picture, Rgb } from './picture'

export type { Rgb }

export const toHex = (rgb: Rgb): string => `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`

// Clawd as the CLI prints it at startup (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝), drawn
// as a picture: a quadrant is twice as tall as wide, so each logo pixel is one
// column by two rows of square art pixels. The body sits at the bottom of the
// canvas; the rows above it and the columns beside it hold the props.
export const ART_WIDTH = 28
export const ART_HEIGHT = 14
export const SCALE = 5

// Both forms show the same cells, so Clawd is one size in either: 14 columns
// of two art columns each, from the text's first art column, and the text's
// three rows of four art rows from the head down. The picture has one row of
// cells more, above the head, for the props the text cannot show.
export const TEXT_COLUMNS = 14
export const TEXT_ROWS = 3
export const PICTURE_ROWS = TEXT_ROWS + 1
// The picture's box of cells: as tall as the text Clawd, so that either form
// stands level with three bars, and wider than his art, so that the art,
// drawn with square pixels, is as tall as the box on fonts with cells up to
// 1:3. An even width centres the 14-cell text Clawd on the picture's middle.
export const BOX_COLUMNS = 16
export const BOX_ROWS = TEXT_ROWS
const TEXT_LEFT = 1 // the art column the first cell starts at: the arms end on a cell's edge
export const PICTURE_WIDTH = TEXT_COLUMNS * 2
export const PICTURE_HEIGHT = PICTURE_ROWS * 4
export const PIXEL_WIDTH = PICTURE_WIDTH * SCALE
export const PIXEL_HEIGHT = PICTURE_HEIGHT * SCALE

export const CLAUDE_ORANGE: Rgb = [215, 119, 87]

const COLORS: Record<string, Rgb> = {
  '#': CLAUDE_ORANGE, // the body, replaced by the sprite_color option
  w: [235, 232, 225], // the thought cloud, speed lines, text on a screen, a chef's hat
  y: [240, 190, 60], // pencil, "?", "!", sparks, sand, a lit bulb, a padlock
  k: [70, 60, 55], // ink on paper, dots in the cloud, glasses, a spinner's track: nearly lost on a dark terminal
  m: [150, 155, 165], // metal: the hammer, the press, a screen's case, the hourglass's ends, steam
  b: [240, 236, 226], // pages, a mug
  l: [150, 120, 100], // wood and card: a spine, a handle, a rod, a box, a browned pancake
  g: [170, 200, 220], // glass, an unlit bulb, the shine on an anvil, a keyboard
  r: [220, 80, 70], // "no" and "stop": a cross, a sign, a float, an eraser
  d: [34, 36, 46], // a screen in dark mode
  c: [120, 210, 140], // code, a tick, the green of "go", land
  u: [95, 160, 230], // water, the sea of a globe, a signal in the air, a mark in a margin
}

type Grid = string[][]

// Things shown in turn, over and over; never empty.
export type Loop<T> = readonly [T, ...T[]]

const blank = (): Grid => Array.from({ length: ART_HEIGHT }, () => Array<string>(ART_WIDTH).fill('.'))

// Paints a pattern at (x, y): a space leaves the pixel, a dot clears it.
const stamp = (g: Grid, pattern: string[], x: number, y: number): Grid => {
  pattern.forEach((row, r) =>
    row.split('').forEach((ch, c) => {
      const line = g[y + r]
      const gx = x + c
      if (ch === ' ' || !line || gx < 0 || gx >= ART_WIDTH) return
      line[gx] = ch
    }),
  )
  return g
}

const fill = (w: number, h: number, ch = '#'): string[] => Array.from({ length: h }, () => ch.repeat(w))

// A pattern at the text Clawd's grain: each of its rows is two art rows, the
// height of one quadrant.
const tall = (pattern: string[]): string[] => pattern.flatMap(row => [row, row])

type Spots = [number, number][]

// Single pixels of one colour, for the picture.
const dots = (g: Grid, at: Spots, ch: string): Grid => {
  for (const [x, y] of at) stamp(g, [ch], x, y)
  return g
}

// The same for the text: each one quadrant.
const marks = (g: Grid, at: Spots, ch: string): Grid => {
  for (const [x, y] of at) stamp(g, tall([ch]), x, y)
  return g
}

type Arm = 'out' | 'up' | 'down' | 'none'

type Body = {
  x?: number
  y?: number
  eyes?: 'open' | 'shut' | 'left' | 'right' | 'wide'
  left?: Arm
  right?: Arm
  legs?: 'stand' | 'stride'
}

const X = 5 // the body's left edge, arms included
const TOP = 4 // the head's first row, standing
const SIDE = 23 // where the text's prop beside the body starts: on the edge of a text cell

// `x` is how far he stands from his usual place; whole text cells are two columns.
const body = ({ x = 0, y = TOP, eyes = 'open', left = 'out', right = 'out', legs = 'stand' }: Body = {}): Grid => {
  const g = blank()
  const edge = X + x
  stamp(g, fill(12, 8), edge + 3, y)

  const shift = eyes === 'left' ? -1 : eyes === 'right' ? 1 : 0
  const eyeCols = eyes === 'wide' ? [5, 6, 11, 12] : [5 + shift, 12 + shift]
  if (eyes !== 'shut') for (const r of [y + 2, y + 3]) for (const c of eyeCols) stamp(g, ['.'], edge + c, r)

  const arm = (side: Arm, col: number) => {
    if (side === 'out') stamp(g, fill(2, 2), col, y + 4)
    if (side === 'up') stamp(g, fill(2, 5), col, y - 1)
    if (side === 'down') stamp(g, fill(2, 2), col, y + 6)
  }
  arm(left, edge + 1)
  arm(right, edge + 15)

  const feet = [4, 6, 11, 13]
  const spread = [3, 7, 10, 14]
  for (const c of feet) stamp(g, ['#'], edge + c, y + 8)
  for (const c of legs === 'stride' ? spread : feet) stamp(g, ['#'], edge + c, y + 9)
  return g
}

type Place = [x: number, y: number]

// Something drawn at a place: a pattern and where its top left corner goes.
type Layer = [pattern: string[], ...at: Place]

// Clawd in a pose with things drawn over him, the first undermost.
const scene = (pose: Body, ...layers: Layer[]): Grid =>
  layers.reduce((g, [pattern, x, y]) => stamp(g, pattern, x, y), body(pose))

// One frame, as each form of Clawd shows it. The picture has rows over the
// head and a fine grain. The text Clawd starts at the head and has half the
// grain down the page, so a prop is drawn a second time for it where the
// picture's would not come through: beside the body, `tall`.
type Art = { picture: Grid; text: Grid }

const art = (picture: Grid, text: Grid = picture): Art => ({ picture, text })

const HOP = TOP - 2 // off the ground by one quadrant, so the text shows the jump too

// The plain body: Clawd as the CLI prints him, nothing in hand.
const stand = art(body())

// Idle, on a break: a mug in the hand, steam curling off it, the eyes shut
// over the warmth of it.
const MUG = ['bbbb  ', 'bbbbbb', 'bbbb b', 'bbbbbb', 'bbbb  ']
const STEAM: Record<'left' | 'right', { picture: Spots; text: Spots }> = {
  left: { picture: [[23, 4], [23, 3], [24, 2], [24, 1], [23, 0]], text: [[SIDE, TOP + 2], [SIDE + 1, TOP]] },
  right: { picture: [[24, 4], [24, 3], [23, 2], [23, 1], [24, 0]], text: [[SIDE + 1, TOP + 2], [SIDE, TOP]] },
}
const onBreak = (eyes: Body['eyes'], curl: keyof typeof STEAM): Art =>
  art(
    dots(scene({ eyes }, [MUG, SIDE - 1, 6]), STEAM[curl].picture, 'm'),
    marks(scene({ eyes }, [tall(['bbbb', 'bbb ']), SIDE, TOP + 4]), STEAM[curl].text, 'm'),
  )
const mug: Loop<Art> = [onBreak('open', 'left'), onBreak('open', 'right'), onBreak('shut', 'left'), onBreak('shut', 'right')]

// Idle, asleep: the eyes shut, a "z" drifting up from the head and growing.
const SMALL_Z = ['ww ', ' w ', ' ww']
const BIG_Z = ['wwww', '   w', '  w ', ' w  ', 'wwww']
const TEXT_Z = tall(['wwwww', '   w ', '  w  ', ' w   ', 'wwwww'])
const dozing: Loop<Art> = [
  art(body({ eyes: 'shut' })),
  art(scene({ eyes: 'shut' }, [SMALL_Z, 21, 4]), scene({ eyes: 'shut' }, [tall(SMALL_Z), SIDE, TOP + 4])),
  art(scene({ eyes: 'shut' }, [SMALL_Z, 21, 4], [BIG_Z, 24, 0]), scene({ eyes: 'shut' }, [TEXT_Z, SIDE, TOP])),
  art(scene({ eyes: 'shut' }, [BIG_Z, 24, 0]), scene({ eyes: 'shut' }, [TEXT_Z, SIDE, TOP])),
]

// Waiting for the first word of a reply: an eye on an hourglass, the sand
// running from its top to its bottom, then a toss that turns it over.
const HOURGLASS = {
  full: ['mmmmmmm', ' gyyyg ', ' gyyyg ', '  gyg  ', '   y   ', '  g g  ', ' g   g ', ' g   g ', 'mmmmmmm'],
  half: ['mmmmmmm', ' g   g ', ' gyyyg ', '  gyg  ', '   y   ', '  gyg  ', ' g y g ', ' gyyyg ', 'mmmmmmm'],
  spent: ['mmmmmmm', ' g   g ', ' g   g ', '  g g  ', '   g   ', '  gyg  ', ' gyyyg ', ' gyyyg ', 'mmmmmmm'],
}
const TOSSED = ['m     m', 'mg   gm', 'myg g m', 'myyg  m', 'myg g m', 'mg   gm', 'm     m']
// The text's glass by what fills its top, its waist and its base.
const SAND = { full: 'ygg', half: 'ygy', spent: 'gyy' }
const timing = (sand: keyof typeof HOURGLASS, eyes: Body['eyes'] = 'right'): Art => {
  const [top = 'g', waist = 'g', base = 'g'] = SAND[sand]
  const glass = tall([top.repeat(5), ` ${top.repeat(3)} `, `  ${waist}  `, ` ${waist.repeat(3)} `, base.repeat(5)])
  return art(scene({ eyes }, [HOURGLASS[sand], SIDE - 2, TOP - 1]), scene({ eyes }, [glass, SIDE, TOP]))
}
const tossed = art(
  scene({ eyes: 'right' }, [TOSSED, SIDE - 2, 0]),
  scene({ eyes: 'right' }, [tall(['g   g', 'gg gg', 'ggygg', 'gg gg', 'g   g']), SIDE, TOP]),
)
const turned = timing('full')
const waiting: Loop<Art> = [turned, turned, timing('half'), timing('spent'), timing('spent', 'shut'), tossed]

// Waiting, with a line out: the float bobs on the water and nothing bites.
const ROD: Spots = [[21, 7], [22, 6], [23, 5], [24, 4], [25, 3]]
const TEXT_ROD: Spots = [[SIDE - 1, TOP + 4], [SIDE, TOP + 2], [SIDE + 1, TOP]]
const FLOAT = [' r ', 'rrr', 'www']
const fishing = (eyes: Body['eyes'], dip: number, ripple: string): Art => {
  const sea: Layer = [[ripple, 'uuuuuu'], SIDE - 1, 12]
  const picture = scene({ eyes }, [fill(1, 5 + dip, 'w'), 26, 4], sea, [FLOAT, 25, 9 + dip])
  const text = scene(
    { eyes },
    [tall(['ww', ...fill(1, 2 + dip, ' w')]), SIDE + 2, TOP],
    [tall(['uuuuuu']), SIDE - 1, TOP + 8],
    [tall(['rr']), SIDE + 2, TOP + 6 + dip * 2],
  )
  return art(dots(picture, ROD, 'l'), marks(text, TEXT_ROD, 'l'))
}
const angling: Loop<Art> = [
  fishing('right', 0, 'u u u '),
  fishing('right', 0, ' u u u'),
  fishing('right', 1, 'u u u '),
  fishing('shut', 0, ' u u u'),
]

// Waiting, as a page that loads does: a ring that fills clockwise from the top,
// then turns green and holds, and starts empty again.
const RIM: Spots = [
  [2, 0], [3, 0], [4, 0], [5, 1], [6, 2], [6, 3], [6, 4], [5, 5],
  [4, 6], [3, 6], [2, 6], [1, 5], [0, 4], [0, 3], [0, 2], [1, 1],
]
// The text's ring in four arcs, clockwise from the top: each keeps to cells of
// its own, so that it can be filled alone.
const ARCS: Layer[][] = [
  [[['xx'], SIDE + 2, TOP], [['x'], SIDE + 4, TOP + 2]],
  [[['x'], SIDE + 4, TOP + 4], [['xx'], SIDE + 2, TOP + 6]],
  [[['x ', ' x'], SIDE, TOP + 4]],
  [[[' x', 'x '], SIDE, TOP]],
]
const RING = { track: 'k', filled: 'u', newest: 'w', done: 'c' } as const
// `filled` of the ring's pixels, the newest the brightest; a whole ring is done.
const loading = (filled: number, eyes: Body['eyes']): Art => {
  const isDone = filled === RIM.length
  const picture = body({ eyes })
  RIM.forEach(([x, y], at) => {
    const ink = isDone ? RING.done : at >= filled ? RING.track : at === filled - 1 ? RING.newest : RING.filled
    stamp(picture, [ink], SIDE - 2 + x, 1 + y)
  })
  const text = body({ eyes })
  ARCS.forEach((arc, at) => {
    const ink = isDone ? RING.done : at < Math.floor(filled / 4) ? RING.filled : RING.track
    for (const [bend, x, y] of arc) stamp(text, tall(bend.map(row => row.replaceAll('x', ink))), x, y)
  })
  return art(picture, text)
}
const done = loading(RIM.length, 'open')
const spinner: Loop<Art> = [
  loading(0, 'right'),
  loading(4, 'right'),
  loading(8, 'right'),
  loading(12, 'right'),
  done,
  done,
]

// Thinking: a thought cloud bubbling up from the head, the dots in it counting
// up. In the text each dot is a gap in the cloud.
const CLOUD = ['  www ww ', ' wwwwwwww', 'wwwwwwwww', ' wwwwwww ']
const cloud = (count: number): Art => {
  const pose: Body = { eyes: 'right', right: 'none' }
  const picture = scene(pose, [CLOUD, SIDE - 4, 0], [['ww', 'ww'], SIDE - 1, 5], [['w'], SIDE - 2, 8])
  for (let dot = 0; dot < count; dot++) stamp(picture, ['k', 'k'], SIDE - 2 + dot * 2, 1)
  const gaps = [0, 1, 2].map(dot => (dot < count ? '.' : 'w'))
  const text = scene(pose, [tall([' wwwww ', `w${gaps.join('w')}w`, ' wwwww ', 'w      ']), SIDE - 2, TOP])
  return art(picture, text)
}
const fullCloud = cloud(3)
const pondering: Loop<Art> = [cloud(1), cloud(2), fullCloud, fullCloud]

// Thinking, the other way: a bulb beside the head, dark until the idea comes.
const BULB = {
  dark: [' ggg ', 'g   g', 'g   g', 'g m g', ' gmg ', ' mmm ', '  m  '],
  lit: [' yyy ', 'yywyy', 'ywwwy', 'yywyy', ' yyy ', ' mmm ', '  m  '],
}
const bulb = (pose: Body, glass: keyof typeof BULB, isShining = false): Art => {
  const key = glass === 'lit' ? 'y' : 'g'
  const picture = scene(pose, [BULB[glass], SIDE - 1, 2])
  const text = scene(pose, [tall([` ${key}${key} `, key.repeat(4), ' mm ']), SIDE, TOP])
  if (!isShining) return art(picture, text)
  return art(
    dots(picture, [[SIDE + 1, 0], [SIDE - 2, 1], [SIDE + 4, 1], [SIDE - 3, 4], [SIDE + 4, 7]], 'y'),
    marks(text, [[SIDE - 1, TOP], [SIDE + 4, TOP], [SIDE + 4, TOP + 4]], 'y'),
  )
}
const dim = bulb({ eyes: 'left' }, 'dark')
const idea: Loop<Art> = [
  dim,
  dim,
  bulb({ eyes: 'right' }, 'dark'),
  bulb({ eyes: 'right', left: 'up' }, 'lit', true),
  bulb({ eyes: 'right', left: 'up' }, 'lit'),
  bulb({ eyes: 'right', left: 'up' }, 'lit', true),
]

// Thinking, as a machine does: a cog and a pinion beside the head, turning on
// each other. A spoke in each shows the way and how far it has turned: eight
// frames a turn, the pinion the other way. The text has room for one cog, its
// spoke a quarter turn every two frames.
const COG = {
  plus: ['   m   ', ' mmmmm ', ' mm mm ', 'mm   mm', ' mm mm ', ' mmmmm ', '   m   '],
  cross: ['m     m', ' mmmmm ', ' mm mm ', ' m   m ', ' mm mm ', ' mmmmm ', 'm     m'],
}
const PINION = {
  plus: ['  y  ', ' yyy ', 'yy yy', ' yyy ', '  y  '],
  cross: ['y   y', ' yyy ', ' y y ', ' yyy ', 'y   y'],
}
const TEXT_COG = {
  plus: ['  m m  ', ' mmmmm ', 'mmm mmm', ' mmmmm ', '  m m  '],
  cross: ['   m   ', 'mmmmmmm', ' mm mm ', 'mmmmmmm', '   m   '],
}
// The places round a cog's middle, clockwise from the top.
const AROUND: Spots = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]
const TEXT_AROUND: Spots = [[0, -1], [1, 0], [0, 1], [-1, 0]]
// What a spoke turns on: a cog's middle, and the places round it.
type Wheel = { middle: Place; around: Spots }
const BIG: Wheel = { middle: [3, 3], around: AROUND }
const SMALL: Wheel = { middle: [2, 2], around: AROUND }
const TEXT_BIG: Wheel = { middle: [3, 2], around: TEXT_AROUND }
// A cog's pattern with its spoke drawn in, as `at` places on from the top.
const spoked = (cog: string[], { middle, around }: Wheel, at: number, spoke: string): string[] => {
  const [dx, dy] = around[((at % around.length) + around.length) % around.length] ?? [0, 0]
  return cog.map((row, y) => (y === middle[1] + dy ? row.slice(0, middle[0] + dx) + spoke + row.slice(middle[0] + dx + 1) : row))
}
const cogs = (phase: number): Art => {
  const isOdd = phase % 2 === 1
  const eyes = phase % 4 < 2 ? 'left' : 'right'
  const [big, small] = isOdd ? (['cross', 'plus'] as const) : (['plus', 'cross'] as const)
  return art(
    scene(
      { eyes, right: 'none' },
      [spoked(COG[big], BIG, phase, 'y'), SIDE - 2, 0],
      [spoked(PINION[small], SMALL, -phase, 'w'), SIDE, 7],
    ),
    scene({ eyes, right: 'none' }, [tall(spoked(TEXT_COG[big], TEXT_BIG, Math.floor(phase / 2), 'y')), SIDE - 2, TOP]),
  )
}
const turning: Loop<Art> = [cogs(0), cogs(1), cogs(2), cogs(3), cogs(4), cogs(5), cogs(6), cogs(7)]

// Questioning: a hand up and a "?" beside the head, bobbing in the picture.
const QUESTION = [' yyy ', 'yy yy', '   yy', '  yy ', ' yy  ', ' yy  ', '     ', ' yy  ']
const asking = (eyes: Body['eyes'], y: number): Art =>
  art(
    scene({ eyes, left: 'up' }, [QUESTION, SIDE - 1, y]),
    scene({ eyes, left: 'up' }, [tall(['yyyy ', '   yy', ' yy  ', '     ', ' yy  ']), SIDE, TOP]),
  )
const askLow = asking('open', 1)
const askHigh = asking('right', 0)
const questioning: Loop<Art> = [askLow, askLow, askHigh, askHigh]

// Questioning, as a choice put to the user: an "A" in one hand, a "B" in the
// other, each lifted in turn.
const CARD_A = ['uuuuu', 'uuwuu', 'uwuwu', 'uwwwu', 'uwuwu', 'uwuwu', 'uuuuu']
const CARD_B = ['yyyyy', 'ykkyy', 'ykyky', 'ykkyy', 'ykyky', 'ykkyy', 'yyyyy']
const LETTER_A = tall([' u ', 'u u', 'uuu', 'u u', 'u u'])
const LETTER_B = tall(['yy ', 'y y', 'yy ', 'y y', 'yy '])
const offering = (eyes: Body['eyes'], liftA: number, liftB: number): Art =>
  art(
    scene({ eyes }, [CARD_A, 1, 3 - liftA], [CARD_B, SIDE - 1, 3 - liftB]),
    scene({ eyes }, [LETTER_A, 1, TOP], [LETTER_B, SIDE + 1, TOP]),
  )
const eitherOr: Loop<Art> = [offering('open', 0, 0), offering('left', 2, 0), offering('open', 0, 0), offering('right', 0, 2)]

// Working: a hammer brought down on hot iron on an anvil, sparks at each blow.
const ANVIL = ['ggggggg', ' mmmmm ', '  mmm  ', ' mmmmm ']
const IRON: Layer = [['yyyy'], SIDE, 9]
const TEXT_ANVIL: Layer = [tall(['mmmmm', ' mmm ']), SIDE, TOP + 6]
const hammerUp = art(
  scene({ right: 'up', eyes: 'right' }, [ANVIL, SIDE - 2, 10], IRON, [['ll'], 20, 2], [fill(5, 2, 'm'), 19, 0]),
  scene({ right: 'up', eyes: 'right' }, TEXT_ANVIL, [tall(['mmmm']), SIDE - 1, TOP]),
)
// The hammer down: the handle out from the hand, the head on the iron.
const blow = (sparks: Spots, textSparks: Spots): Art =>
  art(
    dots(scene({ eyes: 'shut' }, [ANVIL, SIDE - 2, 10], IRON, [['ll'], SIDE - 1, 8], [fill(2, 3, 'm'), SIDE + 1, 7]), sparks, 'y'),
    marks(scene({ eyes: 'shut' }, TEXT_ANVIL, [tall(['  mm', 'l mm']), SIDE - 1, TOP + 2]), textSparks, 'y'),
  )
const hammering: Loop<Art> = [
  hammerUp,
  blow([[22, 6], [27, 6], [26, 4]], [[SIDE + 4, TOP]]),
  hammerUp,
  blow([[23, 5], [27, 7], [22, 4], [26, 5]], [[SIDE - 1, TOP], [SIDE + 4, TOP + 2]]),
]

// Working, at a desk: typing at a laptop, code coming up line by line on its
// dark screen. The text's screen is the terminal's own dark.
const SCREEN = ['mmmmmm', ...fill(1, 3, 'mddddm'), 'mmmmmm']
const typing = (code: string[], key: number, typed: string[]): Art => {
  const picture = scene({ eyes: 'right' }, [SCREEN, SIDE - 1, 3], [code, SIDE, 4], [['mmmmmm', 'gggggg'], SIDE - 1, 8])
  // A key going down.
  stamp(picture, ['w'], SIDE + key, 9)
  const text = scene({ eyes: 'right' }, [tall(['m    m', 'm    m', 'mmmmmm']), SIDE - 1, TOP], [tall(typed), SIDE, TOP])
  return art(picture, text)
}
const laptop: Loop<Art> = [
  typing(['cw  '], 0, ['c   ']),
  typing(['ccc '], 2, ['ccc ']),
  typing(['ccc ', ' yyw'], 1, ['ccc ', ' yy ']),
  typing(['ccc ', ' yyy', ' uw '], 3, ['ccc ', ' yyy']),
]

// Working, as a cook ("let him cook"): a pancake tossed from the pan, turned
// in the air and caught browned side up.
const TOQUE = [' wwwwww ', 'wwwwwwww', ' wwwwww ', ' wwwwww ']
const cook = (eyes: Body['eyes'], cake: Layer, textCake: Layer): Art =>
  art(
    scene({ eyes }, [TOQUE, 10, 0], [['m    m', 'mmmmmm'], SIDE - 1, 7], cake),
    scene({ eyes }, [tall(['mmmmmm']), SIDE - 1, TOP + 4], textCake),
  )
const cooking: Loop<Art> = [
  cook('right', [['yyyy', 'llll'], SIDE, 6], [tall(['yyyy']), SIDE, TOP + 2]),
  cook('right', [['yyyy', 'llll'], SIDE, 3], [tall(['yyyy']), SIDE, TOP]),
  cook('right', [fill(1, 4, 'yl'), SIDE + 1, 0], [tall(['yl']), SIDE + 1, TOP]),
  cook('right', [['llll', 'yyyy'], SIDE, 3], [tall(['llll']), SIDE, TOP]),
  cook('shut', [['llll', 'yyyy'], SIDE, 6], [tall(['llll']), SIDE, TOP + 2]),
]

// Reading: a book held open, the eyes running along the line, then a page turns.
const BOOK = ['bbbbbb  bbbbbb', 'bmmmmbllbmmmmb', 'bbbbbbllbbbbbb', 'bmmmbbllbmmbbb']
const reader = (eyes: Body['eyes'], ...leaf: Layer[]): Art => art(scene({ eyes }, [BOOK, 7, 8], ...leaf))
const reading: Loop<Art> = [
  reader('left'),
  reader('open'),
  reader('right'),
  reader('right', [['  bbbb', ' bbbb '], 15, 6]),
  reader('open', [fill(2, 3, 'b'), 13, 5]),
]

// Reading, with his glasses on: down a page line by line, a mark in the margin
// keeping the place. The text has no room for the glasses.
const LENS = ['kkk', 'k k', 'k k', 'kkk']
const GLASSES: Layer[] = [[LENS, 10, 5], [LENS, 17, 5], [['kkkk'], 13, 6]]
const PAGE = ['bbbbb ', ...fill(6, 8, 'b')]
const LINES = [3, 4, 2, 4]
const studying = (line: number): Art => {
  const picture = scene({ eyes: 'right' }, ...GLASSES, [PAGE, SIDE - 1, 0])
  LINES.forEach((length, at) => stamp(picture, [(at === line ? 'u' : 'm').repeat(length)], SIDE, 1 + at * 2))
  const sheet = tall(['bbbbb', 'b   b', 'bbbbb', 'b   b', 'bbbbb'])
  return art(picture, scene({ eyes: 'right' }, [sheet, SIDE - 1, TOP], [tall(['u']), SIDE + 4, TOP + 2 + (line >> 1) * 4]))
}
const poring: Loop<Art> = [studying(0), studying(1), studying(2), studying(3)]

// Writing: a pencil in the hand, its point on a sheet of paper and the line of
// ink growing behind it, then the pencil lifted. In the text the ink is a gap
// in the sheet.
const PENCIL = ['rr    ', 'ryy   ', ' yyy  ', '  yyy ', '   yyl', '    lk']
const writer = (inked: number, lift = 0): Art => {
  const picture = scene(
    { eyes: 'right' },
    [fill(6, 6, 'b'), SIDE - 1, 8],
    [['kkkk'], SIDE, 9],
    [['k'.repeat(inked)], SIDE, 11],
    [PENCIL, SIDE - 5 + inked, 6 - lift],
  )
  const sheet = tall(['bbbbb', `b${' '.repeat(inked)}${'b'.repeat(4 - inked)}`, 'bbbbb'])
  const text = scene({ eyes: 'right' }, [sheet, SIDE, TOP + 4])
  return art(picture, marks(text, [[SIDE + inked, TOP + 2], [SIDE - 1 + inked, TOP]], 'y'))
}
const writing: Loop<Art> = [writer(1), writer(2), writer(3), writer(3, 2)]

// Running: he runs, a stride then a bound, speed lines and dust behind him.
const stride = (pose: Body): Art => art(dots(scene({ ...pose, legs: 'stride' }, [['ww'], 1, 6], [['ww'], 1, 10]), [[3, 13], [1, 12]], 'm'))
const bound = art(scene({ y: HOP }, [['ww'], 1, 4], [['ww'], 1, 8]))
const running: Loop<Art> = [stride({ left: 'up' }), bound, stride({ right: 'up' }), bound]

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
const playing: Loop<Art> = [
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
const searching: Loop<Art> = [glassRight, glassRight, glassLeft, glassLeft]

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
const browsing: Loop<Art> = [
  world(0, [' cuu ', 'ccuuu', 'uuuuu', ' uuu ']),
  world(1, [' ucc ', 'uuccu', 'uuuuu', ' uuu ']),
  world(2, [' uuu ', 'uuuuc', 'uuuuc', ' uuc ']),
  world(3, [' uuu ', 'uuuuu', 'ccuuu', ' cuu ']),
]

// Searching, as a fetch: a signal going out, arc after arc, and its answer
// flashing back.
const signal = (key: string, arcs: number, eyes: Body['eyes'] = 'right'): Art => {
  const wave = [['   x   '], ['  xxx  ', ' x   x '], [' xxxxx ', 'x     x']].map(arc => arc.map(row => row.replaceAll('x', key)))
  const textWave = [['  x  '], [' xxx '], ['xxxxx', 'x   x']].map(arc => tall(arc.map(row => row.replaceAll('x', key))))
  const [dot = [], inner = [], outer = []] = wave
  const [textDot = [], textInner = [], textOuter = []] = textWave
  return art(
    scene({ eyes }, [dot, SIDE - 2, 7], [arcs > 0 ? inner : [], SIDE - 2, 4], [arcs > 1 ? outer : [], SIDE - 2, 1]),
    scene({ eyes }, [textDot, SIDE, TOP + 8], [arcs > 0 ? textInner : [], SIDE, TOP + 4], [arcs > 1 ? textOuter : [], SIDE, TOP]),
  )
}
const fetchingWeb: Loop<Art> = [signal('u', 0), signal('u', 1), signal('u', 2), signal('w', 2, 'wide')]

// Delegating: he stands aside for a small Clawd, half his size, who takes the
// work. `BOSS` is where he stands to leave it room.
const BOSS = -4
const MINI = [' ###### ', ' #.##.# ', '########', ' ###### ', ' ##  ## ']
const TEXT_MINI = tall([' ###### ', '##.##.##', ' ##  ## '])
const NOTE = ['bbb', 'bmb', 'bbb', 'bmb']

// Delegating: a note handed to the small Clawd, who carries it off over its head.
const handOff = (pose: Body, note: Place, textNote: Place, away = 0): Art =>
  art(
    scene({ ...pose, x: BOSS }, [MINI, 20 + away, 9], [NOTE, ...note]),
    scene({ ...pose, x: BOSS }, [TEXT_MINI, 20 + away, TOP + 4], [tall(['bb', 'bb']), ...textNote]),
  )
const delegating: Loop<Art> = [
  handOff({ eyes: 'right' }, [18, 5], [18, TOP]),
  handOff({ eyes: 'right' }, [19, 6], [20, TOP]),
  handOff({ eyes: 'right', left: 'up' }, [22, 5], [23, TOP]),
  handOff({ eyes: 'right', left: 'up' }, [25, 5], [26, TOP], 3),
]

// Delegating, as a spawning: the small Clawd comes out from behind him with a pop.
const emerging = art(
  scene({ x: BOSS, eyes: 'right', right: 'none' }, [MINI.map(row => row.slice(4)), 16, 9]),
  scene({ x: BOSS, eyes: 'right', right: 'none' }, [TEXT_MINI.map(row => row.slice(4)), 16, TOP + 4]),
)
const popped = art(
  dots(scene({ x: BOSS, eyes: 'right' }, [MINI, 20, 7]), [[19, 6], [27, 5], [23, 4], [20, 13], [26, 13]], 'y'),
  marks(scene({ x: BOSS, eyes: 'right' }, [TEXT_MINI, 20, TOP + 4]), [[20, TOP], [23, TOP + 2], [26, TOP]], 'y'),
)
const spawned = art(
  scene({ x: BOSS, eyes: 'right', left: 'up' }, [MINI, 20, 9]),
  scene({ x: BOSS, eyes: 'right', left: 'up' }, [TEXT_MINI, 20, TOP + 4]),
)
const spawning: Loop<Art> = [art(body({ x: BOSS, eyes: 'shut', left: 'down', right: 'down' })), emerging, popped, spawned]

// Delegating, and resting on it: the small Clawd types away at a laptop of its
// own while he dozes, one eye opening to see how it goes.
const overseeing = (eyes: Body['eyes'], isTapping: boolean, ...sleep: Layer[]): Art => {
  const boss: Body = { x: BOSS, eyes, left: 'down', right: 'down' }
  const glow = isTapping ? 'w' : 'c'
  const hand = isTapping ? '#' : ' '
  return art(
    scene(boss, [MINI.map(row => row.slice(1, 7)), 19, 9], [['  m', ` ${glow}m`, `${hand}${glow}m`, '  m', 'mmm'], 25, 9], ...sleep),
    scene(boss, [TEXT_MINI.map(row => row.slice(1, 7)), 19, TOP + 4], [tall([` ${glow}m`, `${hand} m`, 'mmm']), 25, TOP + 4]),
  )
}
const supervising: Loop<Art> = [
  overseeing('shut', false, [SMALL_Z, 13, 1]),
  overseeing('shut', true, [SMALL_Z, 13, 1], [BIG_Z, 17, 0]),
  overseeing('shut', false, [BIG_Z, 17, 0]),
  overseeing('right', true),
]

// Compacting: a stack of pages screwed down flat in a press, its handle going
// round. The text's press has two places: up, and down on what is left.
const press = (height: number, arms: Arm, eyes: Body['eyes'], handle: string): Art => {
  const picture = scene(
    { left: arms, right: arms, eyes },
    [[handle], SIDE - 1, 0],
    [fill(2, 11 - height, 'm'), SIDE + 1, 1],
    [['mmmmmm'], SIDE - 1, 12 - height],
    [['mmmmmm'], SIDE - 1, 13],
  )
  for (let page = 0; page < height; page++) stamp(picture, [page % 2 ? 'llll' : 'bbbb'], SIDE, 12 - page)
  const ram = height > 4 ? ['  m  ', 'mmmmm', 'bbbbb', 'bbbbb', 'bbbbb'] : ['  m  ', '  m  ', '  m  ', 'mmmmm', 'bbbbb']
  return art(picture, scene({ left: arms, right: arms, eyes }, [tall(ram), SIDE, TOP]))
}
const pressing: Loop<Art> = [
  press(8, 'up', 'right', 'llll  '),
  press(6, 'up', 'right', '  llll'),
  press(4, 'out', 'right', 'llll  '),
  press(2, 'down', 'right', '  llll'),
  press(2, 'down', 'shut', 'llll  '),
]

// Compacting, the other way: Clawd squeezes himself down into an archive box
// with a zip up its front, the lid shuts, and the box itself packs down small.
const BOX_TOP = TOP + 4
const ZIP = ['yy', 'mm', 'yy', 'mm', 'yy', 'mm']
const boxed = (g: Grid): Grid => stamp(stamp(g, fill(16, 6, 'l'), X + 1, BOX_TOP), ZIP, X + 8, BOX_TOP)
const sinking = (y: number, arms: Arm, eyes: Body['eyes'] = 'open'): Art =>
  art(boxed(body({ y, left: arms, right: arms, eyes })))
const lidded = (lidY: number): Art => {
  // Under a lid not yet down, the top of his head still shows.
  const g = stamp(blank(), fill(12, BOX_TOP - 1 - lidY), X + 3, lidY + 1)
  return art(stamp(boxed(g), fill(18, 1, 'l'), X, lidY))
}
const packed = (): Grid => stamp(stamp(blank(), fill(8, 4, 'l'), X + 5, BOX_TOP + 2), ZIP.slice(0, 4), X + 8, BOX_TOP + 2)
const archiving: Loop<Art> = [
  sinking(HOP, 'out'),
  sinking(TOP, 'up'),
  sinking(TOP + 2, 'up', 'shut'),
  lidded(BOX_TOP - 2),
  lidded(BOX_TOP - 1),
  art(dots(packed(), [[7, 8], [20, 8], [5, 11], [22, 11], [13, 6]], 'y'), marks(packed(), [[7, TOP + 4], [20, TOP + 4], [13, TOP + 2]], 'y')),
]

// Finished: a green tick drawn beside the head, stroke by stroke, and a nod to it.
const TICK = ['      c', '     cc', 'c   cc ', 'cc cc  ', ' ccc   ', '  c    ']
const TEXT_TICK = tall(['    c', '   c ', 'c c  ', ' c   '])
const ticked = (eyes: Body['eyes'], strokes = 7): Art =>
  art(
    scene({ eyes }, [TICK.map(row => row.slice(0, strokes).padEnd(7)), SIDE - 2, 2]),
    scene({ eyes }, [TEXT_TICK.map(row => row.slice(0, strokes - 2).padEnd(5)), SIDE, TOP]),
  )
const ticking: Loop<Art> = [ticked('right', 4), ticked('right'), ticked('shut'), ticked('open'), stand]

// Finished, as a race is: the chequered flag waved, then lowered.
const flagged = (cloth: string[]): Art =>
  art(
    scene({ right: 'up' }, [fill(1, 9, 'm'), SIDE - 1, 0], [cloth, SIDE, 0]),
    scene({ right: 'up' }, [tall(fill(1, 3, 'm')), SIDE - 1, TOP], [tall(cloth.slice(0, 2)), SIDE, TOP]),
  )
const FLAG = ['w w w', ' w w ', 'w w w', ' w w ']
const WAVED = [' w w ', 'w w w', ' w w ', 'w w w']
const flagging: Loop<Art> = [flagged(FLAG), flagged(WAVED), flagged(FLAG), art(body({ eyes: 'shut' })), stand]

// Interrupted: a start, a "!" beside the head, then the arms drop.
const BANG = ['yyy', 'yyy', 'yyy', ' y ', ' y ', '   ', ' y ']
const TEXT_BANG = tall(['yy', 'yy', 'yy', '  ', 'yy'])
const startled = (pose: Body, textPose: Body = pose): Art =>
  art(scene(pose, [BANG, SIDE + 1, 0]), scene(textPose, [TEXT_BANG, SIDE + 1, TOP]))
const interrupted: Loop<Art> = [
  startled({ y: 3, eyes: 'wide', left: 'up', right: 'up' }, { y: HOP, eyes: 'wide', left: 'up', right: 'up' }),
  startled({ eyes: 'wide', left: 'up', right: 'up' }),
  startled({ eyes: 'right' }),
  art(body({ left: 'down', right: 'down', eyes: 'shut' })),
]

// Interrupted, as traffic is: a stop sign goes up in his way and he pulls up short.
const STOP = [' rrrrr ', 'rrrrrrr', 'rrrrrrr', 'rwwwwwr', 'rrrrrrr', 'rrrrrrr', ' rrrrr ']
const halted = (pose: Body, ...dust: Layer[]): Art =>
  art(
    scene(pose, [fill(1, 7, 'm'), SIDE + 1, 7], [STOP, SIDE - 2, 0], ...dust),
    scene(pose, [tall([' rrr ', 'rrrrr', ' rrr ', '  m  ', '  m  ']), SIDE, TOP]),
  )
const stopped: Loop<Art> = [
  art(scene({ legs: 'stride', left: 'up', eyes: 'right' }, [['ww'], 1, 6], [['ww'], 1, 10])),
  halted({ eyes: 'wide', left: 'up', right: 'none' }, [['m m', ' m '], 2, 11]),
  halted({ eyes: 'wide' }),
  halted({ eyes: 'right' }),
  halted({ eyes: 'shut', left: 'down', right: 'down' }),
]

// Interrupted, as a thought is: the cloud he was thinking in bursts, and he
// blinks at where it was.
const burst = (pose: Body, bits: Spots, textBits: Spots): Art => art(dots(body(pose), bits, 'w'), marks(body(pose), textBits, 'w'))
const bursting: Loop<Art> = [
  fullCloud,
  burst(
    { eyes: 'wide', right: 'none' },
    [[19, 0], [22, 0], [26, 0], [20, 3], [24, 4], [27, 3], [23, 2], [22, 6]],
    [[SIDE - 2, TOP], [SIDE + 1, TOP], [SIDE + 4, TOP + 2], [SIDE - 1, TOP + 4], [SIDE + 3, TOP + 6]],
  ),
  burst({ eyes: 'wide' }, [[20, 5], [25, 6], [27, 8], [23, 9]], [[SIDE, TOP + 6], [SIDE + 3, TOP + 8]]),
  art(body({ eyes: 'shut' })),
  stand,
]

// Refused: a shake of the head, the whole of him going with it, beside a cross.
const CROSS = ['rr  rr', ' rrrr ', '  rr  ', '  rr  ', ' rrrr ', 'rr  rr']
const TEXT_CROSS = tall(['r   r', ' r r ', '  r  ', ' r r ', 'r   r'])
const no = (eyes: Body['eyes'], x = 0): Art => {
  const pose: Body = { x, eyes, left: 'down', right: 'down' }
  return art(scene(pose, [CROSS, SIDE - 1, 1]), scene(pose, [TEXT_CROSS, SIDE, TOP]))
}
const refused: Loop<Art> = [no('left', -1), no('right', 1), no('left', -1), no('right', 1), no('shut')]

// Refused, as a door is: a padlock snaps shut on it, and he looks away.
const SHACKLE = { open: [' mmmm ', 'm    m', 'm     ', 'm     '], shut: ['      ', ' mmmm ', 'm    m', 'm    m'] }
const TEXT_SHACKLE = { open: tall([' mmm ', 'm    ']), shut: tall([' mmm ', 'm   m']) }
const LOCK = ['yyyyyy', 'yykkyy', 'yykkyy', 'yyykyy', 'yyyyyy']
const locked = (pose: Body, shackle: keyof typeof SHACKLE, click: Spots = []): Art =>
  art(
    dots(scene(pose, [SHACKLE[shackle], SIDE - 1, 0], [LOCK, SIDE - 1, 4]), click, 'w'),
    scene(pose, [TEXT_SHACKLE[shackle], SIDE, TOP], [tall(['yyyyy', 'yy yy', 'yyyyy']), SIDE, TOP + 4]),
  )
const locking: Loop<Art> = [
  locked({ eyes: 'right' }, 'open'),
  locked({ eyes: 'right' }, 'shut', [[SIDE - 2, 1], [SIDE + 4, 0], [SIDE - 2, 3]]),
  locked({ eyes: 'left', left: 'down', right: 'down' }, 'shut'),
  locked({ eyes: 'shut', left: 'down', right: 'down' }, 'shut'),
]

// Failed: a bolt strikes, then Clawd reels with stars about the head.
const BOLT = ['   yy', '  yy ', ' yy  ', 'yyyy ', '  yy ', ' yy  ', 'yy   ', 'y    ']
const hit = (pose: Body): Art =>
  art(scene(pose, [BOLT, SIDE - 1, 0]), scene(pose, [tall(['  yy', ' yy ', 'yyyy', ' yy ', 'yy  ']), SIDE, TOP]))
const dizzy = (eyes: Body['eyes'], stars: Spots, textStars: Spots): Art => {
  const reeling = (): Grid => body({ left: 'down', right: 'down', eyes })
  return art(dots(reeling(), stars, 'y'), marks(reeling(), textStars, 'y'))
}
const reelLeft = dizzy('left', [[9, 2], [13, 1], [18, 2], [22, 4]], [[3, TOP], [SIDE + 2, TOP + 2]])
const reelRight = dizzy('right', [[11, 1], [15, 2], [19, 1], [5, 4]], [[1, TOP + 2], [SIDE + 4, TOP]])
const failed: Loop<Art> = [
  hit({ eyes: 'wide' }),
  hit({ left: 'up', right: 'up', eyes: 'shut' }),
  reelLeft,
  reelRight,
  reelLeft,
  art(body({ left: 'down', right: 'down', eyes: 'shut' })),
]

// Failed, flat out: a jolt, and he is on his back with his legs in the air.
const upended = (g: Grid): Grid => [...g.slice(0, TOP), ...g.slice(TOP).reverse()]
const crashing: Loop<Art> = [
  art(body({ eyes: 'wide' })),
  art(body({ y: 3, eyes: 'wide', left: 'up', right: 'up' }), body({ y: HOP, eyes: 'wide', left: 'up', right: 'up' })),
  art(upended(body({ eyes: 'wide' }))),
  art(upended(body({ eyes: 'shut', legs: 'stride' }))),
  art(upended(body({ eyes: 'shut' }))),
  art(upended(body({ eyes: 'shut', legs: 'stride' }))),
]

type PoseArt = {
  // What a screen reader hears, and what a terminal that cannot draw says.
  alt: string
  // The pose's animations: one is picked each time the pose is taken up.
  variants: Loop<Loop<Art>>
  // Played through once; then Clawd rests.
  once?: true
  // Shown whether or not a turn is running; any other pose is a turn's.
  outsideTurn?: true
}

export const POSES: Record<Pose, PoseArt> = {
  idle: { alt: 'Clawd resting', variants: [mug, dozing] },
  waiting: { alt: 'Clawd waiting for the reply', variants: [waiting, angling, spinner] },
  thinking: { alt: 'Clawd thinking', variants: [pondering, idea, turning] },
  questioning: { alt: 'Clawd asking', variants: [questioning, eitherOr] },
  working: { alt: 'Clawd working', variants: [hammering, laptop, cooking] },
  reading: { alt: 'Clawd reading', variants: [poring, reading] },
  writing: { alt: 'Clawd writing', variants: [writing] },
  running: { alt: 'Clawd running a command', variants: [running, playing] },
  searching: { alt: 'Clawd searching the web', variants: [searching, browsing, fetchingWeb] },
  delegating: { alt: 'Clawd handing off to a subagent', variants: [delegating, spawning, supervising] },
  compacting: { alt: 'Clawd compacting the conversation', variants: [pressing, archiving], outsideTurn: true },
  finished: { alt: 'Clawd done', variants: [ticking, flagging], once: true, outsideTurn: true },
  interrupted: { alt: 'Clawd interrupted', variants: [interrupted, bursting, stopped], once: true, outsideTurn: true },
  refused: { alt: 'Clawd declining', variants: [refused, locking], once: true, outsideTurn: true },
  failed: { alt: 'Clawd hit by an error', variants: [failed, crashing], once: true, outsideTurn: true },
}

// What can be drawn: a pose, or the plain body, which is no pose of the
// session's and shows for a frame while one pose gives way to the next.
export type Scene = Pose | 'plain'

export const SCENES: Record<Scene, PoseArt> = {
  ...POSES,
  plain: { alt: 'Clawd', variants: [[stand]], outsideTurn: true },
}

// What a loop shows at tick `n`.
export const frameAt = <T>(frames: Loop<T>, n: number): T => frames[n % frames.length] ?? frames[0]

// `roll` is any whole number: it picks among the scene's variants.
const variantOf = (scene: Scene, roll: number): Loop<Art> => frameAt(SCENES[scene].variants, roll)

// How many ticks the scene's variant takes to play through.
export const lengthOf = (scene: Scene, roll: number): number => variantOf(scene, roll).length

// Something that draws a scene's frame at tick `n`.
export type Draw<T> = (scene: Scene, roll: number, n: number) => T

// A frame is drawn when it is first shown, and a grid that comes up twice is
// drawn once: two equal frames are one value.
const drawing = <T>(form: keyof Art, draw: (grid: Grid) => T): Draw<T> => {
  const drawn = new Map<Grid, T>()
  return (scene, roll, n) => {
    const grid = frameAt(variantOf(scene, roll), n)[form]
    const made = drawn.get(grid) ?? draw(grid)
    drawn.set(grid, made)
    return made
  }
}

// Where the art starts on a canvas `width` pixels wide: his body, standing,
// on the canvas's middle, as far as the art stays whole.
const BODY_LEFT = (X + 1 - TEXT_LEFT) * SCALE
const BODY_WIDTH = 16 * SCALE
const artLeft = (width: number): number =>
  Math.max(0, Math.min(width - PIXEL_WIDTH, Math.round((width - BODY_WIDTH) / 2) - BODY_LEFT))

const toBase64 = (grid: Grid, colors: Record<string, Rgb>, width: number): string => {
  const px = new Uint8Array(width * PIXEL_HEIGHT * 4)
  const left = artLeft(width)
  // Each art pixel is a square of SCALE by SCALE picture pixels; the rows
  // under the art stay clear.
  for (let ay = 0; ay < PICTURE_HEIGHT; ay++) {
    for (let ax = 0; ax < PICTURE_WIDTH; ax++) {
      const rgb = colors[grid[TOP - 4 + ay]?.[TEXT_LEFT + ax] ?? '.']
      if (!rgb) continue
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          px.set([...rgb, 255], ((ay * SCALE + dy) * width + left + ax * SCALE + dx) * 4)
        }
      }
    }
  }
  return px.toBase64()
}

// Clawd as pictures: each frame a whole RGBA image, PIXEL_HEIGHT high and
// `width` wide, which is the art's own width or more.
export const picturesIn = (body: Rgb, width = PIXEL_WIDTH): Draw<Picture> => {
  const colors = { ...COLORS, '#': body }
  const canvas = Math.max(width, PIXEL_WIDTH)
  return drawing('picture', grid => ({ rgba: toBase64(grid, colors, canvas), width: canvas, height: PIXEL_HEIGHT }))
}

// Clawd as text, for where the terminal draws no picture. A cell of text holds
// two art columns by four art rows, one quadrant each, and the three rows are
// the CLI logo's own: the head, the arms, the feet.
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█' // by the quadrants lit: 1 top left, 2 top right, 4 and 8 under them

// A stretch of one row in one colour.
export type TextRun = { text: string; color: string }

export type TextFrame = readonly (readonly TextRun[])[]

const toText = (grid: Grid, colors: Record<string, string>, bodyColor: string): TextFrame =>
  Array.from({ length: TEXT_ROWS }, (_, row) => {
    const runs: TextRun[] = []
    for (let cell = 0; cell < TEXT_COLUMNS; cell++) {
      let lit = 0
      const props: Record<string, number> = {}
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const x = TEXT_LEFT + cell * 2 + (quadrant % 2)
        const y = TOP + row * 4 + (quadrant >> 1) * 2
        for (const key of [grid[y]?.[x], grid[y + 1]?.[x]]) {
          if (key === undefined || key === '.') continue
          lit |= 1 << quadrant
          if (key !== '#') props[key] = (props[key] ?? 0) + 1
        }
      }
      // A cell has one colour: its commonest prop's, over the body's, so a
      // thin prop shows.
      const prop = Object.entries(props).sort((a, b) => b[1] - a[1])[0]?.[0]
      const color = (prop && colors[prop]) || bodyColor
      const last = runs.at(-1)
      if (last && (lit === 0 || last.color === color)) last.text += QUADRANTS[lit]
      else runs.push({ text: QUADRANTS[lit] ?? ' ', color })
    }
    return runs
  })

const TEXT_COLORS = Object.fromEntries(Object.entries(COLORS).map(([key, rgb]) => [key, toHex(rgb)]))

// `bodyColor` is anything a Text takes as a colour: a theme key or a hex.
export const textIn = (bodyColor: string): Draw<TextFrame> =>
  drawing('text', grid => toText(grid, TEXT_COLORS, bodyColor))
