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
