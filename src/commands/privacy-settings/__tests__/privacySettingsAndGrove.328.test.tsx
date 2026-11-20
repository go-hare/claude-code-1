import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import axios from 'axios';
import * as React from 'react';
import { wrappedRender as render } from '@anthropic/ink';
import { GroveDialog, submitGroveDialogDecision } from '../../../components/grove/Grove.js';
import { KeybindingSetup } from '../../../keybindings/KeybindingProviderSetup.js';
import * as groveApi from '../../../services/api/grove.js';
import { AppStateProvider } from '../../../state/AppState.js';
import * as authMod from '../../../utils/auth.js';
import * as configMod from '../../../utils/config.js';
import * as httpMod from '../../../utils/http.js';
import * as privacyLevelMod from '../../../utils/privacyLevel.js';
import * as secureStorageMod from '../../../utils/secureStorage/index.js';
import * as userAgentMod from '../../../utils/userAgent.js';
import {
  call as callPrivacySettings,
  capturePrivacyAccountSnapshot,
  createSerializedPrivacyToggleController,
  HardenedPrivacySettingsDialog,
  isPrivacyAccountChangedAtOpen,
  verifyPrivacyAccountUnchanged,
} from '../privacy-settings.js';

function makeTtyPair() {
  const chunks: string[] = [];
  const stdout = Object.assign(new PassThrough(), {
    columns: 120,
    rows: 30,
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
    getOutput: () =>
      chunks
        .join('')
        // biome-ignore lint/suspicious/noControlCharactersInRegex: preserve cursor-forward spaces emitted by Ink
        .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Number(n)))
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape sequences
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip OSC sequences
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ''),
  };
}

describe('Deep Parity 2.1.328: Privacy Settings & Grove', () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  function track<T extends { mockRestore: () => void }>(spy: T): T {
    spies.push(spy);
    return spy;
  }

  function stubHttpMeta() {
    track(spyOn(userAgentMod, 'getClaudeCodeUserAgent').mockReturnValue('claude-code/2.1.328'));
    track(spyOn(httpMod, 'getUserAgent').mockReturnValue('claude-code/2.1.328'));
  }

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
    groveApi.getGroveSettings.cache.clear?.();
    groveApi.getGroveNoticeConfig.cache.clear?.();
  });

  test('Bug 1 (P1): detects storage switch to Account B even when process still holds Account A', async () => {
    let storedOauth: { accessToken: string; accountUuid?: string } = {
      accessToken: 'tok-A',
      accountUuid: 'acct-A',
    };
    let diskUuid = 'acct-A';
    let invalidated = 0;

    track(
      spyOn(authMod, 'getClaudeAIOAuthTokens').mockReturnValue({
        accessToken: 'tok-A',
        refreshToken: 'ref-A',
        expiresAt: Date.now() + 60_000,
        scopes: ['user:profile'],
        accountUuid: 'acct-A',
      } as unknown as ReturnType<typeof authMod.getClaudeAIOAuthTokens>),
    );
    track(
      spyOn(authMod, 'getOauthAccountInfoFromDisk').mockImplementation(() => ({
        accountUuid: diskUuid,
        emailAddress: `${diskUuid}@example.com`,
      })),
    );
    track(
      spyOn(authMod, 'getOauthAccountInfo').mockImplementation(() => ({
        accountUuid: 'acct-A',
        emailAddress: 'acct-A@example.com',
      })),
    );
    track(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue({
        name: 'mock-storage',
        read: () => ({ claudeAiOauth: storedOauth }) as never,
        readAsync: async () => ({ claudeAiOauth: storedOauth }) as never,
        update: () => ({ success: true }),
        delete: () => true,
        invalidateCache: () => {
          invalidated += 1;
        },
      }),
    );

    const opened = await capturePrivacyAccountSnapshot();
    expect(opened?.accountUuid).toBe('acct-A');
    expect(opened?.accessToken).toBe('tok-A');
    expect(isPrivacyAccountChangedAtOpen(opened)).toBe(false);

    // Same account refreshes accessToken -> still 'same'
    storedOauth = { accessToken: 'tok-A-refreshed', accountUuid: 'acct-A' };
    expect(await verifyPrivacyAccountUnchanged(opened)).toBe('same');

    // Another terminal logs in as Account B while this process still holds Account A!
    storedOauth = { accessToken: 'tok-B', accountUuid: 'acct-B' };
    diskUuid = 'acct-B';
    const liveSnap = await capturePrivacyAccountSnapshot();
    expect(liveSnap?.accountUuid).toBe('acct-B');
    expect(liveSnap?.accessToken).toBe('tok-B');
    expect(liveSnap?.held?.accountUuid).toBe('acct-A');
    expect(liveSnap?.stored?.accountUuid).toBe('acct-B');
    expect(isPrivacyAccountChangedAtOpen(liveSnap)).toBe(true);
    expect(await verifyPrivacyAccountUnchanged(opened)).toBe('changed');
    expect(invalidated).toBeGreaterThanOrEqual(3);

    // Also works when keychain entry omits accountUuid and only disk oauthAccount updates
    storedOauth = { accessToken: 'tok-C' };
    diskUuid = 'acct-C';
    expect(await verifyPrivacyAccountUnchanged(opened)).toBe('changed');
  });

  test('Bug 2 (P1): initial terms save runs pre-save account check and uses onlyIfUnset on ON write', async () => {
    const patchCalls: Array<{ url: string; body: unknown }> = [];

    stubHttpMeta();
    track(spyOn(privacyLevelMod, 'isEssentialTrafficOnly').mockReturnValue(false));
    track(
      spyOn(httpMod, 'getAuthHeaders').mockReturnValue({
        headers: { Authorization: 'Bearer tok-A' },
      }),
    );
    track(
      spyOn(axios, 'patch').mockImplementation((async (url: string, body: unknown) => {
        patchCalls.push({ url, body });
        return {
          status: 200,
          data: { grove_enabled: false },
        };
      }) as unknown as typeof axios.patch),
    );

    // 1. Pre-save account check failure blocks PATCH completely
    let offPicked = false;
    const blocked = await submitGroveDialogDecision({
      value: 'accept_opt_in',
      confirmSave: async () => ({
        ok: false,
        error: "The signed-in account changed. Couldn't save your privacy setting.",
      }),
      isOffPicked: () => offPicked,
      markOffPicked: () => {
        offPicked = true;
      },
    });
    expect(blocked).toEqual({
      kind: 'blocked',
      error: "The signed-in account changed. Couldn't save your privacy setting.",
    });
    expect(patchCalls).toHaveLength(0);

    // 2. When confirmSave passes, accept_opt_in uses ?opt_in_only_if_unset=grove_enabled
    //    and returns already_off if server kept grove_enabled: false
    const alreadyOff = await submitGroveDialogDecision({
      value: 'accept_opt_in',
      confirmSave: async () => ({ ok: true }),
      isOffPicked: () => offPicked,
      markOffPicked: () => {
        offPicked = true;
      },
    });
    expect(alreadyOff).toEqual({ kind: 'already_off' });
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]?.url).toContain('/api/oauth/account/settings?opt_in_only_if_unset=grove_enabled');
    expect(patchCalls[0]?.body).toEqual({ grove_enabled: true });

    // 3. accept_opt_out calls plain /api/oauth/account/settings without onlyIfUnset and fires onOffPicked
    let onOffPickedCalled = 0;
    const optOut = await submitGroveDialogDecision({
      value: 'accept_opt_out',
      confirmSave: async () => ({ ok: true }),
      onOffPicked: () => {
        onOffPickedCalled += 1;
      },
      isOffPicked: () => offPicked,
      markOffPicked: () => {
        offPicked = true;
      },
    });
    expect(optOut).toEqual({ kind: 'done', decision: 'accept_opt_out' });
    expect(onOffPickedCalled).toBe(1);
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[1]?.url.endsWith('/api/oauth/account/settings')).toBe(true);
    expect(patchCalls[1]?.body).toEqual({ grove_enabled: false });
  });

  test('Bug 2 (P1) wiring: privacy-settings call() passes confirmSave & onOffPicked to GroveDialog', async () => {
    stubHttpMeta();
    track(spyOn(privacyLevelMod, 'isEssentialTrafficOnly').mockReturnValue(false));
    track(spyOn(authMod, 'isConsumerSubscriber').mockReturnValue(true));
    track(
      spyOn(authMod, 'getClaudeAIOAuthTokens').mockReturnValue({
        accessToken: 'tok-A',
        refreshToken: 'ref-A',
        expiresAt: Date.now() + 60_000,
        scopes: ['user:profile'],
        accountUuid: 'acct-A',
      } as unknown as ReturnType<typeof authMod.getClaudeAIOAuthTokens>),
    );
    track(
      spyOn(authMod, 'getOauthAccountInfo').mockReturnValue({
        accountUuid: 'acct-A',
        emailAddress: 'a@example.com',
      }),
    );
    track(
      spyOn(authMod, 'getOauthAccountInfoFromDisk').mockReturnValue({
        accountUuid: 'acct-A',
        emailAddress: 'a@example.com',
      }),
    );
    track(
      spyOn(configMod, 'getGlobalConfig').mockReturnValue({
        groveConfigCache: {
          'acct-A': { grove_enabled: true, timestamp: Date.now() },
        },
      } as unknown as ReturnType<typeof configMod.getGlobalConfig>),
    );
    track(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue({
        name: 'mock-storage',
        read: () => ({ claudeAiOauth: { accessToken: 'tok-A', accountUuid: 'acct-A' } }) as never,
        readAsync: async () => ({ claudeAiOauth: { accessToken: 'tok-A', accountUuid: 'acct-A' } }) as never,
        update: () => ({ success: true }),
        delete: () => true,
        invalidateCache: () => {},
      }),
    );
    track(
      spyOn(httpMod, 'getAuthHeaders').mockReturnValue({
        headers: { Authorization: 'Bearer tok-A' },
      }),
    );
    track(
      spyOn(axios, 'get').mockImplementation((async (url: string) => {
        if (url.includes('/api/oauth/account/settings')) {
          return { data: { grove_enabled: null, grove_notice_viewed_at: null } };
        }
        return {
          data: {
            grove_enabled: true,
            domain_excluded: false,
            notice_is_grace_period: false,
            notice_reminder_frequency: null,
            grove_locked_by_claude_science: false,
          },
        };
      }) as unknown as typeof axios.get),
    );

    const el = await callPrivacySettings(() => {});
    expect(React.isValidElement(el)).toBe(true);
    const element = el as React.ReactElement<{
      confirmSave?: () => Promise<{ ok: boolean; error?: string }>;
      onOffPicked?: () => void;
    }>;
    expect(element.type).toBe(GroveDialog);
    expect(typeof element.props.confirmSave).toBe('function');
    expect(typeof element.props.onOffPicked).toBe('function');
  });

  test('Bug 3 (P2): updateGroveSettings propagates PATCH errors, clears cache on failure, and triggers controller error branch', async () => {
    let getCount = 0;
    stubHttpMeta();
    track(spyOn(privacyLevelMod, 'isEssentialTrafficOnly').mockReturnValue(false));
    track(
      spyOn(httpMod, 'getAuthHeaders').mockReturnValue({
        headers: { Authorization: 'Bearer tok-A' },
      }),
    );
    track(
      spyOn(axios, 'get').mockImplementation((async () => {
        getCount += 1;
        return {
          data: {
            grove_enabled: getCount === 1 ? false : true,
            grove_notice_viewed_at: null,
          },
        };
      }) as unknown as typeof axios.get),
    );
    const patchSpy = spyOn(axios, 'patch').mockRejectedValue(new Error('503 Service Unavailable'));
    track(patchSpy);

    // Prime getGroveSettings memoized cache
    const first = await groveApi.getGroveSettings();
    expect(first).toEqual({
      success: true,
      data: { grove_enabled: false, grove_notice_viewed_at: null },
    });
    expect(getCount).toBe(1);

    // Cached second call does not hit network
    await groveApi.getGroveSettings();
    expect(getCount).toBe(1);

    // PATCH fails -> official `Wmn` resolves `undefined` (does NOT reject)
    // AND clears cache in finally so the next read re-fetches.
    const result = await groveApi.updateGroveSettings(true);
    expect(result).toBeUndefined();

    // Subsequent getGroveSettings must re-fetch because cache was cleared on failure
    const afterFailure = await groveApi.getGroveSettings();
    expect(getCount).toBe(2);
    expect(afterFailure).toEqual({
      success: true,
      data: { grove_enabled: true, grove_notice_viewed_at: null },
    });

    // PATCH that returns `false` on a `true` request resolves `false`
    // (server-side OFF — used by onlyIfUnset semantics).
    patchSpy.mockResolvedValue({ data: { grove_enabled: false } } as never);
    expect(await groveApi.updateGroveSettings(true)).toBe(false);
    patchSpy.mockRejectedValue(new Error('503 Service Unavailable'));

    // Serialized toggle controller using real updateGroveSettings enters error
    // branch & reverts — official `X` semantics: `pe = Ae ?? await h()`, where
    // `undefined` triggers a live re-read that mismatches the requested value.
    const states: Array<{ enabled: boolean; saving: boolean; error: string | null }> = [];
    const controller = createSerializedPrivacyToggleController({
      initialEnabled: false,
      confirmSave: async () => ({ ok: true }),
      saveSetting: async enabled => {
        const saved = await groveApi.updateGroveSettings(enabled);
        const refreshed = await groveApi.getGroveSettings();
        const effective = saved ?? (refreshed.success ? refreshed.data.grove_enabled : undefined) ?? undefined;
        if (effective !== enabled) {
          throw new Error("Couldn't save your choice. Please try again.");
        }
      },
      onStateChange: s => states.push(s),
      onChoose: () => {},
    });
    // Server now reads grove_enabled:true so a request for `true` succeeds.
    await controller.toggle();
    expect(controller.getDisplayed()).toBe(true);
    expect(states.at(-1)?.error).toBeNull();
  });

  test('Bug 4 (P2): loads grove_locked_by_claude_science, passes it to HardenedPrivacySettingsDialog, and disables toggling', async () => {
    stubHttpMeta();
    track(spyOn(privacyLevelMod, 'isEssentialTrafficOnly').mockReturnValue(false));
    track(spyOn(authMod, 'isConsumerSubscriber').mockReturnValue(true));
    track(
      spyOn(authMod, 'getClaudeAIOAuthTokens').mockReturnValue({
        accessToken: 'tok-A',
        refreshToken: 'ref-A',
        expiresAt: Date.now() + 60_000,
        scopes: ['user:profile'],
        accountUuid: 'acct-A',
      } as unknown as ReturnType<typeof authMod.getClaudeAIOAuthTokens>),
    );
    track(
      spyOn(authMod, 'getOauthAccountInfo').mockReturnValue({
        accountUuid: 'acct-A',
        emailAddress: 'a@example.com',
      }),
    );
    track(
      spyOn(authMod, 'getOauthAccountInfoFromDisk').mockReturnValue({
        accountUuid: 'acct-A',
        emailAddress: 'a@example.com',
      }),
    );
    track(
      spyOn(configMod, 'getGlobalConfig').mockReturnValue({
        groveConfigCache: {
          'acct-A': { grove_enabled: true, timestamp: Date.now() },
        },
      } as unknown as ReturnType<typeof configMod.getGlobalConfig>),
    );
    track(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue({
        name: 'mock-storage',
        read: () => ({ claudeAiOauth: { accessToken: 'tok-A', accountUuid: 'acct-A' } }) as never,
        readAsync: async () => ({ claudeAiOauth: { accessToken: 'tok-A', accountUuid: 'acct-A' } }) as never,
        update: () => ({ success: true }),
        delete: () => true,
        invalidateCache: () => {},
      }),
    );
    track(
      spyOn(httpMod, 'getAuthHeaders').mockReturnValue({
        headers: { Authorization: 'Bearer tok-A' },
      }),
    );
    track(
      spyOn(axios, 'get').mockImplementation((async (url: string) => {
        if (url.includes('/api/oauth/account/settings')) {
          return { data: { grove_enabled: false, grove_notice_viewed_at: '2026-01-01T00:00:00Z' } };
        }
        return {
          data: {
            grove_enabled: true,
            domain_excluded: false,
            notice_is_grace_period: false,
            notice_reminder_frequency: null,
            grove_locked_by_claude_science: true,
          },
        };
      }) as unknown as typeof axios.get),
    );
    const patchSpy = track(spyOn(axios, 'patch').mockResolvedValue({ data: { grove_enabled: true } }));

    // 1. getGroveNoticeConfig loads grove_locked_by_claude_science: true
    const cfg = await groveApi.getGroveNoticeConfig();
    expect(cfg.success).toBe(true);
    if (cfg.success) {
      expect(cfg.data.grove_locked_by_claude_science).toBe(true);
    }

    // 2. call() passes lockedByClaudeScience={true} and onDone uses display: 'skip'
    const doneCalls: Array<{ msg?: string; opts?: unknown }> = [];
    const el = await callPrivacySettings((msg, opts) => {
      doneCalls.push({ msg, opts });
    });
    expect(React.isValidElement(el)).toBe(true);
    const dialogEl = el as React.ReactElement<{
      lockedByClaudeScience?: boolean;
      onDone: () => void;
    }>;
    expect(dialogEl.type).toBe(HardenedPrivacySettingsDialog);
    expect(dialogEl.props.lockedByClaudeScience).toBe(true);

    // 3. Rendered UI displays locked message, omits toggle hint, and ignores Enter/Space/Tab
    const tty = makeTtyPair();
    const instance = await render(
      <AppStateProvider>
        <KeybindingSetup>{dialogEl}</KeybindingSetup>
      </AppStateProvider>,
      {
        stdin: tty.stdin as unknown as NodeJS.ReadStream,
        stdout: tty.stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    try {
      await new Promise(r => setTimeout(r, 80));
      const out = tty.getOutput();
      expect(out).toContain('Not available for this account.');
      expect(out).toContain('false');
      expect(out).not.toContain('Enter/Tab/Space');

      // Pressing Enter, Space, and Tab must NOT trigger a PATCH
      tty.stdin.write('\r');
      tty.stdin.write(' ');
      tty.stdin.write('\t');
      await new Promise(r => setTimeout(r, 80));
      expect(patchSpy).not.toHaveBeenCalled();

      // Closing locked dialog invokes onDone(undefined, { display: 'skip' })
      dialogEl.props.onDone();
      expect(doneCalls).toEqual([{ msg: undefined, opts: { display: 'skip' } }]);
    } finally {
      instance.unmount();
    }
  });
});
