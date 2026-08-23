/**
 * Shared helper functions and types for plugin details views
 *
 * Used by both DiscoverPlugins and BrowseMarketplace components.
 */

import * as React from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Box, Byline, Text } from '@anthropic/ink';
import {
  compareConsentedEntryHelper,
  formatHeadersHelperPaneMismatch,
  headersHelperPaneIdentity,
  resolveShownArchiveHeadersHelper,
  type HeadersHelperPaneShown,
} from '../../utils/plugins/marketplaceHeadersHelper.js';
import type { MarketplaceSource, PluginMarketplaceEntry } from '../../utils/plugins/schemas.js';

/**
 * Represents a plugin available for installation from a marketplace
 */
export type InstallablePlugin = {
  entry: PluginMarketplaceEntry;
  marketplaceName: string;
  pluginId: string;
  isInstalled: boolean;
  /** known_marketplaces.json source — required so DNt does not strip catalog helpers. */
  marketplaceSource?: MarketplaceSource;
};

/**
 * Menu option for plugin details view
 */
export type PluginDetailsMenuOption = {
  label: string;
  action: string;
};

/**
 * Extract GitHub repo info from a plugin's source
 */
export function extractGitHubRepo(plugin: InstallablePlugin): string | null {
  const isGitHub =
    plugin.entry.source &&
    typeof plugin.entry.source === 'object' &&
    'source' in plugin.entry.source &&
    plugin.entry.source.source === 'github';

  if (isGitHub && typeof plugin.entry.source === 'object' && 'repo' in plugin.entry.source) {
    return plugin.entry.source.repo;
  }

  return null;
}

/**
 * Build menu options for plugin details view with scoped installation options
 */
export function buildPluginDetailsMenuOptions(
  hasHomepage: string | undefined,
  githubRepo: string | null,
): PluginDetailsMenuOption[] {
  const options: PluginDetailsMenuOption[] = [
    { label: 'Install for you (user scope)', action: 'install-user' },
    {
      label: 'Install for all collaborators on this repository (project scope)',
      action: 'install-project',
    },
    {
      label: 'Install for you, in this repo only (local scope)',
      action: 'install-local',
    },
  ];
  if (hasHomepage) {
    options.push({ label: 'Open homepage', action: 'homepage' });
  }
  if (githubRepo) {
    options.push({ label: 'View on GitHub', action: 'github' });
  }
  options.push({ label: 'Back to plugin list', action: 'back' });
  return options;
}

/**
 * Key hint component for plugin selection screens
 */
export function PluginSelectionKeyHint({ hasSelection }: { hasSelection: boolean }): React.ReactNode {
  return (
    <Box marginTop={1}>
      <Text dimColor italic>
        <Byline>
          {hasSelection && (
            <ConfigurableShortcutHint
              action="plugin:install"
              context="Plugin"
              fallback="i"
              description="install"
              bold
            />
          )}
          <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description="toggle" />
          <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="details" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
        </Byline>
      </Text>
    </Box>
  );
}

/**
 * SEA `dwo(Iyg)` — per-view consent ref. Clears when the shown helper
 * identity (command + archive URL) changes. Not a session-wide Map.
 */
export function useHeadersHelperPaneConsent(helper: HeadersHelperPaneShown | null | undefined): {
  record: (shown: HeadersHelperPaneShown) => void;
  pinned: () => HeadersHelperPaneShown | null;
} {
  const ref = React.useRef<HeadersHelperPaneShown | null>(null);
  const identity = headersHelperPaneIdentity(helper);
  React.useEffect(() => {
    ref.current = null;
  }, [identity]);
  return React.useMemo(
    () => ({
      record: (shown: HeadersHelperPaneShown) => {
        ref.current = shown;
      },
      pinned: () => ref.current,
    }),
    [],
  );
}

/**
 * densable 2.1.238 — show catalog headersHelper on /plugin details.
 * Recording is the parent `dwo.record` (pass `onShown`); this view does not
 * write a module-level Map.
 */
export function PluginHeadersHelperDisclosure({
  pluginId: _pluginId,
  entry,
  marketplaceName,
  marketplaceSource,
  onShown,
}: {
  pluginId: string;
  entry: PluginMarketplaceEntry;
  marketplaceName?: string;
  marketplaceSource?: MarketplaceSource;
  onShown?: (helper: HeadersHelperPaneShown) => void;
}): React.ReactNode {
  const helper = resolveShownArchiveHeadersHelper({
    entry,
    marketplaceName,
    marketplaceSource,
    catchOverlayRefusal: true,
  });
  React.useEffect(() => {
    if (!helper) return;
    onShown?.(helper);
  }, [helper?.command, helper?.archiveUrl, onShown]);

  if (!helper) return null;

  let destination = helper.archiveUrl;
  try {
    destination = new URL(helper.archiveUrl).origin;
  } catch {
    // keep raw
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>headersHelper</Text>
      <Text dimColor>
        Fetching this plugin&apos;s archive sends helper-minted headers to {destination}; the local command it runs
        (headersHelper) is:
      </Text>
      <Text>{helper.command}</Text>
    </Box>
  );
}

/**
 * Gate install/update that would run entry headersHelper against the pane snapshot.
 * Returns an error string when blocked; undefined when ok / no helper.
 *
 * SEA `qhi` is pure compare. For `kind:'update'`, a block also presents the
 * current helper on-pane (record + caller must render `presentedHelper`) so
 * the "Review the command now shown, then update again" hint is honest.
 */
export function gateHeadersHelperPaneForAction(options: {
  pluginId?: string;
  entry: PluginMarketplaceEntry;
  kind: 'install' | 'update';
  marketplaceName?: string;
  marketplaceSource?: MarketplaceSource;
  /** SEA `dwo.pinned()` snapshot at action time. */
  consented?: HeadersHelperPaneShown | null;
  /**
   * When kind is update and the gate blocks, caller MUST render the helper
   * on this pane (SEA "now shown") and `dwo.record` it.
   */
  onPresentHelper?: (helper: { command: string; archiveUrl: string }) => void;
}): string | undefined {
  const helper = resolveShownArchiveHeadersHelper({
    entry: options.entry,
    marketplaceName: options.marketplaceName,
    marketplaceSource: options.marketplaceSource,
    catchOverlayRefusal: true,
  });
  if (!helper) return undefined;
  const result = compareConsentedEntryHelper({
    consented: options.consented,
    helper,
    pluginName: options.entry.name,
    kind: options.kind,
  });
  if (result.ok) return undefined;
  if (options.kind === 'update') {
    options.onPresentHelper?.(helper);
  }
  return formatHeadersHelperPaneMismatch(result);
}
