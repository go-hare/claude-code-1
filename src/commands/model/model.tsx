import { Box, Dialog, Text } from '@anthropic/ink';
import * as React from 'react';
import { useState } from 'react';
import { Select } from '../../components/CustomSelect/index.js';
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
import { type EffortLevel, getDisplayedEffortLevel, modelSupportsEffort, pdSessionEffort } from '../../utils/effort.js';
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
import {
  getFableSessionFallbackConsented,
  getIsRemoteMode,
  setFableSessionFallbackConsented,
} from '../../bootstrap/state.js';
import { formatTokens } from '../../utils/format.js';
import {
  buildUnrecognizedModelNotice,
  MODEL_CONFIG_WINDOW_DOCS_URL,
  sanitizeModelForNotice,
} from '../../utils/model/unrecognizedModelSignal.js';
import { shouldApplyDeferredEffortCommit, shouldShowFableConsentDialog } from '../../utils/fableConsent.js';
import { saveSessionModel } from '../../utils/sessionStorage.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { runFunctionHookChain } from '../../utils/plugins/functionHooksModules.js';
import { MODEL_ALIASES } from '../../utils/model/aliases.js';
import { checkOpus1mAccess, checkSonnet1mAccess } from '../../utils/model/check1mAccess.js';
import { executePostModelSwitchHooks, executePreModelSwitchHooks } from '../../utils/hooks.js';
import {
  getDefaultMainLoopModel,
  getDefaultMainLoopModelSetting,
  getMainLoopModel,
  isOpus1mMergeEnabled,
  parseUserSpecifiedModel,
  renderDefaultModelSetting,
  renderModelName,
} from '../../utils/model/model.js';
import { formatDeniedModelsBlockMessage, isModelAllowed } from '../../utils/model/modelAllowlist.js';
import { em } from '../../utils/model/modelNoticeCode.js';
import { validateModel } from '../../utils/model/validateModel.js';

export type SaveModelHookResult = { kind: 'saved'; saved: string | null } | { kind: 'refused'; reason?: string };

export const CACHE_MISS_SUBTITLE = 'Your next response will be slower and use more tokens';

export function formatCacheSwitchBody(kind: 'model' | 'effort', targetLabel: string): string {
  const unit = kind === 'model' ? 'model' : 'effort level';
  return `This conversation is cached for the current ${unit}. Switching to ${targetLabel} means the full history gets re-read.`;
}

export function CacheMissConfirmDialog({
  kind,
  targetLabel,
  onConfirm,
  onCancel,
}: {
  kind: 'model' | 'effort';
  targetLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const title = kind === 'model' ? 'Switch model?' : 'Change effort level?';
  const confirmLabel = `Yes, switch to ${targetLabel}`;
  return (
    <Dialog title={title} subtitle={CACHE_MISS_SUBTITLE} color="warning" onCancel={onCancel} hideInputGuide>
      <Box flexDirection="column" gap={1} marginBottom={1}>
        <Text>{formatCacheSwitchBody(kind, targetLabel)}</Text>
        <Select
          options={[
            { label: confirmLabel, value: 'confirm' },
            { label: 'No, go back', value: 'cancel' },
          ]}
          onChange={value => {
            if (value === 'confirm') onConfirm();
            else onCancel();
          }}
          onCancel={onCancel}
        />
      </Box>
    </Dialog>
  );
}

/**
 * Official 2.1.295 (#407): ask plugin `config.set` hooks before persisting
 * a default model selection via `/model`.
 */
export async function saveModelWithConfigSetHook(
  model: string | null,
  previousModel: string | null | undefined,
  persistFn: (finalModel: string | null) => void = finalModel => {
    updateSettingsForSource('userSettings', { model: finalModel ?? undefined });
  },
  signal?: AbortSignal,
): Promise<SaveModelHookResult> {
  let saved: string | null | undefined;
  let didSave = false;
  try {
    const res = await runFunctionHookChain(
      'config.set',
      {
        key: 'model',
        value: model ?? '',
        previous: previousModel ?? '',
        origin: { kind: 'composer' },
      },
      async arg => {
        const finalModel = typeof arg?.value === 'string' ? (arg.value === '' ? null : arg.value) : model;
        saved = finalModel;
        didSave = true;
        persistFn(finalModel);
        return { value: finalModel ?? '' };
      },
      undefined,
      undefined,
      signal ? { signal } : undefined,
    );
    if (didSave) {
      return { kind: 'saved', saved: saved ?? null };
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

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const isFastMode = useAppState(s => s.fastMode);
  const setAppState = useSetAppState();
  // densable 2.1.289: Enter → onSetDefault then select; s → select only.
  const saveAsDefaultRef = React.useRef(false);
  const [pendingFable, setPendingFable] = useState<{
    model: string | null;
    effort: EffortLevel | undefined;
    persistAsDefault: boolean;
    /** ModelPicker N9/effort apply deferred until accept (not on decline). */
    commitEffort?: () => void;
  } | null>(null);

  function handleCancel(): void {
    logEvent('tengu_model_command_menu', {
      action: 'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    const displayModel = renderModelLabel(mainLoopModel);
    onDone(`Kept model as ${em(displayModel)}`, {
      display: 'system',
    });
  }

  async function commitModel(
    model: string | null,
    effort: EffortLevel | undefined,
    persistAsDefault: boolean,
  ): Promise<void> {
    // densable ye: RH(_y(), "switch") before PreModelSwitch when picking Default.
    if (model === null) {
      const blocked = formatDeniedModelsBlockMessage(getDefaultMainLoopModelSetting(), 'switch');
      if (blocked !== null) {
        logEvent('tengu_feature_bad', {
          feature_name: 'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code: 'denied_by_managed_settings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        onDone(blocked, { display: 'system' });
        return;
      }
    }
    const fromModel = mainLoopModel ? parseUserSpecifiedModel(mainLoopModel) : getMainLoopModel();
    const toModel = model ? parseUserSpecifiedModel(model) : getDefaultMainLoopModel();
    const pre = await executePreModelSwitchHooks({
      fromModel,
      toModel,
      requestedModel: model,
      source: 'picker',
    });
    if (pre.decision === 'block' || pre.decision === 'ask') {
      const extra = pre.messages.length > 0 ? `\n${pre.messages.join('\n')}` : '';
      onDone(`${pre.reason ?? 'PreModelSwitch hooks blocked the switch'}${extra}`, {
        display: 'system',
      });
      return;
    }
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
    // densable 2.1.289: Enter saves default; s is session-only (Gat vs not).
    // Official 2.1.295 (#407): ask plugin `config.set` hooks before persisting.
    let persistRefusedReason: string | undefined;
    let persistedDefault = false;
    if (persistAsDefault) {
      const saveResult = await saveModelWithConfigSetHook(model, mainLoopModel);
      if (saveResult.kind === 'saved') {
        persistedDefault = true;
      } else {
        persistRefusedReason = saveResult.reason;
      }
    }

    let message = `Set model to ${em(renderModelLabel(model))}`;
    message += persistedDefault
      ? ' and saved as your default for new sessions'
      : persistRefusedReason
        ? ` for this session only (default not saved: ${persistRefusedReason})`
        : ' for this session only';
    if (effort !== undefined) {
      const effortSaved = persistAsDefault && effort !== 'max';
      message +=
        persistAsDefault && !effortSaved
          ? ` \xB7 ${em(effort)} effort for this session only`
          : ` with ${em(effort)} effort`;
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
    if (!getIsRemoteMode()) {
      const notice = buildUnrecognizedModelNotice(model ?? getDefaultMainLoopModel());
      if (notice !== null) {
        message += `\n${formatModelCommandUnrecognizedWarning(notice)}`;
      }
    }
    if (pre.messages.length > 0) {
      message += `\n${pre.messages.join('\n')}`;
    }
    executePostModelSwitchHooks({
      fromModel,
      toModel,
      requestedModel: model,
      source: 'picker',
    });

    onDone(message);
  }

  function handleSelect(model: string | null, effort: EffortLevel | undefined, commitEffort?: () => void): void {
    const persistAsDefault = saveAsDefaultRef.current;
    saveAsDefaultRef.current = false;
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
      setPendingFable({ model, effort, persistAsDefault, commitEffort });
      return;
    }
    if (shouldApplyDeferredEffortCommit({ consentRequired: false })) {
      commitEffort?.();
    }
    void commitModel(model, effort, persistAsDefault);
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
          const { model, effort, persistAsDefault, commitEffort } = pendingFable;
          setPendingFable(null);
          // Accept only: apply deferred N9 + effort writes after consent.
          if (shouldApplyDeferredEffortCommit({ consentRequired: true, accepted: true })) {
            commitEffort?.();
          }
          void commitModel(model, effort, persistAsDefault);
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
      onSetDefault={() => {
        saveAsDefaultRef.current = true;
      }}
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
        await setModel(null);
        return;
      }

      // Skip validation for known aliases - they're predefined and should work
      if (isKnownAlias(model)) {
        await setModel(model);
        return;
      }

      // Validate and set custom model
      try {
        // Don't use parseUserSpecifiedModel for non-aliases since it lowercases the input
        // and model names are case-sensitive
        const { valid, error } = await validateModel(model);

        if (valid) {
          await setModel(model);
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

    async function setModel(modelValue: string | null): Promise<void> {
      // densable Hpe: RH(_y(), "switch") when `/model default`.
      if (modelValue === null) {
        const blocked = formatDeniedModelsBlockMessage(getDefaultMainLoopModelSetting(), 'switch');
        if (blocked !== null) {
          logEvent('tengu_feature_bad', {
            feature_name: 'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            error_code: 'denied_by_managed_settings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          onDone(blocked, { display: 'system' });
          return;
        }
      }
      const fromModel = getMainLoopModel();
      const toModel = modelValue ? parseUserSpecifiedModel(modelValue) : getDefaultMainLoopModel();
      const pre = await executePreModelSwitchHooks({
        fromModel,
        toModel,
        requestedModel: modelValue,
        source: 'command',
      });
      if (pre.decision === 'block' || pre.decision === 'ask') {
        const extra = pre.messages.length > 0 ? `\n${pre.messages.join('\n')}` : '';
        onDone(`${pre.reason ?? 'PreModelSwitch hooks blocked the switch'}${extra}`, {
          display: 'system',
        });
        return;
      }
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
      let message = `Set model to ${em(renderModelLabel(modelValue))}`;
      message += applied.suffix;
      if (!getIsRemoteMode()) {
        const notice = buildUnrecognizedModelNotice(modelValue ?? getDefaultMainLoopModel());
        if (notice !== null) {
          message += `\n${formatModelCommandUnrecognizedWarning(notice)}`;
        }
      }
      if (pre.messages.length > 0) {
        message += `\n${pre.messages.join('\n')}`;
      }
      executePostModelSwitchHooks({
        fromModel,
        toModel,
        requestedModel: modelValue,
        source: 'command',
      });
      onDone(message);
    }

    void handleModelChange();
  }, [model, onDone, setAppState]);

  return null;
}

function formatModelCommandUnrecognizedWarning(notice: { model: string; window: number; suggestion?: string }): string {
  const sanitized = sanitizeModelForNotice(notice.model);
  if (notice.suggestion !== undefined) {
    return `Claude Code doesn't recognize the model "${sanitized}". Did you mean "${notice.suggestion}"?`;
  }
  return `Claude Code doesn't recognize the model "${sanitized}", so it assumes a context window of ${formatTokens(notice.window)} tokens. Update Claude Code, or see ${MODEL_CONFIG_WINDOW_DOCS_URL} to set the window.`;
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
  const effortLevel = useAppState(s => pdSessionEffort(s));
  const displayModel = em(renderModelLabel(mainLoopModel));
  const effortInfo = effortLevel !== undefined ? ` (effort: ${effortLevel})` : '';

  if (
    mainLoopModelForSession !== null &&
    mainLoopModelForSession !== undefined &&
    mainLoopModelForSession !== mainLoopModel
  ) {
    onDone(
      `Current model: ${em(renderModelLabel(mainLoopModelForSession))} (this session only)${effortInfo}\nBase model: ${displayModel}`,
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
  // densable xE: LK(e??Uy()); null → `${o} (default)`. Non-null uses source
  // spelling so `[1m]` survives em/Jb (do not parse-then-market first).
  if (model === null) {
    return `${renderDefaultModelSetting(getDefaultMainLoopModelSetting())} (default)`;
  }
  return renderModelName(model);
}
