import { createContext } from 'react'
import type { DOMElement } from '../core/dom.js'
import type { FocusManager } from '../core/focus.js'

/**
 * densable `Twe` — App context.
 * Gold: `{exit, focusManager, rootNode, dispatchPasteEvent}`.
 */
export type Props = {
  /**
   * Exit (unmount) the whole Ink app.
   */
  readonly exit: (error?: Error) => void
  /** densable Twe.focusManager — lRc reclaim uses this, not getFocusManager(wrap). */
  readonly focusManager: FocusManager | null
  /** densable Twe.rootNode */
  readonly rootNode: DOMElement | null
  /** densable Twe.dispatchPasteEvent */
  readonly dispatchPasteEvent: ((text: string) => void) | null
}

/**
 * `AppContext` is a React context for densable Twe fields.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const AppContext = createContext<Props>({
  exit() {},
  focusManager: null,
  rootNode: null,
  dispatchPasteEvent: null,
})

// eslint-disable-next-line custom-rules/no-top-level-side-effects
AppContext.displayName = 'InternalAppContext'

export default AppContext
