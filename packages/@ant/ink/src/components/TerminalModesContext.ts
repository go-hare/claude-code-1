import { createContext } from 'react'
import type { TerminalModes } from '../core/terminalModes.js'

/**
 * densable `InternalTerminalModesContext` (`aRt`) — same `dqe` instance as
 * Ink.modes so App raw-mode / AlternateScreen / SIGTSTP share one stack.
 */
const TerminalModesContext = createContext<TerminalModes | null>(null)
// eslint-disable-next-line custom-rules/no-top-level-side-effects
TerminalModesContext.displayName = 'InternalTerminalModesContext'

export default TerminalModesContext
