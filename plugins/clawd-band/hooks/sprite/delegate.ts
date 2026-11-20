// Delegating to a subagent and compacting the conversation.
import { type Grid, type Loop, type Arm, type Body, type Place, type Layer, type Art, blank, stamp, fill, tall, dots, marks, X, TOP, SIDE, body, scene, art, HOP, SMALL_Z, BIG_Z } from './core'

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
export const delegating: Loop<Art> = [
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
export const spawning: Loop<Art> = [art(body({ x: BOSS, eyes: 'shut', left: 'down', right: 'down' })), emerging, popped, spawned]

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
export const supervising: Loop<Art> = [
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
export const pressing: Loop<Art> = [
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
export const archiving: Loop<Art> = [
  sinking(HOP, 'out'),
  sinking(TOP, 'up'),
  sinking(TOP + 2, 'up', 'shut'),
  lidded(BOX_TOP - 2),
  lidded(BOX_TOP - 1),
  art(dots(packed(), [[7, 8], [20, 8], [5, 11], [22, 11], [13, 6]], 'y'), marks(packed(), [[7, TOP + 4], [20, TOP + 4], [13, TOP + 2]], 'y')),
]
