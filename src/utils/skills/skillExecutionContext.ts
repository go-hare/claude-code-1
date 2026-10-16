/**
 * densable 2.1.289 `k_n` — dynamic fork context.
 * Never export minify k_n.
 */
import type { PromptCommand } from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'
import type { EffortValue } from '../effort.js'

/**
 * densable `k_n(e,o,r)` = `e.getContext?.(o,r) ?? e.context ?? "inline"`.
 */
export function resolveSkillExecutionContext(
  command: Pick<PromptCommand, 'context' | 'getContext'>,
  args: string,
  context: ToolUseContext,
): 'inline' | 'fork' {
  return command.getContext?.(args, context) ?? command.context ?? 'inline'
}

/**
 * densable `e.getEffort?.(s,o)??e.getDefaultEffort?.(s,o)?.value??e.effort`
 */
export function resolveSkillEffort(
  command: Pick<PromptCommand, 'effort' | 'getEffort' | 'getDefaultEffort'>,
  args: string,
  context: ToolUseContext,
): EffortValue | undefined {
  return (
    command.getEffort?.(args, context) ??
    command.getDefaultEffort?.(args, context)?.value ??
    command.effort
  )
}

/** Gold Ywo: fork-capable when `context==="fork"` OR `getContext` is defined. */
export function isForkCapableSkill(
  command: Pick<PromptCommand, 'context' | 'getContext'> | undefined,
): boolean {
  if (command === undefined) return false
  return command.context === 'fork' || command.getContext !== undefined
}
