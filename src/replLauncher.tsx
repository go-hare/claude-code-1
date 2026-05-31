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

export type LaunchReplResult = 'exit' | 'agents';

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
      : () => {
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
  const { startDeferredPrefetches } = await import('./main.js');
  startDeferredPrefetches();
  await root.waitUntilExit();

  if (switchToAgents) {
    return 'agents';
  }

  const { gracefulShutdown } = await import('./utils/gracefulShutdown.js');
  await gracefulShutdown(0);
  return 'exit';
}
