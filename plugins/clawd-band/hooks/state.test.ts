import { expect, test } from 'claude-code/testing'

import { asStoredModel, asStoredUsage, field } from './state'

test('a field is read from any object, and is nothing from anything else', () => {
  expect(field({ a: 1 }, 'a')).toBe(1)
  expect(field({ a: 1 }, 'b')).toBe(undefined)
  expect(field('text', 'a')).toBe(undefined)
  expect(field(null, 'a')).toBe(undefined)
})

test('a stored reading is checked, and one without a time is the oldest', () => {
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: null },
  }
  expect(asStoredUsage({ ...usage, readAt: 7 })).toEqual({ usage, readAt: 7 })
  expect(asStoredUsage(usage)).toEqual({ usage, readAt: 0 })
  expect(asStoredUsage({ fiveHour: 'full', sevenDay: null })).toBe(null)
  expect(asStoredUsage('nonsense')).toBe(null)
  expect(asStoredUsage(undefined)).toBe(null)
})

test('a stored effort belongs to the stored model, and is dropped for another', () => {
  expect(asStoredModel({ name: 'opus', effort: 'high' }, 'opus')).toEqual({ name: 'opus', effort: 'high' })
  expect(asStoredModel({ name: 'opus', effort: 'high' }, 'sonnet')).toEqual({ name: 'sonnet', effort: undefined })
  expect(asStoredModel({ name: 'opus', effort: 7 }, 'opus')).toEqual({ name: 'opus', effort: undefined })
  expect(asStoredModel('nonsense', 'opus')).toEqual({ name: 'opus', effort: undefined })
  expect(asStoredModel(undefined, null)).toEqual({ name: null, effort: undefined })
})
