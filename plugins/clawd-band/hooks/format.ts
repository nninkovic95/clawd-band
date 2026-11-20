// The weekly window as `06d-18h-44m`, the five-hour one as `03h-33m-24s`: the
// same width, so the two countdowns line up under each other. Both ends are
// cut to whole seconds, so every countdown steps when the clock's second does.
export const countdown = (resetsAt: string | null | undefined, now: number, withDays = false): string => {
  if (!resetsAt) return withDays ? '--d---h---m' : '--h---m---s'
  const total = Math.max(0, Math.floor(Date.parse(resetsAt) / 1000) - Math.floor(now / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const minutes = Math.floor((total % 3600) / 60)
  if (withDays) return `${two(Math.floor(total / 86400))}d-${two(Math.floor((total % 86400) / 3600))}h-${two(minutes)}m`
  return `${two(Math.floor(total / 3600))}h-${two(minutes)}m-${two(total % 60)}s`
}

// The prompt cache's time left: `00h-59m-12s` while warm, `cold` once the
// entry has lapsed, dashes before the first reply.
export const cacheCountdown = (cacheAt: number | null | undefined, ttlMs: number, now: number): string => {
  if (!cacheAt) return countdown(null, now)
  const expires = cacheAt + ttlMs
  return expires <= now ? 'cold' : countdown(new Date(expires).toISOString(), now)
}

// The context window's size as the row's label: 1000000 -> "1m", 200000 -> "200k".
export const windowLabel = (tokens: number | null | undefined): string => {
  if (!tokens || tokens <= 0) return 'cx'
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}m`
  return `${Math.round(tokens / 1000)}k`
}

// 320807 -> "320.8k", 667000 -> "667k", 1000000 -> "1M".
export const tokensText = (tokens: number): string => {
  const trim = (value: number) => String(Math.round(value * 10) / 10)
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`
  return tokens >= 1000 ? `${trim(tokens / 1000)}k` : String(tokens)
}
