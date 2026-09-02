// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import {
  type DOMElement,
  type KeyboardEvent,
  Box,
  Text,
  measureElement,
  useTheme,
  useThemeSetting,
  useTerminalFocus,
} from '@anthropic/ink';
import * as React from 'react';
import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import figures from 'figures';
import { type GlobalConfig, saveGlobalConfig, getCurrentProjectConfig, type OutputStyle } from '../../utils/config.js';
import { normalizeApiKeyForConfig } from '../../utils/authPortable.js';
import {
  getGlobalConfig,
  getAutoUpdaterDisabledReason,
  formatAutoUpdaterDisabledReason,
  getRemoteControlAtStartup,
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
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js';
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js';
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
  updateSettingsForSource,
  type CrossSessionInbound,
  type DialogExpiry,
} from '../../utils/settings/settings.js';
import { isSettingSourceEnabled } from '../../utils/settings/constants.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { getIsRemoteMode, getUserMsgOptIn, setUserMsgOptIn } from '../../bootstrap/state.js';
import { DEFAULT_OUTPUT_STYLE_NAME } from 'src/constants/outputStyles.js';
import { isEnvTruthy, isRunningOnHomespace } from 'src/utils/envUtils.js';
import { sortConfigCatalog } from 'src/utils/configCatalog.js';
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
import { useSearchInput } from '../../hooks/useSearchInput.js';
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
import { isLeftArrowFleetEnabled } from '../../utils/leftArrowVia.js';
import { isRefusalFallbackEnabled } from '../../utils/refusalFallback.js';

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
 * densable `ig` / `crossSessionInboxRowVisible` — product surface for inbound
 * peer messages. Local: UDS_INBOX feature (DEFAULT ON). densable also has
 * CLAUDE_CODE_HARBOR_KITE env + tengu_harbor_kite GB; honor env override.
 */
function isCrossSessionInboxConfigRowVisible(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_HARBOR_KITE)) return true;
  if (feature('UDS_INBOX')) return true;
  if (getPlatform() === 'windows' && !getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_win', false)) {
    return false;
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite', false);
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

type Setting =
  | (SettingBase & {
      value: boolean;
      onChange(value: boolean): void;
      type: 'boolean';
      // densable row flag; panel does not consume it (CLI key=value host does).
      consentGated?: boolean;
    })
  | (SettingBase & {
      value: string;
      options: string[];
      onChange(value: string): void;
      type: 'enum';
      // densable: only crossSessionInbound sets pickToCommit; opens EnumPicker.
      pickToCommit?: boolean;
      // densable row flag; panel does not consume it (CLI key=value host does).
      consentGated?: boolean;
    })
  | (SettingBase & {
      // For enums that are set by a custom component, we don't need to pass options,
      // but we still need a value to display in the top-level config menu
      value: string;
      onChange(value: string): void;
      type: 'managedEnum';
    });

type SubMenu =
  | 'Theme'
  | 'Model'
  | 'ExternalIncludes'
  | 'OutputStyle'
  | 'ChannelDowngrade'
  | 'Language'
  | 'EnableAutoUpdates'
  | 'EnumPicker';
export function Config({
  onClose,
  context,
  setTabsHidden,
  onIsSearchModeChange,
  contentHeight,
}: Props): React.ReactNode {
  const { headerFocused, focusHeader } = useTabHeaderFocus();
  const insideModal = useIsInsideModal();
  const [, setTheme] = useTheme();
  const themeSetting = useThemeSetting();
  const [globalConfig, setGlobalConfig] = useState(getGlobalConfig());
  const initialConfig = React.useRef(getGlobalConfig());
  const [settingsData, setSettingsData] = useState(getInitialSettings());
  const initialSettingsData = React.useRef(getInitialSettings());
  const [currentOutputStyle, setCurrentOutputStyle] = useState<OutputStyle>(
    settingsData?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME,
  );
  const initialOutputStyle = React.useRef(currentOutputStyle);
  const [currentLanguage, setCurrentLanguage] = useState<string | undefined>(settingsData?.language);
  const initialLanguage = React.useRef(currentLanguage);
  const [selectedIndex, setSelectedIndex] = useState(0);
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
  const currentDefaultPermissionMode = permissionModeFromString(settingsData?.permissions?.defaultMode ?? 'default');
  // Show auto in the default-mode dropdown when the user has opted in OR the
  // config is fully 'enabled' — even if currently circuit-broken ('disabled'),
  // an opted-in user should still see it in settings (it's a temporary state).
  const showAutoInDefaultModePicker = feature('TRANSCRIPT_CLASSIFIER')
    ? hasAutoModeOptInAnySource() || getAutoModeEnabledState() === 'enabled'
    : false;
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
  // densable Pe / w0t — tengu_maple_sundial (default false).
  const mapleSundial = getFeatureValue_CACHED_MAY_BE_STALE('tengu_maple_sundial', false);
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
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset,
  } = useSearchInput({
    isActive: isSearchMode && showSubmenu === null && !headerFocused,
    onExit: () => setIsSearchMode(false),
    onExitUp: focusHeader,
    // Ctrl+C/D must reach Settings' useExitOnCtrlCD; 'd' also avoids
    // double-action (delete-char + exit-pending).
    passthroughCtrlKeys: ['c', 'd'],
  });

  // Tell the parent when Config's own Esc handler is active so Settings cedes
  // confirm:no. Only true when search mode owns the keyboard — not when the
  // tab header is focused (then Settings must handle Esc-to-close).
  const ownsEsc = isSearchMode && !headerFocused;
  React.useEffect(() => {
    onIsSearchModeChange?.(ownsEsc);
  }, [ownsEsc, onIsSearchModeChange]);

  const isConnectedToIde = hasAccessToIDEExtensionDiffFeature(context.options.mcpClients);

  const isFileCheckpointingAvailable = !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING);

  // densable bvr F/B/W. Official: if $t() && D !== undefined, pass D as last
  // persist arg. Local has no $t()/tn().storageV5 host — disk path (omit D).
  function F(patch: SettingsJson) {
    return updateSettingsForSource('userSettings', patch);
  }
  function B<K extends keyof SettingsJson>(key: K, value: SettingsJson[K]) {
    return updateSettingsForSource('userSettings', { [key]: value } as SettingsJson);
  }
  function W(updater: (current: GlobalConfig) => GlobalConfig) {
    saveGlobalConfig(updater);
  }

  const memoryFiles = React.use(getMemoryFiles(true)) as MemoryFileInfo[];
  const shouldShowExternalIncludesToggle = hasExternalClaudeMdIncludes(memoryFiles);

  const autoUpdaterDisabledReason = getAutoUpdaterDisabledReason();

  function onChangeMainModelConfig(value: string | null): void {
    const previousModel = mainLoopModel;
    logEvent('tengu_config_model_changed', {
      from_model: previousModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
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
  }

  function onChangeVerbose(value: boolean): void {
    // Update the global config to persist the setting
    W(current => ({ ...current, verbose: value }));
    setGlobalConfig({ ...getGlobalConfig(), verbose: value });

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
  }

  // TODO: Add MCP servers
  // densable U_c — section-order the rows we already have; do not invent.
  const settingsItems: Setting[] = sortConfigCatalog([
    // Global settings
    {
      id: 'autoCompact',
      label: 'Auto-compact',
      value: globalConfig.autoCompactEnabled,
      type: 'boolean' as const,
      onChange(autoCompactEnabled: boolean) {
        W(current => ({ ...current, autoCompactEnabled }));
        setGlobalConfig({ ...getGlobalConfig(), autoCompactEnabled });
        logEvent('tengu_auto_compact_setting_changed', {
          enabled: autoCompactEnabled,
        });
      },
    },
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
              if (result.error) {
                const restored = isAutoContinueAtUsageLimitEffective();
                setSettingsData(prev => ({
                  ...prev,
                  autoContinueAtUsageLimit: restored,
                }));
              }
            },
          } satisfies Setting,
        ]
      : []),
    // densable E6i()=DX() — refusal-fallback lane. Label pUm.
    ...(isRefusalFallbackEnabled()
      ? [
          {
            id: 'switchModelsOnFlag',
            label: 'Switch models when a message is flagged',
            value: settingsData?.switchModelsOnFlag ?? true,
            type: 'boolean' as const,
            onChange(switchModelsOnFlag: boolean) {
              F({ switchModelsOnFlag });
              setSettingsData(prev => ({
                ...prev,
                switchModelsOnFlag,
              }));
              logEvent('tengu_refusal_fallback_setting_changed', {
                enabled: switchModelsOnFlag,
              });
            },
          } satisfies Setting,
        ]
      : []),
    {
      id: 'tips',
      label: 'Show tips',
      value: settingsData?.spinnerTipsEnabled ?? true,
      type: 'boolean' as const,
      onChange(spinnerTipsEnabled: boolean) {
        updateSettingsForSource('localSettings', {
          spinnerTipsEnabled,
        });
        // Update local state to reflect the change immediately
        setSettingsData(prev => ({
          ...prev,
          spinnerTipsEnabled,
        }));
        logEvent('tengu_tips_setting_changed', {
          enabled: spinnerTipsEnabled,
        });
      },
    },
    {
      id: 'cacheWarningEnabled',
      label: 'Cache warnings',
      value: settingsData?.cacheWarningEnabled ?? true,
      type: 'boolean' as const,
      onChange(cacheWarningEnabled: boolean) {
        updateSettingsForSource('localSettings', {
          cacheWarningEnabled,
        });
        setSettingsData(prev => ({
          ...prev,
          cacheWarningEnabled,
        }));
        logEvent('tengu_cache_warning_setting_changed', {
          enabled: cacheWarningEnabled,
        });
      },
    },
    {
      id: 'reduceMotion',
      label: 'Reduce motion',
      value: settingsData?.prefersReducedMotion ?? false,
      type: 'boolean' as const,
      onChange(prefersReducedMotion: boolean) {
        updateSettingsForSource('localSettings', {
          prefersReducedMotion,
        });
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
      },
    },
    {
      id: 'thinking',
      label: 'Thinking mode',
      value: thinkingEnabled ?? true,
      type: 'boolean' as const,
      onChange(enabled: boolean) {
        setAppState(prev => ({ ...prev, thinkingEnabled: enabled }));
        F({
          alwaysThinkingEnabled: enabled ? undefined : false,
        });
        logEvent('tengu_thinking_toggled', { enabled });
      },
    },
    // Fast mode toggle (ant-only, eliminated from external builds)
    ...(isFastModeEnabled() && isFastModeAvailable()
      ? [
          {
            id: 'fast',
            label: `Fast mode (${FAST_MODE_MODEL_DISPLAY} only)`,
            value: !!isFastMode,
            type: 'boolean' as const,
            onChange(enabled: boolean) {
              clearFastModeCooldown();
              F({
                fastMode: enabled ? true : undefined,
              });
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
              F({
                promptSuggestionEnabled: enabled ? undefined : false,
              });
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
        F({
          emojiCompletionEnabled: enabled ? undefined : false,
        });
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
        F({ awaySummaryEnabled: enabled ? undefined : false });
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
              F({ enableWorkflows: next, disableWorkflows: undefined });
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
              F({ workflowKeywordTriggerEnabled: next });
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
              F({ enableArtifact: next, disableArtifact: undefined });
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
    ...(feature('POOR')
      ? [
          {
            id: 'poorMode',
            label: 'Poor mode (save tokens)',
            value: (() => {
              const PoorMode =
                require('../../commands/poor/poorMode.js') as typeof import('../../commands/poor/poorMode.js');
              return PoorMode.isPoorModeActive();
            })(),
            type: 'boolean' as const,
            onChange(enabled: boolean) {
              const PoorMode =
                require('../../commands/poor/poorMode.js') as typeof import('../../commands/poor/poorMode.js');
              PoorMode.setPoorMode(enabled);
              setAppState(prev => ({
                ...prev,
                promptSuggestionEnabled: !enabled,
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
                ...getGlobalConfig(),
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
              W(current => ({
                ...current,
                fileCheckpointingEnabled: enabled,
              }));
              setGlobalConfig({
                ...getGlobalConfig(),
                fileCheckpointingEnabled: enabled,
              });
              logEvent('tengu_file_history_snapshots_setting_changed', {
                enabled: enabled,
              });
            },
          },
        ]
      : []),
    {
      id: 'verbose',
      label: 'Verbose output',
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
        W(current => ({
          ...current,
          terminalProgressBarEnabled,
        }));
        setGlobalConfig({ ...getGlobalConfig(), terminalProgressBarEnabled });
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
                ...getGlobalConfig(),
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
        W(current => ({ ...current, showTurnDuration }));
        setGlobalConfig({ ...getGlobalConfig(), showTurnDuration });
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
              F({ precomputeCompactionEnabled });
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
    // densable timestamps /config — tengu_silk_hinge. Persist B + global + AppState.
    ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_silk_hinge', false)
      ? [
          {
            id: 'timestamps',
            label: 'Show message timestamps',
            value: globalConfig.showMessageTimestamps ?? false,
            type: 'boolean' as const,
            onChange(showMessageTimestamps: boolean) {
              B('showMessageTimestamps', showMessageTimestamps);
              W(current => ({ ...current, showMessageTimestamps }));
              setGlobalConfig({ ...getGlobalConfig(), showMessageTimestamps });
              setAppState(prev => ({ ...prev, showMessageTimestamps }));
              logEvent('tengu_show_message_timestamps_setting_changed', {
                enabled: showMessageTimestamps,
              });
            },
          } satisfies Setting,
        ]
      : []),
    {
      id: 'permissionMode',
      label: 'Default permission mode',
      value: currentDefaultPermissionMode,
      options: (() => {
        const priorityOrder: PermissionMode[] = ['default', 'plan'];
        return [...priorityOrder, ...PERMISSION_MODES.filter(m => !priorityOrder.includes(m))];
      })(),
      type: 'enum' as const,
      onChange(mode: string) {
        // Official 2.1.207: auto is a first-class external mode — no special-case mapping.
        const parsedMode = permissionModeFromString(mode);
        const validatedMode = isExternalPermissionMode(parsedMode) ? toExternalPermissionMode(parsedMode) : parsedMode;
        const result = F({
          permissions: {
            ...settingsData?.permissions,
            defaultMode: validatedMode as (typeof PERMISSION_MODES)[number],
          },
        });

        if (result.error) {
          logError(result.error);
          return;
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
              F({
                useAutoModeDuringPlan,
              });
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
      label: 'Always copy full response (skip /copy picker)',
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
          // densable autoScroll (fullscreen only). Dual-write settings + global.
          {
            id: 'autoScroll',
            label: 'Auto-scroll',
            value: settingsData?.autoScrollEnabled ?? globalConfig.autoScrollEnabled ?? true,
            type: 'boolean' as const,
            onChange(autoScrollEnabled: boolean) {
              const result = B('autoScrollEnabled', autoScrollEnabled);
              if (result.error) return;
              W(current => ({ ...current, autoScrollEnabled }));
              setGlobalConfig({ ...getGlobalConfig(), autoScrollEnabled });
              setSettingsData(getInitialSettings());
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
              if (result.error) return;
              setSettingsData(getInitialSettings());
              logEvent('tengu_config_changed', {
                setting: 'wheelScrollAccelerationEnabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
      const z4 = isLeftArrowFleetEnabled();
      const jet = z4 && !getIsRemoteMode();
      if (mapleSundial) {
        if (!(z4 || jet)) return [];
        return [
          {
            id: 'agentsView',
            label: 'Agents view',
            value:
              (jet && (globalConfig.leftArrowOpensAgents ?? true)) ||
              (z4 && (globalConfig.defaultToAgentsView ?? false))
                ? 'on'
                : 'off',
            type: 'managedEnum' as const,
            onChange() {},
          } satisfies Setting,
        ];
      }
      return [
        ...(z4
          ? [
              {
                id: 'defaultToAgentsView',
                label: 'Open agents view by default',
                value: globalConfig.defaultToAgentsView ?? false,
                type: 'boolean' as const,
                onChange(defaultToAgentsView: boolean) {
                  W(current => ({ ...current, defaultToAgentsView }));
                  setGlobalConfig({
                    ...getGlobalConfig(),
                    defaultToAgentsView,
                  });
                },
              } satisfies Setting,
            ]
          : []),
        ...(jet
          ? [
              {
                id: 'leftArrowOpensAgents',
                label: '← opens agents',
                value: globalConfig.leftArrowOpensAgents ?? true,
                type: 'boolean' as const,
                onChange(leftArrowOpensAgents: boolean) {
                  W(current => ({ ...current, leftArrowOpensAgents }));
                  setGlobalConfig({
                    ...getGlobalConfig(),
                    leftArrowOpensAgents,
                  });
                },
              } satisfies Setting,
            ]
          : []),
      ];
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
          value: settingsData?.autoUpdatesChannel ?? 'latest',
          type: 'managedEnum' as const,
          onChange() {
            // Handled via toggleSetting -> 'ChannelDowngrade'
          },
        },
    {
      id: 'theme',
      label: 'Theme',
      value: themeSetting,
      type: 'managedEnum',
      onChange: setTheme,
    },
    {
      id: 'notifChannel',
      label: feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION') ? 'Local notifications' : 'Notifications',
      value: globalConfig.preferredNotifChannel,
      options: ['auto', 'iterm2', 'terminal_bell', 'iterm2_with_bell', 'kitty', 'ghostty', 'notifications_disabled'],
      type: 'enum',
      onChange(notifChannel: GlobalConfig['preferredNotifChannel']) {
        W(current => ({
          ...current,
          preferredNotifChannel: notifChannel,
        }));
        setGlobalConfig({
          ...getGlobalConfig(),
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
                ...getGlobalConfig(),
                taskCompleteNotifEnabled,
              });
            },
          },
          {
            id: 'inputNeededNotifEnabled',
            label: 'Push when input needed',
            value: globalConfig.inputNeededNotifEnabled ?? false,
            type: 'boolean' as const,
            onChange(inputNeededNotifEnabled: boolean) {
              W(current => ({
                ...current,
                inputNeededNotifEnabled,
              }));
              setGlobalConfig({
                ...getGlobalConfig(),
                inputNeededNotifEnabled,
              });
            },
          },
          {
            id: 'agentPushNotifEnabled',
            label: 'Push when Claude decides',
            value: globalConfig.agentPushNotifEnabled ?? false,
            type: 'boolean' as const,
            onChange(agentPushNotifEnabled: boolean) {
              W(current => ({
                ...current,
                agentPushNotifEnabled,
              }));
              setGlobalConfig({
                ...getGlobalConfig(),
                agentPushNotifEnabled,
              });
            },
          },
        ]
      : []),
    {
      id: 'outputStyle',
      label: 'Output style',
      value: currentOutputStyle,
      type: 'managedEnum' as const,
      onChange: () => {}, // handled by OutputStylePicker submenu
    },
    ...(showDefaultViewPicker
      ? [
          {
            id: 'defaultView',
            label: 'What you see by default',
            // 'default' means the setting is unset — currently resolves to
            // transcript (main.tsx falls through when defaultView !== 'chat').
            // String() narrows the conditional-schema-spread union to string.
            value: settingsData?.defaultView === undefined ? 'default' : String(settingsData.defaultView),
            options: ['transcript', 'chat', 'default'],
            type: 'enum' as const,
            onChange(selected: string) {
              const defaultView = selected === 'default' ? undefined : (selected as 'chat' | 'transcript');
              updateSettingsForSource('localSettings', { defaultView });
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
      onChange: () => {}, // handled by LanguagePicker submenu
    },
    {
      id: 'editor',
      label: 'Editor mode',
      // Convert 'emacs' to 'normal' for backward compatibility
      value: globalConfig.editorMode === 'emacs' ? 'normal' : globalConfig.editorMode || 'normal',
      options: ['normal', 'vim'],
      type: 'enum',
      onChange(value: string) {
        W(current => ({
          ...current,
          editorMode: value as GlobalConfig['editorMode'],
        }));
        setGlobalConfig({
          ...getGlobalConfig(),
          editorMode: value as GlobalConfig['editorMode'],
        });

        logEvent('tengu_editor_mode_changed', {
          mode: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      },
    },
    {
      id: 'askUserQuestionTimeout',
      label: 'Question auto-continue timeout',
      // Official 2.1.200: default never (no auto-continue unless configured)
      consentGated: true,
      value: settingsData?.askUserQuestionTimeout ?? 'never',
      options: ['60s', '5m', '10m', 'never'],
      type: 'enum' as const,
      onChange(value: string) {
        const next = value === '60s' || value === '5m' || value === '10m' || value === 'never' ? value : 'never';
        setSettingsData(prev => ({
          ...prev,
          askUserQuestionTimeout: next,
        }));
        F({
          askUserQuestionTimeout: next,
        });
        logEvent('tengu_ask_user_question_timeout_changed', {
          value: next as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      },
    },
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
                return;
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
              setSettingsData(prev => ({
                ...prev,
                dialogExpiry: next,
              }));
              F({
                dialogExpiry: next,
              });
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
              setSettingsData(prev => ({
                ...prev,
                crossSessionInbound: next,
              }));
              F({
                crossSessionInbound: next,
              });
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
    {
      id: 'externalEditorContext',
      label: mapleSundial ? 'Show responses in IDE' : 'Show last response in external editor',
      value: globalConfig.externalEditorContext ?? false,
      type: 'boolean' as const,
      onChange(externalEditorContext: boolean) {
        W(current => ({ ...current, externalEditorContext }));
        setGlobalConfig({ ...getGlobalConfig(), externalEditorContext });
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
          ...getGlobalConfig(),
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
      value: mainLoopModel === null ? 'Default (recommended)' : mainLoopModel,
      type: 'managedEnum' as const,
      onChange: onChangeMainModelConfig,
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
                ...getGlobalConfig(),
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
              setGlobalConfig({ ...getGlobalConfig(), autoConnectIde });

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
              setGlobalConfig({ ...getGlobalConfig(), autoInstallIdeExtension });

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
      label: 'Claude in Chrome enabled by default',
      value: globalConfig.claudeInChromeDefaultEnabled ?? false, // densable: undefined → false
      type: 'boolean' as const,
      onChange(enabled: boolean) {
        W(current => ({
          ...current,
          claudeInChromeDefaultEnabled: enabled,
        }));
        setGlobalConfig({
          ...getGlobalConfig(),
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
            ? ['auto', 'tmux', 'windows-terminal', 'in-process']
            : ['auto', 'tmux', 'in-process'];
          return [
            {
              id: 'teammateMode',
              label,
              value: globalConfig.teammateMode ?? 'auto',
              options: teammateModeOptions,
              type: 'enum' as const,
              onChange(mode: string) {
                if (mode !== 'auto' && mode !== 'tmux' && mode !== 'windows-terminal' && mode !== 'in-process') {
                  return;
                }
                if (mode === 'windows-terminal' && !isWindows) {
                  return;
                }
                // Clear CLI override and set new mode (pass mode to avoid race condition)
                clearCliTeammateModeOverride(mode);
                W(current => ({
                  ...current,
                  teammateMode: mode,
                }));
                setGlobalConfig({
                  ...getGlobalConfig(),
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
    ...(feature('BRIDGE_MODE') && isBridgeEnabled()
      ? [
          {
            id: 'remoteControl',
            label: 'Enable Remote Control for all sessions',
            value:
              globalConfig.remoteControlAtStartup === undefined
                ? 'default'
                : String(globalConfig.remoteControlAtStartup),
            options: ['true', 'false', 'default'],
            type: 'enum' as const,
            onChange(selected: string) {
              if (selected === 'default') {
                // Unset the config key so it falls back to the platform default
                W(current => {
                  if (current.remoteControlAtStartup === undefined) return current;
                  const next = { ...current };
                  delete next.remoteControlAtStartup;
                  return next;
                });
                setGlobalConfig({
                  ...getGlobalConfig(),
                  remoteControlAtStartup: undefined,
                });
              } else {
                const enabled = selected === 'true';
                W(current => {
                  if (current.remoteControlAtStartup === enabled) return current;
                  return { ...current, remoteControlAtStartup: enabled };
                });
                setGlobalConfig({
                  ...getGlobalConfig(),
                  remoteControlAtStartup: enabled,
                });
              }
              // Sync to AppState so useReplBridge reacts immediately
              const resolved = getRemoteControlAtStartup();
              setAppState(prev => {
                if (prev.replBridgeEnabled === resolved && !prev.replBridgeOutboundOnly) return prev;
                return {
                  ...prev,
                  replBridgeEnabled: resolved,
                  replBridgeOutboundOnly: false,
                };
              });
            },
          },
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
              setGlobalConfig(getGlobalConfig());
            },
          },
        ]
      : []),
  ]);

  // Filter settings based on search query
  const filteredSettingsItems = React.useMemo(() => {
    if (!searchQuery) return settingsItems;
    const lowerQuery = searchQuery.toLowerCase();
    return settingsItems.filter(setting => {
      if (setting.id.toLowerCase().includes(lowerQuery)) return true;
      const searchableText = 'searchText' in setting ? setting.searchText : setting.label;
      return searchableText.toLowerCase().includes(lowerQuery);
    });
  }, [settingsItems, searchQuery]);

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

  // Adjust selected index when filtered list shrinks, and keep the selected
  // item visible when maxVisible changes (e.g., terminal resize).
  React.useEffect(() => {
    if (selectedIndex >= filteredSettingsItems.length) {
      const newIndex = Math.max(0, filteredSettingsItems.length - 1);
      setSelectedIndex(newIndex);
      setScrollOffset(Math.max(0, newIndex - maxVisible + 1));
      return;
    }
    setScrollOffset(prev => {
      if (selectedIndex < prev) return selectedIndex;
      if (selectedIndex >= prev + maxVisible) return selectedIndex - maxVisible + 1;
      return prev;
    });
  }, [filteredSettingsItems.length, selectedIndex, maxVisible]);

  // Keep the selected item visible within the scroll window.
  // Called synchronously from navigation handlers to avoid a render frame
  // where the selected item falls outside the visible window.
  const adjustScrollOffset = useCallback(
    (newIndex: number) => {
      setScrollOffset(prev => {
        if (newIndex < prev) return newIndex;
        if (newIndex >= prev + maxVisible) return newIndex - maxVisible + 1;
        return prev;
      });
    },
    [maxVisible],
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
    if (globalConfig.theme !== initialConfig.current.theme) {
      formattedChanges.push(`Set theme to ${chalk.bold(globalConfig.theme)}`);
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
    if (globalConfig.autoScrollEnabled !== initialConfig.current.autoScrollEnabled) {
      formattedChanges.push(`${globalConfig.autoScrollEnabled ? 'Enabled' : 'Disabled'} auto-scroll`);
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
    if (globalConfig.showMessageTimestamps !== initialConfig.current.showMessageTimestamps) {
      formattedChanges.push(`${globalConfig.showMessageTimestamps ? 'Enabled' : 'Disabled'} message timestamps`);
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
      formattedChanges.push(`Set auto-update channel to ${chalk.bold(settingsData?.autoUpdatesChannel ?? 'latest')}`);
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
    isFastModeEnabled() ? (settingsData as Record<string, unknown> | undefined)?.fastMode : undefined,
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
      spinnerTipsEnabled: il?.spinnerTipsEnabled,
      prefersReducedMotion: il?.prefersReducedMotion,
      defaultView: il?.defaultView,
      outputStyle: il?.outputStyle,
    });
    const iu = initialUserSettings;
    F({
      alwaysThinkingEnabled: iu?.alwaysThinkingEnabled,
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

  // Escape: revert all changes (if any) and close.
  const handleEscape = useCallback(() => {
    if (showSubmenu !== null) {
      return;
    }
    if (isDirty.current) {
      revertChanges();
    }
    onClose('Config dialog dismissed', { display: 'system' });
  }, [showSubmenu, revertChanges, onClose]);

  // Disable when submenu is open so the submenu's Dialog handles ESC, and in
  // search mode so the onKeyDown handler (which clears-then-exits search)
  // wins — otherwise Escape in search would jump straight to revert+close.
  useKeybinding('confirm:no', handleEscape, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused,
  });
  // Save-and-close fires on Enter only when not in search mode (Enter there
  // exits search to the list — see the isSearchMode branch in handleKeyDown).
  useKeybinding('settings:close', handleSaveAndClose, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused,
  });

  // Settings navigation and toggle actions via configurable keybindings.
  // Only active when not in search mode and no submenu is open.
  const toggleSetting = useCallback(() => {
    const setting = filteredSettingsItems[selectedIndex];
    if (!setting || !setting.onChange) {
      return;
    }

    if (setting.type === 'boolean') {
      isDirty.current = true;
      setting.onChange(!setting.value);
      if (setting.id === 'thinking') {
        const newValue = !setting.value;
        const backToInitial = newValue === initialThinkingEnabled.current;
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
        // Switching to latest - just do it and clear minimumVersion
        isDirty.current = true;
        F({
          autoUpdatesChannel: 'latest',
          minimumVersion: undefined,
        });
        setSettingsData(prev => ({
          ...prev,
          autoUpdatesChannel: 'latest',
          minimumVersion: undefined,
        }));
        logEvent('tengu_autoupdate_channel_changed', {
          channel: 'latest' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
      setting.onChange(setting.options[nextIndex]!);
      return;
    }
  }, [
    autoUpdaterDisabledReason,
    filteredSettingsItems,
    isMapleJrExternalIncludes,
    selectedIndex,
    settingsData?.autoUpdatesChannel,
    setTabsHidden,
  ]);

  const moveSelection = (delta: -1 | 1): void => {
    setShowThinkingWarning(false);
    const newIndex = Math.max(0, Math.min(filteredSettingsItems.length - 1, selectedIndex + delta));
    setSelectedIndex(newIndex);
    adjustScrollOffset(newIndex);
  };

  useKeybindings(
    {
      'select:previous': () => {
        if (selectedIndex === 0) {
          // ↑ at top enters search mode so users can type-to-filter after
          // reaching the list boundary. Wheel-up (scroll:lineUp) clamps
          // instead — overshoot shouldn't move focus away from the list.
          setShowThinkingWarning(false);
          setIsSearchMode(true);
          setScrollOffset(0);
        } else {
          moveSelection(-1);
        }
      },
      'select:next': () => moveSelection(1),
      // Wheel. ScrollKeybindingHandler's scroll:line* returns false (not
      // consumed) when the ScrollBox content fits — which it always does
      // here because the list is paginated (slice). The event falls through
      // to this handler which navigates the list, clamping at boundaries.
      'scroll:lineUp': () => moveSelection(-1),
      'scroll:lineDown': () => moveSelection(1),
      'select:accept': toggleSetting,
      'select:previousValue': () => toggleSetting(),
      'select:nextValue': () => toggleSetting(),
      'settings:search': () => {
        setIsSearchMode(true);
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
      // Search mode: Esc clears then exits, Enter/↓ moves to the list.
      if (isSearchMode) {
        if (e.key === 'escape') {
          e.preventDefault();
          if (searchQuery.length > 0) {
            setSearchQuery('');
          } else {
            setIsSearchMode(false);
          }
          return;
        }
        if (e.key === 'return' || e.key === 'down' || e.key === 'wheeldown') {
          e.preventDefault();
          setIsSearchMode(false);
          setSelectedIndex(0);
          setScrollOffset(0);
        }
        return;
      }
      // List mode: left/right/tab cycle the selected option's value. These
      // keys used to switch tabs; now they only do so when the tab row is
      // explicitly focused (see headerFocused in Settings.tsx).
      if (e.key === 'left' || e.key === 'right' || e.key === 'tab') {
        e.preventDefault();
        toggleSetting();
        return;
      }
      // Fallback: printable characters (other than those bound to actions)
      // enter search mode. Carve out j/k// — useKeybindings (still on the
      // useInput path) consumes these via stopImmediatePropagation, but
      // onKeyDown dispatches independently so we must skip them explicitly.
      if (e.ctrl || e.meta) return;
      if (e.key === 'j' || e.key === 'k' || e.key === '/') return;
      if (e.key.length === 1 && e.key !== ' ') {
        e.preventDefault();
        setIsSearchMode(true);
        setSearchQuery(e.key);
      }
    },
    [showSubmenu, headerFocused, isSearchMode, searchQuery, setSearchQuery, toggleSetting],
  );

  return (
    <Box flexDirection="column" width="100%" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      {showSubmenu === 'Theme' ? (
        <>
          <ThemePicker
            onThemeSelect={setting => {
              isDirty.current = true;
              setTheme(setting);
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
            onCancel={() => {
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
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
            onSelect={(model, _effort) => {
              isDirty.current = true;
              onChangeMainModelConfig(model);
              setShowSubmenu(null);
              setTabsHidden(false);
            }}
            onCancel={() => {
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
              isDirty.current = true;
              setCurrentOutputStyle(style ?? DEFAULT_OUTPUT_STYLE_NAME);
              setShowSubmenu(null);
              setTabsHidden(false);

              // Save to local settings
              updateSettingsForSource('localSettings', {
                outputStyle: style,
              });

              void logEvent('tengu_output_style_changed', {
                style: (style ??
                  DEFAULT_OUTPUT_STYLE_NAME) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                settings_source: 'localSettings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              });
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
              isDirty.current = true;
              setCurrentLanguage(language);
              setShowSubmenu(null);
              setTabsHidden(false);

              // Save to user settings
              F({
                language,
              });

              void logEvent('tengu_language_changed', {
                language: (language ?? 'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              });
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
      ) : showSubmenu === 'EnumPicker' && enumPickerSetting ? (
        <>
          <Dialog title={enumPickerSetting.label} onCancel={closeEnumPicker} hideBorder hideInputGuide>
            <Select
              options={enumPickerSetting.options.map(option => ({
                label: option,
                value: option,
              }))}
              defaultValue={String(enumPickerSetting.value)}
              defaultFocusValue={String(enumPickerSetting.value)}
              onChange={(value: string) => {
                closeEnumPicker();
                isDirty.current = true;
                enumPickerSetting.onChange(value);
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
      ) : showSubmenu === 'EnableAutoUpdates' ? (
        <Dialog
          title="Enable Auto-Updates"
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
                  ? 'Auto-updates are controlled by an environment variable and cannot be changed here.'
                  : 'Auto-updates are disabled in development builds.'}
              </Text>
              {autoUpdaterDisabledReason?.type === 'env' && (
                <Text dimColor>Unset {autoUpdaterDisabledReason.envVar} to re-enable auto-updates.</Text>
              )}
            </>
          ) : (
            <Select
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
                isDirty.current = true;
                setShowSubmenu(null);
                setTabsHidden(false);

                W(current => ({
                  ...current,
                  autoUpdates: true,
                }));
                setGlobalConfig({ ...getGlobalConfig(), autoUpdates: true });

                F({
                  autoUpdatesChannel: channel as 'latest' | 'stable',
                  minimumVersion: undefined,
                });
                setSettingsData(prev => ({
                  ...prev,
                  autoUpdatesChannel: channel as 'latest' | 'stable',
                  minimumVersion: undefined,
                }));
                logEvent('tengu_autoupdate_enabled', {
                  channel: channel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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

            isDirty.current = true;
            // Switch to stable channel
            const newSettings: {
              autoUpdatesChannel: 'stable';
              minimumVersion?: string;
            } = {
              autoUpdatesChannel: 'stable',
            };

            if (choice === 'stay') {
              // User wants to stay on current version until stable catches up
              newSettings.minimumVersion = MACRO.VERSION;
            }

            F(newSettings);
            setSettingsData(prev => ({
              ...prev,
              ...newSettings,
            }));
            logEvent('tengu_autoupdate_channel_changed', {
              channel: 'stable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              minimum_version_set: choice === 'stay',
            });
          }}
        />
      ) : (
        <Box flexDirection="column" gap={1} marginY={insideModal ? undefined : 1}>
          <SearchBox
            query={searchQuery}
            isFocused={isSearchMode && !headerFocused}
            isTerminalFocused={isTerminalFocused}
            cursorOffset={searchCursorOffset}
            placeholder="Search settings…"
          />
          <Box flexDirection="column">
            {filteredSettingsItems.length === 0 ? (
              <Text dimColor italic>
                No settings match &quot;{searchQuery}&quot;
              </Text>
            ) : (
              <>
                {scrollOffset > 0 && (
                  <Text dimColor>
                    {figures.arrowUp} {scrollOffset} more above
                  </Text>
                )}
                {filteredSettingsItems.slice(scrollOffset, scrollOffset + maxVisible).map((setting, i) => {
                  const actualIndex = scrollOffset + i;
                  const isSelected = actualIndex === selectedIndex && !headerFocused && !isSearchMode;

                  return (
                    <React.Fragment key={setting.id}>
                      {/* densable sda row: fixed label width + flexGrow value with minWidth:0
                          so values wrap/truncate inside the panel instead of past the edge. */}
                      <Box width="100%">
                        <Box width={labelWidth} flexShrink={0} marginRight={1}>
                          <Text color={isSelected ? 'suggestion' : undefined} wrap="truncate-end">
                            {isSelected ? figures.pointer : ' '} {setting.label}
                          </Text>
                        </Box>
                        <Box flexGrow={1} minWidth={0}>
                          {setting.type === 'boolean' ? (
                            <>
                              <Text color={isSelected ? 'suggestion' : undefined} wrap="truncate-end">
                                {setting.value.toString()}
                              </Text>
                              {showThinkingWarning && setting.id === 'thinking' && (
                                <Text color="warning" wrap="truncate-end">
                                  {' '}
                                  Changing thinking mode mid-conversation will increase latency and may reduce quality.
                                </Text>
                              )}
                            </>
                          ) : setting.id === 'theme' ? (
                            <Text color={isSelected ? 'suggestion' : undefined} wrap="truncate-end">
                              {THEME_LABELS[setting.value.toString()] ?? setting.value.toString()}
                            </Text>
                          ) : setting.id === 'notifChannel' ? (
                            <Text color={isSelected ? 'suggestion' : undefined} wrap="truncate-end">
                              <NotifChannelLabel value={setting.value.toString()} />
                            </Text>
                          ) : setting.id === 'permissionMode' ? (
                            <Text color={isSelected ? 'suggestion' : undefined} wrap="truncate-end">
                              {permissionModeShortTitle(setting.value as PermissionMode)}
                            </Text>
                          ) : setting.id === 'autoUpdatesChannel' && autoUpdaterDisabledReason ? (
                            <Box flexDirection="column" minWidth={0}>
                              <Text color={isSelected ? 'suggestion' : undefined}>disabled</Text>
                              <Text dimColor wrap="truncate-end">
                                ({formatAutoUpdaterDisabledReason(autoUpdaterDisabledReason)})
                              </Text>
                            </Box>
                          ) : (
                            <Text color={isSelected ? 'suggestion' : undefined} wrap="truncate-end">
                              {setting.value.toString()}
                            </Text>
                          )}
                          {mapleSundial &&
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
                {scrollOffset + maxVisible < filteredSettingsItems.length && (
                  <Text dimColor>
                    {figures.arrowDown} {filteredSettingsItems.length - scrollOffset - maxVisible} more below
                  </Text>
                )}
              </>
            )}
          </Box>
          {/* densable sda: footer is flexShrink:0 + measured so list maxVisible
              never eats its rows (fullscreen /config keyboard-hint clip). */}
          <Box ref={footerRef} flexDirection="column" flexShrink={0} minWidth={0}>
            {headerFocused ? (
              <Text dimColor wrap="truncate-end">
                <Byline>
                  <KeyboardShortcutHint shortcut="←/→ tab" action="switch" />
                  <KeyboardShortcutHint shortcut="↓" action="return" />
                  <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="close" />
                </Byline>
              </Text>
            ) : isSearchMode ? (
              <Text dimColor wrap="truncate-end">
                <Byline>
                  <Text>Type to filter</Text>
                  <KeyboardShortcutHint shortcut="Enter/↓" action="select" />
                  <KeyboardShortcutHint shortcut="↑" action="tabs" />
                  <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="clear" />
                </Byline>
              </Text>
            ) : (
              <Text dimColor wrap="truncate-end">
                <Byline>
                  <ConfigurableShortcutHint
                    action="select:accept"
                    context="Settings"
                    fallback="Space"
                    description="change"
                  />
                  <ConfigurableShortcutHint
                    action="settings:close"
                    context="Settings"
                    fallback="Enter"
                    description="save"
                  />
                  <ConfigurableShortcutHint
                    action="settings:search"
                    context="Settings"
                    fallback="/"
                    description="search"
                  />
                  <ConfigurableShortcutHint
                    action="confirm:no"
                    context="Settings"
                    fallback="Esc"
                    description="cancel"
                  />
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
          Terminal Bell <Text dimColor>(\a)</Text>
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
      return 'iTerm2 w/ Bell';
    case 'notifications_disabled':
      return 'Disabled';
    default:
      return value;
  }
}
