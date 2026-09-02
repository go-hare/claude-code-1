import { feature } from 'bun:bundle';
import { spawnSync } from 'child_process';
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { getMainLoopBusy } from '../../bootstrap/state.js';
import { ExitFlow } from '../../components/ExitFlow.js';
import type { TaskState } from '../../tasks/types.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { isBgSession } from '../../utils/concurrentSessions.js';
import { listExitInFlightItems } from '../../utils/exitBackgroundItems.js';
import { exitPromptShutdown } from '../../utils/exitPromptShutdown.js';
import type { TodoItem } from '../../utils/todo/types.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';

const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];

function getRandomGoodbyeMessage(): string {
  return sample(GOODBYE_MESSAGES) ?? 'Goodbye!';
}

/**
 * densable wO0 — /exit · /quit product path:
 *   bg session → detach
 *   worktree || Zeh() items → $To (ExitFlow → Ubs/Lbs/xTo)
 *   else → goodbye + nst (no bare BackgroundAndExit; that is only via Lbs
 *   "Move to background and exit")
 *
 * Gold TTc unsent feedback-draft nudge is invent-ban (no storageV5 draft host).
 */
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  // Inside a `claude --bg` tmux session: detach instead of kill. The REPL
  // keeps running; `claude attach` can reconnect. Covers /exit, /quit,
  // ctrl+c, ctrl+d — all funnel through here via REPL's handleExit.
  if (feature('BG_SESSIONS') && isBgSession()) {
    onDone();
    spawnSync('tmux', ['detach-client'], { stdio: 'ignore' });
    return null;
  }

  const showWorktree = getCurrentWorktreeSession() !== null;
  let tasks: Record<string, TaskState> | undefined;
  let todos: TodoItem[] | null | undefined;
  try {
    const app = context.getAppState();
    tasks = app?.tasks as Record<string, TaskState> | undefined;
    const todosMap = app?.todos as Record<string, TodoItem[] | undefined> | undefined;
    if (todosMap) {
      try {
        const { getSessionId } = await import('../../bootstrap/state.js');
        todos = todosMap[getSessionId()] ?? null;
      } catch {
        todos = null;
      }
    }
  } catch {
    tasks = undefined;
    todos = undefined;
  }
  // densable wO0: n=Zeh() — GJr fan items, not Jeh(tasks).
  const backgroundItems = listExitInFlightItems({
    tasks: tasks ?? {},
    todos: todos ?? null,
  });
  if (showWorktree || backgroundItems.length > 0) {
    return (
      <ExitFlow
        showWorktree={showWorktree}
        backgroundItems={backgroundItems}
        messages={context.messages ?? []}
        isMidTurn={getMainLoopBusy()}
        onDone={onDone}
        onCancel={() => onDone()}
        getTasks={() => {
          try {
            return context.getAppState()?.tasks as Record<string, unknown> | undefined;
          } catch {
            return null;
          }
        }}
      />
    );
  }

  onDone(getRandomGoodbyeMessage());
  await exitPromptShutdown({
    messages: context.messages ?? [],
    responseStreaming: false,
  });
  return null;
}
