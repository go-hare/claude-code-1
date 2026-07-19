import * as React from 'react';
import { EffortPanel } from '../../components/EffortPanel/EffortPanel.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import {
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortValueDescription,
  isEffortLevel,
  isUltraEffortSessionActive,
  modelSupportsXhighEffort,
  toPersistableEffort,
} from '../../utils/effort.js';
import { isWorkflowsFeatureEnabled } from '../../utils/workflowDisableGate.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

const COMMON_HELP_ARGS = ['help', '-h', '--help'];

const EFFORT_USAGE_LEVELS = 'low, medium, high, xhigh, max, auto, ultracode';

export type EffortCommandResult = {
  message: string;
  /**
   * densable effortUpdate — value is effortValue; ultracode is the session
   * standing-orchestration flag (true only for /effort ultracode).
   */
  effortUpdate?: { value: EffortValue | undefined; ultracode?: boolean };
};

function setEffortValue(effortValue: EffortValue, opts?: { ultracode?: boolean }): EffortCommandResult {
  const ultracode = opts?.ultracode === true;
  // densable: ultracode is session-only (xhigh + flag); do not persist
  // effortLevel for the ultracode alias path.
  const persistable = ultracode ? undefined : toPersistableEffort(effortValue);
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
  logEvent('tengu_effort_command', {
    effort: (ultracode ? 'ultracode' : effortValue) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts — if env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    if (persistable === undefined || ultracode) {
      if (ultracode) {
        // densable still applies session update under env conflict for ultracode
        return {
          message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session — clear it and ultracode takes over`,
          effortUpdate: { value: effortValue, ultracode: true },
        };
      }
      return {
        message: `Not applied: CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: { value: effortValue, ultracode: false },
      };
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: { value: effortValue, ultracode: false },
    };
  }

  if (ultracode) {
    return {
      message: 'Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration',
      effortUpdate: { value: 'xhigh', ultracode: true },
    };
  }

  const description = getEffortValueDescription(effortValue);
  const suffix = persistable !== undefined ? '' : ' (this session only)';
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: { value: effortValue, ultracode: false },
  };
}

/**
 * densable LJr — when ultracode session active, report ultracode status.
 */
export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
  ultracode?: boolean,
): EffortCommandResult {
  if (isUltraEffortSessionActive(model, appStateEffort, ultracode)) {
    return {
      message: 'Current effort level: ultracode (xhigh + dynamic workflow orchestration; this session only)',
    };
  }
  const envOverride = getEffortEnvOverride();
  const effectiveValue = envOverride === null ? undefined : (envOverride ?? appStateEffort);
  if (effectiveValue === undefined) {
    const level = getDisplayedEffortLevel(model, appStateEffort);
    return { message: `Effort level: auto (currently ${level})` };
  }
  const description = getEffortValueDescription(effectiveValue);
  return {
    message: `Current effort level: ${effectiveValue} (${description})`,
  };
}

function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined,
  });
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`,
    };
  }
  logEvent('tengu_effort_command', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  // env=auto/unset (null) matches what /effort auto asks for, so only warn
  // when env is pinning a specific level that will keep overriding.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    return {
      message: `Cleared effort from settings, but CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: { value: undefined, ultracode: false },
    };
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: { value: undefined, ultracode: false },
  };
}

/**
 * densable sLy — /effort ultracode: xhigh + AppState.ultracode session flag.
 * Requires workflows feature + xhigh-capable model.
 */
function setUltracodeEffort(model: string): EffortCommandResult {
  if (!isWorkflowsFeatureEnabled()) {
    return {
      message: `Ultracode needs dynamic workflows enabled (see /config). Valid options are: ${EFFORT_USAGE_LEVELS}`,
    };
  }
  if (!modelSupportsXhighEffort(model)) {
    return {
      message: `Ultracode runs at xhigh effort, which ${model} doesn't support — switch to an xhigh-capable model. Valid options are: ${EFFORT_USAGE_LEVELS}`,
    };
  }
  return setEffortValue('xhigh', { ultracode: true });
}

export function executeEffort(args: string, opts?: { model?: string }): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel();
  }
  if (normalized === 'ultracode') {
    return setUltracodeEffort(opts?.model ?? 'unknown');
  }

  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: ${EFFORT_USAGE_LEVELS}`,
    };
  }

  return setEffortValue(normalized, { ultracode: false });
}

function ShowCurrentEffort({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue);
  const ultracode = useAppState(s => s.ultracode);
  const model = useMainLoopModel();
  const { message } = showCurrentEffort(effortValue, model, ultracode);
  onDone(message);
  return null;
}

/**
 * densable uSo apply path — set effortValue + ultracode session flag together.
 */
function ExecuteEffortAndClose({ args, onDone }: { args: string; onDone: (result: string) => void }): React.ReactNode {
  const model = useMainLoopModel();
  const setAppState = useSetAppState();
  React.useEffect(() => {
    const result = executeEffort(args, { model });
    if (result.effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: result.effortUpdate!.value,
        ultracode: result.effortUpdate!.ultracode === true,
      }));
    }
    onDone(result.message);
  }, [args, model, setAppState, onDone]);
  return null;
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Usage: /effort [low|medium|high|xhigh|max|auto|ultracode]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extended reasoning beyond high, short of max; including ChatGPT Codex models\n- max: Maximum capability with deepest reasoning\n- auto: Use the default effort level for your model\n- ultracode: Session-only xhigh + dynamic workflow orchestration',
    );
    return;
  }

  if (!args || args === 'current' || args === 'status') {
    if (args === 'current' || args === 'status') {
      return <ShowCurrentEffort onDone={onDone} />;
    }
    // 完全无参 → 打开交互面板
    return <EffortPanelWrapper onDone={onDone} />;
  }

  return <ExecuteEffortAndClose args={args} onDone={onDone} />;
}

function EffortPanelWrapper({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue);
  return <EffortPanel appStateEffort={effortValue} onDone={onDone} />;
}
