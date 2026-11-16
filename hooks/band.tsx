import type { Elements, SessionContextUsage } from 'claude-code'

import type { Usage, Window } from '../types'
import type { BarStyle, Paint, Settings } from './settings'
import type { Picture } from './picture'
import { pill } from './pill'
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

// A stretch of a bar in one look; `warn` marks the weekly bar's last days when
// the week is being used up ahead of time.
// `behind` marks the fill's rounded end: what lies under the rest of its cell.
export type Run = { text: string; part: 'filled' | 'empty'; warn?: true; behind?: 'empty' | 'warn' }

// The cell between two days of the weekly bar: left blank, a clean gap in the
// solid bar. Claude Code draws `dimColor` in the theme's grey, so days cannot be
// told apart by shade, and a line glyph shows as a line between two gaps.
const MARK = ' '

// A bar's cells as runs of one kind. The cells fill one after another, each
// through every step of the style, so a style of five steps shows a quarter
// of a cell. A bar in `segments` (the weekly bar, one per day) has a mark
// between them where each gets a cell. The bar takes all the room
// it is given, so a segment may be a cell longer than another: each mark sits
// on the cell nearest its true place, which spreads the longer ones out. A
// mark the fill runs past takes its colour. The last `warned` segments' cells
// are marked to warn; the marks between them are not. A style with caps rounds
// the bar's ends, and the fill's end into what lies behind it.
export const barRuns = (width: number, percent: number, style: BarStyle, segments = 1, warned = 0): Run[] => {
  const perCell = style.steps.length - 1
  const marks = segments - 1
  const split = marks > 0 && width - marks >= segments
  const cells = split ? width - marks : width
  // The cell each segment starts at.
  const starts = Array.from({ length: segments }, (_, k) => Math.round((k * cells) / segments))
  const lit = Math.min(cells * perCell, Math.round((percent / 100) * cells * perCell))
  const warnFrom = warned > 0 ? (starts[segments - warned] ?? cells) : cells
  type Cell = { char: string; part: Run['part']; warn: boolean; behind?: Run['behind'] }
  const drawn: Cell[] = []
  // Where each day cell sits among the drawn cells, marks included.
  const at: number[] = []
  for (let cell = 0; cell < cells; cell++) {
    const step = Math.max(0, Math.min(perCell, lit - cell * perCell))
    const part = step > 0 ? 'filled' : 'empty'
    if (split && cell > 0 && starts.includes(cell)) drawn.push({ char: MARK, part, warn: false })
    at.push(drawn.length)
    // Only an empty cell warns: a used one keeps the fill's colour.
    drawn.push({ char: style.steps[step] ?? style.steps[0], part, warn: part === 'empty' && cell >= warnFrom })
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
    if (end > 0 && end < cells - 1 && fillEnd && next) {
      fillEnd.char = right
      if (next.char !== MARK) fillEnd.behind = next.warn ? 'warn' : 'empty'
    }
  }
  const runs: Run[] = []
  for (const { char, part, warn, behind } of drawn) {
    const last = runs[runs.length - 1]
    if (last && !behind && !last.behind && last.part === part && (last.warn ?? false) === warn) last.text += char
    else runs.push({ text: char, part, ...(warn ? { warn: true as const } : {}), ...(behind ? { behind } : {}) })
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

export type Reading = {
  usage: Usage | null | undefined
  context: SessionContextUsage | null | undefined
  cacheAt: number | null | undefined
  now: number
}

// The rows the person asked for, top to bottom: the week, the five hours, and
// the context window with the prompt cache's countdown.
export const rowsOf = ({ usage, context, cacheAt, now }: Reading, settings: Settings): Row[] => {
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
  })
  const cacheTimer = cacheCountdown(cacheAt, settings.cacheTtlMs, now)
  const isCold = cacheTimer === 'cold'
  const rows: Row[] = []
  if (settings.showWeekly) rows.push(windowRow('7d', usage?.sevenDay, settings.weeklyColor, true))
  if (settings.showFiveHour) rows.push(windowRow('5h', usage?.fiveHour, settings.fiveHourColor))
  if (settings.showContext) {
    rows.push({
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

export function band(view: View, settings: Settings, { Box, Text, Image }: Elements['terminal']) {
  const fitted = fit(view)
  if (!fitted) return <Box />
  const { form, before, left, gap, label, reset, barWidth } = fitted

  const isPicture = view.pictures === true && settings.barStyle.isPicture === true

  const bar = (row: Row) => {
    const fill = row.percent ?? 0
    const paint = row.color ?? row.own
    const percent = row.percent == null ? '--' : `${Math.min(99, Math.round(fill))}%`
    return (
      <Box flexDirection="row">
        <Text dimColor>{row.label.padEnd(label)}</Text>
        <Text> </Text>
        {isPicture ? (
          <Image
            key={`bar-${row.label}`}
            source={pill({
              columns: barWidth,
              ratio: settings.cellRatio,
              percent: fill,
              segments: row.segments ?? 1,
              warned: row.warned ?? 0,
              fill: paint.rgba,
              track: settings.empty.rgba,
              warn: settings.warning.rgba,
            })}
            columns={barWidth}
            rows={1}
            alt={`${row.label} ${percent}`}
          />
        ) : (
          barRuns(barWidth, fill, settings.barStyle, row.segments, row.warned).map(run => (
            <Text
              color={(run.part === 'filled' ? paint : run.warn ? settings.warning : settings.empty).text}
              backgroundColor={(run.behind === 'warn' ? settings.warning : run.behind === 'empty' ? settings.empty : undefined)?.text}
            >
              {run.text}
            </Text>
          ))
        )}
        <Text> </Text>
        <Text dimColor={row.percent == null}>{percent.padStart(PERCENT)}</Text>
        {reset > 0 ? <Text> </Text> : null}
        {reset > 0 ? (
          <Text bold={row.isLive || !!row.color} color={row.color?.text} dimColor={!row.isLive && !row.color}>
            {row.timer.slice(0, reset - 1).padStart(reset - 1)}
          </Text>
        ) : null}
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
      {view.pictures === null ? <Text> </Text> : <Image key="probe" source={PROBE} columns={1} rows={1} alt=" " />}
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
    </Box>
  )
}
