import uniqBy from 'lodash-es/uniqBy.js'
import { useMemo } from 'react'
import { type Command, getCommandName } from '../commands.js'

/**
 * Official 2.1.327 #455: always deduplicate commands/skills by resolved name
 * (keeping the first, which is the one slash dispatch executes), even when
 * there are no MCP commands.
 */
export function useMergedCommands(
  initialCommands: Command[],
  mcpCommands: Command[],
): Command[] {
  return useMemo(() => {
    const merged =
      mcpCommands.length > 0
        ? [...initialCommands, ...mcpCommands]
        : initialCommands
    const deduped = uniqBy(merged, cmd => getCommandName(cmd))
    return deduped.length === initialCommands.length && mcpCommands.length === 0
      ? initialCommands
      : deduped
  }, [initialCommands, mcpCommands])
}
