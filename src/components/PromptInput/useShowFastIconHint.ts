import { useEffect, useState } from 'react'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionRoot.js'

const HINT_DISPLAY_DURATION_MS = 5000

const fastIconHintStateBySession = new RootSessionSlot<{
  hasShownThisSession: boolean
}>(() => ({ hasShownThisSession: false }))

function getFastIconHintState(): { hasShownThisSession: boolean } {
  return fastIconHintStateBySession.of(getBootstrapSession())
}

/**
 * Hook to manage the /fast hint display next to the fast icon.
 * Shows the hint for 5 seconds once per session.
 */
export function useShowFastIconHint(showFastIcon: boolean): boolean {
  const [sessionState] = useState(() => getFastIconHintState())
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    if (sessionState.hasShownThisSession || !showFastIcon) {
      return
    }

    sessionState.hasShownThisSession = true
    setShowHint(true)

    const timer = setTimeout(setShowHint, HINT_DISPLAY_DURATION_MS, false)

    return () => {
      clearTimeout(timer)
      setShowHint(false)
    }
  }, [sessionState, showFastIcon])

  return showHint
}
