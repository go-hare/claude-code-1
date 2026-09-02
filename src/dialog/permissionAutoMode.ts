/**
 * densable m0n / FKe / xge / DPo("workflow") for Iiu / Cmy.
 *
 * offered = requestSource.type==="workflow-agent" && canOfferAutoMode
 * canOffer = (default|acceptEdits) && FKe
 * FKe = isAutoModeAvailable && isAutoModeGateEnabled
 * enable = xge("auto", ctx, apply, trigger). Default trigger is
 * "workflow_permission_prompt" (gold m0n XaN). qLe logs
 * permission_mode_changed. Fail → Fyr toast; still allow.
 */
import type { ToolPermissionContext } from '../Tool.js'
import { useNotifications } from '../context/notifications.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import type { AppState } from '../state/AppStateStore.js'
import {
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isAutoModeGateEnabled,
  setPermissionModeWithGuards,
} from '../utils/permissions/permissionSetup.js'
import {
  mintWorkflowAutoModeRow,
  WORKFLOW_AUTO_MODE_LABEL,
} from './consentRow.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'

/** densable kOo */
export const WORKFLOW_AUTO_MODE_DESCRIPTION = '· workflows run best with it on'

/** densable m0n default XaN — xge 4th arg / qLe trigger */
export const WORKFLOW_PERMISSION_PROMPT_TRIGGER = 'workflow_permission_prompt'

export { WORKFLOW_AUTO_MODE_LABEL }

export type AutoModeOfferContext = {
  mode: string
  isAutoModeAvailable?: boolean
}

/** densable FKe */
export function canCycleToAutoMode(ctx: AutoModeOfferContext): boolean {
  return !!ctx.isAutoModeAvailable && isAutoModeGateEnabled()
}

/** densable m0n.canOfferAutoMode */
export function canOfferWorkflowAutoMode(ctx: AutoModeOfferContext): boolean {
  return (
    (ctx.mode === 'default' || ctx.mode === 'acceptEdits') &&
    canCycleToAutoMode(ctx)
  )
}

/** densable m0n.offered */
export function isWorkflowAutoModeOffered(
  requestSource: PermissionRequestSource | undefined,
  ctx: AutoModeOfferContext,
): boolean {
  return (
    requestSource?.type === 'workflow-agent' && canOfferWorkflowAutoMode(ctx)
  )
}

/** densable Fyr */
export function workflowAutoModeUnavailableText(): string {
  const reason = getAutoModeUnavailableReason()
  return reason !== null
    ? getAutoModeUnavailableNotification(reason)
    : 'auto mode is unavailable right now'
}

/** densable xge("auto", …, XaN) — Host AppState apply. */
export function enableWorkflowAutoMode(
  ctx: ToolPermissionContext,
  setAppState: (updater: (prev: AppState) => AppState) => void,
  trigger: string = WORKFLOW_PERMISSION_PROMPT_TRIGGER,
): boolean {
  const result = setPermissionModeWithGuards(
    'auto',
    ctx,
    updater => {
      setAppState(prev => {
        const next = updater(prev.toolPermissionContext)
        if (next === prev.toolPermissionContext) return prev
        return { ...prev, toolPermissionContext: next }
      })
    },
    trigger,
  )
  return result.ok
}

export function shouldShowWorkflowAutoModeOption(
  offered: boolean,
  withheld: boolean,
  vetoed: boolean,
): boolean {
  return offered && !withheld && !vetoed
}

/** Iiu/Cmy Host hook — gold m0n(requestSource). */
export function useWorkflowAutoModeOffer(
  requestSource: PermissionRequestSource | undefined,
): {
  offered: boolean
  enableAutoMode: (trigger?: string) => boolean
} {
  const ctx = useAppState(s => s.toolPermissionContext)
  const setAppState = useSetAppState()
  const { addNotification } = useNotifications()
  const offered = isWorkflowAutoModeOffered(requestSource, ctx)
  return {
    offered,
    enableAutoMode: (trigger?: string) => {
      if (enableWorkflowAutoMode(ctx, setAppState, trigger)) {
        return true
      }
      addNotification({
        key: 'workflow-auto-mode-unavailable',
        kind: 'warning',
        text: workflowAutoModeUnavailableText(),
        color: 'warning',
        priority: 'high',
      })
      return false
    },
  }
}

export function workflowAutoModeSelectOption(): {
  label: string
  description: string
  value: 'yes-enable-auto-mode'
} {
  const row = mintWorkflowAutoModeRow()
  return {
    label: typeof row.node === 'string' ? row.node : WORKFLOW_AUTO_MODE_LABEL,
    description: WORKFLOW_AUTO_MODE_DESCRIPTION,
    value: 'yes-enable-auto-mode',
  }
}
