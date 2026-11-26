import type { ToolPermissionContext } from '../../Tool.js'
import {
  isModeBlockedByHeldToAuto,
  type PermissionMode,
} from './PermissionMode.js'
import {
  isAutoModeGateEnabled,
  transitionPermissionMode,
} from './permissionSetup.js'

function canCycleToAutoModeInCycle(
  toolPermissionContext: ToolPermissionContext,
): boolean {
  return (
    Boolean(toolPermissionContext.isAutoModeAvailable) &&
    isAutoModeGateEnabled()
  )
}

/**
 * Determines the next permission mode when cycling through modes with Shift+Tab.
 *
 * Official 2.1.289 cycle (with 2.1.331 `RIo` held-to-auto filtering):
 *   default → acceptEdits (skipped when held to auto) → plan
 *     ├─ if isBypassPermissionsModeAvailable && !heldToAuto → bypassPermissions → (auto if gated else default)
 *     ├─ else if isAutoModeAvailable && isAutoModeGateEnabled() → auto → default
 *     └─ else → default
 */
export function getNextPermissionMode(
  toolPermissionContext: ToolPermissionContext,
  _teamContext?: { leadAgentId: string },
): PermissionMode {
  switch (toolPermissionContext.mode) {
    case 'default':
      return isModeBlockedByHeldToAuto('acceptEdits') ? 'plan' : 'acceptEdits'

    case 'acceptEdits':
      return 'plan'

    case 'plan':
      if (
        toolPermissionContext.isBypassPermissionsModeAvailable &&
        !isModeBlockedByHeldToAuto('bypassPermissions')
      ) {
        return 'bypassPermissions'
      }
      if (canCycleToAutoModeInCycle(toolPermissionContext)) {
        return 'auto'
      }
      return 'default'

    case 'bypassPermissions':
      if (canCycleToAutoModeInCycle(toolPermissionContext)) {
        return 'auto'
      }
      return 'default'

    case 'auto':
      return 'default'

    case 'dontAsk':
      // Not exposed in UI cycle yet, but return default if somehow reached
      return 'default'

    default:
      // Covers any future modes — always fall back to default
      return 'default'
  }
}

/**
 * Computes the next permission mode and prepares the context for it.
 * Handles any context cleanup needed for the target mode (e.g., stripping
 * dangerous permissions when entering auto mode).
 *
 * @returns The next mode and the context to use (with dangerous permissions stripped if needed)
 */
export function cyclePermissionMode(
  toolPermissionContext: ToolPermissionContext,
  teamContext?: { leadAgentId: string },
): { nextMode: PermissionMode; context: ToolPermissionContext } {
  const nextMode = getNextPermissionMode(toolPermissionContext, teamContext)
  return {
    nextMode,
    context: transitionPermissionMode(
      toolPermissionContext.mode,
      nextMode,
      toolPermissionContext,
    ),
  }
}
