/**
 * In-Process Teammate Helpers
 *
 * Helper functions for in-process teammate integration.
 * Provides utilities to:
 * - Find task ID by agent name
 * - Handle plan approval responses (densable mFu)
 * - Format plan approval text for the model (densable Ejr)
 * - Update awaitingPlanApproval state
 * - Detect permission-related messages
 */

import type { AppState } from '../state/AppState.js'
import {
  type InProcessTeammateTaskState,
  isInProcessTeammateTask,
} from '../tasks/InProcessTeammateTask/types.js'
import type { PermissionMode } from '../types/permissions.js'
import { logForDebugging } from './debug.js'
import { sanitizeInheritedPermissionMode } from './permissions/permissionSetup.js'
import { updateTaskState } from './task/framework.js'
import {
  isPermissionResponse,
  isSandboxPermissionResponse,
  type PlanApprovalResponseMessage,
} from './teammateMailbox.js'
import { setMemberMode } from './swarm/teamHelpers.js'

type SetAppState = (updater: (prev: AppState) => AppState) => void

/**
 * Find the task ID for an in-process teammate by agent name.
 *
 * @param agentName - The agent name (e.g., "researcher")
 * @param appState - Current AppState
 * @returns Task ID if found, undefined otherwise
 */
export function findInProcessTeammateTaskId(
  agentName: string,
  appState: AppState,
): string | undefined {
  for (const task of Object.values(appState.tasks)) {
    if (
      isInProcessTeammateTask(task) &&
      task.identity.agentName === agentName
    ) {
      return task.id
    }
  }
  return undefined
}

/**
 * Set awaitingPlanApproval state for an in-process teammate.
 *
 * @param taskId - Task ID of the in-process teammate
 * @param setAppState - AppState setter
 * @param awaiting - Whether teammate is awaiting plan approval
 */
export function setAwaitingPlanApproval(
  taskId: string,
  setAppState: SetAppState,
  awaiting: boolean,
): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => ({
    ...task,
    awaitingPlanApproval: awaiting,
  }))
}

/**
 * densable Ejr — plain-text plan approval outcome for the model.
 * No request_id suffix (mailbox path; local SendMessage path may add one).
 */
export function formatPlanApprovalForModel(
  response: Pick<PlanApprovalResponseMessage, 'approved' | 'feedback'>,
): string {
  if (response.approved) {
    return response.feedback
      ? `[Plan Approved] ${response.feedback}`
      : '[Plan Approved] You can now proceed with implementation'
  }
  return `[Plan Rejected] ${response.feedback || 'Please revise your plan'}`
}

/**
 * densable mFu — apply lead plan_approval_response to an in-process teammate.
 *
 * Only acts when the task is still awaitingPlanApproval (stale replies ignored).
 * On approve: clear awaiting, set task.permissionMode via Urs sanitize, persist
 * member mode. On reject: clear awaiting only.
 *
 * @returns true if the response was applied (caller should inject Ejr text)
 */
export function applyPlanApprovalToInProcessTeammate(
  taskId: string,
  response: PlanApprovalResponseMessage,
  setAppState: SetAppState,
): boolean {
  let applied = false
  let appliedMode: PermissionMode | undefined
  let teamName: string | undefined
  let agentName: string | undefined

  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, prev => {
    // densable mFu: only apply while still awaiting (stale replies ignored)
    if (!prev.awaitingPlanApproval) {
      return prev
    }
    applied = true
    if (!response.approved) {
      return { ...prev, awaitingPlanApproval: false }
    }
    const mode = sanitizeInheritedPermissionMode(response.permissionMode)
    appliedMode = mode
    teamName = prev.identity.teamName
    agentName = prev.identity.agentName
    return {
      ...prev,
      awaitingPlanApproval: false,
      permissionMode: mode,
    }
  })

  if (!applied) {
    return false
  }

  if (response.approved && appliedMode && teamName && agentName) {
    setMemberMode(teamName, agentName, appliedMode)
  }

  logForDebugging(
    `[inProcessTeammate] applied plan_approval_response task=${taskId} approved=${response.approved}${
      appliedMode ? ` mode=${appliedMode}` : ''
    }`,
  )
  return true
}

/**
 * @deprecated densable leader auto-approve does NOT clear awaitingPlanApproval
 * on the teammate task — that is mFu's job when the teammate drains the
 * mailbox. Prefer applyPlanApprovalToInProcessTeammate from the runner.
 *
 * Kept for call sites that only need to clear the UI flag without mode apply
 * (should not be used from leader InboxPoller).
 */
export function handlePlanApprovalResponse(
  taskId: string,
  response: PlanApprovalResponseMessage,
  setAppState: SetAppState,
): void {
  applyPlanApprovalToInProcessTeammate(taskId, response, setAppState)
}

// ============ Permission Delegation Helpers ============

/**
 * Check if a message is a permission-related response.
 * Used by in-process teammate message handlers to detect and process
 * permission responses from the team leader.
 *
 * Handles both tool permissions and sandbox (network host) permissions.
 *
 * @param messageText - The raw message text to check
 * @returns true if the message is a permission response
 */
export function isPermissionRelatedResponse(messageText: string): boolean {
  return (
    !!isPermissionResponse(messageText) ||
    !!isSandboxPermissionResponse(messageText)
  )
}
