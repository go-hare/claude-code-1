/**
 * densable 2.1.289 `Vwr` / `v3e` — branded empty object meaning this
 * submit came from composer Enter. Gold PromptInput:
 * `_b=qv||Z_?void 0:Vwr()`. print Dy / QE Art omit composerEnter.
 * Never export densable ids.
 */

const minted = new WeakSet<object>()

/** densable `Vwr`. */
export function mintComposerEnter(): object {
  const token = Object.freeze({})
  minted.add(token)
  return token
}

/** densable `v3e`. */
export function isComposerEnter(value: unknown): boolean {
  return typeof value === 'object' && value !== null && minted.has(value)
}
