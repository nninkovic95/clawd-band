import type { Usage, Window } from '../types'

// What the stores hold: a reading and when it was taken. Every session of the
// account shares the one store, so the newest reading reaches them all.
export type StoredUsage = { usage: Usage; readAt: number }

export const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined

const asWindow = (value: unknown): Window | null => {
  const percentUsed = field(value, 'percentUsed')
  const resetsAt = field(value, 'resetsAt')
  if (typeof percentUsed !== 'number') return null
  return { percentUsed, resetsAt: typeof resetsAt === 'string' ? resetsAt : null }
}

// A stored value, checked. One written before readings carried their time
// counts as the oldest there is.
export const asStoredUsage = (value: unknown): StoredUsage | null => {
  const usage = { fiveHour: asWindow(field(value, 'fiveHour')), sevenDay: asWindow(field(value, 'sevenDay')) }
  if (!usage.fiveHour && !usage.sevenDay) return null
  const readAt = field(value, 'readAt')
  return { usage, readAt: typeof readAt === 'number' ? readAt : 0 }
}

// The model kept in the store. Its effort belongs to the model it was stored
// with; another model may differ, so then it is dropped.
export const asStoredModel = (value: unknown, name: string | null): { name: string | null; effort: string | undefined } => {
  const effort = field(value, 'effort')
  return { name, effort: field(value, 'name') === name && typeof effort === 'string' ? effort : undefined }
}
