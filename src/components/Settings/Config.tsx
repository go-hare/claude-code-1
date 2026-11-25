// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import {
  type DOMElement,
  type KeyboardEvent,
  type WheelEvent,
  Box,
  Text,
  measureElement,
  useFocusReclaim,
  useTheme,
  useThemeSetting,
  useTerminalFocus,
  useWantEveryKey,
} from '@anthropic/ink';
import * as React from 'react';
import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import axios from 'axios';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import figures from 'figures';
import {
  type GlobalConfig,
  saveGlobalConfig,
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
  getEffectiveGlobalConfig,
  saveUserIntentSetting,
  type OutputStyle,
} from '../../utils/config.js';
import { normalizeApiKeyForConfig } from '../../utils/authPortable.js';
import { getClaudeAIOAuthTokens, isClaudeAISubscriber } from '../../utils/auth.js';
import { getOauthConfig } from '../../constants/oauth.js';
import { getPolicyDenyKind, isPolicyAllowed, refreshPolicyLimits } from '../../services/policyLimits/index.js';
import {
  getLoadedFunctionHooksModules,
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../../utils/plugins/functionHooksModules.js';
import { ConfigSettingRefusalError } from '../../commands/config/configShorthand.js';
import { readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { hostname } from 'os';
import { dirname, join } from 'path';

/**
 * Official 2.1.299 (#652): sync `/config` push notification toggles to the
 * account's `/api/claude_code/notification/preferences` endpoint, using the
 * newly chosen setting rather than reading stale state.
 */
export async function syncPushNotificationPreferences(
  overrides: {
    agentPushNotifEnabled?: boolean;
    inputNeededNotifEnabled?: boolean;
  } = {},
  patchFn: (
    url: string,
    body: unknown,
    opts: { headers: Record<string, string>; timeout: number },
  ) => Promise<unknown> = (url, body, opts) => axios.patch(url, body, opts),
  deps: {
    isSubscriber?: () => boolean;
    getTokens?: () => { accessToken?: string } | null;
    getConfig?: () => GlobalConfig;
  } = {},
): Promise<void> {
  const isSubscriber = deps.isSubscriber ?? isClaudeAISubscriber;
  const getTokens = deps.getTokens ?? getClaudeAIOAuthTokens;
  const getConfig = deps.getConfig ?? getEffectiveGlobalConfig;
  try {
    if (!isSubscriber()) return;
    const tokens = getTokens();
    if (!tokens?.accessToken) return;
    const config = getConfig();
    const agentPush = overrides.agentPushNotifEnabled ?? config.agentPushNotifEnabled;
    const inputNeeded = overrides.inputNeededNotifEnabled ?? config.inputNeededNotifEnabled;
    const featurePreference: Record<string, { enable_push: boolean }> = {};
    if (typeof agentPush === 'boolean') {
      featurePreference.bogosort = { enable_push: agentPush };
    }
    if (typeof inputNeeded === 'boolean') {
      featurePreference.code_requires_action = { enable_push: inputNeeded };
    }
    if (Object.keys(featurePreference).length === 0) return;
    await patchFn(
      `${getOauthConfig().BASE_API_URL}/api/claude_code/notification/preferences`,
      { preferences: { feature_preference: featurePreference } },
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)));
  }
}

export type SaveAutoUpdatesChannelHookResult =
  | { kind: 'saved'; saved: 'latest' | 'stable' }
  | { kind: 'refused'; reason?: string };

/**
 * Official 2.1.295 (#441): ask plugin `config.set` hooks before persisting
 * `autoUpdatesChannel` changes in `/config`.
 */
export async function saveAutoUpdatesChannelWithConfigSetHook(
  nextChannel: 'latest' | 'stable',
  previousChannel: 'latest' | 'stable' | 'rc',
  applyPersist: (finalChannel: 'latest' | 'stable') => void,
  signal?: AbortSignal,
): Promise<SaveAutoUpdatesChannelHookResult> {
  let saved: 'latest' | 'stable' | undefined;
  try {
    const res = await runFunctionHookChain(
      'config.set',
      {
        key: 'autoUpdatesChannel',
        value: nextChannel,
        previous: previousChannel,
        origin: { kind: 'composer' },
      },
      async arg => {
        const finalChannel =
          arg?.value === 'latest' || arg?.value === 'stable' ? (arg.value as 'latest' | 'stable') : nextChannel;
        saved = finalChannel;
        applyPersist(finalChannel);
        return { value: finalChannel };
      },
      undefined,
      undefined,
      signal ? { signal } : undefined,
    );
    if (saved !== undefined) {
      return { kind: 'saved', saved };
    }
    const deny =
      res && typeof res === 'object' && 'deny' in res && typeof (res as { deny?: unknown }).deny === 'string'
        ? (res as { deny: string }).deny
        : undefined;
    return { kind: 'refused', reason: deny };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'refused', reason: message };
  }
}
import { formatAutoUpdatesChannelDisplay } from '../../utils/autoUpdater.js';
import {
  getGlobalConfig,
  getAutoUpdaterDisabledReason,
  formatAutoUpdaterDisabledReason,
  getRemoteControlAtStartup,
  getRemoteHomeSettingsMode,
  persistRemoteHomeSettingsMode,
  remoteHomeSettingsNotStoredMessage,
  isRemoteHomeSettingsCapabilityOpen,
  probeRemoteHomeSettingsCapability,
  REMOTE_HOME_SETTINGS_GRANT_BLOCKERS,
  type RemoteHomeSettingsGrantBlocker,
  type AutoUpdaterDisabledReason,
} from '../../utils/config.js';
import chalk from 'chalk';
import {
  permissionModeShortTitle,
  permissionModeFromString,
  toExternalPermissionMode,
  isExternalPermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from '../../utils/permissions/PermissionMode.js';
import {
  getAutoModeEnabledState,
  hasAutoModeOptInAnySource,
  transitionPlanAutoMode,
} from '../../utils/permissions/permissionSetup.js';
import { logError } from '../../utils/log.js';
import { errorMessage } from '../../utils/errors.js';
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js';
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { saveThemeWithConfigSetHook } from '../../commands/theme/theme.js';
import { ThemePicker } from '../ThemePicker.js';
import { useAppState, useSetAppState, useAppStateStore } from '../../state/AppState.js';
import { ModelPicker } from '../ModelPicker.js';
import { getMainLoopModel, modelDisplayString, isOpus1mMergeEnabled } from '../../utils/model/model.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import { ClaudeMdExternalIncludesDialog, recordExternalIncludesDecision } from '../ClaudeMdExternalIncludesDialog.js';
import { ChannelDowngradeDialog, type ChannelDowngradeChoice } from '../ChannelDowngradeDialog.js';
import { Dialog } from '@anthropic/ink';
import { Select } from '../CustomSelect/index.js';
import { OutputStylePicker } from '../OutputStylePicker.js';
import { LanguagePicker } from '../LanguagePicker.js';
import {
  type MemoryFileInfo,
  getExternalClaudeMdIncludes,
  getMemoryFiles,
  hasExternalClaudeMdIncludes,
} from 'src/utils/claudemd.js';
import { Byline, KeyboardShortcutHint, useTabHeaderFocus } from '@anthropic/ink';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { useIsInsideModal, useModalOrTerminalSize } from '../../context/modalContext.js';
import { SearchBox } from '../SearchBox.js';
import { isSupportedTerminal, hasAccessToIDEExtensionDiffFeature } from '../../utils/ide.js';
import {
  getInitialSettings,
  getSettingsForSource,
  persistSettingsForSource,
  projectSettingsAliasesUserSettings,
  updateSettingsForSource,
  type CrossSessionInbound,
  type DialogExpiry,
} from '../../utils/settings/settings.js';
import {
  getSettingSourceDisplayNameCapitalized,
  isSettingSourceEnabled,
  SETTING_SOURCES,
  type SettingSource,
} from '../../utils/settings/constants.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { THEME_SETTINGS, type ThemeSetting } from '../../utils/theme.js';
import { getThemeSetting } from '../../utils/themeSetting.js';
import {
  clearRefusalFallbackModelLatch,
  getIsRemoteMode,
  getUserMsgOptIn,
  setUserMsgOptIn,
} from '../../bootstrap/state.js';
import { saveSessionModel } from '../../utils/sessionStorage.js';
import { DEFAULT_OUTPUT_STYLE_NAME, OUTPUT_STYLE_CONFIG } from 'src/constants/outputStyles.js';
import { MODEL_ALIASES } from '../../utils/model/aliases.js';
import { isModelAllowed } from '../../utils/model/modelAllowlist.js';
import { isFable5AvailableOnProvider } from '../../utils/model/fablePicker.js';
import { modelRejectsDisabledThinking } from '../../utils/thinking.js';
import { env } from '../../utils/env.js';
import { logForDebugging } from '../../utils/debug.js';
import { TIME_FORMAT_PRESETS } from 'src/utils/timeFormat.js';
import { getClaudeConfigHomeDir, isEnvTruthy, isRunningOnHomespace } from 'src/utils/envUtils.js';
import { buildConfigDisplayEntries, displayIndexForSetting, sortConfigCatalog } from 'src/utils/configCatalog.js';
import { parseCustomThemeRef } from '../../utils/customThemes.js';
import { getDisplayPath } from '../../utils/file.js';
import { isSafeModeEnabled, safeModeDisableHint } from '../../utils/safeMode.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { ItemList } from '../ItemList.js';
import TextInput from '../TextInput.js';
import { useNotifications } from '../../context/notifications.js';
import type { LocalJSXCommandContext, CommandResultDisplay } from '../../commands.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import {
  isAutoContinueAtUsageLimitToggleable,
  isAutoContinueAtUsageLimitEffective,
  setAutoContinueAtUsageLimitSetting,
} from '../../services/quotaAutoResume.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import {
  getCliTeammateModeOverride,
  clearCliTeammateModeOverride,
} from '../../utils/swarm/backends/teammateModeSnapshot.js';
import { useSearchInput } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import {
  applyFastModeOnModelSwitch,
  clearFastModeCooldown,
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeEnabled,
  getFastModeModel,
  isFastModeSupportedByModel,
  resolveFastModeAfterModelSwitch,
} from '../../utils/fastMode.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { getPlatform } from '../../utils/platform.js';
import { configLabelColumnWidth, configMaxVisibleRows } from '../../utils/transcriptFooterHints.js';
import {
  isWorkflowSizeGuidelineProvidedBySettings,
  parseWorkflowSizeGuidelineEnum,
  resolveSessionWorkflowSizeGuideline,
  WORKFLOW_SIZE_GUIDELINE_ENUM_OPTIONS,
} from '../../utils/workflowSizeGuideline.js';
import {
  getModelProposedGoalsSetting,
  isProposeGoalGrowthBookEnabled,
  type ModelProposedGoalsSetting,
} from '@claude-code/builtin-tools/tools/ProposeGoalTool/proposeGoalGate.js';
import { isArtifactToolRegistered } from '../../utils/artifactUrl.js';
import { isWorkflowsAvailable, resolveWorkflowsAvailability } from '../../utils/workflowDisableGate.js';
import { useSessionServices } from '../../context/sessionServices.js';
import { type FeedbackDraftsSetting } from '../../utils/feedbackDrafts/constants.js';
import { isSendFeedbackSessionEnabled, setFeedbackDraftsSetting } from '../../utils/feedbackDrafts/gates.js';
import { isLeftArrowFleetEnabled } from '../../utils/leftArrowVia.js';
import {
  coerceSwitchModelsOnFlagConfigInput,
  formatSwitchModelsOnFlagConfigValue,
  isRefusalFallbackEnabled,
  persistSwitchModelsOnFlag,
  SWITCH_MODELS_ON_FLAG_LABELS,
} from '../../utils/refusalFallback.js';
import { uniq } from '../../utils/array.js';
import type { LoadedPlugin } from '../../types/plugin.js';
import { re } from '../../utils/plugins/escapeSafeText.js';
import {
  loadPluginConfigFromAllowedSources,
  pluginConfigIdAliases,
  type PluginConfigOptionValue,
} from '../../utils/plugins/pluginConfigSources.js';
import { clearPluginOptionsCache, getPluginStorageId } from '../../utils/plugins/pluginOptionsStorage.js';
import { jsonStringify } from '../../utils/slowOperations.js';

function isIdleCompactionRowVisible(): boolean {
  for (const source of ['flagSettings', 'policySettings', 'localSettings', 'projectSettings'] as const) {
    if (isSettingSourceEnabled(source) && getSettingsForSource(source)?.idleCompaction !== undefined) {
      return false;
    }
  }
  return isSettingSourceEnabled('userSettings');
}

/**
 * densable `rDa` — hide /config row when the key is set by a non-user source
 * (policy/flag). User-only overrides remain editable.
 */
function isConfigSettingManagedOutsideUser(key: keyof SettingsJson): boolean {
  for (const source of ['policySettings', 'flagSettings'] as const) {
    if (!isSettingSourceEnabled(source)) continue;
    if (getSettingsForSource(source)?.[key] !== undefined) return true;
  }
  return false;
}

/**
 * densable 2.1.248 `Po()` / `crossSessionInboxRowVisible`.
 * Same-machine inbox row: env defined → Me/isEnvTruthy; GB default ON.
 */
function isCrossSessionInboxConfigRowVisible(): boolean {
  const e = process.env.CLAUDE_CODE_HARBOR_KITE;
  if (e !== undefined) return isEnvTruthy(e);
  if (getPlatform() === 'windows' && !getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_win', true)) {
    return false;
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite', true);
}

type Props = {
  onClose: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  context: LocalJSXCommandContext;
  setTabsHidden: (hidden: boolean) => void;
  onIsSearchModeChange?: (inSearchMode: boolean) => void;
  contentHeight?: number;
};

type SettingBase =
  | {
      id: string;
      label: string;
    }
  | {
      id: string;
      label: React.ReactNode;
      searchText: string;
    };

export type ConfigSettingLock = {
  reason?: string;
  source?: string;
  reasonShipsOffBox?: boolean;
  writableWhileLocked?: string[];
};

export type ConfigSettingChange = {
  error?: Error | null;
  messageSuffix?: string;
};

function asConfigSettingChange(value: unknown): ConfigSettingChange | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('error' in value) && !('messageSuffix' in value)) return undefined;
  return value as ConfigSettingChange;
}

export type SettingProvidedMeta = {
  plugin: string;
  pluginId: string;
  description: string;
  kind: 'boolean' | 'choice' | 'number' | 'text';
};

export type Setting =
  | (SettingBase & {
      value: boolean;
      // DualInk-off: gold minified onChange is untyped. `void | Promise` trips
      // biome noConfusingVoidType; void-returning rows stay assignable.
      onChange(value: boolean): unknown;
      type: 'boolean';
      // densable row flag; panel does not consume it (CLI key=value host does).
      consentGated?: boolean;
      canWithdraw?: () => boolean;
      lock?: ConfigSettingLock;
      notice?: string;
      provided?: SettingProvidedMeta;
      // densable grantBlocker — DualInk-off list shows qAr copy instead of onChange(true).
      grantBlocker?: RemoteHomeSettingsGrantBlocker;
    })
  | (SettingBase & {
      value: string;
      options: string[];
      onChange(value: string): unknown;
      type: 'enum';
      // densable: pickToCommit opens EnumPicker (crossSessionInbound + IRn string+options).
      pickToCommit?: boolean;
      // densable: coerce for /config key=value host (panel does not consume it).
      coerce?(raw: string): string | undefined;
      // densable row flag; panel does not consume it (CLI key=value host does).
      consentGated?: boolean;
      canWithdraw?: () => boolean;
      lock?: ConfigSettingLock;
      notice?: string;
      provided?: SettingProvidedMeta;
      /** Official 2.1.321 (#1856): value is derived default (not explicitly persisted in settings). */
      isDefaultValue?: boolean;
    })
  | (SettingBase & {
      // For enums that are set by a custom component, we don't need to pass options,
      // but we still need a value to display in the top-level config menu
      value: string;
      options?: string[];
      optionsHint?: string;
      onChange(value: string): unknown;
      type: 'managedEnum';
      coerce?(raw: string): string | undefined;
      consentGated?: boolean;
      canWithdraw?: () => boolean;
      lock?: ConfigSettingLock;
      notice?: string;
      provided?: SettingProvidedMeta;
      /** Official 2.1.321 (#1856): value is derived default (not explicitly persisted in settings). */
      isDefaultValue?: boolean;
    });

/** densable IRn `je` — plugin /config rows cannot be written over Remote Control. */
export const PLUGIN_CONFIG_REMOTE_REFUSAL =
  "a plugin's settings can't be changed over Remote Control or from a relayed message — open /config in the session itself";

const PLUGIN_CONFIG_POLICY_LOCK = "Set by your organization's managed settings (pluginConfigs)";
const PLUGIN_CONFIG_FLAG_LOCK = 'Set by --settings for this session (pluginConfigs)';

type PluginUserConfigField = {
  type?: string;
  title?: string;
  description?: string;
  sensitive?: boolean;
  multiple?: boolean;
  default?: PluginConfigOptionValue;
  options?: unknown;
  min?: number;
  max?: number;
};

export type PluginConfigSettingsOpts = {
  storageV5?: unknown;
  refusal?: string;
  reloadPlugins?: () => Promise<void>;
  onPersisted?: () => void;
  onSaveResult?: (result: { error?: Error | null } | undefined) => void;
};

export { pluginConfigIdAliases };

function pluginConfigOptionLockReason(pluginId: string, key: string): string | undefined {
  const aliases = pluginConfigIdAliases(pluginId);
  const setIn = (source: 'policySettings' | 'flagSettings'): boolean => {
    const configs = getSettingsForSource(source)?.pluginConfigs;
    return aliases.some(id => configs?.[id]?.options?.[key] !== undefined);
  };
  if (setIn('policySettings')) return PLUGIN_CONFIG_POLICY_LOCK;
  if (setIn('flagSettings')) return PLUGIN_CONFIG_FLAG_LOCK;
  return undefined;
}

const pluginConfigPersistInFlight = new Map<string, PluginConfigOptionValue>();

function samePluginConfigValue(a: unknown, b: unknown): boolean {
  return jsonStringify(a) === jsonStringify(b);
}

/**
 * Official 2.1.331 `Xo` + `Zo` (@335536980) — write one plugin option under
 * `userSettings.pluginConfigs`, invalidate caches, and reload plugins.
 */
export async function persistPluginConfigOption(
  plugin: LoadedPlugin,
  key: string,
  value: PluginConfigOptionValue,
  storageV5?: unknown,
  reloadPlugins?: () => Promise<void>,
): Promise<ConfigSettingChange | undefined> {
  const pluginId = getPluginStorageId(plugin);
  const next = Array.isArray(value) ? [...value] : value;
  const inflightKey = `${pluginId}\0${key}`;
  const previous = pluginConfigPersistInFlight.has(inflightKey)
    ? pluginConfigPersistInFlight.get(inflightKey)
    : getSettingsForSource('userSettings')?.pluginConfigs?.[pluginId]?.options?.[key];
  if (samePluginConfigValue(previous, next)) return;
  pluginConfigPersistInFlight.set(inflightKey, next);
  const result = await persistSettingsForSource(
    'userSettings',
    {
      pluginConfigs: {
        [pluginId]: {
          options: {
            [key]: next,
          },
        },
      },
    },
    undefined,
    storageV5,
  ).finally(() => {
    if (pluginConfigPersistInFlight.get(inflightKey) === next) {
      pluginConfigPersistInFlight.delete(inflightKey);
    }
  });
  if (result.error) return { error: result.error };
  clearPluginOptionsCache();
  // Official 2.1.331 `Zo(n, i)`: detect pluginStorageId mismatch or reload failure.
  const loadedMod = getLoadedFunctionHooksModules().find(m => m.name === plugin.name);
  if (loadedMod !== undefined && loadedMod.pluginStorageId !== undefined && loadedMod.pluginStorageId !== pluginId) {
    return { messageSuffix: ' · saved; /reload-plugins applies it' };
  }
  if (reloadPlugins) {
    try {
      await reloadPlugins();
    } catch (err) {
      logForDebugging(`/config ${plugin.name}.${key}: saved; ${errorMessage(err)}`);
      return {
        messageSuffix: ' · saved, but the plugin did not reload; /reload-plugins applies it',
      };
    }
  }
  return;
}

/** densable we — core catalog then IRn plugin rows, then gold `qi`. */
export function weConfigPluginRows(
  core: Setting[],
  plugins: readonly LoadedPlugin[],
  opts: PluginConfigSettingsOpts = {},
): Setting[] {
  return sortConfigCatalog([...core, ...pluginConfigSettings(plugins, opts)]);
}

/**
 * Official 2.1.331 `XZr` (@335537750) — enabled plugins' non-sensitive,
 * non-multiple userConfig fields as /config rows. Label is userConfig.title
 * (agents-md.instructionFiles → "Project instructions"). Id is
 * `${pluginName}.${key}`, disambiguated with pluginId on name collision.
 * `onChange` returns the awaited `persistPluginConfigOption` promise so
 * shorthand (`-p` / headless) flushes to disk and propagates `{ error }` / reload suffix.
 */
export function pluginConfigSettings(plugins: readonly LoadedPlugin[], opts: PluginConfigSettingsOpts = {}): Setting[] {
  const rows: Setting[] = [];
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const userConfig = (plugin.manifest.userConfig ?? {}) as Record<string, PluginUserConfigField>;
    const pluginId = getPluginStorageId(plugin);
    const safeName = re(plugin.name);
    const displayId = plugins.some(
      other => other !== plugin && other.enabled !== false && re(other.name).toLowerCase() === safeName.toLowerCase(),
    )
      ? pluginId
      : plugin.name;
    for (const [key, field] of Object.entries(userConfig)) {
      if (field.sensitive === true || field.multiple === true) continue;
      const id = `${displayId}.${key}`;
      const lockReason = pluginConfigOptionLockReason(pluginId, key) ?? opts.refusal;
      const title = re(field.title ?? key);
      const description = re(field.description ?? '');
      const current = loadPluginConfigFromAllowedSources(pluginId).options?.[key] ?? field.default;
      const persist = async (next: PluginConfigOptionValue): Promise<ConfigSettingChange | undefined> => {
        if (lockReason !== undefined) {
          return { error: new ConfigSettingRefusalError(lockReason) };
        }
        const result = await persistPluginConfigOption(plugin, key, next, opts.storageV5, opts.reloadPlugins);
        opts.onSaveResult?.(result);
        if (!result?.error) {
          opts.onPersisted?.();
        }
        return result;
      };
      const base = {
        id,
        label: title,
        searchText: `${title} ${plugin.name} ${description}`,
        ...(lockReason !== undefined ? { lock: { reason: lockReason, source: 'managed' } } : {}),
      };
      if (field.type === 'boolean') {
        rows.push({
          ...base,
          value: current === true || current === 'true',
          type: 'boolean',
          provided: {
            plugin: safeName,
            pluginId,
            description,
            kind: 'boolean',
          },
          onChange(value: boolean) {
            return persist(value);
          },
        });
        continue;
      }
      if (field.type === 'string' && Array.isArray(field.options)) {
        const options = uniq(field.options.map(option => re(String(option)))).filter(option => option !== '');
        rows.push({
          ...base,
          value: current === undefined ? '' : String(current),
          options,
          type: 'enum',
          pickToCommit: true,
          provided: {
            plugin: safeName,
            pluginId,
            description,
            kind: 'choice',
          },
          onChange(value: string) {
            return persist(value);
          },
        });
        continue;
      }
      const isNumber = field.type === 'number';
      rows.push({
        ...base,
        value: current === undefined ? '' : String(current),
        type: 'managedEnum',
        coerce: (raw: string) => {
          if (!isNumber) return raw;
          const trimmed = raw.trim();
          const parsed = Number(trimmed);
          return trimmed !== '' &&
            Number.isFinite(parsed) &&
            (field.min === undefined || parsed >= field.min) &&
            (field.max === undefined || parsed <= field.max)
            ? String(parsed)
            : undefined;
        },
        optionsHint: isNumber
          ? `It takes a number${field.min !== undefined || field.max !== undefined ? ` between ${field.min ?? '-∞'} and ${field.max ?? '∞'}` : ''}.`
          : undefined,
        provided: {
          plugin: safeName,
          pluginId,
          description,
          kind: isNumber ? 'number' : 'text',
        },
        onChange(value: string) {
          if (field.type === 'number') {
            const trimmed = value.trim();
            const parsed = Number(trimmed);
            if (
              trimmed !== '' &&
              Number.isFinite(parsed) &&
              (field.min === undefined || parsed >= field.min) &&
              (field.max === undefined || parsed <= field.max)
            ) {
              return persist(parsed);
            }
            return;
          }
          return persist(value);
        },
      });
    }
  }
  return rows;
}

/**
 * Official 2.1.326 #286 (`Za`): format boolean / `'true'`/`'false'` values as
 * `on` / `off` in `/config` (preserving non-boolean plugin-provided strings).
 */
export function formatConfigOnOffValue(value: string | boolean, isPluginProvidedNonBoolean = false): string {
  if (typeof value === 'boolean') {
    return value ? 'on' : 'off';
  }
  if (isPluginProvidedNonBoolean) {
    return value;
  }
  return value === 'true' ? 'on' : value === 'false' ? 'off' : value;
}

/** densable o0t — normalize single-line display value for plugin text/number settings. */
function formatSettingDisplayValue(setting: Setting): string {
  const s = String(setting.value);
  return setting.provided !== undefined && setting.type !== 'boolean' ? s.replace(/[\t\n\r]/g, ' ').trim() : s;
}

export type RemoteHomeSettingsDialogResult = 'forward' | 'keep_local' | 'not_now' | 'not_saved' | 'not_stored';

export async function enableRemoteHomeSettingsFromConfigPanel(
  choice: 'forward' | 'keep_local' | 'not_now' = 'forward',
  storageV5?: unknown,
): Promise<RemoteHomeSettingsDialogResult> {
  if (choice === 'not_now') {
    return 'not_now';
  }
  try {
    const result = await persistRemoteHomeSettingsMode(choice, storageV5);
    switch (result) {
      case 'refused':
        return 'not_saved';
      case 'not_stored':
        return 'not_stored';
      case 'unconfirmed':
      case 'written':
        return choice;
    }
  } catch (err) {
    logError(err);
    return 'not_saved';
  }
}

function RemoteHomeSettingsConfirmation({
  configHome,
  storageV5,
  onDone,
}: {
  configHome: string;
  storageV5?: unknown;
  onDone: (result: RemoteHomeSettingsDialogResult) => void;
}): React.ReactNode {
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    logEvent('tengu_home_settings_mode_prompt_shown', {
      origin: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
  }, []);

  const handleChoice = useCallback(
    (choice: 'forward' | 'keep_local' | 'not_now') => {
      if (submitting) return;
      setSubmitting(true);
      logEvent('tengu_home_settings_mode_prompt', {
        choice: choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        origin: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      void enableRemoteHomeSettingsFromConfigPanel(choice, storageV5).then(result => {
        onDone(result);
      });
    },
    [submitting, storageV5, onDone],
  );

  return (
    <Dialog
      title="Use this machine's settings in cloud sessions?"
      onCancel={() => handleChoice('not_now')}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint
              action="confirm:no"
              context="Confirmation"
              fallback="Esc"
              description="skip for now"
            />
          </Byline>
        )
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text bold>{getDisplayPath(configHome)}</Text>
        <Text>
          Send the CLAUDE.md, rules, output styles, and preferences in this folder, plus your portable permission rules,
          into each claude --cloud session. It skips credential files and files your Read rules or sandbox settings deny
          (your preferences and permission rules are still sent), never sends hooks, environment variables, MCP servers,
          or plugins, and copies no file from outside this folder, even through a link or an @import. Deny and ask rules
          can go with their paths; file rules need a ~/ or relative path. What is sent is encrypted at rest, and each
          launch shows whether it was sent.
        </Text>
        <Text dimColor>
          Without this, cloud sessions keep their own default settings, as they do today. Yes and No are saved for this
          machine; /config changes it later, from a session started without --cloud.
        </Text>
      </Box>
      <Select
        options={[
          { label: 'Yes, send my settings', value: 'forward' },
          { label: 'No, keep them on this machine', value: 'keep_local' },
          { label: 'Not now', value: 'not_now' },
        ]}
        defaultFocusValue="not_now"
        hideIndexes={!isScreenReaderModeEnabled()}
        isDisabled={submitting}
        onChange={value => handleChoice(value as 'forward' | 'keep_local' | 'not_now')}
        onCancel={() => handleChoice('not_now')}
      />
    </Dialog>
  );
}

/**
 * Official 2.1.327 (#395) `gUe` / `iUt`: warning shown under the prompt when a
 * settings change from `/config` (or similar commands) fails to save to disk.
 */
export const SETTINGS_SAVE_FAILED_NOTIFICATION_KEY = 'setting-not-saved';
export const SETTINGS_SAVE_FAILED_MESSAGE =
  "a settings change wasn't saved · check that your settings files are valid and writable";

/**
 * Map `/config` UI row IDs to their underlying `SettingsJson` key so `/config`
 * can display an override note when a higher-precedence source overrides a row.
 */
const CONFIG_ROW_ID_TO_SETTINGS_KEY: Record<string, keyof SettingsJson> = {
  agentPushNotifEnabled: 'agentPushNotifEnabled',
  autoCompact: 'autoCompactEnabled',
  autoScroll: 'autoScrollEnabled',
  autoUpdatesChannel: 'autoUpdatesChannel',
  checkpoints: 'fileCheckpointingEnabled',
  clawdFileProgress: 'clawdFileProgressEnabled',
  editor: 'editorMode',
  inputNeededNotifEnabled: 'inputNeededNotifEnabled',
  language: 'language',
  model: 'model',
  notifChannel: 'preferredNotifChannel',
  outputStyle: 'outputStyle',
  permissionMode: 'permissions',
  precomputeCompactionEnabled: 'precomputeCompactionEnabled',
  progressBar: 'terminalProgressBarEnabled',
  promptSuggestionEnabled: 'promptSuggestionEnabled',
  recap: 'awaySummaryEnabled',
  reduceMotion: 'prefersReducedMotion',
  remoteMessageReceipts: 'remoteMessageReceipts',
  switchModelsOnFlag: 'switchModelsOnFlag',
  teammateMode: 'teammateMode',
  theme: 'theme',
  thinking: 'alwaysThinkingEnabled',
  timeFormat: 'timeFormat',
  timestamps: 'showMessageTimestamps',
  tips: 'spinnerTipsEnabled',
  turnDuration: 'showTurnDuration',
  verbose: 'verbose',
  workflowKeywordTriggerEnabled: 'workflowKeywordTriggerEnabled',
};

/**
 * Official 2.1.331 `Pe` / `P` (@335499280, @335520900): target write scope for
 * rows that write to or sync `localSettings` so they only warn about sources
 * strictly above `localSettings` (no self-override warning for `outputStyle`).
 */
const CONFIG_ROW_TARGET_SOURCE: Partial<Record<string, SettingSource>> = {
  outputStyle: 'localSettings',
  reduceMotion: 'localSettings',
  tips: 'localSettings',
};

/**
 * Official 2.1.331 `Pe(key, targetSource = 'userSettings')`: find the
 * highest-precedence enabled source strictly above `targetSource` that sets `key`.
 */
export function getHigherPrecedenceSettingSource(
  key: keyof SettingsJson,
  targetSource: SettingSource = 'userSettings',
): SettingSource | undefined {
  const targetIdx = SETTING_SOURCES.indexOf(targetSource);
  const higherSources = SETTING_SOURCES.slice(targetIdx + 1).reverse();
  const hasUserSettings = isSettingSourceEnabled('userSettings');
  for (const source of higherSources) {
    if (!isSettingSourceEnabled(source)) continue;
    if (source === 'projectSettings' && hasUserSettings && projectSettingsAliasesUserSettings()) {
      continue;
    }
    const settings = getSettingsForSource(source);
    if (!settings) continue;
    if (key === 'permissions') {
      if (settings.permissions?.defaultMode !== undefined) return source;
      continue;
    }
    if (settings[key] !== undefined) {
      return source;
    }
  }
  return undefined;
}

/**
 * Official 2.1.331 `P(rowId, targetSource)` (@335499280): human-readable note
 * explaining when a higher-precedence settings source overrides what `/config` saves.
 */
export function getConfigOverrideNotice(rowIdOrKey: string, targetSource?: SettingSource): string | undefined {
  const effectiveTarget = targetSource ?? CONFIG_ROW_TARGET_SOURCE[rowIdOrKey] ?? 'userSettings';
  const settingsKey = (CONFIG_ROW_ID_TO_SETTINGS_KEY[rowIdOrKey] ?? rowIdOrKey) as keyof SettingsJson;
  const source = getHigherPrecedenceSettingSource(settingsKey, effectiveTarget);
  return source ? `${getSettingSourceDisplayNameCapitalized(source)} override what you save here` : undefined;
}

/**
 * Official 2.1.331 `Lo` (@335496256) — normalize ISO language code / name for
 * `/config language=...` shorthand.
 */
const LANGUAGE_CODE_ALIASES = new Map<string, string>([
  ['jp', 'ja'],
  ['kr', 'ko'],
  ['cn', 'zh'],
  ['tw', 'zh-Hant'],
]);

let cachedLanguageDisplayNames: Intl.DisplayNames | undefined;

function getLanguageDisplayNames(): Intl.DisplayNames {
  if (!cachedLanguageDisplayNames) {
    cachedLanguageDisplayNames = new Intl.DisplayNames(['en'], { type: 'language' });
  }
  return cachedLanguageDisplayNames;
}

export function coerceLanguageConfigInput(raw: string): string {
  const trimmed = re(raw).trim();
  if (!trimmed || trimmed.toLowerCase() === 'default') return 'default';
  if (trimmed.length <= 3) {
    const lower = trimmed.toLowerCase();
    const code = LANGUAGE_CODE_ALIASES.get(lower) ?? lower;
    try {
      const display = getLanguageDisplayNames().of(code);
      if (display && display !== code) return display;
    } catch {
      // fall through to title case
    }
  }
  return trimmed
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Official 2.1.331 `Io()` (@335496256) — settable model aliases for `/config model=...`.
 */
export function getConfigModelOptions(): string[] {
  const showFable = isFable5AvailableOnProvider();
  return [
    'default',
    ...MODEL_ALIASES.filter(alias => (showFable || !alias.includes('fable')) && isModelAllowed(alias)),
  ];
}

/**
 * Official 2.1.331 `kpn()` / `vo()` (@335502980) — Remote Control org-policy lock.
 */
export function getRemoteControlLockInfo(): { reason: string; source: 'managed' | 'policy' } | null {
  if (getInitialSettings().disableRemoteControl === true) {
    return {
      reason: "Remote Control is disabled by your organization's policy (managed setting `disableRemoteControl`).",
      source: 'managed',
    };
  }
  if (getPolicyDenyKind('allow_remote_control') === 'org_denied') {
    return {
      reason: "Remote Control is disabled by your organization's policy.",
      source: 'policy',
    };
  }
  return null;
}

// --- Official 2.1.331 6 new catalog row helpers ---

const UNATTENDED_SERVING_CONSENT_VERSION = 1;
const UNATTENDED_SERVING_CONSENT_TERMS = 'unattended-serving:v1:auto-arm-classifier';
export const UNATTENDED_SERVING_LABELS = {
  accepted: 'Allowed',
  declined: 'Not allowed',
  unset: 'Not asked yet',
} as const;
export type UnattendedServingChoice = keyof typeof UNATTENDED_SERVING_LABELS;

function normalizeUnattendedHostname(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/(\.(local|lan|home|localdomain))+$/, '');
}

function getUnattendedServingConsentPath(): string {
  return join(getClaudeConfigHomeDir(), 'state', 'unattended-serving-consent.json');
}

function getUnattendedServingForbidSource(): 'managed' | 'user' | undefined {
  if (getSettingsForSource('policySettings')?.remoteTools?.allowUnattendedServing === false) {
    return 'managed';
  }
  if (getSettingsForSource('userSettings')?.remoteTools?.allowUnattendedServing === false) {
    return 'user';
  }
  return undefined;
}

export function getUnattendedServingForbidReason(): string | undefined {
  const source = getUnattendedServingForbidSource();
  if (source === 'managed') {
    return "Turned off by your organization's settings (remoteTools.allowUnattendedServing)";
  }
  if (source === 'user') {
    return 'Turned off in your user settings (remoteTools.allowUnattendedServing: false in ~/.claude/settings.json) — remove it there to re-enable';
  }
  return undefined;
}

export function readUnattendedServingConsent(): {
  choice: UnattendedServingChoice;
  unreadable: boolean;
  staleYes: boolean;
} {
  try {
    const raw = readFileSync(getUnattendedServingConsentPath(), 'utf8');
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      choice?: unknown;
      terms?: unknown;
      hostname?: unknown;
    };
    if (
      parsed.version !== UNATTENDED_SERVING_CONSENT_VERSION ||
      (parsed.choice !== 'accepted' && parsed.choice !== 'declined') ||
      typeof parsed.terms !== 'string' ||
      typeof parsed.hostname !== 'string'
    ) {
      return { choice: 'unset', unreadable: true, staleYes: false };
    }
    const valid =
      parsed.choice === 'declined' ||
      (normalizeUnattendedHostname(parsed.hostname) === normalizeUnattendedHostname(hostname()) &&
        parsed.terms === UNATTENDED_SERVING_CONSENT_TERMS);
    return {
      choice: valid ? parsed.choice : 'unset',
      unreadable: false,
      staleYes: !valid && parsed.choice === 'accepted',
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') {
      return { choice: 'unset', unreadable: false, staleYes: false };
    }
    return { choice: 'unset', unreadable: true, staleYes: false };
  }
}

export async function persistUnattendedServingConsent(
  choice: 'accepted' | 'declined',
): Promise<'saved' | 'forbidden' | 'not_saved'> {
  if (choice === 'accepted' && getUnattendedServingForbidSource() !== undefined) {
    return 'forbidden';
  }
  try {
    const filePath = getUnattendedServingConsentPath();
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const payload = {
      version: UNATTENDED_SERVING_CONSENT_VERSION,
      choice,
      terms: UNATTENDED_SERVING_CONSENT_TERMS,
      decidedAt: new Date().toISOString(),
      hostname: normalizeUnattendedHostname(hostname()),
    };
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    logEvent('tengu_served_unattended_consent', {
      action: choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface: 'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    return 'saved';
  } catch {
    return 'not_saved';
  }
}

export const ALWAYS_DELIVER_LABELS = {
  off: 'off',
  mine: 'from your sessions on this computer',
  anyone: 'from anyone',
} as const;

export type AlwaysDeliverBinding = {
  current: 'mine' | 'anyone' | 'paused' | undefined;
  sessionClass: 'bypass' | 'prompting';
  set: (next: { scope: 'mine' | 'anyone'; madeIn: 'bypass' | 'prompting' } | undefined) => void;
};

let sessionAlwaysDeliverState: { scope: 'mine' | 'anyone'; madeIn: 'bypass' | 'prompting' } | undefined;

export function getAlwaysDeliverInSessionState():
  | { scope: 'mine' | 'anyone'; madeIn: 'bypass' | 'prompting' }
  | undefined {
  return sessionAlwaysDeliverState;
}

export function setAlwaysDeliverInSessionState(
  next: { scope: 'mine' | 'anyone'; madeIn: 'bypass' | 'prompting' } | undefined,
): void {
  sessionAlwaysDeliverState = next;
}

function getRemoteMessageReceiptsWithSource(): { value: 'on' | 'always' | 'off'; source: SettingSource } | undefined {
  for (let i = SETTING_SOURCES.length - 1; i >= 0; i--) {
    const source = SETTING_SOURCES[i]!;
    if (!isSettingSourceEnabled(source)) continue;
    const val = getSettingsForSource(source)?.remoteMessageReceipts;
    if (val === undefined) continue;
    if (source === 'flagSettings' && val !== 'off') continue;
    return { value: val, source };
  }
  return undefined;
}

function getOrgMemoryAccountKey(): string | null {
  const acct = getGlobalConfig().oauthAccount;
  if (!acct?.accountUuid || !acct.organizationUuid) return null;
  return `${acct.accountUuid}/${acct.organizationUuid}`;
}

function isOrgMemorySyncOpen(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ORG_MEMORY)) return false;
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_haze_glass', false)) return false;
  if (process.env.CLAUDE_MEMORY_STORES?.trim()) return false;
  if (!isClaudeAISubscriber()) return false;
  return isPolicyAllowed('allow_memory_sync');
}

function isOrgMemoryWritesEligible(): boolean {
  return getOrgMemoryAccountKey() !== null && isOrgMemorySyncOpen();
}

function isOrgMemoryWritesActive(): boolean {
  const proj = getCurrentProjectConfig();
  const key = getOrgMemoryAccountKey();
  return (
    proj.orgMemoryWrites === true && proj.orgMemoryWritesAccount !== undefined && proj.orgMemoryWritesAccount === key
  );
}

let orgMemoryReadRowSeen = false;
let orgMemoryWritesRowSeen = false;

export function resetConfigRowSeenFlagsForTesting(): void {
  orgMemoryReadRowSeen = false;
  orgMemoryWritesRowSeen = false;
  sessionAlwaysDeliverState = undefined;
}

function getClawdFileProgressNotice(settingsData: SettingsJson | undefined): string | undefined {
  if (isScreenReaderModeEnabled()) return "Clawd doesn't show in screen reader mode";
  if (settingsData?.prefersReducedMotion === true) return "Clawd doesn't show while Reduce motion is on";
  return undefined;
}

export function isClawdFileProgressRowVisible(terminal: string | null = env.terminal): boolean {
  if (!isSettingSourceEnabled('userSettings')) return false;
  if (getHigherPrecedenceSettingSource('clawdFileProgressEnabled') !== undefined) return false;
  if (terminal === 'Apple_Terminal') return false;
  const piped = getFeatureValue_CACHED_MAY_BE_STALE('tengu_piped_planet', false);
  const steady =
    !isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) && getFeatureValue_CACHED_MAY_BE_STALE('tengu_steady_quail', false);
  return piped || steady;
}

/**
 * Official 2.1.331 `vo()` (@335502980) — construct the `remoteControl` `/config`
 * row (locked `managedEnum` when org policy / managed settings forbid it,
 * otherwise `enum` backed by `userSettings.remoteControlAtStartup`).
 */
export function buildRemoteControlSettingRow(
  currentValue: boolean | undefined,
  lockInfo: { reason: string; source: 'managed' | 'policy' } | null,
  onChange: (selected: string) => ConfigSettingChange | undefined,
): Setting {
  if (lockInfo !== null) {
    return {
      id: 'remoteControl',
      label: 'Enable Remote Control for all sessions',
      value: 'disabled',
      lock: {
        reason: lockInfo.reason,
        source: lockInfo.source,
        writableWhileLocked: ['false'],
      },
      options: ['true', 'false', 'default'],
      type: 'managedEnum' as const,
      onChange,
    };
  }
  return {
    id: 'remoteControl',
    label: 'Enable Remote Control for all sessions',
    value: currentValue === undefined ? 'default' : String(currentValue),
    options: ['true', 'false', 'default'],
    type: 'enum' as const,
    onChange,
  };
}

// --- Official 2.1.331 config.set / config.describe plugin hook wrappers (`UZo` / `Le` / `_ci`) ---

export type ConfigHookOrigin = { kind: 'composer' } | { kind: 'bridge' };

function buildConfigHookRowDescriptor(setting: Setting): {
  key: string;
  label: string;
  description?: string;
  kind: 'boolean' | 'choice' | 'number' | 'text';
  value: boolean | string | number;
  options?: string[];
  provider: { kind: 'core' } | { kind: 'plugin'; pluginId: string };
  isLocked: boolean;
} {
  const label =
    typeof setting.label === 'string' ? setting.label : 'searchText' in setting ? setting.searchText : setting.id;
  const provided = setting.provided;
  const kind: 'boolean' | 'choice' | 'number' | 'text' =
    setting.type === 'boolean'
      ? 'boolean'
      : (provided?.kind ??
        (setting.type === 'enum'
          ? 'choice'
          : setting.coerce !== undefined
            ? 'text'
            : setting.options !== undefined
              ? 'choice'
              : 'text'));
  const options = setting.type === 'boolean' ? undefined : setting.options;
  const numericVal = kind === 'number' && typeof setting.value === 'string' ? Number(setting.value) : Number.NaN;
  const value: boolean | string | number =
    typeof setting.value === 'string' && setting.value.trim() !== '' && Number.isFinite(numericVal)
      ? numericVal
      : setting.value;
  return {
    key: setting.id,
    label,
    ...(provided !== undefined ? { description: provided.description } : {}),
    kind,
    value,
    ...(kind === 'choice' && options !== undefined ? { options } : {}),
    provider: provided === undefined ? { kind: 'core' } : { kind: 'plugin', pluginId: provided.pluginId },
    isLocked: setting.lock !== undefined,
  };
}

function coerceConfigHookNextValue(setting: Setting, rawValue: unknown): boolean | string | undefined {
  if (setting.type === 'boolean') {
    return typeof rawValue === 'boolean' ? rawValue : undefined;
  }
  if (typeof rawValue === 'number') return String(rawValue);
  return typeof rawValue === 'string' ? rawValue : undefined;
}

/**
 * Official 2.1.331 `UZo` / `Le` (@335541500): wrap a `/config` row's `onChange`
 * through plugin `config.set` hooks when any `config.set` hook is registered.
 */
export function wrapSettingWithConfigSetHook<T extends Setting>(
  setting: T,
  origin: ConfigHookOrigin = { kind: 'composer' },
): T {
  if (!hasMatchingFunctionHook('config.set')) {
    return setting;
  }
  const baseOnChange = setting.onChange as (value: boolean | string) => unknown;
  return {
    ...setting,
    onChange(nextValue: boolean | string) {
      if (!hasMatchingFunctionHook('config.set')) {
        return baseOnChange(nextValue);
      }
      const rowDesc = buildConfigHookRowDescriptor(setting);
      const hookValue = rowDesc.kind === 'number' && typeof nextValue === 'string' ? Number(nextValue) : nextValue;
      let writeOutcome: ConfigSettingChange | undefined;
      let writeErrored = false;
      let writeRan = false;
      return runFunctionHookChain(
        'config.set',
        {
          key: rowDesc.key,
          value: hookValue,
          previous: rowDesc.value,
          provider: rowDesc.provider,
          origin,
        },
        async arg => {
          const candidate =
            arg && typeof arg === 'object' && 'value' in arg ? (arg as { value?: unknown }).value : hookValue;
          const coerced = coerceConfigHookNextValue(setting, candidate);
          if (coerced === undefined) {
            return { deny: `${rowDesc.label}: a ${rowDesc.kind} setting can't take that value` };
          }
          let finalValue: boolean | string | undefined = coerced;
          if (jsonStringify(candidate) !== jsonStringify(hookValue) && typeof coerced === 'string') {
            const coerceFn = setting.type === 'managedEnum' ? setting.coerce : undefined;
            if (rowDesc.kind === 'choice' && coerceFn === undefined && !(rowDesc.options ?? []).includes(coerced)) {
              finalValue = undefined;
            } else if (coerceFn !== undefined) {
              finalValue = coerceFn(coerced);
            }
          }
          if (finalValue === undefined) {
            const hint = setting.type === 'managedEnum' && setting.optionsHint ? ` ${setting.optionsHint}` : '';
            return { deny: `${rowDesc.label} doesn't accept "${re(String(candidate))}".${hint}` };
          }
          writeRan = true;
          const rawRes = await baseOnChange(finalValue);
          writeOutcome = asConfigSettingChange(rawRes);
          writeErrored = writeOutcome?.error !== undefined && writeOutcome.error !== null;
          if (writeErrored) {
            return { deny: `${writeOutcome!.error!.message}${writeOutcome?.messageSuffix ?? ''}` };
          }
          return { value: finalValue };
        },
      )
        .then(res => {
          if (writeErrored) {
            return writeOutcome;
          }
          const deny =
            res && typeof res === 'object' && 'deny' in res && typeof (res as { deny?: unknown }).deny === 'string'
              ? (res as { deny: string }).deny
              : undefined;
          if (deny !== undefined) {
            return { error: new ConfigSettingRefusalError(re(deny)) };
          }
          if (!writeRan) {
            return {
              error: new ConfigSettingRefusalError("a plugin's hook answered without writing"),
            };
          }
          return writeOutcome;
        })
        .catch(err => ({
          error: new ConfigSettingRefusalError(`config.set failed: ${errorMessage(err)}`),
        }));
    },
  };
}

export type ConfigDescribeOverride = {
  label: string;
  hidden: boolean;
};

/**
 * Official 2.1.331 `_ci` / `kcs` (@335544400): run plugin `config.describe`
 * hooks to hide or relabel `/config` rows when hooks are registered.
 */
export async function describeConfigRowsWithHooks(
  settings: readonly Setting[],
): Promise<Map<string, ConfigDescribeOverride>> {
  const overrides = new Map<string, ConfigDescribeOverride>();
  if (!hasMatchingFunctionHook('config.describe')) {
    return overrides;
  }
  await Promise.all(
    settings.map(async setting => {
      const rowDesc = buildConfigHookRowDescriptor(setting);
      if (!hasMatchingFunctionHook('config.describe', { key: rowDesc.key })) {
        return;
      }
      try {
        const res = await runFunctionHookChain(
          'config.describe',
          {
            key: rowDesc.key,
            label: rowDesc.label,
            description: rowDesc.description,
            isHidden: false,
            provider: rowDesc.provider,
          },
          async arg => arg,
        );
        if (res && typeof res === 'object') {
          const rec = res as { isHidden?: unknown; label?: unknown };
          if (rec.isHidden === true) {
            overrides.set(setting.id, { label: rowDesc.label, hidden: true });
          } else if (typeof rec.label === 'string' && rec.label !== rowDesc.label) {
            overrides.set(setting.id, { label: re(rec.label), hidden: false });
          }
        }
      } catch {
        // Ignore faulty describe hook for this row
      }
    }),
  );
  return overrides;
}

export const NOTIF_CHANNEL_OPTIONS: ReadonlyArray<GlobalConfig['preferredNotifChannel']> = [
  'auto',
  'iterm2',
  'terminal_bell',
  'iterm2_with_bell',
  'kitty',
  'ghostty',
  'notifications_disabled',
];

/** Official 2.1.328 `pLo` (`chunk@312293526.js:4891`) — compact notification channel label. */
export function formatShortNotifChannel(channel: string): string {
  switch (channel) {
    case 'terminal_bell':
      return 'bell';
    case 'iterm2_with_bell':
      return 'iterm2+bell';
    case 'notifications_disabled':
      return 'none';
    default:
      return channel;
  }
}

type SubMenu =
  | 'Theme'
  | 'Model'
  | 'RemoteHomeSettings'
  | 'ExternalIncludes'
  | 'OutputStyle'
  | 'ChannelDowngrade'
  | 'Language'
  | 'AgentsView'
  | 'Notifications'
  | 'EnableAutoUpdates'
  | 'EnumPicker'
  | 'TextEdit';

/** densable hKe bag — snapshot the panel (or /config key=value ce()) feeds the catalog. */
export type ConfigHkeBag = {
  globalConfig: GlobalConfig;
  setGlobalConfig: (next: GlobalConfig) => void;
  settingsData: SettingsJson;
  setSettingsData: React.Dispatch<React.SetStateAction<SettingsJson>>;
  verbose: boolean;
  thinkingEnabled: boolean | undefined;
  isFastMode: boolean | undefined;
  promptSuggestionEnabled: boolean | undefined;
  mainLoopModel: string | null;
  currentOutputStyle: OutputStyle;
  setCurrentOutputStyle?: (style: OutputStyle) => void;
  currentLanguage: string | undefined;
  setCurrentLanguage?: (language: string | undefined) => void;
  themeSetting: string;
  storageV5: unknown;
  isConnectedToIde: boolean;
  isFileCheckpointingAvailable: boolean;
  shouldShowExternalIncludesToggle: boolean;
  autoUpdaterDisabledReason: AutoUpdaterDisabledReason | null;
  showDefaultViewPicker: boolean;
  showAutoInDefaultModePicker: boolean;
  currentDefaultPermissionMode: PermissionMode;
  mapleSundial: boolean;
  remoteToolServingOn?: boolean;
  alwaysDeliver?: AlwaysDeliverBinding;
  terminalOverride?: string | null;
  setTheme: (setting: ThemeSetting) => unknown;
  F: (patch: SettingsJson) => { error: Error | null };
  B: <K extends keyof SettingsJson>(key: K, value: SettingsJson[K]) => { error: Error | null };
  W: (updater: (current: GlobalConfig) => GlobalConfig) => void;
  setAppState: ReturnType<typeof useSetAppState>;
  setChanges: React.Dispatch<React.SetStateAction<{ [key: string]: unknown }>>;
  onChangeMainModelConfig: (value: string | null, persistAsDefault?: boolean) => ConfigSettingChange | undefined;
  onChangeVerbose: (value: boolean) => ConfigSettingChange | undefined;
  reportSaveResult?: <T extends { error?: Error | null } | undefined>(result: T) => T;
};

/**
 * densable hKe — pure catalog of /config rows from a bag. Plugin rows are
 * concatenated by we() (gold V1n), not here.
 */
export function hKe(n: ConfigHkeBag): { settings: Setting[]; dialogFieldRows: Setting[] } {
  const {
    globalConfig,
    setGlobalConfig,
    settingsData,
    setSettingsData,
    verbose,
    thinkingEnabled,
    isFastMode,
    promptSuggestionEnabled,
    mainLoopModel,
    currentOutputStyle,
    setCurrentOutputStyle,
    currentLanguage,
    setCurrentLanguage,
    themeSetting,
    storageV5,
    isConnectedToIde,
    isFileCheckpointingAvailable,
    shouldShowExternalIncludesToggle,
    autoUpdaterDisabledReason,
    showDefaultViewPicker,
    showAutoInDefaultModePicker,
    currentDefaultPermissionMode,
    mapleSundial,
    remoteToolServingOn = false,
    alwaysDeliver,
    terminalOverride,
    setTheme,
    F,
    B,
    W,
    setAppState,
    setChanges,
    onChangeMainModelConfig,
    onChangeVerbose,
    reportSaveResult,
  } = n;

  // Official 2.1.331 `_o` / `Ne` (@335501050): clear or sync any legacy localSettings
  // shadow after writing tips / reduceMotion to userSettings via F().
  async function clearOrSyncLocalShadow(
    key: 'spinnerTipsEnabled' | 'prefersReducedMotion',
    value: boolean,
    userSaveError: Error | null,
  ): Promise<ConfigSettingChange | undefined> {
    const localVal =
      userSaveError ||
      !isSettingSourceEnabled('userSettings') ||
      getSettingsForSource('projectSettings')?.[key] === !value
        ? value
        : undefined;
    const currentLocal = getSettingsForSource('localSettings')?.[key];
    if (currentLocal !== localVal) {
      await persistSettingsForSource('localSettings', { [key]: localVal } as SettingsJson, undefined, storageV5);
    }
    if (userSaveError) return { error: userSaveError };
    return undefined;
  }

  // Official 2.1.331 `s0o` (@335510770): thinking required lock for models that
  // reject disabled thinking (e.g. Fable 5).
  const effectiveModel = mainLoopModel ?? getMainLoopModel();
  const thinkingRequiredReason = modelRejectsDisabledThinking(effectiveModel)
    ? `Thinking can't be turned off for ${modelDisplayString(effectiveModel)}`
    : undefined;

  // Official 2.1.331 `We` / `vo` (@335502980): Remote Control org-policy lock & save.
  const remoteControlLock = getRemoteControlLockInfo();
  function applyRemoteControlChange(selected: string): ConfigSettingChange | undefined {
    if (selected !== 'false' && remoteControlLock !== null) {
      return { error: new ConfigSettingRefusalError(remoteControlLock.reason) };
    }
    if (selected === 'default') {
      const res = B('remoteControlAtStartup', undefined);
      if (res.error) return { error: res.error };
      W(current => {
        if (current.remoteControlAtStartup === undefined) return current;
        const next = { ...current };
        delete next.remoteControlAtStartup;
        return next;
      });
      setSettingsData(prev => ({ ...prev, remoteControlAtStartup: undefined }));
      setGlobalConfig({ ...globalConfig, remoteControlAtStartup: undefined });
    } else {
      const enabled = selected === 'true';
      const res = B('remoteControlAtStartup', enabled);
      if (res.error) return { error: res.error };
      setSettingsData(prev => ({ ...prev, remoteControlAtStartup: enabled }));
      setGlobalConfig({ ...globalConfig, remoteControlAtStartup: enabled });
    }
    const resolved = getRemoteControlAtStartup();
    setAppState(prev => {
      if (prev.replBridgeEnabled === resolved && !prev.replBridgeOutboundOnly) return prev;
      return {
        ...prev,
        replBridgeEnabled: resolved,
        replBridgeOutboundOnly: false,
      };
    });
    return undefined;
  }

  // Official 2.1.331 `Me` (@335530540): dialogFieldRows keeps defaultToAgentsView
  // settable via `/config defaultToAgentsView=false` even when mapleSundial groups it.
  const fleetEnabled = isLeftArrowFleetEnabled();
  const leftArrowEnabled = fleetEnabled && !getIsRemoteMode();
  const agentsFieldRows: Setting[] = [
    ...(fleetEnabled
      ? [
          {
            id: 'defaultToAgentsView',
            // Official 2.1.328 label (`chunk@312293526.js:12914`)
            label: 'Open agents view by default',
            value: globalConfig.defaultToAgentsView ?? false,
            type: 'boolean' as const,
            onChange(defaultToAgentsView: boolean) {
              W(current => ({ ...current, defaultToAgentsView }));
              setGlobalConfig({
                ...getEffectiveGlobalConfig(),
                defaultToAgentsView,
              });
            },
          } satisfies Setting,
        ]
      : []),
    ...(leftArrowEnabled
      ? [
          {
            id: 'leftArrowOpensAgents',
            label: '← opens agents',
            value: globalConfig.leftArrowOpensAgents ?? true,
            type: 'boolean' as const,
            onChange(leftArrowOpensAgents: boolean) {
              W(current => ({ ...current, leftArrowOpensAgents }));
              setGlobalConfig({
                ...getEffectiveGlobalConfig(),
                leftArrowOpensAgents,
              });
            },
          } satisfies Setting,
        ]
      : []),
  ];

  // Official 2.1.331 unattendedServing / orgMemory / clawdFileProgress / remoteMessageReceipts state.
  const unattendedConsent = readUnattendedServingConsent();
  const unattendedForbidReason = getUnattendedServingForbidReason();
  const showUnattendedServing =
    unattendedConsent.choice !== 'unset' ||
    unattendedConsent.unreadable ||
    unattendedConsent.staleYes ||
    remoteToolServingOn;
  const clawdNotice = getClawdFileProgressNotice(settingsData);
  const projectConfig = getCurrentProjectConfig();
  const showOrgMemoryRead = (orgMemoryReadRowSeen ||= projectConfig.orgMemoryRead === false || isOrgMemorySyncOpen());
  const showOrgMemoryWrites = (orgMemoryWritesRowSeen ||=
    isOrgMemoryWritesEligible() || projectConfig.orgMemoryWrites === true);
  const remoteReceiptsInfo = getRemoteMessageReceiptsWithSource();
  const showRemoteMessageReceipts =
    isCrossSessionInboxConfigRowVisible() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_toasty_phoenix', false) &&
    (remoteReceiptsInfo?.source ?? 'userSettings') === 'userSettings';

  return {
    dialogFieldRows: agentsFieldRows,
    settings: sortConfigCatalog([
      // Global settings
      {
        // densable 2.1.289: value is t0t `s.autoCompactEnabled` (settings ??
        // global). Persist is gold W2 → userSettings, then live `w` snapshot.
        id: 'autoCompact',
        label: 'Auto-compact',
        value: settingsData?.autoCompactEnabled ?? globalConfig.autoCompactEnabled,
        type: 'boolean' as const,
        onChange(autoCompactEnabled: boolean) {
          const res = B('autoCompactEnabled', autoCompactEnabled);
          if (res.error) return { error: res.error };
          setSettingsData(prev => ({ ...prev, autoCompactEnabled }));
          setGlobalConfig({ ...globalConfig, autoCompactEnabled });
          logEvent('tengu_auto_compact_setting_changed', {
            enabled: autoCompactEnabled,
          });
        },
      },
      // Official 2.1.302 (#895): Idle compaction row in /config
      ...(isIdleCompactionRowVisible()
        ? [
            {
              id: 'idleCompaction',
              label: 'Idle compaction',
              value: settingsData?.idleCompaction ?? true,
              type: 'boolean' as const,
              onChange(idleCompaction: boolean) {
                const prevValue = settingsData?.idleCompaction ?? true;
                setSettingsData(prev => ({
                  ...prev,
                  idleCompaction,
                }));
                const res = updateSettingsForSource('userSettings', {
                  idleCompaction,
                });
                reportSaveResult?.(res);
                const { error } = res;
                if (error) {
                  setSettingsData(prev => ({
                    ...prev,
                    idleCompaction: prevValue,
                  }));
                  return { error };
                }
                logEvent('tengu_idle_compaction_setting_changed', {
                  enabled: idleCompaction,
                });
              },
            } satisfies Setting,
          ]
        : []),
      // densable 2.1.234: ...S?[{id:"autoContinueAtUsageLimit",...}] gated by vgt/tengu_maple_sundial
      ...(isAutoContinueAtUsageLimitToggleable()
        ? [
            {
              id: 'autoContinueAtUsageLimit',
              label: 'Continue automatically at usage limit',
              value: settingsData?.autoContinueAtUsageLimit ?? true,
              type: 'boolean' as const,
              consentGated: true,
              onChange(autoContinueAtUsageLimit: boolean) {
                setSettingsData(prev => ({
                  ...prev,
                  autoContinueAtUsageLimit,
                }));
                const result = setAutoContinueAtUsageLimitSetting(autoContinueAtUsageLimit);
                reportSaveResult?.(result);
                if (result.error) {
                  const restored = isAutoContinueAtUsageLimitEffective();
                  setSettingsData(prev => ({
                    ...prev,
                    autoContinueAtUsageLimit: restored,
                  }));
                  return { error: result.error };
                }
              },
            } satisfies Setting,
          ]
        : []),
      // Official 2.1.331: unattendedServing (@335508600)
      ...(showUnattendedServing
        ? [
            {
              id: 'unattendedServing',
              label: 'Unattended commands from cloud sessions on this computer',
              value: UNATTENDED_SERVING_LABELS[unattendedConsent.choice],
              options: [UNATTENDED_SERVING_LABELS.declined, UNATTENDED_SERVING_LABELS.accepted],
              type: 'enum' as const,
              pickToCommit: true,
              consentGated: true,
              canWithdraw: () =>
                unattendedConsent.choice === 'accepted' || unattendedConsent.unreadable || unattendedConsent.staleYes,
              ...(unattendedForbidReason !== undefined
                ? {
                    lock: {
                      reason: unattendedForbidReason,
                      source: 'managed',
                      writableWhileLocked: [UNATTENDED_SERVING_LABELS.declined],
                    },
                  }
                : {}),
              async onChange(value: string) {
                const outcome = await persistUnattendedServingConsent(
                  value === UNATTENDED_SERVING_LABELS.accepted ? 'accepted' : 'declined',
                );
                if (outcome === 'forbidden') {
                  return {
                    error: new ConfigSettingRefusalError(
                      unattendedForbidReason ?? 'Unattended serving is disabled by settings',
                    ),
                  };
                }
                setGlobalConfig({ ...globalConfig });
                if (outcome === 'not_saved') {
                  return {
                    error: new ConfigSettingRefusalError("Couldn't save your answer, so nothing changed"),
                  };
                }
                return undefined;
              },
            } satisfies Setting,
          ]
        : []),
      // densable vfn()?[{id:"switchModelsOnFlag"... type:"enum" B9/ro/Efn}]
      ...(isRefusalFallbackEnabled()
        ? [
            {
              id: 'switchModelsOnFlag',
              label: 'Switch models when a message is flagged',
              value: formatSwitchModelsOnFlagConfigValue(settingsData?.switchModelsOnFlag),
              options: [SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically, SWITCH_MODELS_ON_FLAG_LABELS.askEachTime],
              type: 'enum' as const,
              pickToCommit: true,
              coerce: coerceSwitchModelsOnFlagConfigInput,
              onChange(value: string) {
                const enabled = value === SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically;
                setSettingsData(prev => ({
                  ...prev,
                  switchModelsOnFlag: enabled,
                }));
                return persistSwitchModelsOnFlag(enabled, 'config', storageV5).then(res => {
                  reportSaveResult?.(res);
                  return res.error ? { error: res.error } : undefined;
                });
              },
            } satisfies Setting,
          ]
        : []),
      {
        id: 'tips',
        notice: getConfigOverrideNotice('tips', 'localSettings'),
        label: 'Show tips',
        value: settingsData?.spinnerTipsEnabled ?? true,
        type: 'boolean' as const,
        onChange(spinnerTipsEnabled: boolean) {
          const res = F({ spinnerTipsEnabled });
          setSettingsData(prev => ({
            ...prev,
            spinnerTipsEnabled,
          }));
          logEvent('tengu_tips_setting_changed', {
            enabled: spinnerTipsEnabled,
          });
          return clearOrSyncLocalShadow('spinnerTipsEnabled', spinnerTipsEnabled, res.error);
        },
      },
      // densable leftover Co()?[{id:"feedbackDrafts"...}] after Show tips.
      // Co() leftover-wired as Ufs — row stays when the setting is off.
      ...(isSendFeedbackSessionEnabled()
        ? [
            {
              id: 'feedbackDrafts',
              label: 'Claude-drafted feedback',
              value: settingsData?.feedbackDrafts ?? 'notify',
              options: ['notify', 'quiet', 'off'],
              type: 'enum' as const,
              onChange(value: string) {
                const feedbackDrafts = value as FeedbackDraftsSetting;
                setFeedbackDraftsSetting(feedbackDrafts, {
                  storageV5,
                  via: 'config',
                });
                setSettingsData(prev => ({
                  ...prev,
                  feedbackDrafts,
                }));
              },
            } satisfies Setting,
          ]
        : []),
      {
        id: 'reduceMotion',
        notice: getConfigOverrideNotice('reduceMotion', 'localSettings'),
        label: 'Reduce motion',
        value: settingsData?.prefersReducedMotion ?? false,
        type: 'boolean' as const,
        onChange(prefersReducedMotion: boolean) {
          const res = F({ prefersReducedMotion });
          setSettingsData(prev => ({
            ...prev,
            prefersReducedMotion,
          }));
          // Sync to AppState so components react immediately
          setAppState(prev => ({
            ...prev,
            settings: { ...prev.settings, prefersReducedMotion },
          }));
          logEvent('tengu_reduce_motion_setting_changed', {
            enabled: prefersReducedMotion,
          });
          return clearOrSyncLocalShadow('prefersReducedMotion', prefersReducedMotion, res.error);
        },
      },
      // Official 2.1.331: clawdFileProgress (@335510558)
      ...(isClawdFileProgressRowVisible(terminalOverride)
        ? [
            {
              id: 'clawdFileProgress',
              label: 'Show Clawd carrying files',
              value: settingsData?.clawdFileProgressEnabled ?? false,
              type: 'boolean' as const,
              ...(clawdNotice !== undefined && settingsData?.clawdFileProgressEnabled === true
                ? { notice: clawdNotice }
                : {}),
              onChange(enabled: boolean) {
                const prevValue = settingsData?.clawdFileProgressEnabled;
                setSettingsData(prev => ({ ...prev, clawdFileProgressEnabled: enabled }));
                const res = F({ clawdFileProgressEnabled: enabled });
                if (res.error) {
                  setSettingsData(prev => ({ ...prev, clawdFileProgressEnabled: prevValue }));
                  return { error: res.error };
                }
                logEvent('tengu_clawd_file_progress_setting_changed', { enabled });
                setChanges(prev => ({ ...prev, 'Clawd carrying files': enabled ? 'on' : 'off' }));
                return enabled && clawdNotice !== undefined ? { messageSuffix: ` · ${clawdNotice}` } : undefined;
              },
            } satisfies Setting,
          ]
        : []),
      {
        id: 'thinking',
        label: 'Thinking mode',
        value: thinkingRequiredReason !== undefined ? true : (thinkingEnabled ?? true),
        ...(thinkingRequiredReason !== undefined
          ? {
              lock: {
                reason: thinkingRequiredReason,
                source: 'managed',
                reasonShipsOffBox: true,
                writableWhileLocked: ['true', '1', 'on', 'yes'],
              },
            }
          : {}),
        type: 'boolean' as const,
        onChange(enabled: boolean) {
          if (!enabled && thinkingRequiredReason !== undefined) {
            return { error: new ConfigSettingRefusalError(thinkingRequiredReason) };
          }
          setAppState(prev => ({ ...prev, thinkingEnabled: enabled }));
          const res = F({
            alwaysThinkingEnabled: enabled ? undefined : false,
          });
          if (res.error) return { error: res.error };
          logEvent('tengu_thinking_toggled', { enabled });
        },
      },
      // Fast mode toggle (ant-only, eliminated from external builds)
      ...(isFastModeEnabled() && isFastModeAvailable()
        ? [
            {
              id: 'fast',
              label: `Fast mode (${mainLoopModel ? modelDisplayString(mainLoopModel) : FAST_MODE_MODEL_DISPLAY})`,
              value: !!isFastMode,
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                clearFastModeCooldown();
                const res = F({
                  fastMode: enabled ? true : undefined,
                });
                if (res.error) return { error: res.error };
                if (enabled) {
                  setAppState(prev => ({
                    ...prev,
                    mainLoopModel: getFastModeModel(),
                    mainLoopModelForSession: null,
                    fastMode: true,
                  }));
                  setChanges(prev => ({
                    ...prev,
                    model: getFastModeModel(),
                    'Fast mode': 'ON',
                  }));
                } else {
                  setAppState(prev => ({
                    ...prev,
                    fastMode: false,
                  }));
                  setChanges(prev => ({ ...prev, 'Fast mode': 'OFF' }));
                }
              },
            },
          ]
        : []),
      ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_chomp_inflection', false)
        ? [
            {
              id: 'promptSuggestionEnabled',
              label: 'Prompt suggestions',
              value: promptSuggestionEnabled,
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                setAppState(prev => ({
                  ...prev,
                  promptSuggestionEnabled: enabled,
                }));
                const res = F({
                  promptSuggestionEnabled: enabled ? undefined : false,
                });
                if (res.error) return { error: res.error };
              },
            },
          ]
        : []),
      // densable 2.1.217 #1 — absent/true = on
      {
        id: 'emojiCompletionEnabled',
        label: 'Emoji shortcode completion',
        value: settingsData.emojiCompletionEnabled !== false,
        type: 'boolean' as const,
        onChange(enabled: boolean) {
          const res = F({
            emojiCompletionEnabled: enabled ? undefined : false,
          });
          if (res.error) return { error: res.error };
          setSettingsData(getInitialSettings());
        },
      },
      {
        id: 'recap',
        label: 'Session recap',
        value: settingsData?.awaySummaryEnabled !== false,
        type: 'boolean' as const,
        onChange(enabled: boolean) {
          setAppState(prev => ({
            ...prev,
            awaySummaryEnabled: enabled,
          }));
          const res = F({ awaySummaryEnabled: enabled ? undefined : false });
          if (res.error) return { error: res.error };
          setSettingsData(prev => ({
            ...prev,
            awaySummaryEnabled: enabled ? undefined : false,
          }));
        },
      },
      // densable 2.1.219 #5 — Dynamic workflow size (/config).
      // densable: E && (_ || L0()) where E = !YNt() (settings key absent).
      // Hidden when a settings file provides workflowSizeGuideline.
      // Build flag WORKFLOW_SCRIPTS stands in for densable workflows surface;
      // L0-equivalent: isWorkflowFeatureEnabled (or always when flag on so
      // users can set a default before enabling workflows).
      ...(feature('WORKFLOW_SCRIPTS') && !isWorkflowSizeGuidelineProvidedBySettings()
        ? [
            {
              id: 'workflowSizeGuideline',
              label: 'Dynamic workflow size',
              value: resolveSessionWorkflowSizeGuideline(globalConfig.workflowSizeGuideline).size,
              options: [...WORKFLOW_SIZE_GUIDELINE_ENUM_OPTIONS],
              type: 'enum' as const,
              onChange(next: string) {
                const parsed = parseWorkflowSizeGuidelineEnum(next) ?? 'unrestricted';
                W(current => {
                  if (current.workflowSizeGuideline === parsed) return current;
                  return { ...current, workflowSizeGuideline: parsed };
                });
                setGlobalConfig({
                  ...getGlobalConfig(),
                  workflowSizeGuideline: parsed,
                });
                logEvent('tengu_config_changed', {
                  setting: 'workflowSizeGuideline' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  value: parsed as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      // Official bvr: workflows + keyword when that surface is toggleable.
      ...(feature('WORKFLOW_SCRIPTS') && isWorkflowsAvailable()
        ? [
            {
              id: 'workflows',
              label: 'Dynamic workflows',
              value:
                settingsData?.disableWorkflows === true
                  ? false
                  : (settingsData?.enableWorkflows ?? resolveWorkflowsAvailability().defaultOn),
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                const fallback = resolveWorkflowsAvailability().defaultOn;
                const next = enabled === fallback ? undefined : enabled;
                const res = F({ enableWorkflows: next, disableWorkflows: undefined });
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({
                  ...prev,
                  enableWorkflows: next,
                  disableWorkflows: undefined,
                }));
                setChanges(prev => ({
                  ...prev,
                  workflows: enabled ? 'on' : 'off',
                }));
              },
            },
            {
              id: 'workflowKeywordTriggerEnabled',
              label: 'Ultracode keyword trigger',
              value: settingsData?.workflowKeywordTriggerEnabled ?? true,
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                const next = enabled ? undefined : false;
                const res = F({ workflowKeywordTriggerEnabled: next });
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({
                  ...prev,
                  workflowKeywordTriggerEnabled: next,
                }));
                setChanges(prev => ({
                  ...prev,
                  ultracodeKeywordTrigger: enabled ? 'on' : 'off',
                }));
              },
            },
          ]
        : []),
      ...(isArtifactToolRegistered()
        ? [
            {
              id: 'artifacts',
              label: 'Artifacts',
              value: settingsData?.disableArtifact === true ? false : (settingsData?.enableArtifact ?? true),
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                const next = enabled === true ? undefined : enabled;
                const res = F({ enableArtifact: next, disableArtifact: undefined });
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({
                  ...prev,
                  enableArtifact: next,
                  disableArtifact: undefined,
                }));
                setChanges(prev => ({
                  ...prev,
                  artifacts: enabled ? 'on' : 'off',
                }));
              },
            },
          ]
        : []),
      // Speculation toggle (ant-only)
      ...(process.env.USER_TYPE === 'ant'
        ? [
            {
              id: 'speculationEnabled',
              label: 'Speculative execution',
              value: globalConfig.speculationEnabled ?? true,
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                W(current => {
                  if (current.speculationEnabled === enabled) return current;
                  return {
                    ...current,
                    speculationEnabled: enabled,
                  };
                });
                setGlobalConfig({
                  ...getEffectiveGlobalConfig(),
                  speculationEnabled: enabled,
                });
                logEvent('tengu_speculation_setting_changed', {
                  enabled,
                });
              },
            },
          ]
        : []),
      ...(isFileCheckpointingAvailable
        ? [
            {
              id: 'checkpoints',
              label: 'Rewind code (checkpoints)',
              value: globalConfig.fileCheckpointingEnabled,
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                const res = B('fileCheckpointingEnabled', enabled);
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({ ...prev, fileCheckpointingEnabled: enabled }));
                setGlobalConfig({
                  ...globalConfig,
                  fileCheckpointingEnabled: enabled,
                });
                logEvent('tengu_file_history_snapshots_setting_changed', {
                  enabled: enabled,
                });
              },
            },
          ]
        : []),
      // Official 2.1.331: orgMemoryRead & orgMemoryWrites (@335512000)
      ...(showOrgMemoryRead
        ? [
            {
              id: 'orgMemoryRead',
              label: 'Synced project memory (this directory; applies next session)',
              value: projectConfig.orgMemoryRead ?? true,
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                const hadWrites = getCurrentProjectConfig().orgMemoryWrites === true;
                saveCurrentProjectConfig(prev =>
                  enabled
                    ? { ...prev, orgMemoryRead: undefined }
                    : { ...prev, orgMemoryRead: false, orgMemoryWrites: undefined, orgMemoryWritesAccount: undefined },
                );
                if (!enabled && hadWrites) {
                  logEvent('tengu_org_memory_writes_setting_changed', { enabled: false });
                }
                logEvent('tengu_org_memory_read_setting_changed', { enabled });
                setGlobalConfig({ ...globalConfig });
              },
            } satisfies Setting,
          ]
        : []),
      ...(showOrgMemoryWrites
        ? [
            {
              id: 'orgMemoryWrites',
              label:
                projectConfig.orgMemoryRead === false
                  ? 'Synced project memory writes (enable reads first)'
                  : 'Synced project memory writes (this directory; applies next session)',
              value: isOrgMemoryWritesActive(),
              canWithdraw: () => getCurrentProjectConfig().orgMemoryWrites === true,
              consentGated: true,
              type: 'boolean' as const,
              onChange(enabled: boolean) {
                const withdrawStale =
                  enabled && !isOrgMemoryWritesActive() && getCurrentProjectConfig().orgMemoryWrites === true;
                const next = withdrawStale ? false : enabled;
                if (next && getCurrentProjectConfig().orgMemoryRead === false) {
                  return { error: new ConfigSettingRefusalError('Enable synced project memory reads first') };
                }
                const accountKey = getOrgMemoryAccountKey();
                if (next && accountKey === null) {
                  return {
                    error: new ConfigSettingRefusalError(
                      'Sign in to your claude.ai account to enable synced project memory writes',
                    ),
                  };
                }
                saveCurrentProjectConfig(prev => ({
                  ...prev,
                  orgMemoryWrites: next,
                  orgMemoryWritesAccount: next ? (accountKey ?? undefined) : undefined,
                }));
                logEvent('tengu_org_memory_writes_setting_changed', { enabled: next });
                setGlobalConfig({ ...globalConfig });
              },
            } satisfies Setting,
          ]
        : []),
      {
        id: 'verbose',
        label: mapleSundial ? 'Verbose' : 'Verbose output',
        value: verbose,
        type: 'boolean',
        onChange: onChangeVerbose,
      },
      {
        id: 'progressBar',
        label: 'Terminal progress bar',
        value: globalConfig.terminalProgressBarEnabled,
        type: 'boolean' as const,
        onChange(terminalProgressBarEnabled: boolean) {
          const res = B('terminalProgressBarEnabled', terminalProgressBarEnabled);
          if (res.error) return { error: res.error };
          setSettingsData(prev => ({ ...prev, terminalProgressBarEnabled }));
          setGlobalConfig({ ...globalConfig, terminalProgressBarEnabled });
          logEvent('tengu_terminal_progress_bar_setting_changed', {
            enabled: terminalProgressBarEnabled,
          });
        },
      },
      ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_sidebar', false)
        ? [
            {
              id: 'showStatusInTerminalTab',
              label: 'Show status in terminal tab',
              value: globalConfig.showStatusInTerminalTab ?? false,
              type: 'boolean' as const,
              onChange(showStatusInTerminalTab: boolean) {
                W(current => ({
                  ...current,
                  showStatusInTerminalTab,
                }));
                setGlobalConfig({
                  ...getEffectiveGlobalConfig(),
                  showStatusInTerminalTab,
                });
                logEvent('tengu_terminal_tab_status_setting_changed', {
                  enabled: showStatusInTerminalTab,
                });
              },
            },
          ]
        : []),
      {
        id: 'turnDuration',
        label: 'Show turn duration',
        value: globalConfig.showTurnDuration,
        type: 'boolean' as const,
        onChange(showTurnDuration: boolean) {
          const res = B('showTurnDuration', showTurnDuration);
          if (res.error) return { error: res.error };
          setSettingsData(prev => ({ ...prev, showTurnDuration }));
          setGlobalConfig({ ...globalConfig, showTurnDuration });
          logEvent('tengu_show_turn_duration_setting_changed', {
            enabled: showTurnDuration,
          });
        },
      },
      // densable UJr /config — tengu_sepia_moth. Default LJr()=false.
      ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_sepia_moth', false)
        ? [
            {
              id: 'precomputeCompactionEnabled',
              label: 'Precompute compaction',
              value: settingsData?.precomputeCompactionEnabled ?? false,
              type: 'boolean' as const,
              onChange(precomputeCompactionEnabled: boolean) {
                const res = F({ precomputeCompactionEnabled });
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({
                  ...prev,
                  precomputeCompactionEnabled,
                }));
                logEvent('tengu_precompute_compaction_setting_changed', {
                  enabled: precomputeCompactionEnabled,
                });
              },
            } satisfies Setting,
          ]
        : []),
      // densable timestamps /config — tengu_silk_hinge. Persist B + AppState.
      ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_silk_hinge', false)
        ? [
            {
              id: 'timestamps',
              label: 'Show message timestamps',
              value: settingsData?.showMessageTimestamps ?? globalConfig.showMessageTimestamps ?? false,
              type: 'boolean' as const,
              onChange(showMessageTimestamps: boolean) {
                const res = B('showMessageTimestamps', showMessageTimestamps);
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({ ...prev, showMessageTimestamps }));
                setGlobalConfig({ ...globalConfig, showMessageTimestamps });
                setAppState(prev => ({ ...prev, showMessageTimestamps }));
                logEvent('tengu_show_message_timestamps_setting_changed', {
                  enabled: showMessageTimestamps,
                });
              },
            } satisfies Setting,
          ]
        : []),
      {
        id: 'timeFormat',
        label: 'Time format',
        value: String(settingsData?.timeFormat ?? 'auto'),
        options: [...TIME_FORMAT_PRESETS],
        type: 'enum' as const,
        pickToCommit: true,
        onChange(timeFormat: string) {
          const preset = TIME_FORMAT_PRESETS.find(p => p === timeFormat);
          if (!preset) return;
          const res = F({ timeFormat: preset });
          if (res.error) return { error: res.error };
          setSettingsData(prev => ({ ...prev, timeFormat: preset }));
          logEvent('tengu_time_format_setting_changed', {
            value: preset as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        },
      } satisfies Setting,
      {
        id: 'permissionMode',
        label: 'Default permission mode',
        value: currentDefaultPermissionMode,
        isDefaultValue: !settingsData?.permissions?.defaultMode,
        options: (() => {
          // Official 2.1.331 (@335518060): exclude bypassPermissions so neither panel
          // cycling nor `/config permissionMode=bypassPermissions` can enter bypass mode.
          const priorityOrder: PermissionMode[] = ['default', 'plan'];
          const excluded: PermissionMode[] = ['bypassPermissions'];
          return [
            ...priorityOrder,
            ...PERMISSION_MODES.filter(m => !priorityOrder.includes(m) && !excluded.includes(m)),
          ];
        })(),
        type: 'enum' as const,
        onChange(mode: string) {
          // Official 2.1.207: auto is a first-class external mode — no special-case mapping.
          const parsedMode = permissionModeFromString(mode);
          const validatedMode = isExternalPermissionMode(parsedMode)
            ? toExternalPermissionMode(parsedMode)
            : parsedMode;
          const userPerms = getSettingsForSource('userSettings')?.permissions;
          const result = F({
            permissions: {
              ...userPerms,
              defaultMode: validatedMode as (typeof PERMISSION_MODES)[number],
            },
          });

          if (result.error) {
            logError(result.error);
            return { error: result.error };
          }

          // Update local state to reflect the change immediately.
          // validatedMode is typed as the wide PermissionMode union but at
          // runtime is always a PERMISSION_MODES member (the options dropdown
          // is built from that array above), so this narrowing is sound.
          setSettingsData(prev => ({
            ...prev,
            permissions: {
              ...prev?.permissions,
              defaultMode: validatedMode as (typeof PERMISSION_MODES)[number],
            },
          }));
          // Track changes
          setChanges(prev => ({ ...prev, defaultPermissionMode: mode }));
          logEvent('tengu_config_changed', {
            setting: 'defaultPermissionMode' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            value: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        },
      },
      ...(feature('TRANSCRIPT_CLASSIFIER') && showAutoInDefaultModePicker
        ? [
            {
              id: 'useAutoModeDuringPlan',
              label: 'Use auto mode during plan',
              value: (settingsData as { useAutoModeDuringPlan?: boolean } | undefined)?.useAutoModeDuringPlan ?? true,
              type: 'boolean' as const,
              onChange(useAutoModeDuringPlan: boolean) {
                const res = F({
                  useAutoModeDuringPlan,
                });
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({
                  ...prev,
                  useAutoModeDuringPlan,
                }));
                // Internal writes suppress the file watcher, so
                // applySettingsChange won't fire. Reconcile directly so
                // mid-plan toggles take effect immediately.
                setAppState(prev => {
                  const next = transitionPlanAutoMode(prev.toolPermissionContext);
                  if (next === prev.toolPermissionContext) return prev;
                  return { ...prev, toolPermissionContext: next };
                });
                setChanges(prev => ({
                  ...prev,
                  'Use auto mode during plan': useAutoModeDuringPlan,
                }));
              },
            },
          ]
        : []),
      {
        id: 'worktreeBaseRef',
        label: 'Worktree base ref',
        value: settingsData?.worktree?.baseRef ?? 'fresh',
        options: ['fresh', 'head'],
        type: 'enum' as const,
        onChange(value: string) {
          const next = value === 'head' ? 'head' : 'fresh';
          const previous = settingsData?.worktree?.baseRef;
          setSettingsData(prev => ({
            ...prev,
            worktree: { ...prev?.worktree, baseRef: next },
          }));
          setChanges(prev => ({ ...prev, worktreeBaseRef: next }));
          const result = F({ worktree: { baseRef: next } });
          if (result.error) {
            setSettingsData(prev => ({
              ...prev,
              worktree: { ...prev?.worktree, baseRef: previous },
            }));
            setChanges(prev => {
              const { worktreeBaseRef: _dropped, ...rest } = prev;
              return rest;
            });
            logError(result.error);
            return { error: result.error };
          }
        },
      },
      {
        id: 'gitignore',
        label: 'Respect .gitignore in file picker',
        value: globalConfig.respectGitignore,
        type: 'boolean' as const,
        onChange(respectGitignore: boolean) {
          W(current => ({ ...current, respectGitignore }));
          setGlobalConfig({ ...getGlobalConfig(), respectGitignore });
          logEvent('tengu_respect_gitignore_setting_changed', {
            enabled: respectGitignore,
          });
        },
      },
      {
        id: 'copyFullResponse',
        label: 'Skip the /copy picker',
        value: globalConfig.copyFullResponse,
        type: 'boolean' as const,
        onChange(copyFullResponse: boolean) {
          W(current => ({ ...current, copyFullResponse }));
          setGlobalConfig({ ...getGlobalConfig(), copyFullResponse });
          logEvent('tengu_config_changed', {
            setting: 'copyFullResponse' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            value: String(copyFullResponse) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        },
      },
      // Copy-on-select is only meaningful with in-app selection (fullscreen
      // alt-screen mode). In inline mode the terminal emulator owns selection.
      ...(isFullscreenEnvEnabled()
        ? [
            {
              id: 'copyOnSelect',
              label: 'Copy on select',
              value: globalConfig.copyOnSelect ?? true,
              type: 'boolean' as const,
              onChange(copyOnSelect: boolean) {
                W(current => ({ ...current, copyOnSelect }));
                setGlobalConfig({ ...getGlobalConfig(), copyOnSelect });
                logEvent('tengu_config_changed', {
                  setting: 'copyOnSelect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  value: String(copyOnSelect) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
            // densable autoScroll (fullscreen only). Write userSettings via B.
            {
              id: 'autoScroll',
              label: 'Auto-scroll',
              value: settingsData?.autoScrollEnabled ?? globalConfig.autoScrollEnabled ?? true,
              type: 'boolean' as const,
              onChange(autoScrollEnabled: boolean) {
                const result = B('autoScrollEnabled', autoScrollEnabled);
                if (result.error) return { error: result.error };
                setGlobalConfig({ ...globalConfig, autoScrollEnabled });
                setSettingsData(prev => ({ ...prev, autoScrollEnabled }));
                logEvent('tengu_config_changed', {
                  setting: 'autoScrollEnabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  value: String(autoScrollEnabled) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
            // Official wheelScrollAccelerationEnabled (2.1.210 settings densable).
            // Only meaningful in fullscreen where app-side wheel accel runs.
            {
              id: 'wheelScrollAccelerationEnabled',
              label: 'Wheel scroll acceleration',
              value: settingsData?.wheelScrollAccelerationEnabled ?? true,
              type: 'boolean' as const,
              onChange(wheelScrollAccelerationEnabled: boolean) {
                const result = F({
                  wheelScrollAccelerationEnabled,
                });
                if (result.error) return { error: result.error };
                setSettingsData(getInitialSettings());
                logEvent('tengu_config_changed', {
                  setting:
                    'wheelScrollAccelerationEnabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  value: String(
                    wheelScrollAccelerationEnabled,
                  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      // densable w0t/z4/JEt agents rows. z4=isLeftArrowFleetEnabled; JEt=z4&&!Jl.
      ...(() => {
        if (mapleSundial) {
          if (!(fleetEnabled || leftArrowEnabled)) return [];
          return [
            {
              id: 'agentsView',
              label: 'Agents view',
              value:
                (leftArrowEnabled && (globalConfig.leftArrowOpensAgents ?? true)) ||
                (fleetEnabled && (globalConfig.defaultToAgentsView ?? false))
                  ? 'on'
                  : 'off',
              type: 'managedEnum' as const,
              onChange() {},
            } satisfies Setting,
          ];
        }
        return agentsFieldRows;
      })(),
      // autoUpdates setting is hidden - use DISABLE_AUTOUPDATER env var to control
      autoUpdaterDisabledReason
        ? {
            id: 'autoUpdatesChannel',
            label: 'Auto-update channel',
            value: 'disabled',
            type: 'managedEnum' as const,
            onChange() {},
          }
        : {
            id: 'autoUpdatesChannel',
            label: 'Auto-update channel',
            value: formatAutoUpdatesChannelDisplay(settingsData?.autoUpdatesChannel),
            type: 'managedEnum' as const,
            onChange() {
              // Handled via toggleSetting -> 'ChannelDowngrade'
            },
          },
      {
        id: 'theme',
        label: 'Theme',
        searchText: 'dark light',
        value:
          isSafeModeEnabled() && Boolean(parseCustomThemeRef(themeSetting))
            ? `${themeSetting} (disabled in safe mode)`
            : themeSetting,
        type: 'managedEnum' as const,
        options: [...THEME_SETTINGS],
        optionsHint: 'For custom themes, use /theme.',
        onChange(value: string) {
          return setTheme(value as ThemeSetting);
        },
      },
      ...(mapleSundial
        ? [
            {
              id: 'notifChannel',
              label: 'Notifications',
              value: formatShortNotifChannel(globalConfig.preferredNotifChannel),
              options: [...NOTIF_CHANNEL_OPTIONS],
              type: 'managedEnum' as const,
              onChange(notifChannel: string) {
                const nextChannel = NOTIF_CHANNEL_OPTIONS.find(opt => opt === notifChannel);
                if (!nextChannel) return;
                const res = B('preferredNotifChannel', nextChannel);
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({ ...prev, preferredNotifChannel: nextChannel }));
                setGlobalConfig({
                  ...globalConfig,
                  preferredNotifChannel: nextChannel,
                });
              },
            },
          ]
        : [
            {
              id: 'notifChannel',
              label: feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION') ? 'Local notifications' : 'Notifications',
              value: globalConfig.preferredNotifChannel,
              options: [...NOTIF_CHANNEL_OPTIONS],
              type: 'enum' as const,
              onChange(notifChannel: GlobalConfig['preferredNotifChannel']) {
                const res = B('preferredNotifChannel', notifChannel);
                if (res.error) return { error: res.error };
                setSettingsData(prev => ({ ...prev, preferredNotifChannel: notifChannel }));
                setGlobalConfig({
                  ...globalConfig,
                  preferredNotifChannel: notifChannel,
                });
              },
            },
            ...(feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION')
              ? [
                  {
                    id: 'taskCompleteNotifEnabled',
                    label: 'Push when idle',
                    value: globalConfig.taskCompleteNotifEnabled ?? false,
                    type: 'boolean' as const,
                    onChange(taskCompleteNotifEnabled: boolean) {
                      W(current => ({
                        ...current,
                        taskCompleteNotifEnabled,
                      }));
                      setGlobalConfig({
                        ...getEffectiveGlobalConfig(),
                        taskCompleteNotifEnabled,
                      });
                    },
                  },
                  {
                    id: 'inputNeededNotifEnabled',
                    label: 'Push when actions required',
                    value: globalConfig.inputNeededNotifEnabled ?? false,
                    type: 'boolean' as const,
                    onChange(inputNeededNotifEnabled: boolean) {
                      const res = B('inputNeededNotifEnabled', inputNeededNotifEnabled);
                      if (res.error) return { error: res.error };
                      setSettingsData(prev => ({ ...prev, inputNeededNotifEnabled }));
                      setGlobalConfig({
                        ...globalConfig,
                        inputNeededNotifEnabled,
                      });
                      void syncPushNotificationPreferences({ inputNeededNotifEnabled }).catch(err => {
                        logError(err instanceof Error ? err : new Error(String(err)));
                      });
                      logEvent('tengu_push_notif_pref_changed', {
                        key: 'inputNeededNotifEnabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        value: inputNeededNotifEnabled,
                      });
                    },
                  },
                  {
                    id: 'agentPushNotifEnabled',
                    label: 'Push when Claude decides',
                    value: globalConfig.agentPushNotifEnabled ?? false,
                    type: 'boolean' as const,
                    onChange(agentPushNotifEnabled: boolean) {
                      const res = B('agentPushNotifEnabled', agentPushNotifEnabled);
                      if (res.error) return { error: res.error };
                      setSettingsData(prev => ({ ...prev, agentPushNotifEnabled }));
                      setGlobalConfig({
                        ...globalConfig,
                        agentPushNotifEnabled,
                      });
                      void syncPushNotificationPreferences({ agentPushNotifEnabled }).catch(err => {
                        logError(err instanceof Error ? err : new Error(String(err)));
                      });
                      logEvent('tengu_push_notif_pref_changed', {
                        key: 'agentPushNotifEnabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        value: agentPushNotifEnabled,
                      });
                    },
                  },
                ]
              : []),
          ]),
      {
        id: 'outputStyle',
        notice: getConfigOverrideNotice('outputStyle', 'localSettings'),
        label: 'Output style',
        value:
          isSafeModeEnabled() && !Object.hasOwn(OUTPUT_STYLE_CONFIG, currentOutputStyle)
            ? `${currentOutputStyle} (disabled in safe mode)`
            : currentOutputStyle,
        type: 'managedEnum' as const,
        options: Object.keys(OUTPUT_STYLE_CONFIG),
        optionsHint: 'For custom styles, open /config.',
        async onChange(style: string) {
          if (style === currentOutputStyle) {
            return { messageSuffix: ' (already the current style)' };
          }
          if (!isSettingSourceEnabled('localSettings')) {
            return {
              error: new ConfigSettingRefusalError("Local settings are disabled; output style couldn't be saved."),
            };
          }
          setCurrentOutputStyle?.(style);
          setSettingsData(prev => ({ ...prev, outputStyle: style }));
          const res = await persistSettingsForSource('localSettings', { outputStyle: style }, undefined, storageV5);
          reportSaveResult?.(res);
          if (res.error) {
            return { error: res.error };
          }
          logEvent('tengu_output_style_changed', {
            style: style as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            settings_source: 'localSettings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          return undefined;
        },
      },
      ...(showDefaultViewPicker
        ? [
            {
              id: 'defaultView',
              label: 'Default view',
              // 'default' means the setting is unset — currently resolves to
              // transcript (main.tsx falls through when defaultView !== 'chat').
              // String() narrows the conditional-schema-spread union to string.
              value: settingsData?.defaultView === undefined ? 'default' : String(settingsData.defaultView),
              options: ['transcript', 'chat', 'default'],
              type: 'enum' as const,
              onChange(selected: string) {
                const defaultView = selected === 'default' ? undefined : (selected as 'chat' | 'transcript');
                const saveResult = updateSettingsForSource('localSettings', { defaultView });
                reportSaveResult?.(saveResult);
                if (saveResult.error) return { error: saveResult.error };
                setSettingsData(prev => ({ ...prev, defaultView }));
                const nextBrief = defaultView === 'chat';
                setAppState(prev => {
                  if (prev.isBriefOnly === nextBrief) return prev;
                  return { ...prev, isBriefOnly: nextBrief };
                });
                // Keep userMsgOptIn in sync so the tool list follows the view.
                // Two-way now (same as /brief) — accepting a cache invalidation
                // is better than leaving the tool on after switching away.
                // Reverted on Escape via initialUserMsgOptIn snapshot.
                setUserMsgOptIn(nextBrief);
                setChanges(prev => ({ ...prev, 'Default view': selected }));
                logEvent('tengu_default_view_setting_changed', {
                  value: (defaultView ?? 'unset') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      {
        id: 'language',
        label: 'Language',
        value: currentLanguage ?? 'Default (English)',
        type: 'managedEnum' as const,
        coerce: coerceLanguageConfigInput,
        optionsHint: "Any language name or ISO code (e.g. 'ja'); use 'default' for English.",
        async onChange(value: string) {
          const nextLanguage = value.toLowerCase() === 'default' ? undefined : value;
          setCurrentLanguage?.(nextLanguage);
          setSettingsData(prev => ({ ...prev, language: nextLanguage }));
          const res = await persistSettingsForSource('userSettings', { language: nextLanguage }, undefined, storageV5);
          reportSaveResult?.(res);
          if (res.error) {
            return { error: res.error };
          }
          logEvent('tengu_language_changed', {
            language: (nextLanguage ?? 'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          return undefined;
        },
      },
      {
        id: 'editor',
        label: 'Editor mode',
        // Convert 'emacs' to 'normal' for backward compatibility
        value: globalConfig.editorMode === 'emacs' ? 'normal' : globalConfig.editorMode || 'normal',
        options: ['normal', 'vim'],
        type: 'enum',
        onChange(value: string) {
          const nextMode = value === 'vim' ? 'vim' : 'normal';
          const res = B('editorMode', nextMode);
          if (res.error) return { error: res.error };
          setSettingsData(prev => ({ ...prev, editorMode: nextMode }));
          setGlobalConfig({
            ...globalConfig,
            editorMode: nextMode,
          });

          logEvent('tengu_editor_mode_changed', {
            mode: nextMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        },
      },
      // Official 2.1.331 `Ae("askUserQuestionTimeout")` (@335522900): hide when managed outside userSettings.
      ...(!isConfigSettingManagedOutsideUser('askUserQuestionTimeout')
        ? [
            {
              id: 'askUserQuestionTimeout',
              label: 'Question auto-continue timeout',
              // Official 2.1.200: default never (no auto-continue unless configured)
              consentGated: true,
              value: settingsData?.askUserQuestionTimeout ?? 'never',
              options: ['never', '60s', '5m', '10m'],
              type: 'enum' as const,
              onChange(value: string) {
                const next =
                  value === '60s' || value === '5m' || value === '10m' || value === 'never' ? value : 'never';
                const prevVal = settingsData?.askUserQuestionTimeout;
                setSettingsData(prev => ({
                  ...prev,
                  askUserQuestionTimeout: next,
                }));
                const res = F({
                  askUserQuestionTimeout: next,
                });
                if (res.error) {
                  setSettingsData(prev => ({ ...prev, askUserQuestionTimeout: prevVal }));
                  return { error: res.error };
                }
                logEvent('tengu_ask_user_question_timeout_changed', {
                  value: next as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      ...(isProposeGoalGrowthBookEnabled()
        ? [
            {
              id: 'modelProposedGoals',
              label: 'Claude-proposed goals',
              consentGated: true,
              value: settingsData?.modelProposedGoals ?? getModelProposedGoalsSetting(),
              options: ['auto', 'alwaysAsk', 'disabled'] satisfies ModelProposedGoalsSetting[],
              type: 'enum' as const,
              onChange(value: string) {
                const next = (['auto', 'alwaysAsk', 'disabled'] as const).find(item => item === value);
                if (!next) return;
                setSettingsData(prev => ({
                  ...prev,
                  modelProposedGoals: next,
                }));
                const result = F({ modelProposedGoals: next });
                if (result.error) {
                  logError(result.error);
                  return { error: result.error };
                }
                logEvent('tengu_model_proposed_goals_changed', {
                  value: next as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            } satisfies Setting,
          ]
        : []),
      // densable 2.1.232 #5 / 2.1.224: Dialog expiry (l9p) — hide when managed outside userSettings (rDa)
      ...(!isConfigSettingManagedOutsideUser('dialogExpiry')
        ? [
            {
              id: 'dialogExpiry',
              label: 'Dialog expiry',
              consentGated: true,
              value: settingsData?.dialogExpiry ?? 'default',
              options: ['default', '60s', '5m', '10m', 'never'],
              type: 'enum' as const,
              onChange(value: string) {
                const next: DialogExpiry | undefined =
                  value === '60s' || value === '5m' || value === '10m' || value === 'never' ? value : undefined;
                const prevVal = settingsData?.dialogExpiry;
                setSettingsData(prev => ({
                  ...prev,
                  dialogExpiry: next,
                }));
                const res = F({
                  dialogExpiry: next,
                });
                if (res.error) {
                  setSettingsData(prev => ({ ...prev, dialogExpiry: prevVal }));
                  return { error: res.error };
                }
                logEvent('tengu_dialog_expiry_changed', {
                  value: (value === 'default'
                    ? 'default'
                    : next) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      // densable: Messages from your other sessions (c9p) — gated by ig + rDa
      ...(isCrossSessionInboxConfigRowVisible() && !isConfigSettingManagedOutsideUser('crossSessionInbound')
        ? [
            {
              id: 'crossSessionInbound',
              label: 'Messages from your other sessions',
              consentGated: true,
              pickToCommit: true,
              value: settingsData?.crossSessionInbound ?? 'default',
              options: ['default', 'accept', 'hold', 'refuse'],
              type: 'enum' as const,
              onChange(value: string) {
                const next: CrossSessionInbound | undefined =
                  value === 'accept' || value === 'hold' || value === 'refuse' ? value : undefined;
                const prevVal = settingsData?.crossSessionInbound;
                setSettingsData(prev => ({
                  ...prev,
                  crossSessionInbound: next,
                }));
                const res = F({
                  crossSessionInbound: next,
                });
                if (res.error) {
                  setSettingsData(prev => ({ ...prev, crossSessionInbound: prevVal }));
                  return { error: res.error };
                }
                logEvent('tengu_cross_session_inbound_changed', {
                  value: (value === 'default'
                    ? 'default'
                    : next) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      // Official 2.1.331: alwaysDeliverInSession (@335527000)
      ...(isCrossSessionInboxConfigRowVisible() &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_crystalline_phoenix', true) &&
      alwaysDeliver !== undefined
        ? [
            {
              id: 'alwaysDeliverInSession',
              label: 'Always deliver in this session',
              consentGated: true,
              pickToCommit: true,
              value:
                alwaysDeliver.current === 'paused'
                  ? 'paused in bypass mode'
                  : ALWAYS_DELIVER_LABELS[alwaysDeliver.current ?? 'off'],
              options: Object.values(ALWAYS_DELIVER_LABELS),
              type: 'enum' as const,
              onChange(value: string) {
                const scope = (['mine', 'anyone'] as const).find(k => ALWAYS_DELIVER_LABELS[k] === value);
                alwaysDeliver.set(scope ? { scope, madeIn: alwaysDeliver.sessionClass } : undefined);
                setGlobalConfig({ ...globalConfig });
                logEvent('tengu_cross_session_inbound_changed', {
                  value: (scope ?? 'off') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            } satisfies Setting,
          ]
        : []),
      // Official 2.1.331: remoteMessageReceipts (@335527500)
      ...(showRemoteMessageReceipts
        ? [
            {
              id: 'remoteMessageReceipts',
              label: 'Delivery notices to and from cloud and Remote Control sessions',
              notice:
                (settingsData?.remoteMessageReceipts ?? remoteReceiptsInfo?.value) === 'always'
                  ? 'No limit on how often delivery notices, local ones too, wake Claude: two sessions can keep waking each other'
                  : undefined,
              consentGated: true,
              pickToCommit: true,
              value: settingsData?.remoteMessageReceipts ?? remoteReceiptsInfo?.value ?? 'on',
              options: ['on', 'always', 'off'],
              type: 'enum' as const,
              onChange(value: string) {
                const next = (['on', 'always', 'off'] as const).find(opt => opt === value);
                if (!next) return;
                const prevVal = settingsData?.remoteMessageReceipts;
                setSettingsData(prev => ({ ...prev, remoteMessageReceipts: next }));
                const res = F({ remoteMessageReceipts: next === 'on' ? undefined : next });
                if (res.error) {
                  setSettingsData(prev => ({ ...prev, remoteMessageReceipts: prevVal }));
                  return { error: res.error };
                }
                return undefined;
              },
            } satisfies Setting,
          ]
        : []),
      {
        id: 'externalEditorContext',
        label: mapleSundial ? 'Show responses in IDE' : 'Show last response in external editor',
        value: globalConfig.externalEditorContext ?? false,
        type: 'boolean' as const,
        onChange(externalEditorContext: boolean) {
          W(current => ({ ...current, externalEditorContext }));
          setGlobalConfig({ ...getEffectiveGlobalConfig(), externalEditorContext });
          logEvent('tengu_external_editor_context_changed', {
            enabled: externalEditorContext,
          });
        },
      },
      {
        id: 'prStatus',
        label: mapleSundial ? 'Show PR status' : 'Show PR status footer',
        value: globalConfig.prStatusFooterEnabled ?? true,
        type: 'boolean' as const,
        onChange(enabled: boolean) {
          W(current => {
            if (current.prStatusFooterEnabled === enabled) return current;
            return {
              ...current,
              prStatusFooterEnabled: enabled,
            };
          });
          setGlobalConfig({
            ...getEffectiveGlobalConfig(),
            prStatusFooterEnabled: enabled,
          });
          logEvent('tengu_pr_status_footer_setting_changed', {
            enabled,
          });
        },
      },
      {
        id: 'model',
        label: 'Model',
        searchText: 'effort',
        value: mainLoopModel === null ? 'Default (recommended)' : modelDisplayString(mainLoopModel),
        type: 'managedEnum' as const,
        options: getConfigModelOptions(),
        optionsHint: 'For a specific model ID, use /model.',
        onChange(value: string) {
          const nextModel = value.toLowerCase() === 'default' ? null : value;
          return onChangeMainModelConfig(nextModel, true);
        },
      },
      ...(isConnectedToIde
        ? [
            {
              id: 'diffTool',
              label: 'Diff tool',
              value: globalConfig.diffTool ?? 'auto',
              options: ['terminal', 'auto'],
              type: 'enum' as const,
              onChange(diffTool: string) {
                W(current => ({
                  ...current,
                  diffTool: diffTool as GlobalConfig['diffTool'],
                }));
                setGlobalConfig({
                  ...getEffectiveGlobalConfig(),
                  diffTool: diffTool as GlobalConfig['diffTool'],
                });

                logEvent('tengu_diff_tool_changed', {
                  tool: diffTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      ...(!isSupportedTerminal()
        ? [
            {
              id: 'autoConnectIde',
              label: 'Auto-connect to IDE (external terminal)',
              value: globalConfig.autoConnectIde ?? false,
              type: 'boolean' as const,
              onChange(autoConnectIde: boolean) {
                W(current => ({ ...current, autoConnectIde }));
                setGlobalConfig({ ...getEffectiveGlobalConfig(), autoConnectIde });

                logEvent('tengu_auto_connect_ide_changed', {
                  enabled: autoConnectIde,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      ...(isSupportedTerminal()
        ? [
            {
              id: 'autoInstallIdeExtension',
              label: 'Auto-install IDE extension',
              value: globalConfig.autoInstallIdeExtension ?? true,
              type: 'boolean' as const,
              onChange(autoInstallIdeExtension: boolean) {
                W(current => ({
                  ...current,
                  autoInstallIdeExtension,
                }));
                setGlobalConfig({ ...getEffectiveGlobalConfig(), autoInstallIdeExtension });

                logEvent('tengu_auto_install_ide_extension_changed', {
                  enabled: autoInstallIdeExtension,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              },
            },
          ]
        : []),
      {
        id: 'chrome',
        label: mapleSundial ? 'Claude in Chrome' : 'Claude in Chrome enabled by default',
        // Official 2.1.331 (@335525500): consent-gated under tengu_joyful_parasol (default true).
        ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_joyful_parasol', true) !== false ? { consentGated: true } : {}),
        value: globalConfig.claudeInChromeDefaultEnabled ?? false, // densable: undefined → false
        type: 'boolean' as const,
        onChange(enabled: boolean) {
          W(current => ({
            ...current,
            claudeInChromeDefaultEnabled: enabled,
          }));
          setGlobalConfig({
            ...getEffectiveGlobalConfig(),
            claudeInChromeDefaultEnabled: enabled,
          });
          logEvent('tengu_claude_in_chrome_setting_changed', {
            enabled,
          });
        },
      },
      // Teammate mode (only shown when agent swarms are enabled)
      ...(isAgentSwarmsEnabled()
        ? (() => {
            const cliOverride = getCliTeammateModeOverride();
            const label = cliOverride ? `Teammate mode [overridden: ${cliOverride}]` : 'Teammate mode';
            const isWindows = getPlatform() === 'windows';
            const teammateModeOptions = isWindows
              ? ['auto', 'tmux', 'iterm2', 'windows-terminal', 'in-process']
              : ['auto', 'tmux', 'iterm2', 'in-process'];
            return [
              {
                id: 'teammateMode',
                label,
                value: globalConfig.teammateMode ?? 'auto',
                options: teammateModeOptions,
                type: 'enum' as const,
                onChange(mode: string) {
                  if (
                    mode !== 'auto' &&
                    mode !== 'tmux' &&
                    mode !== 'iterm2' &&
                    mode !== 'windows-terminal' &&
                    mode !== 'in-process'
                  ) {
                    return;
                  }
                  if (mode === 'windows-terminal' && !isWindows) {
                    return;
                  }
                  const res = B('teammateMode', mode);
                  if (res.error) return { error: res.error };
                  // Clear CLI override and set new mode (pass mode to avoid race condition)
                  clearCliTeammateModeOverride(mode);
                  setSettingsData(prev => ({ ...prev, teammateMode: mode }));
                  setGlobalConfig({
                    ...globalConfig,
                    teammateMode: mode,
                  });
                  logEvent('tengu_teammate_mode_changed', {
                    mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  });
                },
              },
              // densable 2.1.234 #47: removed "Default teammate model" — teammates
              // follow the leader unless the spawn names a model.
            ];
          })()
        : []),
      // Remote at startup toggle — gated on build flag + GrowthBook + policy
      ...(feature('BRIDGE_MODE') && (isBridgeEnabled() || remoteControlLock !== null)
        ? [
            buildRemoteControlSettingRow(
              globalConfig.remoteControlAtStartup,
              remoteControlLock,
              applyRemoteControlChange,
            ),
          ]
        : []),
      // densable 2.1.289: so(hZ(B8())||s.remoteHomeSettingsMode==="forward")
      ...(isRemoteHomeSettingsCapabilityOpen() || globalConfig.remoteHomeSettingsMode === 'forward'
        ? [
            {
              id: 'remoteHomeSettings',
              label: "Use this machine's settings in cloud sessions",
              value: globalConfig.remoteHomeSettingsMode === 'forward',
              type: 'boolean' as const,
              consentGated: true,
              grantBlocker: probeRemoteHomeSettingsCapability(true) ?? undefined,
              onChange(enabled: boolean) {
                if (enabled) {
                  return {
                    error: new ConfigSettingRefusalError(
                      'Turn this on from the /config panel, which shows what will be sent',
                    ),
                  };
                }
                const previous = globalConfig.remoteHomeSettingsMode;
                setGlobalConfig({ ...globalConfig, remoteHomeSettingsMode: 'keep_local' });
                return persistRemoteHomeSettingsMode('keep_local', storageV5).then(result => {
                  switch (result) {
                    case 'written':
                      return;
                    case 'unconfirmed':
                      return {
                        messageSuffix:
                          ' (could not confirm it was written to the config file; check /config after restarting Claude Code)',
                      };
                    case 'not_stored':
                      setGlobalConfig({
                        ...globalConfig,
                        remoteHomeSettingsMode: getRemoteHomeSettingsMode(),
                      });
                      return {
                        error: new ConfigSettingRefusalError(remoteHomeSettingsNotStoredMessage()),
                      };
                    case 'refused':
                      setGlobalConfig({ ...globalConfig, remoteHomeSettingsMode: previous });
                      return {
                        error: new ConfigSettingRefusalError(
                          "Cloud settings forwarding isn't available right now, so nothing changed",
                        ),
                      };
                  }
                });
              },
            } satisfies Setting,
          ]
        : []),
      ...(shouldShowExternalIncludesToggle
        ? [
            {
              id: 'showExternalIncludesDialog',
              label: 'External CLAUDE.md includes',
              value: (() => {
                const projectConfig = getCurrentProjectConfig();
                if (projectConfig.hasClaudeMdExternalIncludesApproved) {
                  return 'true';
                } else {
                  return 'false';
                }
              })(),
              type: 'managedEnum' as const,
              onChange() {
                // Will be handled by toggleSetting function
              },
            },
          ]
        : []),
      ...(process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()
        ? [
            {
              id: 'apiKey',
              consentGated: true,
              label: (
                <Text>
                  Use custom API key: <Text bold>{normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY)}</Text>
                </Text>
              ),
              searchText: 'Use custom API key',
              value: Boolean(
                process.env.ANTHROPIC_API_KEY &&
                  globalConfig.customApiKeyResponses?.approved?.includes(
                    normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY),
                  ),
              ),
              type: 'boolean' as const,
              onChange(useCustomKey: boolean) {
                W(current => {
                  const updated = { ...current };
                  if (!updated.customApiKeyResponses) {
                    updated.customApiKeyResponses = {
                      approved: [],
                      rejected: [],
                    };
                  }
                  if (!updated.customApiKeyResponses.approved) {
                    updated.customApiKeyResponses = {
                      ...updated.customApiKeyResponses,
                      approved: [],
                    };
                  }
                  if (!updated.customApiKeyResponses.rejected) {
                    updated.customApiKeyResponses = {
                      ...updated.customApiKeyResponses,
                      rejected: [],
                    };
                  }
                  if (process.env.ANTHROPIC_API_KEY) {
                    const truncatedKey = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
                    if (useCustomKey) {
                      updated.customApiKeyResponses = {
                        ...updated.customApiKeyResponses,
                        approved: [
                          ...(updated.customApiKeyResponses.approved ?? []).filter(k => k !== truncatedKey),
                          truncatedKey,
                        ],
                        rejected: (updated.customApiKeyResponses.rejected ?? []).filter(k => k !== truncatedKey),
                      };
                    } else {
                      updated.customApiKeyResponses = {
                        ...updated.customApiKeyResponses,
                        approved: (updated.customApiKeyResponses.approved ?? []).filter(k => k !== truncatedKey),
                        rejected: [
                          ...(updated.customApiKeyResponses.rejected ?? []).filter(k => k !== truncatedKey),
                          truncatedKey,
                        ],
                      };
                    }
                  }
                  return updated;
                });
                void refreshPolicyLimits();
                setGlobalConfig(getEffectiveGlobalConfig());
              },
            },
          ]
        : []),
    ]) as Setting[],
  };
}

export type ConfigContextOverrides = {
  setTheme?: (setting: ThemeSetting) => unknown;
  remoteToolServingOn?: boolean;
  alwaysDeliver?: AlwaysDeliverBinding;
  terminalOverride?: string | null;
};

/**
 * densable ce — bag for hKe from a /config command context (no panel React
 * setters). Gold `shouldShowExternalIncludesToggle: !1`.
 */
export function ceFromCommandContext(
  context: LocalJSXCommandContext,
  overrides: ConfigContextOverrides = {},
): ConfigHkeBag {
  const r = context.getAppState();
  const settingsData = getInitialSettings();
  const globalConfig = getEffectiveGlobalConfig();
  const noopSetSettings: ConfigHkeBag['setSettingsData'] = () => {};
  const noopSetChanges: ConfigHkeBag['setChanges'] = () => {};
  function F(patch: SettingsJson) {
    return updateSettingsForSource('userSettings', patch, undefined, context.storageV5);
  }
  function B<K extends keyof SettingsJson>(key: K, value: SettingsJson[K]) {
    return updateSettingsForSource('userSettings', { [key]: value } as SettingsJson, undefined, context.storageV5);
  }
  function W(updater: (current: GlobalConfig) => GlobalConfig) {
    saveGlobalConfig(updater);
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const showDefaultViewPicker =
    feature('KAIROS') || feature('KAIROS_BRIEF')
      ? (
          require('@claude-code/builtin-tools/tools/BriefTool/BriefTool.js') as typeof import('@claude-code/builtin-tools/tools/BriefTool/BriefTool.js')
        ).isBriefEntitled()
      : false;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    globalConfig,
    // densable `w` — live snapshot only. Persist is W2/`B` (userSettings).
    setGlobalConfig: () => {},
    settingsData,
    setSettingsData: noopSetSettings,
    verbose: r.verbose,
    thinkingEnabled: r.thinkingEnabled,
    isFastMode: isFastModeEnabled() ? r.fastMode : false,
    promptSuggestionEnabled: r.promptSuggestionEnabled,
    mainLoopModel: r.mainLoopModel,
    currentOutputStyle: (settingsData?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME) as OutputStyle,
    currentLanguage: settingsData?.language,
    themeSetting: getThemeSetting(),
    storageV5: context.storageV5,
    isConnectedToIde: hasAccessToIDEExtensionDiffFeature(context.options?.mcpClients ?? []),
    isFileCheckpointingAvailable: !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING),
    shouldShowExternalIncludesToggle: false,
    autoUpdaterDisabledReason: getAutoUpdaterDisabledReason(),
    showDefaultViewPicker,
    showAutoInDefaultModePicker: feature('TRANSCRIPT_CLASSIFIER')
      ? hasAutoModeOptInAnySource() || getAutoModeEnabledState() === 'enabled'
      : false,
    currentDefaultPermissionMode: permissionModeFromString(settingsData?.permissions?.defaultMode ?? 'default'),
    mapleSundial: getFeatureValue_CACHED_MAY_BE_STALE('tengu_maple_sundial', false),
    remoteToolServingOn: overrides.remoteToolServingOn ?? isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_TOOL_SERVING),
    alwaysDeliver: overrides.alwaysDeliver,
    terminalOverride: overrides.terminalOverride,
    setTheme:
      overrides.setTheme ??
      ((setting: ThemeSetting) => {
        const res = saveUserIntentSetting('theme', setting, context.storageV5);
        return res.error ? { error: res.error } : undefined;
      }),
    F,
    B,
    W,
    setAppState: context.setAppState,
    setChanges: noopSetChanges,
    onChangeMainModelConfig(value) {
      if (value !== null && !isModelAllowed(value)) {
        return {
          error: new ConfigSettingRefusalError(`Model "${value}" is not allowed by your settings`),
        };
      }
      clearRefusalFallbackModelLatch('model_pick');
      if (isFastModeEnabled()) clearFastModeCooldown();
      let fastSuffix = '';
      context.setAppState(prev => {
        const prevFast = !!prev.fastMode;
        const nextFast = resolveFastModeAfterModelSwitch(value, prev.fastMode);
        const billed = isBilledAsExtraUsage(value, nextFast, isOpus1mMergeEnabled());
        const { nextFastMode, suffix } = applyFastModeOnModelSwitch(value, prev.fastMode, {
          billedAsExtraUsage: billed,
        });
        fastSuffix = suffix;
        return {
          ...prev,
          mainLoopModel: value,
          mainLoopModelForSession: null,
          ...(nextFastMode !== prevFast ? { fastMode: nextFastMode } : null),
        };
      });
      saveSessionModel(value);
      const res = F({ model: value ?? undefined });
      if (res.error) {
        return { error: res.error, ...(fastSuffix ? { messageSuffix: fastSuffix } : {}) };
      }
      return fastSuffix ? { messageSuffix: fastSuffix } : undefined;
    },
    onChangeVerbose(value) {
      const res = B('verbose', value);
      if (res.error) return { error: res.error };
      context.setAppState(prev => ({ ...prev, verbose: value }));
      return undefined;
    },
  };
}

export function Config({
  onClose,
  context,
  setTabsHidden,
  onIsSearchModeChange,
  contentHeight,
}: Props): React.ReactNode {
  const { headerFocused, focusHeader, blurHeader } = useTabHeaderFocus();
  const insideModal = useIsInsideModal();
  const [, setTheme] = useTheme();
  const themeSetting = useThemeSetting();
  const [globalConfig, setGlobalConfig] = useState(() => getEffectiveGlobalConfig());
  const initialConfig = React.useRef(getEffectiveGlobalConfig());
  const [settingsData, setSettingsData] = useState(getInitialSettings());
  const initialSettingsData = React.useRef(getInitialSettings());
  const [currentOutputStyle, setCurrentOutputStyle] = useState<OutputStyle>(
    settingsData?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME,
  );
  const initialOutputStyle = React.useRef(currentOutputStyle);
  const [currentLanguage, setCurrentLanguage] = useState<string | undefined>(settingsData?.language);
  const initialLanguage = React.useRef(currentLanguage);
  // densable 247 Ni: toggle reads he[tt()], not closed-over L / be[c??L].
  const [selectedIndex, setSelectedIndexState] = useState(0);
  const selectedIndexLive = useRef(0);
  const setSelectedIndex = (action: React.SetStateAction<number>): void => {
    const next = typeof action === 'function' ? action(selectedIndexLive.current) : action;
    selectedIndexLive.current = next;
    setSelectedIndexState(next);
  };
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const isTerminalFocused = useTerminalFocus();
  const terminalSize = useTerminalSize();
  // densable sda: size against modal columns (terminal-4) when fullscreen.
  const { rows, columns } = useModalOrTerminalSize(terminalSize);
  // densable sda X: label col = min(44, max(14, columns-16))
  const labelWidth = configLabelColumnWidth(columns);
  // densable sda: measure keyboard-hint footer (flexShrink:0) so list height
  // never steals its rows — fullscreen /config was clipping the footer.
  const footerRef = useRef<DOMElement>(null);
  const [footerHeight, setFooterHeight] = useState(1);
  // contentHeight is set by Settings.tsx (same value passed to Tabs to fix
  // pane height across all tabs — prevents layout jank when switching).
  // densable: maxVisible = max(5, contentHeight - 8 - footerHeight).
  const paneCap = contentHeight ?? Math.min(Math.floor(rows * 0.8), 30);
  const maxVisible = configMaxVisibleRows(paneCap, footerHeight);
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const verbose = useAppState(s => s.verbose);
  const thinkingEnabled = useAppState(s => s.thinkingEnabled);
  const isFastMode = useAppState(s => (isFastModeEnabled() ? s.fastMode : false));
  const promptSuggestionEnabled = useAppState(s => s.promptSuggestionEnabled);
  const enabledPlugins = useAppState(s => s.plugins.enabled);
  const [pluginConfigEpoch, setPluginConfigEpoch] = useState(0);
  // Show auto in the default-mode dropdown when the user has opted in OR the
  // config is fully 'enabled' — even if currently circuit-broken ('disabled'),
  // an opted-in user should still see it in settings (it's a temporary state).
  const showAutoInDefaultModePicker = feature('TRANSCRIPT_CLASSIFIER')
    ? hasAutoModeOptInAnySource() || getAutoModeEnabledState() === 'enabled'
    : false;
  const explicitDefaultPermissionMode = settingsData?.permissions?.defaultMode;
  const derivedDefaultPermissionIsAuto = feature('TRANSCRIPT_CLASSIFIER')
    ? !explicitDefaultPermissionMode && getAutoModeEnabledState() === 'enabled'
    : false;
  const currentDefaultPermissionMode = permissionModeFromString(
    explicitDefaultPermissionMode ?? (derivedDefaultPermissionIsAuto ? 'auto' : 'default'),
  );
  // Chat/Transcript view picker is visible to entitled users (pass the GB
  // gate) even if they haven't opted in this session — it IS the persistent
  // opt-in. 'chat' written here is read at next startup by main.tsx which
  // sets userMsgOptIn if still entitled.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const showDefaultViewPicker =
    feature('KAIROS') || feature('KAIROS_BRIEF')
      ? (
          require('@claude-code/builtin-tools/tools/BriefTool/BriefTool.js') as typeof import('@claude-code/builtin-tools/tools/BriefTool/BriefTool.js')
        ).isBriefEntitled()
      : false;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const setAppState = useSetAppState();
  const [changes, setChanges] = useState<{ [key: string]: unknown }>({});
  const initialThinkingEnabled = React.useRef(thinkingEnabled);
  // Per-source settings snapshots for revert-on-escape. getInitialSettings()
  // returns merged-across-sources which can't tell us what to delete vs
  // restore; per-source snapshots + updateSettingsForSource's
  // undefined-deletes-key semantics can. Lazy-init via useState (no setter) to
  // avoid reading settings files on every render — useRef evaluates its arg
  // eagerly even though only the first result is kept.
  const [initialLocalSettings] = useState(() => getSettingsForSource('localSettings'));
  const [initialUserSettings] = useState(() => getSettingsForSource('userSettings'));
  const initialThemeSetting = React.useRef(themeSetting);
  // AppState fields Config may modify — snapshot once at mount.
  const store = useAppStateStore();
  const [initialAppState] = useState(() => {
    const s = store.getState();
    return {
      mainLoopModel: s.mainLoopModel,
      mainLoopModelForSession: s.mainLoopModelForSession,
      verbose: s.verbose,
      thinkingEnabled: s.thinkingEnabled,
      fastMode: s.fastMode,
      promptSuggestionEnabled: s.promptSuggestionEnabled,
      awaySummaryEnabled: s.awaySummaryEnabled,
      isBriefOnly: s.isBriefOnly,
      replBridgeEnabled: s.replBridgeEnabled,
      replBridgeOutboundOnly: s.replBridgeOutboundOnly,
      settings: s.settings,
    };
  });
  // Bootstrap state snapshot — userMsgOptIn is outside AppState, so
  // revertChanges needs to restore it separately. Without this, cycling
  // defaultView to 'chat' then Escape leaves the tool active while the
  // display filter reverts — the exact ambient-activation behavior this
  // PR's entitlement/opt-in split is meant to prevent.
  const [initialUserMsgOptIn] = useState(() => getUserMsgOptIn());
  // Set on first user-visible change; gates revertChanges() on Escape so
  // opening-then-closing doesn't trigger redundant disk writes.
  const isDirty = React.useRef(false);
  const [showThinkingWarning, setShowThinkingWarning] = useState(false);
  const [showSubmenu, setShowSubmenu] = useState<SubMenu | null>(null);
  // densable Ye/Fe — setting id for EnumPicker (pickToCommit enums).
  const [enumPickerId, setEnumPickerId] = useState<string | null>(null);
  // densable Ti/Di/es/xi — setting id and draft text for TextEdit (plugin string/number).
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const [textEditValue, setTextEditValue] = useState('');
  const [textEditCursor, setTextEditCursor] = useState(0);
  // densable Pe / w0t — tengu_maple_sundial (default false).
  const mapleSundial = getFeatureValue_CACHED_MAY_BE_STALE('tengu_maple_sundial', false);
  const { addNotification } = useNotifications();
  // densable DualInk-off `Si`/`bo` — remoteHomeSettings paints on the row, not H().
  const [remoteHomeSettingsNotice, setRemoteHomeSettingsNotice] = useState<string | null>(null);
  const showConfigChangeResult = useCallback(
    (settingId: string, result: unknown) => {
      const change = asConfigSettingChange(result);
      if (settingId === 'remoteHomeSettings') {
        if (change?.error) {
          setRemoteHomeSettingsNotice(change.error.message);
        } else if (change?.messageSuffix) {
          setRemoteHomeSettingsNotice(`Saved${change.messageSuffix}`);
        } else {
          setRemoteHomeSettingsNotice(null);
        }
        return;
      }
      if (change?.error) {
        addNotification({
          key: 'config-change-refused',
          kind: 'warning',
          text: change.error.message,
          color: 'warning',
          priority: 'immediate',
        });
        return;
      }
      if (change?.messageSuffix) {
        addNotification({
          key: 'config-change-note',
          kind: 'feedback',
          text: change.messageSuffix.replace(/^ · /, ''),
          priority: 'immediate',
        });
      }
    },
    [addNotification],
  );
  // densable w/T — Lf().hasClaudeMdExternalIncludesApproved === true.
  const [externalIncludesApproved, setExternalIncludesApproved] = useState(
    () => getCurrentProjectConfig().hasClaudeMdExternalIncludesApproved === true,
  );
  // densable Jr — Pe && managedEnum && showExternalIncludesDialog && w.
  const isMapleJrExternalIncludes = useCallback(
    (setting: Setting) =>
      mapleSundial &&
      setting.type === 'managedEnum' &&
      setting.id === 'showExternalIncludesDialog' &&
      externalIncludesApproved,
    [mapleSundial, externalIncludesApproved],
  );
  // densable sda: measure keyboard-hint footer after paint so maxVisible can
  // reserve its rows (flexShrink:0 alone isn't enough when list height is
  // computed up-front).
  useLayoutEffect(() => {
    if (!footerRef.current) return;
    const h = measureElement(footerRef.current).height;
    if (h > 0 && h !== footerHeight) setFooterHeight(h);
  }, [headerFocused, isSearchMode, columns, rows, footerHeight, showSubmenu]);
  const isScreenReader = isScreenReaderModeEnabled();
  const containerRef = useRef<DOMElement>(null);
  useFocusReclaim(containerRef, isScreenReader ? false : !headerFocused);

  // #603 (2.1.328): keep synchronous refs in lockstep with isSearchMode / isSearchActive
  // so a fast burst of keystrokes entering search mode never drops characters 2..N
  // or `j`/`k` before React commits `isSearchMode = true`.
  const isSearchModeRef = useRef(isSearchMode);
  isSearchModeRef.current = isSearchMode;
  const isSearchActive = isSearchMode && showSubmenu === null && !headerFocused;
  const isSearchActiveRef = useRef(isSearchActive);
  isSearchActiveRef.current = isSearchActive;
  const setSearchModeSync = useCallback(
    (next: boolean) => {
      isSearchModeRef.current = next;
      isSearchActiveRef.current = next && showSubmenu === null && !headerFocused;
      setIsSearchMode(next);
    },
    [showSubmenu, headerFocused],
  );

  // Official 2.1.328 (#603): receive every keypress while search input is active.
  useWantEveryKey(isSearchActive);

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset,
    handleKeyDown: handleSearchKeyDown,
    handlePaste: handleSearchPaste,
  } = useSearchInput({
    isActive: isSearchActive,
    isActiveRef: isSearchActiveRef,
    onExit: () => setSearchModeSync(false),
    onExitUp: focusHeader,
    // Ctrl+C/D must reach Settings' useExitOnCtrlCD; 'd' also avoids
    // double-action (delete-char + exit-pending).
    passthroughCtrlKeys: ['c', 'd'],
  });

  // densable ps Ri=!te — Config owns Esc while the tab header is unfocused
  // (search first Esc clears/exits via handleKeyDown; list Esc uses confirm:no).
  const ownsEsc = !headerFocused;
  React.useEffect(() => {
    onIsSearchModeChange?.(ownsEsc);
  }, [ownsEsc, onIsSearchModeChange]);

  const { storageV5 } = useSessionServices();
  const isConnectedToIde = hasAccessToIDEExtensionDiffFeature(context.options.mcpClients);

  const isFileCheckpointingAvailable = !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING);

  const [saveFailedWarning, setSaveFailedWarning] = useState(false);

  // Official 2.1.327 (#395) `fx`: surface a persistent warning under the prompt
  // whenever saving a settings change to disk fails.
  const reportSaveResult = useCallback(
    <T extends { error?: Error | null } | undefined>(result: T): T => {
      if (result?.error) {
        setSaveFailedWarning(true);
        addNotification({
          key: SETTINGS_SAVE_FAILED_NOTIFICATION_KEY,
          text: SETTINGS_SAVE_FAILED_MESSAGE,
          color: 'warning',
          priority: 'medium',
        });
      }
      return result;
    },
    [addNotification],
  );

  // densable bvr F/B/W. Official: if $t() && D !== undefined, pass D as last
  // persist arg. Local has no $t()/tn().storageV5 host — disk path (omit D).
  function F(patch: SettingsJson) {
    return reportSaveResult(updateSettingsForSource('userSettings', patch));
  }
  function B<K extends keyof SettingsJson>(key: K, value: SettingsJson[K]) {
    return reportSaveResult(updateSettingsForSource('userSettings', { [key]: value } as SettingsJson));
  }
  function W(updater: (current: GlobalConfig) => GlobalConfig) {
    try {
      saveGlobalConfig(updater);
    } catch (err) {
      reportSaveResult({ error: err instanceof Error ? err : new Error(String(err)) });
    }
  }

  const memoryFiles = React.use(getMemoryFiles(true)) as MemoryFileInfo[];
  const shouldShowExternalIncludesToggle = hasExternalClaudeMdIncludes(memoryFiles);

  const autoUpdaterDisabledReason = getAutoUpdaterDisabledReason();

  const saveModelAsDefaultRef = useRef(false);

  function onChangeMainModelConfig(value: string | null, persistAsDefault = false): ConfigSettingChange | undefined {
    const previousModel = mainLoopModel;
    clearRefusalFallbackModelLatch('model_pick');
    logEvent('tengu_config_model_changed', {
      from_model: previousModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    let persistError: Error | null = null;
    if (persistAsDefault) {
      const res = F({ model: value ?? undefined });
      persistError = res.error;
      if (!persistError) {
        setSettingsData(prev => ({ ...prev, model: value ?? undefined }));
      }
    }
    saveSessionModel(value);
    // densable 2.1.218 #31 — Rft/uU/dU on `/config model=` path
    if (isFastModeEnabled()) {
      clearFastModeCooldown();
    }
    let fastSuffix = '';
    setAppState(prev => {
      const prevFast = !!prev.fastMode;
      const nextFast = resolveFastModeAfterModelSwitch(value, prev.fastMode);
      const billed = isBilledAsExtraUsage(value, nextFast, isOpus1mMergeEnabled());
      const { nextFastMode, suffix } = applyFastModeOnModelSwitch(value, prev.fastMode, {
        billedAsExtraUsage: billed,
      });
      fastSuffix = suffix;
      return {
        ...prev,
        mainLoopModel: value,
        mainLoopModelForSession: null,
        ...(nextFastMode !== prevFast ? { fastMode: nextFastMode } : null),
      };
    });
    setChanges(prev => {
      const valStr = modelDisplayString(value) + fastSuffix;
      if ('model' in prev) {
        const { model, ...rest } = prev;
        return { ...rest, model: valStr };
      }
      return { ...prev, model: valStr };
    });
    if (persistError) {
      return { error: persistError, ...(fastSuffix ? { messageSuffix: fastSuffix } : {}) };
    }
    return fastSuffix ? { messageSuffix: fastSuffix } : undefined;
  }

  function onChangeVerbose(value: boolean): ConfigSettingChange | undefined {
    const res = B('verbose', value);
    if (res.error) return { error: res.error };
    setSettingsData(prev => ({ ...prev, verbose: value }));
    setGlobalConfig({ ...globalConfig, verbose: value });

    // Update the app state for immediate UI feedback
    setAppState(prev => ({
      ...prev,
      verbose: value,
    }));
    setChanges(prev => {
      if ('verbose' in prev) {
        const { verbose, ...rest } = prev;
        return rest;
      }
      return { ...prev, verbose: value };
    });
    return undefined;
  }

  // Official 2.1.331: interactive session-scoped alwaysDeliverInSession binding.
  const currentToolPermMode = useAppState(s => s.toolPermissionContext.mode);
  const currentSessionClass: 'bypass' | 'prompting' =
    currentToolPermMode === 'bypassPermissions' ? 'bypass' : 'prompting';
  const storedAlwaysDeliver = getAlwaysDeliverInSessionState();
  const alwaysDeliverBinding: AlwaysDeliverBinding | undefined =
    isCrossSessionInboxConfigRowVisible() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_crystalline_phoenix', true) &&
    getSettingsForSource('policySettings')?.crossSessionInbound === undefined
      ? {
          current:
            storedAlwaysDeliver?.madeIn === 'prompting' && currentSessionClass === 'bypass'
              ? 'paused'
              : storedAlwaysDeliver?.scope,
          sessionClass: currentSessionClass,
          set: setAlwaysDeliverInSessionState,
        }
      : undefined;

  // TODO: Add MCP servers
  // densable U_c — section-order the rows we already have; do not invent.
  // densable Ee/IRn: append enabled-plugin userConfig rows after the core catalog.
  void pluginConfigEpoch;
  const { settings: coreSettings } = hKe({
    globalConfig,
    setGlobalConfig,
    settingsData,
    setSettingsData,
    verbose,
    thinkingEnabled,
    isFastMode,
    promptSuggestionEnabled,
    mainLoopModel,
    currentOutputStyle,
    setCurrentOutputStyle,
    currentLanguage,
    setCurrentLanguage,
    themeSetting,
    storageV5,
    isConnectedToIde,
    isFileCheckpointingAvailable,
    shouldShowExternalIncludesToggle,
    autoUpdaterDisabledReason,
    showDefaultViewPicker,
    showAutoInDefaultModePicker,
    currentDefaultPermissionMode,
    mapleSundial,
    remoteToolServingOn: isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_TOOL_SERVING),
    alwaysDeliver: alwaysDeliverBinding,
    setTheme,
    F,
    B,
    W,
    setAppState,
    setChanges,
    onChangeMainModelConfig,
    onChangeVerbose,
    reportSaveResult,
  });
  const hookOrigin: ConfigHookOrigin = getIsRemoteMode() ? { kind: 'bridge' } : { kind: 'composer' };
  const rawSettingsItems: Setting[] = weConfigPluginRows(coreSettings, enabledPlugins, {
    storageV5,
    reloadPlugins: context.reloadPlugins,
    ...(getIsRemoteMode() ? { refusal: PLUGIN_CONFIG_REMOTE_REFUSAL } : {}),
    onSaveResult: reportSaveResult,
    onPersisted() {
      setPluginConfigEpoch(n => n + 1);
    },
  }).map(item => wrapSettingWithConfigSetHook(item, hookOrigin));

  // Official 2.1.331 `_ci`: apply plugin `config.describe` hide/relabel hooks when registered.
  const [describeOverrides, setDescribeOverrides] = useState<Map<string, ConfigDescribeOverride>>(() => new Map());
  const rawSettingsIdsKey = rawSettingsItems.map(item => item.id).join('\0');
  React.useEffect(() => {
    if (!hasMatchingFunctionHook('config.describe')) {
      setDescribeOverrides(prev => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let cancelled = false;
    void describeConfigRowsWithHooks(rawSettingsItems).then(next => {
      if (!cancelled) setDescribeOverrides(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSettingsIdsKey]);

  const settingsItems: Setting[] = React.useMemo(() => {
    if (describeOverrides.size === 0) return rawSettingsItems;
    const out: Setting[] = [];
    for (const item of rawSettingsItems) {
      const override = describeOverrides.get(item.id);
      if (override?.hidden) continue;
      if (override) {
        out.push({
          ...item,
          label: override.label,
        } as Setting);
      } else {
        out.push(item);
      }
    }
    return out;
  }, [rawSettingsItems, describeOverrides]);

  // Filter settings based on search query
  const filteredSettingsItems = React.useMemo(() => {
    if (!searchQuery) return settingsItems;
    const lowerQuery = searchQuery.toLowerCase();
    return settingsItems.filter(setting => {
      if (setting.id.toLowerCase().includes(lowerQuery)) return true;
      const searchableText = 'searchText' in setting ? setting.searchText : setting.label;
      if (searchableText.toLowerCase().includes(lowerQuery)) return true;
      if (setting.type === 'enum') {
        return setting.options.some(opt => opt.toLowerCase().includes(lowerQuery));
      }
      return false;
    });
  }, [settingsItems, searchQuery]);

  // densable DualInk-off `us`/`Ki` — maple headings occupy maxVisible slots.
  const displayEntries = React.useMemo(
    () => buildConfigDisplayEntries(filteredSettingsItems, mapleSundial),
    [filteredSettingsItems, mapleSundial],
  );

  // densable Kr — EnumPicker looks up Ye on the unfiltered settings list (Dt).
  const enumPickerSetting = React.useMemo(() => {
    const found = settingsItems.find(item => item.id === enumPickerId);
    return found && found.type === 'enum' ? found : undefined;
  }, [settingsItems, enumPickerId]);

  const closeEnumPicker = useCallback(() => {
    setEnumPickerId(null);
    setShowSubmenu(null);
    setTabsHidden(false);
  }, [setTabsHidden]);

  // densable bt/ao — TextEdit looks up Ti on the unfiltered settings list.
  const textEditSetting = React.useMemo(() => {
    const found = settingsItems.find(item => item.id === textEditId);
    return found && found.type === 'managedEnum' ? found : undefined;
  }, [settingsItems, textEditId]);

  const closeTextEdit = useCallback(() => {
    setTextEditId(null);
    setShowSubmenu(null);
    setTabsHidden(false);
  }, [setTabsHidden]);

  useLayoutEffect(() => {
    if (showSubmenu === 'TextEdit' && textEditSetting === undefined) {
      closeTextEdit();
    } else if (showSubmenu === 'EnumPicker' && enumPickerSetting === undefined) {
      closeEnumPicker();
    }
  }, [showSubmenu, textEditSetting, enumPickerSetting, closeTextEdit, closeEnumPicker]);

  // densable Pi/Fl — AgentsView submenu items and toggle handler.
  const agentsViewItems = React.useMemo(
    () => [
      ...(isLeftArrowFleetEnabled() && !getIsRemoteMode()
        ? [
            {
              id: 'leftArrowOpensAgents' as const,
              label: `${figures.arrowLeft} opens agents`,
              value: globalConfig.leftArrowOpensAgents ?? true,
            },
          ]
        : []),
      ...(isLeftArrowFleetEnabled()
        ? [
            {
              id: 'defaultToAgentsView' as const,
              label: 'Open agents view by default',
              value: globalConfig.defaultToAgentsView ?? false,
            },
          ]
        : []),
    ],
    [globalConfig.leftArrowOpensAgents, globalConfig.defaultToAgentsView],
  );

  // Official 2.1.328 `Hs` (`chunk@336694628.js:10638`) — dedicated Notifications submenu rows & handlers.
  const notificationsSubmenuItems = React.useMemo(
    () => [
      {
        value: 'channel' as const,
        label: 'Channel',
        facts: [formatShortNotifChannel(globalConfig.preferredNotifChannel)],
      },
      ...(feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION')
        ? [
            {
              value: 'inputNeeded' as const,
              label: 'Notify when Claude needs you',
              facts: [formatConfigOnOffValue(globalConfig.inputNeededNotifEnabled ?? false)],
            },
            {
              value: 'done' as const,
              label: 'Notify when Claude is done',
              facts: [formatConfigOnOffValue(globalConfig.agentPushNotifEnabled ?? false)],
            },
          ]
        : []),
    ],
    [globalConfig.preferredNotifChannel, globalConfig.inputNeededNotifEnabled, globalConfig.agentPushNotifEnabled],
  );

  const handleNotificationsSubmenuSelect = useCallback(
    (index: number) => {
      const item = notificationsSubmenuItems[index];
      if (!item) return;
      isDirty.current = true;
      if (item.value === 'channel') {
        const currentIdx = NOTIF_CHANNEL_OPTIONS.indexOf(globalConfig.preferredNotifChannel);
        const nextChannel = NOTIF_CHANNEL_OPTIONS[(currentIdx + 1) % NOTIF_CHANNEL_OPTIONS.length]!;
        const res = B('preferredNotifChannel', nextChannel);
        if (res.error) {
          showConfigChangeResult('notifChannel', { error: res.error });
          return;
        }
        setSettingsData(prev => ({ ...prev, preferredNotifChannel: nextChannel }));
        setGlobalConfig(prev => ({ ...prev, preferredNotifChannel: nextChannel }));
        logEvent('tengu_config_changed', {
          setting: 'notifChannel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          value: nextChannel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      } else if (item.value === 'inputNeeded') {
        const nextVal = !(globalConfig.inputNeededNotifEnabled ?? false);
        const res = B('inputNeededNotifEnabled', nextVal);
        if (res.error) {
          showConfigChangeResult('inputNeededNotifEnabled', { error: res.error });
          return;
        }
        setSettingsData(prev => ({ ...prev, inputNeededNotifEnabled: nextVal }));
        setGlobalConfig(prev => ({ ...prev, inputNeededNotifEnabled: nextVal }));
        void syncPushNotificationPreferences({ inputNeededNotifEnabled: nextVal }).catch(err => {
          logError(err instanceof Error ? err : new Error(String(err)));
        });
        logEvent('tengu_config_changed', {
          setting: 'inputNeededNotifEnabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          value: nextVal,
        });
      } else if (item.value === 'done') {
        const nextVal = !(globalConfig.agentPushNotifEnabled ?? false);
        const res = B('agentPushNotifEnabled', nextVal);
        if (res.error) {
          showConfigChangeResult('agentPushNotifEnabled', { error: res.error });
          return;
        }
        setSettingsData(prev => ({ ...prev, agentPushNotifEnabled: nextVal }));
        setGlobalConfig(prev => ({ ...prev, agentPushNotifEnabled: nextVal }));
        void syncPushNotificationPreferences({ agentPushNotifEnabled: nextVal }).catch(err => {
          logError(err instanceof Error ? err : new Error(String(err)));
        });
        logEvent('tengu_config_changed', {
          setting: 'agentPushNotifEnabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          value: nextVal,
        });
      }
    },
    [
      notificationsSubmenuItems,
      globalConfig.preferredNotifChannel,
      globalConfig.inputNeededNotifEnabled,
      globalConfig.agentPushNotifEnabled,
      showConfigChangeResult,
    ],
  );

  const handleAgentsViewChange = useCallback((id: 'leftArrowOpensAgents' | 'defaultToAgentsView', value: boolean) => {
    isDirty.current = true;
    if (id === 'leftArrowOpensAgents') {
      W(current => ({ ...current, leftArrowOpensAgents: value }));
      setGlobalConfig(prev => ({ ...prev, leftArrowOpensAgents: value }));
    } else {
      W(current => ({ ...current, defaultToAgentsView: value }));
      setGlobalConfig(prev => ({ ...prev, defaultToAgentsView: value }));
    }
    logEvent('tengu_config_changed', {
      setting: id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      value,
    });
  }, []);

  // Adjust selected index when filtered list shrinks, and keep the selected
  // item visible when maxVisible changes (e.g., terminal resize).
  React.useEffect(() => {
    if (selectedIndex >= filteredSettingsItems.length) {
      const newIndex = Math.max(0, filteredSettingsItems.length - 1);
      setSelectedIndex(newIndex);
      const display = displayIndexForSetting(displayEntries, newIndex);
      setScrollOffset(Math.max(0, display - maxVisible + 1));
      return;
    }
    const display = displayIndexForSetting(displayEntries, selectedIndex);
    setScrollOffset(prev => {
      if (display < prev) return display;
      if (display >= prev + maxVisible) return display - maxVisible + 1;
      return prev;
    });
  }, [filteredSettingsItems.length, selectedIndex, maxVisible, displayEntries]);

  // Keep the selected item visible within the scroll window.
  // Called synchronously from navigation handlers to avoid a render frame
  // where the selected item falls outside the visible window.
  const adjustScrollOffset = useCallback(
    (newIndex: number) => {
      const display = displayIndexForSetting(displayEntries, newIndex);
      setScrollOffset(prev => {
        if (display < prev) return display;
        if (display >= prev + maxVisible) return display - maxVisible + 1;
        return prev;
      });
    },
    [maxVisible, displayEntries],
  );

  // Enter: keep all changes (already persisted by onChange handlers), close
  // with a summary of what changed.
  const handleSaveAndClose = useCallback(() => {
    // Submenu handling: each submenu has its own Enter/Esc — don't close
    // the whole panel while one is open.
    if (showSubmenu !== null) {
      return;
    }
    // Log any changes that were made
    // TODO: Make these proper messages
    const formattedChanges: string[] = Object.entries(changes).map(([key, value]) => {
      logEvent('tengu_config_changed', {
        key: key as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      return `Set ${key} to ${chalk.bold(value)}`;
    });
    // Check for API key changes
    // On homespace, ANTHROPIC_API_KEY is preserved in process.env for child
    // processes but ignored by Claude Code itself (see auth.ts).
    const effectiveApiKey = isRunningOnHomespace() ? undefined : process.env.ANTHROPIC_API_KEY;
    const initialUsingCustomKey = Boolean(
      effectiveApiKey &&
        initialConfig.current.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(effectiveApiKey)),
    );
    const currentUsingCustomKey = Boolean(
      effectiveApiKey &&
        globalConfig.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(effectiveApiKey)),
    );
    if (initialUsingCustomKey !== currentUsingCustomKey) {
      formattedChanges.push(`${currentUsingCustomKey ? 'Enabled' : 'Disabled'} custom API key`);
      logEvent('tengu_config_changed', {
        key: 'env.ANTHROPIC_API_KEY' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: currentUsingCustomKey as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
    if (themeSetting !== initialThemeSetting.current) {
      formattedChanges.push(`Set theme to ${chalk.bold(themeSetting)}`);
    }
    if (globalConfig.preferredNotifChannel !== initialConfig.current.preferredNotifChannel) {
      formattedChanges.push(`Set notifications to ${chalk.bold(globalConfig.preferredNotifChannel)}`);
    }
    if (currentOutputStyle !== initialOutputStyle.current) {
      formattedChanges.push(`Set output style to ${chalk.bold(currentOutputStyle)}`);
    }
    if (currentLanguage !== initialLanguage.current) {
      formattedChanges.push(`Set response language to ${chalk.bold(currentLanguage ?? 'Default (English)')}`);
    }
    if (globalConfig.editorMode !== initialConfig.current.editorMode) {
      formattedChanges.push(`Set editor mode to ${chalk.bold(globalConfig.editorMode || 'emacs')}`);
    }
    if (globalConfig.diffTool !== initialConfig.current.diffTool) {
      formattedChanges.push(`Set diff tool to ${chalk.bold(globalConfig.diffTool)}`);
    }
    if (globalConfig.autoConnectIde !== initialConfig.current.autoConnectIde) {
      formattedChanges.push(`${globalConfig.autoConnectIde ? 'Enabled' : 'Disabled'} auto-connect to IDE`);
    }
    if (globalConfig.autoInstallIdeExtension !== initialConfig.current.autoInstallIdeExtension) {
      formattedChanges.push(
        `${globalConfig.autoInstallIdeExtension ? 'Enabled' : 'Disabled'} auto-install IDE extension`,
      );
    }
    if (globalConfig.autoCompactEnabled !== initialConfig.current.autoCompactEnabled) {
      formattedChanges.push(`${globalConfig.autoCompactEnabled ? 'Enabled' : 'Disabled'} auto-compact`);
    }
    if (globalConfig.remoteHomeSettingsMode !== initialConfig.current.remoteHomeSettingsMode) {
      formattedChanges.push(
        `${globalConfig.remoteHomeSettingsMode === 'forward' ? 'Enabled' : 'Disabled'} using this machine's settings in cloud sessions`,
      );
    }
    if (globalConfig.autoScrollEnabled !== initialConfig.current.autoScrollEnabled) {
      formattedChanges.push(`${globalConfig.autoScrollEnabled ? 'Enabled' : 'Disabled'} auto-scroll`);
    }
    if ((settingsData?.idleCompaction ?? true) !== (initialSettingsData.current?.idleCompaction ?? true)) {
      formattedChanges.push(`${(settingsData?.idleCompaction ?? true) ? 'Enabled' : 'Disabled'} idle compaction`);
    }
    if (
      (settingsData?.autoContinueAtUsageLimit ?? true) !==
      (initialSettingsData.current?.autoContinueAtUsageLimit ?? true)
    ) {
      formattedChanges.push(
        `${(settingsData?.autoContinueAtUsageLimit ?? true) ? 'Enabled' : 'Disabled'} continue automatically at usage limit`,
      );
    }
    if (globalConfig.respectGitignore !== initialConfig.current.respectGitignore) {
      formattedChanges.push(
        `${globalConfig.respectGitignore ? 'Enabled' : 'Disabled'} respect .gitignore in file picker`,
      );
    }
    if (globalConfig.copyFullResponse !== initialConfig.current.copyFullResponse) {
      formattedChanges.push(`${globalConfig.copyFullResponse ? 'Enabled' : 'Disabled'} always copy full response`);
    }
    if (globalConfig.copyOnSelect !== initialConfig.current.copyOnSelect) {
      formattedChanges.push(`${globalConfig.copyOnSelect ? 'Enabled' : 'Disabled'} copy on select`);
    }
    if (globalConfig.leftArrowOpensAgents !== initialConfig.current.leftArrowOpensAgents) {
      formattedChanges.push(`${(globalConfig.leftArrowOpensAgents ?? true) ? 'Enabled' : 'Disabled'} ← opens agents`);
    }
    if (globalConfig.defaultToAgentsView !== initialConfig.current.defaultToAgentsView) {
      formattedChanges.push(`${globalConfig.defaultToAgentsView ? 'Enabled' : 'Disabled'} open agents view by default`);
    }
    if (
      (settingsData?.wheelScrollAccelerationEnabled ?? true) !==
      (initialSettingsData.current?.wheelScrollAccelerationEnabled ?? true)
    ) {
      formattedChanges.push(
        `${(settingsData?.wheelScrollAccelerationEnabled ?? true) ? 'Enabled' : 'Disabled'} wheel scroll acceleration`,
      );
    }
    if (globalConfig.terminalProgressBarEnabled !== initialConfig.current.terminalProgressBarEnabled) {
      formattedChanges.push(
        `${globalConfig.terminalProgressBarEnabled ? 'Enabled' : 'Disabled'} terminal progress bar`,
      );
    }
    if (globalConfig.showStatusInTerminalTab !== initialConfig.current.showStatusInTerminalTab) {
      formattedChanges.push(`${globalConfig.showStatusInTerminalTab ? 'Enabled' : 'Disabled'} terminal tab status`);
    }
    if (globalConfig.showTurnDuration !== initialConfig.current.showTurnDuration) {
      formattedChanges.push(`${globalConfig.showTurnDuration ? 'Enabled' : 'Disabled'} turn duration`);
    }
    const nextShowTimestamps = settingsData?.showMessageTimestamps ?? globalConfig.showMessageTimestamps;
    const initialShowTimestamps =
      initialSettingsData.current?.showMessageTimestamps ?? initialConfig.current.showMessageTimestamps;
    if (nextShowTimestamps !== initialShowTimestamps) {
      formattedChanges.push(`${nextShowTimestamps ? 'Enabled' : 'Disabled'} message timestamps`);
    }
    if (
      (settingsData?.precomputeCompactionEnabled ?? false) !==
      (initialSettingsData.current?.precomputeCompactionEnabled ?? false)
    ) {
      formattedChanges.push(
        `${settingsData?.precomputeCompactionEnabled ? 'Enabled' : 'Disabled'} precompute compaction`,
      );
    }
    if (globalConfig.remoteControlAtStartup !== initialConfig.current.remoteControlAtStartup) {
      const remoteLabel =
        globalConfig.remoteControlAtStartup === undefined
          ? 'Reset Remote Control to default'
          : `${globalConfig.remoteControlAtStartup ? 'Enabled' : 'Disabled'} Remote Control for all sessions`;
      formattedChanges.push(remoteLabel);
    }
    if (settingsData?.autoUpdatesChannel !== initialSettingsData.current?.autoUpdatesChannel) {
      formattedChanges.push(
        `Set auto-update channel to ${chalk.bold(
          (settingsData?.autoUpdatesChannel as string | undefined) === 'rc'
            ? 'slow'
            : (settingsData?.autoUpdatesChannel ?? 'latest'),
        )}`,
      );
    }
    if (formattedChanges.length > 0) {
      onClose(formattedChanges.join('\n'));
    } else {
      onClose('Config dialog dismissed', { display: 'system' });
    }
  }, [
    showSubmenu,
    changes,
    globalConfig,
    mainLoopModel,
    currentOutputStyle,
    currentLanguage,
    settingsData?.autoUpdatesChannel,
    settingsData?.idleCompaction,
    settingsData?.autoContinueAtUsageLimit,
    settingsData?.wheelScrollAccelerationEnabled,
    settingsData?.precomputeCompactionEnabled,
    settingsData?.showMessageTimestamps,
    isFastModeEnabled() ? (settingsData as Record<string, unknown> | undefined)?.fastMode : undefined,
    themeSetting,
    onClose,
  ]);

  // Restore all state stores to their mount-time snapshots. Changes are
  // applied to disk/AppState immediately on toggle, so "cancel" means
  // actively writing the old values back.
  const revertChanges = useCallback(() => {
    // Theme: restores ThemeProvider React state. Must run before the global
    // config overwrite since setTheme internally calls saveGlobalConfig with
    // a partial update — we want the full snapshot to be the last write.
    if (themeSetting !== initialThemeSetting.current) {
      setTheme(initialThemeSetting.current);
    }
    // Global config: full overwrite from snapshot. saveGlobalConfig skips if
    // the returned ref equals current (test mode checks ref; prod writes to
    // disk but content is identical).
    W(() => initialConfig.current);
    // Settings files: restore each key Config may have touched. undefined
    // deletes the key (updateSettingsForSource customizer at settings.ts:368).
    const il = initialLocalSettings;
    updateSettingsForSource('localSettings', {
      defaultView: il?.defaultView,
      outputStyle: il?.outputStyle,
    });
    const iu = initialUserSettings;
    F({
      spinnerTipsEnabled: iu?.spinnerTipsEnabled,
      prefersReducedMotion: iu?.prefersReducedMotion,
      alwaysThinkingEnabled: iu?.alwaysThinkingEnabled,
      autoCompactEnabled: iu?.autoCompactEnabled,
      fastMode: iu?.fastMode,
      promptSuggestionEnabled: iu?.promptSuggestionEnabled,
      autoUpdatesChannel: iu?.autoUpdatesChannel,
      minimumVersion: iu?.minimumVersion,
      language: iu?.language,
      worktree: iu?.worktree,
      workflowKeywordTriggerEnabled: iu?.workflowKeywordTriggerEnabled,
      awaySummaryEnabled: iu?.awaySummaryEnabled,
      enableWorkflows: iu?.enableWorkflows,
      disableWorkflows: iu?.disableWorkflows,
      enableArtifact: iu?.enableArtifact,
      disableArtifact: iu?.disableArtifact,
      modelProposedGoals: iu?.modelProposedGoals,
      askUserQuestionTimeout: iu?.askUserQuestionTimeout,
      dialogExpiry: iu?.dialogExpiry,
      crossSessionInbound: iu?.crossSessionInbound,
      ...(feature('TRANSCRIPT_CLASSIFIER')
        ? {
            useAutoModeDuringPlan: (iu as { useAutoModeDuringPlan?: boolean } | undefined)?.useAutoModeDuringPlan,
          }
        : {}),
      // ThemePicker's Ctrl+T writes this key directly — include it so the
      // disk state reverts along with the in-memory AppState.settings restore.
      syntaxHighlightingDisabled: iu?.syntaxHighlightingDisabled,
      // permissions: the defaultMode onChange (above) spreads the MERGED
      // settingsData.permissions into userSettings — project/policy allow/deny
      // arrays can leak to disk. Spread the full initial snapshot so the
      // mergeWith array-customizer (settings.ts:375) replaces leaked arrays.
      // Explicitly include defaultMode so undefined triggers the customizer's
      // delete path even when iu.permissions lacks that key.
      permissions:
        iu?.permissions === undefined ? undefined : { ...iu.permissions, defaultMode: iu.permissions.defaultMode },
    });
    // AppState: batch-restore all possibly-touched fields.
    const ia = initialAppState;
    setAppState(prev => ({
      ...prev,
      mainLoopModel: ia.mainLoopModel,
      mainLoopModelForSession: ia.mainLoopModelForSession,
      verbose: ia.verbose,
      thinkingEnabled: ia.thinkingEnabled,
      fastMode: ia.fastMode,
      promptSuggestionEnabled: ia.promptSuggestionEnabled,
      awaySummaryEnabled: ia.awaySummaryEnabled,
      isBriefOnly: ia.isBriefOnly,
      replBridgeEnabled: ia.replBridgeEnabled,
      replBridgeOutboundOnly: ia.replBridgeOutboundOnly,
      settings: ia.settings,
      // Reconcile auto-mode state after useAutoModeDuringPlan revert above —
      // the onChange handler may have activated/deactivated auto mid-plan.
      toolPermissionContext: transitionPlanAutoMode(prev.toolPermissionContext),
    }));
    // Bootstrap state: restore userMsgOptIn. Only touched by the defaultView
    // onChange above, so no feature() guard needed here (that path only
    // exists when showDefaultViewPicker is true).
    if (getUserMsgOptIn() !== initialUserMsgOptIn) {
      setUserMsgOptIn(initialUserMsgOptIn);
    }
  }, [
    themeSetting,
    setTheme,
    initialLocalSettings,
    initialUserSettings,
    initialAppState,
    initialUserMsgOptIn,
    setAppState,
  ]);

  // densable 2.1.289 ps: Esc closes and keeps applied changes (no revert);
  // both Enter and Space change/open the focused setting.
  void revertChanges;
  const [hoveredSettingId, setHoveredSettingId] = useState<string | null>(null);

  // Disable when submenu is open so the submenu's Dialog handles ESC, and in
  // search mode so the onKeyDown handler (which clears-then-exits search)
  // wins — otherwise Escape in search would jump straight to close.
  useKeybinding(
    'confirm:no',
    () => {
      if (isSearchModeRef.current) return false;
      handleSaveAndClose();
    },
    {
      context: 'Settings',
      isActive: showSubmenu === null && !isSearchMode && !headerFocused,
    },
  );
  // Both Enter (settings:close in defaultBindings) and Space (select:accept)
  // change/open the focused setting when not in search mode.
  useKeybinding(
    'settings:close',
    () => {
      if (isSearchModeRef.current) return false;
      toggleSetting();
    },
    {
      context: 'Settings',
      isActive: showSubmenu === null && !isSearchMode && !headerFocused,
    },
  );

  // Settings navigation and toggle actions via configurable keybindings.
  // Only active when not in search mode and no submenu is open.
  const toggleSetting = useCallback(() => {
    const setting = filteredSettingsItems[selectedIndexLive.current];
    if (!setting || !setting.onChange) {
      return;
    }

    // Official 2.1.331 (@361646200): enforce setting.lock in interactive Config UI.
    if (setting.lock !== undefined) {
      if (setting.lock.source === 'policy') {
        void refreshPolicyLimits().catch(() => {});
      }
      if (setting.lock.reason) {
        addNotification({
          key: 'config-change-refused',
          kind: 'warning',
          text: setting.lock.reason,
          color: 'warning',
          priority: 'immediate',
        });
      }
      return;
    }

    if (setting.type === 'boolean') {
      // densable: off→on with grantBlocker shows qAr copy; otherwise open RemoteHomeSettings confirmation.
      if (setting.id === 'remoteHomeSettings' && setting.value === false) {
        const blocker = setting.grantBlocker;
        if (blocker !== undefined) {
          setRemoteHomeSettingsNotice(REMOTE_HOME_SETTINGS_GRANT_BLOCKERS[blocker]);
        } else {
          setShowSubmenu('RemoteHomeSettings');
          setTabsHidden(true);
        }
        return;
      }
      isDirty.current = true;
      const next = !setting.value;
      if (setting.id === 'remoteHomeSettings') {
        setRemoteHomeSettingsNotice(null);
      }
      const pending = setting.onChange(next);
      void Promise.resolve(pending)
        .then(result => {
          showConfigChangeResult(setting.id, result);
        })
        .catch((error: unknown) => {
          logError(error);
          addNotification({
            key: 'config-change-refused',
            kind: 'warning',
            text: `Setting change failed: ${errorMessage(error)}`,
            color: 'warning',
            priority: 'immediate',
          });
        });
      if (setting.id === 'thinking') {
        const backToInitial = next === initialThinkingEnabled.current;
        if (backToInitial) {
          setShowThinkingWarning(false);
        } else if (context.messages.some(m => m.type === 'assistant')) {
          setShowThinkingWarning(true);
        }
      }
      return;
    }

    // densable Jr(Rn) → phn(false, "config_toggle") then T(false); no submenu.
    if (isMapleJrExternalIncludes(setting)) {
      recordExternalIncludesDecision(false, 'config_toggle', context);
      setExternalIncludesApproved(false);
      return;
    }

    if (setting.id === 'agentsView') {
      setShowSubmenu('AgentsView');
      setTabsHidden(true);
      return;
    }

    if (mapleSundial && setting.id === 'notifChannel') {
      setShowSubmenu('Notifications');
      setTabsHidden(true);
      return;
    }

    if (setting.provided !== undefined && setting.type === 'managedEnum') {
      const displayValue = formatSettingDisplayValue(setting);
      setTextEditId(setting.id);
      setTextEditValue(displayValue);
      setTextEditCursor(displayValue.length);
      setShowSubmenu('TextEdit');
      setTabsHidden(true);
      return;
    }

    if (
      setting.id === 'theme' ||
      setting.id === 'model' ||
      setting.id === 'showExternalIncludesDialog' ||
      setting.id === 'outputStyle' ||
      setting.id === 'language'
    ) {
      // managedEnum items open a submenu — isDirty is set by the submenu's
      // completion callback, not here (submenu may be cancelled).
      switch (setting.id) {
        case 'theme':
          setShowSubmenu('Theme');
          setTabsHidden(true);
          return;
        case 'model':
          setShowSubmenu('Model');
          setTabsHidden(true);
          return;
        case 'showExternalIncludesDialog':
          setShowSubmenu('ExternalIncludes');
          setTabsHidden(true);
          return;
        case 'outputStyle':
          setShowSubmenu('OutputStyle');
          setTabsHidden(true);
          return;
        case 'language':
          setShowSubmenu('Language');
          setTabsHidden(true);
          return;
      }
    }

    if (setting.id === 'autoUpdatesChannel') {
      if (autoUpdaterDisabledReason) {
        // Auto-updates are disabled - show enable dialog instead
        setShowSubmenu('EnableAutoUpdates');
        setTabsHidden(true);
        return;
      }
      const currentChannel = settingsData?.autoUpdatesChannel ?? 'latest';
      if (currentChannel === 'latest') {
        // Switching to stable - show downgrade dialog
        setShowSubmenu('ChannelDowngrade');
        setTabsHidden(true);
      } else {
        // Switching to latest - ask config.set hook before persisting
        void saveAutoUpdatesChannelWithConfigSetHook('latest', currentChannel, finalChannel => {
          isDirty.current = true;
          const nextChannelValue = finalChannel === 'latest' ? undefined : finalChannel;
          F({
            autoUpdatesChannel: nextChannelValue,
            minimumVersion: undefined,
          });
          setSettingsData(prev => ({
            ...prev,
            autoUpdatesChannel: nextChannelValue,
            minimumVersion: undefined,
          }));
          logEvent('tengu_autoupdate_channel_changed', {
            channel: finalChannel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        });
      }
      return;
    }

    if (setting.type === 'enum' && setting.pickToCommit) {
      setEnumPickerId(setting.id);
      setShowSubmenu('EnumPicker');
      setTabsHidden(true);
      return;
    }

    if (setting.type === 'enum') {
      isDirty.current = true;
      const currentIndex = setting.options.indexOf(setting.value);
      const nextIndex = (currentIndex + 1) % setting.options.length;
      const pending = setting.onChange(setting.options[nextIndex]!);
      void Promise.resolve(pending)
        .then(result => {
          showConfigChangeResult(setting.id, result);
        })
        .catch((error: unknown) => {
          logError(error);
          addNotification({
            key: 'config-change-refused',
            kind: 'warning',
            text: `Setting change failed: ${errorMessage(error)}`,
            color: 'warning',
            priority: 'immediate',
          });
        });
      return;
    }
  }, [
    addNotification,
    autoUpdaterDisabledReason,
    context.messages,
    filteredSettingsItems,
    isMapleJrExternalIncludes,
    settingsData?.autoUpdatesChannel,
    setTabsHidden,
    showConfigChangeResult,
  ]);

  const moveSelection = (delta: -1 | 1): void => {
    setShowThinkingWarning(false);
    const newIndex = Math.max(0, Math.min(filteredSettingsItems.length - 1, selectedIndexLive.current + delta));
    setSelectedIndex(newIndex);
    adjustScrollOffset(newIndex);
  };

  useKeybindings(
    {
      'select:previous': () => {
        if (isSearchModeRef.current) return false;
        if (selectedIndexLive.current === 0) {
          // ↑ at top enters search mode so users can type-to-filter after
          // reaching the list boundary. Wheel-up (scroll:lineUp) clamps
          // instead — overshoot shouldn't move focus away from the list.
          setShowThinkingWarning(false);
          setSearchModeSync(true);
          setScrollOffset(0);
        } else {
          moveSelection(-1);
        }
      },
      'select:next': () => {
        if (isSearchModeRef.current) return false;
        moveSelection(1);
      },
      // Wheel. ScrollKeybindingHandler's scroll:line* returns false (not
      // consumed) when the ScrollBox content fits — which it always does
      // here because the list is paginated (slice). The event falls through
      // to this handler which navigates the list, clamping at boundaries.
      'scroll:lineUp': () => {
        if (isSearchModeRef.current) return false;
        moveSelection(-1);
      },
      'scroll:lineDown': () => {
        if (isSearchModeRef.current) return false;
        moveSelection(1);
      },
      'select:accept': () => {
        if (isSearchModeRef.current) return false;
        toggleSetting();
      },
      'select:previousValue': () => {
        if (isSearchModeRef.current) return false;
        toggleSetting();
      },
      'select:nextValue': () => {
        if (isSearchModeRef.current) return false;
        toggleSetting();
      },
      'settings:search': () => {
        if (isSearchModeRef.current) return false;
        setSearchModeSync(true);
        setSearchQuery('');
      },
    },
    {
      context: 'Settings',
      isActive: showSubmenu === null && !isSearchMode && !headerFocused,
    },
  );

  // Combined key handling across search/list modes. Branch order mirrors
  // the original useInput gate priority: submenu and header short-circuit
  // first (their own handlers own input), then search vs. list.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (showSubmenu !== null) return;
      if (headerFocused) return;
      // densable Wl: search — first Esc clears query, second Esc exits search
      // (`be()` / Ye(!1)). Settings confirm:no stays ceded while header unfocused.
      if (isSearchModeRef.current) {
        if ((e.key === 'return' || e.key === 'down') && filteredSettingsItems.length === 0) {
          e.preventDefault();
          return;
        }
        handleSearchKeyDown(e);
        if (e.key === 'escape') {
          e.preventDefault();
          return;
        }
        if (e.key === 'return' || e.key === 'down' || e.key === 'wheeldown') {
          e.preventDefault();
          setSearchModeSync(false);
          setSelectedIndex(0);
          setScrollOffset(0);
          return;
        }
        if (e.defaultPrevented) return;
        if (e.key === 'tab' || e.key === 'left' || e.key === 'right') {
          e.preventDefault();
          return;
        }
        return;
      }
      if (e.defaultPrevented) return;
      // List mode: left/right/tab/return/space cycle or open the selected option's value.
      // These keys used to switch tabs; now they only do so when the tab row is
      // explicitly focused (see headerFocused in Settings.tsx).
      if (e.key === 'left' || e.key === 'right' || e.key === 'tab') {
        e.preventDefault();
        toggleSetting();
        return;
      }
      if (!e.ctrl && !e.meta && (e.key === 'return' || e.key === ' ')) {
        e.preventDefault();
        toggleSetting();
        return;
      }
      // Official 2.1.326 #125 + 2.1.328 #603: printable chars or multi-char IME / dictation input enter search; `/` opens empty search.
      if (e.ctrl || e.meta) return;
      if (e.key === 'j' || e.key === 'k') return;
      const isNamedNonPrintable =
        e.name === 'up' ||
        e.name === 'down' ||
        e.name === 'left' ||
        e.name === 'right' ||
        e.name === 'return' ||
        e.name === 'escape' ||
        e.name === 'tab' ||
        e.name === 'backspace' ||
        e.name === 'delete' ||
        e.name === 'home' ||
        e.name === 'end' ||
        e.name === 'pageup' ||
        e.name === 'pagedown';
      const isPrintableSearchInput =
        e.key.length > 0 && e.key !== ' ' && !isNamedNonPrintable && !/\p{Cc}/u.test(e.key);
      if (isPrintableSearchInput) {
        e.preventDefault();
        setSearchModeSync(true);
        setSearchQuery(e.key === '/' ? '' : e.key);
      }
    },
    [
      showSubmenu,
      headerFocused,
      searchQuery,
      setSearchModeSync,
      setSearchQuery,
      toggleSetting,
      handleSearchKeyDown,
      filteredSettingsItems.length,
    ],
  );

  return (
    <Box
      ref={containerRef}
      flexDirection="column"
      width="100%"
      {...(isScreenReader
        ? {}
        : {
            tabIndex: 0,
            autoFocus: !headerFocused,
            onKeyDown: handleKeyDown,
            onPaste: handleSearchPaste,
          })}
    >
      {showSubmenu === 'Theme' ? (
        <>
          <ThemePicker
            onThemeSelect={setting => {
              void saveThemeWithConfigSetHook(setting, saved => {
                isDirty.current = true;
                setTheme(saved);
              }).then(() => {
                setShowSubmenu(null);
                setTabsHidden(false);
              });
            }}
            onCancel={() => {
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
            helpText={
              isSafeModeEnabled()
                ? `Custom themes are disabled in safe mode — ${safeModeDisableHint()} to load them${parseCustomThemeRef(themeSetting) ? `. Your saved theme "${parseCustomThemeRef(themeSetting)}" is a custom theme; selecting a preset here replaces it` : ''}`
                : ''
            }
            hideEscToCancel
            skipExitHandling={true} // Skip exit handling as Config already handles it
          />
          <Box>
            <Text dimColor italic>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="select" />
                <ConfigurableShortcutHint
                  action="confirm:no"
                  context="Confirmation"
                  fallback="Esc"
                  description="cancel"
                />
              </Byline>
            </Text>
          </Box>
        </>
      ) : showSubmenu === 'Model' ? (
        <>
          <ModelPicker
            initial={mainLoopModel}
            onSetDefault={() => {
              saveModelAsDefaultRef.current = true;
            }}
            onSelect={(model, _effort) => {
              const persistAsDefault = saveModelAsDefaultRef.current;
              saveModelAsDefaultRef.current = false;
              const modelRow = coreSettings.find(item => item.id === 'model');
              const commit = (chosen: string | null) => {
                isDirty.current = true;
                return onChangeMainModelConfig(chosen, persistAsDefault);
              };
              const pending =
                modelRow !== undefined && modelRow.type === 'managedEnum' && hasMatchingFunctionHook('config.set')
                  ? wrapSettingWithConfigSetHook(
                      {
                        ...modelRow,
                        onChange: (val: string) => commit(val === 'default' ? null : val),
                      },
                      hookOrigin,
                    ).onChange(model ?? 'default')
                  : commit(model);
              void Promise.resolve(pending)
                .then(res => showConfigChangeResult('model', res))
                .catch((error: unknown) => {
                  logError(error);
                  addNotification({
                    key: 'model-switch-blocked',
                    kind: 'warning',
                    text: `Couldn't switch model: ${errorMessage(error)}`,
                    color: 'warning',
                    priority: 'immediate',
                  });
                });
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
            onCancel={() => {
              saveModelAsDefaultRef.current = false;
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
            showFastModeNotice={
              isFastModeEnabled()
                ? isFastMode && isFastModeSupportedByModel(mainLoopModel) && isFastModeAvailable()
                : false
            }
          />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="cancel"
              />
            </Byline>
          </Text>
        </>
      ) : showSubmenu === 'RemoteHomeSettings' ? (
        <RemoteHomeSettingsConfirmation
          configHome={getClaudeConfigHomeDir()}
          storageV5={storageV5}
          onDone={result => {
            setRemoteHomeSettingsNotice(
              result === 'not_saved'
                ? REMOTE_HOME_SETTINGS_GRANT_BLOCKERS.flag_off
                : result === 'not_stored'
                  ? remoteHomeSettingsNotStoredMessage()
                  : null,
            );
            if (result === 'forward') {
              logEvent('tengu_config_changed', {
                setting: 'remoteHomeSettings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                value: true,
              });
            }
            if (result === 'forward' || result === 'keep_local') {
              isDirty.current = true;
              setGlobalConfig(prev => ({
                ...prev,
                remoteHomeSettingsMode: getGlobalConfig().remoteHomeSettingsMode,
              }));
            }
            setShowSubmenu(null);
            setTabsHidden(false);
          }}
        />
      ) : showSubmenu === 'ExternalIncludes' ? (
        <>
          <ClaudeMdExternalIncludesDialog
            onDone={() => {
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
            externalIncludes={getExternalClaudeMdIncludes(memoryFiles as MemoryFileInfo[])}
          />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="disable external includes"
              />
            </Byline>
          </Text>
        </>
      ) : showSubmenu === 'OutputStyle' ? (
        <>
          <OutputStylePicker
            initialStyle={currentOutputStyle}
            onComplete={style => {
              setShowSubmenu(null);
              setTabsHidden(false);
              const styleRow = coreSettings.find(item => item.id === 'outputStyle');
              const commit = (chosen: string) => {
                isDirty.current = true;
                const nextStyle = chosen || DEFAULT_OUTPUT_STYLE_NAME;
                setCurrentOutputStyle(nextStyle);
                const res = reportSaveResult(
                  updateSettingsForSource('localSettings', {
                    outputStyle: chosen || undefined,
                  }),
                );
                if (res.error) return { error: res.error };
                void logEvent('tengu_output_style_changed', {
                  style: nextStyle as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  settings_source: 'localSettings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
                return undefined;
              };
              const pending =
                styleRow !== undefined && styleRow.type === 'managedEnum' && hasMatchingFunctionHook('config.set')
                  ? wrapSettingWithConfigSetHook(
                      { ...styleRow, options: undefined, onChange: commit },
                      hookOrigin,
                    ).onChange(style ?? DEFAULT_OUTPUT_STYLE_NAME)
                  : commit(style ?? '');
              void Promise.resolve(pending).then(res => showConfigChangeResult('outputStyle', res));
            }}
            onCancel={() => {
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
          />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="cancel"
              />
            </Byline>
          </Text>
        </>
      ) : showSubmenu === 'Language' ? (
        <>
          <LanguagePicker
            initialLanguage={currentLanguage}
            onComplete={language => {
              setShowSubmenu(null);
              setTabsHidden(false);
              const langRow = coreSettings.find(item => item.id === 'language');
              const commit = (chosen: string) => {
                isDirty.current = true;
                const nextLang = chosen && chosen.toLowerCase() !== 'default' ? chosen : undefined;
                setCurrentLanguage(nextLang);
                const res = F({
                  language: nextLang,
                });
                if (res.error) return { error: res.error };
                void logEvent('tengu_language_changed', {
                  language: (nextLang ?? 'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
                return undefined;
              };
              const pending =
                langRow !== undefined && langRow.type === 'managedEnum' && hasMatchingFunctionHook('config.set')
                  ? wrapSettingWithConfigSetHook({ ...langRow, onChange: commit }, hookOrigin).onChange(language ?? '')
                  : commit(language ?? '');
              void Promise.resolve(pending).then(res => showConfigChangeResult('language', res));
            }}
            onCancel={() => {
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
          />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </>
      ) : showSubmenu === 'AgentsView' ? (
        <Dialog
          title="Agents view"
          onCancel={() => {
            setShowSubmenu(null);
            setTabsHidden(false);
          }}
          hideBorder
          hideInputGuide
        >
          <Select
            hideIndexes={!isScreenReaderModeEnabled()}
            options={agentsViewItems.map(item => ({
              label: `${item.label}: ${item.value}`,
              value: item.id,
            }))}
            onChange={(id: string) => {
              const target = agentsViewItems.find(item => item.id === id);
              if (target) {
                handleAgentsViewChange(target.id, !target.value);
              }
            }}
            onCancel={() => {
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
          />
          <Text dimColor italic>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter/Space" action="toggle" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="go back"
              />
            </Byline>
          </Text>
        </Dialog>
      ) : showSubmenu === 'Notifications' ? (
        <Dialog
          title="Notifications"
          onCancel={() => {
            setShowSubmenu(null);
            setTabsHidden(false);
          }}
          hideBorder
          inputGuide={
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="change" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="go back"
              />
            </Byline>
          }
        >
          <ItemList
            options={notificationsSubmenuItems}
            visibleOptionCount={6}
            onSelect={handleNotificationsSubmenuSelect}
            onCancel={() => {
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
          />
        </Dialog>
      ) : showSubmenu === 'EnumPicker' && enumPickerSetting ? (
        <>
          <Dialog
            title={enumPickerSetting.label}
            subtitle={
              enumPickerSetting.provided === undefined
                ? undefined
                : `${enumPickerSetting.provided.description} · ${enumPickerSetting.provided.plugin}`
            }
            onCancel={closeEnumPicker}
            hideBorder
            hideInputGuide
          >
            <Select
              hideIndexes={!isScreenReaderModeEnabled()}
              options={enumPickerSetting.options.map(option => ({
                label: option,
                value: option,
              }))}
              defaultValue={String(enumPickerSetting.value)}
              defaultFocusValue={String(enumPickerSetting.value)}
              onChange={(value: string) => {
                closeEnumPicker();
                isDirty.current = true;
                const pending = enumPickerSetting.onChange(value);
                void Promise.resolve(pending)
                  .then(result => {
                    showConfigChangeResult(enumPickerSetting.id, result);
                  })
                  .catch((error: unknown) => {
                    logError(error);
                    addNotification({
                      key: 'config-change-refused',
                      kind: 'warning',
                      text: `Setting change failed: ${errorMessage(error)}`,
                      color: 'warning',
                      priority: 'immediate',
                    });
                  });
              }}
              onCancel={closeEnumPicker}
            />
          </Dialog>
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </>
      ) : showSubmenu === 'TextEdit' && textEditSetting ? (
        <Dialog
          title={textEditSetting.label}
          subtitle={
            textEditSetting.provided === undefined
              ? undefined
              : `${textEditSetting.provided.description} · ${textEditSetting.provided.plugin}`
          }
          onCancel={closeTextEdit}
          hideBorder
          hideInputGuide
        >
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1}>
              <Text color="suggestion">{figures.pointer}</Text>
              <Text>{textEditSetting.label}</Text>
              <TextInput
                value={textEditValue}
                onChange={setTextEditValue}
                onSubmit={() => {
                  const validationError =
                    textEditSetting.coerce && textEditSetting.coerce(textEditValue) === undefined
                      ? (textEditSetting.optionsHint ?? 'Not a value it takes')
                      : null;
                  if (validationError !== null) return;
                  const next = textEditSetting.coerce?.(textEditValue) ?? textEditValue;
                  closeTextEdit();
                  if (next !== formatSettingDisplayValue(textEditSetting)) {
                    isDirty.current = true;
                    const pending = textEditSetting.onChange(next);
                    void Promise.resolve(pending)
                      .then(result => {
                        showConfigChangeResult(textEditSetting.id, result);
                      })
                      .catch((error: unknown) => {
                        logError(error);
                        addNotification({
                          key: 'config-change-refused',
                          kind: 'warning',
                          text: `Setting change failed: ${errorMessage(error)}`,
                          color: 'warning',
                          priority: 'immediate',
                        });
                      });
                  }
                }}
                onExit={closeTextEdit}
                focus
                showCursor
                columns={60}
                cursorOffset={textEditCursor}
                onChangeCursorOffset={setTextEditCursor}
              />
            </Box>
            {textEditSetting.coerce && textEditSetting.coerce(textEditValue) === undefined ? (
              <Text color="error">{textEditSetting.optionsHint ?? 'Not a value it takes'}</Text>
            ) : null}
            <Text dimColor>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="continue" />
                <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
              </Byline>
            </Text>
          </Box>
        </Dialog>
      ) : showSubmenu === 'EnableAutoUpdates' ? (
        <Dialog
          title="Enable auto-updates"
          onCancel={() => {
            setShowSubmenu(null);
            setTabsHidden(false);
          }}
          hideBorder
          hideInputGuide
        >
          {autoUpdaterDisabledReason?.type !== 'config' ? (
            <>
              <Text>
                {autoUpdaterDisabledReason?.type === 'env'
                  ? "Auto-updates are set by an environment variable and can't be changed here."
                  : 'Auto-updates are disabled in development builds.'}
              </Text>
              {autoUpdaterDisabledReason?.type === 'env' && (
                <Text dimColor>Unset {autoUpdaterDisabledReason.envVar} to re-enable auto-updates.</Text>
              )}
            </>
          ) : (
            <Select
              hideIndexes={!isScreenReaderModeEnabled()}
              options={[
                {
                  label: 'Enable with latest channel',
                  value: 'latest',
                },
                {
                  label: 'Enable with stable channel',
                  value: 'stable',
                },
              ]}
              onChange={(channel: string) => {
                setShowSubmenu(null);
                setTabsHidden(false);

                const nextChannel = channel as 'latest' | 'stable';
                const previousChannel = (settingsData?.autoUpdatesChannel ?? 'latest') as 'latest' | 'stable';
                void saveAutoUpdatesChannelWithConfigSetHook(nextChannel, previousChannel, finalChannel => {
                  isDirty.current = true;
                  W(current => ({
                    ...current,
                    autoUpdates: true,
                  }));
                  setGlobalConfig({ ...getGlobalConfig(), autoUpdates: true });

                  F({
                    autoUpdatesChannel: finalChannel,
                    minimumVersion: undefined,
                  });
                  setSettingsData(prev => ({
                    ...prev,
                    autoUpdatesChannel: finalChannel,
                    minimumVersion: undefined,
                  }));
                  logEvent('tengu_autoupdate_enabled', {
                    channel: finalChannel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  });
                });
              }}
            />
          )}
        </Dialog>
      ) : showSubmenu === 'ChannelDowngrade' ? (
        <ChannelDowngradeDialog
          currentVersion={MACRO.VERSION}
          onChoice={(choice: ChannelDowngradeChoice) => {
            setShowSubmenu(null);
            setTabsHidden(false);

            if (choice === 'cancel') {
              // User cancelled - don't change anything
              return;
            }

            const previousChannel = (settingsData?.autoUpdatesChannel ?? 'latest') as 'latest' | 'stable';
            void saveAutoUpdatesChannelWithConfigSetHook('stable', previousChannel, finalChannel => {
              isDirty.current = true;
              const newSettings: {
                autoUpdatesChannel: 'latest' | 'stable';
                minimumVersion?: string;
              } = {
                autoUpdatesChannel: finalChannel,
              };

              if (finalChannel === 'stable' && choice === 'stay') {
                // User wants to stay on current version until stable catches up
                newSettings.minimumVersion = MACRO.VERSION;
              }

              F(newSettings);
              setSettingsData(prev => ({
                ...prev,
                ...newSettings,
              }));
              logEvent('tengu_autoupdate_channel_changed', {
                channel: finalChannel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                minimum_version_set: finalChannel === 'stable' && choice === 'stay',
              });
            });
          }}
        />
      ) : (
        <Box flexDirection="column" gap={1} marginY={insideModal ? undefined : 1}>
          <Box
            onClick={() => {
              if (headerFocused) blurHeader();
              setSearchModeSync(true);
            }}
          >
            <SearchBox
              query={searchQuery}
              isFocused={isSearchMode && !headerFocused}
              isTerminalFocused={isTerminalFocused}
              cursorOffset={searchCursorOffset}
              placeholder="Search settings…"
            />
          </Box>
          <Box
            flexDirection="column"
            onWheel={(e: WheelEvent) => {
              if (showSubmenu !== null || filteredSettingsItems.length === 0 || e.deltaY === 0) return;
              e.stopImmediatePropagation();
              if (headerFocused) blurHeader();
              if (isSearchModeRef.current) setSearchModeSync(false);
              moveSelection(e.deltaY > 0 ? 1 : -1);
            }}
          >
            {filteredSettingsItems.length === 0 ? (
              <Text dimColor>No settings match &quot;{searchQuery}&quot;</Text>
            ) : (
              <>
                {scrollOffset > 0 && (
                  <Text dimColor>
                    {figures.arrowUp} {scrollOffset} more above
                  </Text>
                )}
                {displayEntries.slice(scrollOffset, scrollOffset + maxVisible).map(entry => {
                  if (entry.kind === 'heading') {
                    return (
                      <Text key={entry.key} wrap="truncate-end">
                        <Text bold>{entry.heading.name}</Text>
                        {entry.heading.note !== undefined ? <Text dimColor>{`  ${entry.heading.note}`}</Text> : null}
                      </Text>
                    );
                  }
                  const setting = entry.item;
                  const isSelected = entry.settingIndex === selectedIndex && !headerFocused && !isSearchMode;
                  const isHovered = hoveredSettingId === setting.id;
                  return (
                    <React.Fragment key={setting.id}>
                      {/* densable sda row: fixed label width + flexGrow value with minWidth:0
                          so values wrap/truncate inside the panel instead of past the edge. */}
                      <Box
                        width="100%"
                        onClick={e => {
                          e.stopImmediatePropagation();
                          if (headerFocused) blurHeader();
                          if (isSearchModeRef.current) setSearchModeSync(false);
                          const alreadySelected = isSelected;
                          setShowThinkingWarning(false);
                          setSelectedIndex(entry.settingIndex);
                          adjustScrollOffset(entry.settingIndex);
                          if (alreadySelected) {
                            toggleSetting();
                          }
                        }}
                      >
                        <Box width={labelWidth} flexShrink={0} marginRight={1}>
                          <Text color={isSelected ? 'suggestion' : undefined} wrap="truncate-end">
                            {isSelected ? figures.pointer : ' '} {setting.label}
                          </Text>
                        </Box>
                        <Box
                          flexGrow={1}
                          minWidth={0}
                          backgroundColor={isHovered ? 'userMessageBackgroundHover' : undefined}
                          onMouseEnter={() => setHoveredSettingId(setting.id)}
                          onMouseLeave={() => setHoveredSettingId(prev => (prev === setting.id ? null : prev))}
                          onClick={e => {
                            e.stopImmediatePropagation();
                            if (headerFocused) blurHeader();
                            if (isSearchModeRef.current) setSearchModeSync(false);
                            setShowThinkingWarning(false);
                            setSelectedIndex(entry.settingIndex);
                            adjustScrollOffset(entry.settingIndex);
                            toggleSetting();
                          }}
                        >
                          {setting.type === 'boolean' ? (
                            <>
                              <Text
                                color={isSelected ? 'suggestion' : undefined}
                                dimColor={setting.lock !== undefined && !isSelected}
                                wrap="truncate-end"
                              >
                                {formatConfigOnOffValue(setting.value)}
                              </Text>
                              {setting.lock?.reason && (
                                <Text dimColor wrap="truncate-end">
                                  {` · ${setting.lock.reason}`}
                                </Text>
                              )}
                              {showThinkingWarning && setting.id === 'thinking' && (
                                <Text color="warning" wrap="truncate-end">
                                  {' '}
                                  Changing thinking mode mid-conversation slows responses and may lower quality.
                                </Text>
                              )}
                              {setting.id === 'remoteHomeSettings' && remoteHomeSettingsNotice !== null && (
                                <Text color="warning" wrap="truncate-end">
                                  {` ⚠ ${remoteHomeSettingsNotice}`}
                                </Text>
                              )}
                            </>
                          ) : setting.id === 'theme' ? (
                            <Text
                              color={isSelected ? 'suggestion' : undefined}
                              dimColor={setting.lock !== undefined && !isSelected}
                              wrap="truncate-end"
                            >
                              {THEME_LABELS[setting.value.toString()] ?? setting.value.toString()}
                            </Text>
                          ) : setting.id === 'notifChannel' && !mapleSundial ? (
                            <Text
                              color={isSelected ? 'suggestion' : undefined}
                              dimColor={setting.lock !== undefined && !isSelected}
                              wrap="truncate-end"
                            >
                              <NotifChannelLabel value={setting.value.toString()} />
                            </Text>
                          ) : setting.id === 'permissionMode' ? (
                            <Text
                              color={isSelected ? 'suggestion' : undefined}
                              dimColor={setting.lock !== undefined && !isSelected}
                              wrap="truncate-end"
                            >
                              {permissionModeShortTitle(setting.value as PermissionMode)}
                              {(setting as { isDefaultValue?: boolean }).isDefaultValue ? ' (default)' : ''}
                            </Text>
                          ) : setting.id === 'autoUpdatesChannel' && autoUpdaterDisabledReason ? (
                            <Box flexDirection="column" minWidth={0}>
                              <Text color={isSelected ? 'suggestion' : undefined}>disabled</Text>
                              <Text dimColor wrap="truncate-end">
                                ({formatAutoUpdaterDisabledReason(autoUpdaterDisabledReason)})
                              </Text>
                            </Box>
                          ) : (
                            <>
                              <Text
                                color={isSelected ? 'suggestion' : undefined}
                                dimColor={setting.lock !== undefined && !isSelected}
                                wrap="truncate-end"
                              >
                                {formatConfigOnOffValue(setting.value.toString(), setting.provided !== undefined)}
                              </Text>
                              {setting.lock?.reason && (
                                <Text dimColor wrap="truncate-end">
                                  {` · ${setting.lock.reason}`}
                                </Text>
                              )}
                            </>
                          )}
                          {mapleSundial &&
                            setting.lock === undefined &&
                            ((setting.type === 'enum' && setting.pickToCommit === true) ||
                              (setting.type === 'managedEnum' &&
                                !isMapleJrExternalIncludes(setting) &&
                                (setting.id !== 'autoUpdatesChannel' ||
                                  autoUpdaterDisabledReason !== null ||
                                  (settingsData?.autoUpdatesChannel ?? 'latest') === 'latest'))) && (
                              <Text color={isSelected ? 'suggestion' : 'permission'} dimColor>
                                {` ${figures.pointerSmall}`}
                              </Text>
                            )}
                        </Box>
                      </Box>
                    </React.Fragment>
                  );
                })}
                {scrollOffset + maxVisible < displayEntries.length && (
                  <Text dimColor>
                    {figures.arrowDown} {displayEntries.length - scrollOffset - maxVisible} more below
                  </Text>
                )}
              </>
            )}
          </Box>
          {/* densable sda: footer is flexShrink:0 + measured so list maxVisible
              never eats its rows (fullscreen /config keyboard-hint clip). */}
          <Box ref={footerRef} flexDirection="column" flexShrink={0} minWidth={0}>
            {!headerFocused &&
              !isSearchMode &&
              (() => {
                const activeSetting = filteredSettingsItems[selectedIndex];
                const lockReason = activeSetting?.lock?.reason;
                const overrideNote = activeSetting
                  ? (activeSetting.notice ?? getConfigOverrideNotice(activeSetting.id))
                  : undefined;
                return (
                  <>
                    {lockReason ? (
                      <Text dimColor wrap="wrap">
                        {lockReason}
                      </Text>
                    ) : null}
                    {overrideNote ? (
                      <Text color="warning" wrap="wrap">
                        {overrideNote}
                      </Text>
                    ) : null}
                  </>
                );
              })()}
            {saveFailedWarning ? (
              <Text color="warning" wrap="wrap">
                {SETTINGS_SAVE_FAILED_MESSAGE}
              </Text>
            ) : null}
            {headerFocused ? (
              <Text dimColor italic wrap="truncate-end">
                <Byline>
                  <KeyboardShortcutHint shortcut="←/→ tab" action="switch" />
                  <KeyboardShortcutHint shortcut="↓" action="return" />
                  <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="close" />
                </Byline>
              </Text>
            ) : isSearchMode ? (
              <Text dimColor italic wrap="truncate-end">
                <Byline>
                  <Text>Type to filter</Text>
                  <KeyboardShortcutHint shortcut="Enter/↓" action="select" />
                  <KeyboardShortcutHint shortcut="↑" action="tabs" />
                  <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="clear" />
                </Byline>
              </Text>
            ) : (
              <Text dimColor italic wrap="truncate-end">
                <Byline>
                  <KeyboardShortcutHint shortcut="enter/space" action="change" />
                  <ConfigurableShortcutHint
                    action="settings:search"
                    context="Settings"
                    fallback="/"
                    description="search"
                  />
                  <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="close" />
                </Byline>
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

const THEME_LABELS: Record<string, string> = {
  auto: 'Auto (match terminal)',
  dark: 'Dark mode',
  light: 'Light mode',
  'dark-daltonized': 'Dark mode (colorblind-friendly)',
  'light-daltonized': 'Light mode (colorblind-friendly)',
  'dark-ansi': 'Dark mode (ANSI colors only)',
  'light-ansi': 'Light mode (ANSI colors only)',
};

function NotifChannelLabel({ value }: { value: string }): React.ReactNode {
  switch (value) {
    case 'auto':
      return 'Auto';
    case 'iterm2':
      return (
        <Text>
          iTerm2 <Text dimColor>(OSC 9)</Text>
        </Text>
      );
    case 'terminal_bell':
      return (
        <Text>
          Terminal bell <Text dimColor>(\a)</Text>
        </Text>
      );
    case 'kitty':
      return (
        <Text>
          Kitty <Text dimColor>(OSC 99)</Text>
        </Text>
      );
    case 'ghostty':
      return (
        <Text>
          Ghostty <Text dimColor>(OSC 777)</Text>
        </Text>
      );
    case 'iterm2_with_bell':
      return 'iTerm2 with bell';
    case 'notifications_disabled':
      return 'Disabled';
    default:
      return value;
  }
}
