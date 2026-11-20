// How a turn ends: finished, interrupted, refused, failed. Each is played once.
import { type Loop, type Spots, type Body, type Place, type Layer, type Art, stamp, fill, tall, dots, marks, TOP, SIDE, body, scene, art, HOP, stand } from './core'

// Finished: a green tick drawn beside the head, stroke by stroke, and a nod to it.
const TICK = ['      c', '     cc', 'c   cc ', 'cc cc  ', ' ccc   ', '  c    ']
const TEXT_TICK = tall(['    c', '   c ', 'c c  ', ' c   '])
const ticked = (eyes: Body['eyes'], strokes = 7): Art =>
  art(
    scene({ eyes }, [TICK.map(row => row.slice(0, strokes).padEnd(7)), SIDE - 2, 2]),
    scene({ eyes }, [TEXT_TICK.map(row => row.slice(0, strokes - 2).padEnd(5)), SIDE, TOP]),
  )
export const ticking: Loop<Art> = [ticked('right', 4), ticked('right'), ticked('shut'), ticked('open'), stand]

// Finished, as a race is: the chequered flag waved, then lowered.
const flagged = (cloth: string[]): Art =>
  art(
    scene({ right: 'up' }, [fill(1, 9, 'm'), SIDE - 1, 0], [cloth, SIDE, 0]),
    scene({ right: 'up' }, [tall(fill(1, 3, 'm')), SIDE - 1, TOP], [tall(cloth.slice(0, 2)), SIDE, TOP]),
  )
const FLAG = ['w w w', ' w w ', 'w w w', ' w w ']
const WAVED = [' w w ', 'w w w', ' w w ', 'w w w']
export const flagging: Loop<Art> = [flagged(FLAG), flagged(WAVED), flagged(FLAG), art(body({ eyes: 'shut' })), stand]

// Interrupted, as a player is: the play button is running its bar when it
// is cut off; the button flashes and the pause bars stay.
const BUTTON = [' mmmmm ', 'mmmmmmm', 'mmmmmmm', 'mmmmmmm', 'mmmmmmm', 'mmmmmmm', ' mmmmm ']
const GLYPH = { play: ['c', 'cc', 'c'], pause: ['w w', 'w w', 'w w'] }
const cutOff = (pose: Body, glyph: keyof typeof GLYPH | 'flash', lit: number, textPose: Body = pose): Art => {
  const key = glyph === 'flash' ? 'w' : 'm'
  const face = GLYPH[glyph === 'flash' ? 'pause' : glyph].map(row => row.replaceAll('w', glyph === 'flash' ? 'r' : 'w'))
  const picture = scene(pose, [BUTTON.map(row => row.replaceAll('m', key)), SIDE - 2, 1], [face, glyph === 'play' ? SIDE + 1 : SIDE, 3])
  const bar = 'c'.repeat(lit) + 'm'.repeat(6 - lit)
  stamp(picture, [bar], SIDE - 2, 9)
  const text = scene(textPose, [tall([` ${key.repeat(3)} `, `${key}${glyph === 'play' ? 'c' : 'w'}${key}${glyph === 'play' ? 'c' : 'w'}${key}`, ` ${key.repeat(3)} `]), SIDE, TOP])
  return art(picture, text)
}
export const pausing: Loop<Art> = [
  cutOff({ eyes: 'right' }, 'play', 2),
  cutOff({ eyes: 'right' }, 'play', 3),
  cutOff({ y: 3, eyes: 'wide', left: 'up', right: 'up' }, 'flash', 3, { y: HOP, eyes: 'wide', left: 'up', right: 'up' }),
  cutOff({ eyes: 'wide', left: 'up', right: 'up' }, 'pause', 3),
  cutOff({ eyes: 'right' }, 'pause', 3),
  cutOff({ eyes: 'shut', left: 'down', right: 'down' }, 'pause', 3),
]

// Interrupted, as a cable is: the plug is yanked from the wall, the socket
// sparking, and the cord falls limp.
const PLATE = ['bb', 'bk', 'bb', 'bk', 'bb']
const pulled = (plug: number, pose: Body, live: boolean, sparks: Spots = [], textSparks: Spots = []): Art => {
  const picture = scene(
    pose,
    [PLATE.map(row => row.replaceAll('k', live ? 'y' : 'k')), 26, 4],
    [fill(3, 5, 'm'), 22 + plug, 4],
    [['mm', '  ', 'mm'].map(row => row.replaceAll(' ', '.')), 25 + plug, 5],
    [['l', 'l'], 23 + plug, 9],
    [['l'], 22 + plug, 11],
  )
  const text = scene(pose, [tall(['bb', 'by']), 27, TOP], [tall(['mmm', 'mmm']), SIDE + plug, TOP + 2])
  return art(dots(picture, sparks, 'y'), marks(text, textSparks, 'y'))
}
export const unplugged: Loop<Art> = [
  pulled(0, { eyes: 'right' }, true),
  pulled(0, { eyes: 'wide', right: 'up' }, true),
  pulled(-2, { eyes: 'wide', right: 'up' }, false, [[25, 3], [25, 6], [24, 8], [27, 3]], [[SIDE + 2, TOP + 2], [SIDE + 3, TOP + 6]]),
  pulled(-2, { eyes: 'right', right: 'up' }, false),
  pulled(-2, { eyes: 'shut', left: 'down', right: 'down' }, false),
]

// Refused, as a sign is: the "no entry" sign swells up beside him as he shakes his head.
const DISC = [' rrrrr ', 'rrrrrrr', 'rwwwwwr', 'rwwwwwr', 'rrrrrrr', 'rrrrrrr', ' rrrrr ']
const SMALL_DISC = [' rrr ', 'rrrrr', 'rwwwr', 'rrrrr', ' rrr ']
const barred = (pose: Body, isSmall = false): Art =>
  art(
    scene(pose, isSmall ? [SMALL_DISC, SIDE - 1, 3] : [DISC, SIDE - 2, 1]),
    scene(pose, [tall([' rrr ', 'rwwwr', ' rrr ']), SIDE, TOP]),
  )
export const barring: Loop<Art> = [
  barred({ eyes: 'right' }, true),
  barred({ eyes: 'right' }),
  barred({ eyes: 'left', x: -1, left: 'down', right: 'down' }),
  barred({ eyes: 'right', x: 1, left: 'down', right: 'down' }),
  barred({ eyes: 'left', x: -1, left: 'down', right: 'down' }),
  barred({ eyes: 'shut', left: 'down', right: 'down' }),
]

// Refused, as a shield turns an arrow: it lands on the shield, glances off
// and drops away.
const SHIELD = ['mmmmm', 'mrrrm', 'mrrrm', 'mrrrm', ' mrm ', '  m  ']
const TEXT_SHIELD = tall([' mmm ', 'mrrrm', ' mrm '])
const deflected = (pose: Body, layers: Layer[] = [], textLayers: Layer[] = [], sparks: Spots = [], textSparks: Spots = []): Art =>
  art(
    dots(scene(pose, [SHIELD, SIDE - 2, 3], ...layers), sparks, 'y'),
    marks(scene(pose, [TEXT_SHIELD, SIDE, TOP], ...textLayers), textSparks, 'y'),
  )
const ARROW = ['w', 'l', 'l']
export const deflecting: Loop<Art> = [
  deflected({ eyes: 'right' }),
  deflected({ eyes: 'wide' }, [[ARROW, SIDE, 0]], [[tall(['w']), SIDE + 4, TOP]]),
  deflected({ eyes: 'wide', right: 'up' }, [[['l'], SIDE, 1]], [], [[SIDE - 2, 2], [SIDE + 2, 2], [SIDE, 1]], [[SIDE + 4, TOP]]),
  deflected({ eyes: 'right' }, [[['l', 'l', 'w'], SIDE + 4, 5]], [[tall(['l']), SIDE + 4, TOP + 4]]),
  deflected({ eyes: 'shut', left: 'down', right: 'down' }, [[['llw'], SIDE + 2, 12]], [[tall(['l']), SIDE + 4, TOP + 8]]),
]

// Failed, as a warning is: a triangle with its "!" flashes yellow and red, he
// breaks a sweat, and gives up.
const WARNING = ['   y   ', '  yyy  ', '  yky  ', ' yykyy ', ' yyyyy ', 'yyykyyy', 'yyyyyyy']
const alert = (pose: Body, key: string, drop: Spots = [], textPose: Body = pose): Art => {
  const textKey = key
  return art(
    dots(scene(pose, [WARNING.map(row => row.replaceAll('y', key)), SIDE - 2, 1]), drop, 'u'),
    scene(textPose, [tall(['  y  ', ' yky ', 'yykyy'].map(row => row.replaceAll('y', textKey))), SIDE, TOP]),
  )
}
export const warning: Loop<Art> = [
  alert({ y: 3, eyes: 'wide', left: 'up', right: 'up' }, 'y', [], { y: HOP, eyes: 'wide', left: 'up', right: 'up' }),
  alert({ eyes: 'wide' }, 'r'),
  alert({ eyes: 'right' }, 'y', [[20, 6]]),
  alert({ eyes: 'left' }, 'r', [[20, 8]]),
  alert({ eyes: 'right', left: 'down', right: 'down' }, 'y', [[20, 10]]),
  alert({ eyes: 'shut', left: 'down', right: 'down' }, 'y'),
]

// Failed, as a bug is: one crawls in along the floor, he sees it, and it
// climbs onto his head.
const BUG = [' r  r ', '  rr  ', ' rwwr ', 'rrrrrr', 'r rr r']
const crawled = (bug: Place, pose: Body, textAt: Place): Art =>
  art(scene(pose, [BUG, ...bug]), marks(scene(pose), [textAt, [textAt[0] + 1, textAt[1]]], 'r'))
export const bugged: Loop<Art> = [
  crawled([22, 9], { eyes: 'right' }, [SIDE + 3, TOP + 8]),
  crawled([21, 9], { eyes: 'right' }, [SIDE + 1, TOP + 8]),
  crawled([20, 9], { eyes: 'wide', left: 'up' }, [SIDE - 1, TOP + 8]),
  crawled([10, 0], { eyes: 'wide', left: 'up', right: 'up' }, [SIDE - 1, TOP + 6]),
  crawled([12, 0], { eyes: 'wide', left: 'up', right: 'up' }, [SIDE - 1, TOP + 6]),
  crawled([10, 0], { eyes: 'shut', left: 'down', right: 'down' }, [SIDE - 1, TOP + 6]),
]
