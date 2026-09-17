/**
 * densable mcpSessionWiring.approvedServers / approveServers (`gS` / `fS`).
 * Session-only list of project MCP names the user just approved, keyed by
 * workspace. Official dialogs call `h(C(), names)` before `onDone`.
 *
 * Rejected names are the local twin: persistFailed "don't use" leaves disk
 * status pending, but plugin MCP still starts unless this session list
 * gates getClaudeCodeMcpConfigs.
 */

export type SessionApprovedMcpServer = {
  name: string
  workspaceKey: string
}

export type SessionRejectedMcpServer = SessionApprovedMcpServer

const approved: SessionApprovedMcpServer[] = []
const rejected: SessionRejectedMcpServer[] = []

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
  return approved
}

export function getSessionRejectedMcpServers(): SessionRejectedMcpServer[] {
  return rejected
}

export function approveSessionMcpServers(
  workspaceKey: string,
  names: string[],
): void {
  pushUnique(approved, workspaceKey, names)
}

export function rejectSessionMcpServers(
  workspaceKey: string,
  names: string[],
): void {
  pushUnique(rejected, workspaceKey, names)
}

export function isSessionRejectedMcpServer(
  workspaceKey: string,
  name: string,
): boolean {
  return hasChoice(rejected, workspaceKey, name)
}

export function resetSessionApprovedMcpServersForTests(): void {
  approved.length = 0
  rejected.length = 0
}
