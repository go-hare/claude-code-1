/**
 * densable 2.1.222 #4 / Coh — startup connectivity preflight.
 * Uses the same proxy-aware fetch transport as API requests (Wh ≈ getProxyFetchOptions)
 * with a 10s timeout and clear timed-out / SSL / proxy messages.
 */
import React, { useEffect, useState } from 'react';
import { useTimeout } from '../hooks/useTimeout.js';
import { Box, Text } from '@anthropic/ink';
import { Spinner } from '../components/Spinner.js';
import { getOauthConfig } from '../constants/oauth.js';
import { getSSLErrorHint } from '../services/api/errorUtils.js';
import { getClaudeCodeUserAgent } from './userAgent.js';
import { configureGlobalAgents, getProxyFetchOptions, getProxyUrl, shouldBypassProxy } from './proxy.js';
import { getTLSFetchOptions } from './mtls.js';
import { logError } from './log.js';

/** densable Toh = 1e4 */
export const PREFLIGHT_CONNECTIVITY_TIMEOUT_MS = 10_000;

export interface PreflightCheckResult {
  success: boolean;
  error?: string;
  sslHint?: string;
  /** densable usedProxy — true when the probe went through an HTTP(S) proxy. */
  usedProxy?: boolean;
}

/**
 * densable probe URLs: BASE_API_URL/api/hello + TOKEN_URL origin /v1/oauth/hello
 */
export function buildPreflightProbeUrls(
  oauth: { BASE_API_URL: string; TOKEN_URL: string } = getOauthConfig(),
): string[] {
  const tokenOrigin = new URL(oauth.TOKEN_URL).origin;
  return [`${oauth.BASE_API_URL}/api/hello`, `${tokenOrigin}/v1/oauth/hello`];
}

/**
 * densable Wh({url}) for preflight — same proxy transport as API, with NO_PROXY.
 */
export function getPreflightFetchOptions(url: string): {
  proxy?: string | { url: string; headers?: Record<string, string> };
  dispatcher?: unknown;
  tls?: unknown;
  unix?: string;
  keepalive?: false;
  timeout?: false;
  usedProxy: boolean;
} {
  const proxyConfigured = Boolean(getProxyUrl());
  if (proxyConfigured && shouldBypassProxy(url)) {
    return { ...getTLSFetchOptions(), usedProxy: false };
  }
  const opts = getProxyFetchOptions();
  const usedProxy =
    proxyConfigured && !shouldBypassProxy(url) && (opts.proxy !== undefined || opts.dispatcher !== undefined);
  return { ...opts, usedProxy };
}

export function formatPreflightTimeoutError(
  hostname: string,
  timeoutMs: number = PREFLIGHT_CONNECTIVITY_TIMEOUT_MS,
): string {
  return `Connection to ${hostname} timed out after ${timeoutMs / 1000} seconds`;
}

export function formatPreflightStatusError(hostname: string, status: number): string {
  return `Failed to connect to ${hostname}: Status ${status}`;
}

export function formatPreflightConnectError(hostname: string, err: unknown): string {
  if (err instanceof Error) {
    return `Failed to connect to ${hostname}: ${err.code ?? err.message}`;
  }
  return `Failed to connect to ${hostname}: ${String(err)}`;
}

async function probeEndpoint(url: string): Promise<PreflightCheckResult> {
  const hostname = new URL(url).hostname;
  const { usedProxy, ...fetchOpts } = getPreflightFetchOptions(url);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': getClaudeCodeUserAgent() },
      signal: AbortSignal.timeout(PREFLIGHT_CONNECTIVITY_TIMEOUT_MS),
      ...(fetchOpts as RequestInit),
    });
    // densable: cancel body to free the connection
    void response.body?.cancel().catch(() => {});
    if (response.status !== 200) {
      return {
        success: false,
        error: formatPreflightStatusError(hostname, response.status),
        usedProxy,
      };
    }
    return { success: true, usedProxy };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return {
        success: false,
        error: formatPreflightTimeoutError(hostname),
        usedProxy,
      };
    }
    const sslHint = getSSLErrorHint(err) ?? undefined;
    return {
      success: false,
      error: formatPreflightConnectError(hostname, err),
      sslHint,
      usedProxy,
    };
  }
}

/**
 * densable Coh — parallel hello probes; first failure wins.
 * Ensures proxy agents are configured (sir) before probing.
 */
export async function checkEndpoints(): Promise<PreflightCheckResult> {
  try {
    // densable await sir() — proxy/mTLS global agents + auth helper warm path
    configureGlobalAgents();
    try {
      const { configureProxyAuthHelperFromSettings, prefetchProxyAuthHelper } = await import('./proxyAuthHelper.js');
      configureProxyAuthHelperFromSettings();
      prefetchProxyAuthHelper();
    } catch {
      // ignore — init may already have warmed the helper
    }

    const urls = buildPreflightProbeUrls();
    const results = await Promise.all(urls.map(probeEndpoint));
    const firstFailure = results.find(r => !r.success);
    if (firstFailure) {
      return firstFailure;
    }
    return { success: true };
  } catch (e) {
    logError(e as Error);
    return {
      success: false,
      error: `Connectivity check error: ${e instanceof Error ? e.code || e.message : String(e)}`,
    };
  }
}

interface PreflightStepProps {
  onSuccess: () => void;
}

export function PreflightStep({ onSuccess }: PreflightStepProps): React.ReactNode {
  const [result, setResult] = useState<PreflightCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // delay showing the check since it's so fast that we normally
  // want to just immediately show the next step without a flash
  const showSpinner = useTimeout(1000) && isChecking;

  useEffect(() => {
    async function run() {
      const checkResult = await checkEndpoints();
      setResult(checkResult);
      setIsChecking(false);
    }
    void run();
  }, []);

  useEffect(() => {
    if (result?.success) {
      onSuccess();
    }
  }, [result, onSuccess]);

  // densable Biv: hard-exit after brief delay on failure so onboarding can't proceed offline
  useEffect(() => {
    if (result && !result.success) {
      const t = setTimeout(() => {
        // densable ix("preflight_endpoint"); process.exit(1)
        // Soft: leave UI error visible; exit only if env requests strict gate.
        if (process.env.CLAUDE_CODE_STRICT_PREFLIGHT === '1') {
          process.exit(1);
        }
      }, 100);
      return () => clearTimeout(t);
    }
  }, [result]);

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      {isChecking && showSpinner ? (
        <Box paddingLeft={1}>
          <Spinner />
          <Text>Checking connectivity...</Text>
        </Box>
      ) : (
        !result?.success &&
        !isChecking && (
          <Box flexDirection="column" gap={1}>
            <Text color="error">Unable to connect to Anthropic services</Text>
            <Text color="error">{result?.error}</Text>
            {result?.sslHint ? (
              <Box flexDirection="column" gap={1}>
                <Text>{result.sslHint}</Text>
                <Text color="suggestion">See https://code.claude.com/docs/en/network-config</Text>
              </Box>
            ) : (
              <Box flexDirection="column" gap={1}>
                {result?.usedProxy ? (
                  <Text>
                    A proxy is configured. Check that it allows connections to the host above.{' '}
                    <Text color="suggestion">See https://code.claude.com/docs/en/network-config</Text>
                  </Text>
                ) : null}
                <Text>Please check your internet connection and network settings.</Text>
                <Text>
                  Note: Claude Code might not be available in your country. Check supported countries at{' '}
                  <Text color="suggestion">https://anthropic.com/supported-countries</Text>
                </Text>
              </Box>
            )}
          </Box>
        )
      )}
    </Box>
  );
}
