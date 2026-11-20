// The update step for a merge into an atom: the merged value, or the current
// one when the merge changes nothing. `changed()` says whether it did.
// (`update` itself stays at each call site: the engine's scan wants the atom
// spelled in the module that calls it.)
export function merging<T>(
  merge: (current: T | null | undefined) => T,
  same: (a: T | null | undefined, b: T | null | undefined) => boolean,
) {
  let changed = false
  return {
    step: (current: T | undefined): T => {
      const merged = merge(current)
      if (same(current, merged)) return current ?? merged
      changed = true
      return merged
    },
    changed: () => changed,
  }
}
