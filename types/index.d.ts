export type Pose =
  | 'idle'
  | 'thinking'
  | 'questioning'
  | 'working'
  | 'reading'
  | 'writing'
  | 'running'
  | 'searching'
  | 'delegating'

export type Window = { percentUsed: number; resetsAt: string | null }

export type Model = { name: string | null; effort: string | null }

export type Usage = { fiveHour: Window | null; sevenDay: Window | null }

declare module 'claude-code' {
  interface PluginState {
    'clawd-band': { pose: Pose; usage: Usage | null; model: Model }
  }
}
