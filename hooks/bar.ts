import type { BarStyle } from './settings'

export type BarLayout = {
  // How much of the bar is filled, 0 to 1.
  fill: number
  // Where one segment ends and the next begins, as fractions of the bar.
  seams: number[]
  // Where the warned tail starts; 1 when no segment warns.
  warnFrom: number
}

// The bar's parts as fractions, which the text and the picture renderers each
// lay on their own grid: cells for one, pixels for the other.
export const barLayout = (percent: number, segments: number, warned: number): BarLayout => ({
  fill: Math.max(0, Math.min(1, percent / 100)),
  seams: Array.from({ length: Math.max(0, segments - 1) }, (_, k) => (k + 1) / segments),
  warnFrom: warned > 0 ? Math.max(0, (segments - warned) / segments) : 1,
})

// A stretch of a bar in one look; `warn` marks the weekly bar's last days when
// the week is being used up ahead of time.
// `behind` marks the fill's rounded end: what lies under the rest of its cell.
export type Run = { text: string; part: 'filled' | 'empty' | 'loading'; warn?: true; behind?: 'empty' | 'warn' }

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
  const layout = barLayout(percent, segments, warned)
  // The cell each segment starts at.
  const starts = [0, ...layout.seams.map(seam => Math.round(seam * cells))]
  const used = Math.round(layout.fill * cells * perCell)
  const warnFrom = Math.round(layout.warnFrom * cells)
  type Cell = { char: string; part: Run['part']; warn: boolean; behind?: Run['behind'] }
  const drawn: Cell[] = []
  // Where each day cell sits among the drawn cells, marks included.
  const at: number[] = []
  for (let cell = 0; cell < cells; cell++) {
    const step = Math.max(0, Math.min(perCell, used - cell * perCell))
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
    const end = Math.ceil(used / perCell) - 1
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
    const joins = last && !behind && !last.behind
    if (last && joins && last.part === part && (last.warn ?? false) === warn) last.text += char
    else runs.push({ text: char, part, ...(warn ? { warn: true as const } : {}), ...(behind ? { behind } : {}) })
  }
  return runs
}

// The bar of a row with no reading yet: slashes with a gap in each four, a cell
// further to the right each frame.
export const loadingRuns = (width: number, phase: number): Run[] => [
  {
    text: Array.from({ length: width }, (_, cell) => (((cell - phase) % 4) + 4) % 4 === 3 ? ' ' : '/').join(''),
    part: 'loading',
  },
]
