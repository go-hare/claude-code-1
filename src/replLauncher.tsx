import React from 'react';
import type { StatsStore } from './context/stats.js';
import type { Root } from '@anthropic/ink';
import type { Props as REPLProps } from './screens/REPL.js';
import type { AppState } from './state/AppStateStore.js';
import type { FpsMetrics } from './utils/fpsTracker.js';

type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined;
  stats?: StatsStore;
  initialState: AppState;
};

import type { BackgroundSeedMessage } from './cli/bg/helpers.js';
import type { LeftArrowOpenOptions } from './cli/bg/leftArrowAgents.js';

/** Left-arrow payload from REPL → main → openAgentsViaLeftArrow (Sj4/aAf). */
export type LeftArrowAgentsHandoff = {
  /** Transcript snapshot for official Sj4 / Vy6 seed. */
  messages?: BackgroundSeedMessage[];
} & Pick<
  LeftArrowOpenOptions,
  | 'via'
  | 'partialText'
  | 'boundaryUuid'
  | 'agentsCount'
  | 'checkpoint'
  | 'sessionPermissionRules'
  | 'memoryToggledOff'
  | 'replyOnResume'
  | 'abortAfterFlush'
>;

export type LaunchReplResult =
  | { type: 'exit' }
  | ({ type: 'agents'; messages: BackgroundSeedMessage[] } & LeftArrowAgentsHandoff);

export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<LaunchReplResult> {
  const { App } = await import('./components/App.js');
  const { SentryErrorBoundary } = await import('./components/SentryErrorBoundary.js');
  const { REPL } = await import('./screens/REPL.js');

  let switchToAgents = false;
  let agentsHandoff: LeftArrowAgentsHandoff = { messages: [] };
  const onOpenAgents =
    process.env.CLAUDE_BG_BACKEND === 'daemon'
      ? () => {
          // In bg session: send detach sequence via stdout (daemon will relay to attacher)
          const DETACH_MSG_PREFIX = '\x1B_cc-detach-msg;';
          const DETACH_ST = '\x1B\\';
          const DETACH_SEQ = '\x1B_cc-daemon-detach\x1B\\';
          const msg = 'Detached — use `claude agents` to see background sessions.';
          process.stdout.write(DETACH_MSG_PREFIX + msg + DETACH_ST + DETACH_SEQ);
        }
      : (payload?: LeftArrowAgentsHandoff) => {
          // Official Szp: attribute left-arrow open to needs-input nudge window.
          void import('./utils/fleetNeedsInputNudge.js').then(m => {
            m.recordFleetOpenViaLeft();
          });
          agentsHandoff = {
            messages: payload?.messages ?? [],
            via: payload?.via,
            partialText: payload?.partialText,
            boundaryUuid: payload?.boundaryUuid,
            agentsCount: payload?.agentsCount,
            checkpoint: payload?.checkpoint,
            sessionPermissionRules: payload?.sessionPermissionRules,
            memoryToggledOff: payload?.memoryToggledOff,
            // densable aAf: replyOnResume + abortAfterFlush (query AC)
            replyOnResume: payload?.replyOnResume,
            abortAfterFlush: payload?.abortAfterFlush,
          };
          // densable left-arrow RC handoff: unmount runs useReplBridge cleanup
          // which nulls the global handle and starts host_exit teardown *before*
          // main → openAgentsViaLeftArrow. Stash the live handle and latch
          // skipArchive so (1) openAgents can still build REATTACH_* / flush and
          // (2) concurrent host_exit join does not archive the session the
          // forked worker must reattach (2.1.228 #5 / densable To/Ks).
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getReplBridgeHandle, stashLeftArrowBridgeHandle } =
              require('./bridge/replBridgeHandle.js') as typeof import('./bridge/replBridgeHandle.js');
            const bridge = getReplBridgeHandle();
            if (bridge) {
              stashLeftArrowBridgeHandle(bridge);
              void bridge.teardown({ skipArchive: true }).catch(() => {
                /* join/latch best-effort — openAgents will retry teardown */
              });
            }
          } catch {
            /* bridge module optional at this edge */
          }
          // In normal mode: hand off alt screen / raw mode so unmount does NOT
          // write EXIT_ALT_SCREEN (or drop raw on Windows). Without this, ←
          // opens AgentsView via main-buffer flash then re-enter alt — broken paint.
          // Mirrors AgentView open→attach path and official in-process left-arrow
          // remount (Lj_ unmount → setImmediate → createRoot / mountFleetView).
          switchToAgents = true;
          root.handoffAltScreen();
          if (process.platform === 'win32') {
            root.handoffRawMode();
          }
          root.unmount();
        };

  const element = (
    <SentryErrorBoundary name="RootREPLBoundary">
      <App {...appProps}>
        <REPL {...replProps} onOpenAgents={onOpenAgents} />
      </App>
    </SentryErrorBoundary>
  );

  root.render(element);

  // Start rendezvous server for bg sessions (daemon ↔ session communication)
  if (process.env.CLAUDE_BG_RENDEZVOUS_SOCK) {
    const { startRendezvousServer } = await import('./daemon/rendezvousServer.js');
    await startRendezvousServer();
  }

  const { startDeferredPrefetches } = await import('./main.js');
  startDeferredPrefetches();
  await root.waitUntilExit();

  if (switchToAgents) {
    return {
      type: 'agents',
      ...agentsHandoff,
      messages: agentsHandoff.messages ?? [],
    };
  }

  // Stop rendezvous server before shutdown
  if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg') {
    const { stopRendezvousServer } = await import('./daemon/rendezvousServer.js');
    stopRendezvousServer();
  }

  const { gracefulShutdown } = await import('./utils/gracefulShutdown.js');
  await gracefulShutdown(0);
  return { type: 'exit' };
}
