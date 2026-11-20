// Working, reading and writing: the poses of a hand at a task.
import { type Loop, type Spots, type Body, type Layer, type Art, stamp, fill, tall, dots, marks, TOP, SIDE, scene, art } from './core'

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
export const hammering: Loop<Art> = [
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
export const laptop: Loop<Art> = [
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
export const cooking: Loop<Art> = [
  cook('right', [['yyyy', 'llll'], SIDE, 6], [tall(['yyyy']), SIDE, TOP + 2]),
  cook('right', [['yyyy', 'llll'], SIDE, 3], [tall(['yyyy']), SIDE, TOP]),
  cook('right', [fill(1, 4, 'yl'), SIDE + 1, 0], [tall(['yl']), SIDE + 1, TOP]),
  cook('right', [['llll', 'yyyy'], SIDE, 3], [tall(['llll']), SIDE, TOP]),
  cook('shut', [['llll', 'yyyy'], SIDE, 6], [tall(['llll']), SIDE, TOP + 2]),
]

// Reading: a book held open, the eyes running along the line, then a page turns.
const BOOK = ['bbbbbb  bbbbbb', 'bmmmmbllbmmmmb', 'bbbbbbllbbbbbb', 'bmmmbbllbmmbbb']
const reader = (eyes: Body['eyes'], ...leaf: Layer[]): Art => art(scene({ eyes }, [BOOK, 7, 8], ...leaf))
export const reading: Loop<Art> = [
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
export const poring: Loop<Art> = [studying(0), studying(1), studying(2), studying(3)]

// Reading, a scroll: it unrolls a turn at a time, the eyes down it line by
// line, and rolls up again.
const unrolled = (turns: number, eyes: Body['eyes'] = 'right'): Art => {
  const picture = scene({ eyes }, [['llllll'], SIDE - 1, 1], [fill(6, turns * 2, 'b'), SIDE - 1, 2], [['llllll'], SIDE - 1, 2 + turns * 2])
  for (let line = 0; line < turns; line++) stamp(picture, ['kkkk'], SIDE, 3 + line * 2)
  const text = scene({ eyes }, [tall(['lllll', ...fill(5, turns, 'b'), 'lllll']), SIDE, TOP])
  for (let line = 0; line < turns - 1; line++) marks(text, [[SIDE + 1, TOP + 2 + line * 2]], 'k')
  return art(picture, text)
}
export const scrolling: Loop<Art> = [
  unrolled(1),
  unrolled(2),
  unrolled(3, 'left'),
  unrolled(3),
  unrolled(3, 'right'),
  unrolled(2),
  unrolled(1, 'shut'),
]

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
export const writing: Loop<Art> = [writer(1), writer(2), writer(3), writer(3, 2)]

// Writing, as a list is: a box at a time on a sheet is ticked off green.
const checked = (done: number, pose: Body = {}): Art => {
  const picture = scene({ eyes: 'right', ...pose }, [fill(6, 12, 'b'), SIDE - 1, 2])
  const text = scene({ eyes: 'right', ...pose }, [tall(fill(5, 6, 'b')), SIDE, TOP])
  for (let item = 0; item < 3; item++) {
    stamp(picture, fill(3, 3, item < done ? 'c' : 'k'), SIDE, 3 + item * 4)
    stamp(picture, ['kk'], SIDE + 4, 4 + item * 4)
    marks(text, [[SIDE + 1, TOP + item * 4]], item < done ? 'c' : 'k')
  }
  return art(picture, text)
}
export const checking: Loop<Art> = [
  checked(0),
  checked(1, { right: 'up' }),
  checked(1),
  checked(2, { right: 'up' }),
  checked(2),
  checked(3, { right: 'up' }),
  checked(3, { eyes: 'shut' }),
]
