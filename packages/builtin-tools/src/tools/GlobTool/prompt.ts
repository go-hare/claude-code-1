import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { shouldUseSimpleSystemPrompt } from 'src/utils/simpleSystemPrompt.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'

export const GLOB_TOOL_NAME = 'Glob'

export function readSubagentSteer(): 'default' | 'no_nudges' | 'counter_steer' {
  const envVal = process.env.CLAUDE_CODE_THISTLE_GREBE
  if (
    envVal === 'default' ||
    envVal === 'no_nudges' ||
    envVal === 'counter_steer'
  ) {
    return envVal
  }
  try {
    const gbVal = getFeatureValue_CACHED_MAY_BE_STALE<string | null>(
      'tengu_thistle_grebe',
      null,
    )
    if (
      gbVal === 'default' ||
      gbVal === 'no_nudges' ||
      gbVal === 'counter_steer'
    ) {
      return gbVal
    }
  } catch {
    // growthbook optional
  }
  return 'default'
}

export const BASE_DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns`

export const DESCRIPTION = `${BASE_DESCRIPTION}
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the ${AGENT_TOOL_NAME} tool instead (if available)`

export function getGlobToolDescription(
  model?: string,
  leanPrompt?: boolean,
): string {
  const isLean = leanPrompt ?? shouldUseSimpleSystemPrompt({ model })
  if (isLean) {
    return 'Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.'
  }
  return readSubagentSteer() === 'default' ? DESCRIPTION : BASE_DESCRIPTION
}
