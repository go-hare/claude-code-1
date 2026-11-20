import React, { useCallback, useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../commands.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw input for "any key" dismiss on error
import { Box, Dialog, LoadingState, Text, useInput } from '@anthropic/ink';
import { getDesktopInstallStatus, openCurrentSessionInDesktop } from '../utils/desktopDeepLink.js';
import { openBrowser } from '../utils/browser.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';

import { requestBgDetach } from '../daemon/rendezvousServer.js';
import {
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  isAnthropicAuthEnabled,
  isClaudeAISubscriber,
} from '../utils/auth.js';
import { isBgSession } from '../utils/concurrentSessions.js';
import { errorMessage } from '../utils/errors.js';
import { resolveEffectiveForceLoginMethod } from '../utils/forceLoginMethod.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { type APIProvider, getAPIProvider } from '../utils/model/providers.js';
import { flushSessionStorage } from '../utils/sessionStorage.js';
import { getEnabledSettingSources } from '../utils/settings/constants.js';
import { getSettingsFilePathForSource, getSettingsForSource } from '../utils/settings/settings.js';

const DESKTOP_DOCS_URL = 'https://clau.de/desktop';

const DESKTOP_SIGNIN_PREFIX = '--desktop requires a Claude account sign-in.';

const PROVIDER_ENV_VARS: Partial<Record<APIProvider, string>> = {
  bedrock: 'CLAUDE_CODE_USE_BEDROCK',
  vertex: 'CLAUDE_CODE_USE_VERTEX',
  foundry: 'CLAUDE_CODE_USE_FOUNDRY',
  anthropicAws: 'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  anthropicGoogleCloud: 'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  mantle: 'CLAUDE_CODE_USE_MANTLE',
  openai: 'CLAUDE_CODE_USE_OPENAI',
  gemini: 'CLAUDE_CODE_USE_GEMINI',
  grok: 'CLAUDE_CODE_USE_GROK',
};

const PROVIDER_DISPLAY_NAMES: Record<Exclude<APIProvider, 'firstParty'>, string> = {
  bedrock: 'Amazon Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
  anthropicAws: 'Claude Platform on AWS',
  anthropicGoogleCloud: 'Claude Platform on Google Cloud',
  mantle: 'Amazon Bedrock (Mantle)',
  gateway: 'Cloud gateway',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
};

export type DesktopSignInErrorContext = {
  prefix?: string;
  feature?: string;
  provider?: APIProvider;
  forceLoginMethod?: string;
  forceLoginMethodSource?: ReturnType<typeof getEnabledSettingSources>[number];
  apiKeySource?: string;
  apiKeyValue?: string | null;
  authTokenSource?: string;
  isAnthropicAuthEnabled?: boolean;
  env?: Record<string, string | undefined>;
};

function findForceLoginMethodSource(): ReturnType<typeof getEnabledSettingSources>[number] | undefined {
  const sources = getEnabledSettingSources();
  for (let i = sources.length - 1; i >= 0; i--) {
    const src = sources[i]!;
    const s = getSettingsForSource(src) as { forceLoginMethod?: unknown } | null | undefined;
    if (s?.forceLoginMethod !== undefined) {
      return src;
    }
  }
  return undefined;
}

/**
 * Official 2.1.325 `u0o` + `rot` + `--desktop` sign-in error (#2347):
 * names the specific API key, third-party provider env var, or `forceLoginMethod`
 * setting that prevents a Claude account sign-in from working.
 */
export function formatDesktopSignInError(
  prefixOrCtx: string | DesktopSignInErrorContext = DESKTOP_SIGNIN_PREFIX,
  featureArg = '--desktop',
): string {
  const ctx: DesktopSignInErrorContext =
    typeof prefixOrCtx === 'string' ? { prefix: prefixOrCtx, feature: featureArg } : prefixOrCtx;
  const prefix = ctx.prefix ?? DESKTOP_SIGNIN_PREFIX;
  const feature = ctx.feature ?? '--desktop';
  const env = ctx.env ?? process.env;
  const provider = ctx.provider ?? getAPIProvider();
  if (provider !== 'firstParty') {
    if (provider === 'gateway') {
      const forceMethod = ctx.forceLoginMethod ?? resolveEffectiveForceLoginMethod();
      const base = `${prefix} This session uses a ${PROVIDER_DISPLAY_NAMES.gateway}, which does not support ${feature}.`;
      return forceMethod === undefined || forceMethod === 'claudeai'
        ? `${base} Run \`claude auth login\` to sign in with a Claude account, which replaces your Cloud gateway sign-in.`
        : base;
    }
    const envVar = PROVIDER_ENV_VARS[provider];
    const display = PROVIDER_DISPLAY_NAMES[provider];
    return envVar
      ? `${prefix} ${envVar} is set, so this session is using ${display} — unset it (or run in a shell without it) to use ${feature}.`
      : `${prefix} This session is using ${display} — switch to a Claude account to use ${feature}.`;
  }

  const forceMethod = ctx.forceLoginMethod ?? resolveEffectiveForceLoginMethod();
  if (forceMethod === 'console') {
    const source = ctx.forceLoginMethodSource ?? findForceLoginMethodSource();
    if (source === 'policySettings') {
      return `${prefix} Managed settings set forceLoginMethod to console, so signing in gives an Anthropic Console account, not a Claude account. Ask your administrator to change it.`;
    }
    const path = source ? getSettingsFilePathForSource(source) : undefined;
    return `${prefix} forceLoginMethod is set to console in ${path ?? 'your settings'}, so signing in gives an Anthropic Console account, not a Claude account. Remove that setting, then run \`claude auth login\` to sign in with a Claude account.`;
  }

  const anthropicAuthEnabled =
    ctx.isAnthropicAuthEnabled ??
    (ctx.apiKeySource !== undefined || ctx.authTokenSource !== undefined ? false : isAnthropicAuthEnabled());
  if (!anthropicAuthEnabled) {
    const suffix = `to use ${feature}.`;
    try {
      if (env.ANTHROPIC_UNIX_SOCKET && !env.CLAUDE_CODE_OAUTH_TOKEN) {
        return `${prefix} ANTHROPIC_UNIX_SOCKET is set without CLAUDE_CODE_OAUTH_TOKEN, so requests on the socket carry no claude.ai login (on a claude ssh remote: the local machine is API-key-authed).`;
      }
      const keyInfo =
        ctx.apiKeySource !== undefined
          ? { key: ctx.apiKeyValue ?? env.ANTHROPIC_API_KEY ?? null, source: ctx.apiKeySource }
          : getAnthropicApiKeyWithSource({ skipRetrievingKeyFromApiKeyHelper: true });
      const { key, source } = keyInfo;
      if (source === 'ANTHROPIC_API_KEY') {
        if (key !== env.ANTHROPIC_API_KEY) {
          return `${prefix} The program that started this session passed it an API key, so this session uses API-key auth — start the session without that key ${suffix}`;
        }
        return `${prefix} ANTHROPIC_API_KEY is set, so this session is using API-key auth — unset it (or run in a shell without it) ${suffix}`;
      }
      if (source === 'apiKeyHelper') {
        return `${prefix} apiKeyHelper is configured, so this session is using API-key auth — unset it ${suffix}`;
      }
      if (env.ANTHROPIC_AUTH_TOKEN) {
        return `${prefix} ANTHROPIC_AUTH_TOKEN is set, so this session is using API-key auth — unset it (or run in a shell without it) ${suffix}`;
      }
      const tokenSource = ctx.authTokenSource !== undefined ? { source: ctx.authTokenSource } : getAuthTokenSource();
      if (tokenSource.source !== 'none') {
        return `${prefix} This session is using ${tokenSource.source} auth — unset it ${suffix}`;
      }
    } catch {
      // fall through to generic hint
    }
    return `${prefix} Unset ANTHROPIC_API_KEY / apiKeyHelper / ANTHROPIC_AUTH_TOKEN ${suffix}`;
  }

  return `${prefix} Run \`claude auth login\` to sign in.`;
}

export function getDownloadUrl(): string {
  switch (process.platform) {
    case 'win32':
      return 'https://claude.ai/api/desktop/win32/x64/exe/latest/redirect';
    default:
      return 'https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect';
  }
}

type DesktopHandoffState = 'checking' | 'prompt-download' | 'flushing' | 'opening' | 'success' | 'error';

type Props = {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

export function DesktopHandoff({ onDone }: Props): React.ReactNode {
  const [state, setState] = useState<DesktopHandoffState>('checking');
  const [error, setError] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string>('');

  const handleCancel = useCallback(() => {
    onDone(`Didn't open Claude Desktop. Learn more at ${DESKTOP_DOCS_URL}`, { display: 'system' });
  }, [onDone]);

  const handleDownloadChoice = useCallback(
    (choice: 'download' | 'cancel') => {
      if (choice === 'download') {
        openBrowser(getDownloadUrl()).catch(() => {});
        onDone(`Starting download. Re-run /desktop once you’ve installed the app.\nLearn more at ${DESKTOP_DOCS_URL}`, {
          display: 'system',
        });
      } else {
        handleCancel();
      }
    },
    [handleCancel, onDone],
  );

  useInput(
    (input, key) => {
      if (key.escape) {
        return;
      }
      if (key.meta && (input === 'c' || input === 'd')) {
        handleCancel();
        return;
      }
      if (key.ctrl || key.meta) {
        return;
      }
      if (state === 'error') {
        onDone(error ?? 'Unknown error', { display: 'system' });
      }
    },
    { isActive: state === 'error' },
  );

  useEffect(() => {
    async function performHandoff(): Promise<void> {
      setState('checking');
      if (!isClaudeAISubscriber()) {
        setError(formatDesktopSignInError());
        setState('error');
        return;
      }
      const installStatus = await getDesktopInstallStatus();

      if (installStatus.status === 'not-installed') {
        setDownloadMessage("Claude Desktop isn't installed.");
        setState('prompt-download');
        return;
      }

      if (installStatus.status === 'version-too-old') {
        setDownloadMessage(`Claude Desktop needs an update (found v${installStatus.version}, need v1.1.2396+).`);
        setState('prompt-download');
        return;
      }

      try {
        const { beginQuotaAutoResumeHandoff } = await import('../services/quotaAutoResume.js');
        beginQuotaAutoResumeHandoff('desktop_handoff');
      } catch {
        /* best-effort */
      }

      setState('flushing');
      await flushSessionStorage();

      setState('opening');
      const result = await openCurrentSessionInDesktop();

      if (!result.success) {
        try {
          const { endQuotaAutoResumeHandoff } = await import('../services/quotaAutoResume.js');
          endQuotaAutoResumeHandoff();
        } catch {
          /* best-effort */
        }
        setError(result.error ?? 'Failed to open Claude Desktop');
        setState('error');
        return;
      }

      setState('success');

      setTimeout(
        async (doneCallback: Props['onDone']) => {
          doneCallback('Session transferred to Claude Desktop', { display: 'system' });
          if (isBgSession()) requestBgDetach({ broadcast: true });
          await gracefulShutdown(0, 'other');
        },
        500,
        onDone,
      );
    }

    performHandoff().catch(err => {
      void import('../services/quotaAutoResume.js')
        .then(({ endQuotaAutoResumeHandoff }) => {
          endQuotaAutoResumeHandoff();
        })
        .catch(() => {});
      setError(errorMessage(err));
      setState('error');
    });
  }, [onDone]);

  if (state === 'error') {
    return (
      <Dialog title="Claude Desktop" onCancel={handleCancel} inputGuide="Press any key to continue…">
        <Box flexDirection="column">
          <Text color="error">Error: {error}</Text>
        </Box>
      </Dialog>
    );
  }

  if (state === 'prompt-download') {
    return (
      <Dialog
        title="Download Claude Desktop?"
        onCancel={handleCancel}
        inputGuide={
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
        }
      >
        <Box flexDirection="column" gap={1}>
          <Text>{downloadMessage}</Text>
          <Select<'download' | 'cancel'>
            options={[
              { label: 'Yes, download', value: 'download' },
              { label: 'Not now', value: 'cancel' },
            ]}
            defaultFocusValue="cancel"
            hideIndexes
            disablePrintableKeybindings
            onChange={handleDownloadChoice}
            onCancel={handleCancel}
          />
        </Box>
      </Dialog>
    );
  }

  const messages: Record<Exclude<DesktopHandoffState, 'error' | 'prompt-download'>, string> = {
    checking: 'Checking for Claude Desktop…',
    flushing: 'Saving session…',
    opening: 'Opening Claude Desktop…',
    success: 'Opening in Claude Desktop…',
  };

  return <LoadingState message={messages[state]} />;
}
