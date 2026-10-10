import { createContext } from 'react'
import type { DOMElement } from '../core/dom.js'
import type { ClickEvent } from '../core/events/click-event.js'
import type { FocusManager } from '../core/focus.js'

/** densable `subscribeClicks` listener — hit node (or null) + ClickEvent (or null). */
export type ClickSubscribeListener = (
  node: DOMElement | null | undefined,
  event: ClickEvent | null,
) => void

/**
 * densable `Twe` / `ib` — App context.
 * Gold: `{exit, focusManager, rootNode, dispatchPasteEvent, subscribeClicks, ...}`.
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
  /**
   * densable `ib.subscribeLayout` — yoga-pass bus for `$l`.
   * Ink notifies after `runLayoutPass`.
   */
  readonly subscribeLayout: (listener: () => void) => () => void
  /**
   * densable `ib.subscribeFrames` — paint bus for `mDn`.
   * Ink notifies via `tellFrameListeners()` after onRender paint,
   * immediately before `onFrame`.
   */
  readonly subscribeFrames: (listener: () => void) => () => void
  /**
   * densable `ib.subscribeClicks` — notified on every alt-screen click
   * *before* onClick bubble (`dispatchMouseClick` → listeners → `bubbleClick`).
   * `tellClickedNowhere` delivers `(null, null)` on alt-screen exit.
   */
  readonly subscribeClicks: (listener: ClickSubscribeListener) => () => void
  /**
   * densable Twe `isHoverTracked` — `altScreenActive && mouseTracking==="full"`.
   */
  readonly isHoverTracked: () => boolean
  /**
   * densable `ib.subscribeHoverTracked` — notified on `setAltScreenActive`
   * via `queueMicrotask`.
   */
  readonly subscribeHoverTracked: (listener: () => void) => () => void
  /**
   * densable Twe `retainFinePointer` / `m1`. Gold default is `() => () => {}`.
   * PluginClient `fDn` holds the disposer while `acceptsPointer`.
   */
  readonly retainFinePointer: () => () => void
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
  subscribeLayout: () => () => {},
  subscribeFrames: () => () => {},
  subscribeClicks: () => () => {},
  isHoverTracked: () => false,
  subscribeHoverTracked: () => () => {},
  retainFinePointer: () => () => {},
})

// eslint-disable-next-line custom-rules/no-top-level-side-effects
AppContext.displayName = 'InternalAppContext'

export default AppContext
