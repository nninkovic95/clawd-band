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

declare module 'claude-code' {
  interface PluginState {
    'clawd-band': { pose: Pose; usage: Usage | null; model: Model; cacheAt: number | null }
  }
}

declare global {
  // The runtime's base64 methods on byte arrays; the types this module is
  // checked against stop a version of the language short of them.
  interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
    toBase64(): string
  }
  interface Uint8ArrayConstructor {
    fromBase64(text: string): Uint8Array<ArrayBuffer>
  }
}
