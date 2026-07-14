/**
 * Official tsn / BackgroundAndExit — on /exit when a session can be
 * backgrounded, spawn a bg session from the seed and exit with Vdt hints.
 *
 * Denser path (official dOo/fOo portable subset): prefer
 * `handleBgStart(['-p', '', '--resume', sessionId, '--fork-session', ...])`
 * so the bg child continues the same transcript rather than starting a fresh
 * print-only intent job. Mid-turn exit adds `--reply-on-resume` (official
 * `replyOnResume: isMidTurn`). Falls back to `-p intent` without session id.
 */
import React, { useEffect, useRef } from 'react';
import { Box, Text } from '@anthropic/ink';
import {
  canBackgroundSession,
  deriveBackgroundSeed,
  formatBgHints,
  type BackgroundSeedMessage,
} from '../cli/bg/helpers.js';
import { handleBgStart } from '../cli/bg.js';
import { getSessionId } from '../bootstrap/state.js';
import { isBgSession } from '../utils/concurrentSessions.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { shouldSkipPromptHistory } from '../utils/residualFinalEnvGates.js';

type Props = {
  messages: readonly BackgroundSeedMessage[];
  isMidTurn?: boolean;
  onDone: (message?: string) => void;
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

export function BackgroundAndExit({ messages, isMidTurn = false, onDone }: Props): React.ReactNode {
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
        const shortId = sessionId ? sessionId.slice(0, 8) : 'session';
        const prevExit = process.exitCode;
        await handleBgStart(
          buildBackgroundExitArgs(seed, sessionId, {
            replyOnResume: isMidTurn,
          }),
        );
        if (process.exitCode && process.exitCode !== 0) {
          const err = `Failed to background session (exit ${process.exitCode})`;
          process.exitCode = prevExit;
          onDone(err);
          await gracefulShutdown(0, 'prompt_input_exit');
          return;
        }
        process.exitCode = prevExit;
        onDone(formatBgHints(shortId, undefined, seed.name ?? seed.intent));
        await gracefulShutdown(0, 'prompt_input_exit');
      } catch (e) {
        onDone(e instanceof Error ? e.message : String(e));
        await gracefulShutdown(0, 'prompt_input_exit');
      }
    })();
  }, [messages, isMidTurn, onDone]);

  return (
    <Box>
      <Text dimColor>Moving to background…</Text>
    </Box>
  );
}

/** Official mOo gate for exit / session-background UI. */
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
  return canBackgroundSession(messages, {
    featureEnabled: true,
    isBgSession: isBgSession(),
    skipHistory: shouldSkipPromptHistory(),
    adoptDisabled: isEnvTruthy(process.env.CLAUDE_DISABLE_ADOPT),
  });
}
