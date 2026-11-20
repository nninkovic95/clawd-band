import { expect, test } from 'claude-code/testing'

import { merging } from './merge'

type Counts = { a: number | null; b: number | null }

// A reading names only the fields it has; the rest keep their last value.
const fill = (incoming: Counts) => (current: Counts | null | undefined) => ({
  a: incoming.a ?? current?.a ?? null,
  b: incoming.b ?? current?.b ?? null,
})
const same = (x: Counts | null | undefined, y: Counts | null | undefined) => x?.a === y?.a && x?.b === y?.b

test('a merge that changes the value is the new value, and says it changed', () => {
  const m = merging(fill({ a: null, b: 2 }), same)
  expect(m.step({ a: 1, b: null })).toEqual({ a: 1, b: 2 })
  expect(m.changed()).toBe(true)
})

test('a merge that changes nothing hands back the current value and says so', () => {
  const current = { a: 1, b: 2 }
  const m = merging(fill({ a: 1, b: null }), same)
  expect(m.step(current)).toBe(current)
  expect(m.changed()).toBe(false)
})

test('with nothing held yet, the first reading is a change', () => {
  const m = merging(fill({ a: 1, b: null }), same)
  expect(m.step(undefined)).toEqual({ a: 1, b: null })
  expect(m.changed()).toBe(true)
})
