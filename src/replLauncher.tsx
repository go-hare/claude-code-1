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

/** Portable adopt checkpoint carried through left-arrow handoff. */
export type LeftArrowCheckpoint = {
  shells?: unknown[];
  cron?: Array<{
    id: string;
    cron: string;
    prompt: string;
    createdAt?: number;
    recurring?: boolean;
    agentId?: string;
    kind?: string;
  }>;
  agents?: unknown[];
  workflows?: unknown[];
};

export type LeftArrowOpenPayload = {
  messages?: BackgroundSeedMessage[];
  via?: string;
  partialText?: string | null;
  boundaryUuid?: string;
  agentsCount?: number;
  checkpoint?: LeftArrowCheckpoint;
  /** Official aAf → hcn sessionPermissionRules (session allow/deny). */
  sessionPermissionRules?: { allow: string[]; deny: string[] };
  /** Official aAf → hcn memoryToggledOff. */
  memoryToggledOff?: boolean;
};

export type LaunchReplResult =
  | { type: 'exit' }
  | {
      type: 'agents';
      /** Transcript snapshot for official Sj4 / Vy6 seed. */
      messages: BackgroundSeedMessage[];
      /**
       * Official aAf mid-turn fields for adopt.json prefill.
       * via: idle-fork | abort-then-fork
       */
      via?: string;
      partialText?: string | null;
      boundaryUuid?: string;
      agentsCount?: number;
      checkpoint?: LeftArrowCheckpoint;
      sessionPermissionRules?: { allow: string[]; deny: string[] };
      memoryToggledOff?: boolean;
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
  let agentsVia: string | undefined;
  let agentsPartialText: string | null | undefined;
  let agentsBoundaryUuid: string | undefined;
  let agentsCount: number | undefined;
  let agentsCheckpoint: LeftArrowCheckpoint | undefined;
  let agentsSessionPermissionRules:
    | { allow: string[]; deny: string[] }
    | undefined;
  let agentsMemoryToggledOff: boolean | undefined;
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
      : (payload?: LeftArrowOpenPayload) => {
          // Official Szp: attribute left-arrow open to needs-input nudge window.
          void import('./utils/fleetNeedsInputNudge.js').then(m => {
            m.recordFleetOpenViaLeft();
          });
          agentsMessages = payload?.messages ?? [];
          agentsVia = payload?.via;
          agentsPartialText = payload?.partialText;
          agentsBoundaryUuid = payload?.boundaryUuid;
          agentsCount = payload?.agentsCount;
          agentsCheckpoint = payload?.checkpoint;
          agentsSessionPermissionRules = payload?.sessionPermissionRules;
          agentsMemoryToggledOff = payload?.memoryToggledOff;
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
      messages: agentsMessages,
      via: agentsVia,
      partialText: agentsPartialText,
      boundaryUuid: agentsBoundaryUuid,
      agentsCount,
      checkpoint: agentsCheckpoint,
      sessionPermissionRules: agentsSessionPermissionRules,
      memoryToggledOff: agentsMemoryToggledOff,
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
