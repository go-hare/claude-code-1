/**
 * densable 2.1.289 `sharesCwd` stamp (`ALo` / `TRe` / `Stn` / `Pqe` / `rn`).
 *
 * Semantic names only — never export minify `ALo|TRe|Stn|Pqe|rn|vLo|CLo|wO`.
 *
 * Gold: `rn = ALo(...) && TRe()` then both `async_launched` returns
 * `...rn && {sharesCwd:!0}`. `ALo` is gated by GB `tengu_twinkling_boole`
 * default **false**.
 */
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { TaskState } from 'src/tasks/types.js'
import { getCwd } from './cwd.js'
import { pathsEqual } from './file.js'
import { findGitRoot } from './git.js'
import { hasWorktreeCreateHook } from './hooks.js'
import { isEvalConfined } from './permissions/evalConfined.js'
import { isDisklessLaunch } from './sessionHost.js'

export const TWINKLING_BOOLE_GATE = 'tengu_twinkling_boole'

/** densable `vLo` — model-facing async_launched note (mapToolResult). */
export const SHARES_CWD_LAUNCH_NOTE =
  'Note: another write-capable agent is already running in this same working directory, and parallel agents sharing a checkout can overwrite each other\'s work. For parallel code-writing agents, dispatch each with isolation: "worktree".'

/** densable `k$e` — Edit / Write / NotebookEdit. */
const WRITE_CAPABLE_TOOL_NAMES = [
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
] as const

export type WriteCapableAgentDefinition = {
  /** Gold `Zne`: `undefined`/`null`/`'*'` (or list containing `*`) = wildcard. */
  tools?: string[] | null | '*'
  disallowedTools?: string[]
}

/** densable `Pqe` — GB `tengu_twinkling_boole`, default false. */
export function isSharesCwdSiblingGateOn(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(TWINKLING_BOOLE_GATE, false)
}

/**
 * densable `Stn` (+ gold `Zne` wildcard): write-capable when Edit/Write/
 * NotebookEdit are allowed. Wildcard when `tools` is undefined/null/`'*'`/
 * includes `'*'`.
 */
export function isWriteCapableAgentDefinition(
  agent: WriteCapableAgentDefinition | undefined,
): boolean {
  if (!agent) return false
  const tools = agent.tools
  const wildcard =
    tools == null ||
    tools === '*' ||
    (Array.isArray(tools) && tools.includes('*'))
  for (const name of WRITE_CAPABLE_TOOL_NAMES) {
    if (
      (wildcard || (Array.isArray(tools) && tools.includes(name))) &&
      !agent.disallowedTools?.includes(name)
    ) {
      return true
    }
  }
  return false
}

/**
 * densable `TRe` — not eval-confined, not diskless, and either a
 * WorktreeCreate hook or a git root at cwd.
 */
export function canStampSharesCwdNote(cwd: string = getCwd()): boolean {
  if (isEvalConfined()) return false
  if (isDisklessLaunch()) return false
  return hasWorktreeCreateHook() || findGitRoot(cwd) !== null
}

export type SameCwdWriteCapableSiblingInput = {
  tasks: Record<string, TaskState | undefined> | undefined
  selectedAgent: WriteCapableAgentDefinition
  /** Resolved isolation after resolveEffectiveIsolation; undefined = unisolated. */
  effectiveIsolation: string | undefined
  /** Explicit cwd / worktree override for this spawn. */
  cwd: string | undefined
  parentCwd: string | null
  parentAgentId: string | undefined
  /** Test inject for densable `Pqe`; omit → live GB gate. */
  siblingGateOn?: boolean
  /** Alias of siblingGateOn (tests / earlier API). */
  twinklingBoole?: boolean
}

/**
 * densable `ALo` — another running, non-observer, write-capable local_agent
 * already shares this checkout (unisolated spawn). Adapted to
 * `Object.values(appState.tasks)` (not `taskRegistry.all()`).
 */
export function hasSameCwdWriteCapableSibling({
  tasks,
  selectedAgent,
  effectiveIsolation,
  cwd,
  parentCwd,
  parentAgentId,
  siblingGateOn,
  twinklingBoole,
}: SameCwdWriteCapableSiblingInput): boolean {
  const gate = siblingGateOn ?? twinklingBoole ?? isSharesCwdSiblingGateOn()
  if (parentCwd === null || !gate) return false
  if (
    effectiveIsolation !== undefined ||
    !isWriteCapableAgentDefinition(selectedAgent)
  ) {
    return false
  }
  if (cwd !== undefined && !pathsEqual(cwd, parentCwd)) return false
  if (!tasks) return false
  for (const task of Object.values(tasks)) {
    if (!task || task.type !== 'local_agent') continue
    if (task.status !== 'running') continue
    if (task.isObserver === true) continue
    if (parentAgentId !== undefined && task.agentId === parentAgentId) continue
    if (task.cwd !== undefined && !pathsEqual(task.cwd, parentCwd)) continue
    if (
      task.selectedAgent !== undefined &&
      isWriteCapableAgentDefinition(task.selectedAgent)
    ) {
      return true
    }
  }
  return false
}

/** densable `rn = ALo(...) && TRe()` — stamp `sharesCwd: true` when both. */
export function resolveSharesCwdStamp(
  input: SameCwdWriteCapableSiblingInput,
): boolean {
  return (
    hasSameCwdWriteCapableSibling(input) &&
    canStampSharesCwdNote(input.parentCwd ?? getCwd())
  )
}

/** Aliases used by AgentTool / tests (same BODY). */
export const isWriteCapableAgent = isWriteCapableAgentDefinition
export const isSharingWriteCapableCwd = hasSameCwdWriteCapableSibling
export const shouldStampSharesCwd = resolveSharesCwdStamp
export const canMakeWorktreeHere = canStampSharesCwdNote
