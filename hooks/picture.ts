export type Rgb = [number, number, number]

// A colour with how solid it is, 0 clear to 255 solid.
export type Rgba = [number, number, number, number]

// Whole RGBA pixels in base64, as an Image takes them.
export type Picture = { rgba: string; width: number; height: number }

// The pixels of a box of cells, each cell `ratio` times as tall as wide. A
// terminal may fit a picture into its box whole or stretch it to fill the box;
// one drawn at the box's own shape comes out the same either way. A mod is
// told no cell size, so the ratio is the person's to set.
export const boxPixels = (columns: number, rows: number, ratio: number, rowHeight: number) => ({
  width: Math.round((columns * rowHeight) / ratio),
  height: rows * rowHeight,
})
