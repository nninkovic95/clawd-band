import type { Rgb } from './picture'

// Clawd's own orange, the body colour the sprite_color option replaces.
export const CLAUDE_ORANGE: Rgb = [215, 119, 87]

export const toHex = (rgb: Rgb): string => `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

// Three or six hex digits, with or without the #; anything else is no colour.
export const toRgb = (hex: string): Rgb | null => {
  const short = HEX.exec(hex.trim())?.[1]
  if (!short) return null
  const digits = short.length === 3 ? [...short].map(d => d + d).join('') : short
  const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16)
  return [channel(0), channel(2), channel(4)]
}
