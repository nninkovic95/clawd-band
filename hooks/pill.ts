import { boxPixels } from './picture'
import type { Picture, Rgba } from './picture'

// A bar drawn as a picture: one row of cells holding a pill.
export type Pill = {
  // The bar's width in cells, and how many times taller than wide a cell is.
  columns: number
  ratio: number
  percent: number
  // Parts of equal length, a hairline between each two: the weekly bar's days.
  segments: number
  // How many of the last segments warn: their empty part is in `warn`.
  warned: number
  fill: Rgba
  track: Rgba
  warn: Rgba
  // Dumb Memory: where it starts along the bar, 0 to 1, whether the session is in it, and
  // its outline's colour short of it and inside it.
  zone?: { from: number; isIn: boolean; rest: Rgba; inside: Rgba }
  // Where auto-compaction runs along the bar, 0 to 1, and the colour of its mark.
  mark?: { at: number; colour: Rgba }
  // Little pills of their own at the bar's start, each its share of the bar, 0 to 1; the
  // fill starts after them.
  pieces?: { share: number; colour: Rgba }[]
}

const ROW = 28 // the pixels a row of cells is drawn at
const WIDEST = 2048 // the most pixels across an Image takes
const SAMPLES = 4 // across and down each pixel, so that a curve's edge is smooth

type Size = { width: number; height: number }

// A very wide bar is drawn at fewer pixels a row, so that it stays a picture an Image takes.
const sizeOf = ({ columns, ratio }: Pick<Pill, 'columns' | 'ratio'>): Size =>
  boxPixels(columns, 1, ratio, Math.max(1, Math.min(ROW, Math.floor((WIDEST * ratio) / columns))))

// How thick the bar's edge, rings and air are in a row of `height` pixels.
const lineOf = (height: number): number => Math.max(1, Math.round(height / 12))

// The bar's cells that auto-compaction's mark at `at`, 0 to 1, touches with its clear ring,
// which runs 3 lines either side of its place: the first of them and how many.
export const markCells = (columns: number, ratio: number, at: number): { first: number; count: number } => {
  const { width, height } = sizeOf({ columns, ratio })
  const reach = 3 * lineOf(height)
  const cell = width / columns
  const first = Math.max(0, Math.floor((width * at - reach) / cell))
  const last = Math.min(columns - 1, Math.ceil((width * at + reach) / cell) - 1)
  return { first, count: Math.max(1, last - first + 1) }
}

// Whether a point lies in the pill that spans `from` to `to` across and the
// whole height, drawn in by `inset` all round: a line with round ends.
const inPill = (x: number, y: number, from: number, to: number, height: number, inset: number): boolean => {
  const radius = height / 2
  const middle = Math.max(from + radius, Math.min(to - radius, x))
  return Math.hypot(x - middle, y - radius) <= radius - inset
}

// Whether a point lies in the box from `from` to `to` across, drawn in by `inset` from the
// row's top and bottom, its corners round: a pill where it is long enough to be one.
const inSlab = (x: number, y: number, from: number, to: number, height: number, inset: number): boolean => {
  if (to <= from) return false
  const radius = Math.min(height / 2 - inset, (to - from) / 2)
  const cx = Math.max(from + radius, Math.min(to - radius, x))
  const cy = Math.max(inset + radius, Math.min(height - inset - radius, y))
  return Math.hypot(x - cx, y - cy) <= radius
}

// What the bar shows at a point, null where it is clear. Its layers, the
// undermost first: the whole bar in the empty part's colour, or the warning's
// in the segments that warn, whose rim is the bar's edge; the fill, drawn in
// from the edge, with a clear ring round it.
// Over both, a clear hairline where two segments meet. Edge, ring and
// hairline are one line thick each, and so is the air left round the bar,
// which parts it from the bar in the next row.
const painter = (spec: Pill, { width, height }: Size) => {
  const line = lineOf(height)
  const air = line
  const segment = width / spec.segments
  const warnFrom = (spec.segments - spec.warned) * segment
  // A fill shorter than it is high is still round: a pill is never less than a circle.
  const end = (width * Math.min(100, spec.percent)) / 100
  // Dumb Memory's outline lies where the fill's clear ring would, from its start to the
  // bar's own end, one line thick.
  const zone = spec.zone
  const zoneFrom = zone ? width * zone.from : 0
  const zoneTo = width - air - line
  // With the session in it, the outline takes its inside colour. The fill within it shows
  // by turns with the outline's resting colour, in slanting stripes two lines wide: a fill
  // and an inside colour close in hue run together in stripes this fine. What is left of
  // its inside is the inside colour as solid as the empty part is.
  const within = zone?.isIn ? zone.inside : null
  const faint: Rgba | null = within ? [within[0], within[1], within[2], spec.track[3]] : null
  const isStripe = (x: number, y: number) => Math.floor((x + y) / (2 * line)) % 2 === 1
  // Auto-compaction's mark: a short pill of its own on its place, as tall as the fill, a
  // clear ring round it, over whatever of the bar lies there.
  const mark = spec.mark
  const markFrom = mark ? width * mark.at - 2 * line : 0
  const markTo = markFrom + 4 * line
  // The little pills stand where a fill would, one after another, a clear ring round each:
  // two rings side by side are the gap between two. Each is as long as its share of the
  // bar, or, where that is longer, 3 lines and up to 4 more by its share against the
  // largest's, so that kinds a large window holds a pixel of each still differ: 6 to 14
  // pixels at a line of 2. Each is rounded to whole pixels. The fill is then a pill of its
  // own after the last, never shorter than 8 lines, longer than any little pill. The first
  // stands a gap in from where a fill starts: its corners are tighter than the bar's round
  // end, and any nearer its ring would cut through the bar's rim.
  const inset = air + 2 * line
  const pieces = spec.pieces ?? []
  const largest = Math.max(0, ...pieces.map(piece => piece.share))
  const slabs: { from: number; to: number; colour: Rgba }[] = []
  for (const piece of pieces) {
    const from = (slabs.at(-1)?.to ?? inset) + 2 * line
    const scaled = 3 * line + 4 * line * (largest > 0 ? piece.share / largest : 1)
    slabs.push({ from, to: from + Math.round(Math.max(scaled, width * piece.share)), colour: piece.colour })
  }
  const last = slabs.at(-1)
  const fillFrom = last ? last.to + 2 * line : 0
  const fillTo = Math.max(fillFrom + 8 * line, end - inset)
  const inFill = (x: number, y: number, grown: number): boolean =>
    end > 0 && (last ? inSlab(x, y, fillFrom - grown, fillTo + grown, height, inset - grown) : inPill(x, y, 0, end, height, inset - grown))
  return (x: number, y: number): Rgba | null => {
    if (!inPill(x, y, 0, width, height, air)) return null
    const seam = Math.round(x / segment) * segment
    if (seam > 0 && seam < width && Math.abs(x - seam) < line / 2) return null
    if (mark && inSlab(x, y, markFrom, markTo, height, air + 2 * line)) return mark.colour
    if (mark && inSlab(x, y, markFrom - line, markTo + line, height, air + line)) return null
    const isInside = zone !== undefined && inSlab(x, y, zoneFrom + line, zoneTo - line, height, air + 2 * line)
    if (zone && !isInside && inSlab(x, y, zoneFrom, zoneTo, height, air + line)) return within ?? zone.rest
    const slab = slabs.find(slab => inSlab(x, y, slab.from, slab.to, height, inset))
    if (slab) return slab.colour
    if (inFill(x, y, 0)) return zone && isInside && within && isStripe(x, y) ? zone.rest : spec.fill
    if (slabs.some(slab => inSlab(x, y, slab.from - line, slab.to + line, height, inset - line))) return null
    if (inFill(x, y, line)) return null
    if (isInside && faint) return faint
    return x >= warnFrom ? spec.warn : spec.track
  }
}

type ColourAt = (x: number, y: number) => Rgba | null

// A pixel on an edge: the mean of its samples, each weighed by how solid its colour is.
const blend = (colourAt: ColourAt, x: number, y: number): Rgba | null => {
  let [red, green, blue, solid] = [0, 0, 0, 0]
  for (let sample = 0; sample < SAMPLES * SAMPLES; sample++) {
    const colour = colourAt(x + ((sample % SAMPLES) + 0.5) / SAMPLES, y + (Math.floor(sample / SAMPLES) + 0.5) / SAMPLES)
    if (!colour) continue
    red += colour[0] * colour[3]
    green += colour[1] * colour[3]
    blue += colour[2] * colour[3]
    solid += colour[3]
  }
  if (solid === 0) return null
  return [Math.round(red / solid), Math.round(green / solid), Math.round(blue / solid), Math.round(solid / (SAMPLES * SAMPLES))]
}

const draw = (spec: Pill): Picture => {
  const size = sizeOf(spec)
  const colourAt = painter(spec, size)
  const px = new Uint8Array(size.width * size.height * 4)
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      // Most pixels lie off every edge, and no part of a bar is thinner than a pixel: where
      // the four corners agree the pixel is that colour whole, and the samples are spared.
      const corner = colourAt(x, y)
      const isWhole = corner === colourAt(x + 1, y) && corner === colourAt(x, y + 1) && corner === colourAt(x + 1, y + 1)
      const colour = isWhole ? corner : blend(colourAt, x, y)
      if (colour) px.set(colour, (y * size.width + x) * 4)
    }
  }
  return { rgba: px.toBase64(), ...size }
}

// The pictures drawn last, by what they were drawn from: the band is drawn
// every second, and a bar seldom changes.
const KEPT = 8
const kept = new Map<string, Picture>()

export const pill = (spec: Pill): Picture => {
  const key = JSON.stringify(spec)
  const picture = kept.get(key) ?? draw(spec)
  // Set again, it is the newest; the oldest goes once there are too many.
  kept.delete(key)
  kept.set(key, picture)
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT) break
    kept.delete(oldest)
  }
  return picture
}
