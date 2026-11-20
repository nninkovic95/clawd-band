import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, Timer, TurnCompleteReason } from 'claude-code'

import type { Model, Pose } from '../types'
import { band, fit, rowsOf } from './band'
import { estimatedTokens, syncContext } from './context'
import type { Clawd } from './band'
import { poser, RULES } from './pose'
import type { Rules } from './pose'
import { offerCommand, settingsPanel } from './panel'
import { boxPixels } from './picture'
import type { Picture } from './picture'
import { settings } from './settings'
import type { Settings } from './settings'
import { terminal } from './terminal'
import type { Screen } from './terminal'
import { BOX_COLUMNS, BOX_ROWS, picturesIn, PIXEL_HEIGHT, SCENES, textIn } from './sprite'
import type { Draw, Scene } from './sprite'
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

// The one owner of the pose state; a reload starts it over.
const freshSeed = (): number => Math.floor(Math.random() * 0x7fffffff)
const posing = poser(rulesOf(), freshSeed())

// The timer reads these between draws; a reload starts them over.
const live: {
  isCompacting: boolean
  isWorking: boolean
  bandId: string | null
  sessionId: string | null
  isModelLoaded: boolean
  timer: Timer | null
  tickedAt: number
  second: number
  // The rows of the last draw, as text: a second that leaves them so draws nothing.
  rowsDrawn: string | null
} = {
  isCompacting: false,
  isWorking: false,
  bandId: null,
  sessionId: null,
  isModelLoaded: false,
  timer: null,
  tickedAt: 0,
  second: 0,
  rowsDrawn: null,
}

// What the band draws: the pose or the plain body between two, in its variant and its frame.
const scene = (): Scene => shownPose(posing.shown.pose, live.isWorking)
const drawn = <T,>(draw: Draw<T>): T => {
  const { roll, frame } = posing.shown
  return draw(scene(), roll, frame)
}

// A picture is wanted wherever the terminal draws one: Clawd's, or the bars'.
const wantsPictures = (): boolean => config.sprite === 'picture' || config.barStyle.isPicture === true

// Tells the screen and the other mods what the poser's last change leaves to
// tell: the screen redrawn where a pose cut in, and the wanted pose, ahead of
// the screen, in the state other mods can read.
async function publish($: EngineInterface) {
  const { screen, wanted } = posing.takeChange()
  if (screen) $.ui.invalidate('ui.render')
  if (wanted !== null) await update($, poseAtom, () => wanted)
}

// A change to the poser, published at once: nothing runs between the two, so
// no pose it takes is left unwritten for the next.
async function settled<T>($: EngineInterface, change: () => T): Promise<T> {
  const result = change()
  await publish($)
  return result
}

// The conversation takes a pose.
const ask = ($: EngineInterface, pose: Pose) => settled($, () => posing.want(pose))

// The pictures the band sends, and what it knows of the terminal drawing them;
// a reload starts it over.
const screen = terminal()

// A picture is probed where the terminal might not draw it; the band asks it each tick.
// The engine's screen, spelled where `$` is called: the engine follows `$` no further.
const screenOf = ($: EngineInterface): Screen => ({
  blit: args => $.ui.blit(args),
  invalidate: name => $.ui.invalidate(name),
})

const probe = ($: EngineInterface, isNewSecond: boolean) =>
  live.bandId && wantsPictures() ? screen.probe(screenOf($), live.bandId, isNewSecond) : undefined

const showFrame = ($: EngineInterface) =>
  live.bandId ? screen.showFrame(screenOf($), live.bandId, { picture: () => drawn(drawPicture), text: () => drawn(drawText) }) : undefined

// The context window's fill. Before a session's first reply the engine has no
// figure for it, so the band shows the estimate /context would make, which
// costs no request.
async function contextOf($: EngineInterface): Promise<SessionContextUsage | undefined> {
  const context = (await $.session.usage().catch(() => null))?.context
  if (!context || context.percent !== undefined) return context
  const tokens = estimatedTokens()
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

// The rows as drawn at `now`, from what the session holds.
async function rowsAt($: EngineInterface, now: number) {
  // A window that resets mid-session drops to 0% on the next tick, not the next reply.
  const usage = resetExpired(await read($, usageAtom), now)
  const cacheAt = await read($, cacheAtom)
  const context = await contextOf($)
  return rowsOf({ usage, context, cacheAt, now }, config)
}

// A new second redraws the band only where its rows read otherwise: a
// countdown that moved, a window that ran out, a figure the session changed
// with no word of it. A write of what the band read redraws it already, and
// Clawd's frames have their own redraw.
async function redrawRows($: EngineInterface, now: number) {
  if (JSON.stringify(await rowsAt($, now)) !== live.rowsDrawn) $.ui.invalidate('ui.render')
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
  // Not waited for: the usage below has its own waits.
  if (config.showContext) void syncContext($, id).catch(() => undefined)
  // The account is asked only for a row that shows.
  if (config.showWeekly || config.showFiveHour) await syncUsage($, now, id)
}

// One timer drives the band: a frame each period and, when the clock's second
// changes, the once-a-second work and a redraw where the rows moved.
async function tick($: EngineInterface) {
  live.tickedAt = Date.now()
  await settled($, posing.tick)
  // A compaction whose end the spinner did not tell: no turn is running, so it is over.
  if (posing.main === 'compacting' && !live.isWorking) await ask($, 'idle')
  const now = await $.clock.now()
  const second = Math.floor(now / 1000)
  const isNewSecond = second !== live.second
  if (isNewSecond) {
    live.second = second
    void everySecond($, now).catch(() => undefined)
    void redrawRows($, now).catch(() => undefined)
  }
  await probe($, isNewSecond)
  await showFrame($)
}

const STALLED_MS = 2_000

const seedPose = (pose: Pose) => posing.seed(pose, freshSeed())

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
  posing.rules = rulesOf()
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
    if (e.agentId === undefined) await ask($, 'waiting')
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
    await ask($, 'waiting')
    for await (const chunk of stream) {
      if (chunk.kind === 'thinking') await ask($, 'thinking')
      else if (chunk.kind === 'text') await ask($, 'working')
      else if (chunk.kind === 'tool') await ask($, poseFor(chunk.name))
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
      // A subagent's tool gets a glance; then Clawd is back at what the
      // conversation itself is doing, unless that has moved on meanwhile.
      const handBack = await settled($, () => posing.glance(poseFor(tool)))
      $.clock.after(GLANCE_MS, () => void settled($, handBack).catch(() => undefined))
      return next(e)
    }
    const release = await settled($, () => posing.hold(poseFor(tool)))
    try {
      return await next(e)
    } finally {
      await settled($, release)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    ensureStarted($)
    // Only the conversation's own turn has an ending; `reason` is all that is read of it.
    // With the endings turned off, the turn's end is rest.
    if (e.agentId === undefined) {
      await ask($, config.turnEndings ? ENDINGS[e.reason] : 'idle')
    }
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
        if (isCompacting) await ask($, 'compacting')
        // The turn goes on with a new reply to wait for; with no turn, Clawd rests.
        else if (posing.main === 'compacting') await ask($, live.isWorking ? 'waiting' : 'idle')
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
    const model = await read($, modelAtom)
    const rows = await rowsAt($, now)
    live.rowsDrawn = JSON.stringify(rows)

    const pictures = wantsPictures() ? screen.draws : null
    const text = drawn(drawText)
    // No picture where the terminal draws none, or the person asked for text.
    const picture = pictures && config.sprite === 'picture' ? { source: drawn(drawPicture), alt: SCENES[scene()].alt } : null
    const clawd: Clawd | null = config.sprite === 'off' ? null : { text, picture }
    const name = model.name ? shortModel(model.name) : '--'
    // Everything turned off: the row above the prompt is not the mod's.
    if (!clawd && !config.showModel && rows.length === 0) return next(e)
    const view = {
      columns: e.props.bodyColumns,
      pictures,
      clawd,
      model: config.showModel ? { name, effort: model.effort } : null,
      rows,
    }
    const form = fit(view)?.form ?? null
    screen.drew(form, text)
    return band(view, config, $.ui.resolve(e))
  })
}
