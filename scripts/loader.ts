// The hooks import each other without an extension, as the mod's loader
// resolves them; node wants one. A script imports this first, then loads the
// hooks with `await import(...)`, which is resolved after this is registered.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.')) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})
