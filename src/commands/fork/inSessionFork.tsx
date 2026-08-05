import { isForkSubagentEnabled, isInForkChild } from '@claude-code/builtin-tools/tools/AgentTool/forkSubagent.js';
import { FORK_GLYPH } from '../../constants/figures.js';
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js';
import { logForDebugging } from '../../utils/debug.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { launchInSessionForkAgent } from './launchInSessionForkAgent.js';

/**
 * densable 2.1.212 `gwd` / `i$y` — agent-view OFF `/fork`.
 *
 * When agent view is disabled (or IS_DEMO), densable registers only this path:
 *   `/fork <directive>` → xZr (in-session full-context background agent)
 * instead of the keepParent session-copy `/fork` + `/subtask` pair.
 *
 * densable:
 *   o = await xZr(...); if (!o) error; else toast `${KW} forked ${o.name} (${o.agentId.slice(-4)})`
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<null> {
  if (!isForkSubagentEnabled()) {
    onDone(
      'Fork worker is not available. Enable with FEATURE_FORK_SUBAGENT=1 or CLAUDE_CODE_FORK_SUBAGENT=1 (interactive session, not coordinator mode).',
      { display: 'system' },
    );
    return null;
  }

  if (isCoordinatorMode()) {
    onDone('Forking is not available in coordinator sessions. Use /branch instead.', { display: 'system' });
    return null;
  }

  if (isInForkChild(context.messages)) {
    onDone('Fork is not available inside a forked worker. Complete your task directly using your tools.', {
      display: 'system',
    });
    return null;
  }

  const directive = args.trim();
  if (!directive) {
    // densable i$y: "Usage: /fork \<directive\>"
    onDone('Usage: /fork <directive>', { display: 'system' });
    return null;
  }

  const lastAssistantMessage = [...context.messages].reverse().find(m => m.type === 'assistant');

  if (!lastAssistantMessage) {
    // densable: "Cannot fork before the first conversation turn"
    onDone('Cannot fork before the first conversation turn', {
      display: 'system',
    });
    return null;
  }

  try {
    // densable i$y: await xZr → structured {name, agentId} or null
    const launched = await launchInSessionForkAgent(directive, context, lastAssistantMessage);

    if (!launched) {
      onDone(
        isCoordinatorMode()
          ? 'Forking is not available in coordinator sessions. Use /branch instead.'
          : 'Cannot fork before the first conversation turn',
        { display: 'system' },
      );
      return null;
    }

    onDone(`${FORK_GLYPH} forked ${launched.name} (${launched.agentId.slice(-4)})`, {
      display: 'system',
    });
    return null;
  } catch (error) {
    logForDebugging(`In-session /fork setup error: ${error}`, {
      level: 'error',
    });
    onDone(`Fork failed: ${error instanceof Error ? error.message : String(error)}`, { display: 'system' });
    return null;
  }
}
