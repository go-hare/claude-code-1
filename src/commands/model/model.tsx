import chalk from 'chalk';
import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { FableConsentDialog } from '../../components/FableConsentDialog.js';
import { ModelPicker } from '../../components/ModelPicker.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState, useAppStateStore, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { EffortLevel } from '../../utils/effort.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import {
  clearFastModeCooldown,
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js';
import { getOauthAccountInfo } from '../../utils/auth.js';
import { getFableSessionFallbackConsented, setFableSessionFallbackConsented } from '../../bootstrap/state.js';
import { shouldShowFableConsentDialog } from '../../utils/fableConsent.js';
import { saveSessionModel } from '../../utils/sessionStorage.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import {
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
  getDefaultMainLoopModelSetting,
} from '../../utils/model/model.js';
import { applyModelSet, formatCurrentModel } from './applyModel.js';

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const isFastMode = useAppState(s => s.fastMode);
  const setAppState = useSetAppState();
  const [pendingFable, setPendingFable] = useState<{
    model: string | null;
    effort: EffortLevel | undefined;
    asDefault: boolean;
  } | null>(null);

  function handleCancel(): void {
    logEvent('tengu_model_command_menu', {
      action: 'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    const displayModel = renderModelLabel(mainLoopModel);
    onDone(`Kept model as ${chalk.bold(displayModel)}`, {
      display: 'system',
    });
  }

  /**
   * densable onSelect / fk_ (+ optional apt/z7r when asDefault).
   * Both settings write and session apply happen here so Fable consent
   * can gate before any side effects.
   */
  function applySessionModel(model: string | null, effort: EffortLevel | undefined, asDefault: boolean): void {
    logEvent('tengu_model_command_menu', {
      action: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_model: mainLoopModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    setAppState(prev => ({
      ...prev,
      mainLoopModel: model,
      mainLoopModelForSession: null,
    }));
    saveSessionModel(model);
    if (asDefault) {
      // densable apt / z7r — persist as default for new sessions
      updateSettingsForSource('userSettings', { model: model ?? undefined });
    }

    let message = `Set model to ${chalk.bold(renderModelLabel(model))}${
      asDefault ? ' and saved as your default for new sessions' : ' for this session only'
    }`;
    if (effort !== undefined) {
      message += ` with ${chalk.bold(effort)} effort`;
    }

    // Turn off fast mode if switching to unsupported model
    let wasFastModeToggledOn;
    if (isFastModeEnabled()) {
      clearFastModeCooldown();
      if (!isFastModeSupportedByModel(model) && isFastMode) {
        setAppState(prev => ({
          ...prev,
          fastMode: false,
        }));
        wasFastModeToggledOn = false;
        // Do not update fast mode in settings since this is an automatic downgrade
      } else if (isFastModeSupportedByModel(model) && isFastModeAvailable() && isFastMode) {
        message += ` · Fast mode ON`;
        wasFastModeToggledOn = true;
      }
    }

    if (isBilledAsExtraUsage(model, wasFastModeToggledOn === true, isOpus1mMergeEnabled())) {
      message += ` · Billed as extra usage`;
    }

    if (wasFastModeToggledOn === false) {
      // Fast mode was toggled off, show suffix after extra usage billing
      message += ` · Fast mode OFF`;
    }

    onDone(message);
  }

  function handleSelect(model: string | null, effort: EffortLevel | undefined, asDefault = false): void {
    // Official model_fable_consent densable gate before committing Fable.
    // Pass org/account identity so persisted fableOverageConsentV2 is honored
    // (query.ts already does this; the /model picker previously omitted it).
    const oauth = getOauthAccountInfo();
    if (
      shouldShowFableConsentDialog({
        model,
        organizationUuid: oauth?.organizationUuid ?? null,
        accountUuid: oauth?.accountUuid ?? null,
        sessionFallbackConsented: getFableSessionFallbackConsented(),
      })
    ) {
      setPendingFable({ model, effort, asDefault });
      return;
    }
    applySessionModel(model, effort, asDefault);
  }

  if (pendingFable) {
    const oauth = getOauthAccountInfo();
    return (
      <FableConsentDialog
        organizationUuid={oauth?.organizationUuid ?? null}
        accountUuid={oauth?.accountUuid ?? null}
        onAccept={({ sessionFallback }) => {
          // Persist key-less latch in bootstrap state so query() honors /model accept.
          if (sessionFallback) setFableSessionFallbackConsented(true);
          const { model, effort, asDefault } = pendingFable;
          setPendingFable(null);
          applySessionModel(model, effort, asDefault);
        }}
        onDecline={() => {
          setPendingFable(null);
          handleCancel();
        }}
      />
    );
  }

  return (
    <ModelPicker
      initial={mainLoopModel}
      sessionModel={mainLoopModelForSession}
      onSelect={handleSelect}
      enableThisSessionOnly
      onCancel={handleCancel}
      isStandaloneCommand
      showFastModeNotice={
        isFastModeEnabled() && isFastMode && isFastModeSupportedByModel(mainLoopModel) && isFastModeAvailable()
      }
    />
  );
}

function SetModelAndClose({
  args,
  onDone,
}: {
  args: string;
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  // densable _Ht/V7r — interactive inline set persists default via applyModelSet
  const store = useAppStateStore();
  React.useEffect(() => {
    const context = {
      getAppState: store.getState,
      setAppState: store.setState,
    };
    void applyModelSet(args, context, { persistDefault: true }).then(message => {
      // Error paths from applyModelSet are plain strings without "Set model"
      const isError =
        message.startsWith('Model ') ||
        message.startsWith('Opus ') ||
        message.startsWith('Sonnet ') ||
        message.startsWith('Failed to validate');
      onDone(message, isError ? { display: 'system' } : undefined);
    });
  }, [args, onDone, store]);

  return null;
}

function ShowModelAndClose({ onDone }: { onDone: (result?: string) => void }): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const effortValue = useAppState(s => s.effortValue);
  onDone(formatCurrentModel(mainLoopModel, mainLoopModelForSession, effortValue));
  return null;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || '';
  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    return <ShowModelAndClose onDone={onDone} />;
  }
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('Run /model to open the model selection menu, or /model [modelName] to set the model.', {
      display: 'system',
    });
    return;
  }

  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    return <SetModelAndClose args={args} onDone={onDone} />;
  }

  return <ModelPickerWrapper onDone={onDone} />;
};

function renderModelLabel(model: string | null): string {
  const rendered = renderDefaultModelSetting(model ?? getDefaultMainLoopModelSetting());
  return model === null ? `${rendered} (default)` : rendered;
}
