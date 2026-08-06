/**
 * densable 2.1.212 #43 — g2s Cloud gateway interactive OIDC device-flow UI.
 *
 * densable: function g2s({onDone,onCancel,initialUrl,screenLocked})
 * States: url_input → connecting → trust_prompt? → connecting → polling → done
 * Helpers: $zd/mOc/o2r/i2r/gOc/Smc/wki/dl_/fl_/Tki (see gatewayLogin.ts + gatewayEnv.ts)
 */
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { z } from 'zod';
import { Box, Text } from '@anthropic/ink';
import figures from 'figures';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { openBrowser } from '../utils/browser.js';
import { logForDebugging } from '../utils/debug.js';
import {
  GATEWAY_DEVICE_CODE_GRANT,
  assertGatewayLoginNetworkPolicy,
  errorMessage,
  extractOAuthDeviceError,
  formatGatewayTlsCertHint,
  gatewayDeviceAuthorizationResponseSchema,
  gatewayOAuthMetadataSchema,
  gatewayTokenResponseSchema,
  normalizeGatewayLoginUrl,
  probeGatewayLoginTls,
  resolveSameOriginOAuthEndpoint,
  type GatewayOAuthEndpoints,
} from '../utils/gatewayLogin.js';
import {
  type GatewayAuthSession,
  normalizeGatewayTlsFingerprint,
  persistEnterpriseGatewayCredential,
  persistGatewayTlsPin,
  setGatewayAuth,
} from '../utils/gatewayEnv.js';
import { getSecureStorage } from '../utils/secureStorage/index.js';
import { sleep } from '../utils/sleep.js';

export type GatewayConnectProps = {
  onDone: () => void;
  onCancel: () => void;
  /** densable forceLoginGatewayUrl prefill */
  initialUrl?: string;
  /**
   * densable screenLocked — when forceLoginMethod === 'gateway', cancel
   * returns to url_input (cannot leave gateway path to idle).
   */
  screenLocked?: boolean;
};

type GatewayConnectState =
  | { state: 'url_input' }
  | { state: 'connecting' }
  | {
      state: 'trust_prompt';
      url: string;
      hostname: string;
      fingerprint: string;
      previouslyPinned: string | undefined;
      endpoints: GatewayOAuthEndpoints;
    }
  | {
      state: 'polling';
      url: string;
      userCode: string;
      verificationUri: string;
    }
  | { state: 'error'; message: string; detail?: string };

async function readPinnedFingerprint(hostname: string): Promise<string | undefined> {
  try {
    const data = (await getSecureStorage().readAsync?.()) ?? getSecureStorage().read();
    const trust = (data as { gatewayTrust?: Record<string, string> } | null)?.gatewayTrust;
    const pin = trust?.[hostname];
    return typeof pin === 'string' && pin.length > 0 ? normalizeGatewayTlsFingerprint(pin) : undefined;
  } catch {
    return undefined;
  }
}

async function persistTlsPin(hostname: string, fingerprint: string): Promise<void> {
  const result = await persistGatewayTlsPin({ host: hostname, fingerprint });
  if (!result.success) {
    throw new Error(result.message);
  }
}

/**
 * densable Smc — apply session to memory + secureStorage enterpriseGateway.
 * densable storage shape uses expiresAt; local uses expiresAtMs.
 */
async function persistGatewayCredential(session: {
  url: string;
  jwt: string;
  expiresAt: number;
  tokenEndpoint: string;
  idpRefreshToken?: string;
}): Promise<void> {
  const live: GatewayAuthSession = {
    url: session.url,
    jwt: session.jwt,
    expiresAtMs: session.expiresAt,
    tokenEndpoint: session.tokenEndpoint,
    unpinned: false,
    ...(session.idpRefreshToken ? { idpRefreshToken: session.idpRefreshToken } : {}),
  };
  setGatewayAuth(live);
  const result = await persistEnterpriseGatewayCredential({ session: live });
  if (!result.success) {
    throw new Error(`Failed to persist gateway credential${result.message ? `: ${result.message}` : ''}`);
  }
}

export function GatewayConnect({
  onDone,
  onCancel,
  initialUrl,
  screenLocked = false,
}: GatewayConnectProps): React.ReactNode {
  const [status, setStatus] = useState<GatewayConnectState>({
    state: 'url_input',
  });
  const prefill = initialUrl ?? undefined;
  const gen = useRef(0);

  useEffect(() => {
    return () => {
      gen.current += 1;
    };
  }, []);

  const cancelTo = screenLocked ? () => setStatus({ state: 'url_input' }) : onCancel;

  function bumpCancel(): void {
    gen.current += 1;
    cancelTo();
  }

  async function startFromUrl(raw: string): Promise<void> {
    const y = ++gen.current;
    setStatus({ state: 'connecting' });
    try {
      const base = normalizeGatewayLoginUrl(raw);
      await assertGatewayLoginNetworkPolicy(base);
      if (y !== gen.current) return;

      const metaRes = await axios.get(`${base}/.well-known/oauth-authorization-server`, { timeout: 10_000 });
      if (y !== gen.current) return;
      const parsed = gatewayOAuthMetadataSchema.safeParse(metaRes.data);
      const meta = parsed.success ? parsed.data : undefined;
      const endpoints: GatewayOAuthEndpoints = {
        deviceAuthorizationEndpoint: resolveSameOriginOAuthEndpoint(
          base,
          meta?.device_authorization_endpoint,
          '/oauth/device_authorization',
        ),
        tokenEndpoint: resolveSameOriginOAuthEndpoint(base, meta?.token_endpoint, '/oauth/token'),
      };
      const { hostname, fingerprint } = await probeGatewayLoginTls(base);
      if (y !== gen.current) return;
      const previouslyPinned = await readPinnedFingerprint(hostname);
      if (y !== gen.current) return;
      if (previouslyPinned === fingerprint) {
        await beginDeviceAuth(base, endpoints);
      } else {
        setStatus({
          state: 'trust_prompt',
          url: base,
          hostname,
          fingerprint,
          previouslyPinned,
          endpoints,
        });
      }
    } catch (err) {
      if (y !== gen.current) return;
      const hint = formatGatewayTlsCertHint(err);
      setStatus(
        hint
          ? { state: 'error', message: hint, detail: errorMessage(err) }
          : { state: 'error', message: errorMessage(err) },
      );
    }
  }

  async function beginDeviceAuth(base: string, endpoints: GatewayOAuthEndpoints): Promise<void> {
    const y = ++gen.current;
    setStatus({ state: 'connecting' });
    try {
      const { data } = await axios.post(endpoints.deviceAuthorizationEndpoint, '', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
      });
      if (y !== gen.current) return;
      const parsed = gatewayDeviceAuthorizationResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error('gateway device authorization endpoint returned malformed response');
      }
      const body = parsed.data;
      void openBrowser(body.verification_uri_complete ?? body.verification_uri);
      setStatus({
        state: 'polling',
        url: base,
        userCode: body.user_code,
        verificationUri: body.verification_uri,
      });
      await pollToken(base, endpoints.tokenEndpoint, body.device_code, body.interval ?? 5, y);
    } catch (err) {
      if (y !== gen.current) return;
      setStatus({ state: 'error', message: errorMessage(err) });
    }
  }

  async function pollToken(
    base: string,
    tokenEndpoint: string,
    deviceCode: string,
    intervalSec: number,
    generation: number,
  ): Promise<void> {
    let interval = Math.max(1, intervalSec);
    while (generation === gen.current) {
      await sleep(interval * 1000);
      if (generation !== gen.current) return;
      try {
        const { data } = await axios.post(
          tokenEndpoint,
          new URLSearchParams({
            grant_type: GATEWAY_DEVICE_CODE_GRANT,
            device_code: deviceCode,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10_000,
          },
        );
        if (generation !== gen.current) return;
        const parsed = gatewayTokenResponseSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error('gateway token endpoint returned malformed response');
        }
        await finishLogin(base, tokenEndpoint, parsed.data, generation);
        return;
      } catch (err) {
        if (generation !== gen.current) return;
        const code = extractOAuthDeviceError(err);
        if (code === 'authorization_pending') continue;
        if (code === 'slow_down') {
          interval += 5;
          continue;
        }
        if (code === 'expired_token') {
          setStatus({
            state: 'error',
            message: 'Sign-in timed out before the browser flow completed. Try again.',
          });
          return;
        }
        if (code === 'access_denied') {
          setStatus({
            state: 'error',
            message: 'Sign-in was denied in the browser.',
          });
          return;
        }
        setStatus({ state: 'error', message: errorMessage(err) });
        return;
      }
    }
  }

  async function finishLogin(
    base: string,
    tokenEndpoint: string,
    token: z.infer<typeof gatewayTokenResponseSchema>,
    generation: number,
  ): Promise<void> {
    const session = {
      url: base,
      jwt: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      tokenEndpoint,
      ...(token.refresh_token ? { idpRefreshToken: token.refresh_token } : {}),
    };
    const { hostname, fingerprint } = await probeGatewayLoginTls(base);
    if (generation !== gen.current) return;
    const previouslyPinned = await readPinnedFingerprint(hostname);
    if (generation !== gen.current) return;
    if (previouslyPinned !== fingerprint) {
      setStatus({
        state: 'error',
        message: `TLS certificate for ${hostname} changed during sign-in. Aborting without storing credentials.`,
      });
      return;
    }
    try {
      await persistGatewayCredential(session);
    } catch (err) {
      if (generation !== gen.current) return;
      const msg = errorMessage(err);
      logForDebugging(`[gateway-login] secureStorage write failed: ${msg}`);
      setStatus({ state: 'error', message: msg });
      return;
    }
    if (generation !== gen.current) return;
    onDone();
  }

  const urlInputActive = status.state === 'url_input';
  useKeybinding(
    'confirm:yes',
    () => {
      if (prefill) void startFromUrl(prefill);
    },
    { context: 'Confirmation', isActive: urlInputActive },
  );
  useKeybinding('confirm:no', screenLocked ? () => {} : onCancel, {
    context: 'Confirmation',
    isActive: urlInputActive,
  });
  useKeybinding('confirm:no', bumpCancel, {
    context: 'Confirmation',
    isActive: status.state === 'polling' || status.state === 'connecting' || status.state === 'error',
  });

  switch (status.state) {
    case 'url_input':
      if (!prefill) {
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Cloud gateway</Text>
            <Text color="warning">
              Gateway login is required by your organization&apos;s policy, but no gateway URL is configured. Contact
              your IT administrator.
            </Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Cloud gateway</Text>
          <Text>Your organization&apos;s gateway URL (set by managed settings):</Text>
          <Box borderDimColor borderStyle="round" paddingLeft={1}>
            <Text>{prefill}</Text>
          </Box>
          <Text dimColor>
            Press Enter to connect
            {screenLocked ? '' : ' · Esc to cancel'}
          </Text>
        </Box>
      );

    case 'polling':
      return (
        <GatewayPollingView userCode={status.userCode} verificationUri={status.verificationUri} onCancel={bumpCancel} />
      );

    case 'connecting':
      return <GatewayConnectingView label="Connecting to gateway…" onCancel={bumpCancel} />;

    case 'trust_prompt':
      return (
        <GatewayTrustPrompt
          hostname={status.hostname}
          fingerprint={status.fingerprint}
          previouslyPinned={status.previouslyPinned}
          screenLocked={screenLocked}
          onConfirm={() => {
            const g = gen.current;
            void persistTlsPin(status.hostname, status.fingerprint)
              .then(() => {
                if (g !== gen.current) return;
                return beginDeviceAuth(status.url, status.endpoints);
              })
              .catch(err => {
                if (g !== gen.current) return;
                setStatus({ state: 'error', message: errorMessage(err) });
              });
          }}
          onCancel={bumpCancel}
        />
      );

    case 'error':
      return <GatewayErrorView message={status.message} detail={status.detail} onCancel={cancelTo} />;
  }
}

function GatewayPollingView({
  userCode,
  verificationUri,
  onCancel,
}: {
  userCode: string;
  verificationUri: string;
  onCancel: () => void;
}): React.ReactNode {
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: true,
  });
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Cloud gateway · sign in</Text>
      <Text>
        A browser window should have opened. After signing in with your identity provider, confirm this code on the
        verification page:
      </Text>
      <Box borderDimColor borderStyle="round" paddingX={2}>
        <Text bold color="suggestion">
          {userCode}
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text dimColor>Browser didn&apos;t open? Visit:</Text>
        <Text dimColor wrap="wrap">
          {verificationUri}
        </Text>
      </Box>
      <Box gap={1}>
        <Text color="suggestion">{figures.ellipsis}</Text>
        <Text dimColor>Waiting for sign-in to complete in your browser…</Text>
      </Box>
      <Text dimColor>Press Esc to cancel</Text>
    </Box>
  );
}

function GatewayConnectingView({ label, onCancel }: { label: string; onCancel: () => void }): React.ReactNode {
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: true,
  });
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color="suggestion">{figures.ellipsis}</Text>
        <Text>{label}</Text>
      </Box>
      <Text dimColor>Press Esc to cancel</Text>
    </Box>
  );
}

function GatewayTrustPrompt({
  hostname,
  fingerprint,
  previouslyPinned,
  screenLocked,
  onConfirm,
  onCancel,
}: {
  hostname: string;
  fingerprint: string;
  previouslyPinned: string | undefined;
  screenLocked: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactNode {
  useKeybinding('confirm:yes', onConfirm, {
    context: 'Confirmation',
    isActive: true,
  });
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: true,
  });
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>
        Trust gateway <Text color="suggestion">{hostname}</Text>?
      </Text>
      {previouslyPinned ? (
        <Text color="warning">
          The TLS certificate for this gateway has changed since you last connected. Only continue if your administrator
          has confirmed a certificate rotation.
        </Text>
      ) : (
        <Text>
          You haven&apos;t connected to this gateway before. Once trusted, it can push settings to this machine that
          execute commands and change your environment. Only continue if this is your organization&apos;s gateway.
        </Text>
      )}
      <Text dimColor>Certificate fingerprint (SHA-256): {fingerprint.slice(0, 16)}…</Text>
      <Text dimColor>Press Enter to trust · Esc to {screenLocked ? 'go back' : 'cancel login'}</Text>
    </Box>
  );
}

function GatewayErrorView({
  message,
  detail,
  onCancel,
}: {
  message: string;
  detail?: string;
  onCancel: () => void;
}): React.ReactNode {
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: true,
  });
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="error">Error: {message}</Text>
      {detail ? <Text dimColor>{detail}</Text> : null}
      <Text dimColor>Press Esc to go back</Text>
    </Box>
  );
}
