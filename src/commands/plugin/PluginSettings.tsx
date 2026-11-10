import figures from 'figures';
import * as React from 'react';
import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { type Command, getCommands, type LocalJSXCommandContext } from '../../commands.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { getBootstrapSession } from '../../utils/sessionRoot.js';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline, Pane, StatusIcon, Tab, Tabs } from '@anthropic/ink';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '@anthropic/ink';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { PluginError, PluginWarning } from '../../types/plugin.js';
import { uniq } from '../../utils/array.js';
import { errorMessage } from '../../utils/errors.js';
import { getMainLoopModel } from '../../utils/model/model.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { re } from '../../utils/plugins/escapeSafeText.js';
import { getLoadedFunctionHooksModules } from '../../utils/plugins/functionHooksModules.js';
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js';
import { loadMarketplacesWithGracefulDegradation } from '../../utils/plugins/marketplaceHelpers.js';
import { loadKnownMarketplacesConfig, removeMarketplaceSource } from '../../utils/plugins/marketplaceManager.js';
import { useSessionServices } from '../../context/sessionServices.js';
import { getPluginEditableScopes } from '../../utils/plugins/pluginStartupCheck.js';
import type { EditableSettingSource } from '../../utils/settings/constants.js';
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { plural } from '../../utils/stringUtils.js';
import {
  type DisusedPlugin,
  type SkillDoctorRow,
  type SkillDoctorScan,
  SkillDoctorStageError,
  scanSkillDoctor,
  skillDoctorTranscriptScanAllowed,
} from '../skill-doctor/scan.js';
import { logError } from '../../utils/log.js';
import { AddMarketplace } from './AddMarketplace.js';
import { BrowseMarketplace } from './BrowseMarketplace.js';
import { DiscoverPlugins } from './DiscoverPlugins.js';
import { ManageMarketplaces } from './ManageMarketplaces.js';
import { ManagePlugins } from './ManagePlugins.js';
import { formatErrorMessage, getErrorGuidance } from './PluginErrors.js';
import { type ParsedCommand, parsePluginArgs } from './parseArgs.js';
import type { PluginSettingsProps, ViewState } from './types.js';
import { PluginEval } from './PluginEval.js';
import { ValidatePlugin } from './ValidatePlugin.js';

type TabId = 'discover' | 'installed' | 'marketplaces' | 'errors' | 'stats';

/** densable `_l` — queued reload toast when the main query is still running. */
export const PLUGIN_MENU_DEFERRED_RELOAD_MESSAGE =
  'Plugin changes apply when the current response finishes (/reload-plugins is queued).';

function isMainQueryRunning(): boolean {
  return getBootstrapSession().surfaceCapabilities.mainLoopBusy();
}

/**
 * densable `Ll` — auto-reload on `/plugin` close when Layer-2 changed.
 * Keep `/reload-plugins`; do not invent a second eval runner.
 */
export function pluginMenuCloseReloadOutcome(
  needsRefresh: boolean,
  queryRunning: boolean = isMainQueryRunning(),
): 'none' | 'deferred' | 'queued' {
  if (!needsRefresh) return 'none';
  const outcome = queryRunning ? 'deferred' : 'queued';
  logEvent('tengu_plugin_menu_auto_reload', {
    outcome: outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  return outcome;
}

function MarketplaceList({ onComplete }: { onComplete: (result?: string) => void }): React.ReactNode {
  useEffect(() => {
    async function loadList() {
      try {
        const config = await loadKnownMarketplacesConfig();
        const names = Object.keys(config);

        if (names.length === 0) {
          onComplete('No marketplaces configured');
        } else {
          onComplete(`Configured marketplaces:\n${names.map(n => `  • ${n}`).join('\n')}`);
        }
      } catch (err) {
        onComplete(`Error loading marketplaces: ${errorMessage(err)}`);
      }
    }

    void loadList();
  }, [onComplete]);

  return <Text>Loading marketplaces...</Text>;
}

function PluginList({
  onComplete,
  filter,
}: {
  onComplete: (result?: string) => void;
  filter?: 'enabled' | 'disabled';
}): React.ReactNode {
  const errors = useAppState(s => s.plugins.errors);
  const enabled = useAppState(s => s.plugins.enabled);
  const disabled = useAppState(s => s.plugins.disabled);

  useEffect(() => {
    const registry = loadInstalledPluginsV2();
    const ids = Object.keys(registry.plugins).sort();
    if (ids.length === 0) {
      onComplete('No plugins installed. Use `/plugin install` to install a plugin.');
      return;
    }
    const editableScopes = getPluginEditableScopes();
    const loadedEnabledSources = new Set(enabled.map(p => p.source));
    const lines = ['Installed plugins:'];
    let shown = 0;
    for (const pluginId of ids) {
      const pluginName = pluginId.split('@')[0] ?? pluginId;
      const isEnabled = editableScopes.has(pluginId);
      if (filter !== undefined && (filter === 'enabled') !== isEnabled) {
        continue;
      }
      const hasError = errors.some(
        err =>
          !isAdvisoryPluginError(err) && (err.source === pluginId || ('plugin' in err && err.plugin === pluginName)),
      );
      const status = hasError
        ? `${figures.cross} failed to load`
        : isEnabled
          ? `${figures.tick} enabled`
          : `${figures.cross} disabled`;
      const reloadHint =
        !hasError && isEnabled !== loadedEnabledSources.has(pluginId) ? ' — run /reload-plugins to apply' : '';
      const loadedVersion = (enabled.find(p => p.source === pluginId) ?? disabled.find(p => p.source === pluginId))
        ?.manifest.version;
      for (const install of registry.plugins[pluginId] ?? []) {
        const ver = install.version || loadedVersion;
        const meta = ver ? `${ver}, ${install.scope}` : install.scope;
        lines.push(`  • ${pluginId} (${meta}) ${status}${reloadHint}`);
        shown++;
      }
    }
    if (shown === 0) {
      onComplete(`No ${filter} plugins.`);
      return;
    }
    onComplete(lines.join('\n'));
  }, [onComplete, errors, enabled, disabled, filter]);

  return <Text>Loading plugins...</Text>;
}

function ActiveModsBanner({ names }: { names: string[] }): React.ReactNode {
  return (
    <Box marginTop={1}>
      <Text dimColor wrap="truncate-end">
        <Byline>
          <Text>
            {names.length} {plural(names.length, 'mod')} active
          </Text>
          <Text>{names.map(n => re(n)).join(', ')}</Text>
        </Byline>
      </Text>
    </Box>
  );
}

function SkillsRedirectBanner(): React.ReactNode {
  return (
    <Box marginTop={1}>
      <StatusIcon status="info" withSpace />
      <Text>Skills are now managed here under the Skills section.</Text>
    </Box>
  );
}

function SkillDoctorRedirectBanner(): React.ReactNode {
  return (
    <Box marginTop={1}>
      <StatusIcon status="info" withSpace />
      <Text>/skill-doctor moved — skill usage and context costs now live in this Stats tab.</Text>
    </Box>
  );
}

type ErrorRowAction =
  | { kind: 'navigate'; tab: TabId; viewState: ViewState }
  | {
      kind: 'remove-extra-marketplace';
      name: string;
      sources: Array<{ source: EditableSettingSource; scope: string }>;
    }
  | { kind: 'remove-installed-marketplace'; name: string }
  | { kind: 'managed-only'; name: string }
  | { kind: 'none' };

type ErrorRow = {
  label: string;
  message: string;
  guidance?: string | null;
  action: ErrorRowAction;
  scope?: string;
  isAdvisory?: boolean;
};

function isAdvisoryPluginError(error: PluginError): boolean {
  return error.type === 'mcp-server-suppressed-duplicate' || error.type === 'synced-plugin-shadowed';
}

/**
 * Determine which settings sources define an extraKnownMarketplace entry.
 * Returns the editable sources (user/project/local) and whether policy also has it.
 */
function getExtraMarketplaceSourceInfo(name: string): {
  editableSources: Array<{ source: EditableSettingSource; scope: string }>;
  isInPolicy: boolean;
} {
  const editableSources: Array<{
    source: EditableSettingSource;
    scope: string;
  }> = [];

  const sourcesToCheck = [
    { source: 'userSettings' as const, scope: 'user' },
    { source: 'projectSettings' as const, scope: 'project' },
    { source: 'localSettings' as const, scope: 'local' },
  ];

  for (const { source, scope } of sourcesToCheck) {
    const settings = getSettingsForSource(source);
    if (settings?.extraKnownMarketplaces?.[name]) {
      editableSources.push({ source, scope });
    }
  }

  const policySettings = getSettingsForSource('policySettings');
  const isInPolicy = Boolean(policySettings?.extraKnownMarketplaces?.[name]);

  return { editableSources, isInPolicy };
}

function buildMarketplaceAction(name: string): ErrorRowAction {
  const { editableSources, isInPolicy } = getExtraMarketplaceSourceInfo(name);

  if (editableSources.length > 0) {
    return {
      kind: 'remove-extra-marketplace',
      name,
      sources: editableSources,
    };
  }

  if (isInPolicy) {
    return { kind: 'managed-only', name };
  }

  // Marketplace is in known_marketplaces.json but not in extraKnownMarketplaces
  // (e.g. previously installed manually) — route to ManageMarketplaces
  return {
    kind: 'navigate',
    tab: 'marketplaces',
    viewState: {
      type: 'manage-marketplaces',
      targetMarketplace: name,
      action: 'remove',
    },
  };
}

function buildPluginAction(pluginName: string): ErrorRowAction {
  return {
    kind: 'navigate',
    tab: 'installed',
    viewState: {
      type: 'manage-plugins',
      targetPlugin: pluginName,
      action: 'uninstall',
    },
  };
}

const TRANSIENT_ERROR_TYPES = new Set(['git-auth-failed', 'git-timeout', 'network-error']);

export function isTransientError(error: PluginError): boolean {
  if (TRANSIENT_ERROR_TYPES.has(error.type)) return true;
  if (error.type === 'marketplace-load-failed' && error.reason === 'cache-miss') return true;
  if (error.type === 'marketplace-not-found') return true;
  return false;
}

/**
 * Extract the plugin name from a PluginError, checking explicit fields first,
 * then falling back to the source field (format: "pluginName@marketplace").
 */
function getPluginNameFromError(error: PluginError): string | undefined {
  if ('pluginId' in error && error.pluginId) return error.pluginId;
  if ('plugin' in error && error.plugin) return error.plugin;
  // Fallback: source often contains "pluginName@marketplace"
  if (error.source.includes('@')) return error.source.split('@')[0];
  return undefined;
}

function buildErrorRows(
  failedMarketplaces: Array<{ name: string; error?: string }>,
  extraMarketplaceErrors: PluginError[],
  pluginLoadingErrors: PluginError[],
  otherErrors: PluginError[],
  brokenInstalledMarketplaces: Array<{ name: string; error: string }>,
  transientErrors: PluginError[],
  pluginScopes: Map<string, string>,
): ErrorRow[] {
  const rows: ErrorRow[] = [];

  // --- Transient errors at the top (restart to retry) ---
  for (const error of transientErrors) {
    const pluginName = 'pluginId' in error ? error.pluginId : 'plugin' in error ? error.plugin : undefined;
    rows.push({
      label: pluginName ?? error.source,
      message: formatErrorMessage(error),
      guidance: getErrorGuidance(error) ?? 'Restart to retry loading plugins',
      action: { kind: 'none' },
    });
  }

  // --- Marketplace errors ---
  // Track shown marketplace names to avoid duplicates across sources
  const shownMarketplaceNames = new Set<string>();

  for (const m of failedMarketplaces) {
    shownMarketplaceNames.add(m.name);
    const action = buildMarketplaceAction(m.name);
    const sourceInfo = getExtraMarketplaceSourceInfo(m.name);
    const scope = sourceInfo.isInPolicy ? 'managed' : sourceInfo.editableSources[0]?.scope;
    rows.push({
      label: m.name,
      message: m.error ?? 'Installation failed',
      guidance: action.kind === 'managed-only' ? 'Managed by your organization — contact your admin' : undefined,
      action,
      scope,
    });
  }

  for (const e of extraMarketplaceErrors) {
    const marketplace = 'marketplace' in e ? e.marketplace : e.source;
    if (shownMarketplaceNames.has(marketplace)) continue;
    shownMarketplaceNames.add(marketplace);
    const action = buildMarketplaceAction(marketplace);
    const sourceInfo = getExtraMarketplaceSourceInfo(marketplace);
    const scope = sourceInfo.isInPolicy ? 'managed' : sourceInfo.editableSources[0]?.scope;
    rows.push({
      label: marketplace,
      message: formatErrorMessage(e),
      guidance:
        action.kind === 'managed-only' ? 'Managed by your organization — contact your admin' : getErrorGuidance(e),
      action,
      scope,
    });
  }

  // Installed marketplaces that fail to load data (from known_marketplaces.json)
  for (const m of brokenInstalledMarketplaces) {
    if (shownMarketplaceNames.has(m.name)) continue;
    shownMarketplaceNames.add(m.name);
    rows.push({
      label: m.name,
      message: m.error,
      action: { kind: 'remove-installed-marketplace', name: m.name },
    });
  }

  // --- Plugin errors ---
  const shownPluginNames = new Set<string>();
  for (const error of pluginLoadingErrors) {
    const pluginName = getPluginNameFromError(error);
    if (pluginName && shownPluginNames.has(pluginName)) continue;
    if (pluginName) shownPluginNames.add(pluginName);

    const marketplace = 'marketplace' in error ? error.marketplace : undefined;
    // Try pluginId@marketplace format first, then just pluginName
    const scope = pluginName ? (pluginScopes.get(error.source) ?? pluginScopes.get(pluginName)) : undefined;
    const advisory = isAdvisoryPluginError(error);
    rows.push({
      label: pluginName ? (marketplace ? `${pluginName} @ ${marketplace}` : pluginName) : error.source,
      message: formatErrorMessage(error),
      guidance: getErrorGuidance(error),
      action: pluginName && !advisory ? buildPluginAction(pluginName) : { kind: 'none' },
      scope,
      isAdvisory: advisory || undefined,
    });
  }

  // --- Other errors (non-marketplace, non-plugin-specific) ---
  for (const error of otherErrors) {
    const advisory = isAdvisoryPluginError(error);
    rows.push({
      label: error.source,
      message: formatErrorMessage(error),
      guidance: getErrorGuidance(error),
      action: { kind: 'none' },
      isAdvisory: advisory || undefined,
    });
  }

  return rows;
}

/**
 * Remove a marketplace from extraKnownMarketplaces in the given settings sources,
 * and also remove any associated enabled plugins.
 */
function removeExtraMarketplace(name: string, sources: Array<{ source: EditableSettingSource }>): void {
  for (const { source } of sources) {
    const settings = getSettingsForSource(source);
    if (!settings) continue;

    const updates: Record<string, unknown> = {};

    // Remove from extraKnownMarketplaces
    if (settings.extraKnownMarketplaces?.[name]) {
      updates.extraKnownMarketplaces = {
        ...settings.extraKnownMarketplaces,
        [name]: undefined,
      };
    }

    // Remove associated enabled plugins (format: "plugin@marketplace")
    if (settings.enabledPlugins) {
      const suffix = `@${name}`;
      let removedPlugins = false;
      const updatedPlugins = { ...settings.enabledPlugins };
      for (const pluginId in updatedPlugins) {
        if (pluginId.endsWith(suffix)) {
          updatedPlugins[pluginId] = undefined;
          removedPlugins = true;
        }
      }
      if (removedPlugins) {
        updates.enabledPlugins = updatedPlugins;
      }
    }

    if (Object.keys(updates).length > 0) {
      updateSettingsForSource(source, updates);
    }
  }
}

function ErrorsTabContent({
  setViewState,
  setActiveTab,
  markPluginsChanged,
}: {
  setViewState: (state: ViewState) => void;
  setActiveTab: (tab: TabId) => void;
  markPluginsChanged: () => void;
}): React.ReactNode {
  const { storageV5, credentials } = useSessionServices();
  const errors = useAppState(s => s.plugins.errors);
  const warnings = useAppState(s => (s.plugins as { warnings?: PluginWarning[] }).warnings);
  const installationStatus = useAppState(s => s.plugins.installationStatus);
  const setAppState = useSetAppState();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [marketplaceLoadFailures, setMarketplaceLoadFailures] = useState<Array<{ name: string; error: string }>>([]);

  // Detect marketplaces that are installed but fail to load their data
  useEffect(() => {
    void (async () => {
      try {
        const config = await loadKnownMarketplacesConfig();
        const { failures } = await loadMarketplacesWithGracefulDegradation(config);
        setMarketplaceLoadFailures(failures);
      } catch {
        // Ignore — if we can't load config, other tabs handle it
      }
    })();
  }, []);

  const failedMarketplaces = installationStatus.marketplaces.filter(m => m.status === 'failed');
  const failedMarketplaceNames = new Set(failedMarketplaces.map(m => m.name));

  // Transient errors (git/network) — show at top with "restart to retry"
  const transientErrors = errors.filter(isTransientError);

  // Marketplace-related loading errors not already covered by install failures or transient errors
  const extraMarketplaceErrors = errors.filter(
    e =>
      !isTransientError(e) &&
      (e.type === 'marketplace-not-found' ||
        e.type === 'marketplace-load-failed' ||
        e.type === 'marketplace-blocked-by-policy') &&
      !failedMarketplaceNames.has(e.marketplace),
  );

  // Plugin-specific loading errors
  const pluginLoadingErrors = errors.filter(e => {
    if (isTransientError(e)) return false;
    if (
      e.type === 'marketplace-not-found' ||
      e.type === 'marketplace-load-failed' ||
      e.type === 'marketplace-blocked-by-policy'
    ) {
      return false;
    }
    return getPluginNameFromError(e) !== undefined;
  });

  // Remaining errors with no plugin association
  const otherErrors = errors.filter(e => {
    if (isTransientError(e)) return false;
    if (
      e.type === 'marketplace-not-found' ||
      e.type === 'marketplace-load-failed' ||
      e.type === 'marketplace-blocked-by-policy'
    ) {
      return false;
    }
    return getPluginNameFromError(e) === undefined;
  });

  const pluginScopes = getPluginEditableScopes();
  const baseRows = buildErrorRows(
    failedMarketplaces,
    extraMarketplaceErrors,
    pluginLoadingErrors,
    otherErrors,
    marketplaceLoadFailures,
    transientErrors,
    pluginScopes,
  );
  const warningRows: ErrorRow[] = (warnings ?? []).map(w => {
    const targetPlugin = w.plugin ?? (w.source?.includes('@') ? w.source.split('@')[0] : w.source);
    return {
      label: w.plugin ?? w.source ?? w.type,
      message: w.warning ?? `Advisory warning: ${w.type}`,
      action:
        w.type === 'mcpb-needs-config' && targetPlugin
          ? {
              kind: 'navigate',
              tab: 'installed',
              viewState: {
                type: 'manage-plugins',
                targetPlugin,
              },
            }
          : { kind: 'none' },
      scope: (w.plugin ? pluginScopes.get(w.plugin) : undefined) ?? (w.source ? pluginScopes.get(w.source) : undefined),
      isAdvisory: true,
    };
  });
  const rows = [...baseRows, ...warningRows];

  // Handle escape to exit the plugin menu
  useKeybinding(
    'confirm:no',
    () => {
      setViewState({ type: 'menu' });
    },
    { context: 'Confirmation' },
  );

  const handleSelect = () => {
    const row = rows[selectedIndex];
    if (!row) return;
    const { action } = row;
    switch (action.kind) {
      case 'navigate':
        setActiveTab(action.tab);
        setViewState(action.viewState);
        break;
      case 'remove-extra-marketplace': {
        const scopes = action.sources.map(s => s.scope).join(', ');
        removeExtraMarketplace(action.name, action.sources);
        clearAllCaches();
        // Synchronously clear all stale state for this marketplace so the UI
        // updates glitch-free. markPluginsChanged only sets needsRefresh —
        // it does not refresh plugins.errors, so this is the authoritative
        // cleanup until the user runs /reload-plugins.
        setAppState(prev => ({
          ...prev,
          plugins: {
            ...prev.plugins,
            errors: prev.plugins.errors.filter(e => !('marketplace' in e && e.marketplace === action.name)),
            installationStatus: {
              ...prev.plugins.installationStatus,
              marketplaces: prev.plugins.installationStatus.marketplaces.filter(m => m.name !== action.name),
            },
          },
        }));
        setActionMessage(`${figures.tick} Removed "${action.name}" from ${scopes} settings`);
        markPluginsChanged();
        break;
      }
      case 'remove-installed-marketplace': {
        void (async () => {
          try {
            await removeMarketplaceSource(action.name, undefined, storageV5, credentials);
            clearAllCaches();
            setMarketplaceLoadFailures(prev => prev.filter(f => f.name !== action.name));
            setActionMessage(`${figures.tick} Removed marketplace "${action.name}"`);
            markPluginsChanged();
          } catch (err) {
            setActionMessage(`Failed to remove "${action.name}": ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
        break;
      }
      case 'managed-only':
        // No action available — guidance text already shown
        break;
      case 'none':
        break;
    }
  };

  useKeybindings(
    {
      'select:previous': () => setSelectedIndex(prev => Math.max(0, prev - 1)),
      'select:next': () => setSelectedIndex(prev => Math.min(rows.length - 1, prev + 1)),
      'select:accept': handleSelect,
    },
    { context: 'Select', isActive: rows.length > 0 },
  );

  // Clamp selectedIndex when rows shrink (e.g. after removal)
  const clampedIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1));
  if (clampedIndex !== selectedIndex) {
    setSelectedIndex(clampedIndex);
  }

  const selectedAction = rows[clampedIndex]?.action;
  const hasAction = selectedAction && selectedAction.kind !== 'none' && selectedAction.kind !== 'managed-only';

  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        <Box marginLeft={1}>
          <Text dimColor>No plugin errors</Text>
        </Box>
        {actionMessage && (
          <Box marginTop={1} marginLeft={1}>
            <Text color="claude">{actionMessage}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor italic>
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, idx) => {
        const isSelected = idx === clampedIndex;
        const tone = row.isAdvisory ? 'warning' : 'error';
        const icon = isSelected ? figures.pointer : row.isAdvisory ? figures.triangleUpOutline : figures.cross;
        return (
          <Box key={idx} marginLeft={1} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={isSelected ? 'suggestion' : tone}>{icon} </Text>
              <Text bold={isSelected}>{row.label}</Text>
              {row.scope && <Text dimColor> ({row.scope})</Text>}
            </Text>
            <Box marginLeft={3}>
              <Text color={tone}>{row.message}</Text>
            </Box>
            {row.guidance && (
              <Box marginLeft={3}>
                <Text dimColor italic>
                  {row.guidance}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {actionMessage && (
        <Box marginTop={1} marginLeft={1}>
          <Text color="claude">{actionMessage}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor italic>
          <Byline>
            <ConfigurableShortcutHint action="select:previous" context="Select" fallback="↑" description="navigate" />
            {hasAction && (
              <ConfigurableShortcutHint
                action="select:accept"
                context="Select"
                fallback="Enter"
                description="resolve"
              />
            )}
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
          </Byline>
        </Text>
      </Box>
    </Box>
  );
}

type PluginStatsReportResult = { ok: true; report: SkillDoctorScan } | { ok: false; message: string };

function padRight(value: string, width: number): string {
  return value.padEnd(width);
}

function padLeft(value: string, width: number): string {
  return value.padStart(width);
}

function SkillUsageTable({ rows }: { rows: SkillDoctorRow[] }): React.ReactNode {
  if (rows.length === 0) {
    return <Text dimColor>{'  '}(no skills loaded)</Text>;
  }

  const cells = rows.map(r => ({
    context: r.listingTokens === null ? '—' : String(r.listingTokens),
    week: r.weekTokens === null ? '—' : String(r.weekTokens),
    lastUsed: r.daysSinceUse === null ? 'never' : r.daysSinceUse === 0 ? 'today' : `${r.daysSinceUse}d`,
  }));

  const widths = {
    name: Math.max(5, ...rows.map(r => r.name.length)),
    source: Math.max(6, ...rows.map(r => r.source.length)),
    context: Math.max(7, ...cells.map(c => c.context.length)),
    week: Math.max(9, ...cells.map(c => c.week.length)),
    uses: Math.max(4, ...rows.map(r => String(r.usageCount).length)),
  };

  const headerLine = `  ${padRight('skill', widths.name)}  ${padRight('source', widths.source)}  ${padLeft('context', widths.context)}  ${padLeft('7d tokens', widths.week)}  ${padLeft('uses', widths.uses + 1)}  last used`;

  return (
    <Box flexDirection="column">
      <Text dimColor>{headerLine}</Text>
      {rows.map((row, idx) => {
        const cell = cells[idx]!;
        return (
          <Text key={`${idx}:${row.name}`} color={row.usageCount === 0 ? 'warning' : undefined}>
            {`  ${padRight(row.name, widths.name)}  `}
            <Text dimColor>{padRight(row.source, widths.source)}</Text>
            {`  ${padLeft(cell.context, widths.context)}  ${padLeft(cell.week, widths.week)}  ${padLeft(String(row.usageCount), widths.uses)}×  ${cell.lastUsed}`}
          </Text>
        );
      })}
    </Box>
  );
}

function UnusedSkillsCallouts({
  rows,
  unusedOwned,
  unusedSynced,
  unusedFromPlugins,
  unusedFromMcp,
  unusedMcpServers,
}: {
  rows: SkillDoctorRow[];
  unusedOwned: SkillDoctorRow[];
  unusedSynced: SkillDoctorRow[];
  unusedFromPlugins: SkillDoctorRow[];
  unusedFromMcp: SkillDoctorRow[];
  unusedMcpServers: string[];
}): React.ReactNode {
  if (rows.length === 0) {
    return null;
  }

  const pluginSources = uniq(unusedFromPlugins.map(r => r.source));
  const mcpFromSuffix = unusedMcpServers.length > 0 ? `, from ${unusedMcpServers.join(', ')}` : '';
  const singleMcpServer = unusedMcpServers.length <= 1;

  return (
    <Box flexDirection="column" marginTop={1}>
      {unusedOwned.length > 0 && (
        <Text color="warning" wrap="wrap">
          {`${unusedOwned.length} ${plural(unusedOwned.length, 'skill')} loaded but never invoked. Each one adds to the system prompt every turn. Disable in /skills, or remove from .claude/skills.`}
        </Text>
      )}
      {unusedSynced.length > 0 && (
        <Text color="warning" wrap="wrap">
          {`${unusedSynced.length} ${plural(unusedSynced.length, 'skill')} synced from claude.ai loaded but never invoked. Each one adds to the system prompt every turn. Disable in /skills, or turn ${unusedSynced.length === 1 ? 'it' : 'them'} off on claude.ai — a deleted synced copy is re-downloaded on the next sync.`}
        </Text>
      )}
      {unusedFromPlugins.length > 0 && (
        <Text color="warning" wrap="wrap">
          {`${unusedFromPlugins.length} plugin ${plural(unusedFromPlugins.length, 'skill')} loaded but never invoked, from ${pluginSources.join(', ')}. Each one adds to the system prompt every turn. Plugin skills can't be turned off individually — disable ${pluginSources.length === 1 ? 'the plugin' : 'those plugins'} in the Installed tab.`}
        </Text>
      )}
      {unusedFromMcp.length > 0 && (
        <Text color="warning" wrap="wrap">
          {`${unusedFromMcp.length} MCP ${plural(unusedFromMcp.length, 'skill')} loaded but never invoked${mcpFromSuffix}. Each one adds to the system prompt every turn. MCP skills live on the server, not on disk — turning ${singleMcpServer ? 'that server' : 'those servers'} off in /mcp also removes ${singleMcpServer ? 'its' : 'their'} tools.`}
        </Text>
      )}
      {rows.every(r => r.usageCount > 0) && (
        <Text color="success">All loaded skills have been used at least once.</Text>
      )}
    </Box>
  );
}

function DisusedPluginsSection({ disusedPlugins }: { disusedPlugins: DisusedPlugin[] }): React.ReactNode {
  if (disusedPlugins.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Plugins not used recently</Text>
      <Box flexDirection="column" marginTop={1}>
        {disusedPlugins.map(p => (
          <Text key={p.pluginId}>
            {'  '}
            <Text color="warning">{re(p.name)}</Text>
            <Text dimColor>{`  last used ${p.daysSinceLastUse} days ago`}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'  '}Manage these in the Installed tab</Text>
      </Box>
    </Box>
  );
}

function PluginStatsResolved({ reportPromise }: { reportPromise: Promise<PluginStatsReportResult> }): React.ReactNode {
  const result = use(reportPromise);
  if (!result.ok) {
    return (
      <Text dimColor wrap="wrap">
        Couldn&apos;t compute skill usage. Run with --debug for details. ({result.message})
      </Text>
    );
  }

  const {
    rows,
    unusedOwned,
    unusedFromPlugins,
    unusedFromMcp,
    unusedSynced,
    unusedMcpServers,
    disusedPlugins,
    weekTokensNote,
  } = result.report;

  return (
    <Box flexDirection="column">
      <Text bold>Skills loaded this session</Text>
      <Box flexDirection="column" marginTop={1}>
        <SkillUsageTable rows={rows} />
      </Box>
      {rows.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor wrap="wrap">
            {'  '}context = this skill&apos;s one-line listing in the system prompt, included every turn
          </Text>
          <Text dimColor wrap="wrap">
            {'  '}(dash = not in the current listing, costs nothing; full SKILL.md loads only when it runs)
          </Text>
          <Text dimColor wrap="wrap">
            {'  '}
            {weekTokensNote === null
              ? '7d tokens = tokens attributed to the skill over the last 7 days of sessions on this machine'
              : `7d tokens: ${weekTokensNote}`}
          </Text>
        </Box>
      )}
      <UnusedSkillsCallouts
        rows={rows}
        unusedOwned={unusedOwned}
        unusedSynced={unusedSynced}
        unusedFromPlugins={unusedFromPlugins}
        unusedFromMcp={unusedFromMcp}
        unusedMcpServers={unusedMcpServers}
      />
      <DisusedPluginsSection disusedPlugins={disusedPlugins} />
    </Box>
  );
}

function StatsTabContent({
  getReport,
  onExit,
}: {
  getReport: () => Promise<PluginStatsReportResult>;
  onExit: () => void;
}): React.ReactNode {
  const [reportPromise] = useState(getReport);
  const [scanGate] = useState(skillDoctorTranscriptScanAllowed);

  useKeybinding('confirm:no', onExit, { context: 'Confirmation' });

  const fallback = (
    <Box flexDirection="column">
      <Text bold>Skills loaded this session</Text>
      <Box marginTop={1}>
        <Text dimColor>{scanGate.allowed ? 'Scanning local sessions…' : 'Computing skill usage…'}</Text>
      </Box>
    </Box>
  );

  return (
    <Suspense fallback={fallback}>
      <PluginStatsResolved reportPromise={reportPromise} />
    </Suspense>
  );
}

function getInitialViewState(parsedCommand: ParsedCommand): ViewState {
  switch (parsedCommand.type) {
    case 'help':
      return { type: 'help' };
    case 'validate':
      return { type: 'validate', path: parsedCommand.path };
    case 'eval':
      return { type: 'eval', path: parsedCommand.path };
    case 'install':
      if (parsedCommand.marketplace) {
        return {
          type: 'browse-marketplace',
          targetMarketplace: parsedCommand.marketplace,
          targetPlugin: parsedCommand.plugin,
        };
      }
      if (parsedCommand.plugin) {
        return {
          type: 'discover-plugins',
          targetPlugin: parsedCommand.plugin,
        };
      }
      return { type: 'discover-plugins' };
    case 'usage-error':
      return { type: 'menu' };
    case 'install-from-source':
      return {
        type: 'add-marketplace',
        initialValue: parsedCommand.marketplaceSource,
      };
    case 'manage':
      return { type: 'manage-plugins' };
    case 'stats':
      return { type: 'stats' };
    case 'directory':
      return {
        type: 'discover-plugins',
        marketplace: 'claude-plugin-directory',
        searchQuery: parsedCommand.query,
      };
    case 'list':
      return {
        type: 'plugin-list',
        filter: parsedCommand.filter,
      };
    case 'tag':
      return {
        type: 'tag',
        path: parsedCommand.path,
        push: parsedCommand.push,
        dryRun: parsedCommand.dryRun,
        force: parsedCommand.force,
        unknownFlag: parsedCommand.unknownFlag,
      };
    case 'uninstall':
      return {
        type: 'manage-plugins',
        targetPlugin: parsedCommand.plugin,
        action: 'uninstall',
      };
    case 'enable':
      return {
        type: 'manage-plugins',
        targetPlugin: parsedCommand.plugin,
        action: 'enable',
      };
    case 'disable':
      return {
        type: 'manage-plugins',
        targetPlugin: parsedCommand.plugin,
        action: 'disable',
      };
    case 'configure':
      return {
        type: 'manage-plugins',
        targetPlugin: parsedCommand.plugin,
        action: 'configure',
      };
    case 'marketplace':
      if (parsedCommand.action === 'list') {
        return { type: 'marketplace-list' };
      }
      if (parsedCommand.action === 'add') {
        return {
          type: 'add-marketplace',
          initialValue: parsedCommand.target,
        };
      }
      if (parsedCommand.action === 'remove') {
        return {
          type: 'manage-marketplaces',
          targetMarketplace: parsedCommand.target,
          action: 'remove',
        };
      }
      if (parsedCommand.action === 'update') {
        return {
          type: 'manage-marketplaces',
          targetMarketplace: parsedCommand.target,
          action: 'update',
        };
      }
      return { type: 'marketplace-menu' };
    case 'menu':
    default:
      // Default to discover view showing all plugins
      return { type: 'discover-plugins' };
  }
}

function getInitialTab(viewState: ViewState): TabId {
  if (viewState.type === 'manage-plugins') return 'installed';
  if (viewState.type === 'stats') return 'stats';
  if (viewState.type === 'manage-marketplaces') return 'marketplaces';
  return 'discover';
}

export function PluginSettings({
  onComplete,
  args,
  showMcpRedirectMessage: _showMcpRedirectMessage,
  showSkillsRedirectMessage,
  showSkillDoctorRedirectMessage,
}: PluginSettingsProps): React.ReactNode {
  const parsedCommand = parsePluginArgs(args);
  const initialViewState = getInitialViewState(parsedCommand);
  const [viewState, setViewState] = useState<ViewState>(initialViewState);
  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab(initialViewState));
  const [inputValue, setInputValue] = useState(
    viewState.type === 'add-marketplace' ? viewState.initialValue || '' : '',
  );
  const [cursorOffset, setCursorOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(
    parsedCommand.type === 'usage-error' ? parsedCommand.message : null,
  );
  const [childSearchActive, setChildSearchActive] = useState(false);
  const setAppState = useSetAppState();
  const { storageV5 } = useSessionServices();
  const mcpClients = useAppState(s => s.mcp.clients);
  const mcpCommands = useAppState(s => s.mcp.commands);
  const pluginCommands = useAppState(s => s.plugins.commands);
  const mainLoopModel = useAppState(s => s.mainLoopModel);

  const statsReportRef = useRef<Promise<PluginStatsReportResult> | null>(null);
  const getStatsReport = useCallback((): Promise<PluginStatsReportResult> => {
    if (statsReportRef.current === null) {
      statsReportRef.current = (async (): Promise<PluginStatsReportResult> => {
        try {
          const baseCommands = await getCommands(getOriginalCwd());
          const seen = new Set<string>();
          const mergedCommands: Command[] = [];
          for (const cmd of [...baseCommands, ...pluginCommands, ...mcpCommands]) {
            if (!seen.has(cmd.name)) {
              seen.add(cmd.name);
              mergedCommands.push(cmd);
            }
          }
          const report = await scanSkillDoctor({
            storageV5,
            options: {
              commands: mergedCommands,
              mcpClients,
              mainLoopModel: mainLoopModel ?? getMainLoopModel(),
            },
          } as unknown as LocalJSXCommandContext);
          if (report.rows.length === 0) {
            logEvent('cli_skill_doctor', {
              outcome: 'no_user_skills' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            });
          } else if (report.weekTokensNote !== null) {
            logEvent('cli_skill_doctor', {
              outcome: 'scan_policy_denied' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            });
          } else {
            logEvent('cli_skill_doctor', {});
          }
          return { ok: true, report };
        } catch (err) {
          const cause = err instanceof SkillDoctorStageError ? err.cause : err;
          logError(cause);
          logEvent('cli_skill_doctor', {
            outcome: (err instanceof SkillDoctorStageError
              ? err.featureErrorCode
              : 'render_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          return { ok: false, message: errorMessage(cause) };
        }
      })();
    }
    return statsReportRef.current;
  }, [storageV5, pluginCommands, mcpCommands, mcpClients, mainLoopModel]);

  // Error count for the Errors tab badge — counts non-advisory loader errors +
  // background marketplace install failures.
  const pluginErrorCount = useAppState(s => {
    let count = s.plugins.errors.filter(e => !isAdvisoryPluginError(e)).length;
    for (const m of s.plugins.installationStatus.marketplaces) {
      if (m.status === 'failed') count++;
    }
    return count;
  });
  const errorsTabTitle = pluginErrorCount > 0 ? `Errors (${pluginErrorCount})` : 'Errors';

  const exitState = useExitOnCtrlCDWithKeybindings();

  /**
   * CLI mode is active when the user provides a complete command with all required arguments.
   * In this mode, the operation executes immediately without interactive prompts.
   * Interactive mode is used when arguments are missing, allowing the user to input them.
   */
  const cliMode =
    (parsedCommand.type === 'marketplace' && parsedCommand.action === 'add' && parsedCommand.target !== undefined) ||
    parsedCommand.type === 'install-from-source';

  // Signal that plugin state has changed on disk (Layer 2) and active
  // components (Layer 3) are stale. User runs /reload-plugins to apply.
  // Previously this was updatePluginState() which did a partial refresh
  // (commands only — agents/hooks/MCP were silently skipped). Now all
  // Layer-3 refresh flows through the unified refreshActivePlugins()
  // primitive via /reload-plugins, giving one consistent mental model:
  // plugin changes require /reload-plugins.
  const pluginsChangedThisVisit = useRef(false);
  const closeReloadOnce = useRef(false);
  const needsRefresh = useAppState(s => s.plugins.needsRefresh);
  const autoReloadOnClose = getFeatureValue_CACHED_MAY_BE_STALE('tengu_plugin_menu_close_reload', true);

  const markPluginsChanged = useCallback(() => {
    pluginsChangedThisVisit.current = true;
    setAppState(prev =>
      prev.plugins.needsRefresh ? prev : { ...prev, plugins: { ...prev.plugins, needsRefresh: true } },
    );
  }, [setAppState]);

  const completePluginMenu = useCallback(
    (message?: string) => {
      if (closeReloadOnce.current) {
        return;
      }
      closeReloadOnce.current = true;
      const outcome =
        autoReloadOnClose && pluginsChangedThisVisit.current ? pluginMenuCloseReloadOutcome(needsRefresh) : 'none';
      if (outcome === 'none') {
        onComplete(message);
        return;
      }
      onComplete(outcome === 'deferred' ? PLUGIN_MENU_DEFERRED_RELOAD_MESSAGE : message, {
        nextInput: '/reload-plugins',
        submitNextInput: true,
      });
    },
    [autoReloadOnClose, needsRefresh, onComplete],
  );

  // Handle tab switching (called by Tabs component)
  const handleTabChange = useCallback((tabId: string) => {
    const tab = tabId as TabId;
    setActiveTab(tab);
    setError(null);
    switch (tab) {
      case 'discover':
        setViewState({ type: 'discover-plugins' });
        break;
      case 'installed':
        setViewState({ type: 'manage-plugins' });
        break;
      case 'marketplaces':
        setViewState({ type: 'manage-marketplaces' });
        break;
      case 'errors':
      case 'stats':
        break;
    }
  }, []);

  // Handle exiting when child components set viewState to 'menu'.
  // Child components typically set BOTH setResult(msg) and setParentViewState
  // ({type:'menu'}) — both effects fire on the same render. Only close via this
  // path when there's no result, otherwise the result effect (below) handles
  // the close AND delivers the message to the transcript.
  useEffect(() => {
    if (viewState.type === 'menu' && !result) {
      completePluginMenu();
    }
  }, [viewState.type, result, completePluginMenu]);

  // Sync activeTab when viewState changes to a different tab's content
  // This handles cases like AddMarketplace navigating to browse-marketplace
  useEffect(() => {
    if (viewState.type === 'browse-marketplace' && activeTab !== 'discover') {
      setActiveTab('discover');
    }
  }, [viewState.type, activeTab]);

  // Handle escape key for add-marketplace mode only
  // Other tabbed views handle escape in their own components
  const handleAddMarketplaceEscape = useCallback(() => {
    setActiveTab('marketplaces');
    setViewState({ type: 'manage-marketplaces' });
    setInputValue('');
    setError(null);
  }, []);

  useKeybinding('confirm:no', handleAddMarketplaceEscape, {
    context: 'Settings',
    isActive: viewState.type === 'add-marketplace',
  });

  useEffect(() => {
    if (result) {
      completePluginMenu(result);
    }
  }, [result, completePluginMenu]);

  // Handle help view completion
  useEffect(() => {
    if (viewState.type === 'help') {
      completePluginMenu();
    }
  }, [viewState.type, completePluginMenu]);

  // Render different views based on state
  if (viewState.type === 'help') {
    return (
      <Box flexDirection="column">
        <Text bold>Plugin Command Usage:</Text>
        <Text> </Text>
        <Text dimColor>Installation:</Text>
        <Text> /plugin install - Browse and install plugins</Text>
        <Text> /plugin install &lt;marketplace&gt; - Install from specific marketplace</Text>
        <Text> /plugin install &lt;plugin&gt; - Install specific plugin</Text>
        <Text> /plugin install &lt;plugin&gt;@&lt;market&gt; - Install plugin from marketplace</Text>
        <Text>
          {' '}
          /plugin install &lt;plugin&gt; --marketplace &lt;source&gt; - Install plugin from a marketplace source, adding
          it first
        </Text>
        <Text> </Text>
        <Text dimColor>Management:</Text>
        <Text> /plugin list [--enabled|--disabled] - List installed plugins</Text>
        <Text> /plugin manage - Manage installed plugins</Text>
        <Text> /plugin stats - Show skill usage and context costs</Text>
        <Text> /plugin directory [query] - Search the Anthropic Directory in Discover</Text>
        <Text> /plugin enable &lt;plugin&gt; - Enable a plugin</Text>
        <Text> /plugin disable &lt;plugin&gt; - Disable a plugin</Text>
        <Text> /plugin configure &lt;plugin&gt; - Set userConfig options</Text>
        <Text> /plugin uninstall &lt;plugin&gt; - Uninstall a plugin</Text>
        <Text> </Text>
        <Text dimColor>Marketplaces:</Text>
        <Text> /plugin marketplace - Marketplace management menu</Text>
        <Text> /plugin marketplace add - Add a marketplace</Text>
        <Text> /plugin marketplace add &lt;path/url&gt; - Add marketplace directly</Text>
        <Text> /plugin marketplace update - Update marketplaces</Text>
        <Text> /plugin marketplace update &lt;name&gt; - Update specific marketplace</Text>
        <Text> /plugin marketplace remove - Remove a marketplace</Text>
        <Text> /plugin marketplace remove &lt;name&gt; - Remove specific marketplace</Text>
        <Text> /plugin marketplace list - List all marketplaces</Text>
        <Text> </Text>
        <Text dimColor>Validation:</Text>
        <Text> /plugin validate &lt;path&gt; - Validate a manifest file or directory</Text>
        <Text> /plugin tag [path] [--push] [--dry-run] [-f] - Create a release tag for the plugin</Text>
        <Text> </Text>
        <Text dimColor>Other:</Text>
        <Text> /plugin - Main plugin menu</Text>
        <Text> /plugin help - Show this help</Text>
        <Text> /plugins - Alias for /plugin</Text>
      </Box>
    );
  }

  if (viewState.type === 'validate') {
    return <ValidatePlugin onComplete={completePluginMenu} path={viewState.path} />;
  }

  if (viewState.type === 'eval') {
    return <PluginEval onComplete={completePluginMenu} path={viewState.path} />;
  }

  if (viewState.type === 'plugin-list') {
    return <PluginList onComplete={completePluginMenu} filter={viewState.filter} />;
  }

  if (viewState.type === 'marketplace-menu') {
    // Show a simple menu for marketplace operations
    setViewState({ type: 'menu' });
    return null;
  }

  if (viewState.type === 'marketplace-list') {
    return <MarketplaceList onComplete={completePluginMenu} />;
  }

  if (viewState.type === 'add-marketplace') {
    return (
      <AddMarketplace
        inputValue={inputValue}
        setInputValue={setInputValue}
        cursorOffset={cursorOffset}
        setCursorOffset={setCursorOffset}
        error={error}
        setError={setError}
        result={result}
        setResult={setResult}
        setViewState={setViewState}
        onAddComplete={markPluginsChanged}
        cliMode={cliMode}
      />
    );
  }
  const activeModNames = getLoadedFunctionHooksModules()
    .filter(mod => !mod.pluginStorageId?.endsWith('@builtin'))
    .map(mod => mod.name);
  const redirectBanner =
    showSkillsRedirectMessage && activeTab === 'installed' ? (
      <SkillsRedirectBanner />
    ) : showSkillDoctorRedirectMessage && activeTab === 'stats' ? (
      <SkillDoctorRedirectBanner />
    ) : undefined;
  const banner =
    activeModNames.length > 0 ? (
      <>
        <ActiveModsBanner names={activeModNames} />
        {redirectBanner}
      </>
    ) : (
      redirectBanner
    );

  // Render tabbed interface using the design system Tabs component
  return (
    <Pane color="suggestion">
      <Tabs
        title="Plugins"
        selectedTab={activeTab}
        onTabChange={handleTabChange}
        color="suggestion"
        disableNavigation={childSearchActive}
        banner={banner}
      >
        <Tab id="discover" title="Discover">
          {viewState.type === 'browse-marketplace' ? (
            <BrowseMarketplace
              error={error}
              setError={setError}
              result={result}
              setResult={setResult}
              setViewState={setViewState}
              onInstallComplete={markPluginsChanged}
              targetMarketplace={viewState.targetMarketplace}
              targetPlugin={viewState.targetPlugin}
            />
          ) : (
            <DiscoverPlugins
              error={error}
              setError={setError}
              result={result}
              setResult={setResult}
              setViewState={setViewState}
              onInstallComplete={markPluginsChanged}
              onSearchModeChange={setChildSearchActive}
              targetPlugin={viewState.type === 'discover-plugins' ? viewState.targetPlugin : undefined}
              initialMarketplace={viewState.type === 'discover-plugins' ? viewState.marketplace : undefined}
              initialSearchQuery={viewState.type === 'discover-plugins' ? viewState.searchQuery : undefined}
            />
          )}
        </Tab>
        <Tab id="installed" title="Installed">
          <ManagePlugins
            setViewState={setViewState}
            setResult={setResult}
            onManageComplete={markPluginsChanged}
            onSearchModeChange={setChildSearchActive}
            targetPlugin={viewState.type === 'manage-plugins' ? viewState.targetPlugin : undefined}
            targetMarketplace={viewState.type === 'manage-plugins' ? viewState.targetMarketplace : undefined}
            action={viewState.type === 'manage-plugins' ? viewState.action : undefined}
          />
        </Tab>
        <Tab id="marketplaces" title="Marketplaces">
          <ManageMarketplaces
            setViewState={setViewState}
            error={error}
            setError={setError}
            setResult={setResult}
            exitState={exitState}
            onManageComplete={markPluginsChanged}
            targetMarketplace={viewState.type === 'manage-marketplaces' ? viewState.targetMarketplace : undefined}
            action={viewState.type === 'manage-marketplaces' ? viewState.action : undefined}
          />
        </Tab>
        <Tab id="errors" title={errorsTabTitle}>
          <ErrorsTabContent
            setViewState={setViewState}
            setActiveTab={setActiveTab}
            markPluginsChanged={markPluginsChanged}
          />
        </Tab>
        <Tab id="stats" title="Stats">
          <StatsTabContent getReport={getStatsReport} onExit={() => setViewState({ type: 'menu' })} />
        </Tab>
      </Tabs>
    </Pane>
  );
}
