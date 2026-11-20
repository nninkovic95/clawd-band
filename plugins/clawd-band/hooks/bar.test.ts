import { expect, test } from 'claude-code/testing'

import { barLayout } from './bar'

test('the fill is the share used, as a fraction of the bar, never past the whole', () => {
  expect(barLayout(0, 1, 0).fill).toBe(0)
  expect(barLayout(40, 1, 0).fill).toBe(0.4)
  expect(barLayout(150, 1, 0).fill).toBe(1)
  expect(barLayout(-5, 1, 0).fill).toBe(0)
})

test('a bar of one segment has no seam; n segments have n - 1, evenly spaced', () => {
  expect(barLayout(50, 1, 0).seams).toEqual([])
  expect(barLayout(50, 4, 0).seams).toEqual([0.25, 0.5, 0.75])
})

test('the warned tail starts where the last segments start, and nowhere when none warn', () => {
  expect(barLayout(50, 7, 3).warnFrom).toBe(4 / 7)
  expect(barLayout(50, 7, 0).warnFrom).toBe(1)
  // More warned than there are segments is the whole bar.
  expect(barLayout(50, 2, 5).warnFrom).toBe(0)
})
