import { createContext, useContext } from 'react'

/**
 * densable `SDn` — `jt(null)`. App.render `SDn.Provider` value=`this.inputNow`.
 * `ka()` = `ke(SDn)??Ho`; `Ho()` = `Date.now()`.
 */
const InputNowContext = createContext<(() => number) | null>(null)

export default InputNowContext

/** densable `ka` — `ke(SDn)??Ho`. */
export function useInputNow(): () => number {
  return useContext(InputNowContext) ?? (() => Date.now())
}
