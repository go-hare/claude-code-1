import { LIST_AGENTS_TOOL_NAME } from '@claude-code/builtin-tools/tools/ListPeersTool/constants.js'
import { ListAgentsTool } from '@claude-code/builtin-tools/tools/ListPeersTool/ListPeersTool.js'
import { toolMatchesName } from '../../Tool.js'
import type {
  LocalCommandResult,
  LocalJSXCommandContext,
} from '../../types/command.js'

/**
 * Official 2.1.328 (#677): build the display-only `<system-reminder>` note
 * informing Claude that `/list-agents` output was shown only to the user.
 */
export function buildListAgentsDisplayOnlyMetaMessage(
  hasListAgentsTool: boolean,
): string {
  const hint = hasListAgentsTool
    ? ` To see what it lists, call ${LIST_AGENTS_TOOL_NAME}.`
    : ''
  return `<system-reminder>\nThe output of /list-agents was shown to the user and not to you.${hint}\n</system-reminder>`
}

export async function call(
  _args: string,
  context: LocalJSXCommandContext,
): Promise<LocalCommandResult> {
  const toolResult = await ListAgentsTool.call({}, context)
  const listing =
    typeof toolResult.data?.listing === 'string' &&
    toolResult.data.listing.trim().length > 0
      ? toolResult.data.listing
      : 'No subagents, teammates or other Claude sessions.'
  const tools = context.options?.tools ?? []
  const hasListAgentsTool = tools.some(t =>
    toolMatchesName(t, LIST_AGENTS_TOOL_NAME),
  )
  const result = {
    type: 'text' as const,
    value: listing,
    isDisplayOnly: true,
    metaMessages: [buildListAgentsDisplayOnlyMetaMessage(hasListAgentsTool)],
  }
  return result
}
