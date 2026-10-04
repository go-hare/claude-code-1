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
import {
  type EffortLevel,
  type EffortValue,
  clampEffortForModel,
  getDefaultEffortForModel,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortValueDescription,
  getSupportedEffortLevels,
  getUltracodeEffortForModel,
  isEffortLevel,
  isUltracodeModeActive,
  isUltracodeOfferable,
  effortModelClearPatch,
  effortModelSettingsPatch,
  toPersistableEffort,
  unpinAllEffortLaunchPins,
} from '../../utils/effort.js';
import { isEffortLaunchPinned } from '../../utils/model/effortCatalog.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

const COMMON_HELP_ARGS = ['help', '-h', '--help'];

export type EffortCommandResult = {
  message: string;
  effortUpdate?: {
    value: EffortValue | undefined;
    /** densable: session ultracode orchestration flag */
    ultracode?: boolean;
  };
};

function validEffortArgsForModel(model: string): string {
  const levels = getSupportedEffortLevels(model);
  const base = levels.length > 0 ? levels.join(', ') : 'low, medium, high, xhigh, max';
  const ultra = isUltracodeOfferable(model) ? ', ultracode [on|off]' : '';
  return `${base}${ultra}, auto`;
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

  // densable oLy: !interactive && Ave(model) → Not applied, still effortUpdate,
  // no N9 (cme keeps pin default over AppState). After env so headless+env+pin
  // surfaces env first (densable order).
  if (!ultracode && !interactive && model && isEffortLaunchPinned(model)) {
    const pinned = getDefaultEffortForModel(model) ?? effortValue;
    return {
      message: `Not applied: the launch-effort pin holds effort at ${pinned} this session. Run /effort ${effortValue} in an interactive terminal to release the pin.`,
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
  // densable oLy: s persistable + interactive + !remote → saved-default suffix;
  // else session-only. We approximate: persistable write → saved; else session.
  const suffix = persistable !== undefined ? ' (saved as your default for new sessions)' : ' (this session only)';
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
 * densable 2.1.289 ultracode on: session flag only — does not force wire
 * effort to catalog top / xhigh. Effort stays whatever the session has.
 *
 * Launch-pin gate remains for interactive N9 when user confirms ultracode
 * while pin holds; non-interactive + pin still rejects (no empty flag).
 */
export function setUltracodeEffort(
  model: string,
  interactive: boolean = getIsInteractive(),
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

  // densable: non-interactive cannot release launch pin (still refuse).
  if (!interactive && isEffortLaunchPinned(model)) {
    const pinned = getDefaultEffortForModel(model) ?? getUltracodeEffortForModel(model) ?? 'high';
    return {
      message: `Not applied: the launch-effort pin holds effort at ${pinned} this session. Run /effort ultracode in an interactive terminal to release the pin.`,
    };
  }

  if (interactive) {
    unpinAllEffortLaunchPins();
  }

  logEvent('tengu_effort_command', {
    effort: 'ultracode' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  const stayed =
    currentEffort !== undefined
      ? currentEffort
      : (getDefaultEffortForModel(model) ?? getUltracodeEffortForModel(model) ?? 'high');

  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null && envOverride !== stayed) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session — clear it and ultracode takes over`,
      effortUpdate: { value: stayed, ultracode: true },
    };
  }

  return {
    message: `Ultracode on (this session only): effort stays ${stayed}`,
    effortUpdate: { value: stayed, ultracode: true },
  };
}

/** densable 2.1.289 ultracode off — clear flag only; effort unchanged. */
export function clearUltracodeFlag(currentEffort: EffortValue | undefined): EffortCommandResult {
  logEvent('tengu_effort_command', {
    effort: 'ultracode_off' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  const stayed = currentEffort ?? 'auto';
  return {
    message: `Ultracode off. Effort stays ${stayed}`,
    effortUpdate: { value: currentEffort, ultracode: false },
  };
}

export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
  ultracodeFlag?: boolean,
): EffortCommandResult {
  if (isUltracodeModeActive(model, appStateEffort, ultracodeFlag)) {
    const level =
      (isEffortLaunchPinned(model) ? undefined : appStateEffort) ?? getDisplayedEffortLevel(model, appStateEffort);
    return {
      message: `Current effort level: ${level} · Ultracode on (this session only)`,
    };
  }

  const envOverride = getEffortEnvOverride();
  // densable LJr: when launch pin is active, ignore AppState effort for display
  // (cme also ignores session under pin — show model default / auto path).
  const sessionEffort = isEffortLaunchPinned(model) ? undefined : appStateEffort;
  const effectiveValue = envOverride === null ? undefined : (envOverride ?? sessionEffort);
  if (effectiveValue === undefined) {
    const level = getDisplayedEffortLevel(model, sessionEffort);
    return { message: `Effort level: auto (currently ${level})` };
  }
  const description = getEffortValueDescription(effectiveValue);
  return {
    message: `Current effort level: ${effectiveValue} (${description})`,
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
    return {
      message: `Cleared effort from settings, but CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: { value: undefined },
    };
  }
  return {
    message: interactive ? 'Effort level set to auto' : 'Effort level set to auto (this session only)',
    effortUpdate: { value: undefined },
  };
}

/**
 * densable aLy-shaped + 2.1.289 ultracode [on|off].
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

  if (normalized === 'ultracode' || normalized === 'ultracode on') {
    return setUltracodeEffort(model, interactive, currentEffort);
  }
  if (normalized === 'ultracode off') {
    return clearUltracodeFlag(currentEffort);
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
 * densable gSi — /effort help text (2.1.289 ultracode [on|off] any effort).
 */
function buildEffortHelpText(model: string): string {
  const levels = getSupportedEffortLevels(model);
  const ultra = isUltracodeOfferable(model);
  const desc: Record<string, string> = {
    low: 'Quick, straightforward implementation',
    medium: 'Balanced approach with standard testing',
    high: 'Comprehensive implementation with extensive testing',
    xhigh: 'Extended reasoning with thorough analysis',
    max: 'Maximum capability with deepest reasoning',
  };
  const levelLines = levels.map(n => `- ${n}: ${desc[n] ?? getEffortValueDescription(n)}`).join('\n');
  const usage = `Usage: /effort [${levels.join('|')}${ultra ? '|ultracode [on|off]' : ''}|auto]`;
  return (
    `${usage}\n\nEffort levels:\n` +
    levelLines +
    (ultra
      ? '\n\nUltracode (any effort level, this session only):\n- ultracode [on|off]: dynamic workflow orchestration; does not change effort'
      : '') +
    '\n- auto: Use the default effort level for your model'
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
  const effortValue = useAppState(s => s.effortValue);
  const ultracode = useAppState(s => s.ultracode);
  const model = useMainLoopModel();
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
        // densable 2.1.289: only patch ultracode when the update names it —
        // normal effort writes leave the flag alone.
        effortValue: effortUpdate.value,
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
  const currentEffort = useAppState(s => s.effortValue);
  const result = React.useMemo(
    () => executeEffort(args, model, undefined, true, currentEffort),
    [args, model, currentEffort],
  );
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
}

function EffortPanelWrapper({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue);
  return <EffortPanel appStateEffort={effortValue} onDone={onDone} />;
}
