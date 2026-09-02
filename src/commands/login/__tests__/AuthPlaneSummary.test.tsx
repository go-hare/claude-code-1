/**
 * Tests for AuthPlaneSummary.tsx
 * Uses staticRender to render Ink components to strings.
 * Covers all 4 mode combinations + long provider list + key preview masking.
 */
import { afterAll, describe, expect, test, mock } from 'bun:test';
import * as React from 'react';
import { logMock } from '../../../../tests/mocks/log';
import { debugMock } from '../../../../tests/mocks/debug';
import { restoreSettingsMockWith, snapshotModuleExports } from '../../../../tests/mocks/settings.js';

import * as realSettings from 'src/utils/settings/settings.js';
import * as realConfig from 'src/utils/config.js';

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const settingsSnap = snapshotModuleExports(realSettings);
const configSnap = snapshotModuleExports(realConfig);
const realGetGlobalConfig = configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig;

mock.module('src/utils/log.ts', logMock);
mock.module('src/utils/debug.ts', debugMock);
mock.module('bun:bundle', () => ({ feature: () => false }));
mock.module('src/utils/settings/settings.js', () => ({
  ...settingsSnap,
  getCachedOrDefaultSettings: () => ({}),
  getSettings: () => ({}),
}));
function configMock() {
  return {
    ...configSnap,
    isConfigEnabled: () => true,
    getGlobalConfig: () => ({
      ...realGetGlobalConfig(),
      workspaceApiKey: undefined,
    }),
  };
}
mock.module('src/utils/config.ts', configMock);
mock.module('src/utils/config.js', configMock);
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, ['src/utils/settings/settings.js']);
  mock.module('src/utils/config.ts', () => ({ ...configSnap }));
  mock.module('src/utils/config.js', () => ({ ...configSnap }));
});

import { renderToString } from '../../../utils/staticRender.js';
import type { AuthStatus } from '../getAuthStatus.js';

// Helper to build minimal AuthStatus fixtures
function makeStatus(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    subscription: {
      active: false,
      plan: null,
      accountEmail: null,
    },
    workspaceKey: {
      set: false,
      prefixValid: false,
      keyPreview: null,
      source: null,
    },
    profile: {
      source: null,
      label: 'inactive',
    },
    ...overrides,
  };
}

describe('AuthPlaneSummary', () => {
  test('renders subscription as inactive (☐) when not logged in', async () => {
    const { AuthPlaneSummary } = await import('../AuthPlaneSummary.js');
    const status = makeStatus();
    const out = await renderToString(<AuthPlaneSummary status={status} />);
    expect(out).toContain('Subscription');
    // Subscription inactive symbol or "not logged in" indicator
    expect(out.toLowerCase()).toMatch(/not logged in|☐/);
  });

  test('renders subscription as active (☑) with plan label when subscribed', async () => {
    const { AuthPlaneSummary } = await import('../AuthPlaneSummary.js');
    const status = makeStatus({
      subscription: { active: true, plan: 'pro', accountEmail: null },
    });
    const out = await renderToString(<AuthPlaneSummary status={status} />);
    expect(out).toContain('pro');
    // Active symbol present
    expect(out).toContain('☑');
  });

  test('renders workspace key as set+valid (☑) when prefixValid=true', async () => {
    const { AuthPlaneSummary } = await import('../AuthPlaneSummary.js');
    const status = makeStatus({
      workspaceKey: {
        set: true,
        prefixValid: true,
        keyPreview: 'sk-a...67 (48 chars)',
        source: 'env',
      },
    });
    const out = await renderToString(<AuthPlaneSummary status={status} />);
    // Key preview may be word-wrapped across lines in terminal output
    expect(out).toContain('sk-a...67');
    expect(out).toContain('☑');
  });

  test('renders workspace key warning (⚠) when set but prefix invalid', async () => {
    const { AuthPlaneSummary } = await import('../AuthPlaneSummary.js');
    const status = makeStatus({
      workspaceKey: {
        set: true,
        prefixValid: false,
        keyPreview: 'sk-w...ng (40 chars)',
        source: 'env',
      },
    });
    const out = await renderToString(<AuthPlaneSummary status={status} />);
    // Warning indicator present
    expect(out).toContain('⚠');
    expect(out.toLowerCase()).toContain('sk-ant-api03-');
  });

  test('shows workspace key 4-step setup instructions when key not set and subscription active', async () => {
    const { AuthPlaneSummary } = await import('../AuthPlaneSummary.js');
    const status = makeStatus({
      subscription: { active: true, plan: 'pro', accountEmail: null },
      workspaceKey: { set: false, prefixValid: false, keyPreview: null, source: null },
    });
    const out = await renderToString(<AuthPlaneSummary status={status} />);
    expect(out).toContain('console.anthropic.com');
  });

  // Third-party provider rendering tests removed 2026-05-06 — that section
  // was deleted from AuthPlaneSummary to defer to fork's existing /login form
  // for OpenAI-compat configuration. See AuthPlaneSummary.tsx for the rationale.
});
