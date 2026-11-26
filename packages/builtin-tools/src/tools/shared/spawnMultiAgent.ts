/**
 * Shared spawn module for teammate creation.
 * Extracted from TeammateTool to allow reuse by AgentTool.
 */

import { getOriginalCwd, getSessionId } from 'src/bootstrap/state.js'
import { it2SetupSpec } from 'src/dialog/specs/jsuKinds.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { ToolUseContext } from 'src/Tool.js'
import { formatAgentId } from 'src/utils/agentId.js'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import type { EffortValue } from 'src/utils/effort.js'
import { errorMessage } from 'src/utils/errors.js'
import { getTeammateExecutor } from 'src/utils/swarm/backends/registry.js'
import type {
  TeammateExecutor,
  TeammateSpawnResult,
} from 'src/utils/swarm/backends/types.js'
import {
  isReservedSpawnAgentName,
  MAIN_RECIPIENT_NAME,
  SWARM_SESSION_NAME,
  TEAM_LEAD_NAME,
} from 'src/utils/swarm/constants.js'
import {
  getTeamFilePath,
  hasControlChars,
  readTeamFileAsync,
  recordSpawnedTeammatePane,
  removeTeamMember,
  sanitizeAgentName,
  type TeamFile,
  updateTeamFile,
} from 'src/utils/swarm/teamHelpers.js'
import { assignTeammateColor } from 'src/utils/swarm/teammateLayoutManager.js'
import { resolveTeammateModel } from 'src/utils/swarm/teammateModel.js'
import {
  clearPendingShutdownRequestsForAddressee,
  clearTeamLeadEntryKeyForInbox,
  getInboxPath,
} from 'src/utils/teammateMailbox.js'
import type { CustomAgentDefinition } from '../AgentTool/loadAgentsDir.js'
import { isCustomAgent } from '../AgentTool/loadAgentsDir.js'

// Re-export for callers/tests that historically imported from this module.
export { resolveTeammateModel }

// ============================================================================
// Types
// ============================================================================

export type SpawnOutput = {
  teammate_id: string
  agent_id: string
  agent_type?: string
  model?: string
  name: string
  color?: string
  tmux_session_name: string
  tmux_window_name: string
  tmux_pane_id: string
  team_name?: string
  is_splitpane?: boolean
  plan_mode_required?: boolean
  /** Official 2.1.331: set when a pane teammate started in originalCwd !== current shell cwd. */
  started_away_from_shell?: boolean
  /** Official 2.1.331: output log file for in-process teammates. */
  outputFile?: string
}

export type SpawnTeammateConfig = {
  name: string
  prompt: string
  team_name?: string
  cwd?: string
  use_splitpane?: boolean
  plan_mode_required?: boolean
  model?: string
  modelSource?: 'tool' | 'frontmatter'
  effort?: EffortValue
  agent_type?: string
  description?: string
  /** request_id of the API call whose response contained the tool_use that
   *  spawned this teammate. Threaded through to TeammateAgentContext for
   *  lineage tracing on tengu_api_* events. */
  invokingRequestId?: string
}

// Internal input type matching TeammateTool's spawn parameters
type SpawnInput = {
  name: string
  prompt: string
  team_name?: string
  cwd?: string
  use_splitpane?: boolean
  plan_mode_required?: boolean
  model?: string
  modelSource?: 'tool' | 'frontmatter'
  effort?: EffortValue
  agent_type?: string
  description?: string
  invokingRequestId?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function computeUniqueTeammateNameFromMembers(
  baseName: string,
  members?: TeamFile['members'],
): string {
  if (hasControlChars(baseName)) {
    throw new Error(
      'Invalid name: control characters are not allowed in agent or team names',
    )
  }
  // densable YZi then D6/M2 gate — always, even without a team file.
  const sanitized = sanitizeAgentName(baseName)
  if (sanitized === MAIN_RECIPIENT_NAME) {
    throw new Error(
      `"${MAIN_RECIPIENT_NAME}" is a reserved recipient name (SendMessage routes it to the main conversation) — choose another teammate name.`,
    )
  }
  if (isReservedSpawnAgentName(sanitized)) {
    throw new Error(
      'That teammate name is a reserved name ("main", "team-lead", "user" or "system", in any spelling) or has the shape of an agent id or a session id, which already addresses a recipient directly — choose another teammate name.',
    )
  }

  if (!members) {
    return sanitized
  }

  const existingNames = new Set(members.map(m => m.name.toLowerCase()))

  // If the base name doesn't exist, use it as-is
  if (!existingNames.has(sanitized.toLowerCase())) {
    return sanitized
  }

  // Find the next available suffix
  let suffix = 2
  while (existingNames.has(`${sanitized}-${suffix}`.toLowerCase())) {
    suffix++
  }

  return `${sanitized}-${suffix}`
}

/**
 * densable pzg — sanitize (@→-), refuse reserved names, then uniquify against
 * team members with numeric suffixes (tester-2, tester-3).
 * @internal Exported for testing
 */
export async function generateUniqueTeammateName(
  baseName: string,
  teamName: string | undefined,
): Promise<string> {
  if (!teamName) {
    return computeUniqueTeammateNameFromMembers(baseName)
  }

  const teamFile = await readTeamFileAsync(teamName)
  return computeUniqueTeammateNameFromMembers(baseName, teamFile?.members)
}

// ============================================================================
// Spawn Handler
// ============================================================================

type ReservedSpawn = {
  teamName: string
  leadAgentId: string
  leadMember?: TeamFile['members'][number]
  sanitizedName: string
  teammateId: string
  model: string
  teammateColor: ReturnType<typeof assignTeammateColor>
  workingDir: string
  agentDefinition?: CustomAgentDefinition
}

function getBackendDisplay(result: TeammateSpawnResult): {
  sessionName: string
  windowName: string
  paneId: string
  isSplitPane: boolean
} {
  if (result.backendType === 'in-process') {
    return {
      sessionName: 'in-process',
      windowName: 'in-process',
      paneId: 'in-process',
      isSplitPane: false,
    }
  }

  return {
    sessionName: result.insideTmux ? 'current' : SWARM_SESSION_NAME,
    windowName:
      result.windowName ?? (result.insideTmux ? 'current' : 'swarm-view'),
    paneId: result.paneId ?? '',
    isSplitPane: result.isSplitPane ?? true,
  }
}

function updateTeamContext(
  context: ToolUseContext,
  spawn: ReservedSpawn,
  result: TeammateSpawnResult,
): void {
  const display = getBackendDisplay(result)

  context.setAppState(prev => {
    const leadAgentId = prev.teamContext?.leadAgentId || spawn.leadAgentId
    const existingTeammates = prev.teamContext?.teammates || {}
    const needsLeaderEntry = !(leadAgentId in existingTeammates)
    const leadMember = spawn.leadMember

    return {
      ...prev,
      teamContext: {
        ...prev.teamContext,
        teamName: spawn.teamName,
        teamFilePath:
          prev.teamContext?.teamFilePath || getTeamFilePath(spawn.teamName),
        leadAgentId,
        teammates: {
          ...existingTeammates,
          ...(needsLeaderEntry
            ? {
                [leadAgentId]: {
                  name: TEAM_LEAD_NAME,
                  agentType: leadMember?.agentType ?? TEAM_LEAD_NAME,
                  color: assignTeammateColor(leadAgentId),
                  tmuxSessionName:
                    leadMember?.backendType === 'in-process'
                      ? 'in-process'
                      : '',
                  tmuxPaneId: leadMember?.tmuxPaneId ?? '',
                  cwd: leadMember?.cwd ?? getCwd(),
                  spawnedAt: leadMember?.joinedAt ?? Date.now(),
                },
              }
            : {}),
          [spawn.teammateId]: {
            name: spawn.sanitizedName,
            agentType: spawn.agentDefinition?.agentType,
            color: spawn.teammateColor,
            tmuxSessionName: display.sessionName,
            tmuxPaneId: display.paneId,
            cwd: spawn.workingDir,
            spawnedAt: Date.now(),
          },
        },
      },
    }
  })
}

function isSpawnedTeammateTask(task: unknown, agentId: string): boolean {
  if (!task || typeof task !== 'object') return false
  const identity = (task as { identity?: { agentId?: unknown } }).identity
  return identity?.agentId === agentId
}

function removeSpawnedTeammateFromAppState(
  context: ToolUseContext,
  spawn: ReservedSpawn,
  result?: TeammateSpawnResult,
): void {
  context.setAppState(prev => {
    const tasks = Object.fromEntries(
      Object.entries(prev.tasks).filter(([taskId, task]) => {
        if (result?.taskId && taskId === result.taskId) return false
        return !isSpawnedTeammateTask(task, spawn.teammateId)
      }),
    ) as typeof prev.tasks

    if (!prev.teamContext?.teammates?.[spawn.teammateId]) {
      return {
        ...prev,
        tasks,
      }
    }

    const { [spawn.teammateId]: _removed, ...teammates } =
      prev.teamContext.teammates

    return {
      ...prev,
      tasks,
      teamContext: {
        ...prev.teamContext,
        teammates,
      },
    }
  })
}

async function cleanupSpawnAfterFailure(
  context: ToolUseContext,
  spawn: ReservedSpawn,
  executor: TeammateExecutor,
  result?: TeammateSpawnResult,
): Promise<void> {
  if (result?.success) {
    try {
      const killed = await executor.kill(spawn.teammateId)
      if (!killed) {
        await executor.terminate(
          spawn.teammateId,
          'Teammate spawn failed before registration completed',
        )
      }
    } catch (error) {
      logForDebugging(
        `[spawnTeammate] Failed to clean up spawned teammate ${spawn.teammateId}: ${errorMessage(error)}`,
      )
    }
  }

  clearTeamLeadEntryKeyForInbox(
    getInboxPath(spawn.sanitizedName, spawn.teamName),
  )
  await removeTeamMember(spawn.teamName, spawn.teammateId)
  try {
    removeSpawnedTeammateFromAppState(context, spawn, result)
  } catch (error) {
    logForDebugging(
      `[spawnTeammate] Failed to roll back AppState for ${spawn.teammateId}: ${errorMessage(error)}`,
    )
  }
}

async function handleSpawn(
  input: SpawnInput,
  context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  if (!input.name || !input.prompt) {
    throw new Error('name and prompt are required for spawn operation')
  }

  const appState = context.getAppState()
  // densable HSw: team name comes only from the implicit session team.
  const teamName = appState.teamContext?.teamName
  if (!teamName) {
    logEvent('subagent_teammate_no_team_name', {})
    throw new Error(
      'Internal error: session team not initialized. This should have happened at startup when agent swarms are enabled.',
    )
  }

  for (const [label, value] of [
    ['name', input.name],
    ['team_name', teamName],
  ] as const) {
    if (hasControlChars(value)) {
      throw new Error(
        label === 'name'
          ? 'Invalid name: control characters are not allowed in agent or team names'
          : 'Invalid team_name: control characters are not allowed in agent or team names',
      )
    }
  }

  const model = resolveTeammateModel(
    input.model,
    appState.mainLoopModel,
    input.modelSource,
  )

  let agentDefinition: CustomAgentDefinition | undefined
  if (input.agent_type) {
    const foundAgent = context.options.agentDefinitions.activeAgents.find(
      a => a.agentType === input.agent_type,
    )
    if (foundAgent && isCustomAgent(foundAgent)) {
      agentDefinition = foundAgent
    }
    logForDebugging(
      `[spawnTeammate] agent_type=${input.agent_type}, found=${!!agentDefinition}`,
    )
  }

  const executor = await getTeammateExecutor(true, {
    onNeedsIt2Setup: context.requestDialog
      ? async tmuxAvailable =>
          (await context.requestDialog!(it2SetupSpec, {
            tmuxAvailable,
          })) as 'installed' | 'use-tmux' | 'cancelled'
      : undefined,
  })
  executor.setContext?.(context)
  // Official 2.1.331 `re()` vs `j()`: pane teammates start in the session's
  // original folder (`getOriginalCwd()`), while in-process teammates use `getCwd()`.
  const workingDir =
    input.cwd || (executor.type === 'in-process' ? getCwd() : getOriginalCwd())

  // Official 2.1.331 `G()` — atomically uniquify the teammate name and reserve
  // the member entry in config.json under proper-lockfile BEFORE spawning.
  const reserved = await updateTeamFile(teamName, teamFile => {
    const sanitizedName = computeUniqueTeammateNameFromMembers(
      input.name,
      teamFile.members,
    )
    const teammateId = formatAgentId(sanitizedName, teamName)
    const teammateColor = assignTeammateColor(teammateId)
    teamFile.members.push({
      agentId: teammateId,
      name: sanitizedName,
      agentType: input.agent_type,
      model,
      prompt: input.prompt,
      color: teammateColor,
      planModeRequired: input.plan_mode_required,
      joinedAt: Date.now(),
      tmuxPaneId: executor.type === 'in-process' ? 'in-process' : '',
      cwd: workingDir,
      subscriptions: [],
      backendType: executor.type,
    })
    const leadMember = teamFile.members.find(m => m.name === TEAM_LEAD_NAME)
    return {
      teamName,
      leadAgentId: teamFile.leadAgentId,
      leadMember,
      sanitizedName,
      teammateId,
      model,
      teammateColor,
      workingDir,
      agentDefinition,
    } satisfies ReservedSpawn
  })

  if (!reserved) {
    throw new Error(
      `Internal error: team file for "${teamName}" not found. The session team should have been initialized at startup.`,
    )
  }

  clearPendingShutdownRequestsForAddressee(reserved.sanitizedName)
  if (executor.type === 'in-process') {
    clearTeamLeadEntryKeyForInbox(
      getInboxPath(reserved.sanitizedName, reserved.teamName),
    )
  }

  let result: TeammateSpawnResult | undefined
  try {
    result = await executor.spawn({
      name: reserved.sanitizedName,
      teamName: reserved.teamName,
      color: reserved.teammateColor,
      prompt: input.prompt,
      cwd: reserved.workingDir,
      model: reserved.model,
      effort: input.effort,
      agentType: input.agent_type,
      agentDefinition: reserved.agentDefinition,
      description: input.description,
      planModeRequired: input.plan_mode_required ?? false,
      parentSessionId: getSessionId(),
      invokingRequestId: input.invokingRequestId,
      useSplitPane: input.use_splitpane !== false,
    })

    if (!result.success) {
      throw new Error(result.error ?? 'Failed to spawn teammate')
    }

    const display = getBackendDisplay(result)
    const finalBackendType = result.backendType ?? executor.type
    if (display.paneId && finalBackendType !== 'in-process') {
      recordSpawnedTeammatePane(finalBackendType, display.paneId)
    }

    // Update reserved member entry with concrete paneId / backendType under lock
    if (
      display.paneId !== (executor.type === 'in-process' ? 'in-process' : '') ||
      finalBackendType !== executor.type
    ) {
      await updateTeamFile(reserved.teamName, teamFile => {
        const member = teamFile.members.find(
          m => m.agentId === reserved.teammateId,
        )
        if (!member) return false
        member.tmuxPaneId = display.paneId
        member.backendType = finalBackendType
        return true
      })
    }

    updateTeamContext(context, reserved, result)

    const startedAwayFromShell =
      display.isSplitPane && reserved.workingDir !== getCwd() ? true : undefined

    return {
      data: {
        teammate_id: reserved.teammateId,
        agent_id: reserved.teammateId,
        agent_type: input.agent_type,
        model: reserved.model,
        name: reserved.sanitizedName,
        color: reserved.teammateColor,
        tmux_session_name: display.sessionName,
        tmux_window_name: display.windowName,
        tmux_pane_id: display.paneId,
        team_name: reserved.teamName,
        is_splitpane: display.isSplitPane,
        plan_mode_required: input.plan_mode_required,
        ...(startedAwayFromShell ? { started_away_from_shell: true } : {}),
        ...(result.outputFile ? { outputFile: result.outputFile } : {}),
      },
    }
  } catch (error) {
    await cleanupSpawnAfterFailure(context, reserved, executor, result)
    throw error
  }
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Spawns a new teammate with the given configuration.
 * This is the main entry point for teammate spawning, used by both TeammateTool and AgentTool.
 */
export async function spawnTeammate(
  config: SpawnTeammateConfig,
  context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  return handleSpawn(config, context)
}
