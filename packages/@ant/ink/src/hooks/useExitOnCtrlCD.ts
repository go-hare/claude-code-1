import { useCallback, useMemo, useState } from 'react'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import useApp from './use-app.js'
import { useDoublePress } from './useDoublePress.js'

export type ExitState = {
  pending: boolean
  keyName: 'Ctrl-C' | 'Ctrl-D' | null
}

/**
 * Full keybinding-aware Ctrl+C/D double-press exit hook for @anthropic/ink.
 * Mirrors src/hooks/useExitOnCtrlCDWithKeybindings.ts without importing src/.
 */
export function useExitOnCtrlCDWithKeybindings(
  onExit?: () => void,
  onInterrupt?: () => boolean,
  isActive: boolean = true,
): ExitState {
  const { exit } = useApp()
  const [exitState, setExitState] = useState<ExitState>({
    pending: false,
    keyName: null,
  })

  const exitFn = useMemo(() => onExit ?? exit, [onExit, exit])

  const handleCtrlCDoublePress = useDoublePress(
    pending => setExitState({ pending, keyName: pending ? 'Ctrl-C' : null }),
    exitFn,
  )

  const handleCtrlDDoublePress = useDoublePress(
    pending => setExitState({ pending, keyName: pending ? 'Ctrl-D' : null }),
    exitFn,
  )

  const handleInterrupt = useCallback(() => {
    if (onInterrupt?.()) return
    handleCtrlCDoublePress()
  }, [handleCtrlCDoublePress, onInterrupt])

  const handleExit = useCallback(() => {
    handleCtrlDDoublePress()
  }, [handleCtrlDDoublePress])

  const handlers = useMemo(
    () => ({
      'app:interrupt': handleInterrupt,
      'app:exit': handleExit,
    }),
    [handleInterrupt, handleExit],
  )

  useKeybindings(handlers, { context: 'Global', isActive })

  return exitState
}
