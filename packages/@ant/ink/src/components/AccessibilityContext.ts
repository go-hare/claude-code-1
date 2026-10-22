import { createContext } from 'react'

/**
 * densable `InternalAccessibilityContext` (`yDn`) — `jt(!1)`.
 * Ink.render wraps children: `yDn.Provider` value=`this.isScreenReaderEnabled`.
 */
const AccessibilityContext = createContext(false)
// eslint-disable-next-line custom-rules/no-top-level-side-effects
AccessibilityContext.displayName = 'InternalAccessibilityContext'

export default AccessibilityContext
