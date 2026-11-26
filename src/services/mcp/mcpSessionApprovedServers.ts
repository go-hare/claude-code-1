/**
 * densable mcpSessionWiring.approvedServers / approveServers (`gS` / `fS`).
 * Session-only list of project MCP names the user just approved, keyed by
 * workspace. Official dialogs call `h(C(), names)` before `onDone`.
 *
 * Rejected names are the local twin: persistFailed "don't use" leaves disk
 * status pending, but plugin MCP still starts unless this session list
 * gates getClaudeCodeMcpConfigs.
 */

import {
  RootSessionSlot,
  getBootstrapSession,
} from '../../utils/sessionRoot.js'

export type SessionApprovedMcpServer = {
  name: string
  workspaceKey: string
}

export type SessionRejectedMcpServer = SessionApprovedMcpServer

type SessionMcpServerApprovalState = {
  approved: SessionApprovedMcpServer[]
  rejected: SessionRejectedMcpServer[]
}

const sessionMcpServerApprovalSlot =
  new RootSessionSlot<SessionMcpServerApprovalState>(() => ({
    approved: [],
    rejected: [],
  }))

function getSessionMcpServerApprovalState(): SessionMcpServerApprovalState {
  return sessionMcpServerApprovalSlot.of(getBootstrapSession())
}

function hasChoice(
  rows: readonly SessionApprovedMcpServer[],
  workspaceKey: string,
  name: string,
): boolean {
  return rows.some(
    row => row.name === name && row.workspaceKey === workspaceKey,
  )
}

function pushUnique(
  rows: SessionApprovedMcpServer[],
  workspaceKey: string,
  names: string[],
): void {
  for (const name of names) {
    if (!hasChoice(rows, workspaceKey, name)) {
      rows.push({ name, workspaceKey })
    }
  }
}

export function getSessionApprovedMcpServers(): SessionApprovedMcpServer[] {
  return getSessionMcpServerApprovalState().approved
}

export function getSessionRejectedMcpServers(): SessionRejectedMcpServer[] {
  return getSessionMcpServerApprovalState().rejected
}

export function approveSessionMcpServers(
  workspaceKey: string,
  names: string[],
): void {
  pushUnique(getSessionMcpServerApprovalState().approved, workspaceKey, names)
}

export function rejectSessionMcpServers(
  workspaceKey: string,
  names: string[],
): void {
  pushUnique(getSessionMcpServerApprovalState().rejected, workspaceKey, names)
}

export function isSessionRejectedMcpServer(
  workspaceKey: string,
  name: string,
): boolean {
  const state = sessionMcpServerApprovalSlot.peek(getBootstrapSession())
  return state ? hasChoice(state.rejected, workspaceKey, name) : false
}

export function resetSessionApprovedMcpServersForTests(): void {
  const state = sessionMcpServerApprovalSlot.peek(getBootstrapSession())
  if (state) {
    state.approved.length = 0
    state.rejected.length = 0
  }
}
