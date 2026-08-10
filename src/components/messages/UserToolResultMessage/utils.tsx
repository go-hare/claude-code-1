import type { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { useMemo } from 'react';
import { findToolByName, type Tool, type Tools } from '../../../Tool.js';
import type { buildMessageLookups } from '../../../utils/messages.js';

/** densable xB — only this name recovers from base registry when missing live. */
const BRIEF_BASE_FALLBACK_NAME = 'SendUserMessage';

/**
 * densable 2.1.222 #11 Wli core (pure, testable).
 *
 * 221: missing live tool definition → null (hid is_error tool_result UI).
 * 222: missing live tool → still return { tool?: baseBrief|undefined, toolUse }
 * so UserToolErrorMessage can render FallbackToolUseErrorMessage.
 *
 * @param baseTools densable rft()/ePu — full base registry (for Brief recovery)
 */
export function resolveToolFromMessages(
  toolUseID: string,
  tools: Tools,
  toolUseByToolUseID: Map<string, ToolUseBlockParam>,
  baseTools: Tools = [],
): { tool?: Tool; toolUse: ToolUseBlockParam } | null {
  const toolUse = toolUseByToolUseID.get(toolUseID);
  if (!toolUse) {
    return null;
  }
  const tool = findToolByName(tools, toolUse.name);
  if (tool) {
    return { tool, toolUse };
  }
  // densable ULf=Set([xB]) + rft(): only Brief recovers from base tools
  const briefFallback = toolUse.name === BRIEF_BASE_FALLBACK_NAME ? findToolByName(baseTools, toolUse.name) : undefined;
  return { tool: briefFallback, toolUse };
}

/**
 * densable 2.1.222 #11 — Wli / useGetToolFromMessages.
 *
 * Returns null only when the tool_use *block* is missing from transcript
 * lookups. A missing tool *definition* (MCP removed, pool changed) still
 * yields { tool: undefined, toolUse } so error results stay visible.
 */
export function useGetToolFromMessages(
  toolUseID: string,
  tools: Tools,
  lookups: ReturnType<typeof buildMessageLookups>,
): { tool?: Tool; toolUse: ToolUseBlockParam } | null {
  return useMemo(() => {
    // Lazy require avoids pulling tools.ts into pure unit-test import graphs.
    // densable rft() → ePu base registry (getAllBaseTools).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAllBaseTools } = require('../../../tools.js') as typeof import('../../../tools.js');
    return resolveToolFromMessages(toolUseID, tools, lookups.toolUseByToolUseID, getAllBaseTools());
  }, [toolUseID, lookups, tools]);
}
