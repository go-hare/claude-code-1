import * as React from 'react'
import { useAppState, useAppStateStore } from '../../state/AppState.js'
import {
  getActiveAgentForInput,
  getViewedTeammateTask,
} from '../../state/selectors.js'
import {
  AGENT_COLOR_TO_THEME_COLOR,
  AGENT_COLORS,
  type AgentColorName,
  getAgentColor,
} from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js'
import { getStandaloneAgentName } from '../../utils/standaloneAgent.js'
import { isInsideTmux } from '../../utils/swarm/backends/detection.js'
import {
  getCachedDetectionResult,
  getResolvedTeammateMode,
  isInProcessEnabled,
} from '../../utils/swarm/backends/registry.js'
import {
  getSwarmSocketName,
  TEAM_LEAD_NAME,
} from '../../utils/swarm/constants.js'
import {
  getAgentName,
  getTeammateColor,
  getTeamName,
  isTeammate,
} from '../../utils/teammate.js'
import { isInProcessTeammate } from '../../utils/teammateContext.js'
import type { Theme } from '../../utils/theme.js'

type SwarmBannerInfo = {
  text: string
  bgColor: keyof Theme
} | null

/**
 * Hook that returns banner information for swarm, standalone agent, or --agent CLI context.
 * - Leader with real teammates (excludes densable MQA lead-only seed), not in tmux /
 *   not in-process / not native panes: "tmux -L … a" or Windows Terminal tabs hint
 * - Leader (in tmux / in-process) viewing a teammate: `@name` with their color
 * - Teammate process: `@name` with assigned color (in-process teammates are headless)
 * - Viewing a background agent (CoordinatorTaskPanel): agent name with its color
 * - Standalone agent: name and/or /color background (no @team)
 * - --agent CLI flag: agent type with cyan/prompt border
 */
export function useSwarmBanner(): SwarmBannerInfo {
  const teamContext = useAppState(s => s.teamContext)
  const standaloneAgentContext = useAppState(s => s.standaloneAgentContext)
  const agent = useAppState(s => s.agent)
  // Subscribe so the banner updates on enter/exit teammate view even though
  // getActiveAgentForInput reads it from store.getState().
  useAppState(s => s.viewingAgentTaskId)
  const store = useAppStateStore()
  const [insideTmux, setInsideTmux] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    void isInsideTmux().then(setInsideTmux)
  }, [])

  const state = store.getState()

  // Teammate process: show @agentName with assigned color.
  // In-process teammates run headless — their banner shows in the leader UI instead.
  if (isTeammate() && !isInProcessTeammate()) {
    const agentName = getAgentName()
    if (agentName && getTeamName()) {
      return {
        text: `@${agentName}`,
        bgColor: toThemeColor(
          teamContext?.selfAgentColor ?? getTeammateColor(),
        ),
      }
    }
  }

  // Leader with spawned teammates: tmux-attach hint when external, else show
  // the viewed teammate's name when inside tmux / native panes / in-process.
  // densable MQA seeds teamContext with only team-lead — exclude it so the
  // attach hint matches TeamStatus / footer (real teammates only).
  const hasTeammates =
    !!teamContext?.teamName &&
    Object.values(teamContext.teammates ?? {}).some(
      t => t.name !== TEAM_LEAD_NAME,
    )
  if (hasTeammates) {
    const viewedTeammate = getViewedTeammateTask(state)
    const viewedColor = toThemeColor(viewedTeammate?.identity.color)
    const inProcessMode = isInProcessEnabled()
    const detection = getCachedDetectionResult()
    const nativePanes = detection?.isNative ?? false
    // detection cache may be empty before first spawn; resolve from session mode
    // so Windows auto does not flash the tmux attach string.
    const backendType = detection?.backend.type ?? getResolvedTeammateMode()

    if (insideTmux === false && !inProcessMode && !nativePanes) {
      const hint =
        backendType === 'windows-terminal'
          ? 'View teammates in the Windows Terminal tabs spawned for each teammate'
          : `View teammates: \`tmux -L ${getSwarmSocketName()} a\``
      return {
        text: hint,
        bgColor: viewedColor,
      }
    }
    if (
      (insideTmux === true || inProcessMode || nativePanes) &&
      viewedTeammate
    ) {
      return {
        text: `@${viewedTeammate.identity.agentName}`,
        bgColor: viewedColor,
      }
    }
    // insideTmux === null: still loading — fall through.
    // Not viewing a teammate: fall through so /rename and /color are honored.
  }

  // Viewing a background agent (CoordinatorTaskPanel): local_agent tasks aren't
  // InProcessTeammates, so getViewedTeammateTask misses them. Reverse-lookup the
  // name from agentNameRegistry the same way CoordinatorAgentStatus does.
  const active = getActiveAgentForInput(state)
  if (active.type === 'named_agent') {
    const task = active.task
    let name: string | undefined
    for (const [n, id] of state.agentNameRegistry) {
      if (id === task.id) {
        name = n
        break
      }
    }
    return {
      text: name ? `@${name}` : task.description,
      bgColor: getAgentColor(task.agentType) ?? 'cyan_FOR_SUBAGENTS_ONLY',
    }
  }

  // Standalone agent (/rename, /color): name and/or custom color, no @team.
  const standaloneName = getStandaloneAgentName(state)
  const standaloneColor = standaloneAgentContext?.color
  if (standaloneName || standaloneColor) {
    return {
      text: standaloneName ?? '',
      bgColor: toThemeColor(standaloneColor),
    }
  }

  // --agent CLI flag (when not handled above).
  if (agent) {
    const agentDef = state.agentDefinitions.activeAgents.find(
      a => a.agentType === agent,
    )
    return {
      text: agent,
      bgColor: toThemeColor(agentDef?.color, 'promptBorder'),
    }
  }

  return null
}

function toThemeColor(
  colorName: string | undefined,
  fallback: keyof Theme = 'cyan_FOR_SUBAGENTS_ONLY',
): keyof Theme {
  return colorName && AGENT_COLORS.includes(colorName as AgentColorName)
    ? AGENT_COLOR_TO_THEME_COLOR[colorName as AgentColorName]
    : fallback
}
