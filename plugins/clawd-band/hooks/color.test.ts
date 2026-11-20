import { expect, test } from 'claude-code/testing'

import { CLAUDE_ORANGE, toHex, toRgb } from './color'

test('a colour is hex both ways, short or long, with or without the #', () => {
  expect(toHex(CLAUDE_ORANGE)).toBe('#d77757')
  expect(toRgb('#d77757')).toEqual(CLAUDE_ORANGE)
  expect(toRgb(' D77757 ')).toEqual(CLAUDE_ORANGE)
  expect(toRgb('#fa0')).toEqual([255, 170, 0])
})

test('text that is not hex is no colour', () => {
  expect(toRgb('orange')).toBe(null)
  expect(toRgb('#12345')).toBe(null)
})
