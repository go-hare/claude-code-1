/**
 * Official 2.1.323 (#2210): `subagentStatusLine` setting has been removed.
 * Subagent rows always use the default look.
 */
import { useEffect } from 'react'
import { useSetAppState } from '../state/AppState.js'

/**
 * Official 2.1.323 (#2210): `subagentStatusLine` setting has been removed.
 * Subagent rows always use the default look. Kept as a silent no-op hook that
 * clears any lingering taskDecorations without spawning external commands.
 */
export function useSubagentStatusLine(): void {
  const setAppState = useSetAppState()

  useEffect(() => {
    setAppState(prev =>
      Object.keys(prev.taskDecorations ?? {}).length === 0
        ? prev
        : { ...prev, taskDecorations: {} },
    )
  }, [setAppState])
}
