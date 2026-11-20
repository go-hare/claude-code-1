import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Box, Byline, Dialog, KeyboardShortcutHint, Link, Text } from '@anthropic/ink';
import { FastIcon, getFastIconString } from '../../components/FastIcon.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { type AppState, useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import {
  clearFastModeCooldown,
  FAST_MODE_MODEL_DISPLAY,
  getFastModeModel,
  getFastModeRuntimeState,
  getFastModeUnavailableReason,
  isFastModeEnabled,
  isFastModeSupportedByModel,
  prefetchFastModeStatus,
} from '../../utils/fastMode.js';
import { formatDuration } from '../../utils/format.js';
import { formatModelPricing, getOpus46CostTier } from '../../utils/modelCost.js';
import { getCanonicalName, getDefaultMainLoopModelSetting } from '../../utils/model/model.js';
import { getAPIProvider } from '../../utils/model/providers.js';
import { em } from '../../utils/model/modelNoticeCode.js';
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { saveFastModeWithConfigSetHook } from './index.js';

export function isFastModeResearchPreview(model: string | null | undefined): boolean {
  const resolved = model && isFastModeSupportedByModel(model) ? model : getFastModeModel();
  const canonical = getCanonicalName(resolved);
  return canonical === 'claude-opus-4-8' || canonical === 'claude-opus-5';
}

/**
 * Official 2.1.328 `qLo(oo)` — resolve fast mode pricing for the active model
 * (or the fast-mode target model if the active model does not support fast mode)
 * so Opus 5.5 displays `$8/$40 per Mtok` and Fable 5.2 displays `$16/$80 per Mtok`.
 */
export function formatFastModePricingForModel(model: string | null | undefined): string {
  const effectiveModel = isFastModeSupportedByModel(model ?? null)
    ? (model ?? getDefaultMainLoopModelSetting())
    : getFastModeModel();
  return formatModelPricing(getOpus46CostTier(true, effectiveModel));
}

/**
 * Official 2.1.323 `lse()` (#2036): whether fast mode is persisted to user settings.
 * On Vertex (and when `fastModePerSessionOptIn` is set), fast mode applies to the
 * current session only — yet `/fast on` and `/fast off` MUST still ask a plugin's
 * `config.set` hook just like the `/fast` menu does.
 */
export function isFastModePersistedToSettings(): boolean {
  if (getAPIProvider() === 'vertex') {
    return false;
  }
  const policySettings = getSettingsForSource('policySettings');
  const userSettings = getSettingsForSource('userSettings');
  if (policySettings?.fastModePerSessionOptIn === true || userSettings?.fastModePerSessionOptIn === true) {
    return false;
  }
  return true;
}

function applyFastMode(enable: boolean, setAppState: (f: (prev: AppState) => AppState) => void, persist = true): void {
  clearFastModeCooldown();
  if (persist && isFastModePersistedToSettings()) {
    updateSettingsForSource('userSettings', {
      fastMode: enable ? true : undefined,
    });
  }
  if (enable) {
    setAppState(prev => {
      // Only switch model if current model doesn't support fast mode
      const needsModelSwitch = !isFastModeSupportedByModel(prev.mainLoopModel);
      return {
        ...prev,
        ...(needsModelSwitch ? { mainLoopModel: getFastModeModel(), mainLoopModelForSession: null } : {}),
        fastMode: true,
      };
    });
  } else {
    setAppState(prev => ({ ...prev, fastMode: false }));
  }
}

export function FastModePicker({
  onDone,
  unavailableReason,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  unavailableReason: string | null;
}): React.ReactNode {
  const model = useAppState(s => s.mainLoopModel);
  const initialFastMode = useAppState(s => s.fastMode);
  const setAppState = useSetAppState();
  const [enableFastMode, setEnableFastMode] = useState(initialFastMode ?? false);
  const runtimeState = getFastModeRuntimeState();
  const isCooldown = runtimeState.status === 'cooldown';
  const isUnavailable = unavailableReason !== null;
  const pricing = formatFastModePricingForModel(model);

  async function handleConfirm(): Promise<void> {
    if (isUnavailable) return;
    const hookResult = await saveFastModeWithConfigSetHook(enableFastMode, initialFastMode ?? false, finalEnabled => {
      applyFastMode(finalEnabled, setAppState);
    });
    if (hookResult.kind === 'refused') {
      onDone(hookResult.reason ?? 'Fast mode was not changed', { display: 'system' });
      return;
    }
    const finalEnabled = hookResult.saved;
    logEvent('tengu_fast_mode_toggled', {
      enabled: finalEnabled,
      source: 'picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    if (finalEnabled) {
      const fastIcon = getFastIconString(finalEnabled);
      const modelUpdated = !isFastModeSupportedByModel(model) ? ` · model set to ${em(FAST_MODE_MODEL_DISPLAY)}` : '';
      const sessionSuffix = isFastModePersistedToSettings() ? '' : ' (this session only)';
      onDone(`${fastIcon} Fast mode ON${modelUpdated} · ${pricing}${sessionSuffix}`);
    } else {
      setAppState(prev => ({ ...prev, fastMode: false }));
      onDone(`Fast mode OFF`);
    }
  }

  function handleCancel(): void {
    if (isUnavailable) {
      // Ensure fast mode is off if the org has disabled it
      if (initialFastMode) {
        applyFastMode(false, setAppState);
      }
      onDone('Fast mode OFF', { display: 'system' });
      return;
    }
    const message = initialFastMode ? `${getFastIconString()} Kept Fast mode ON` : `Kept Fast mode OFF`;
    onDone(message, { display: 'system' });
  }

  function handleToggle(): void {
    if (isUnavailable) return;
    setEnableFastMode(prev => !prev);
  }

  useKeybindings(
    {
      'confirm:yes': () => {
        void handleConfirm();
      },
      'confirm:nextField': handleToggle,
      'confirm:next': handleToggle,
      'confirm:previous': handleToggle,
      'confirm:cycleMode': handleToggle,
      'confirm:toggle': handleToggle,
    },
    { context: 'Confirmation' },
  );

  const isResearchPreview = isFastModeResearchPreview(model);
  const title = (
    <Text>
      <FastIcon cooldown={isCooldown} /> Fast mode
      {isResearchPreview ? ' (research preview)' : ''}
    </Text>
  );

  return (
    <Dialog
      title={title}
      subtitle={`High-speed mode for ${FAST_MODE_MODEL_DISPLAY}. Draws from usage credits at a higher rate. Separate rate limits apply.`}
      onCancel={handleCancel}
      color="fastMode"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : isUnavailable ? (
          <KeyboardShortcutHint shortcut="escape" action="cancel" />
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="space" action="toggle" />
            <KeyboardShortcutHint shortcut="enter" action="confirm" />
            <KeyboardShortcutHint shortcut="escape" action="cancel" />
          </Byline>
        )
      }
    >
      {unavailableReason ? (
        <Box marginLeft={2}>
          <Text color="error">{unavailableReason}</Text>
        </Box>
      ) : (
        <>
          <Box flexDirection="column" gap={0} marginLeft={2}>
            <Box flexDirection="row" gap={2}>
              <Text bold>Fast mode</Text>
              <Text color={enableFastMode ? 'fastMode' : undefined} bold={enableFastMode}>
                {enableFastMode ? 'ON ' : 'OFF'}
              </Text>
              <Text dimColor>{pricing}</Text>
            </Box>
          </Box>

          {isCooldown && runtimeState.status === 'cooldown' && (
            <Box marginLeft={2}>
              <Text color="warning">
                {runtimeState.reason === 'overloaded'
                  ? 'Fast mode overloaded and is temporarily unavailable'
                  : "You've hit your fast limit"}
                {' · resets in '}
                {formatDuration(runtimeState.resetAt - Date.now(), {
                  hideTrailingZeros: true,
                })}
              </Text>
            </Box>
          )}
        </>
      )}
      <Text dimColor>
        Learn more:{' '}
        <Link url="https://code.claude.com/docs/en/fast-mode">https://code.claude.com/docs/en/fast-mode</Link>
      </Text>
    </Dialog>
  );
}

export async function handleFastModeShortcut(
  enable: boolean,
  getAppState: () => AppState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<string> {
  const unavailableReason = getFastModeUnavailableReason();
  if (unavailableReason && enable) {
    return `Fast mode unavailable: ${unavailableReason}`;
  }

  const { mainLoopModel, fastMode: previousFastMode } = getAppState();
  // Official 2.1.323 dDn (#2036): always ask plugin `config.set` hooks for
  // `/fast on` and `/fast off` even on Vertex where fast mode is session-only.
  const hookResult = await saveFastModeWithConfigSetHook(enable, previousFastMode ?? false, finalEnabled => {
    applyFastMode(finalEnabled, setAppState, true);
  });
  if (hookResult.kind === 'refused') {
    return hookResult.reason ?? 'Fast mode was not changed';
  }
  const finalEnabled = hookResult.saved;
  logEvent('tengu_fast_mode_toggled', {
    enabled: finalEnabled,
    source: 'shortcut' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  if (finalEnabled) {
    const fastIcon = getFastIconString(true);
    const modelUpdated = !isFastModeSupportedByModel(mainLoopModel)
      ? ` · model set to ${em(FAST_MODE_MODEL_DISPLAY)}`
      : '';
    const pricing = formatFastModePricingForModel(mainLoopModel);
    const sessionSuffix = isFastModePersistedToSettings() ? '' : ' (this session only)';
    return `${fastIcon} Fast mode ON${modelUpdated} · ${pricing}${sessionSuffix}`;
  } else {
    return `Fast mode OFF`;
  }
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode | null> {
  if (!isFastModeEnabled()) {
    return null;
  }

  // Fetch org fast mode status before showing the picker. We must know
  // whether the org has disabled fast mode before allowing any toggle.
  // If a startup prefetch is already in flight, this awaits it.
  await prefetchFastModeStatus();

  const arg = args?.trim().toLowerCase();
  if (arg === 'on' || arg === 'off') {
    const result = await handleFastModeShortcut(arg === 'on', context.getAppState, context.setAppState);
    onDone(result);
    return null;
  }

  const unavailableReason = getFastModeUnavailableReason();
  logEvent('tengu_fast_mode_picker_shown', {
    unavailable_reason: (unavailableReason ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  return <FastModePicker onDone={onDone} unavailableReason={unavailableReason} />;
}
