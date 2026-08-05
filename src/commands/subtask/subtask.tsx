import { isForkSubagentEnabled, isInForkChild } from '@claude-code/builtin-tools/tools/AgentTool/forkSubagent.js';
import { FORK_GLYPH } from '../../constants/figures.js';
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js';
import { logForDebugging } from '../../utils/debug.js';
import type { LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js';
import { launchInSessionForkAgent } from '../fork/launchInSessionForkAgent.js';

/**
 * densable 2.1.212 `/subtask` (s$y → xZr):
 * former in-session `/fork` worker — full-context background agent;
 * result returns via task-notification.
 *
 * densable:
 *   o = await xZr(...); if (!o) error; else toast `${KW} forked ${o.name} (${o.agentId.slice(-4)})`
 *
 * AgentTool fork path: omit subagent_type while isForkSubagentEnabled().
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<null> {
  if (!isForkSubagentEnabled()) {
    onDone(
      'Subtask (fork worker) is not available. Enable with FEATURE_FORK_SUBAGENT=1 or CLAUDE_CODE_FORK_SUBAGENT=1 (interactive session, not coordinator mode).',
      { display: 'system' },
    );
    return null;
  }

  // densable s$y / xZr: coordinator → branch hint
  if (isCoordinatorMode()) {
    onDone('Subtasks are not available in coordinator sessions. Use /branch instead.', {
      display: 'system',
    });
    return null;
  }

  if (isInForkChild(context.messages)) {
    onDone('Subtask is not available inside a forked worker. Complete your task directly using your tools.', {
      display: 'system',
    });
    return null;
  }

  const directive = args.trim();
  if (!directive) {
    // densable s$y: "Usage: /subtask \<task\>"
    onDone('Usage: /subtask <task>', { display: 'system' });
    return null;
  }

  const lastAssistantMessage = [...context.messages].reverse().find(m => m.type === 'assistant');

  if (!lastAssistantMessage) {
    // densable xZr null when no turn / prompt missing
    onDone('Cannot start a subtask before the first conversation turn', {
      display: 'system',
    });
    return null;
  }

  try {
    // densable s$y: await xZr → structured {name, agentId} or null
    const launched = await launchInSessionForkAgent(directive, context, lastAssistantMessage);

    if (!launched) {
      onDone(
        isCoordinatorMode()
          ? 'Subtasks are not available in coordinator sessions. Use /branch instead.'
          : 'Cannot start a subtask before the first conversation turn',
        { display: 'system' },
      );
      return null;
    }

    onDone(`${FORK_GLYPH} forked ${launched.name} (${launched.agentId.slice(-4)})`, {
      display: 'system',
    });
    return null;
  } catch (error) {
    logForDebugging(`Subtask setup error: ${error}`, { level: 'error' });
    onDone(`Subtask failed: ${error instanceof Error ? error.message : String(error)}`, { display: 'system' });
    return null;
  }
}
