import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { z } from 'zod/v4';
import { Box, Text } from '@anthropic/ink';
import { AppStateProvider } from '../../../state/AppState.js';
import type { Tool } from '../../../Tool.js';
import {
  detachedToolCallEnded,
  detachedToolCallLetGo,
  detachedToolCallSetAbort,
  detachedToolCallSettled,
  detachedToolCallStarted,
  getDetachedToolCall,
  stopRunningDetachedToolCalls,
} from '../../../utils/detachedToolCallStore.js';
import {
  QueuedNowCoordinator,
  registerForegroundToolCall,
  unmovableDescendantShells,
} from '../../../utils/foregroundToolCalls.js';
import {
  setLoadedFunctionHooksModules,
  type LoadedFunctionHooksModule,
} from '../../../utils/plugins/functionHooksModules.js';
import {
  ENDED_BY_MODEL_ALLOWED_COMMANDS,
  isEndedByModelClearEscape,
  isEndedByModelCommandBlocked,
} from '../../../utils/processUserInput/processUserInput.js';
import {
  framePluginPromptSubmitText,
  promptScreenPluginsChanged,
  resolvePromptSubmitPayloadOrigin,
  snapshotPromptScreen,
} from '../../../utils/processUserInput/promptSubmit.js';
import { renderToString } from '../../../utils/staticRender.js';
import { AssistantToolUseMessage } from '../AssistantToolUseMessage.js';
import { UserTeammateMessage } from '../UserTeammateMessage.js';

const ROOT = join(import.meta.dir, '../../../..');

function makeDummyTool(name = 'WebFetch'): Tool {
  return {
    name,
    backgrounding: 'detach',
    inputSchema: z.object({ url: z.string().optional() }),
    userFacingName: () => 'Fetch',
    renderToolUseMessage: (input: { url?: string }) => input.url ?? 'https://example.com',
    renderToolResultMessage: (data: unknown) => <Text>{String(data)}</Text>,
  } as unknown as Tool;
}

describe('Shard 2 2.1.289 alignment fixes (S2-01..S2-14)', () => {
  test('S2-01 & S2-09: UserToolResultMessage freezes detached viewport state and runs ToolResult host first', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/messages/UserToolResultMessage/UserToolResultMessage.tsx'),
      'utf8',
    );
    expect(src).toContain('useTerminalViewport');
    expect(src).toContain('useViewportFrozenValue(liveEntry)');
    expect(src).toContain('ref={viewportRef}');
    // ToolResult ui.render host and cancel/reject checks must precede DetachedToolResultInPlace.
    const hostIdx = src.indexOf("component: 'ToolResult'");
    const cancelIdx = src.indexOf('param.content.startsWith(CANCEL_MESSAGE)');
    const detachIdx = src.indexOf('<DetachedToolResultInPlace');
    expect(hostIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeGreaterThan(hostIdx);
    expect(detachIdx).toBeGreaterThan(cancelIdx);
  });

  test('S2-09: detachedToolCallStore clears stale data on failed transition and stops pre-start aborts', () => {
    const session = {};
    const tool = makeDummyTool();
    detachedToolCallStarted('toolu_s209', { tool, input: { url: 'https://a.test' } }, undefined, session);
    expect(detachedToolCallSettled('toolu_s209', { status: 'completed', data: { body: 'secret' } }, session)).toBe(
      true,
    );
    expect(getDetachedToolCall('toolu_s209', session)?.data).toEqual({ body: 'secret' });

    // Post-hook failure transitions completed -> failed; stale data must not leak.
    expect(detachedToolCallSettled('toolu_s209', { status: 'failed', text: 'post hook failed' }, session)).toBe(true);
    const afterFail = getDetachedToolCall('toolu_s209', session);
    expect(afterFail?.status).toBe('failed');
    expect(afterFail?.data).toBeUndefined();
    expect(afterFail?.text).toBe('post hook failed');

    // Pre-started abort registered via letGo + setAbort must still be aborted by stopRunningDetachedToolCalls.
    let abortReason: unknown;
    detachedToolCallLetGo('toolu_prestart', session);
    detachedToolCallSetAbort(
      'toolu_prestart',
      reason => {
        abortReason = reason;
      },
      session,
    );
    expect(stopRunningDetachedToolCalls(session)).toBe(1);
    expect(abortReason).toBe('user-cancel');
    detachedToolCallEnded('toolu_prestart', session);
  });

  test('S2-02: framePluginPromptSubmitText wraps untrusted plugin prompts between turns with VLr midTurn:false', () => {
    const framed = framePluginPromptSubmitText('deploy prod', {
      kind: 'plugin',
      name: 'acme',
    });
    expect(framed).toContain('The acme plugin sent a message:\ndeploy prod');
    expect(framed).toContain("it starts this turn in the user's place");

    // asUser:true and human origins stay unwrapped.
    expect(
      framePluginPromptSubmitText('deploy prod', {
        kind: 'plugin',
        name: 'acme@repo',
        asUser: true,
      }),
    ).toBe('deploy prod');
    expect(framePluginPromptSubmitText('deploy prod', { kind: 'human' })).toBe('deploy prod');
  });

  test('S2-02, S2-03 & S2-14: processUserInput enforces plugin skipAttachments, expandedInput, [ref] mentions, and Byw allowlist', () => {
    const puiSrc = readFileSync(join(ROOT, 'src/utils/processUserInput/processUserInput.ts'), 'utf8');
    expect(puiSrc).toContain("origin?.kind === 'plugin' ? 'all' : undefined");
    expect(puiSrc).toContain('skipAttachments: effectiveSkipAttachments');
    expect(puiSrc).toContain('const submissionInput = result.expandedInput ?? input');
    expect(puiSrc).toContain('\\[[0-9a-fA-F]{6,12}\\]');

    expect(ENDED_BY_MODEL_ALLOWED_COMMANDS.has('bug')).toBe(false);
    expect(ENDED_BY_MODEL_ALLOWED_COMMANDS.has('feedback')).toBe(true);
    expect(isEndedByModelCommandBlocked({ name: 'bug', type: 'local' }, true)).toBe(true);
    // Alias /bug still escapes to feedback when command list is omitted.
    expect(isEndedByModelClearEscape('/bug')).toBe(true);
  });

  test('S2-10: snapshotPromptScreen detects plugin reload/swap and resolvePromptSubmitPayloadOrigin drops unknown kinds', () => {
    const fakeContext = {
      agentId: 'session-s210',
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
        sessionHooks: new Map(),
      }),
    } as unknown as Parameters<typeof snapshotPromptScreen>[0];

    const modA1: LoadedFunctionHooksModule = {
      name: 'plugin-a',
      patterns: ['prompt.submit'],
      hooks: [{ pattern: 'prompt.submit', callback: () => undefined } as never],
    };
    const modA2: LoadedFunctionHooksModule = {
      name: 'plugin-a',
      patterns: ['prompt.submit'],
      hooks: [{ pattern: 'prompt.submit', callback: () => undefined } as never],
    };
    const modB: LoadedFunctionHooksModule = {
      name: 'plugin-b',
      patterns: ['prompt.submit'],
      hooks: [{ pattern: 'prompt.submit', callback: () => undefined } as never],
    };

    try {
      setLoadedFunctionHooksModules([modA1]);
      const s1 = snapshotPromptScreen(fakeContext);
      expect(s1.plugins).not.toBe('');

      // Hot-reloading the same plugin (new generation) must mark plugins changed.
      setLoadedFunctionHooksModules([modA2]);
      const s2 = snapshotPromptScreen(fakeContext);
      expect(promptScreenPluginsChanged(s1, s2)).toBe(true);

      // Swapping plugin-a for plugin-b must also mark plugins changed.
      setLoadedFunctionHooksModules([modB]);
      const s3 = snapshotPromptScreen(fakeContext);
      expect(promptScreenPluginsChanged(s2, s3)).toBe(true);
    } finally {
      setLoadedFunctionHooksModules([]);
    }

    expect(resolvePromptSubmitPayloadOrigin({ origin: { kind: 'unknown_custom_kind' } })).toBeUndefined();
  });

  test('S2-04: AssistantToolUseMessage keeps running detached calls unresolved and marks failed/stopped calls errored', async () => {
    const tool = makeDummyTool();
    const lookups = {
      resolvedToolUseIDs: new Set(['toolu_det_run', 'toolu_det_fail']),
      erroredToolUseIDs: new Set<string>(),
      toolResultByToolUseID: new Map(),
      progressMessagesByToolUseID: new Map(),
      inProgressHookCounts: new Map(),
      resolvedHookCounts: new Map(),
    } as unknown as React.ComponentProps<typeof AssistantToolUseMessage>['lookups'];

    detachedToolCallStarted('toolu_det_run', {
      tool,
      input: { url: 'https://running.example' },
    });
    detachedToolCallStarted('toolu_det_fail', {
      tool,
      input: { url: 'https://failed.example' },
    });
    detachedToolCallSettled('toolu_det_fail', {
      status: 'failed',
      text: 'network timeout',
    });

    const runningOut = await renderToString(
      <Box>
        <AssistantToolUseMessage
          param={{ type: 'tool_use', id: 'toolu_det_run', name: 'WebFetch', input: { url: 'https://running.example' } }}
          addMargin={false}
          tools={[tool]}
          commands={[]}
          verbose={false}
          inProgressToolUseIDs={new Set()}
          progressMessagesForMessage={[]}
          shouldAnimate={true}
          shouldShowDot={true}
          lookups={lookups}
        />
      </Box>,
    );
    expect(runningOut).toContain('Fetch');
    expect(runningOut).toContain('https://running.example');

    const toolUseSrc = readFileSync(join(ROOT, 'src/components/messages/AssistantToolUseMessage.tsx'), 'utf8');
    expect(toolUseSrc).toContain('isResolved = lookups.resolvedToolUseIDs.has(param.id) && !isDetachedRunning');
    expect(toolUseSrc).toContain('shouldAnimate={shouldAnimate || isDetachedRunning}');
    expect(toolUseSrc).toContain('isError={lookups.erroredToolUseIDs.has(param.id) || isDetachedFailedOrStopped}');

    detachedToolCallSettled('toolu_det_run', { status: 'stopped' });
    detachedToolCallEnded('toolu_det_run');
    detachedToolCallEnded('toolu_det_fail');
  });

  test('S2-05: ToolGroup, ToolUse, TurnDuration, AssistantMessage, and InfoNotice wire conversationColumns + drawPending/minHeight', () => {
    for (const rel of [
      'src/components/messages/CollapsedReadSearchContent.tsx',
      'src/components/messages/AssistantToolUseMessage.tsx',
      'src/components/messages/SystemTextMessage.tsx',
      'src/components/messages/AssistantTextMessage.tsx',
      'src/utils/statusNoticeDefinitions.tsx',
    ]) {
      const content = readFileSync(join(ROOT, rel), 'utf8');
      expect(content).toContain('conversationColumns');
      expect(content).toContain('drawPending');
      expect(content).toContain('minHeight');
    }
    const collapsedSrc = readFileSync(join(ROOT, 'src/components/messages/CollapsedReadSearchContent.tsx'), 'utf8');
    expect(collapsedSrc).toContain('return wrapToolGroupHost(');
  });

  test('S2-07: UserTeammateMessage renders unparsed text, suppresses invisible-char terminated JSON, and caps idle results', async () => {
    const paintTeammate = (node: React.ReactElement) => renderToString(<AppStateProvider>{node}</AppStateProvider>);

    // 1. Invisible-char teammate_terminated JSON must not leak as raw chat text.
    const terminatedInvisible = `<teammate-message teammate_id="bob">{"type":"teammate_terminated","message":"\\u200B"}</teammate-message>`;
    const emptyRender = await paintTeammate(
      <UserTeammateMessage addMargin={false} param={{ type: 'text', text: terminatedInvisible }} verbose={true} />,
    );
    expect(emptyRender.trim()).toBe('');
    expect(emptyRender).not.toContain('teammate_terminated');

    // 2. Unparsed text outside/without closed tags still renders instead of disappearing.
    const unparsedRender = await paintTeammate(
      <UserTeammateMessage
        addMargin={false}
        param={{ type: 'text', text: '<teammate-message broken>fallback teammate text' }}
        verbose={true}
      />,
    );
    expect(unparsedRender).toContain('fallback teammate text');

    // 3. Embedded </teammate-message> inside message prose does not prematurely truncate.
    const nestedClose = `<teammate-message teammate_id="alice">Check literal </teammate-message> tag handling</teammate-message>`;
    const nestedOut = await paintTeammate(
      <UserTeammateMessage addMargin={false} param={{ type: 'text', text: nestedClose }} verbose={true} />,
    );
    expect(nestedOut).toContain('tag handling');

    // 4. Expanded idle_notification result > 4000 chars is truncated with Jhn notice.
    const hugeIdle = JSON.stringify({
      type: 'idle_notification',
      from: 'alice',
      timestamp: '2026-01-01T00:00:00.000Z',
      result: 'A'.repeat(4500),
    });
    const idleOut = await paintTeammate(
      <UserTeammateMessage
        addMargin={false}
        param={{ type: 'text', text: `<teammate-message teammate_id="alice">${hugeIdle}</teammate-message>` }}
        verbose={true}
      />,
    );
    expect(idleOut).toContain('result truncated');
  });

  test('S2-11: unmovableDescendantShells includes REPL shells and QueuedNowCoordinator detaches foreground calls when bg tasks are disabled', () => {
    const outstanding = new Map<string, string>([['toolu_repl_1', 'REPL']]);
    const shellTask = {
      id: 'bash_1',
      type: 'local_bash',
      status: 'running',
      shellCommand: {},
      caller: 'inner',
      toolUseId: 'inner_cmd_1',
    };
    expect(unmovableDescendantShells([shellTask], outstanding, [])).toEqual([shellTask]);

    // Even with CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1, detachable foreground calls (WebFetch/WebSearch)
    // must step aside via backgroundNow() rather than cancelling the turn.
    const prevEnv = process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS;
    process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1';
    const session = {};
    let detachedCount = 0;
    let interruptedCount = 0;
    const unregister = registerForegroundToolCall(session, {
      toolUseId: 'toolu_fetch_1',
      backgroundNow: () => {
        detachedCount += 1;
        return true;
      },
    });
    try {
      const abort = new AbortController();
      const queueRow = {
        uuid: 'cmd-now-1',
        agentId: 'main-test',
        mode: 'prompt',
        priority: 'next',
        origin: { kind: 'human' },
      };
      const pendingTimers: Array<() => void> = [];
      const coord = new QueuedNowCoordinator({
        turn: {
          agentId: 'main-test',
          guard: {
            isActive: true,
            isRunning: true,
            subscribe: () => () => {},
          },
          abortController: abort,
          readEvidence: () => ({
            isHeldByDialog: false,
            isToolCallStarting: false,
            isCompacting: false,
            isMainRequestAnnounced: false,
          }),
          interruptForSubmit: () => {
            interruptedCount += 1;
            return true;
          },
          endsUnmovableShells: true,
        },
        messageQueue: {
          getCommandQueueSnapshot: () => [queueRow],
          getCommandQueue: () => [queueRow],
          subscribe: () => () => {},
          isFoldInFlight: () => false,
          isMidTurnFoldSuspended: () => false,
          promoteToNow: () => true,
          demoteFromNow: () => {},
        },
        transcript: {
          getSnapshot: () => [
            {
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'toolu_fetch_1', name: 'WebFetch', input: {} }],
                stop_reason: 'tool_use',
              },
            },
          ],
        },
        session,
        taskRegistry: {
          all: () => ({}),
          get: () => undefined,
          getTranscript: () => undefined,
        } as never,
        clock: {
          setTimeout: fn => {
            pendingTimers.push(fn);
            return () => {};
          },
        },
        featureName: 'test_low_latency',
      });
      expect(coord.sendQueuedNow()).toBe(true);
      pendingTimers.shift()?.();
      expect(detachedCount).toBe(1);
      expect(interruptedCount).toBe(0);
      coord.dispose();
    } finally {
      unregister();
      if (prevEnv === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS;
      } else {
        process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = prevEnv;
      }
    }
  });
});
