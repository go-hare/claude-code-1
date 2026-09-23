import { formatTotalCost } from '../../cost-tracker.js'
import { currentLimits } from '../../services/claudeAiLimits.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'
import { formatPromptCacheCostLine } from './promptCacheStatus.js'

function appendPromptCacheLine(value: string): string {
  const line = formatPromptCacheCostLine()
  return line === null ? value : `${value}\n${line}`
}

export const call: LocalCommandCall = async () => {
  if (isClaudeAISubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your Claude Code usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your Claude Code usage'
    }

    if (process.env.USER_TYPE === 'ant') {
      value += `\n\n[ANT-ONLY] Showing cost anyway:\n ${formatTotalCost()}`
    }
    return { type: 'text', value: appendPromptCacheLine(value) }
  }
  return { type: 'text', value: appendPromptCacheLine(formatTotalCost()) }
}
