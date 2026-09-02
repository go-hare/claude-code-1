/**
 * Official Gan / BackgroundAndExit — on /exit when a session can be
 * backgrounded, hand the transcript to the daemon job dispatcher and exit.
 *
 * densable 2.1.211 **hNo** order (critical — not u4d):
 *   1. CAo(tasks) → collect checkpoint (detach shells)
 *   2. if checkpoint: r=randomUUID(); mkdir jobDir=dc(r.slice(0,8));
 *      Jlr(adopt) + checkpointAgents  (catch → r=undefined, spawn continues)
 *   3. yNo spawn with providedSessionId=r + replyOnResume=isMidTurn
 *   4. ok → if (t && r) disown; fail → if (r) abandon
 *
 * Local: ensureDaemonRunning → collectPortableCheckpoint → writeAdoptJson
 * (CAo payload as-is; NOT writeExitHandoffAdopt/u4d origin:"exit") →
 * submitDispatch({ providedSessionId, resumeSessionId, --reply-on-resume }).
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
   * Optional AppState.tasks snapshot (or getter) for official CAo/hNo exit
   * handoff adopt.json write. When omitted, only submitDispatch runs.
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

export type ExitBackgroundHandoffResult =
  | { ok: true; short: string; sessionId: string; adopted: boolean }
  | { ok: false; error: string };

/**
 * densable hNo portable body (without process exit):
 *   CAo → Jlr(+checkpointAgents) → yNo → disown|abandon
 *
 * Pure async helper so order can be unit-tested without Ink.
 */
export async function runExitBackgroundHandoff(input: {
  seed: { intent: string; name?: string };
  /** Current REPL session to resume/fork. */
  resumeSessionId?: string;
  isMidTurn?: boolean;
  tasks?: Record<string, unknown> | null;
  cwd?: string;
}): Promise<ExitBackgroundHandoffResult> {
  const { ensureDaemonRunning } = await import('../daemon/installPrompt.js');
  // densable: lifecycle log-only; no install prompt mid exit handoff.
  const daemon = await ensureDaemonRunning({
    forceTransient: true,
    mayPromptInstall: false,
  });
  if (!daemon.ok) {
    return {
      ok: false,
      error: `Failed to background session: ${daemon.reason ?? 'daemon unavailable'}`,
    };
  }

  const { getJobDirPath } = await import('../daemon/jobState.js');
  const { collectPortableCheckpoint, writeAdoptJson, abandonCheckpointShells, reapNonHandoffTasks } = await import(
    '../utils/bgCheckpoint.js'
  );

  const typedTasks = (input.tasks ?? null) as Parameters<typeof collectPortableCheckpoint>[0]['tasks'] | null;

  // densable CAo: always filter zI().filter(lWe) session crons — cron-only
  // sessions must still write adopt checkpoint (do not hard-code cron: []).
  const { getSessionCronTasks } = await import('../bootstrap/state.js');
  const sessionCrons = getSessionCronTasks().map(t => ({
    id: t.id,
    cron: t.cron,
    prompt: t.prompt,
    createdAt: t.createdAt,
    recurring: t.recurring,
    agentId: t.agentId,
  }));

  // densable CAo — null only when no eligible shells/agents/workflows/cron
  let collected: ReturnType<typeof collectPortableCheckpoint> | null | undefined = collectPortableCheckpoint({
    tasks: typedTasks ?? {},
    cron: sessionCrons,
    detachShells: true,
  });

  // densable hNo: if (t) { r = randomUUID(); o=dc(r.slice(0,8)); mkdir +
  // Jlr(t.payload) + checkpointAgents } — CAo payload as-is (NOT u4d).
  // Always write adopt into the NEW job dir for r so it matches yNo
  // providedSessionId (do not reuse CLAUDE_JOB_DIR — gold always dc(short)).
  let providedSessionId: string | undefined;
  let adoptWriteOk = false;

  if (collected) {
    const { randomUUID } = await import('crypto');
    providedSessionId = randomUUID();
    const short = providedSessionId.slice(0, 8);
    const jobDir = getJobDirPath(short);
    try {
      // densable: await Jlr(o, t.payload); await t.checkpointAgents(reg)
      // writeAdoptJson mkdir(jobDir) covers densable Zhr.mkdir
      await writeAdoptJson(jobDir, collected.payload);
      // densable CAo.checkpointAgents: workflow abort+zit, agent-owned shell
      // remove, agent abort, setImmediate + Gx transcript flush.
      // Parent is exiting — AppState remove/zit is best-effort no-op; flush Gx.
      const { flushSessionStorage } = await import('../utils/sessionStorage.js');
      await collected.checkpointAgents({
        removeTaskIds: () => {
          /* parent exiting */
        },
        markWorkflowPaused: () => {
          /* parent exiting — zit no-op */
        },
        flushAgentTranscripts: () => flushSessionStorage(),
      });
      adoptWriteOk = true;
    } catch {
      // densable: catch → r=void 0 (spawn still proceeds without provided id)
      providedSessionId = undefined;
      adoptWriteOk = false;
    }
  }

  // densable yNo: await Ca(Gx(), 2000, "flush timeout") before Fbe spawn —
  // unconditional transcript flush so forked resume sees parent mid-turn bytes.
  try {
    const { flushSessionStorage } = await import('../utils/sessionStorage.js');
    await Promise.race([
      flushSessionStorage(),
      new Promise<void>(resolve => {
        const t = setTimeout(resolve, 2000);
        t.unref?.();
      }),
    ]);
  } catch {
    /* best-effort Gx */
  }

  const { submitDispatch } = await import('../daemon/bgManager.js');
  try {
    const dispatch = await submitDispatch({
      intent: input.seed.intent,
      name: input.seed.name,
      cwd: input.cwd ?? getOriginalCwd(),
      source: 'exit',
      resumeSessionId: input.resumeSessionId,
      forkSession: true,
      // densable yNo providedSessionId — job dir short matches spawn target
      providedSessionId,
      extraArgs: input.isMidTurn ? ['--reply-on-resume'] : [],
    });

    // densable: if (n.ok) { if (t && r) t.disown(reg) }
    // submitDispatch throws when control ack reports settled crashed/failed.
    if (adoptWriteOk && collected) {
      collected.disown({
        removeTaskIds: ids => {
          /* parent is exiting — AppState cleanup is best-effort no-op */
          void ids;
        },
      });
      try {
        reapNonHandoffTasks({
          tasks: typedTasks!,
          handoffTaskIds: collected.handoffTaskIds,
        });
      } catch {
        /* best-effort */
      }
    } else if (typedTasks) {
      // No portable handoff — still reap residual running work (Hen empty set)
      try {
        reapNonHandoffTasks({ tasks: typedTasks, handoffTaskIds: [] });
      } catch {
        /* best-effort */
      }
    }

    return {
      ok: true,
      short: dispatch.short,
      sessionId: dispatch.sessionId,
      adopted: adoptWriteOk,
    };
  } catch (e) {
    // densable: if (r) t?.abandon() — only when adopt write succeeded
    // (providedSessionId / r was kept). Jlr fail clears r and does not abandon.
    if (adoptWriteOk && collected) {
      try {
        abandonCheckpointShells(collected);
      } catch {
        /* best-effort */
      }
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function BackgroundAndExit({ messages, isMidTurn = false, onDone, getTasks }: Props): React.ReactNode {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const cancelBgHandoffQuota = async () => {
        // densable CTo → Q6e(..., "background_handoff") cancel side-effect
        try {
          const { beginQuotaAutoResumeHandoff } = await import('../services/quotaAutoResume.js');
          beginQuotaAutoResumeHandoff('background_handoff');
        } catch {
          /* best-effort */
        }
      };

      const seed = deriveBackgroundSeed(messages, '');
      if (seed === null) {
        onDone('Nothing to background — exiting.');
        await cancelBgHandoffQuota();
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

        await cancelBgHandoffQuota();

        const tasks = getTasks?.() ?? null;
        const result = await runExitBackgroundHandoff({
          seed: { intent: seed.intent, name: seed.name },
          resumeSessionId: sessionId,
          isMidTurn,
          tasks: tasks as Record<string, unknown> | null,
          cwd: getOriginalCwd(),
        });

        if (!result.ok) {
          // leftover 239 Q6e catch → kHe after _6i persist fail
          try {
            const { endQuotaAutoResumeHandoff } = await import('../services/quotaAutoResume.js');
            endQuotaAutoResumeHandoff();
          } catch {
            /* best-effort */
          }
          onDone(result.error);
          await gracefulShutdown(0, 'prompt_input_exit', {
            finalMessage: result.error,
          });
          return;
        }

        const hint = formatBgHints(result.short, undefined, seed.name ?? seed.intent);
        onDone(hint);
        // Official Cs(..., {suppressResumeHint:true, finalMessage})
        await gracefulShutdown(0, 'prompt_input_exit', {
          suppressResumeHint: true,
          finalMessage: hint,
        });
      } catch (e) {
        await cancelBgHandoffQuota();
        try {
          const { endQuotaAutoResumeHandoff } = await import('../services/quotaAutoResume.js');
          endQuotaAutoResumeHandoff();
        } catch {
          /* leftover 239 Q6e catch kHe */
        }
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
