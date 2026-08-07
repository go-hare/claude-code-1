import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
  type AgentDefinitionsResult,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { useCallback, useEffect } from 'react'
import type { Command } from '../commands.js'
import {
  clearCommandMemoizationCaches,
  clearCommandsCache,
  getCommands,
} from '../commands.js'
import { onGrowthBookRefresh } from '../services/analytics/growthbook.js'
import { logError } from '../utils/log.js'
import { skillChangeDetector } from '../utils/skills/skillChangeDetector.js'

/**
 * densable mOf — keep the commands list (and agents) fresh across triggers:
 *
 * 1. Skill file changes (watcher) — full cache clear + disk re-scan (+ agents).
 * 2. GrowthBook init/refresh — memo-only clear (isEnabled predicates).
 *
 * densable also has A2 config subscribe for skillOverrides /
 * bundledSkillsDisabled; local GrowthBook refresh covers the equivalent
 * re-filter path. Agents reload mirrors densable lU(e) when onAgentsChange
 * is provided.
 */
export function useSkillsChange(
  cwd: string | undefined,
  onCommandsChange: (commands: Command[]) => void,
  onAgentsChange?: (agents: AgentDefinitionsResult) => void,
): void {
  const handleChange = useCallback(async () => {
    if (!cwd) return
    try {
      // densable: $2() full clear + pw(e) + optional lU(e)
      clearCommandsCache()
      const commands = await getCommands(cwd)
      onCommandsChange(commands)
      if (onAgentsChange) {
        clearAgentDefinitionsCache()
        const agents = await getAgentDefinitionsWithOverrides(cwd)
        onAgentsChange(agents)
      }
    } catch (error) {
      if (error instanceof Error) {
        logError(error)
      }
    }
  }, [cwd, onCommandsChange, onAgentsChange])

  useEffect(() => skillChangeDetector.subscribe(handleChange), [handleChange])

  const handleGrowthBookRefresh = useCallback(async () => {
    if (!cwd) return
    try {
      // densable: wZ() memo-only clear
      clearCommandMemoizationCaches()
      const commands = await getCommands(cwd)
      onCommandsChange(commands)
    } catch (error) {
      if (error instanceof Error) {
        logError(error)
      }
    }
  }, [cwd, onCommandsChange])

  useEffect(
    () => onGrowthBookRefresh(handleGrowthBookRefresh),
    [handleGrowthBookRefresh],
  )
}
