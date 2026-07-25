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
  const ultra = isUltracodeOfferable(model) ? ', ultracode' : '';
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
  const model = opts?.model ?? '';
  const ultracode = opts?.ultracode === true;
  // densable QLr: if (t) N9(); sLy non-interactive pin rejects earlier.
  const shouldUnpin = opts?.unpin ?? interactive;

  // densable: non-ultracode effort writes clear the ultracode flag.
  // densable QLr: only persist when interactive (t) and value is f4e-able.
  // Persist before env/pin messaging so interactive writes still land when
  // env will override the session (densable QLr then env then pin).
  const persistable = ultracode || !interactive ? undefined : toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable,
    });
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
        effortUpdate: { value: effortValue, ultracode },
      };
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: { value: effortValue, ultracode: false },
    };
  }

  // densable oLy: !interactive && Ave(model) → Not applied, still effortUpdate,
  // no N9 (cme keeps pin default over AppState). After env so headless+env+pin
  // surfaces env first (densable order).
  if (!ultracode && !interactive && model && isEffortLaunchPinned(model)) {
    const pinned = getDefaultEffortForModel(model) ?? effortValue;
    return {
      message: `Not applied: the launch-effort pin holds effort at ${pinned} this session. Run /effort ${effortValue} in an interactive terminal to release the pin.`,
      effortUpdate: { value: effortValue, ultracode: false },
    };
  }

  if (ultracode) {
    return {
      message: `Set effort level to ultracode (this session only): ${effortValue} + dynamic workflow orchestration`,
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
      message: `Effort '${opts.orgClampedFrom}' exceeds your organization's limit for ${model}; set to '${effortValue}' instead${suffix}: ${description}`,
      effortUpdate: { value: effortValue, ultracode: false },
    };
  }
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: { value: effortValue, ultracode: false },
  };
}

/**
 * densable sLy-shaped ultracode: session-only wire effort from catalog
 * (prefer xhigh when supported, else top ladder tier) + AppState.ultracode.
 *
 * densable pin gate: non-interactive + launch pin → reject (no update, no N9).
 * Interactive path unpins via N9 so wire effort can leave the launch default.
 */
export function setUltracodeEffort(model: string, interactive: boolean = getIsInteractive()): EffortCommandResult {
  if (!isUltracodeOfferable(model)) {
    const wire = getUltracodeEffortForModel(model);
    if (wire === undefined) {
      return {
        message: `Ultracode needs a model that supports effort. Valid options are: ${validEffortArgsForModel(model)}`,
      };
    }
    return {
      message: `Ultracode needs dynamic workflows enabled (see /config). Valid options are: ${validEffortArgsForModel(model)}`,
    };
  }

  const wire = getUltracodeEffortForModel(model)!;

  // densable sLy: non-interactive cannot release launch pin.
  if (!interactive && isEffortLaunchPinned(model)) {
    const pinned = getDefaultEffortForModel(model) ?? wire;
    return {
      message: `Not applied: the launch-effort pin holds effort at ${pinned} this session, and ultracode needs ${wire}. Run /effort ultracode in an interactive terminal to release the pin.`,
    };
  }

  return setEffortValue(wire, {
    ultracode: true,
    interactive,
    model,
    unpin: interactive,
  });
}

export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
  ultracodeFlag?: boolean,
): EffortCommandResult {
  if (isUltracodeModeActive(model, appStateEffort, ultracodeFlag)) {
    const wire = getUltracodeEffortForModel(model) ?? 'xhigh';
    return {
      message: `Current effort level: ultracode (${wire} + dynamic workflow orchestration; this session only)`,
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

function unsetEffortLevel(interactive: boolean = getIsInteractive()): EffortCommandResult {
  // densable QLr(undefined, t): persist + N9 only when interactive.
  if (interactive) {
    unpinAllEffortLaunchPins();
    const result = updateSettingsForSource('userSettings', {
      effortLevel: undefined,
    });
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
      effortUpdate: { value: undefined, ultracode: false },
    };
  }
  return {
    message: interactive ? 'Effort level set to auto' : 'Effort level set to auto (this session only)',
    effortUpdate: { value: undefined, ultracode: false },
  };
}

/**
 * densable aLy-shaped.
 * @param args command args
 * @param model current main-loop model (required for ultracode catalog clamp + pin)
 * @param interactive densable oLy/sLy `t` — default getIsInteractive()
 */
export function executeEffort(
  args: string,
  model = '',
  interactive: boolean = getIsInteractive(),
): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel(interactive);
  }

  if (normalized === 'ultracode') {
    return setUltracodeEffort(model, interactive);
  }

  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: ${validEffortArgsForModel(model)}`,
    };
  }

  // Clamp unsupported levels to the model ladder when model is known
  // (e.g. /effort xhigh on grok-4.5 → high). Clears ultracode flag.
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
    ultracode: false,
    interactive,
    model,
    orgClampedFrom,
  });
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
        effortValue: effortUpdate.value,
        ultracode: effortUpdate.ultracode ?? false,
      }));
    }
    onDone(message);
  }, [setAppState, effortUpdate, message, onDone]);
  return null;
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Usage: /effort [low|medium|high|xhigh|max|ultracode|auto]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extended reasoning beyond high, short of max\n- max: Maximum capability with deepest reasoning\n- ultracode: catalog top effort + dynamic workflow orchestration (this session only)\n- auto: Use the default effort level for your model',
    );
    return;
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
  const result = React.useMemo(() => executeEffort(args, model), [args, model]);
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
}

function EffortPanelWrapper({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue);
  return <EffortPanel appStateEffort={effortValue} onDone={onDone} />;
}
