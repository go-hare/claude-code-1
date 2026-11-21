import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
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
import { getTotalOutputTokens } from '../../cost-tracker.js';
import {
  clampEffortForModel,
  type EffortLevel,
  type EffortValue,
  getEffortEnvOverride,
  modelSupportsEffort,
  pdSessionEffort,
  resolveAppliedEffort,
  shouldWarnEffortCacheMiss,
} from '../../utils/effort.js';
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
  clearRefusalFallbackModelLatch,
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
import { isModelDenied } from '../../utils/model/entitlementOverlay.js';
import { formatDeniedModelsBlockMessage, isModelAllowed } from '../../utils/model/modelAllowlist.js';
import { em } from '../../utils/model/modelNoticeCode.js';
import { formatModelRestrictionOrCheckError, validateModel } from '../../utils/model/validateModel.js';

export { formatModelRestrictionOrCheckError };

/**
 * Official 2.1.323 `Ikt` (#2093): when `CLAUDE_CODE_EFFORT_LEVEL` overrides the
 * picked effort level for `model`, return the notice explaining what effort
 * actually stays active instead of misleadingly confirming the picked value.
 */
export function formatEffortEnvOverrideNotice(pickedEffort: EffortLevel, model: string): string | null {
  if (getEffortEnvOverride() === undefined || !modelSupportsEffort(model)) {
    return null;
  }
  const applied = resolveAppliedEffort(model, pickedEffort);
  const clampedPicked = clampEffortForModel(pickedEffort, model);
  if (applied === clampedPicked) {
    return null;
  }
  return `effort stays ${applied === undefined ? 'auto' : String(applied)} (set by CLAUDE_CODE_EFFORT_LEVEL)`;
}

export type SaveModelHookResult = { kind: 'saved'; saved: string | null } | { kind: 'refused'; reason?: string };

export const CACHE_MISS_SUBTITLE = 'Your next response will be slower and use more tokens';
export const HOOK_CONFIRM_SUBTITLE = 'A PreModelSwitch hook asked you to confirm';

export function formatCacheSwitchBody(kind: 'model' | 'effort', targetLabel: string): string {
  const unit = kind === 'model' ? 'model' : 'effort level';
  return `This conversation is cached for the current ${unit}. Switching to ${targetLabel} means the full history gets re-read.`;
}

/**
 * Official 2.1.328 `vge` (chunk@288282580.js & chunk@311071246.js @14382 `kqn`):
 * return explicit env/session effort for `/model status` without falling back
 * to `'high'` on Haiku or when no effort is configured.
 */
export function getExplicitModelStatusEffort(pdEffort: EffortValue | undefined): EffortValue | undefined {
  const envOverride = getEffortEnvOverride();
  return envOverride === null ? undefined : (envOverride ?? pdEffort);
}

function getLastAssistantModel(messages: readonly unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { type?: unknown; message?: { model?: unknown } } | undefined;
    if (msg?.type === 'assistant' && typeof msg.message?.model === 'string') {
      return msg.message.model;
    }
  }
  return undefined;
}

/**
 * Official 2.1.328 `JLo` (chunk@311071246.js @14000): true when switching to
 * `targetModel` on a warm conversation will invalidate the prompt cache.
 */
export function shouldWarnModelCacheMiss(opts: {
  targetModel: string | null;
  mainLoopModel: string | null;
  mainLoopModelForSession: string | null | undefined;
  totalOutputTokens: number;
  ackedAtOutputTokens?: number;
  lastAssistantModel?: string;
}): boolean {
  if (opts.totalOutputTokens === 0 || opts.totalOutputTokens === opts.ackedAtOutputTokens) {
    return false;
  }
  const targetResolved = parseUserSpecifiedModel(opts.targetModel ?? getDefaultMainLoopModel());
  const currentResolved = parseUserSpecifiedModel(
    opts.mainLoopModelForSession ?? opts.mainLoopModel ?? getDefaultMainLoopModel(),
  );
  if (targetResolved === currentResolved) {
    return false;
  }
  if (opts.lastAssistantModel) {
    const lastResolved = parseUserSpecifiedModel(opts.lastAssistantModel);
    if (opts.lastAssistantModel === targetResolved || lastResolved === targetResolved) {
      return false;
    }
  }
  return true;
}

function needsFableConsentForModel(model: string | null): boolean {
  const oauth = getOauthAccountInfo();
  return shouldShowFableConsentDialog({
    model,
    organizationUuid: oauth?.organizationUuid ?? null,
    accountUuid: oauth?.accountUuid ?? null,
    sessionFallbackConsented: getFableSessionFallbackConsented(),
  });
}

export function CacheMissConfirmDialog({
  kind,
  targetLabel,
  hookReason,
  onConfirm,
  onCancel,
}: {
  kind: 'model' | 'effort';
  targetLabel: string;
  hookReason?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const title = kind === 'model' ? 'Switch model?' : 'Change effort level?';
  const subtitle = hookReason !== undefined ? HOOK_CONFIRM_SUBTITLE : CACHE_MISS_SUBTITLE;
  const body = hookReason !== undefined ? hookReason : formatCacheSwitchBody(kind, targetLabel);
  const confirmLabel = `Yes, switch to ${targetLabel}`;
  // Official 2.1.326 #228: show key hints on "Switch model?" and "Change effort level?" dialogs.
  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      color="warning"
      onCancel={onCancel}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <KeyboardShortcutHint shortcut="Esc" action="go back" />
          </Byline>
        )
      }
    >
      <Box flexDirection="column" gap={1} marginBottom={1}>
        <Text>{body}</Text>
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

type PendingModelConfirm = {
  kind: 'model' | 'effort';
  model: string | null;
  effort?: EffortLevel | undefined;
  persistAsDefault?: boolean;
  commitEffort?: () => void;
  hookReason?: string;
  preMessages: string[];
  fromModel: string;
  toModel: string;
};

function ModelPickerWrapper({
  onDone,
  getMessages,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  getMessages?: () => readonly unknown[];
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const currentEffort = useAppState(s => pdSessionEffort(s));
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
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
  const [pendingConfirm, setPendingConfirm] = useState<PendingModelConfirm | null>(null);

  function handleCancel(): void {
    logEvent('tengu_model_command_menu', {
      action: 'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    const displayModel = renderModelLabel(mainLoopModel);
    onDone(`Kept model as ${em(displayModel)}`, {
      display: 'system',
    });
  }

  async function finalizePickerCommit(opts: {
    model: string | null;
    effort: EffortLevel | undefined;
    persistAsDefault: boolean;
    commitEffort?: () => void;
    fromModel: string;
    toModel: string;
    preMessages: string[];
  }): Promise<void> {
    const { model, effort, persistAsDefault, commitEffort, fromModel, toModel, preMessages } = opts;
    // Apply deferred N9 + effort writes only once confirmed & not cancelled.
    commitEffort?.();
    // Official 2.1.328 `$Be()` (chunk@283138841.js @113645, chunk@338430893.js @34271):
    // clear refusal fallback model latch when user picks a model.
    clearRefusalFallbackModelLatch('model_pick');
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
      const envOverrideNotice = formatEffortEnvOverrideNotice(effort, toModel);
      if (envOverrideNotice !== null) {
        message += ` \xB7 ${envOverrideNotice}`;
      } else {
        const effortSaved = persistAsDefault && effort !== 'max';
        message +=
          persistAsDefault && !effortSaved
            ? ` \xB7 ${em(effort)} effort for this session only`
            : ` with ${em(effort)} effort`;
      }
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
    if (preMessages.length > 0) {
      message += `\n${preMessages.join('\n')}`;
    }
    executePostModelSwitchHooks({
      fromModel,
      toModel,
      requestedModel: model,
      source: 'picker',
    });

    onDone(message);
  }

  async function runPickerHooksAndConfirm(
    model: string | null,
    effort: EffortLevel | undefined,
    persistAsDefault: boolean,
    commitEffort?: () => void,
  ): Promise<void> {
    const fromModel = mainLoopModel ? parseUserSpecifiedModel(mainLoopModel) : getMainLoopModel();
    const toModel = model ? parseUserSpecifiedModel(model) : getDefaultMainLoopModel();
    const pre = await executePreModelSwitchHooks({
      fromModel,
      toModel,
      requestedModel: model,
      source: 'picker',
    });
    if (pre.decision === 'block') {
      const extra = pre.messages.length > 0 ? `\n${pre.messages.join('\n')}` : '';
      onDone(`${pre.reason ?? 'PreModelSwitch hooks blocked the switch'}${extra}`, {
        display: 'system',
      });
      return;
    }
    if (pre.decision === 'ask') {
      setPendingConfirm({
        kind: 'model',
        model,
        effort,
        persistAsDefault,
        commitEffort,
        hookReason: pre.reason ?? 'Confirm switching the model',
        preMessages: pre.messages,
        fromModel,
        toModel,
      });
      return;
    }
    const totalOutputTokens = getTotalOutputTokens();
    const lastAssistantModel = getLastAssistantModel(getMessages?.());
    if (
      !pre.skipConfirm &&
      shouldWarnModelCacheMiss({
        targetModel: model,
        mainLoopModel,
        mainLoopModelForSession,
        totalOutputTokens,
        lastAssistantModel,
      })
    ) {
      setPendingConfirm({
        kind: 'model',
        model,
        effort,
        persistAsDefault,
        commitEffort,
        preMessages: pre.messages,
        fromModel,
        toModel,
      });
      return;
    }
    if (
      effort !== undefined &&
      shouldWarnEffortCacheMiss({
        target: effort,
        current: currentEffort,
        mainLoopModel: toModel,
        permissionMode,
        totalOutputTokens,
        promptCacheMayBeWarm: totalOutputTokens > 0,
      })
    ) {
      setPendingConfirm({
        kind: 'effort',
        model,
        effort,
        persistAsDefault,
        commitEffort,
        preMessages: pre.messages,
        fromModel,
        toModel,
      });
      return;
    }
    await finalizePickerCommit({
      model,
      effort,
      persistAsDefault,
      commitEffort,
      fromModel,
      toModel,
      preMessages: pre.messages,
    });
  }

  function handleSelect(model: string | null, effort: EffortLevel | undefined, commitEffort?: () => void): void {
    const persistAsDefault = saveAsDefaultRef.current;
    saveAsDefaultRef.current = false;
    // densable ye: RH(_y(), "switch") before Fable consent & PreModelSwitch when picking Default.
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
    // Official model_fable_consent densable gate before committing Fable.
    // Effort/N9 is deferred via commitEffort so decline does not unpin pins.
    if (needsFableConsentForModel(model)) {
      setPendingFable({ model, effort, persistAsDefault, commitEffort });
      return;
    }
    void runPickerHooksAndConfirm(
      model,
      effort,
      persistAsDefault,
      shouldApplyDeferredEffortCommit({ consentRequired: false }) ? commitEffort : undefined,
    );
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
          void runPickerHooksAndConfirm(
            model,
            effort,
            persistAsDefault,
            shouldApplyDeferredEffortCommit({ consentRequired: true, accepted: true }) ? commitEffort : undefined,
          );
        }}
        onDecline={() => {
          // Decline: drop deferred commitEffort (no N9 / no effort sticky).
          setPendingFable(null);
          handleCancel();
        }}
      />
    );
  }

  if (pendingConfirm) {
    const targetLabel =
      pendingConfirm.kind === 'model'
        ? renderModelLabel(pendingConfirm.model)
        : pendingConfirm.effort !== undefined
          ? String(pendingConfirm.effort)
          : 'auto';
    return (
      <CacheMissConfirmDialog
        kind={pendingConfirm.kind}
        targetLabel={targetLabel}
        hookReason={pendingConfirm.hookReason}
        onConfirm={() => {
          const confirm = pendingConfirm;
          setPendingConfirm(null);
          void finalizePickerCommit({
            model: confirm.model,
            effort: confirm.effort,
            persistAsDefault: confirm.persistAsDefault === true,
            commitEffort: confirm.commitEffort,
            fromModel: confirm.fromModel,
            toModel: confirm.toModel,
            preMessages: confirm.preMessages,
          });
        }}
        onCancel={() => {
          setPendingConfirm(null);
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

type DirectModelEscalation =
  | { escalate: 'none' }
  | { escalate: 'fable'; model: string | null }
  | {
      escalate: 'confirm';
      model: string | null;
      hookReason?: string;
      preMessages: string[];
      fromModel: string;
      toModel: string;
    };

function SetModelAndClose({
  args,
  onDone,
  getMessages,
  initialFableModel,
  initialConfirm,
}: {
  args: string;
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  getMessages?: () => readonly unknown[];
  initialFableModel?: string | null;
  initialConfirm?: Extract<DirectModelEscalation, { escalate: 'confirm' }>;
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const isFastMode = useAppState(s => s.fastMode);
  const setAppState = useSetAppState();
  const model = args === 'default' ? null : args;
  const [pendingFableModel, setPendingFableModel] = useState<{ model: string | null } | null>(
    initialFableModel !== undefined ? { model: initialFableModel } : null,
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingModelConfirm | null>(
    initialConfirm
      ? {
          kind: 'model',
          model: initialConfirm.model,
          hookReason: initialConfirm.hookReason,
          preMessages: initialConfirm.preMessages,
          fromModel: initialConfirm.fromModel,
          toModel: initialConfirm.toModel,
        }
      : null,
  );
  const startedRef = React.useRef(initialFableModel !== undefined || initialConfirm !== undefined);

  const finalizeCommandCommit = React.useCallback(
    (opts: { modelValue: string | null; fromModel: string; toModel: string; preMessages: string[] }): void => {
      const { modelValue, fromModel, toModel, preMessages } = opts;
      // Official 2.1.328 `$Be()` (chunk@283138841.js @113645, chunk@311071246.js @10754):
      // clear refusal fallback model latch on explicit `/model <name>` switch.
      clearRefusalFallbackModelLatch('model_pick');
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
      saveSessionModel(modelValue);
      let message = `Set model to ${em(renderModelLabel(modelValue))}`;
      message += applied.suffix;
      if (!getIsRemoteMode()) {
        const notice = buildUnrecognizedModelNotice(modelValue ?? getDefaultMainLoopModel());
        if (notice !== null) {
          message += `\n${formatModelCommandUnrecognizedWarning(notice)}`;
        }
      }
      if (preMessages.length > 0) {
        message += `\n${preMessages.join('\n')}`;
      }
      executePostModelSwitchHooks({
        fromModel,
        toModel,
        requestedModel: modelValue,
        source: 'command',
      });
      onDone(message);
    },
    [isFastMode, onDone, setAppState],
  );

  const runCommandHooksAndConfirm = React.useCallback(
    async (modelValue: string | null): Promise<void> => {
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
      if (pre.decision === 'block') {
        const extra = pre.messages.length > 0 ? `\n${pre.messages.join('\n')}` : '';
        onDone(`${pre.reason ?? 'PreModelSwitch hooks blocked the switch'}${extra}`, {
          display: 'system',
        });
        return;
      }
      if (pre.decision === 'ask') {
        setPendingConfirm({
          kind: 'model',
          model: modelValue,
          hookReason: pre.reason ?? 'Confirm switching the model',
          preMessages: pre.messages,
          fromModel,
          toModel,
        });
        return;
      }
      if (
        !pre.skipConfirm &&
        shouldWarnModelCacheMiss({
          targetModel: modelValue,
          mainLoopModel,
          mainLoopModelForSession,
          totalOutputTokens: getTotalOutputTokens(),
          lastAssistantModel: getLastAssistantModel(getMessages?.()),
        })
      ) {
        setPendingConfirm({
          kind: 'model',
          model: modelValue,
          preMessages: pre.messages,
          fromModel,
          toModel,
        });
        return;
      }
      finalizeCommandCommit({ modelValue, fromModel, toModel, preMessages: pre.messages });
    },
    [finalizeCommandCommit, getMessages, mainLoopModel, mainLoopModelForSession, onDone],
  );

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function handleModelChange(): Promise<void> {
      if (model && !isModelAllowed(model)) {
        onDone(formatModelRestrictionOrCheckError(model).message, {
          display: 'system',
        });
        return;
      }

      // Official 2.1.325 #2286: when cached entitlement denies `model`, re-probe
      // before reporting an org restriction so offline / network failures say
      // Claude Code could not check instead of blaming organization policy.
      if (model && isModelDenied(model)) {
        const probe = await validateModel(model);
        if (!probe.valid) {
          onDone(formatModelRestrictionOrCheckError(model, probe).message, {
            display: 'system',
          });
          return;
        }
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

      let validatedModel: string | null = model;
      if (model && !isKnownAlias(model)) {
        try {
          // Don't use parseUserSpecifiedModel for non-aliases since it lowercases the input
          // and model names are case-sensitive
          const { valid, error } = await validateModel(model);
          if (!valid) {
            onDone(error || `Model '${model}' not found`, {
              display: 'system',
            });
            return;
          }
          validatedModel = model;
        } catch (error) {
          onDone(`Failed to validate model: ${(error as Error).message}`, {
            display: 'system',
          });
          return;
        }
      }

      if (needsFableConsentForModel(validatedModel)) {
        setPendingFableModel({ model: validatedModel });
        return;
      }
      await runCommandHooksAndConfirm(validatedModel);
    }

    void handleModelChange();
  }, [model, onDone, runCommandHooksAndConfirm]);

  if (pendingFableModel) {
    const oauth = getOauthAccountInfo();
    return (
      <FableConsentDialog
        organizationUuid={oauth?.organizationUuid ?? null}
        accountUuid={oauth?.accountUuid ?? null}
        onAccept={({ sessionFallback }) => {
          if (sessionFallback) setFableSessionFallbackConsented(true);
          const target = pendingFableModel.model;
          setPendingFableModel(null);
          void runCommandHooksAndConfirm(target);
        }}
        onDecline={() => {
          setPendingFableModel(null);
          onDone(`Kept model as ${em(renderModelLabel(mainLoopModelForSession ?? mainLoopModel))}`, {
            display: 'system',
          });
        }}
      />
    );
  }

  if (pendingConfirm) {
    return (
      <CacheMissConfirmDialog
        kind="model"
        targetLabel={renderModelLabel(pendingConfirm.model)}
        hookReason={pendingConfirm.hookReason}
        onConfirm={() => {
          const confirm = pendingConfirm;
          setPendingConfirm(null);
          finalizeCommandCommit({
            modelValue: confirm.model,
            fromModel: confirm.fromModel,
            toModel: confirm.toModel,
            preMessages: confirm.preMessages,
          });
        }}
        onCancel={() => {
          setPendingConfirm(null);
          onDone(`Kept model as ${em(renderModelLabel(mainLoopModelForSession ?? mainLoopModel))}`, {
            display: 'system',
          });
        }}
      />
    );
  }

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

function formatModelStatusMessage({
  mainLoopModel,
  mainLoopModelForSession,
  pdEffort,
}: {
  mainLoopModel: string | null;
  mainLoopModelForSession: string | null | undefined;
  pdEffort: EffortValue | undefined;
}): string {
  // Official 2.1.328 `kqn` (chunk@311071246.js @14382): show explicit
  // env/session effort (`vge`) rather than `getDisplayedEffortLevel` so Haiku
  // and unset effort do not print `(effort: high)`.
  const effectiveEffort = getExplicitModelStatusEffort(pdEffort);
  const displayModel = em(renderModelLabel(mainLoopModel));
  const effortInfo = effectiveEffort !== undefined ? ` (effort: ${effectiveEffort})` : '';
  if (
    mainLoopModelForSession !== null &&
    mainLoopModelForSession !== undefined &&
    mainLoopModelForSession !== mainLoopModel
  ) {
    return `Current model: ${em(renderModelLabel(mainLoopModelForSession))} (this session only)${effortInfo}\nBase model: ${displayModel}`;
  }
  return `Current model: ${displayModel}${effortInfo}`;
}

function ShowModelAndClose({ onDone }: { onDone: (result?: string) => void }): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const pdEffort = useAppState(s => pdSessionEffort(s));
  onDone(formatModelStatusMessage({ mainLoopModel, mainLoopModelForSession, pdEffort }));
  return null;
}

async function executeDirectModelArg(
  args: string,
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void,
  context: {
    getAppState: () => {
      fastMode?: boolean;
      mainLoopModel?: string | null;
      mainLoopModelForSession?: string | null;
    };
    setAppState: ReturnType<typeof useSetAppState>;
    messages?: readonly unknown[];
  },
): Promise<DirectModelEscalation> {
  const model = args === 'default' ? null : args;
  const appState = context.getAppState();
  const isFastMode = Boolean(appState.fastMode);

  if (model && !isModelAllowed(model)) {
    onDone(formatModelRestrictionOrCheckError(model).message, { display: 'system' });
    return { escalate: 'none' };
  }

  if (model && isModelDenied(model)) {
    const probe = await validateModel(model);
    if (!probe.valid) {
      onDone(formatModelRestrictionOrCheckError(model, probe).message, { display: 'system' });
      return { escalate: 'none' };
    }
  }

  if (model && isOpus1mUnavailable(model)) {
    onDone(
      `Opus 4.7 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
      { display: 'system' },
    );
    return { escalate: 'none' };
  }

  if (model && isSonnet1mUnavailable(model)) {
    onDone(
      `Sonnet 5 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
      { display: 'system' },
    );
    return { escalate: 'none' };
  }

  let validatedModel: string | null = model;
  if (model && !isKnownAlias(model)) {
    try {
      const { valid, error } = await validateModel(model);
      if (!valid) {
        onDone(error || `Model '${model}' not found`, { display: 'system' });
        return { escalate: 'none' };
      }
      validatedModel = model;
    } catch (error) {
      onDone(`Failed to validate model: ${(error as Error).message}`, { display: 'system' });
      return { escalate: 'none' };
    }
  }

  if (validatedModel === null) {
    const blocked = formatDeniedModelsBlockMessage(getDefaultMainLoopModelSetting(), 'switch');
    if (blocked !== null) {
      logEvent('tengu_feature_bad', {
        feature_name: 'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code: 'denied_by_managed_settings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      onDone(blocked, { display: 'system' });
      return { escalate: 'none' };
    }
  }

  // Official 2.1.328 (chunk@338430893.js): share Fable consent gate before
  // switching directly via `/model <name>`.
  if (needsFableConsentForModel(validatedModel)) {
    return { escalate: 'fable', model: validatedModel };
  }

  const fromModel = getMainLoopModel();
  const toModel = validatedModel ? parseUserSpecifiedModel(validatedModel) : getDefaultMainLoopModel();
  const pre = await executePreModelSwitchHooks({
    fromModel,
    toModel,
    requestedModel: validatedModel,
    source: 'command',
  });
  if (pre.decision === 'block') {
    const extra = pre.messages.length > 0 ? `\n${pre.messages.join('\n')}` : '';
    onDone(`${pre.reason ?? 'PreModelSwitch hooks blocked the switch'}${extra}`, { display: 'system' });
    return { escalate: 'none' };
  }
  if (pre.decision === 'ask') {
    return {
      escalate: 'confirm',
      model: validatedModel,
      hookReason: pre.reason ?? 'Confirm switching the model',
      preMessages: pre.messages,
      fromModel,
      toModel,
    };
  }
  if (
    !pre.skipConfirm &&
    shouldWarnModelCacheMiss({
      targetModel: validatedModel,
      mainLoopModel: appState.mainLoopModel ?? null,
      mainLoopModelForSession: appState.mainLoopModelForSession,
      totalOutputTokens: getTotalOutputTokens(),
      lastAssistantModel: getLastAssistantModel(context.messages),
    })
  ) {
    return {
      escalate: 'confirm',
      model: validatedModel,
      preMessages: pre.messages,
      fromModel,
      toModel,
    };
  }
  // Official 2.1.328 `$Be()` (chunk@283138841.js @113645, chunk@311071246.js @10754):
  // clear refusal fallback model latch on explicit inline `/model <name>` switch.
  clearRefusalFallbackModelLatch('model_pick');
  if (isFastModeEnabled()) {
    clearFastModeCooldown();
  }
  const nextFast = resolveFastModeAfterModelSwitch(validatedModel, isFastMode);
  const billed = isBilledAsExtraUsage(validatedModel, nextFast, isOpus1mMergeEnabled());
  const applied = applyFastModeOnModelSwitch(validatedModel, isFastMode, {
    billedAsExtraUsage: billed,
  });
  context.setAppState(prev => ({
    ...prev,
    mainLoopModel: validatedModel,
    mainLoopModelForSession: null,
    ...(applied.changed ? { fastMode: applied.nextFastMode } : null),
  }));
  saveSessionModel(validatedModel);
  let message = `Set model to ${em(renderModelLabel(validatedModel))}`;
  message += applied.suffix;
  if (!getIsRemoteMode()) {
    const notice = buildUnrecognizedModelNotice(validatedModel ?? getDefaultMainLoopModel());
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
    requestedModel: validatedModel,
    source: 'command',
  });
  onDone(message);
  return { escalate: 'none' };
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  args = args?.trim() || '';
  const hasStateAccess = typeof context?.getAppState === 'function' && typeof context?.setAppState === 'function';
  const getMessages = () => context?.messages;

  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    // Official 2.1.326 #139: settle inline without mounting a null JSX panel so
    // the prompt never hides or drops typed characters.
    if (hasStateAccess) {
      const appState = context.getAppState();
      onDone(
        formatModelStatusMessage({
          mainLoopModel: appState.mainLoopModel,
          mainLoopModelForSession: appState.mainLoopModelForSession,
          pdEffort: pdSessionEffort(appState),
        }),
      );
      return null;
    }
    return <ShowModelAndClose onDone={onDone} />;
  }
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('Run /model to open the model selection menu, or /model [modelName] to set the model.', {
      display: 'system',
    });
    return null;
  }

  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    // Official 2.1.326 #139 + 2.1.328 (chunk@338430893.js): execute inline when
    // no consent or confirmation dialog is needed; escalate to JSX dialog for
    // Fable consent, PreModelSwitch `ask`, or warm-cache confirmation.
    if (hasStateAccess) {
      const direct = await executeDirectModelArg(args, onDone, context);
      if (direct.escalate === 'fable') {
        return (
          <SetModelAndClose args={args} onDone={onDone} getMessages={getMessages} initialFableModel={direct.model} />
        );
      }
      if (direct.escalate === 'confirm') {
        return <SetModelAndClose args={args} onDone={onDone} getMessages={getMessages} initialConfirm={direct} />;
      }
      return null;
    }
    return <SetModelAndClose args={args} onDone={onDone} getMessages={getMessages} />;
  }

  return <ModelPickerWrapper onDone={onDone} getMessages={getMessages} />;
};

function renderModelLabel(model: string | null): string {
  // densable xE: LK(e??Uy()); null → `${o} (default)`. Non-null uses source
  // spelling so `[1m]` survives em/Jb (do not parse-then-market first).
  if (model === null) {
    return `${renderDefaultModelSetting(getDefaultMainLoopModelSetting())} (default)`;
  }
  return renderModelName(model);
}
