/**
 * densable `d` / `u` @197061177 — workflow usage-consent prompt + persist.
 */
import { feature } from 'bun:bundle'
import { WORKFLOW_TOOL_NAME } from '@claude-code/workflow-engine'
import { isBgSession } from '../concurrentSessions.js'
import { logForDebugging } from '../debug.js'
import { isUltracodeModeActive, resolveAppliedEffort } from '../effort.js'
import { logEvent } from '../../services/analytics/index.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { SettingSource } from '../settings/constants.js'
import { getToolPermissionContextFromLayers } from '../../engine/permissionLayerReaders.js'
import { getBootstrapSession } from '../sessionRoot.js'
import { isTeammate } from '../teammate.js'
import type { ToolUseContext } from '../../Tool.js'

const SKIP_SOURCES: SettingSource[] = [
  'userSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
]

/** densable `tKn`. */
export function settingsSkipWorkflowUsageWarning(): boolean {
  return SKIP_SOURCES.some(
    source => getSettingsForSource(source)?.skipWorkflowUsageWarning === true,
  )
}

/**
 * densable `d` / `workflowNeedsUsageConsentPrompt(toolName, context)`.
 * Gold `$d` is the Workflow tool name.
 */
export function workflowNeedsUsageConsentPrompt(
  toolName: string,
  context: ToolUseContext,
): boolean {
  if (toolName !== WORKFLOW_TOOL_NAME) return false
  if (context.options.isNonInteractiveSession) return false
  if (
    getToolPermissionContextFromLayers(context).shouldAvoidPermissionPrompts
  ) {
    return false
  }
  if (isBgSession()) return false
  if (isTeammate()) return false
  const appState = context.getAppState()
  // gold yx: ultracode && Qp(workflows) && Tw()==="xhigh". max-tier
  // ultracode (no xhigh on the model) still prompts.
  if (feature('WORKFLOW_SCRIPTS')) {
    if (
      isUltracodeModeActive(
        context.options.mainLoopModel,
        appState.effortValue,
        appState.ultracode,
      ) &&
      resolveAppliedEffort(
        context.options.mainLoopModel,
        appState.effortValue,
      ) === 'xhigh'
    ) {
      return false
    }
  }
  return (
    !getBootstrapSession().workflowUsageConsent.isGranted() &&
    !settingsSkipWorkflowUsageWarning()
  )
}

/** densable `u` / `recordWorkflowUsageConsent`. */
export async function recordWorkflowUsageConsent(): Promise<void> {
  getBootstrapSession().workflowUsageConsent.grant()
  if (settingsSkipWorkflowUsageWarning()) return
  const { error } = updateSettingsForSource('userSettings', {
    skipWorkflowUsageWarning: true,
  })
  if (error) {
    logForDebugging(
      `Failed to persist skipWorkflowUsageWarning: ${error.message}`,
      { level: 'error' },
    )
    return
  }
  logEvent('tengu_workflow_usage_warning_accepted', {})
}
