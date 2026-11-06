import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, SessionRateLimit } from 'claude-code'

import type { Model, Pose, Usage, Window } from '../types'
import { ALT, CLAUDE_ORANGE, FRAMES, framesFor, PIXEL_HEIGHT, PIXEL_WIDTH } from './sprite'
import type { Rgb } from './sprite'

const poseAtom = atom({ plugin: 'clawd-band', key: 'pose' } as const, 'idle')
const usageAtom = atom({ plugin: 'clawd-band', key: 'usage' } as const, null)
const modelAtom = atom({ plugin: 'clawd-band', key: 'model' } as const, { name: null, effort: null })
// When the main thread's last reply came back: the prompt cache's clock.
const cacheAtom = atom({ plugin: 'clawd-band', key: 'cacheAt' } as const, null)

const SPRITE_COLUMNS = 12
const SPRITE_ROWS = 3
const FRAME_MS = 400 // stop-motion: a few frames, each held
const PERCENT = 5 // " 100%"
const RESET = 12 // " 06d-23h-59m" or " 04h-59m-59s": one width for every row
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

const toWindow = (limits: readonly SessionRateLimit[], kind: string): Window | null => {
  const found = limits.find(l => l.kind === kind)
  return found ? { percentUsed: found.percentUsed, resetsAt: found.resetsAt ?? null } : null
}

export const toUsage = (limits: readonly SessionRateLimit[]): Usage | null =>
  limits.length === 0 ? null : { fiveHour: toWindow(limits, 'five_hour'), sevenDay: toWindow(limits, 'seven_day') }

// The weekly window as `06d-18h-44m`, the five-hour one as `03h-33m-24s`: the
// same width, so the two countdowns line up under each other.
export const countdown = (resetsAt: string | null | undefined, now: number, withDays = false): string => {
  if (!resetsAt) return withDays ? '--d---h---m' : '--h---m---s'
  const total = Math.max(0, Math.floor((Date.parse(resetsAt) - now) / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const minutes = Math.floor((total % 3600) / 60)
  // Not `h`: in a .tsx file that name is the JSX factory.
  if (withDays) return `${two(Math.floor(total / 86400))}d-${two(Math.floor((total % 86400) / 3600))}h-${two(minutes)}m`
  return `${two(Math.floor(total / 3600))}h-${two(minutes)}m-${two(total % 60)}s`
}

// The prompt cache's time left: `00h-59m-12s` while warm, `cold` once the
// entry has lapsed, dashes before the first reply.
export const cacheCountdown = (cacheAt: number | null | undefined, ttlMs: number, now: number): string => {
  if (!cacheAt) return countdown(null, now)
  const expires = cacheAt + ttlMs
  return expires <= now ? 'cold' : countdown(new Date(expires).toISOString(), now)
}

// The context window's size as the row's label: 1000000 -> "1m", 200000 -> "200k".
export const windowLabel = (tokens: number | null | undefined): string => {
  if (!tokens || tokens <= 0) return 'cx'
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}m`
  return `${Math.round(tokens / 1000)}k`
}

export type Run = { text: string; part: 'filled' | 'empty' | 'mark' }

// A bar's cells as runs of one kind: `█` filled, `░` empty. A bar cut into
// `segments` (the weekly bar, one per day) marks each boundary only lightly:
// `▉`'s thin gap in the fill, a thin `│` in the text colour (a `mark`) in the empty part.
export const barRuns = (width: number, filled: number, segments = 1): Run[] => {
  const cuts = new Set<number>()
  for (let i = 1; i < segments; i++) cuts.add(Math.round((i * width) / segments))
  const runs: Run[] = []
  for (let cell = 0; cell < width; cell++) {
    const isCut = cuts.has(cell)
    const part = cell < filled ? 'filled' : isCut ? 'mark' : 'empty'
    const char = part === 'filled' ? (isCut ? '▉' : '█') : part === 'mark' ? '│' : '░'
    const last = runs[runs.length - 1]
    if (last && last.part === part) last.text += char
    else runs.push({ text: char, part })
  }
  return runs
}

const EFFORT_HINT = /\s*(?:·\s*)?●?\s*\b(?:low|medium|high|xhigh|max)\s*·\s*\/effort\b(?:\s*·)?\s*/

// The hint line under the prompt without its effort pill (`● high · /effort`),
// which the model line under Clawd already shows; null when it has none.
export const withoutEffort = (hint: string): string | null =>
  EFFORT_HINT.test(hint) ? hint.replace(EFFORT_HINT, ' ').trim() : null

// "claude-opus-5-5" -> "Opus 5.5"; a name already shown as words is kept.
export const shortModel = (model: string): string => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)
  if (!m) return model
  return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
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

// A window whose reset has passed is empty: 0% until the next request starts a
// new one and a response reports its reset.
export const resetExpired = (usage: Usage | null, now: number): Usage | null => {
  if (!usage) return null
  const live = (w: Window | null) =>
    w?.resetsAt && Date.parse(w.resetsAt) <= now ? { percentUsed: 0, resetsAt: null } : w
  return { fiveHour: live(usage.fiveHour), sevenDay: live(usage.sevenDay) }
}

// A reading names only the windows it has; one it leaves out keeps its last value.
export const mergeUsage = (current: Usage | null | undefined, limits: readonly SessionRateLimit[]): Usage | null => {
  const fresh = toUsage(limits)
  if (!fresh) return current ?? null
  return { fiveHour: fresh.fiveHour ?? current?.fiveHour ?? null, sevenDay: fresh.sevenDay ?? current?.sevenDay ?? null }
}

const sameWindow = (a: Window | null | undefined, b: Window | null | undefined) =>
  (a?.percentUsed ?? null) === (b?.percentUsed ?? null) && (a?.resetsAt ?? null) === (b?.resetsAt ?? null)

export const sameUsage = (a: Usage | null | undefined, b: Usage | null | undefined): boolean =>
  sameWindow(a?.fiveHour, b?.fiveHour) && sameWindow(a?.sevenDay, b?.sevenDay)

async function setUsage($: EngineInterface, limits: readonly SessionRateLimit[]) {
  if (limits.length === 0) return
  let merged: Usage | null = null
  await update($, usageAtom, (current: Usage | null | undefined) => {
    const next = mergeUsage(current, limits)
    // An unchanged reading leaves the atom and the store alone.
    if (sameUsage(current, next)) return current ?? null
    return (merged = next)
  })
  if (merged) await $.store.set('usage', merged)
}

// session.measure is raised only when a window moves a whole point, so a new
// reset time at the same percent (a window that reset and started again) never
// reaches it: after each turn the band reads the session's latest reading too.
async function refreshUsage($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  await setUsage($, rateLimits)
}

// The person's userConfig values (plugin.json), checked: a colour that is not
// a theme key, a colour name or hex falls back to its default.
export type Settings = {
  showModel: boolean
  spriteColor: string
  spriteRgb: Rgb
  low: string
  mid: string
  high: string
  empty: string
  cold: string
  cacheTtlMs: number
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const COLOR = /^([a-z]+|#[0-9a-f]{3}|#[0-9a-f]{6})$/i // a theme key, a colour name, or hex

const toRgb = (hex: string): Rgb | null => {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const digits = m[1].length === 3 ? [...m[1]].map(d => d + d).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16)) as Rgb
}

const textColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : fallback

export const settings = (options: PluginOptions): Settings => {
  const parsed = typeof options.sprite_color === 'string' ? toRgb(options.sprite_color) : null
  const custom = parsed && parsed.join() !== CLAUDE_ORANGE.join() ? parsed : null
  const spriteRgb = custom ?? CLAUDE_ORANGE
  return {
    showModel: options.show_model !== false,
    // The text logo shown while a question is open: the theme's own Claude
    // colour unless the sprite has one of its own.
    spriteColor: custom ? `#${custom.map(c => c.toString(16).padStart(2, '0')).join('')}` : 'claude',
    spriteRgb,
    low: textColor(options.bar_color_low, 'success'),
    mid: textColor(options.bar_color_mid, 'warning'),
    high: textColor(options.bar_color_high, 'error'),
    empty: textColor(options.bar_color_empty, 'inactive'),
    cold: textColor(options.bar_color_cold, 'blue'),
    // The API keeps a cache entry 5 minutes or an hour; the mod cannot see which.
    cacheTtlMs: options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000,
  }
}

// Set by register from the person's options; a change there reloads the module.
let config = settings({})
let frames = FRAMES

export const barColor = (percent: number, colors: Settings = config) =>
  percent >= 85 ? colors.high : percent >= 60 ? colors.mid : colors.low

// The timer reads these between draws; a reload starts them over.
const live: {
  pose: Pose
  isWorking: boolean
  frame: number
  bandId: string | null
  isStarted: boolean
  isAsking: boolean
  sessionId: string | null
  resetKey: string | null
  resetTries: number
  resetAt: number
} = {
  pose: 'idle',
  isWorking: false,
  frame: 0,
  bandId: null,
  isStarted: false,
  isAsking: false,
  sessionId: null,
  resetKey: null,
  resetTries: 0,
  resetAt: 0,
}

const shown = (): Pose => (live.isWorking ? live.pose : 'idle')

async function setPose($: EngineInterface, next: Pose) {
  if (next === live.pose) return
  live.pose = next
  live.frame = 0
  await update($, poseAtom, () => next)
}

async function tick($: EngineInterface) {
  live.frame += 1
  // Frozen while a question dialog is open: frame swaps kept it from showing as a menu.
  if (!live.bandId || live.isAsking) return
  const poseFrames = frames[shown()]
  const source = { rgba: poseFrames[live.frame % poseFrames.length], width: PIXEL_WIDTH, height: PIXEL_HEIGHT }
  try {
    await $.ui.blit({ requestId: live.bandId, key: 'clawd', source })
  } catch {
    // The band was taken down between draws; the next render places it again.
  }
}

const USAGE_WINDOWS = ['five_hour', 'seven_day']

// The account usage endpoint (what /usage reads): `{ five_hour: { utilization,
// resets_at }, seven_day: { ... } }`, utilization in percent, a window null
// while none is open.
export const parseAccountUsage = (text: string): SessionRateLimit[] => {
  let body: Record<string, { utilization?: unknown; resets_at?: unknown } | null>
  try {
    body = JSON.parse(text)
  } catch {
    return []
  }
  if (!body || typeof body !== 'object') return []
  return USAGE_WINDOWS.flatMap(kind => {
    const w = body[kind]
    if (!w || typeof w.utilization !== 'number') return []
    const reset = typeof w.resets_at === 'string' && !Number.isNaN(Date.parse(w.resets_at)) ? w.resets_at : undefined
    return [{ kind, percentUsed: Math.round(w.utilization * 10) / 10, resetsAt: reset }]
  })
}

async function fetchAccountUsage($: EngineInterface): Promise<SessionRateLimit[]> {
  const auth = await $.session.authorize()
  if (auth?.kind !== 'bearer') return []
  // The one request the mod makes: GET, to this address only, with the
  // person's own sign-in; it sends nothing from the conversation.
  const res = await $.http.fetch('https://api.anthropic.com/api/oauth/usage', {
    auth: auth.handle,
    headers: { 'anthropic-beta': 'oauth-2025-04-20' },
  })
  return res.ok ? parseAccountUsage(res.text) : []
}

// The reset times of the windows that have run out, joined: what one fetch on
// reset answers. Null while every window still has time left.
export const expiredKey = (usage: Usage | null | undefined, now: number): string | null => {
  const gone = [usage?.fiveHour?.resetsAt, usage?.sevenDay?.resetsAt].filter(
    (r): r is string => !!r && Date.parse(r) <= now,
  )
  return gone.length > 0 ? gone.join() : null
}

const RESET_FIRST_MS = 5_000 // the account has rolled the window over by then
const RESET_RETRY_MS = 60_000
const RESET_TRIES = 5

// A window that runs out mid-session: ask the account for the next one, so the
// countdown fills without waiting for a reply. Until a new reset time arrives,
// once a minute, five times at most; then the next reply fills it as before.
async function fetchOnReset($: EngineInterface) {
  const now = await $.clock.now()
  const key = expiredKey(await read($, usageAtom), now)
  if (!key) return
  if (key !== live.resetKey) {
    live.resetKey = key
    live.resetTries = 0
    live.resetAt = now - RESET_RETRY_MS + RESET_FIRST_MS
  }
  if (live.resetTries >= RESET_TRIES || now - live.resetAt < RESET_RETRY_MS) return
  live.resetTries += 1
  live.resetAt = now
  await setUsage($, await fetchAccountUsage($).catch(() => []))
}

// Rate limits come from response headers and effort from the turn, so a fresh
// session has neither until its first reply: start from the last ones seen,
// then ask the account for both windows as they stand now.
async function loadUsage($: EngineInterface) {
  const stored = await $.store.get('usage')
  const now = await $.clock.now()
  const cached = resetExpired((stored as Usage | undefined) ?? null, now)
  if (cached) await update($, usageAtom, (current: Usage | null | undefined) => current ?? cached)
  const { rateLimits } = await $.session.usage()
  if (rateLimits.length > 0) return setUsage($, rateLimits)
  await setUsage($, await fetchAccountUsage($).catch(() => []))
}

async function loadModel($: EngineInterface) {
  const name = await $.session.model()
  const stored = await $.store.get('model')
  const cached = stored as Model | undefined
  // The stored effort belongs to the stored model; another model may differ.
  const effort = cached && cached.name === name ? cached.effort : null
  await setModel($, { name, effort: effort ?? undefined })
}

// A /clear goes on in the same process under a new session id, with empty
// $.state and no session.start: a changed id loads usage and model again.
async function loadSession($: EngineInterface) {
  let id = ''
  try {
    id = await $.session.id()
  } catch {
    // An id that cannot be read still loads once.
  }
  if (id === live.sessionId) return
  live.sessionId = id
  await Promise.all([loadUsage($).catch(() => undefined), loadModel($).catch(() => undefined)])
}

// Started by whichever hook runs first: a resumed session can load the module
// without raising session.start, which left the band undrawn until a reload.
function ensureStarted($: EngineInterface) {
  if (live.isStarted) return
  live.isStarted = true
  $.clock.every(FRAME_MS, () => tick($))
  $.clock.every(1000, () => {
    loadSession($).catch(() => undefined)
    fetchOnReset($).catch(() => undefined)
    if (!live.isAsking) $.ui.invalidate('ui.render')
  })
  $.clock.after(0, () => {
    loadSession($).catch(() => undefined)
  })
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  config = settings(options)
  frames = config.spriteRgb === CLAUDE_ORANGE ? FRAMES : framesFor(config.spriteRgb)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    ensureStarted($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    ensureStarted($)
    if (e.changed.includes('rateLimits')) await setUsage($, e.rateLimits)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    ensureStarted($)
    await setPose($, 'working')
    return next(e)
  })

  // The main thread's stream says when the model is thinking, writing, or
  // starting a tool call; subagents' streams are passed through untouched.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId) return yield* stream
    await setModel($, { name: e.model, effort: e.effort === undefined ? undefined : String(e.effort) })
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
    const tool = String(e.tool)
    await setPose($, poseFor(tool))
    // The band holds still while the question dialog is open (one redraw for
    // the pose, then no frame swaps or countdown ticks until it closes).
    const isQuestion = tool === 'AskUserQuestion'
    if (isQuestion) {
      live.isAsking = true
      $.ui.invalidate('ui.render')
    }
    try {
      return await next(e)
    } finally {
      if (isQuestion) {
        live.isAsking = false
        $.ui.invalidate('ui.render')
      }
      await setPose($, 'working')
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await setPose($, 'idle')
    await refreshUsage($).catch(() => undefined)
    return next(e)
  })

  // The sprite is the only thing moving: the native spinner draws empty.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    ensureStarted($)
    if (e.surface !== 'terminal') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // A rewritten hint is drawn as plain text, so only a line with the pill is touched.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
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
    live.pose = await read($, poseAtom)
    const now = await $.clock.now()
    // A window that resets mid-session drops to 0% on the next tick, not the next reply.
    const usage = resetExpired(await read($, usageAtom), now)
    const model = await read($, modelAtom)
    const cacheAt = await read($, cacheAtom)
    const context = (await $.session.usage().catch(() => null))?.context
    const { Box, Text, Image } = $.ui.resolve(e)

    const current = shown()
    const poseFrames = frames[current]
    const modelName = model.name ? shortModel(model.name) : '--'
    const caption = model.effort ? `${modelName} ${model.effort}` : modelName
    const left = config.showModel ? Math.max(SPRITE_COLUMNS + 1, caption.length) : SPRITE_COLUMNS + 1
    const contextLabel = windowLabel(context?.window)
    const label = Math.max(2, contextLabel.length) + 1 // "7d " or "200k "
    const barWidth = Math.max(4, e.props.bodyColumns - left - 1 - label - PERCENT - RESET)

    const row = (
      name: string,
      percent: number | null | undefined,
      timer: string,
      isLive: boolean,
      color?: string,
      segments = 1,
    ) => {
      const fill = percent ?? 0
      const filled = Math.min(barWidth, Math.round((fill / 100) * barWidth))
      return (
        <Box flexDirection="row">
          <Text dimColor>{name.padEnd(label)}</Text>
          {barRuns(barWidth, filled, segments).map(run => (
            run.part === 'mark' ? (
              <Text>{run.text}</Text>
            ) : (
              <Text color={run.part === 'filled' ? (color ?? barColor(fill)) : config.empty}>{run.text}</Text>
            )
          ))}
          <Text dimColor={percent == null}>{percent == null ? '   --' : ` ${String(Math.round(fill)).padStart(3)}%`}</Text>
          <Text> </Text>
          <Text bold={isLive || !!color} color={color} dimColor={!isLive && !color}>
            {timer.padStart(RESET - 1)}
          </Text>
        </Box>
      )
    }
    // The weekly bar is cut into its seven days.
    const bar = (name: string, window: Window | null | undefined, withDays = false) =>
      row(name, window?.percentUsed, countdown(window?.resetsAt, now, withDays), !!window?.resetsAt, undefined, withDays ? 7 : 1)
    const cacheTimer = cacheCountdown(cacheAt, config.cacheTtlMs, now)
    const isCold = cacheTimer === 'cold'

    return (
      // The bars hang from the bottom: the two usage rows sit where they always
      // did beside the sprite, the context row on the model line under them.
      <Box flexDirection="row" alignItems="flex-end">
        <Box flexDirection="column" width={left} alignItems="center">
          {live.isAsking ? (
            // A kitty image sits on a layer above the text and covered the
            // question menu; while it is open, Clawd is the CLI's text logo.
            <Box flexDirection="column">
              <Text color={config.spriteColor}> ▐▛███▜▌ </Text>
              <Text color={config.spriteColor}>▝▜█████▛▘</Text>
              <Text color={config.spriteColor}>  ▘▘ ▝▝  </Text>
            </Box>
          ) : (
            <Image
              key="clawd"
              source={{ rgba: poseFrames[live.frame % poseFrames.length], width: PIXEL_WIDTH, height: PIXEL_HEIGHT }}
              columns={SPRITE_COLUMNS}
              rows={SPRITE_ROWS}
              alt={ALT[current]}
            />
          )}
          {config.showModel ? (
            <Box key="model" flexDirection="row">
              <Text bold>{modelName}</Text>
              {model.effort ? <Text dimColor> {model.effort}</Text> : null}
            </Box>
          ) : null}
        </Box>
        <Box flexDirection="column" marginLeft={1}>
          {bar('7d', usage?.sevenDay, true)}
          {bar('5h', usage?.fiveHour)}
          {row(contextLabel, context?.percent, cacheTimer, cacheAt != null && !isCold, isCold ? config.cold : undefined)}
        </Box>
      </Box>
    )
  })
}
