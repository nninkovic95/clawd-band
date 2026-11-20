import type { Elements } from 'claude-code'

import { barRuns, loadingRuns } from './bar'
import type { Run } from './bar'
import type { Settings } from './settings'
import type { Picture } from './picture'
import { pill } from './pill'
import type { Row } from './rows'
import { BOX_COLUMNS, BOX_ROWS, TEXT_COLUMNS } from './sprite'
import type { TextFrame } from './sprite'

const PERCENT = 3 // "99%": a window used up reads 99%, so the percentage keeps its width
const RESET = 12 // " 06d-23h-59m" or " 04h-59m-59s": one width for every row
const SHORT_RESET = 8 // " 06d-23h" or " 04h-59m": the two biggest units, where the band is narrow
const MIN_BAR = 4
const MAX_BAR = 255 // the most cells an Image takes; the bars in text keep to it, so both forms end at one place
const EDGE = 1 // the cell kept free at the band's right edge
const FRAME = 2 // a dim dot either side of the bars

// What a row with no reading spins through, a frame at a time.
const SPIN = ['-', '\\', '|', '/']
const SILVER_TEXT = '#bec3cd'

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
  // The frame the spinning rows are at.
  phase?: number
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
  const label = Math.max(0, ...view.rows.map(row => row.label.length)) // "7d" or "200k"
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

// The hover groups: a row and its line of detail light together.
const rowScope = (row: Row): string => `clawd-band-${row.label}`
const DOT = '·'

export function band(view: View, settings: Settings, { Box, Text, Image }: Elements['terminal']) {
  const fitted = fit(view)
  if (!fitted) return <Box />
  const { form, before, left, gap, label, reset, barWidth } = fitted

  const probe = view.pictures === null ? <Text> </Text> : <Image key="probe" source={PROBE} columns={1} rows={1} alt=" " />

  const isPicture = view.pictures === true && settings.barStyle.isPicture === true
  const detailWidth = Math.max(0, view.columns - EDGE - 1)

  const phase = view.phase ?? 0
  const spin = SPIN[phase % 4] ?? '-'
  const runsOf = (row: Row, fill: number): Run[] =>
    isPicture ? [] : row.isLoading ? loadingRuns(barWidth, phase) : barRuns(barWidth, fill, settings.barStyle, row.segments, row.warned)

  const bar = (row: Row) => {
    // Every bar shows its whole fill, one plain fill from the bar's start.
    const fill = row.percent ?? 0
    const paint = row.color ?? row.own
    const percent = row.percent == null ? (row.isLoading ? spin : '--') : `${String(Math.min(99, Math.round(fill))).padStart(2, '0')}%`
    const timer = row.isLoading ? row.timer.replaceAll('-', spin) : row.timer
    return (
      <Box key={`row-${row.label}`} flexDirection="row" hover={{ scope: rowScope(row) }}>
        <Text dimColor>{row.label.padEnd(label)}</Text>
        {/* A dim dot either side of the bar, in the cell that parts it from its label and
            from its figure: they guide the eye along the row. */}
        <Text dimColor>{DOT}</Text>
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
              ...(row.isLoading ? { loading: phase } : {}),
            })}
            columns={barWidth}
            rows={1}
            alt={`${row.label} ${percent}`}
          />
        ) : (
          runsOf(row, fill).map(run => (
            <Text
              color={run.part === 'loading' ? SILVER_TEXT : (run.part === 'filled' ? paint : run.warn ? settings.warning : settings.empty).text}
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
            {timer.slice(0, reset - 1).padStart(reset - 1)}
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
      {probe}
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
        const detail = row.detail
        return detail ? (
          <Box key={`detail-${row.label}`} position="absolute" top={0} left={1} display="none" hover={{ scope: rowScope(row), display: 'flex' }}>
            <Text>{detail.slice(0, detailWidth).padEnd(detailWidth)}</Text>
          </Box>
        ) : null
      })}
    </Box>
  )
}
