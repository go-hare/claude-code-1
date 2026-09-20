import React, { useSyncExternalStore } from 'react';
import { wrapWithSessionServices } from '../context/sessionServices.js';
import { FpsMetricsProvider } from '../context/fpsMetrics.js';
import { StatsProvider, type StatsStore } from '../context/stats.js';
import { type AppState, AppStateProvider } from '../state/AppState.js';
import { onChangeAppState } from '../state/onChangeAppState.js';
import type { FpsMetrics } from '../utils/fpsTracker.js';
import { ThemeProvider } from '@anthropic/ink';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { getRenderVersion, subscribeRenderInvalidation } from '../utils/render/invalidateAllRenders.js';
import { getPinnedStorageV5 } from '../utils/storageV5/index.js';
import { JFaInFlightProducer } from './JFaInFlightProducer.js';

type Props = {
  getFpsMetrics: () => FpsMetrics | undefined;
  stats?: StatsStore;
  initialState: AppState;
  /** densable `Us`/`Pe` `storageV5`. Omit falls back to leftover CLI pin. */
  storageV5?: unknown;
  children: React.ReactNode;
};

/**
 * Top-level wrapper for interactive sessions.
 * Provides FPS metrics, stats context, and app state to the component tree.
 * densable JFa mounts under AppStateProvider so todos/tasks feed shs.
 *
 * densable `$vo` consumer — `/cd` bumps `ui.render`. Subscribe here (not in a
 * child bridge) so App re-renders and the interactive subtree can refresh
 * cwd-sensitive UI after relocate.
 */
export function App({
  getFpsMetrics,
  stats,
  initialState,
  storageV5 = getPinnedStorageV5(),
  children,
}: Props): React.ReactNode {
  useSyncExternalStore(
    subscribeRenderInvalidation,
    () => getRenderVersion('ui.render'),
    () => 0,
  );
  const tree = (
    <FpsMetricsProvider getFpsMetrics={getFpsMetrics}>
      <StatsProvider store={stats}>
        <AppStateProvider initialState={initialState} onChangeAppState={onChangeAppState}>
          <ThemeProvider
            initialState={getGlobalConfig().theme}
            onThemeSave={setting => saveGlobalConfig(current => ({ ...current, theme: setting }))}
          >
            <JFaInFlightProducer />
            {children}
          </ThemeProvider>
        </AppStateProvider>
      </StatsProvider>
    </FpsMetricsProvider>
  );
  // densable Us: if hr===undefined return children; else z({...ce(hr), children})
  return wrapWithSessionServices(tree, storageV5);
}
