import { feature } from 'bun:bundle';
import { spawnSync } from 'child_process';
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { getMainLoopBusy } from '../../bootstrap/state.js';
import { BackgroundAndExit, canOfferBackgroundAndExit } from '../../components/BackgroundAndExit.js';
import { ExitFlow } from '../../components/ExitFlow.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { isBgSession } from '../../utils/concurrentSessions.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';

const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];

function getRandomGoodbyeMessage(): string {
  return sample(GOODBYE_MESSAGES) ?? 'Goodbye!';
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  // Inside a `claude --bg` tmux session: detach instead of kill. The REPL
  // keeps running; `claude attach` can reconnect. Covers /exit, /quit,
  // ctrl+c, ctrl+d — all funnel through here via REPL's handleExit.
  if (feature('BG_SESSIONS') && isBgSession()) {
    onDone();
    spawnSync('tmux', ['detach-client'], { stdio: 'ignore' });
    return null;
  }

  // Official tsn / BackgroundAndExit: offer process-level bg handoff on exit
  // when BG_SESSIONS is on and the conversation has a backgroundable seed.
  // feature() must stay in if/ternary condition position (bun:bundle).
  if (feature('BG_SESSIONS')) {
    let bgExitHandoffDisabled = isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF);
    try {
      const { isBgExitHandoffDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js');
      bgExitHandoffDisabled = isBgExitHandoffDisabled();
    } catch {
      // residual helpers optional
    }
    if (!bgExitHandoffDisabled && canOfferBackgroundAndExit(context.messages ?? [])) {
      // Official fOo replyOnResume: isMidTurn — query loop busy (mainLoopBusy).
      // Pass tasks for official u4d origin:"exit" adopt handoff.
      const getTasks = () => {
        try {
          return context.getAppState?.()?.tasks ?? null;
        } catch {
          return null;
        }
      };
      return (
        <BackgroundAndExit
          messages={context.messages ?? []}
          isMidTurn={getMainLoopBusy()}
          onDone={msg => onDone(msg)}
          getTasks={getTasks}
        />
      );
    }
  }

  const showWorktree = getCurrentWorktreeSession() !== null;

  if (showWorktree) {
    return <ExitFlow showWorktree={showWorktree} onDone={onDone} onCancel={() => onDone()} />;
  }

  onDone(getRandomGoodbyeMessage());
  await gracefulShutdown(0, 'prompt_input_exit');
  return null;
}
