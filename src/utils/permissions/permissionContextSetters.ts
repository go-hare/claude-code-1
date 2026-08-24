/**
 * densable 2.1.234 `y8r` — shared AppState writers for tool permission context.
 *
 * Main session wires both setters to the same updater. Background / workflow
 * subagents noop `setToolPermissionContext` but always inherit
 * `setSessionToolPermissionContext` so session-scoped allow/deny rules from
 * permission prompts are not dropped.
 */

import type { AppState } from '../../state/AppState.js'
import type { ToolPermissionContext } from '../../Tool.js'

export type ToolPermissionContextUpdate =
  | ToolPermissionContext
  | ((prev: ToolPermissionContext) => ToolPermissionContext)

export type SetToolPermissionContextFn = (
  update: ToolPermissionContextUpdate,
) => void

/**
 * densable `y8r(setAppState)` — both returned setters are identical and write
 * `toolPermissionContext` on the root AppState.
 */
export function createAppStatePermissionContextSetters(
  setAppState: (f: (prev: AppState) => AppState) => void,
): {
  setToolPermissionContext: SetToolPermissionContextFn
  setSessionToolPermissionContext: SetToolPermissionContextFn
} {
  const apply: SetToolPermissionContextFn = update => {
    setAppState(prev => {
      const next =
        typeof update === 'function'
          ? update(prev.toolPermissionContext)
          : update
      if (prev.toolPermissionContext === next) return prev
      return { ...prev, toolPermissionContext: next }
    })
  }
  return {
    setToolPermissionContext: apply,
    setSessionToolPermissionContext: apply,
  }
}
