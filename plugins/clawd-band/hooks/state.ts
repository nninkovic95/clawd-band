import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Model, Pose, Usage, Window } from '../types'

// The session's state, each atom defined here once. The engine's scan reads
// only an atom spelled in the file that calls read or update on it, so every
// such call is made here and the other modules go through these.
const poseAtom = atom({ plugin: 'clawd-band', key: 'pose' } as const, 'idle')
const usageAtom = atom({ plugin: 'clawd-band', key: 'usage' } as const, null)
const modelAtom = atom({ plugin: 'clawd-band', key: 'model' } as const, { name: null, effort: null })
// When the main thread's last reply came back: the prompt cache's clock.
const cacheAtom = atom({ plugin: 'clawd-band', key: 'cacheAt' } as const, null)

type Change<T> = (value: T) => T

export function readPose($: EngineInterface) {
  return read($, poseAtom)
}
export function updatePose($: EngineInterface, change: Change<Pose>) {
  return update($, poseAtom, change)
}
export function readUsage($: EngineInterface) {
  return read($, usageAtom)
}
export function updateUsage($: EngineInterface, change: Change<Usage | null>) {
  return update($, usageAtom, change)
}
export function readModel($: EngineInterface) {
  return read($, modelAtom)
}
export function updateModel($: EngineInterface, change: Change<Model>) {
  return update($, modelAtom, change)
}
export function readCacheAt($: EngineInterface) {
  return read($, cacheAtom)
}
export function updateCacheAt($: EngineInterface, change: Change<number | null>) {
  return update($, cacheAtom, change)
}

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
