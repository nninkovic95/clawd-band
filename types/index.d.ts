export type Pose =
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'questioning'
  | 'working'
  | 'reading'
  | 'writing'
  | 'running'
  | 'searching'
  | 'delegating'
  | 'compacting'
  | 'finished'
  | 'interrupted'
  | 'refused'
  | 'failed'

export type Window = { percentUsed: number; resetsAt: string | null }

export type Model = { name: string | null; effort: string | null }

export type Usage = { fiveHour: Window | null; sevenDay: Window | null }

// What a session had loaded before its conversation when it was first read.
export type Pin = { session: string; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'clawd-band': { pose: Pose; usage: Usage | null; model: Model; cacheAt: number | null; loaded: Pin | null }
  }
}
