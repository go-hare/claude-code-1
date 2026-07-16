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

export type LaunchReplResult =
  | { type: 'exit' }
  | {
      type: 'agents';
      /** Transcript snapshot for official Sj4 / Vy6 seed. */
      messages: BackgroundSeedMessage[];
    };

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
  let agentsMessages: BackgroundSeedMessage[] = [];
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
      : (payload?: { messages?: BackgroundSeedMessage[] }) => {
          // Official Szp: attribute left-arrow open to needs-input nudge window.
          void import('./utils/fleetNeedsInputNudge.js').then(m => {
            m.recordFleetOpenViaLeft();
          });
          agentsMessages = payload?.messages ?? [];
          // In normal mode: unmount REPL and switch to agents view
          switchToAgents = true;
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
    return { type: 'agents', messages: agentsMessages };
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
