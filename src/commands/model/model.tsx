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
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { EffortLevel } from '../../utils/effort.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import {
  applyFastModeOnModelSwitch,
  clearFastModeCooldown,
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
  resolveFastModeAfterModelSwitch,
} from '../../utils/fastMode.js';
import { getOauthAccountInfo } from '../../utils/auth.js';
import { getFableSessionFallbackConsented, setFableSessionFallbackConsented } from '../../bootstrap/state.js';
import { shouldApplyDeferredEffortCommit, shouldShowFableConsentDialog } from '../../utils/fableConsent.js';
import { saveSessionModel } from '../../utils/sessionStorage.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { MODEL_ALIASES } from '../../utils/model/aliases.js';
import { checkOpus1mAccess, checkSonnet1mAccess } from '../../utils/model/check1mAccess.js';
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
} from '../../utils/model/model.js';
import { isModelAllowed } from '../../utils/model/modelAllowlist.js';
import { validateModel } from '../../utils/model/validateModel.js';

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
    /** ModelPicker N9/effort apply deferred until accept (not on decline). */
    commitEffort?: () => void;
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

  function commitModel(model: string | null, effort: EffortLevel | undefined): void {
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
    // Persist as default for new sessions (matching upstream 2.1.153 behavior)
    updateSettingsForSource('userSettings', { model: model ?? undefined });

    let message = `Set model to ${chalk.bold(renderModelLabel(model))}`;
    if (effort !== undefined) {
      message += ` with ${chalk.bold(effort)} effort`;
    }

    // densable 2.1.218 #31 — Rft/uU/dU on /model picker confirm
    if (isFastModeEnabled()) {
      clearFastModeCooldown();
    }
    const nextFast = resolveFastModeAfterModelSwitch(model, isFastMode);
    const billed = isBilledAsExtraUsage(model, nextFast, isOpus1mMergeEnabled());
    const applied = applyFastModeOnModelSwitch(model, isFastMode, {
      // densable hotkey path uses announceKeptOn only via Rft opts; /model
      // matches densable: announce ON when next is on and (prev off OR kept)
      // — default Rft is ON only when !prev||announceKeptOn; densable
      // picker uses announceKeptOn undefined so ON only on restore.
      billedAsExtraUsage: billed,
    });
    if (applied.changed) {
      setAppState(prev => ({
        ...prev,
        fastMode: applied.nextFastMode,
      }));
    }
    message += applied.suffix;

    onDone(message);
  }

  function handleSelect(model: string | null, effort: EffortLevel | undefined, commitEffort?: () => void): void {
    // Official model_fable_consent densable gate before committing Fable.
    // Pass org/account identity so persisted fableOverageConsentV2 is honored
    // (query.ts already does this; the /model picker previously omitted it).
    // Effort/N9 is deferred via commitEffort so decline does not unpin pins.
    const oauth = getOauthAccountInfo();
    const consentRequired = shouldShowFableConsentDialog({
      model,
      organizationUuid: oauth?.organizationUuid ?? null,
      accountUuid: oauth?.accountUuid ?? null,
      sessionFallbackConsented: getFableSessionFallbackConsented(),
    });
    if (consentRequired) {
      setPendingFable({ model, effort, commitEffort });
      return;
    }
    if (shouldApplyDeferredEffortCommit({ consentRequired: false })) {
      commitEffort?.();
    }
    commitModel(model, effort);
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
          const { model, effort, commitEffort } = pendingFable;
          setPendingFable(null);
          // Accept only: apply deferred N9 + effort writes after consent.
          if (shouldApplyDeferredEffortCommit({ consentRequired: true, accepted: true })) {
            commitEffort?.();
          }
          commitModel(model, effort);
        }}
        onDecline={() => {
          // Decline: drop deferred commitEffort (no N9 / no effort sticky).
          // shouldApplyDeferredEffortCommit({ consentRequired: true, accepted: false }) === false
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
      onCancel={handleCancel}
      isStandaloneCommand
      deferEffortApply
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
  const isFastMode = useAppState(s => s.fastMode);
  const setAppState = useSetAppState();
  const model = args === 'default' ? null : args;

  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      if (model && !isModelAllowed(model)) {
        onDone(`Model '${model}' is not available. Your organization restricts model selection.`, {
          display: 'system',
        });
        return;
      }

      // @[MODEL LAUNCH]: Update check for 1M access.
      if (model && isOpus1mUnavailable(model)) {
        onDone(
          `Opus 4.7 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
          { display: 'system' },
        );
        return;
      }

      if (model && isSonnet1mUnavailable(model)) {
        onDone(
          `Sonnet 5 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
          { display: 'system' },
        );
        return;
      }

      // Skip validation for default model
      if (!model) {
        setModel(null);
        return;
      }

      // Skip validation for known aliases - they're predefined and should work
      if (isKnownAlias(model)) {
        setModel(model);
        return;
      }

      // Validate and set custom model
      try {
        // Don't use parseUserSpecifiedModel for non-aliases since it lowercases the input
        // and model names are case-sensitive
        const { valid, error } = await validateModel(model);

        if (valid) {
          setModel(model);
        } else {
          onDone(error || `Model '${model}' not found`, {
            display: 'system',
          });
        }
      } catch (error) {
        onDone(`Failed to validate model: ${(error as Error).message}`, {
          display: 'system',
        });
      }
    }

    function setModel(modelValue: string | null): void {
      // densable 2.1.218 #31 — Rft/uU/dU on `/model <name>` non-interactive set
      if (isFastModeEnabled()) {
        clearFastModeCooldown();
      }
      const nextFast = resolveFastModeAfterModelSwitch(modelValue, isFastMode);
      const billed = isBilledAsExtraUsage(modelValue, nextFast, isOpus1mMergeEnabled());
      const applied = applyFastModeOnModelSwitch(modelValue, isFastMode, {
        billedAsExtraUsage: billed,
      });
      setAppState(prev => ({
        ...prev,
        mainLoopModel: modelValue,
        mainLoopModelForSession: null,
        ...(applied.changed ? { fastMode: applied.nextFastMode } : null),
      }));
      let message = `Set model to ${chalk.bold(renderModelLabel(modelValue))}`;
      message += applied.suffix;
      onDone(message);
    }

    void handleModelChange();
  }, [model, onDone, setAppState]);

  return null;
}

function isKnownAlias(model: string): boolean {
  return (MODEL_ALIASES as readonly string[]).includes(model.toLowerCase().trim());
}

function isOpus1mUnavailable(model: string): boolean {
  const m = model.toLowerCase();
  return !checkOpus1mAccess() && !isOpus1mMergeEnabled() && m.includes('opus') && m.includes('[1m]');
}

function isSonnet1mUnavailable(model: string): boolean {
  const m = model.toLowerCase();
  // Warn about Sonnet / Sonnet 5 / Sonnet 4.6 1M, but not Sonnet 4.5 (different access).
  return (
    !checkSonnet1mAccess() && (m.includes('sonnet[1m]') || m.includes('sonnet-5[1m]') || m.includes('sonnet-4-6[1m]'))
  );
}

function ShowModelAndClose({ onDone }: { onDone: (result?: string) => void }): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const effortValue = useAppState(s => s.effortValue);
  const displayModel = renderModelLabel(mainLoopModel);
  const effortInfo = effortValue !== undefined ? ` (effort: ${effortValue})` : '';

  if (mainLoopModelForSession) {
    onDone(
      `Current model: ${chalk.bold(renderModelLabel(mainLoopModelForSession))} (session override from plan mode)\nBase model: ${displayModel}${effortInfo}`,
    );
  } else {
    onDone(`Current model: ${displayModel}${effortInfo}`);
  }

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
