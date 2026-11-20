import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as React from 'react';
import { Text, wrappedRender as render } from '@anthropic/ink';
import { useUpdateNotification } from '../../hooks/useUpdateNotification.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import * as growthbook from '../../services/analytics/growthbook.js';
import { AppStateProvider } from '../../state/AppState.js';
import * as autoUpdaterMod from '../../utils/autoUpdater.js';
import * as configMod from '../../utils/config.js';
import * as doctorDiagMod from '../../utils/doctorDiagnostic.js';
import * as localInstallerMod from '../../utils/localInstaller.js';
import * as nativeInstallerMod from '../../utils/nativeInstaller/index.js';
import * as packageManagersMod from '../../utils/nativeInstaller/packageManagers.js';
import * as updateResultMod from '../../utils/updateResult.js';
import { AutoUpdater } from '../AutoUpdater.js';
import { ChannelDowngradeDialog, type ChannelDowngradeChoice } from '../ChannelDowngradeDialog.js';
import { NativeAutoUpdater } from '../NativeAutoUpdater.js';
import { PackageManagerAutoUpdater } from '../PackageManagerAutoUpdater.js';

function makeTtyPair() {
  const chunks: string[] = [];
  const stdout = Object.assign(new PassThrough(), {
    columns: 140,
    rows: 40,
    isTTY: true,
  });
  stdout.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return stdin;
    },
    ref() {
      return stdin;
    },
    unref() {
      return stdin;
    },
  });
  return {
    stdin,
    stdout,
    getOutput: () => stripAnsi(chunks.join('')),
    clearOutput: () => {
      chunks.length = 0;
    },
  };
}

function stripAnsi(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: preserve cursor-forward spaces emitted by Ink diff renderer
      .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Number(n)))
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape sequences
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip OSC sequences
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  );
}

describe('Auto-Update UI Alignment (2.1.328)', () => {
  const unmounts: Array<() => void> = [];
  const spies: Array<{ mockRestore: () => void }> = [];
  const savedEnv: Record<string, string | undefined> = {};
  let savedMacro: unknown;
  let hadMacro = false;

  beforeEach(() => {
    hadMacro = 'MACRO' in globalThis;
    savedMacro = (globalThis as { MACRO?: unknown }).MACRO;
    (globalThis as unknown as { MACRO: Record<string, string> }).MACRO = {
      VERSION: '2.1.328',
      PACKAGE_URL: '@anthropic-ai/claude-code',
      README_URL: 'https://code.claude.com/docs/en/overview',
      ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues',
      FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
      BUILD_TIME: '2026-11-18T21:07:35Z',
    };
    savedEnv.DISABLE_AUTOUPDATER = process.env.DISABLE_AUTOUPDATER;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE = process.env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE;
    autoUpdaterMod.resetAutoUpdateCheckThrottleForTests();
    autoUpdaterMod.setUpdateRestoreFailureForTests(null);
  });

  afterEach(() => {
    while (unmounts.length > 0) {
      unmounts.pop()?.();
    }
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    if (hadMacro) {
      (globalThis as { MACRO?: unknown }).MACRO = savedMacro;
    } else {
      delete (globalThis as { MACRO?: unknown }).MACRO;
    }
    autoUpdaterMod.resetAutoUpdateCheckThrottleForTests();
    autoUpdaterMod.setUpdateRestoreFailureForTests(null);
  });

  test('P0-1: useUpdateNotification stays non-null across multiple re-renders', async () => {
    const { stdin, stdout } = makeTtyPair();
    const observed: Array<string | null> = [];
    const bumpRenderRef: { current: (() => void) | null } = { current: null };

    function Harness({ updatedVersion, initialVersion }: { updatedVersion: string | null; initialVersion: string }) {
      const [tick, setTick] = React.useState(0);
      bumpRenderRef.current = () => setTick(t => t + 1);
      const result = useUpdateNotification(updatedVersion, initialVersion);
      observed.push(result);
      return <Text>{`${tick}:${result ?? 'none'}`}</Text>;
    }

    const instance = await render(<Harness updatedVersion="2.2.0" initialVersion="2.1.328" />, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 25));

    bumpRenderRef.current?.();
    await new Promise(r => setTimeout(r, 25));
    bumpRenderRef.current?.();
    await new Promise(r => setTimeout(r, 25));

    expect(observed.length).toBeGreaterThanOrEqual(3);
    expect(observed.every(v => v === '2.2.0')).toBe(true);

    // Same semver part returns null
    const observedSame: Array<string | null> = [];
    function SameHarness() {
      const result = useUpdateNotification('2.1.328+abc123', '2.1.328');
      observedSame.push(result);
      return <Text>{result ?? 'same'}</Text>;
    }
    const instance2 = await render(<SameHarness />, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    unmounts.push(() => instance2.unmount());
    await new Promise(r => setTimeout(r, 20));
    expect(observedSame).toEqual([null]);
  });

  test('P0-2: NativeAutoUpdater renders install_failed banner even when version is null', async () => {
    process.env.DISABLE_AUTOUPDATER = '1';
    const { stdin, stdout, getOutput } = makeTtyPair();

    const instance = await render(
      <NativeAutoUpdater
        isUpdating={false}
        onChangeIsUpdating={() => {}}
        onAutoUpdaterResult={() => {}}
        autoUpdaterResult={{ version: null, status: 'install_failed' }}
        showSuccessMessage={true}
        verbose={false}
      />,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 30));

    const output = getOutput();
    expect(output).toContain('Auto-update failed');
    expect(output).toContain('claude doctor');
  });

  test('P0-4: AutoUpdater does NOT call getLatestVersion when disabled', async () => {
    process.env.DISABLE_AUTOUPDATER = '1';
    const getLatestSpy = spyOn(autoUpdaterMod, 'getLatestVersion').mockResolvedValue('9.9.9');
    spies.push(getLatestSpy);
    const localExistsSpy = spyOn(localInstallerMod, 'localInstallationExists').mockResolvedValue(false);
    spies.push(localExistsSpy);

    const { stdin, stdout } = makeTtyPair();
    const instance = await render(
      <AutoUpdater
        isUpdating={false}
        onChangeIsUpdating={() => {}}
        onAutoUpdaterResult={() => {}}
        autoUpdaterResult={null}
        showSuccessMessage={true}
        verbose={false}
      />,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 40));

    expect(getLatestSpy).not.toHaveBeenCalled();
  });

  test('P0-4: AutoUpdater passes capped latestVersion to installer and persists update result', async () => {
    delete process.env.DISABLE_AUTOUPDATER;
    process.env.NODE_ENV = 'production';
    autoUpdaterMod.resetAutoUpdateCheckThrottleForTests();

    const disabledSpy = spyOn(configMod, 'isAutoUpdaterDisabled').mockReturnValue(false);
    const globalCfgSpy = spyOn(configMod, 'getGlobalConfig').mockReturnValue({
      autoUpdates: true,
    } as ReturnType<typeof configMod.getGlobalConfig>);
    const getLatestSpy = spyOn(autoUpdaterMod, 'getLatestVersion').mockResolvedValue('9.9.9');
    const getMaxSpy = spyOn(autoUpdaterMod, 'getMaxVersion').mockResolvedValue('9.5.0');
    const forceDowngradeSpy = spyOn(autoUpdaterMod, 'isForceDowngradeEnabled').mockReturnValue(false);
    const installGlobalSpy = spyOn(autoUpdaterMod, 'installGlobalPackage').mockResolvedValue({
      status: 'success',
    });
    const instTypeSpy = spyOn(doctorDiagMod, 'getCurrentInstallationType').mockResolvedValue('npm-global');
    const removeSymlinkSpy = spyOn(nativeInstallerMod, 'removeInstalledSymlink').mockResolvedValue(undefined);
    const localExistsSpy = spyOn(localInstallerMod, 'localInstallationExists').mockResolvedValue(false);
    const saveResultSpy = spyOn(updateResultMod, 'saveLastUpdateResult').mockImplementation(() => {});
    spies.push(
      disabledSpy,
      globalCfgSpy,
      getLatestSpy,
      getMaxSpy,
      forceDowngradeSpy,
      installGlobalSpy,
      instTypeSpy,
      removeSymlinkSpy,
      localExistsSpy,
      saveResultSpy,
    );

    const results: autoUpdaterMod.AutoUpdaterResult[] = [];
    const { stdin, stdout } = makeTtyPair();
    const instance = await render(
      <AutoUpdater
        isUpdating={false}
        onChangeIsUpdating={() => {}}
        onAutoUpdaterResult={r => results.push(r)}
        autoUpdaterResult={null}
        showSuccessMessage={true}
        verbose={false}
      />,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 80));

    expect(getLatestSpy).toHaveBeenCalledTimes(1);
    expect(installGlobalSpy).toHaveBeenCalledWith('9.5.0');
    expect(saveResultSpy).toHaveBeenCalledTimes(1);
    expect(saveResultSpy.mock.calls[0]?.[0]).toMatchObject({
      path: 'npm-global',
      outcome: 'success',
      status: 'success',
      version_to: '9.5.0',
      error_code: null,
    });
    expect(results.at(-1)).toMatchObject({
      version: '9.5.0',
      status: 'success',
    });
  });

  test('P2-4: AutoUpdater renders restore failure instructions and withSeparator', async () => {
    process.env.DISABLE_AUTOUPDATER = '1';
    const localExistsSpy = spyOn(localInstallerMod, 'localInstallationExists').mockResolvedValue(false);
    spies.push(localExistsSpy);
    autoUpdaterMod.setUpdateRestoreFailureForTests({
      originalPath: '/usr/local/bin/claude',
      preservedPath: '/usr/local/bin/claude.old',
    });

    const { stdin, stdout, getOutput } = makeTtyPair();
    const instance = await render(
      <AutoUpdater
        isUpdating={false}
        onChangeIsUpdating={() => {}}
        onAutoUpdaterResult={() => {}}
        autoUpdaterResult={{ version: '9.5.0', status: 'install_failed' }}
        showSuccessMessage={true}
        verbose={false}
        withSeparator={true}
      />,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 30));

    const output = getOutput();
    expect(output).toContain('·');
    expect(output).toContain("Couldn't update or restore claude — a copy is at:");
    expect(output).toContain('rename it back to claude');
  });

  test('P2-3: ChannelDowngradeDialog aligns 1:1 with official title, body, options, and declineValue="stay"', async () => {
    const dialogSrc = readFileSync(join(import.meta.dir, '../ChannelDowngradeDialog.tsx'), 'utf8');
    expect(dialogSrc).toContain('declineValue="stay"');

    const { stdin, stdout, getOutput } = makeTtyPair();
    const choices: ChannelDowngradeChoice[] = [];
    const instance = await render(
      <AppStateProvider>
        <KeybindingSetup>
          <ChannelDowngradeDialog currentVersion="2.1.328" onChoice={c => choices.push(c)} />
        </KeybindingSetup>
      </AppStateProvider>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 30));

    const output = getOutput();
    expect(output).toContain('Switch to stable channel');
    expect(output).toContain("The stable channel may be older than the version you're running (2.1.328).");
    expect(output).toContain('Which version do you want?');
    expect(output).toContain('Use the stable version, even if older');
    expect(output).toContain('Stay on 2.1.328 until stable catches up');
  });

  test('P1-1 + P1-5 + P2-2: Config.tsx displays rc as slow, uses saveAutoUpdatesChannelWithConfigSetHook in EnableAutoUpdates, and aligns disabled env copy', () => {
    const configSrc = readFileSync(join(import.meta.dir, '../Settings/Config.tsx'), 'utf8');
    expect(configSrc).toContain('formatAutoUpdatesChannelDisplay(settingsData?.autoUpdatesChannel)');
    expect(configSrc).toContain("Auto-updates are set by an environment variable and can't be changed here.");

    const enableStart = configSrc.indexOf("showSubmenu === 'EnableAutoUpdates'");
    const enableEnd = configSrc.indexOf("showSubmenu === 'ChannelDowngrade'", enableStart);
    expect(enableStart).toBeGreaterThan(0);
    expect(enableEnd).toBeGreaterThan(enableStart);
    const enableBlock = configSrc.slice(enableStart, enableEnd);
    expect(enableBlock).toContain('title="Enable auto-updates"');
    expect(enableBlock).toContain('saveAutoUpdatesChannelWithConfigSetHook(');
  });

  test('P0-5 + P1-3 + P2-6: PackageManagerAutoUpdater honors isAutoUpdaterDisabled unconditionally and renders official UI states', async () => {
    process.env.DISABLE_AUTOUPDATER = '1';
    process.env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE = '1';
    const pmSpy = spyOn(packageManagersMod, 'getPackageManager').mockResolvedValue('homebrew');
    const caskSpy = spyOn(packageManagersMod, 'getHomebrewCaskName').mockReturnValue('claude-code');
    const getLatestSpy = spyOn(autoUpdaterMod, 'getLatestVersion').mockResolvedValue('9.9.9');
    spies.push(pmSpy, caskSpy, getLatestSpy);

    const { stdin, stdout, getOutput } = makeTtyPair();
    const instance = await render(
      <PackageManagerAutoUpdater
        isUpdating={false}
        onChangeIsUpdating={() => {}}
        onAutoUpdaterResult={() => {}}
        autoUpdaterResult={{ version: '9.9.9', status: 'success' }}
        showSuccessMessage={true}
        verbose={false}
        withSeparator={true}
      />,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 40));

    // Even with CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1, DISABLE_AUTOUPDATER=1 prevents checking!
    expect(getLatestSpy).not.toHaveBeenCalled();
    const output = getOutput();
    // Ink's diff renderer paints initial frame then updates the changed "via homebrew" suffix
    expect(output).toContain('Update installed');
    expect(output).toContain('via homebrew · restart to apply');
  });

  test('P1-4 + P1-8: AutoUpdaterWrapper, Notifications, and usePluginAutoupdateNotification alignment', () => {
    const wrapperSrc = readFileSync(join(import.meta.dir, '../AutoUpdaterWrapper.tsx'), 'utf8');
    expect(wrapperSrc).not.toContain('SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED');
    expect(wrapperSrc).toContain("leftoverY('update_detection'");
    expect(wrapperSrc).toContain('withSeparator={withSeparator}');
    expect(wrapperSrc).toContain('atPrompt={atPrompt}');

    const notifsSrc = readFileSync(join(import.meta.dir, '../PromptInput/Notifications.tsx'), 'utf8');
    expect(notifsSrc).toContain('withSeparator={autoUpdaterWithSeparator}');
    expect(notifsSrc).toContain('atPrompt');

    const pluginNotifSrc = readFileSync(
      join(import.meta.dir, '../../hooks/notifs/usePluginAutoupdateNotification.tsx'),
      'utf8',
    );
    expect(pluginNotifSrc).toContain('assessPluginReloadCacheImpact');
    expect(pluginNotifSrc).toContain('refreshActivePlugins');
    expect(pluginNotifSrc).toContain('plugin-autoupdate-reloaded');
    expect(pluginNotifSrc).toContain('plugin-autoupdate-reload-errors');
    expect(pluginNotifSrc).toContain('plugin-autoupdate-restart');

    // Keep unused import clean by asserting GrowthBook helper exists
    expect(typeof growthbook.getFeatureValue_CACHED_MAY_BE_STALE).toBe('function');
  });
});
