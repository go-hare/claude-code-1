import React, { useEffect, useRef } from 'react';
import { Box, Text } from '@anthropic/ink';
import { getMainLoopBusy, getOriginalCwd, getSessionId, isSessionPersistenceDisabled } from '../../bootstrap/state.js';
import { type BackgroundSeed, deriveBackgroundSeed, formatBgHints } from '../../cli/bg/helpers.js';
import { settleBackgroundSeedName } from '../../cli/bg/jobNameSettle.js';
import { BackgroundAndExit, runExitBackgroundHandoff } from '../../components/BackgroundAndExit.js';
import { requestBgDetach } from '../../daemon/rendezvousServer.js';
import { logEvent } from '../../services/analytics/index.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { formatSessionFrameLiveCopy } from '../../utils/bgCheckpoint.js';
import { isBgSession } from '../../utils/concurrentSessions.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';

function BackgroundWithPrompt({
  seed,
  isMidTurn,
  onDone,
  getTasks,
}: {
  seed: BackgroundSeed;
  isMidTurn: boolean;
  onDone: LocalJSXCommandOnDone;
  getTasks: () => Record<string, unknown> | null | undefined;
}): React.ReactNode {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const settled = await settleBackgroundSeedName(seed);
        let sessionId: string | undefined;
        try {
          sessionId = getSessionId();
        } catch {
          sessionId = undefined;
        }
        const result = await runExitBackgroundHandoff({
          seed: { intent: settled.intent, name: settled.name },
          resumeSessionId: sessionId,
          isMidTurn,
          tasks: (getTasks() ?? null) as Record<string, unknown> | null,
          cwd: getOriginalCwd(),
        });

        if (!result.ok) {
          const failCopy =
            result.error +
            formatSessionFrameLiveCopy({
              ok: false,
              frameLiveLost: result.frameLiveLost,
            });
          onDone(failCopy, { display: 'system' });
          return;
        }

        const hint = formatBgHints(result.short, undefined, settled.name ?? settled.intent);
        const successCopy =
          hint +
          formatSessionFrameLiveCopy({
            ok: true,
            frameLiveLost: result.frameLiveLost,
            adopted_frame_live: result.adopted_frame_live,
          });
        onDone(successCopy, { display: 'system' });
        await gracefulShutdown(0, 'prompt_input_exit', {
          suppressResumeHint: true,
          finalMessage: successCopy,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onDone(msg, { display: 'system' });
      }
    })();
  }, [seed, isMidTurn, onDone, getTasks]);

  return (
    <Box>
      <Text dimColor>Moving to background…</Text>
    </Box>
  );
}

/**
 * Official 2.1.331 `qad` — `/background` (`local-jsx`) handler.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  if (isBgSession()) {
    logEvent('tengu_background_already_bg', {});
    onDone();
    requestBgDetach();
    return null;
  }

  if (isSessionPersistenceDisabled()) {
    onDone("Can't move to the background. This session isn't being saved, so there's nothing to resume.");
    return null;
  }

  const prompt = (args ?? '').trim();
  const messages = context.messages ?? [];
  const seed = deriveBackgroundSeed(messages, prompt);
  if (seed === null) {
    onDone('Nothing to background yet. Send a message first.');
    return null;
  }

  const getTasks = () => {
    try {
      return context.getAppState?.()?.tasks as Record<string, unknown> | undefined;
    } catch {
      return null;
    }
  };

  if (!prompt) {
    return (
      <BackgroundAndExit
        messages={messages}
        isMidTurn={getMainLoopBusy()}
        onDone={msg => onDone(msg, { display: 'system' })}
        getTasks={getTasks}
      />
    );
  }

  return <BackgroundWithPrompt seed={seed} isMidTurn={getMainLoopBusy()} onDone={onDone} getTasks={getTasks} />;
}
