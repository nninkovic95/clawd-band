import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, Timer, TurnCompleteReason } from 'claude-code'

import type { Model, Pose } from '../types'
import { band, fit, PROBE, rowsOf } from './band'
import type { Clawd } from './band'
import { play, RULES, start, view, want } from './pose'
import type { Flow, Rules } from './pose'
import { offerCommand, settingsPanel } from './panel'
import { boxPixels } from './picture'
import type { Picture } from './picture'
import { settings } from './settings'
import type { Settings } from './settings'
import { BOX_COLUMNS, BOX_ROWS, picturesIn, PIXEL_HEIGHT, POSES, SCENES, textIn } from './sprite'
import type { Draw, Scene, TextFrame } from './sprite'
import { field, resetExpired, setUsage, syncUsage } from './usage'

const poseAtom = atom({ plugin: 'clawd-band', key: 'pose' } as const, 'idle')
// Written by usage.ts; an atom is named in each file that reads it.
const usageAtom = atom({ plugin: 'clawd-band', key: 'usage' } as const, null)
const modelAtom = atom({ plugin: 'clawd-band', key: 'model' } as const, { name: null, effort: null })
// When the main thread's last reply came back: the prompt cache's clock.
const cacheAtom = atom({ plugin: 'clawd-band', key: 'cacheAt' } as const, null)

const FRAME_MS = 400 // stop-motion: a few frames, each held
const GLANCE_MS = 1_000 // how long a subagent's tool stays wanted as a glance
const DOCS_PREFIX = 'mcp__claude_ai_Claude_Docs__'

const READING = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch']
const WRITING = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const RUNNING = ['Bash', 'BashOutput', 'KillShell', 'TaskStop']
const SEARCHING = ['WebFetch', 'WebSearch']
const DELEGATING = ['Agent', 'Task', 'SendMessage', 'Workflow', 'Skill']
const DOCS_READING = ['read', 'query', 'guide']

export const poseFor = (tool: string): Pose => {
  if (tool === 'AskUserQuestion') return 'questioning'
  if (tool.startsWith(DOCS_PREFIX)) return DOCS_READING.includes(tool.slice(DOCS_PREFIX.length)) ? 'reading' : 'writing'
  if (READING.includes(tool)) return 'reading'
  if (WRITING.includes(tool)) return 'writing'
  if (RUNNING.includes(tool)) return 'running'
  if (SEARCHING.includes(tool)) return 'searching'
  if (DELEGATING.includes(tool)) return 'delegating'
  return 'working'
}

// How a turn ended, as the pose that plays once after it.
const ENDINGS: Record<TurnCompleteReason, Pose> = {
  answer: 'finished',
  aborted: 'interrupted',
  refusal: 'refused',
  error: 'failed',
}

// What the band shows for a pose. A turn's pose outside a turn is rest, so a
// turn end that was missed, or a reload, cannot leave Clawd at work.
export const shownPose = (pose: Scene, isWorking: boolean): Scene =>
  isWorking || SCENES[pose].outsideTurn ? pose : 'idle'

const EFFORT_HINT = /\s*(?:·\s*)?●?\s*\b(?:low|medium|high|xhigh|max)\s*·\s*\/effort\b(?:\s*·)?\s*/

// The hint line under the prompt without its effort pill (`● high · /effort`),
// which the model line under Clawd already shows; null when it has none.
export const withoutEffort = (hint: string): string | null =>
  EFFORT_HINT.test(hint) ? hint.replace(EFFORT_HINT, ' ').trim() : null

// "claude-opus-5-5" -> "Opus 5.5"; a name already shown as words is kept.
export const shortModel = (model: string): string => {
  const [, family, major, minor] = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model) ?? []
  if (!family || !major) return model
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

async function setModel($: EngineInterface, next: Partial<Model>) {
  let changed: Model | null = null
  await update($, modelAtom, (current: Model | undefined) => {
    const base = current ?? { name: null, effort: null }
    const merged = { name: next.name ?? base.name, effort: next.effort ?? base.effort }
    if (merged.name === base.name && merged.effort === base.effort) return base
    changed = merged
    return merged
  })
  if (changed) await $.store.set('model', changed)
}

// session.measure is raised only when a window moves a whole point, so a new
// reset time at the same percent (a window that reset and started again) never
// reaches it: after each turn the band reads the session's latest reading too.
async function refreshUsage($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  await setUsage($, rateLimits, await $.clock.now())
}

// Clawd's pictures on a canvas the shape of his box of cells.
const boxedPictures = ({ spriteRgb, cellRatio }: Settings): Draw<Picture> =>
  picturesIn(spriteRgb, boxPixels(BOX_COLUMNS, BOX_ROWS, cellRatio, PIXEL_HEIGHT / BOX_ROWS).width)

// Set by register from the person's options; a change there reloads the module.
let config = settings({})
let drawPicture = boxedPictures(config)
let drawText = textIn(config.spriteColor)

// The pose rules, with the person's say on motion.
const rulesOf = (): Rules => ({ ...RULES, animate: config.animate, vary: config.randomPoses })
let rules = rulesOf()

const newFlow = (pose?: Pose): Flow => start(Math.floor(Math.random() * 0x7fffffff), pose)

// The timer reads these between draws; a reload starts them over.
const live: {
  // What the band draws: the pose or the plain body between two, its variant
  // and its frame, as `flow` shows them.
  pose: Scene
  roll: number
  frame: number
  // Which pose shows when: the wanted poses go in, the three values above come out.
  flow: Flow
  // The pose the session is in: what was last asked for, which the screen follows.
  wanted: Pose
  // The pose the conversation itself last took, under any a subagent set.
  main: Pose
  // Counts the times the pose was set: see setPose.
  claim: number
  // The conversation's own tool calls still running, oldest first.
  tools: { pose: Pose; claim: number }[]
  isCompacting: boolean
  isWorking: boolean
  bandId: string | null
  // Whether the terminal draws pictures, as far as the last probes say.
  pictures: boolean
  // The form the band last drew Clawd in: it picks what fits its width.
  form: 'picture' | 'text' | null
  drawn: TextFrame | null
  // The picture last sent to the band, so an unchanged frame is not sent again.
  sent: Picture | null
  refusals: number
  // The context's estimated tokens while no reply has measured it, asked for once.
  estimate: Promise<number | null> | null
  sessionId: string | null
  isModelLoaded: boolean
  timer: Timer | null
  tickedAt: number
  second: number
} = {
  pose: 'idle',
  roll: 0,
  frame: 0,
  flow: newFlow(),
  wanted: 'idle',
  main: 'idle',
  claim: 0,
  tools: [],
  isCompacting: false,
  isWorking: false,
  bandId: null,
  pictures: true,
  form: null,
  drawn: null,
  sent: null,
  refusals: 0,
  estimate: null,
  sessionId: null,
  isModelLoaded: false,
  timer: null,
  tickedAt: 0,
  second: 0,
}

const shown = (): Scene => shownPose(live.pose, live.isWorking)

// A picture is wanted wherever the terminal draws one: Clawd's, or the bars'.
const wantsPictures = (): boolean => config.sprite === 'picture' || config.barStyle.isPicture === true

// Copies what the flow shows into the values the band draws from, and answers
// whether any of them changed.
const show = (): boolean => {
  const { pose, roll, frame } = view(live.flow, rules)
  const isChanged = pose !== live.pose || roll !== live.roll || frame !== live.frame
  live.pose = pose
  live.roll = roll
  live.frame = frame
  return isChanged
}

// The one place the pose changes: what the flow is asked for, and the state
// other mods can read, which is the wanted pose, ahead of the screen. It
// answers a number that stays `live.claim` until the pose is set again, so
// whoever set a pose can hand it back only while it is still theirs.
async function setPose($: EngineInterface, next: Pose, isSubagent = false): Promise<number> {
  live.claim += 1
  const claim = live.claim
  if (!isSubagent) live.main = next
  live.flow = want(live.flow, next, isSubagent, rules)
  // Only a pose that cuts in changes the screen here; any other waits for a tick.
  if (show()) $.ui.invalidate('ui.render')
  if (next !== live.wanted) {
    live.wanted = next
    await update($, poseAtom, () => next)
  }
  return claim
}

async function handBack($: EngineInterface, claim: number, next: Pose) {
  if (live.claim === claim) await setPose($, next)
}

// How the engine words its refusal to swap a picture the terminal cannot draw:
// a background session, or a terminal without kitty graphics.
const NO_PICTURE = 'the Image draws its alt here'
const REFUSALS = 3 // in a row: the first swaps can come before the terminal has answered

// Asks the terminal whether it draws pictures, by a swap of the band's
// one-cell picture: once a second, and each tick while refusals are being
// counted. A few refusals in a row and the band draws in text; one swap taken
// and it draws pictures again, so a terminal that comes back from where it
// could draw none gets its pictures back.
async function probe($: EngineInterface, isNewSecond: boolean) {
  if (!live.bandId || !wantsPictures()) return
  const isCounting = live.pictures && live.refusals > 0
  if (!isNewSecond && !isCounting) return
  const answer = await $.ui.blit({ requestId: live.bandId, key: 'probe', source: PROBE }).catch(() => null)
  // A band taken down between draws refuses too, which says nothing of pictures.
  if (answer === null || (answer.deny !== undefined && !answer.deny.includes(NO_PICTURE))) return
  live.refusals = answer.deny === undefined ? 0 : live.refusals + 1
  const pictures = live.refusals < REFUSALS
  if (pictures === live.pictures) return
  live.pictures = pictures
  // The band is drawn anew in the other form: no picture of the old one counts as sent.
  live.sent = null
  $.ui.invalidate('ui.render')
}

// The next frame of the pose: a picture swapped in place, or, where Clawd is
// text, a redraw once the text on screen is no longer the frame to show.
async function showFrame($: EngineInterface) {
  if (!live.bandId) return
  if (live.form === 'text') {
    if (drawText(shown(), live.roll, live.frame) !== live.drawn) $.ui.invalidate('ui.render')
    return
  }
  if (live.form !== 'picture') return
  const source = drawPicture(shown(), live.roll, live.frame)
  if (source === live.sent) return
  // A band taken down between draws refuses too; the next render places it again.
  const answer = await $.ui.blit({ requestId: live.bandId, key: 'clawd', source }).catch(() => null)
  // Only a picture the band took counts as sent: one it refused goes again.
  live.sent = answer !== null && answer.deny === undefined ? source : null
}

// The context window's fill. Before a session's first reply the engine has no
// figure for it, so the band shows the estimate /context would make, which
// costs no request.
async function contextOf($: EngineInterface): Promise<SessionContextUsage | undefined> {
  const context = (await $.session.usage().catch(() => null))?.context
  if (!context || context.percent !== undefined) {
    live.estimate = null
    return context
  }
  live.estimate ??= $.session.usage({ breakdown: 'summary' }).then(
    usage => usage.context.breakdown?.totalTokens ?? null,
    () => null,
  )
  const tokens = await live.estimate
  if (tokens === null || context.window <= 0) return context
  return { ...context, percent: Math.min(100, Math.round((tokens / context.window) * 100)) }
}

async function loadModel($: EngineInterface) {
  const name = await $.session.model()
  const stored = await $.store.get('model')
  // The stored effort belongs to the stored model; another model may differ.
  const effort = field(stored, 'name') === name ? field(stored, 'effort') : undefined
  await setModel($, { name, effort: typeof effort === 'string' ? effort : undefined })
}

// A /clear goes on in the same process under a new session id, with empty
// $.state and no session.start: a changed id loads the model again, and the
// usage with it. A load that failed is tried again the next second.
async function everySecond($: EngineInterface, now: number) {
  const id = await $.session.id().catch(() => '')
  if (id !== live.sessionId) {
    live.sessionId = id
    live.isModelLoaded = false
  }
  if (!live.isModelLoaded) {
    await loadModel($).then(
      () => {
        live.isModelLoaded = true
      },
      () => undefined,
    )
  }
  // The account is asked only for a row that shows.
  if (config.showWeekly || config.showFiveHour) await syncUsage($, now, id)
}

// One timer drives the band: a frame each period and, when the clock's second
// changes, the once-a-second work and a redraw for the countdowns.
async function tick($: EngineInterface) {
  live.tickedAt = Date.now()
  const drawn = live.pose
  live.flow = play(live.flow, rules)
  show()
  // A new pose is drawn again whole, so the picture's alt and the next
  // repaint are of the pose on screen; its frames after that are swapped in.
  if (live.pose !== drawn) $.ui.invalidate('ui.render')
  // A pose that plays once has played and Clawd rests: the session is at rest too.
  if (POSES[live.wanted].once && live.flow.pose === 'idle') await setPose($, 'idle')
  // A compaction whose end the spinner did not tell: no turn is running, so it is over.
  if (live.main === 'compacting' && !live.isWorking) await setPose($, 'idle')
  const now = await $.clock.now()
  const second = Math.floor(now / 1000)
  const isNewSecond = second !== live.second
  if (isNewSecond) {
    live.second = second
    void everySecond($, now).catch(() => undefined)
    $.ui.invalidate('ui.render')
  }
  await probe($, isNewSecond)
  await showFrame($)
}

const STALLED_MS = 2_000

const seedPose = (pose: Pose) => {
  if (live.claim > 0) return
  live.wanted = pose
  live.main = pose
  live.flow = newFlow(pose)
  show()
}

// Called by every hook. A resumed session can load the module without raising
// session.start, and a timer period the engine refuses ends that timer: the
// first hook to run starts the timer, and any later one restarts a stalled one.
function ensureStarted($: EngineInterface) {
  if (live.timer && Date.now() - live.tickedAt < STALLED_MS) return
  if (!live.timer) {
    // A module loaded again mid-session takes up the pose the last one left.
    void read($, poseAtom).then(seedPose, () => undefined)
    void offerCommand($).catch(() => undefined)
  }
  live.timer?.cancel()
  live.tickedAt = Date.now()
  live.timer = $.clock.every(FRAME_MS, () => void tick($).catch(() => undefined))
  $.clock.after(0, () => void tick($).catch(() => undefined))
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  config = settings(options)
  drawPicture = boxedPictures(config)
  drawText = textIn(config.spriteColor)
  rules = rulesOf()
  settingsPanel(on)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    ensureStarted($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    ensureStarted($)
    if (e.changed.includes('rateLimits')) await setUsage($, e.rateLimits, await $.clock.now())
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    ensureStarted($)
    // A subagent's turn is not the conversation's. The turn opens on the
    // wait for its first reply, the pose its first step asks for too.
    if (e.agentId === undefined) await setPose($, 'waiting')
    return next(e)
  })

  // The main thread's stream says when the model is thinking, writing, or
  // starting a tool call, and until its first word Clawd waits; subagents'
  // streams are passed through untouched.
  on('turn.step', async function* ($, e, next) {
    ensureStarted($)
    const stream = next(e)
    if (e.agentId) return yield* stream
    await setModel($, { name: e.model, effort: e.effort === undefined ? undefined : String(e.effort) })
    await setPose($, 'waiting')
    for await (const chunk of stream) {
      if (chunk.kind === 'thinking') await setPose($, 'thinking')
      else if (chunk.kind === 'text') await setPose($, 'working')
      else if (chunk.kind === 'tool') await setPose($, poseFor(chunk.name))
      yield chunk
    }
    const result = await stream.result
    // A reply that came back read or wrote the cache: its entry lives on from here.
    if (result.usage) {
      const now = await $.clock.now()
      await update($, cacheAtom, () => now)
    }
    return result
  })

  // Hold the pose while the tool runs (an AskUserQuestion waits on the person).
  on('tool.call', async ($, e, next) => {
    ensureStarted($)
    const tool = String(e.tool)
    if (e.agentId !== undefined) {
      // The turn's ending plays through: a subagent still at work does not cut it short.
      if (POSES[live.main].once) return next(e)
      // A subagent's tool gets a glance; then Clawd is back at what the
      // conversation itself is doing, unless that has moved on meanwhile.
      const claim = await setPose($, poseFor(tool), true)
      $.clock.after(GLANCE_MS, () => void handBack($, claim, live.main).catch(() => undefined))
      return next(e)
    }
    const running = { pose: poseFor(tool), claim: 0 }
    running.claim = await setPose($, running.pose)
    live.tools.push(running)
    try {
      return await next(e)
    } finally {
      live.tools = live.tools.filter(other => other !== running)
      // A tool that ends late leaves a newer pose be. One that still has the
      // pose hands it to a tool running beside it, which holds it from then
      // on, or else to the wait for the next reply.
      const beside = live.tools.at(-1)
      if (live.claim === running.claim) {
        const claim = await setPose($, beside?.pose ?? 'waiting')
        if (beside) beside.claim = claim
      }
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    ensureStarted($)
    // Only the conversation's own turn has an ending; `reason` is all that is read of it.
    // With the endings turned off, the turn's end is rest.
    if (e.agentId === undefined) await setPose($, config.turnEndings ? ENDINGS[e.reason] : 'idle')
    await refreshUsage($).catch(() => undefined)
    return next(e)
  })

  // The sprite is the only thing moving: the native spinner draws empty,
  // unless the person keeps it. Its message is the one sign of a compaction
  // a mod is given.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    ensureStarted($)
    const isCompacting = /compact/i.test(e.props.message ?? '')
    if (isCompacting !== live.isCompacting) {
      live.isCompacting = isCompacting
      const turnPose = async () => {
        if (isCompacting) await setPose($, 'compacting')
        // The turn goes on with a new reply to wait for; with no turn, Clawd rests.
        else if (live.main === 'compacting') await setPose($, live.isWorking ? 'waiting' : 'idle')
      }
      // After the draw: state set while a hook draws is dropped.
      $.clock.after(0, () => void turnPose().catch(() => undefined))
    }
    if (e.surface !== 'terminal' || config.keepSpinner) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // A rewritten hint is drawn as plain text, so only a line with the pill is touched.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    ensureStarted($)
    const hint = config.showModel ? withoutEffort(e.props.hint) : null
    return hint === null ? next(e) : next({ ...e, props: { ...e.props, hint } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    ensureStarted($)
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      live.bandId = null
      return next(e)
    }

    live.bandId = e.requestId
    live.isWorking = e.props.isWorking
    const now = await $.clock.now()
    // A window that resets mid-session drops to 0% on the next tick, not the next reply.
    const usage = resetExpired(await read($, usageAtom), now)
    const model = await read($, modelAtom)
    const cacheAt = await read($, cacheAtom)
    const context = await contextOf($)

    const current = shown()
    const pictures = wantsPictures() ? live.pictures : null
    const text = drawText(current, live.roll, live.frame)
    // No picture where the terminal draws none, or the person asked for text.
    const picture = pictures && config.sprite === 'picture' ? { source: drawPicture(current, live.roll, live.frame), alt: SCENES[current].alt } : null
    const clawd: Clawd | null = config.sprite === 'off' ? null : { text, picture }
    const name = model.name ? shortModel(model.name) : '--'
    const rows = rowsOf({ usage, context, cacheAt, now }, config)
    // Everything turned off: the row above the prompt is not the mod's.
    if (!clawd && !config.showModel && rows.length === 0) return next(e)
    const view = {
      columns: e.props.bodyColumns,
      pictures,
      clawd,
      model: config.showModel ? { name, effort: model.effort } : null,
      rows,
    }
    live.form = fit(view)?.form ?? null
    live.drawn = live.form === 'text' ? text : null
    return band(view, config, $.ui.resolve(e))
  })
}
