import React from 'react';
import { FpsMetricsProvider } from '../context/fpsMetrics.js';
import { StatsProvider, type StatsStore } from '../context/stats.js';
import { type AppState, AppStateProvider } from '../state/AppState.js';
import { onChangeAppState } from '../state/onChangeAppState.js';
import type { FpsMetrics } from '../utils/fpsTracker.js';
import { ThemeProvider } from '@anthropic/ink';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { JFaInFlightProducer } from './JFaInFlightProducer.js';

type Props = {
  getFpsMetrics: () => FpsMetrics | undefined;
  stats?: StatsStore;
  initialState: AppState;
  children: React.ReactNode;
};

/**
 * Top-level wrapper for interactive sessions.
 * Provides FPS metrics, stats context, and app state to the component tree.
 * densable JFa mounts under AppStateProvider so todos/tasks feed shs.
 */
export function App({ getFpsMetrics, stats, initialState, children }: Props): React.ReactNode {
  return (
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
}
