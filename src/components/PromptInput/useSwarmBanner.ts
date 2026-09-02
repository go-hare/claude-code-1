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
  isInProcessEnabled,
} from '../../utils/swarm/backends/registry.js'
import { getSwarmSocketName } from '../../utils/swarm/constants.js'
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
  /** densable zRr `gradient:c` — raw prideGradient when `tZg` is undefined. */
  gradient?: string[]
} | null

type UseSwarmBannerOptions = {
  /** densable FSh/kPE: hide standalone /color chip when Tasks V2 list is visible. */
  hideSessionTitle?: boolean
}

/**
 * densable kPE + FSh: `bu(Crs(), e => e !== void 0 && e.length > 0) ?? false`.
 * Hidden/disabled snapshot is `undefined` → do not hide the title chip.
 */
export function hideSessionTitleFromTasks(
  tasks: readonly unknown[] | undefined,
): boolean {
  return tasks !== undefined && tasks.length > 0
}

/**
 * densable $Ir fill: `max(0, columns - chip - trailing)`.
 * Chip is padded text (`stringWidth+2`); trailing is one `─` when a chip exists.
 */
export function swarmBannerFillColumns(
  columns: number,
  textWidth: number,
): number {
  const chip = textWidth > 0 ? textWidth + 2 : 0
  const trailing = chip > 0 ? 1 : 0
  return Math.max(0, columns - chip - trailing)
}

/**
 * densable Biy — split fill dashes across gradient colors.
 * `min(colors.length, count)` buckets; remainder goes to the first colors.
 */
export function swarmBannerGradientSegments(
  count: number,
  colors: readonly string[],
): Array<{ color: string; dashes: number }> {
  if (count <= 0 || colors.length === 0) return []
  const used = Math.min(colors.length, count)
  const base = Math.floor(count / used)
  let extra = count - base * used
  return colors.slice(0, used).map(color => ({
    color,
    dashes: base + (extra-- > 0 ? 1 : 0),
  }))
}

/**
 * Hook that returns banner information for swarm, standalone agent, or --agent CLI context.
 * densable zRr: teammates Object.keys.length > 1 (no teamName gate); external attach = tmux only.
 * Fork: Windows Terminal copy only when detection cache already says windows-terminal
 * (no getResolvedTeammateMode widen). prideGradient: 239 `tZg` is undefined so
 * zRr uses the raw list (`l&&tZg?tZg(l,i):l` → `l`). $Ir paints it as dash colors.
 * hideSessionTitle is FSh/kPE (Tasks V2 visible) — not a footer titleChip invent.
 * - Leader (in tmux / in-process) viewing a teammate: `@name` with their color
 * - Teammate process: `@name` with assigned color (in-process teammates are headless)
 * - Viewing a background agent (CoordinatorTaskPanel): agent name with its color
 * - Standalone agent: name and/or /color background (no @team)
 * - --agent CLI flag: agent type with cyan/prompt border
 */
export function useSwarmBanner(
  options: UseSwarmBannerOptions = {},
): SwarmBannerInfo {
  const hideSessionTitle = options.hideSessionTitle ?? false
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

  // Leader with teammates: densable zRr gate is Object.keys(teammates).length > 1
  // (MQA lead-only seed has length 1 → no banner). No teamName prerequisite.
  // External attach hint: gold is tmux only. Fork WT string only when detection
  // cache already says windows-terminal — do NOT ?? getResolvedTeammateMode()
  // (that invent-widened pre-spawn Windows auto to WT copy; gold shows tmux).
  const hasTeammates =
    !!teamContext?.teammates && Object.keys(teamContext.teammates).length > 1
  if (hasTeammates) {
    const viewedTeammate = getViewedTeammateTask(state)
    const viewedColor = toThemeColor(viewedTeammate?.identity.color)
    const inProcessMode = isInProcessEnabled()
    const detection = getCachedDetectionResult()
    const nativePanes = detection?.isNative ?? false
    const backendType = detection?.backend.type

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

  // densable zRr: `f` (agent def) before standalone; KUt = userOverride ?? agentDef.color.
  // Gate: `!hideSessionTitle && (name || color || gradient)`.
  const agentDef = agent
    ? state.agentDefinitions.activeAgents.find(a => a.agentType === agent)
    : undefined
  const standaloneName = getStandaloneAgentName(state)
  const standaloneColor = standaloneAgentContext?.color
  const prideGradient = standaloneAgentContext?.prideGradient
  if (
    !hideSessionTitle &&
    (standaloneName || standaloneColor || prideGradient?.length)
  ) {
    return {
      text: standaloneName || agent || '',
      bgColor: toThemeColor(standaloneColor ?? agentDef?.color),
      gradient: prideGradient,
    }
  }

  // --agent CLI flag (when not handled above).
  if (agent) {
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
