import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as costTracker from '../../cost-tracker.js';
import type { LocalJSXCommandContext } from '../../types/command.js';
import * as effortUtils from '../../utils/effort.js';
import * as fableConsent from '../../utils/fableConsent.js';
import * as hooks from '../../utils/hooks.js';
import * as sessionStorage from '../../utils/sessionStorage.js';
import * as settingsModule from '../../utils/settings/settings.js';
import { resetSettingsCache } from '../../utils/settings/settingsCache.js';
import * as effortCmd from '../effort/effort.js';
import * as modelCmd from '../model/model.js';
import {
  CLOUD_SESSION_PERMISSIONS_MANAGED_MESSAGE,
  CLOUD_SESSION_PERMISSIONS_MESSAGE,
  getCloudSessionPermissionsMessage,
} from '../permissions/permissions.js';

describe('Wave 1C: /effort purity & cache-miss confirmation [P1-#23]', () => {
  afterEach(() => {
    resetSettingsCache();
  });

  test('parseEffortCommand is pure (no settings write, no pin unpin)', () => {
    const updateSpy = spyOn(settingsModule, 'updateSettingsForSource');
    const unpinSpy = spyOn(effortUtils, 'unpinAllEffortLaunchPins');
    updateSpy.mockClear();
    unpinSpy.mockClear();
    try {
      const parsed = effortCmd.parseEffortCommand('low', 'claude-opus-4-5');
      expect(parsed).toEqual({ kind: 'level', level: 'low', orgClampedFrom: undefined });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(unpinSpy).not.toHaveBeenCalled();
    } finally {
      updateSpy.mockRestore();
      unpinSpy.mockRestore();
    }
  });

  test('/effort <level> in default mode with warm cache returns JSX confirmation without mutating settings or unpinning before confirmation', async () => {
    const tokensSpy = spyOn(costTracker, 'getTotalOutputTokens').mockReturnValue(250);
    const updateSpy = spyOn(settingsModule, 'updateSettingsForSource');
    const unpinSpy = spyOn(effortUtils, 'unpinAllEffortLaunchPins');
    updateSpy.mockClear();
    unpinSpy.mockClear();
    let doneCalled = false;
    let setAppStateCalled = false;

    try {
      const node = await effortCmd.call(
        () => {
          doneCalled = true;
        },
        {
          getAppState: () => ({
            mainLoopModel: 'claude-opus-4-5',
            mainLoopModelForSession: null,
            sessionEffort: effortUtils.levelSessionEffort('high'),
            effortValue: 'high',
            settingsEffortTable: undefined,
            ultracode: false,
            toolPermissionContext: { mode: 'default' },
          }),
          setAppState: () => {
            setAppStateCalled = true;
          },
        },
        'low',
      );

      // Must return a React confirmation element even in `default` mode (not restricted to `plan`)
      expect(node).not.toBeNull();
      expect(doneCalled).toBe(false);
      expect(setAppStateCalled).toBe(false);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(unpinSpy).not.toHaveBeenCalled();
    } finally {
      tokensSpy.mockRestore();
      updateSpy.mockRestore();
      unpinSpy.mockRestore();
    }
  });
});

describe('Wave 1C: /model status effort, Fable consent, PreModelSwitch ask, cache-miss & saveSessionModel [P1-#27]', () => {
  const savedEnvEffort = process.env.CLAUDE_CODE_EFFORT_LEVEL;

  afterEach(() => {
    if (savedEnvEffort === undefined) {
      delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
    } else {
      process.env.CLAUDE_CODE_EFFORT_LEVEL = savedEnvEffort;
    }
  });

  test('/model status uses explicit env/session effort (vge) and omits effort when unset or env=unset', () => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
    expect(modelCmd.getExplicitModelStatusEffort(undefined)).toBeUndefined();
    expect(modelCmd.getExplicitModelStatusEffort('medium')).toBe('medium');

    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'low';
    expect(modelCmd.getExplicitModelStatusEffort('medium')).toBe('low');

    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'unset';
    expect(modelCmd.getExplicitModelStatusEffort('high')).toBeUndefined();
  });

  test('/model <alias> direct path calls saveSessionModel and escalates on Fable consent, warm cache, or PreModelSwitch ask', async () => {
    const tokensSpy = spyOn(costTracker, 'getTotalOutputTokens').mockReturnValue(0);
    const saveSpy = spyOn(sessionStorage, 'saveSessionModel').mockImplementation(() => {});
    const hookSpy = spyOn(hooks, 'executePreModelSwitchHooks').mockResolvedValue({
      decision: 'proceed',
      skipConfirm: false,
      messages: [],
    });
    const postHookSpy = spyOn(hooks, 'executePostModelSwitchHooks').mockImplementation(async () => {});
    const fableSpy = spyOn(fableConsent, 'shouldShowFableConsentDialog').mockReturnValue(false);

    const makeCtx = () =>
      ({
        getAppState: () => ({
          fastMode: false,
          mainLoopModel: 'claude-haiku-4-5-20251001',
          mainLoopModelForSession: null,
        }),
        setAppState: () => {},
        messages: [],
      }) as unknown as LocalJSXCommandContext;

    try {
      // 1. Cold cache + allow hook -> executes inline (returns null) and persists via saveSessionModel
      let lastResult: string | undefined;
      const inlineNode = await modelCmd.call(
        res => {
          lastResult = res;
        },
        makeCtx(),
        'opus',
      );
      expect(inlineNode).toBeNull();
      expect(lastResult).toContain('Set model to');
      expect(saveSpy).toHaveBeenCalledWith('opus');

      // 2. Warm cache -> escalates to JSX confirmation dialog (does NOT commit yet)
      saveSpy.mockClear();
      tokensSpy.mockReturnValue(500);
      const cacheNode = await modelCmd.call(() => {}, makeCtx(), 'opus');
      expect(cacheNode).not.toBeNull();
      expect(saveSpy).not.toHaveBeenCalled();

      // 3. PreModelSwitch decision === 'ask' -> escalates to JSX confirmation dialog
      tokensSpy.mockReturnValue(0);
      hookSpy.mockResolvedValueOnce({
        decision: 'ask',
        reason: 'Hook asks for confirmation',
        messages: [],
      });
      const askNode = await modelCmd.call(() => {}, makeCtx(), 'opus');
      expect(askNode).not.toBeNull();
      expect(saveSpy).not.toHaveBeenCalled();

      // 4. Fable consent required -> escalates to JSX FableConsentDialog
      fableSpy.mockReturnValueOnce(true);
      const fableNode = await modelCmd.call(() => {}, makeCtx(), 'opus');
      expect(fableNode).not.toBeNull();
      expect(saveSpy).not.toHaveBeenCalled();
    } finally {
      tokensSpy.mockRestore();
      saveSpy.mockRestore();
      hookSpy.mockRestore();
      postHookSpy.mockRestore();
      fableSpy.mockRestore();
    }
  });
});

describe('Wave 1C: /permissions cloud gate [P1-#27]', () => {
  const savedRemote = process.env.CLAUDE_CODE_REMOTE;

  afterEach(() => {
    if (savedRemote === undefined) {
      delete process.env.CLAUDE_CODE_REMOTE;
    } else {
      process.env.CLAUDE_CODE_REMOTE = savedRemote;
    }
  });

  test('uses isEnvTruthy(CLAUDE_CODE_REMOTE) and checks projectSettings enabled', () => {
    process.env.CLAUDE_CODE_REMOTE = '0';
    expect(getCloudSessionPermissionsMessage()).toBeNull();
    process.env.CLAUDE_CODE_REMOTE = 'false';
    expect(getCloudSessionPermissionsMessage()).toBeNull();

    process.env.CLAUDE_CODE_REMOTE = '1';
    expect(getCloudSessionPermissionsMessage({ projectSettingsEnabled: false })).toBeNull();
    expect(
      getCloudSessionPermissionsMessage({
        projectSettingsEnabled: true,
        isManagedOnly: false,
      }),
    ).toBe(CLOUD_SESSION_PERMISSIONS_MESSAGE);
    expect(
      getCloudSessionPermissionsMessage({
        projectSettingsEnabled: true,
        isManagedOnly: true,
      }),
    ).toBe(CLOUD_SESSION_PERMISSIONS_MANAGED_MESSAGE);
  });
});

describe('Wave 1C: /add-dir atomic setAppState + memory cache invalidation [P1-#24]', () => {
  test('add-dir.tsx computes applyPermissionUpdate inside setAppState updater and clears memory caches', () => {
    const src = readFileSync(join(import.meta.dir, '../add-dir/add-dir.tsx'), 'utf8');
    expect(src).toContain('applyPermissionUpdate(prev.toolPermissionContext, permissionUpdate)');
    expect(src).toContain('clearMemoryFileCaches()');
  });
});
