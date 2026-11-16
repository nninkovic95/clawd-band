import type { Elements, SessionContextUsage } from 'claude-code'

import type { Usage, Window } from '../types'
import { themePaint } from './settings'
import type { BarStyle, Paint, Settings } from './settings'
import type { Picture, Rgba } from './picture'
import { markCells, pill } from './pill'
import { BOX_COLUMNS, BOX_ROWS, TEXT_COLUMNS } from './sprite'
import type { TextFrame } from './sprite'

const PERCENT = 4 // " 99%": a window used up reads 99%, so the percentage keeps its width
const RESET = 12 // " 06d-23h-59m" or " 04h-59m-59s": one width for every row
const SHORT_RESET = 8 // " 06d-23h" or " 04h-59m": the two biggest units, where the band is narrow
const MIN_BAR = 4
const MAX_BAR = 255 // the most cells an Image takes; the bars in text keep to it, so both forms end at one place
const EDGE = 1 // the cell kept free at the band's right edge
const FRAME = 2 // a blank cell either side of the bars
const WEEK = 7 // days in the weekly bar
// Dumb Memory's outline while the session is short of it.
const ZONE_REST: Rgba = [0, 0, 0, 255]
const solid = ([red, green, blue]: Rgba): Rgba => [red, green, blue, 255]

// The weekly window as `06d-18h-44m`, the five-hour one as `03h-33m-24s`: the
// same width, so the two countdowns line up under each other. Both ends are
// cut to whole seconds, so every countdown steps when the clock's second does.
export const countdown = (resetsAt: string | null | undefined, now: number, withDays = false): string => {
  if (!resetsAt) return withDays ? '--d---h---m' : '--h---m---s'
  const total = Math.max(0, Math.floor(Date.parse(resetsAt) / 1000) - Math.floor(now / 1000))
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

// 320807 -> "320.8k", 667000 -> "667k", 1000000 -> "1M".
export const tokensText = (tokens: number): string => {
  const trim = (value: number) => String(Math.round(value * 10) / 10)
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`
  return tokens >= 1000 ? `${trim(tokens / 1000)}k` : String(tokens)
}

// A stretch of a bar in one look; `warn` marks the weekly bar's last days when
// the week is being used up ahead of time.
// `behind` marks the fill's rounded end: what lies under the rest of its cell.
// `piece` marks a cell that is a little bar of its own, by its place among them; `half`
// a cell that is one half of a glyph two cells wide, by its place among the halves.
export type Run = { text: string; part: 'filled' | 'empty'; warn?: true; behind?: 'empty' | 'warn'; piece?: number; half?: number }

// The cell between two days of the weekly bar: left blank, a clean gap in the
// solid bar. Claude Code draws `dimColor` in the theme's grey, so days cannot be
// told apart by shade, and a line glyph shows as a line between two gaps.
const MARK = ' '

// A bar of a style whose glyphs are two cells wide. Its runs are one a cell and numbered
// among the bar's halves, so that the pointer can tell each half apart; a cell that is
// neither half of a glyph (a gap between days, a cell left over) has no number.
const wideRuns = (width: number, percent: number, style: BarStyle, segments: number, warned: number, lead: number): Run[] => {
  const marks = segments - 1
  const split = marks > 0 && Math.floor((width - marks) / 2) >= segments
  const units = Math.floor((split ? width - marks : width) / 2)
  const starts = Array.from({ length: segments }, (_, k) => Math.round((k * units) / segments))
  const used = Math.min(units * 2, Math.round((percent / 100) * units * 2))
  // A fill after little bars is two glyphs at least, as each little bar is one.
  const lit = lead > 0 && percent > 0 ? Math.min(units * 2, Math.max(used, (lead + 2) * 2)) : used
  const warnFrom = warned > 0 ? (starts[segments - warned] ?? units) : units
  const runs: Run[] = []
  for (let unit = 0; unit < units; unit++) {
    const isPiece = unit < lead
    const halves = isPiece ? 2 : Math.max(0, Math.min(2, lit - unit * 2))
    if (split && unit > 0 && starts.includes(unit)) runs.push({ text: MARK, part: halves > 0 ? 'filled' : 'empty' })
    const more = { ...(halves === 0 && unit >= warnFrom ? { warn: true as const } : {}), ...(isPiece ? { piece: unit } : {}) }
    runs.push({ text: style.steps[halves] ?? style.steps[0], part: halves > 0 ? 'filled' : 'empty', ...more, half: unit * 2 })
    runs.push({ text: ' ', part: halves > 1 ? 'filled' : 'empty', ...more, half: unit * 2 + 1 })
  }
  const over = width - units * 2 - (split ? marks : 0)
  if (over > 0) runs.push({ text: ' '.repeat(over), part: 'empty' })
  return runs
}

// A bar's cells as runs of one kind. The cells fill one after another, each
// through every step of the style, so a style of five steps shows a quarter
// of a cell. A bar in `segments` (the weekly bar, one per day) has a mark
// between them where each gets a cell. The bar takes all the room
// it is given, so a segment may be a cell longer than another: each mark sits
// on the cell nearest its true place, which spreads the longer ones out. A
// mark the fill runs past takes its colour. The last `warned` segments' cells
// are marked to warn; the marks between them are not. A style with caps rounds
// the bar's ends, and the fill's end into what lies behind it. The first `lead`
// cells are little bars of their own, each a full cell; the fill goes on after them, two
// cells of its own at least where there is any.
export const barRuns = (width: number, percent: number, style: BarStyle, segments = 1, warned = 0, lead = 0): Run[] => {
  if (style.wide) return wideRuns(width, percent, style, segments, warned, lead)
  const perCell = style.steps.length - 1
  const marks = segments - 1
  const split = marks > 0 && width - marks >= segments
  const cells = split ? width - marks : width
  // The cell each segment starts at.
  const starts = Array.from({ length: segments }, (_, k) => Math.round((k * cells) / segments))
  const used = Math.min(cells * perCell, Math.round((percent / 100) * cells * perCell))
  const lit = lead > 0 && percent > 0 ? Math.min(cells * perCell, Math.max(used, (lead + 2) * perCell)) : used
  const warnFrom = warned > 0 ? (starts[segments - warned] ?? cells) : cells
  type Cell = { char: string; part: Run['part']; warn: boolean; behind?: Run['behind']; piece?: number }
  const drawn: Cell[] = []
  // Where each day cell sits among the drawn cells, marks included.
  const at: number[] = []
  for (let cell = 0; cell < cells; cell++) {
    const isPiece = cell < lead
    const step = isPiece ? perCell : Math.max(0, Math.min(perCell, lit - cell * perCell))
    const part = step > 0 ? 'filled' : 'empty'
    if (split && cell > 0 && starts.includes(cell)) drawn.push({ char: MARK, part, warn: false })
    at.push(drawn.length)
    // Only an empty cell warns: a used one keeps the fill's colour.
    drawn.push({ char: style.steps[step] ?? style.steps[0], part, warn: part === 'empty' && cell >= warnFrom, ...(isPiece ? { piece: cell } : {}) })
  }
  if (style.caps) {
    const [left, right] = style.caps
    const first = drawn[0]
    const last = drawn[drawn.length - 1]
    if (first) first.char = left
    if (last) last.char = right
    // The fill's last cell, where it ends short of the bar's: rounded on what follows it,
    // nothing where a day gap does. Not the first cell, which is the bar's own end.
    const end = Math.ceil(lit / perCell) - 1
    const fillEnd = drawn[at[end] ?? -1]
    const next = drawn[(at[end] ?? -1) + 1]
    if (end > 0 && end >= lead && end < cells - 1 && fillEnd && next) {
      fillEnd.char = right
      if (next.char !== MARK) fillEnd.behind = next.warn ? 'warn' : 'empty'
    }
  }
  const runs: Run[] = []
  for (const { char, part, warn, behind, piece } of drawn) {
    const last = runs[runs.length - 1]
    const joins = last && piece === undefined && last.piece === undefined && !behind && !last.behind
    if (last && joins && last.part === part && (last.warn ?? false) === warn) last.text += char
    else runs.push({ text: char, part, ...(warn ? { warn: true as const } : {}), ...(behind ? { behind } : {}), ...(piece === undefined ? {} : { piece }) })
  }
  return runs
}

// One row of the band: a label, a bar, its percentage and a countdown.
export type Row = {
  label: string
  percent: number | null | undefined
  timer: string
  // A countdown that is running reads bold; one with nothing to count, dim.
  isLive: boolean
  // The fill's own colour, at any level.
  own: Paint
  // Paints the fill and the countdown in place of `own` (a cold cache).
  color?: Paint
  segments?: number
  // How many of the last segments warn.
  warned?: number
  // Where Dumb Memory starts along the bar, 0 to 1, and whether the session is in it.
  zone?: Zone
  // Where auto-compaction runs along the bar, 0 to 1.
  mark?: number
  // What the session loaded before its conversation, kind by kind: each a little bar of
  // its own at the bar's start.
  pieces?: Piece[]
  // One line of what the row's figures stand for: what the band shows for the row under
  // the pointer.
  detail?: string
  // The same for Dumb Memory, once the session is in it: what stands either side of its
  // name for the pointer on it.
  zoneDetail?: { before: string; after: string }
  // Dumb Memory in a line while the session is short of it: shown for the pointer on the
  // zone itself.
  zoneLine?: string
  // Auto-compaction in a line, where its pill is drawn: shown for the pointer on the pill.
  markLine?: string
}

export type Zone = { from: number; isIn: boolean }

// One kind of memory: its share of the window, 0 to 1, and its colour.
export type Piece = { share: number; paint: Paint }

// A row of /context that is in use.
export type Category = { name: string; tokens: number; color: string }

// The conversation's row: it is the fill's own, and the only row told apart by its name.
const CONVERSATION = 'Messages'

const piecesOf = (context: SessionContextUsage | null | undefined, categories: readonly Category[] | null | undefined): Piece[] => {
  if (!context || context.window <= 0 || !categories) return []
  return categories
    .filter(row => row.name !== CONVERSATION && row.tokens > 0)
    .map(row => ({ share: row.tokens / context.window, paint: themePaint(row.color) }))
}

// Auto-compaction's place along the window; none where it is off, or would run at the
// window's end or past it.
const markOf = (context: SessionContextUsage | null | undefined, compactAt: number | null | undefined): number | null =>
  context && context.window > 0 && compactAt != null && compactAt > 0 && compactAt < context.window ? compactAt / context.window : null

// The stretch of the window where answers are expected to get worse: from
// what the session loaded before its conversation plus a share of the room
// left after it, to the window's end. The session is in it by its own tokens.
// Where it starts, in tokens. In whole tokens: the share is a percentage.
export const zoneStart = (window: number, loaded: number, share: number): number => (loaded * 100 + share * (window - loaded)) / 100

const zoneOf = (context: SessionContextUsage | null | undefined, loaded: number | null | undefined, share: number): Zone | null => {
  if (!context || context.window <= 0 || loaded == null) return null
  const start = zoneStart(context.window, loaded, share)
  const tokens = context.tokens ?? ((context.percent ?? 0) * context.window) / 100
  return { from: start / context.window, isIn: tokens > start }
}

const DAY_MS = 86_400_000
const WARNED_DAYS = 3

// The weekly bar's last days warn once the week is within them and is being
// used up ahead of time: what is left of it, in days at a day's even share, is
// fewer than the days to its reset.
const isAhead = (window: Window | null | undefined, now: number): boolean => {
  if (window?.percentUsed == null || !window.resetsAt) return false
  const daysLeft = (WEEK * (100 - window.percentUsed)) / 100
  const untilReset = (Date.parse(window.resetsAt) - now) / DAY_MS
  return untilReset <= WARNED_DAYS && daysLeft < untilReset
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

// A usage window in a line: how much of it is used and when it ends, by the person's own
// clock. The week also says how long what is left lasts at the pace so far.
const windowDetail = (name: string, window: Window | null | undefined, now: number, withDays: boolean): string | undefined => {
  if (window?.percentUsed == null || !window.resetsAt) return undefined
  const end = new Date(window.resetsAt)
  const two = (n: number) => String(n).padStart(2, '0')
  const day = withDays ? `${DAYS[end.getDay()]} ` : ''
  const parts = [`${name} ${Math.min(99, Math.round(window.percentUsed))}%`, `resets ${day}${two(end.getHours())}:${two(end.getMinutes())}`]
  if (withDays && window.percentUsed > 0) {
    const untilReset = (end.getTime() - now) / DAY_MS
    const lasts = ((100 - window.percentUsed) * (WEEK - untilReset)) / window.percentUsed
    parts.push(lasts >= untilReset ? 'enough to the reset' : `${lasts.toFixed(1)} days left at this pace`)
  }
  return parts.join(' · ')
}

const detailOf = (detail: string | undefined): { detail?: string } => (detail ? { detail } : {})

export type Reading = {
  usage: Usage | null | undefined
  context: SessionContextUsage | null | undefined
  cacheAt: number | null | undefined
  now: number
  // The tokens the session held before its conversation, once known.
  loaded?: number | null
  // The tokens at which auto-compaction runs; null where it is off.
  compactAt?: number | null
  // The rows of /context in use, once known.
  categories?: readonly Category[] | null
}

// The rows the person asked for, top to bottom: the week, the five hours, and
// the context window with the prompt cache's countdown.
export const rowsOf = ({ usage, context, cacheAt, now, loaded, compactAt, categories }: Reading, settings: Settings): Row[] => {
  const windowRow = (label: string, window: Window | null | undefined, own: Paint, withDays = false): Row => ({
    label,
    percent: window?.percentUsed,
    own,
    // At 0% with nothing to count to, the window has run out, or has not begun: the
    // next request opens it. Dashes are for a window nothing is known of.
    timer: window?.percentUsed === 0 && !window.resetsAt ? 'reset' : countdown(window?.resetsAt, now, withDays),
    isLive: !!window?.resetsAt,
    // The weekly bar is cut into its seven days.
    segments: withDays ? WEEK : 1,
    ...(withDays && isAhead(window, now) ? { warned: WARNED_DAYS } : {}),
    ...detailOf(windowDetail(withDays ? 'week' : 'five hours', window, now, withDays)),
  })
  const cacheTimer = cacheCountdown(cacheAt, settings.cacheTtlMs, now)
  const isCold = cacheTimer === 'cold'
  const rows: Row[] = []
  if (settings.showWeekly) rows.push(windowRow('7d', usage?.sevenDay, settings.weeklyColor, true))
  if (settings.showFiveHour) rows.push(windowRow('5h', usage?.fiveHour, settings.fiveHourColor))
  if (settings.showContext) {
    // A share of 0 is no zone by its own rule: by the sum it would start where the loaded part ends.
    const zone = settings.showDumbMemory && settings.dumbZone > 0 ? zoneOf(context, loaded, settings.dumbZone) : null
    const mark = settings.showAutocompact ? markOf(context, compactAt) : null
    const tokens = context?.tokens
    const start = zone && context ? zone.from * context.window : 0
    const compactText = mark !== null && compactAt != null ? `auto-compact at ${tokensText(compactAt)}` : undefined
    // A bar drawn as a picture has a pill on the mark, and the pill a line of its own; a bar
    // in text has no pill, and its row's line says where auto-compaction runs.
    const isPill = settings.barStyle.isPicture === true
    const detail =
      context && tokens != null
        ? [`${tokensText(tokens)} of ${tokensText(context.window)}`, ...(compactText && !isPill ? [compactText] : [])].join(' · ')
        : undefined
    const markLine =
      compactText && isPill && tokens != null && compactAt != null
        ? [compactText, ...(tokens < compactAt ? [`${tokensText(compactAt - tokens)} to go`] : [])].join(' · ')
        : undefined
    // Dumb Memory's own line while the session is short of it: its name is not on the band then.
    const zoneLine =
      zone && !zone.isIn && tokens != null
        ? `Dumb Memory from ${tokensText(start)} · ${tokensText(start - tokens)} to go · answers get worse past it`
        : undefined
    const zoneDetail =
      zone?.isIn && tokens != null
        ? { before: `${tokensText(tokens - start)} inside`, after: '/compact or /new' }
        : undefined
    const pieces = piecesOf(context, categories)
    rows.push({
      ...(zone ? { zone } : {}),
      ...(pieces.length > 0 ? { pieces } : {}),
      ...(mark === null ? {} : { mark }),
      ...(detail ? { detail } : {}),
      ...(zoneDetail ? { zoneDetail } : {}),
      ...(zoneLine ? { zoneLine } : {}),
      ...(markLine ? { markLine } : {}),
      label: windowLabel(context?.window),
      percent: context?.percent,
      own: settings.contextColor,
      timer: cacheTimer,
      isLive: cacheAt != null && !isCold,
      color: isCold ? settings.cold : undefined,
    })
  }
  return rows
}

// Clawd as the band may draw him: in text always, and as a picture where the
// terminal draws one. The band picks the form that fits its width.
export type Clawd = { text: TextFrame; picture: { source: Picture; alt: string } | null }

// One clear pixel in one cell: the picture the band is asked through whether
// the terminal draws pictures. A terminal that draws none shows its alt, a space.
export const PROBE: Picture = { rgba: 'AAAAAA==', width: 1, height: 1 }

// All the band draws from.
export type View = {
  // The width the band may fill.
  columns: number
  // Whether the terminal draws pictures; null where none is wanted, and so none is asked for.
  pictures: boolean | null
  // Null where the person turned Clawd off.
  clawd: Clawd | null
  // Null where the person turned the model line off.
  model: { name: string; effort: string | null } | null
  rows: readonly Row[]
  // What a press on the zone's name does.
  onZone?: () => void
}

// How the band lays itself out at its width: which form of Clawd, how wide
// his column, and how much of each countdown.
// `before` and `gap` are the cells before and after Clawd's column.
export type Fit = {
  form: 'picture' | 'text' | null
  before: number
  left: number
  gap: number
  label: number
  reset: number
  barWidth: number
}

// What follows the model's name under Clawd: a middle dot, then the effort.
const effortText = (effort: string | null): string => (effort ? ` · ${effort}` : '')

// Where the band is narrow, what gives way, in order: the countdown loses its
// smallest unit, then goes; then Clawd turns to text, then hides. A bar keeps
// MIN_BAR cells. Clawd's column is the picture's width while that fits, so the
// bars stay put when the picture and the text swap. The bars take every cell
// left, with one cell either side of Clawd.
export const fit = (view: View): Fit | null => {
  const caption = view.model ? view.model.name + effortText(view.model.effort) : ''
  const label = Math.max(0, ...view.rows.map(row => row.label.length)) + 1 // "7d " or "200k "
  const forms: [Fit['form'], number][] = view.clawd
    ? [
        [view.clawd.picture ? 'picture' : 'text', BOX_COLUMNS],
        ['text', TEXT_COLUMNS],
        [null, 0],
      ]
    : [[null, 0]]
  const laid = forms.map(([form, width]) => {
    const left = Math.max(width, caption.length)
    const side = left > 0 ? 1 : 0
    const room = view.columns - side - left - side - label - FRAME - PERCENT - EDGE
    const reset = [RESET, SHORT_RESET].find(reset => room - reset >= MIN_BAR) ?? 0
    const barWidth = Math.min(MAX_BAR, Math.max(MIN_BAR, room - reset))
    const at: Fit = { form, before: side, left, gap: side, label, reset, barWidth }
    return { at, room }
  })
  // Narrower than the last of them, no row fits: the band draws nothing.
  return laid.find(({ room }) => room >= MIN_BAR)?.at ?? null
}

const ZONE_WORDS = 'Dumb Memory'
// On a bar narrower than the words, they are shortened to its first six letters and an ellipsis.
const ZONE_SHORT = 'Dumb M\u2026'
// The hover groups: a row and its line of detail light together, as the zone's name and
// what stands beside it do.
const ZONE_SCOPE = 'clawd-band-zone'
// The auto-compaction pill and its line light together, apart from its row and the zone.
const MARK_SCOPE = 'clawd-band-mark'
const rowScope = (row: Row): string => `clawd-band-${row.label}`
const DOT = '·'
// The fewest cells a context bar has room for little bars in.
const PIECES_FROM = 5

export function band(view: View, settings: Settings, { Box, Text, Image, Button }: Elements['terminal']) {
  const fitted = fit(view)
  if (!fitted) return <Box />
  const { form, before, left, gap, label, reset, barWidth } = fitted

  const probe = view.pictures === null ? <Text> </Text> : <Image key="probe" source={PROBE} columns={1} rows={1} alt=" " />
  // Once the session is in the zone, its name stands in the top row over the cell where the
  // zone starts, moved left where it would pass the band's edge and left out where the band
  // has no room for it. It is a button: a picture takes no press, and the bar is one.
  const zone = view.rows.find(row => row.zone)?.zone
  const words = barWidth < ZONE_WORDS.length ? ZONE_SHORT : ZONE_WORDS
  const zoneAt = zone
    ? Math.min(before + left + gap + label + 1 + Math.floor(zone.from * barWidth), view.columns - EDGE - words.length)
    : 0
  const zoneDetail = view.rows.find(row => row.zoneDetail)?.zoneDetail
  const zoneLine = view.rows.find(row => row.zoneLine)?.zoneLine
  const top =
    zone?.isIn && zoneAt >= 1 ? (
      <Box key="top" flexDirection="row">
        {probe}
        {/* What the pointer on the name adds stands either side of it, hidden until then: the
            name is left free for a press. The cells before it keep their width. */}
        <Box key="dumb-memory-before" width={zoneAt - 1} flexDirection="row" justifyContent="flex-end">
          {zoneDetail ? (
            <Box key="zone-before" display="none" hover={{ scope: ZONE_SCOPE, display: 'flex' }}>
              <Text dimColor>{`${zoneDetail.before} ${DOT} `.slice(-(zoneAt - 1))}</Text>
            </Box>
          ) : null}
        </Box>
        <Button key="dumb-memory" label={ZONE_WORDS} plain hover={{ scope: ZONE_SCOPE }} onPress={view.onZone ?? (() => undefined)}>
          <Text color={settings.warning.text}>{words}</Text>
        </Button>
        {zoneDetail ? (
          <Box key="zone-after" display="none" hover={{ scope: ZONE_SCOPE, display: 'flex' }}>
            <Text dimColor>{` ${DOT} ${zoneDetail.after}`.slice(0, Math.max(0, view.columns - EDGE - zoneAt - words.length))}</Text>
          </Box>
        ) : null}
      </Box>
    ) : (
      probe
    )

  const isPicture = view.pictures === true && settings.barStyle.isPicture === true
  const detailWidth = Math.max(0, view.columns - EDGE - 1)
  // Only a picture draws the auto-compaction pill.
  const markLine = isPicture ? view.rows.find(row => row.markLine)?.markLine : undefined
  // With no picture there is no pill, and the row's own line says where auto-compaction runs:
  // the first part of the pill's line.
  const lineOf = (row: Row): string | undefined =>
    row.detail && row.markLine && !isPicture ? `${row.detail} ${DOT} ${row.markLine.split(` ${DOT} `)[0]}` : row.detail

  // A little bar takes about a cell in the picture and a glyph in text. Where they would
  // take more than a third of the bar, what was loaded is one, in the first's colour. Under
  // 5 cells there is no room for one beside the fill: the bar is one plain fill.
  const shownPieces = (row: Row): Piece[] => {
    if (barWidth < PIECES_FROM) return []
    const all = row.pieces ?? []
    const first = all[0]
    const room = (!isPicture && settings.barStyle.wide ? barWidth / 2 : barWidth) / 3
    return first && all.length > room ? [{ share: all.reduce((total, piece) => total + piece.share, 0), paint: first.paint }] : all
  }
  // Every bar shows its whole fill: with no little bars it is one plain fill from the bar's start.
  const shownOf = (row: Row): number => row.percent ?? 0
  const runsOf = (row: Row): Run[] =>
    isPicture ? [] : barRuns(barWidth, shownOf(row), settings.barStyle, row.segments, row.warned, shownPieces(row).length)
  const halfScope = (row: Row, half: number): string => `${rowScope(row)}-${half}`
  // What each half of a wide glyph stands for: its stretch of the bar, and whether that is
  // used by the row's true figure.
  const halfLines = (row: Row): { half: number; text: string }[] => {
    const halves = runsOf(row).filter(run => run.half !== undefined)
    const used = Math.round(((row.percent ?? 0) / 100) * halves.length)
    const at = (half: number) => Math.round((half / halves.length) * 100)
    return halves.map((run, half) => {
      const state = run.piece !== undefined ? 'loaded' : half < used ? 'used' : 'free'
      return { half, text: `${row.label} ${DOT} ${at(half)}% to ${at(half + 1)}% ${DOT} ${state}` }
    })
  }

  const bar = (row: Row) => {
    const fill = row.percent ?? 0
    const shown = shownOf(row)
    // In Dumb Memory the fill is in the warning colour.
    const paint = row.color ?? (row.zone?.isIn ? settings.warning : row.own)
    const percent = row.percent == null ? '--' : `${Math.min(99, Math.round(fill))}%`
    const pieces = shownPieces(row)
    return (
      <Box key={`row-${row.label}`} flexDirection="row" hover={{ scope: rowScope(row) }}>
        <Text dimColor>{row.label.padEnd(label)}</Text>
        {/* A dim dot either side of the bar, in the cell that parts it from its label and
            from its figure: they lead the eye along the row. */}
        <Text dimColor>{DOT}</Text>
        {isPicture ? (
          <Image
            key={`bar-${row.label}`}
            source={pill({
              columns: barWidth,
              ratio: settings.cellRatio,
              percent: shown,
              segments: row.segments ?? 1,
              warned: row.warned ?? 0,
              fill: paint.rgba,
              track: settings.empty.rgba,
              warn: settings.warning.rgba,
              zone: row.zone ? { ...row.zone, rest: ZONE_REST, inside: settings.warning.rgba } : undefined,
              // In the empty part's own colour, solid: the grey /context gives the buffer.
              mark: row.mark === undefined ? undefined : { at: row.mark, colour: solid(settings.empty.rgba) },
              pieces: pieces.length > 0 ? pieces.map(piece => ({ share: piece.share, colour: piece.paint.rgba })) : undefined,
            })}
            columns={barWidth}
            rows={1}
            alt={`${row.label} ${percent}`}
          />
        ) : (
          runsOf(row).map(run => (
            <Text
              {...(run.half === undefined ? {} : { hover: { scope: halfScope(row, run.half) } })}
              color={((run.piece === undefined ? undefined : pieces[run.piece]?.paint) ?? (run.part === 'filled' ? paint : run.warn ? settings.warning : settings.empty)).text}
              backgroundColor={(run.behind === 'warn' ? settings.warning : run.behind === 'empty' ? settings.empty : undefined)?.text}
            >
              {run.text}
            </Text>
          ))
        )}
        <Text dimColor>{DOT}</Text>
        <Text dimColor={row.percent == null}>{percent.padStart(PERCENT)}</Text>
        {reset > 0 ? <Text> </Text> : null}
        {reset > 0 ? (
          <Text bold={row.isLive || !!row.color} color={row.color?.text} dimColor={!row.isLive && !row.color}>
            {row.timer.slice(0, reset - 1).padStart(reset - 1)}
          </Text>
        ) : null}
        {/* A picture is one place for the pointer, so an empty box lies over the zone's cells
            of the bar, in the zone's group: the pointer there brings up the zone's words. */}
        {row.zone ? (
          <Box
            key="zone-over"
            position="absolute"
            top={0}
            left={label + 1 + Math.floor(row.zone.from * barWidth)}
            width={barWidth - Math.floor(row.zone.from * barWidth)}
            height={1}
            hover={{ scope: ZONE_SCOPE }}
          />
        ) : null}
        {/* The same over the cells the auto-compaction pill and its ring touch, in its own
            group; after the zone's, so that where the pill lies in the zone its box is on top. */}
        {isPicture && row.mark !== undefined && row.markLine
          ? (() => {
              const { first, count } = markCells(barWidth, settings.cellRatio, row.mark)
              return <Box key="mark-over" position="absolute" top={0} left={label + 1 + first} width={count} height={1} hover={{ scope: MARK_SCOPE }} />
            })()
          : null}
      </Box>
    )
  }


  const clawd =
    form === 'text' && view.clawd ? (
      <Box key="clawd-text" flexDirection="column" width={TEXT_COLUMNS}>
        {view.clawd.text.map(runs => (
          <Box flexDirection="row">
            {runs.map(run => (
              <Text color={run.color}>{run.text}</Text>
            ))}
          </Box>
        ))}
      </Box>
    ) : form === 'picture' && view.clawd?.picture ? (
      <Image
        key="clawd"
        source={view.clawd.picture.source}
        columns={BOX_COLUMNS}
        rows={BOX_ROWS}
        alt={view.clawd.picture.alt}
      />
    ) : null

  return (
    // An empty row on top keeps the band clear of the line above it.
    <Box key="band" flexDirection="column">
      {top}
      {/* Three bars drawn as pictures are as tall as Clawd and stand level with him, the model
          line under him. Bars in text, a blank row between each two, are taller and hang from
          the bottom: the last one sits beside the model line. */}
      <Box key="beside" flexDirection="row" alignItems={isPicture ? 'flex-start' : 'flex-end'}>
      {left > 0 ? (
        <Box key="clawd-column" flexDirection="column" width={left} marginLeft={before} alignItems="center">
          {clawd ? (
            // Placed by hand, so the two forms share one centre whatever the
            // column's width.
            <Box
              key="clawd-place"
              alignSelf="flex-start"
              marginLeft={Math.floor((left - (form === 'text' ? TEXT_COLUMNS : BOX_COLUMNS)) / 2)}
            >
              {clawd}
            </Box>
          ) : null}
          {view.model ? (
            <Box key="model" flexDirection="row">
              <Text bold>{view.model.name}</Text>
              {view.model.effort ? <Text dimColor>{effortText(view.model.effort)}</Text> : null}
            </Box>
          ) : null}
        </Box>
      ) : null}
      {/* A bar in text fills its cells, round ends and all, so a blank row parts each two; a
          picture leaves air of its own. */}
      <Box key="bars" flexDirection="column" marginLeft={gap} marginRight={EDGE}>
        {view.rows.flatMap((row, at) => (at === 0 || isPicture ? [bar(row)] : [<Text> </Text>, bar(row)]))}
      </Box>
      </Box>
      {/* Each row's line of detail, hidden until the pointer is on its row. Placed over the
          top row, so that showing one moves nothing, and as wide as the band, so that it
          covers what the row holds. */}
      {view.rows.map(row => {
        const detail = lineOf(row)
        return detail ? (
          <Box key={`detail-${row.label}`} position="absolute" top={0} left={1} display="none" hover={{ scope: rowScope(row), display: 'flex' }}>
            <Text>{detail.slice(0, detailWidth).padEnd(detailWidth)}</Text>
          </Box>
        ) : null
      })}
      {zoneLine ? (
        <Box key="detail-zone" position="absolute" top={0} left={1} display="none" hover={{ scope: ZONE_SCOPE, display: 'flex' }}>
          <Text>{zoneLine.slice(0, detailWidth).padEnd(detailWidth)}</Text>
        </Box>
      ) : null}
      {/* Auto-compaction's, after the zone's, so that where the pill lies in the zone its line covers the zone's. */}
      {markLine ? (
        <Box key="detail-mark" position="absolute" top={0} left={1} display="none" hover={{ scope: MARK_SCOPE, display: 'flex' }}>
          <Text>{markLine.slice(0, detailWidth).padEnd(detailWidth)}</Text>
        </Box>
      ) : null}
      {/* The same for each half of a wide glyph, drawn after the rows' lines so that the
          half's covers its row's while the pointer is on it. */}
      {view.rows.flatMap(row =>
        halfLines(row).map(({ half, text }) => (
          <Box key={`detail-${row.label}-${half}`} position="absolute" top={0} left={1} display="none" hover={{ scope: halfScope(row, half), display: 'flex' }}>
            <Text>{text.slice(0, detailWidth).padEnd(detailWidth)}</Text>
          </Box>
        )),
      )}
    </Box>
  )
}
