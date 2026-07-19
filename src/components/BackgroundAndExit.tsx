/**
 * Official Gan / BackgroundAndExit — on /exit when a session can be
 * backgrounded, hand the transcript to the daemon job dispatcher and exit.
 *
 * Official path: eOo → rOo → Hbe/OJs (daemon job dispatch with resume/fork).
 * Local equivalent: ensureDaemonRunning → submitDispatch({ resumeSessionId }).
 * Mid-turn exit adds `--reply-on-resume` via dispatch flagArgs.
 *
 * Do NOT use DetachedEngine / `claude -p "" --resume ... --fork-session` here —
 * that leaves orphan print-mode children on Windows.
 */
import React, { useEffect, useRef } from 'react';
import { Box, Text } from '@anthropic/ink';
import {
  canBackgroundSession,
  deriveBackgroundSeed,
  formatBgHints,
  type BackgroundSeedMessage,
} from '../cli/bg/helpers.js';
import { getOriginalCwd, getSessionId, isSessionPersistenceDisabled } from '../bootstrap/state.js';
import { isBgSession } from '../utils/concurrentSessions.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { shouldSkipPromptHistory } from '../utils/residualFinalEnvGates.js';

type Props = {
  messages: readonly BackgroundSeedMessage[];
  isMidTurn?: boolean;
  onDone: (message?: string) => void;
  /**
   * Optional AppState.tasks snapshot (or getter) for official u4d exit handoff
   * adopt.json write (origin:"exit"). When omitted, only submitDispatch runs.
   */
  getTasks?: () => Record<string, unknown> | null | undefined;
};

export type BackgroundExitArgOptions = {
  /** Official fOo replyOnResume — true when exiting mid-turn. */
  replyOnResume?: boolean;
  /** Official always pairs --fork-session with --resume (default true). */
  forkSession?: boolean;
};

/** Build portable bg-start argv for exit handoff (official dOo/fOo subset). */
export function buildBackgroundExitArgs(
  seed: { intent: string; name?: string },
  sessionId: string | null | undefined,
  opts: BackgroundExitArgOptions = {},
): string[] {
  const args: string[] = [];
  // Print mode required for DetachedEngine (no TTY). Empty prompt is fine with
  // --resume — the child continues the transcript; intent is only fallback.
  if (sessionId) {
    args.push('-p', '', '--resume', sessionId);
    if (opts.forkSession !== false) {
      args.push('--fork-session');
    }
    if (opts.replyOnResume) {
      args.push('--reply-on-resume');
    }
  } else {
    args.push('-p', seed.intent || '(backgrounded)');
  }
  if (seed.name) {
    args.push('--name', seed.name);
  }
  return args;
}

export function BackgroundAndExit({ messages, isMidTurn = false, onDone, getTasks }: Props): React.ReactNode {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const seed = deriveBackgroundSeed(messages, '');
      if (seed === null) {
        onDone('Nothing to background — exiting.');
        await gracefulShutdown(0, 'prompt_input_exit');
        return;
      }

      try {
        let sessionId: string | undefined;
        try {
          sessionId = getSessionId();
        } catch {
          sessionId = undefined;
        }
        const { ensureDaemonRunning } = await import('../daemon/installPrompt.js');
        const daemon = await ensureDaemonRunning({
          forceTransient: true,
          mayPromptInstall: false,
        });
        if (!daemon.ok) {
          const err = `Failed to background session: ${daemon.reason ?? 'daemon unavailable'}`;
          onDone(err);
          await gracefulShutdown(0, 'prompt_input_exit', { finalMessage: err });
          return;
        }
        const { submitDispatch } = await import('../daemon/bgManager.js');
        const dispatch = await submitDispatch({
          intent: seed.intent,
          name: seed.name,
          cwd: getOriginalCwd(),
          source: 'exit',
          // Resume/fork the existing transcript in a daemon-managed session.
          // When sessionId is missing, fall back to a fresh prompt job.
          resumeSessionId: sessionId,
          forkSession: true,
          extraArgs: isMidTurn ? ['--reply-on-resume'] : [],
        });

        // Official u4d — write adopt.json with origin:"exit" into the forked
        // job dir so the next wake can claim shells/agents/workflows (k$a/Lvu).
        // Prefer existing CLAUDE_JOB_DIR when already in a bg session; else new short.
        try {
          const { getJobDirPath } = await import('../daemon/jobState.js');
          const { writeExitHandoffAdopt, collectPortableCheckpoint } = await import('../utils/bgCheckpoint.js');
          const existingJobDir = process.env.CLAUDE_JOB_DIR;
          const jobDir = existingJobDir || getJobDirPath(dispatch.short);
          const tasks = getTasks?.() ?? null;
          if (tasks && Object.keys(tasks).length > 0) {
            const typedTasks = tasks as Parameters<typeof collectPortableCheckpoint>[0]['tasks'];
            const cp = collectPortableCheckpoint({
              tasks: typedTasks,
              cron: [],
              detachShells: true,
            });
            if (cp) {
              // Pass tasks so u4d can abort live agent/workflow controllers.
              await writeExitHandoffAdopt(jobDir, {
                checkpoint: cp,
                tasks: typedTasks,
              });
              // Official disown: remove checkpointed tasks from this process before exit.
              cp.disown({
                removeTaskIds: ids => {
                  /* parent is exiting — AppState cleanup is best-effort no-op */
                  void ids;
                },
              });
              // Official Hen residual: reap running tasks not in the handoff set
              // (agent-owned shells, non-background agents, monitors with status
              // running, etc.). Parent is exiting — remove is best-effort.
              try {
                const { reapNonHandoffTasks } = await import('../utils/bgCheckpoint.js');
                reapNonHandoffTasks({
                  tasks: typedTasks,
                  handoffTaskIds: cp.handoffTaskIds,
                });
              } catch {
                /* best-effort */
              }
            } else {
              // No portable handoff payload — still reap all running residual
              // work so the process doesn't leave orphans (official Hen when
              // c4d handoff set empty still iterates non-handoff).
              try {
                const { reapNonHandoffTasks } = await import('../utils/bgCheckpoint.js');
                reapNonHandoffTasks({ tasks: typedTasks, handoffTaskIds: [] });
              } catch {
                /* best-effort */
              }
            }
          }
        } catch {
          // best-effort — don't block exit on adopt write failure
        }

        const hint = formatBgHints(dispatch.short, undefined, seed.name ?? seed.intent);
        onDone(hint);
        // Official Cs(..., {suppressResumeHint:true, finalMessage})
        await gracefulShutdown(0, 'prompt_input_exit', {
          suppressResumeHint: true,
          finalMessage: hint,
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        onDone(err);
        await gracefulShutdown(0, 'prompt_input_exit', { finalMessage: err });
      }
    })();
  }, [messages, isMidTurn, onDone, getTasks]);

  return (
    <Box>
      <Text dimColor>Moving to background…</Text>
    </Box>
  );
}

/**
 * Official nOo gate for exit / session-background UI.
 * Mapping (2.1.210):
 *   kk()  → BG_SESSIONS feature already gated by caller + residual handoff env
 *   Xi()  → isBgSession()
 *   A$()  → isSessionPersistenceDisabled() / shouldSkipPromptHistory()
 *   Kfo() → !CLAUDE_DISABLE_ADOPT
 *   s1t() → deriveBackgroundSeed(...)
 */
export function canOfferBackgroundAndExit(messages: readonly BackgroundSeedMessage[]): boolean {
  try {
    const { isBgExitHandoffDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js');
    if (isBgExitHandoffDisabled()) return false;
  } catch {
    if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF)) {
      return false;
    }
  }
  // featureEnabled is true here because callers already guard with feature('BG_SESSIONS').
  return canBackgroundSession(messages, {
    featureEnabled: true,
    isBgSession: isBgSession(),
    skipHistory: shouldSkipPromptHistory() || isSessionPersistenceDisabled(),
    adoptDisabled: isEnvTruthy(process.env.CLAUDE_DISABLE_ADOPT),
  });
}
