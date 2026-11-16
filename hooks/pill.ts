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
}

const ROW = 28 // the pixels a row of cells is drawn at
const WIDEST = 2048 // the most pixels across an Image takes
const SAMPLES = 4 // across and down each pixel, so that a curve's edge is smooth

type Size = { width: number; height: number }

// A very wide bar is drawn at fewer pixels a row, so that it stays a picture an Image takes.
const sizeOf = ({ columns, ratio }: Pill): Size =>
  boxPixels(columns, 1, ratio, Math.max(1, Math.min(ROW, Math.floor((WIDEST * ratio) / columns))))

// Whether a point lies in the pill that spans `from` to `to` across and the
// whole height, drawn in by `inset` all round: a line with round ends.
const inPill = (x: number, y: number, from: number, to: number, height: number, inset: number): boolean => {
  const radius = height / 2
  const middle = Math.max(from + radius, Math.min(to - radius, x))
  return Math.hypot(x - middle, y - radius) <= radius - inset
}

// What the bar shows at a point, null where it is clear. Its layers, the
// undermost first: the whole bar in the empty part's colour, or the warning's
// in the segments that warn, whose rim is the bar's edge; the fill, drawn in
// from the edge, with a clear ring round it.
// Over both, a clear hairline where two segments meet. Edge, ring and
// hairline are one line thick each, and so is the air left round the bar,
// which parts it from the bar in the next row.
const painter = (spec: Pill, { width, height }: Size) => {
  const line = Math.max(1, Math.round(height / 12))
  const air = line
  const segment = width / spec.segments
  const warnFrom = (spec.segments - spec.warned) * segment
  // A fill shorter than it is high is still round: a pill is never less than a circle.
  const end = (width * Math.min(100, spec.percent)) / 100
  return (x: number, y: number): Rgba | null => {
    if (!inPill(x, y, 0, width, height, air)) return null
    const seam = Math.round(x / segment) * segment
    if (seam > 0 && seam < width && Math.abs(x - seam) < line / 2) return null
    if (end > 0 && inPill(x, y, 0, end, height, air + 2 * line)) return spec.fill
    if (end > 0 && inPill(x, y, 0, end, height, air + line)) return null
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
