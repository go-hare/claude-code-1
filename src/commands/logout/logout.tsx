import * as React from 'react';
import { clearTrustedDeviceTokenCache } from '../../bridge/trustedDevice.js';
import { formatRevokeUnconfirmedMessage, revokeOAuthRefreshTokenWithRetry } from '../../cli/handlers/designOauth.js';
import { instances, Text } from '@anthropic/ink';
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js';
import { getGroveNoticeConfig, getGroveSettings } from '../../services/api/grove.js';
// flushTelemetry is loaded lazily to avoid pulling in ~1.1MB of OpenTelemetry at startup
import { removeChatGPTAuth } from '../../services/api/openai/chatgptAuth.js';
import { getClaudeAIOAuthTokens, removeApiKey } from '../../utils/auth.js';
import { clearBetasCaches } from '../../utils/betas.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { getAPIProvider } from '../../utils/model/providers.js';
import { getSecureStorage } from '../../utils/secureStorage/index.js';
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { logOTelAuthEvent } from '../../utils/sessionSlots.js';
import { clearToolSchemaCache } from '../../utils/toolSchemaCache.js';
import { resetUserCache } from '../../utils/user.js';

export type PerformLogoutOutcome = 'revoke_unconfirmed' | undefined;

const LOGOUT_SUCCESS_MESSAGE = 'Successfully logged out from your Anthropic account.';

export async function performLogout({ clearOnboarding = false }): Promise<PerformLogoutOutcome> {
  // Flush telemetry BEFORE clearing credentials to prevent org data leakage
  const { flushTelemetry } = await import('../../utils/telemetry/instrumentation.js');
  await flushTelemetry();

  // Official 2.1.326 #238 (`$Ye`): revoke OAuth refresh tokens on firstParty before
  // wiping local secure storage, retrying once on transient failures.
  const secureStorage = getSecureStorage();
  let revokeUnconfirmed = false;
  if (getAPIProvider() === 'firstParty') {
    secureStorage.invalidateCache?.();
    const stored = await secureStorage.readAsync();
    const mainOauth = stored?.claudeAiOauth as { refreshToken?: string; clientId?: string } | undefined;
    if (mainOauth?.refreshToken) {
      const outcome = await revokeOAuthRefreshTokenWithRetry(mainOauth.refreshToken, mainOauth.clientId);
      if (outcome !== 'acknowledged') {
        revokeUnconfirmed = true;
      }
    }
    const designOauth = stored?.designOauth as { refreshToken?: string; clientId?: string } | undefined;
    if (designOauth?.refreshToken) {
      await revokeOAuthRefreshTokenWithRetry(designOauth.refreshToken, designOauth.clientId);
    }
    const cloudSessionsOauth = stored?.cloudSessionsOauth as { refreshToken?: string; clientId?: string } | undefined;
    if (cloudSessionsOauth?.refreshToken) {
      await revokeOAuthRefreshTokenWithRetry(cloudSessionsOauth.refreshToken, cloudSessionsOauth.clientId);
    }
  }

  // Official 2.1.323 Tze (#2206): clear in-process OAuth token env var and
  // wipe secure storage (including stored MCP OAuth logins and plugin secrets)
  // so every session on the machine is signed out cleanly.
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  await removeApiKey();
  await removeChatGPTAuth();
  clearChatGPTSettingsAuthMode();

  // Clear in-memory MCP auth caches so stale tokens cannot survive logout.
  try {
    const { clearMcpAuthCache } = await import('../../services/mcp/connectionHelpers.js');
    clearMcpAuthCache();
  } catch {
    // mcp connectionHelpers optional in isolation
  }

  // Wipe all secure storage data on logout (OAuth, MCP logins, plugin secrets)
  secureStorage.delete();

  // Drop in-memory gateway session + secure-storage restore negative cache.
  // Disk wipe alone is not enough — getAPIProvider() ranks gatewayAuth first.
  try {
    const { clearGatewayAuth } = await import('../../utils/gatewayEnv.js');
    clearGatewayAuth();
  } catch {
    // gatewayEnv optional in isolation
  }

  await clearAuthRelatedCaches();
  saveGlobalConfig(current => {
    const updated = { ...current };
    if (clearOnboarding) {
      updated.hasCompletedOnboarding = false;
      updated.subscriptionNoticeCount = 0;
      updated.hasAvailableSubscription = false;
      if (updated.customApiKeyResponses?.approved) {
        updated.customApiKeyResponses = {
          ...updated.customApiKeyResponses,
          approved: [],
        };
      }
    }
    updated.oauthAccount = undefined;
    // Official: clear org-default bootstrap cache on logout.
    updated.orgModelDefaultCache = undefined;
    updated.lastSeenOrgDefaultUpdatedAt = undefined;
    updated.additionalModelOptionsCache = undefined;
    updated.clientDataCache = undefined;
    updated.clientDataCacheSlots = undefined;
    return updated;
  });
  // Drop session-level org default + Fable key-less consent latch so the next
  // account cannot inherit prior process-local auth state.
  try {
    const { setResolvedOrgDefault, setFableSessionFallbackConsented } = await import('../../bootstrap/state.js');
    setResolvedOrgDefault(undefined);
    setFableSessionFallbackConsented(false);
  } catch {
    // bootstrap isolation — optional
  }
  // densable TZt → Rzo("signed_out"): bump artifact accountEpoch + clear probeBoots.
  try {
    const { noteArtifactAccountChanged } = await import('../../services/artifactAutoReact/accountBoundary.js');
    noteArtifactAccountChanged('signed_out');
  } catch {
    // artifactAutoReact optional in isolation
  }
  return revokeUnconfirmed ? 'revoke_unconfirmed' : undefined;
}

function clearChatGPTSettingsAuthMode(): void {
  delete process.env.OPENAI_AUTH_MODE;
  const userSettings = getSettingsForSource('userSettings') ?? {};
  const env = userSettings.env ?? {};
  const hasOpenAICompatibleConfig =
    Boolean(env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY) &&
    Boolean(env.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL);
  const settingsUpdate: Parameters<typeof updateSettingsForSource>[1] = {
    ...(userSettings.modelType === 'openai' && !hasOpenAICompatibleConfig ? { modelType: undefined } : {}),
    env: {
      OPENAI_AUTH_MODE: undefined,
    } as unknown as Record<string, string>,
  };
  updateSettingsForSource('userSettings', settingsUpdate);
}

// clearing anything memoized that must be invalidated when user/session/auth changes
export async function clearAuthRelatedCaches(): Promise<void> {
  // Clear the OAuth token cache
  getClaudeAIOAuthTokens.cache?.clear?.();
  clearTrustedDeviceTokenCache();
  clearBetasCaches();
  clearToolSchemaCache();

  // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
  resetUserCache();
  refreshGrowthBookAfterAuthChange();

  // Clear Grove config cache
  getGroveNoticeConfig.cache?.clear?.();
  getGroveSettings.cache?.clear?.();

  try {
    const { clearClientDataFetches } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js');
    clearClientDataFetches();
  } catch {
    // isolation — optional
  }
}

export type FleetHostLogoutBag = {
  exit: () => void;
  setError: (msg: string) => void;
  setInfo: (msg: string) => void;
};

/**
 * Official 2.1.323 `i9a` (#2206): `/logout` handler for background / fleet host
 * sessions — signs out every session on this computer, deletes stored MCP logins
 * and plugin secrets via `performLogout`, and ends the session via `exit()`.
 */
export async function fleetHostLogout({ exit, setError, setInfo }: FleetHostLogoutBag): Promise<void> {
  setInfo('Signing out…');
  logOTelAuthEvent({ action: 'logout', success: true, authMethod: 'oauth' });
  try {
    await performLogout({ clearOnboarding: true });
    exit();
  } catch (err) {
    setError(`Couldn't sign out — ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function call(): Promise<React.ReactNode> {
  logOTelAuthEvent({ action: 'logout', success: true, authMethod: 'oauth' });
  const outcome = await performLogout({ clearOnboarding: true });
  const isAltScreen = instances.get(process.stdout)?.isAltScreenActive === true;

  // Official 2.1.326 #238 & #67: surface revoke-unconfirmed notice and pass
  // `finalMessage` to gracefulShutdown so fullscreen exits leave the message on screen.
  if (outcome === 'revoke_unconfirmed') {
    const unconfirmedMessage = await formatRevokeUnconfirmedMessage();
    setTimeout(() => {
      void gracefulShutdown(0, 'logout', { finalMessage: unconfirmedMessage });
    }, 200);
    return <Text>{isAltScreen ? '' : unconfirmedMessage}</Text>;
  }

  setTimeout(() => {
    void gracefulShutdown(0, 'logout', isAltScreen ? { finalMessage: LOGOUT_SUCCESS_MESSAGE } : undefined);
  }, 200);

  return <Text>{LOGOUT_SUCCESS_MESSAGE}</Text>;
}
