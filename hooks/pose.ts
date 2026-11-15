import type { Pose } from '../types'
import { lengthOf, POSES } from './sprite'
import type { Scene } from './sprite'

// Which pose Clawd shows when. The poses the session wants go in as they come,
// the frame timer's ticks go in one by one, and the pose, variant and frame to
// draw come out. Time is counted in ticks, never in milliseconds, so a change
// lands on a frame's edge and every frame has its whole tick on screen.

export type Rules = {
  // Frames a pose plays before another may take its place: one loop of most.
  hold: number
  // Frames `waiting` must stay wanted before it takes an activity's place. The
  // wait between two tool calls is mostly shorter, so the pose plays on.
  linger: number
  // Frames of the plain body between two poses: one prop is put away before
  // the next is taken up, and what is wanted meanwhile settles to one pose.
  bridge: number
  // Frames a pose that left the screen keeps its variant for, so coming back
  // to it a moment later is the same animation going on.
  keep: number
  // Off, every pose holds its first frame; a pose that plays once still ends on time.
  animate: boolean
  // Off, every pose plays its first variant.
  vary: boolean
}

export const RULES: Rules = { hold: 4, linger: 5, bridge: 1, keep: 25, animate: true, vary: true }

export type Flow = {
  // The pose on screen, or the one leaving it while `bridge` counts down.
  pose: Pose
  roll: number
  // Frames of the pose that have played.
  age: number
  // The pose cut in between two ticks: its first frame stays through the next
  // tick, so no frame is shorter than a tick.
  isFresh: boolean
  // Frames of the plain body still to show, and the pose they were begun for.
  bridge: number
  toward: Pose | null
  // The pose the conversation itself is in: the last it asked for.
  main: Pose
  // An activity of the conversation's that has not had its turn on screen.
  // One place: of several wanted meanwhile, only the latest is still true.
  owed: Pose | null
  // The tick `main` became `waiting` at.
  waitingSince: number
  // A subagent's tool, shown while the conversation has nothing new of its
  // own, until the conversation asks for a pose again.
  glance: Pose | null
  ticks: number
  // The variant each pose had when it last left the screen, and the tick it left at.
  left: Partial<Record<Pose, { roll: number; at: number }>>
  seed: number
}

// What is on screen: a pose, or the plain body between two.
export type Shown = { pose: Scene; roll: number; frame: number }

export const BETWEEN: Shown = { pose: 'plain', roll: 0, frame: 0 }

export const view = (flow: Flow, rules: Rules = RULES): Shown =>
  flow.bridge > 0 ? BETWEEN : { pose: flow.pose, roll: flow.roll, frame: rules.animate ? flow.age : 0 }

// A small generator kept in the flow, so the same wants and ticks always show
// the same thing. The low bits of its numbers repeat too soon to pick a variant.
const mix = (seed: number): number => (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
const rollOf = (seed: number): number => seed >>> 16

// The opening pose plays its first variant.
export const start = (seed: number, pose: Pose = 'idle'): Flow => ({
  pose,
  roll: 0,
  age: 0,
  isFresh: false,
  bridge: 0,
  toward: null,
  main: pose,
  owed: null,
  waitingSince: 0,
  glance: null,
  ticks: 0,
  left: {},
  seed: mix(seed | 0),
})

const playsOnce = (pose: Pose): boolean => POSES[pose].once === true

// Poses that cannot wait their turn: the turn is over (its ending, or rest),
// or a question dialog is opening, which freezes the band on the frame it shows.
const cutsIn = (pose: Pose): boolean => pose === 'idle' || pose === 'questioning' || playsOnce(pose)

// Poses with nothing to play out: whatever is wanted next takes their place at once.
const isRest = (pose: Pose): boolean => pose === 'idle' || playsOnce(pose)

// Puts a pose on screen from its first frame. A pose that plays once always
// starts in a variant of its own; any other keeps the one it left with a
// moment ago.
const takeUp = (flow: Flow, pose: Pose, isFresh: boolean, rules: Rules): Flow => {
  const left = { ...flow.left, [flow.pose]: { roll: flow.roll, at: flow.ticks } }
  const kept = playsOnce(pose) ? undefined : left[pose]
  const isKept = kept !== undefined && flow.ticks - kept.at <= rules.keep
  const seed = isKept ? flow.seed : mix(flow.seed)
  return {
    ...flow,
    pose,
    roll: isKept ? kept.roll : rules.vary ? rollOf(seed) : 0,
    age: 0,
    isFresh,
    bridge: 0,
    toward: null,
    owed: flow.owed === pose ? null : flow.owed,
    left,
    seed,
  }
}

// The session wants a pose: the conversation's own, or a glance at a
// subagent's tool. Most wait for the pose on screen to have its hold; see
// `cutsIn` and `isRest` for the ones that show at once.
export const want = (flow: Flow, pose: Pose, isGlance = false, rules: Rules = RULES): Flow => {
  // An ending plays through: a glance does not cut it short, and rest follows it anyway.
  if (playsOnce(flow.pose) && (isGlance || pose === 'idle')) return flow
  if (isGlance) {
    const glanced = { ...flow, glance: pose }
    return isRest(flow.pose) && pose !== flow.pose ? takeUp(glanced, pose, true, rules) : glanced
  }
  // Whatever the conversation asks for ends the glance.
  const base = {
    ...flow,
    main: pose,
    glance: null,
    waitingSince: pose === 'waiting' && flow.main !== 'waiting' ? flow.ticks : flow.waitingSince,
  }
  const isShowing = pose === base.pose && base.bridge === 0
  if (cutsIn(pose) || isRest(base.pose)) {
    const settled = { ...base, owed: null }
    return isShowing && !playsOnce(pose) ? settled : takeUp(settled, pose, true, rules)
  }
  // Waiting is what is left when an activity ends, so it never takes the
  // place of an activity that has not had its turn: it comes after it.
  if (pose === 'waiting') return base
  return { ...base, owed: isShowing ? null : pose }
}

// The pose that should take the screen from the one on it, if any: what the
// conversation has not shown yet, then a glance, then the pose the
// conversation is in, which is waiting only once it has lingered.
const wantedNext = (flow: Flow, rules: Rules): Pose | null => {
  const isOther = (pose: Pose | null): pose is Pose => pose !== null && pose !== flow.pose
  if (isOther(flow.owed)) return flow.owed
  if (flow.glance !== null) return isOther(flow.glance) ? flow.glance : null
  if (!isOther(flow.main)) return null
  return flow.main !== 'waiting' || flow.ticks - flow.waitingSince >= rules.linger ? flow.main : null
}

// What follows the plain body: the pose wanted by then, which may be a newer
// one than the body was begun for. With nothing else wanted any more, the
// pose it was begun for still shows, since its props are half taken up;
// only waiting is not worth that, and the pose that was leaving comes back.
const afterBridge = (flow: Flow, rules: Rules): Pose =>
  wantedNext(flow, rules) ?? (flow.toward !== null && flow.toward !== 'waiting' ? flow.toward : flow.pose)

// One tick of the frame timer.
export const play = (flow: Flow, rules: Rules = RULES): Flow => {
  const now = { ...flow, ticks: flow.ticks + 1 }
  if (now.bridge > 1) return { ...now, bridge: now.bridge - 1 }
  if (now.bridge === 1) return takeUp(now, afterBridge(now, rules), false, rules)
  if (now.isFresh) return { ...now, isFresh: false }
  const aged = { ...now, age: now.age + 1 }
  if (playsOnce(aged.pose)) {
    if (aged.age < lengthOf(aged.pose, aged.roll)) return aged
    // A pose that plays once has played: Clawd rests.
    return takeUp({ ...aged, main: 'idle', owed: null, glance: null }, 'idle', false, rules)
  }
  if (aged.pose === 'idle' || aged.age < rules.hold) return aged
  const target = wantedNext(aged, rules)
  if (target === null) return aged
  if (rules.bridge === 0) return takeUp(aged, target, false, rules)
  return { ...aged, bridge: rules.bridge, toward: target }
}
