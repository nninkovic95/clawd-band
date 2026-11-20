// Resting, waiting, thinking and questioning: the poses of a turn that is not yet working.
import { type Loop, type Spots, type Body, type Place, type Art, stamp, tall, dots, marks, TOP, SIDE, body, scene, art, SMALL_Z, BIG_Z } from './core'

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
export const mug: Loop<Art> = [onBreak('open', 'left'), onBreak('open', 'right'), onBreak('shut', 'left'), onBreak('shut', 'right')]

// Idle, asleep: the eyes shut, a "z" drifting up from the head and growing.
const TEXT_Z = tall(['wwwww', '   w ', '  w  ', ' w   ', 'wwwww'])
export const dozing: Loop<Art> = [
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
export const waiting: Loop<Art> = [turned, turned, timing('half'), timing('spent'), timing('spent', 'shut'), tossed]

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
export const pondering: Loop<Art> = [cloud(1), cloud(2), fullCloud, fullCloud]

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
export const idea: Loop<Art> = [
  dim,
  dim,
  bulb({ eyes: 'right' }, 'dark'),
  bulb({ eyes: 'right', left: 'up' }, 'lit', true),
  bulb({ eyes: 'right', left: 'up' }, 'lit'),
  bulb({ eyes: 'right', left: 'up' }, 'lit', true),
]

// Thinking, as a machine does: two cogs beside the head, their teeth meshed,
// turning on each other. A cog is drawn from its shape, teeth round a body
// with an axle in the middle, so that it can stand at any part of a tooth.
type Cog = {
  width: number
  height: number
  teeth: number
  // How far out the body goes, and the tips of the teeth, in art pixels from the middle.
  body: number
  tip: number
  // How far out the rivets are, that turn with the cog and show which way it goes,
  // and how many: spread evenly, so that a loop of whole turns closes on them.
  rivet: number
  rivets: number
  // Art pixels a row is tall: the text's rows are two.
  rowHeight: number
}
const TAU = Math.PI * 2
const TOOTH = 0.28 // a tooth is this much of the way round its pitch, either side of its middle

// The cog turned `turn` turns clockwise from a tooth, and a rivet, straight to the right.
const cogRows = ({ width, height, teeth, body, tip, rivet, rivets, rowHeight }: Cog, turn: number, metal: string): string[] =>
  Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) => {
      const [middleX, middleY] = [(width - 1) / 2, (height - 1) / 2]
      const [dx, dy] = [column - middleX, (row - middleY) * rowHeight]
      const isRivet = Array.from({ length: rivets }, (_, k) => (turn + k / rivets) * TAU).some(
        angle =>
          column === Math.round(middleX + rivet * Math.cos(angle)) &&
          row === Math.round(middleY + (rivet * Math.sin(angle)) / rowHeight),
      )
      if (isRivet) return 'w'
      const reach = Math.hypot(dx, dy)
      if (reach < 0.5) return 'k'
      if (reach <= body) return metal
      if (reach > tip) return ' '
      const pitches = (Math.atan2(dy, dx) / TAU - turn) * teeth
      return Math.abs(pitches - Math.round(pitches)) <= TOOTH ? metal : ' '
    }).join(''),
  )

const BIG: Cog = { width: 7, height: 7, teeth: 6, body: 2.3, tip: 3.4, rivet: 1.5, rivets: 1, rowHeight: 1 }
const SMALL: Cog = { width: 5, height: 5, teeth: 4, body: 1.5, tip: 2.5, rivet: 1, rivets: 2, rowHeight: 1 }
// The text has room for the big one only, in its rows of two.
const TEXT_BIG: Cog = { ...BIG, height: 4, rowHeight: 2 }
const BIG_AT: Place = [SIDE - 2, 0]
const SMALL_AT: Place = [SIDE, 7]

// Where the two touch, as the big one sees it: the way to the small one.
const TOUCH = Math.atan2(SMALL_AT[1] + 2 - (BIG_AT[1] + 3), SMALL_AT[0] + 2 - (BIG_AT[0] + 3))
// How far the small cog has turned when the big one has turned `turn`: the
// other way, at the ratio of their teeth, and with a tooth of one in a gap of
// the other where they touch.
const smallTurn = (turn: number): number => {
  const bigTooth = (TOUCH / TAU - turn) * BIG.teeth
  return (TOUCH + Math.PI) / TAU - (0.5 - bigTooth) / SMALL.teeth
}

// A whole turn of the big cog, in frames: three to a tooth. The small cog goes
// round one and a half times in it, which its two rivets, half a turn apart, close on.
const TURN = BIG.teeth * 3
const cogs = (frame: number): Art => {
  const turn = frame / TURN
  const eyes = frame < TURN / 2 ? 'left' : 'right'
  return art(
    scene({ eyes, right: 'none' }, [cogRows(BIG, turn, 'm'), ...BIG_AT], [cogRows(SMALL, smallTurn(turn), 'y'), ...SMALL_AT]),
    scene({ eyes, right: 'none' }, [tall(cogRows(TEXT_BIG, turn, 'm')), SIDE - 2, TOP]),
  )
}
export const turning: Loop<Art> = [cogs(0), ...Array.from({ length: TURN - 1 }, (_, frame) => cogs(frame + 1))]

// Questioning: a hand up and a "?" beside the head, bobbing in the picture.
const QUESTION = [' yyy ', 'yy yy', '   yy', '  yy ', ' yy  ', ' yy  ', '     ', ' yy  ']
const asking = (eyes: Body['eyes'], y: number): Art =>
  art(
    scene({ eyes, left: 'up' }, [QUESTION, SIDE - 1, y]),
    scene({ eyes, left: 'up' }, [tall(['yyyy ', '   yy', ' yy  ', '     ', ' yy  ']), SIDE, TOP]),
  )
const askLow = asking('open', 1)
const askHigh = asking('right', 0)
export const questioning: Loop<Art> = [askLow, askLow, askHigh, askHigh]

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
export const eitherOr: Loop<Art> = [offering('open', 0, 0), offering('left', 2, 0), offering('open', 0, 0), offering('right', 0, 2)]
