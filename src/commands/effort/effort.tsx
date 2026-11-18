import * as React from 'react';
import { getIsInteractive } from '../../bootstrap/state.js';
import { EffortPanel } from '../../components/EffortPanel/EffortPanel.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { CacheMissConfirmDialog } from '../model/model.js';
import { getTotalOutputTokens } from '../../cost-tracker.js';
import {
  type EffortLevel,
  type EffortValue,
  clampEffortForModel,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortValueDescription,
  getOrgDefaultEffort,
  getOrgOverrideStartupEffort,
  getSupportedEffortLevels,
  getUltracodeEffortForModel,
  isEffortLevel,
  isUltracodeModeActive,
  isUltracodeOfferable,
  effortModelClearPatch,
  effortModelSettingsPatch,
  explicitSessionEffort,
  pdSessionEffort,
  resolveAppliedEffort,
  shouldWarnEffortCacheMiss,
  teSettingsEffortTable,
  toPersistableEffort,
  unpinAllEffortLaunchPins,
} from '../../utils/effort.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

const COMMON_HELP_ARGS = ['help', '-h', '--help'];

/** densable `Oit` */
export const ULTRACODE_DESCRIPTION = 'dynamic workflows on every task';

export type EffortCommandResult = {
  message: string;
  effortUpdate?: {
    value?: EffortValue | undefined;
    /** densable: session ultracode orchestration flag */
    ultracode?: boolean;
  };
};

function validEffortArgsForModel(model: string): string {
  const levels = getSupportedEffortLevels(model);
  const base = levels.length > 0 ? levels.join(', ') : 'low, medium, high, xhigh, max';
  const ultra = isUltracodeOfferable(model) ? ', ultracode [on|off]' : '';
  return `${base}, auto${ultra}`;
}

function setEffortValue(
  effortValue: EffortValue,
  opts?: {
    ultracode?: boolean;
    /**
     * densable oLy/QLr `t` (interactive). Default getIsInteractive().
     * - interactive: persist settings (non-ultracode) + N9 unpin
     * - non-interactive: session-only AppState; no settings write; no N9
     */
    interactive?: boolean;
    /**
     * densable EffortSlider `s` / persistAsDefault. Default true.
     * false = session-only (like /model s): write AppState, N9, no settings.
     */
    persistAsDefault?: boolean;
    /** Model for densable oLy launch-pin gate. */
    model?: string;
    /**
     * densable N9 override. sLy passes interactive so non-interactive skips
     * unpin; default follows `interactive`.
     */
    unpin?: boolean;
    /**
     * densable oLy: user-requested level before org clamp (wve). When set and
     * different from applied effortValue, surface org-limit message (not for
     * capability max/xhigh→high clamps).
     */
    orgClampedFrom?: EffortLevel;
  },
): EffortCommandResult {
  const interactive = opts?.interactive ?? getIsInteractive();
  const persistAsDefault = opts?.persistAsDefault ?? true;
  const model = opts?.model ?? '';
  const ultracode = opts?.ultracode === true;
  // densable QLr: if (t) N9(); sLy non-interactive pin rejects earlier.
  // Session-only `s` still unpins when writing session effort (N9 on write).
  const shouldUnpin = opts?.unpin ?? interactive;

  // densable 2.1.289: normal effort writes no longer clear ultracode — the
  // flag stays on at any effort. Only ultracode off / explicit false clears.
  // densable QLr: only persist when interactive (t) and value is f4e-able.
  // persistAsDefault=false (EffortSlider s) is session-only like /model s.
  // Persist before env/pin messaging so interactive writes still land when
  // env will override the session (densable QLr then env then pin).
  const persistable =
    ultracode || !interactive || persistAsDefault === false ? undefined : toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const patch = model.length > 0 ? effortModelSettingsPatch(model, persistable) : { effortLevel: persistable };
    const result = updateSettingsForSource('userSettings', patch);
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`,
      };
    }
  }

  // densable QLr: if (t) N9() — after successful settings write path.
  // Non-interactive pin path must NOT unpin (oLy / sLy).
  if (shouldUnpin) {
    unpinAllEffortLaunchPins();
  }

  logEvent('tengu_effort_command', {
    effort: (ultracode ? 'ultracode' : effortValue) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  // densable oLy order: env check before launch-pin messaging.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    if (ultracode || persistable === undefined) {
      return {
        message: ultracode
          ? `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session — clear it and ultracode takes over`
          : `Not applied: CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: { value: effortValue, ...(ultracode ? { ultracode: true } : {}) },
      };
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: { value: effortValue },
    };
  }

  if (ultracode) {
    return {
      message: `Ultracode on (this session only): effort stays ${effortValue}`,
      effortUpdate: { value: effortValue, ultracode: true },
    };
  }

  const description = getEffortValueDescription(effortValue);
  // densable 2.1.289 `V` @200201150: swn(model) org-override saved note when
  // persistable write succeeded; else saved-default or session-only.
  const orgStartupLevel = persistable !== undefined && model ? getOrgOverrideStartupEffort(model) : null;
  const suffix =
    persistable !== undefined
      ? orgStartupLevel !== null
        ? ` (saved, though your organization starts new sessions on ${model} at ${orgStartupLevel} effort)`
        : ' (saved as your default for new sessions)'
      : ' (this session only)';
  // densable oLy: i = wve(e) !== e → org exceed message (not capability clamp).
  if (opts?.orgClampedFrom !== undefined && opts.orgClampedFrom !== effortValue && typeof effortValue === 'string') {
    return {
      message: `Effort '${opts.orgClampedFrom}' exceeds the cap for ${model} set by your settings or organization; set to '${effortValue}' instead${suffix}: ${description}`,
      effortUpdate: { value: effortValue },
    };
  }
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: { value: effortValue },
  };
}

/**
 * densable 2.1.289 D(true, ...): session flag only — does not force wire
 * effort to catalog top / xhigh and does NOT release launch pins or touch
 * sessionEffort (kAe leaves sessionEffort untouched when ultracode !== undefined).
 */
export function setUltracodeEffort(
  model: string,
  _interactive: boolean = getIsInteractive(),
  currentEffort?: EffortValue,
): EffortCommandResult {
  if (!isUltracodeOfferable(model)) {
    const wire = getUltracodeEffortForModel(model);
    if (wire === undefined) {
      return {
        message: `Ultracode isn't available on ${model || 'this model'}. Valid options are: ${validEffortArgsForModel(model)}`,
      };
    }
    return {
      message: `Ultracode needs dynamic workflows enabled (see /config). Valid options are: ${validEffortArgsForModel(model)}`,
    };
  }

  logEvent('tengu_effort_command', {
    effort: 'ultracode' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  const envOverride = getEffortEnvOverride();
  const effectiveEnv = envOverride === null ? undefined : envOverride;
  const stayed = effectiveEnv ?? currentEffort ?? resolveAppliedEffort(model, currentEffort) ?? 'auto';

  return {
    message: `Ultracode on (this session only): ${ULTRACODE_DESCRIPTION}. Effort stays ${stayed}.`,
    effortUpdate: { ultracode: true },
  };
}

/** densable 2.1.289 D(false, ...) — clear flag only; effort and pins unchanged. */
export function clearUltracodeFlag(currentEffort: EffortValue | undefined, model = ''): EffortCommandResult {
  logEvent('tengu_effort_command', {
    effort: 'ultracode_off' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  const envOverride = getEffortEnvOverride();
  const effectiveEnv = envOverride === null ? undefined : envOverride;
  const stayed =
    effectiveEnv ?? currentEffort ?? (model ? (resolveAppliedEffort(model, currentEffort) ?? 'auto') : 'auto');
  return {
    message: `Ultracode off. Effort stays ${stayed}.`,
    effortUpdate: { ultracode: false },
  };
}

/** densable 2.1.289 `hPt` — current effort + org default note + ultracode suffix. */
export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
  ultracodeFlag?: boolean,
): EffortCommandResult {
  const ultracodeSuffix = isUltracodeModeActive(model, appStateEffort, ultracodeFlag) ? ' · Ultracode on' : '';
  const envOverride = getEffortEnvOverride();
  const effectiveValue = envOverride === null ? undefined : (envOverride ?? appStateEffort);
  if (effectiveValue === undefined) {
    const level = resolveAppliedEffort(model, appStateEffort);
    if (level === undefined) {
      return { message: `Effort level: auto${ultracodeSuffix}` };
    }
    const orgNote =
      getOrgDefaultEffort(model) !== null && getEffortEnvOverride() !== null ? ', set by your organization' : '';
    return { message: `Effort level: auto (currently ${level}${orgNote})${ultracodeSuffix}` };
  }
  const description = getEffortValueDescription(effectiveValue);
  return {
    message: `Current effort level: ${effectiveValue} (${description})${ultracodeSuffix}`,
  };
}

function unsetEffortLevel(interactive: boolean = getIsInteractive(), model = ''): EffortCommandResult {
  // densable QLr(undefined, t): persist + N9 only when interactive.
  // densable 2.1.289: clearing effort does NOT clear ultracode.
  if (interactive) {
    unpinAllEffortLaunchPins();
    const patch = model.length > 0 ? effortModelClearPatch(model) : { effortLevel: undefined };
    const result = updateSettingsForSource('userSettings', patch);
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`,
      };
    }
  }
  logEvent('tengu_effort_command', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    const prefix = interactive ? 'Cleared effort from settings, but' : 'Effort set to auto for this session, but';
    return {
      message: `${prefix} CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: { value: undefined },
    };
  }
  return {
    message: interactive ? 'Effort level set to auto' : 'Effort level set to auto (this session only)',
    effortUpdate: { value: undefined },
  };
}

function parseUltracodeSubcommand(normalized: string): boolean | undefined {
  const [head, sub, ...rest] = normalized.split(/\s+/);
  if (head !== 'ultracode' || rest.length > 0) return undefined;
  if (sub === undefined || sub === 'on') return true;
  return sub === 'off' ? false : undefined;
}

/**
 * densable T / kAe — /effort + 2.1.289 ultracode [on|off].
 * @param args command args
 * @param model current main-loop model (required for ultracode catalog clamp + pin)
 * @param interactive densable oLy/sLy `t` — default getIsInteractive()
 * @param persistAsDefault EffortSlider s
 * @param currentEffort session effort for ultracode on/off "stays" copy
 */
export function executeEffort(
  args: string,
  model = '',
  interactive: boolean = getIsInteractive(),
  persistAsDefault = true,
  currentEffort?: EffortValue,
): EffortCommandResult {
  const normalized = args.toLowerCase().trim();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel(interactive, model);
  }

  const ultracodeSub = parseUltracodeSubcommand(normalized);
  if (ultracodeSub !== undefined) {
    return ultracodeSub
      ? setUltracodeEffort(model, interactive, currentEffort)
      : clearUltracodeFlag(currentEffort, model);
  }

  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: ${validEffortArgsForModel(model)}`,
    };
  }

  // Clamp unsupported levels to the model ladder when model is known
  // (e.g. /effort xhigh on grok-4.5 → high). densable 2.1.289: does NOT clear ultracode.
  // densable oLy uses wve (org-only) for the exceed flag; capability clamp
  // is separate and must not trigger the org-limit message.
  let level: EffortLevel = normalized;
  let orgClampedFrom: EffortLevel | undefined;
  if (model) {
    const { clampEffortToOrgLimit } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/model/effortCatalog.js') as typeof import('../../utils/model/effortCatalog.js');
    const afterOrg = clampEffortToOrgLimit(level, model);
    if (afterOrg !== level) {
      orgClampedFrom = level;
    }
    const clamped = clampEffortForModel(afterOrg, model);
    if (typeof clamped === 'string') {
      level = clamped;
    }
  }

  return setEffortValue(level, {
    interactive,
    model,
    orgClampedFrom,
    persistAsDefault,
  });
}

/**
 * densable lZt — /effort help text (2.1.289 ultracode [on|off] any effort).
 */
function buildEffortHelpText(model: string): string {
  const levels = getSupportedEffortLevels(model);
  const ultra = isUltracodeOfferable(model);
  const desc: Record<string, string> = {
    low: 'Quick, straightforward implementation',
    medium: 'Balanced approach with standard testing',
    high: 'Comprehensive implementation with extensive testing',
    xhigh: 'Extended reasoning with thorough analysis (on supported models)',
    max: 'Maximum capability with deepest reasoning (on supported models)',
  };
  const levelLines = levels.map(n => `- ${n}: ${desc[n] ?? getEffortValueDescription(n)}\n`).join('');
  const usage = `Usage: /effort [${levels.join('|')}|auto${ultra ? '|ultracode [on|off]' : ''}]`;
  return (
    `${usage}\n\nEffort levels:\n` +
    levelLines +
    '- auto: Use the default effort level for your model' +
    (ultra
      ? `\n\nUltracode (any effort level, this session only):\n- ultracode [on|off]: ${ULTRACODE_DESCRIPTION}`
      : '')
  );
}

function EffortHelpText({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const model = useMainLoopModel();
  React.useEffect(() => {
    onDone(buildEffortHelpText(model));
  }, [model, onDone]);
  return null;
}

function ShowCurrentEffort({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const model = useMainLoopModel();
  const effortValue = useAppState(s => pdSessionEffort(s, model));
  const ultracode = useAppState(s => s.ultracode);
  const { message } = showCurrentEffort(effortValue, model, ultracode);
  onDone(message);
  return null;
}

function ApplyEffortAndClose({
  result,
  onDone,
}: {
  result: EffortCommandResult;
  onDone: (result: string) => void;
}): React.ReactNode {
  const setAppState = useSetAppState();
  const { effortUpdate, message } = result;
  React.useEffect(() => {
    if (effortUpdate) {
      setAppState(prev => ({
        ...prev,
        // densable 2.1.289 kAe: ultracode-only updates leave sessionEffort and
        // effortValue untouched (preserving { kind: 'inherit' }); normal effort
        // updates leave ultracode alone.
        ...(effortUpdate.ultracode === undefined
          ? {
              sessionEffort: explicitSessionEffort(effortUpdate.value),
            }
          : {}),
        settingsEffortTable: teSettingsEffortTable(),
        ...(effortUpdate.ultracode !== undefined ? { ultracode: effortUpdate.ultracode } : {}),
      }));
    }
    onDone(message);
  }, [setAppState, effortUpdate, message, onDone]);
  return null;
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';

  if (COMMON_HELP_ARGS.includes(args)) {
    // densable gSi — model-filtered dash list (SEA help string shape).
    return <EffortHelpText onDone={onDone} />;
  }

  if (!args || args === 'current' || args === 'status') {
    if (args === 'current' || args === 'status') {
      return <ShowCurrentEffort onDone={onDone} />;
    }
    return <EffortPanelWrapper onDone={onDone} />;
  }

  return <ExecuteEffortWithModel args={args} onDone={onDone} />;
}

function ExecuteEffortWithModel({ args, onDone }: { args: string; onDone: (result: string) => void }): React.ReactNode {
  const model = useMainLoopModel();
  const currentEffort = useAppState(s => pdSessionEffort(s, model));
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const [confirmed, setConfirmed] = React.useState(false);
  const result = React.useMemo(
    () => executeEffort(args, model, undefined, true, currentEffort),
    [args, model, currentEffort],
  );
  const targetEffort = result.effortUpdate?.value;
  const needsCacheConfirm =
    !confirmed &&
    result.effortUpdate !== undefined &&
    permissionMode === 'plan' &&
    shouldWarnEffortCacheMiss({
      target: targetEffort,
      current: currentEffort,
      mainLoopModel: model,
      permissionMode,
      totalOutputTokens: getTotalOutputTokens(),
      promptCacheMayBeWarm: getTotalOutputTokens() > 0,
    });
  if (needsCacheConfirm) {
    const targetLabel = targetEffort !== undefined ? String(targetEffort) : 'auto';
    return (
      <CacheMissConfirmDialog
        kind="effort"
        targetLabel={targetLabel}
        onConfirm={() => setConfirmed(true)}
        onCancel={() => onDone('Effort level unchanged')}
      />
    );
  }
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
}

function EffortPanelWrapper({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const model = useMainLoopModel();
  const effortValue = useAppState(s => pdSessionEffort(s, model));
  return <EffortPanel appStateEffort={effortValue} onDone={onDone} />;
}
