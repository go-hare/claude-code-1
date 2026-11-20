import { feature } from 'bun:bundle';
import * as React from 'react';
import { resetCostState } from '../../bootstrap/state.js';
import { clearTrustedDeviceToken, enrollTrustedDevice } from '../../bridge/trustedDevice.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { ConsoleOAuthFlow } from '../../components/ConsoleOAuthFlow.js';
import { Box, Dialog, PANE_PADDING_X_INLINE, PANE_PADDING_X_MODAL, useInput, useIsInsideModal } from '@anthropic/ink';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { Text } from '@anthropic/ink';
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { createSystemMessage, stripSignatureBlocks } from '../../utils/messages.js';
import type { Message } from '../../types/message.js';
import {
  checkAndDisableAutoModeIfNeeded,
  resetAutoModeGateCheck,
} from '../../utils/permissions/bypassPermissionsKillswitch.js';
import {
  getAnthropicApiKeyWithSource,
  getOauthAccountInfoFromDisk,
  rollbackRefusedSignIn,
  validateForceLoginOrg,
} from '../../utils/auth.js';
import { logForDebugging } from '../../utils/debug.js';
import { resetUserCache } from '../../utils/user.js';
import { AuthPlaneSummary } from './AuthPlaneSummary.js';
import { getAuthStatus } from './getAuthStatus.js';
import { WorkspaceKeyInputContainer } from './WorkspaceKeyInput.js';
import { removeWorkspaceKey } from '../../services/auth/saveWorkspaceKey.js';

/** densable lnr */
export const LOGIN_HANDOFF_SIGNED_IN = "Signed in. Review your organization's managed settings to continue.";

/**
 * #1745: Coordinate `/login` dialog dismissal with `validateForceLoginOrg()`.
 * - When `willAutoQuery` is true or a managed `forceLoginOrgUUID`/`forceLoginMethod`
 *   pin is active, await `validateOrg()` BEFORE calling `onDone` so an unauthorized
 *   org is rolled back and can never trigger `shouldQuery: true`.
 * - Otherwise dismiss immediately on Enter and finish validation + non-security
 *   refresh in the background.
 */
export async function finalizeLoginDone(opts: {
  success: boolean;
  willAutoQuery: boolean;
  hasForceLoginPin: boolean;
  doneMessage: string;
  onDone: LocalJSXCommandOnDone;
  validateOrg: () => Promise<{ valid: boolean; message?: string }>;
  rollbackSignIn: () => Promise<unknown>;
  onOrgRefusedBeforeDismiss: () => void;
  onOrgRefusedAfterDismiss: (message?: string) => void;
  runBackgroundRefresh: () => void;
}): Promise<void> {
  const mustAwaitOrgValidation = opts.willAutoQuery || opts.hasForceLoginPin;
  if (mustAwaitOrgValidation) {
    try {
      const orgValidation = await opts.validateOrg();
      if (!orgValidation.valid) {
        await opts.rollbackSignIn();
        opts.onOrgRefusedBeforeDismiss();
        opts.onDone(orgValidation.message ?? 'Login refused by organization policy', {
          display: 'system',
        });
        return;
      }
      opts.onDone(opts.doneMessage, opts.willAutoQuery ? { display: 'system', shouldQuery: true } : undefined);
      opts.runBackgroundRefresh();
    } catch (err) {
      logForDebugging(`[login] force-login org validation failed: ${err instanceof Error ? err.message : String(err)}`);
      await opts.rollbackSignIn().catch(rollbackErr => {
        logForDebugging(
          `[login] rollbackRefusedSignIn failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        );
      });
      opts.onOrgRefusedBeforeDismiss();
      opts.onDone('Login refused: failed to validate organization policy', {
        display: 'system',
      });
    }
    return;
  }

  opts.onDone(opts.doneMessage, undefined);
  try {
    const orgValidation = await opts.validateOrg();
    if (!orgValidation.valid) {
      await opts.rollbackSignIn();
      opts.onOrgRefusedAfterDismiss(orgValidation.message);
      return;
    }
    opts.runBackgroundRefresh();
  } catch (err) {
    logForDebugging(
      `[login] background post-login validation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  // Snapshot auth state once at call time (pure, no network)
  const authStatus = getAuthStatus();
  // densable 2.1.229 #27 o9m — snapshot env token BEFORE login so success
  // note (i9m) still fires after installOAuthTokens may clear/replace env.
  const {
    getOauthTokenEnvStartingMessage,
    formatLoginDoneMessage,
    isOauthTokenEnvSetAtStart,
    lastMessageRequestsAuthRetry,
    resolveOauthTokenEnvWarningPlacement,
    getOauthTokenEnvSuccessNote,
  } = await import('./oauthTokenEnvWarning.js');
  const envTokenWasSet = isOauthTokenEnvSetAtStart();
  const startingMessage = getOauthTokenEnvStartingMessage();
  const envWarningOnce = { delivered: false };
  // densable `t.previousAccount` — snapshot before the flow mutates disk.
  const previousAccount = getOauthAccountInfoFromDisk();

  return (
    <Login
      authStatus={authStatus}
      startingMessage={startingMessage}
      onDone={success => {
        context.onChangeAPIKey();
        // Signature-bearing blocks (thinking, connector_text) are bound to the API key —
        // strip them so the new key doesn't reject stale signatures.
        context.setMessages(stripSignatureBlocks);

        let messages: Message[] = [];
        context.setMessages(prev => {
          messages = prev;
          return prev;
        });
        const willAutoQuery = Boolean(success && lastMessageRequestsAuthRetry(messages));
        const gatewayActive = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getClientType } = require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js');
            return getClientType() === 'gateway';
          } catch {
            return false;
          }
        })();
        const placement = resolveOauthTokenEnvWarningPlacement({
          envTokenWasSet,
          gatewayActive,
          willAutoQuery,
        });
        if (placement === 'out-of-band' && !envWarningOnce.delivered) {
          envWarningOnce.delivered = true;
          const notice = createSystemMessage(getOauthTokenEnvSuccessNote(), 'info');
          context.setMessages(prev => [...prev, notice]);
        }
        // Official 2.1.326 #58: warn when ANTHROPIC_API_KEY is still active after /login.
        const apiKeyStillUsed =
          success &&
          !gatewayActive &&
          Boolean(process.env.ANTHROPIC_API_KEY) &&
          (() => {
            try {
              return (
                getAnthropicApiKeyWithSource({ skipRetrievingKeyFromApiKeyHelper: true }).source === 'ANTHROPIC_API_KEY'
              );
            } catch {
              return false;
            }
          })();
        const doneMessage = formatLoginDoneMessage(success, {
          envTokenWasSet,
          gatewayActive,
          includeEnvTokenWarning: placement === 'inline',
          apiKeyStillUsed,
        });

        // Official 2.1.319 (#1745): dismiss the dialog immediately on Enter
        // when no org/method pin is configured and no auto-query will fire;
        // otherwise await validateForceLoginOrg() first so a refused org can
        // never trigger shouldQuery: true before rollback.
        const hasForceLoginPin = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getSettingsForSource } =
              require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js');
            const policy = getSettingsForSource('policySettings');
            return policy?.forceLoginOrgUUID !== undefined || policy?.forceLoginMethod !== undefined;
          } catch {
            return false;
          }
        })();

        const runPostLoginBackgroundRefresh = (): void => {
          if (!success) return;
          void (async () => {
            // Post-login refresh logic. Keep in sync with onboarding in src/interactiveHelpers.tsx
            // Reset cost state when switching accounts
            resetCostState();
            // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
            resetUserCache();
            // Refresh GrowthBook after login to get updated feature flags (e.g., for claude.ai MCPs)
            refreshGrowthBookAfterAuthChange();
            // Clear any stale trusted device token from a previous account before
            // re-enrolling — prevents sending the old token on bridge calls while
            // the async enrollTrustedDevice() is in-flight.
            clearTrustedDeviceToken();
            // Enroll as a trusted device for Remote Control (10-min fresh-session window)
            const enrollPromise = Promise.resolve(enrollTrustedDevice()).catch(err => {
              logForDebugging(
                `[login] enrollTrustedDevice failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
            // Reset killswitch gate checks and re-run with new org
            resetAutoModeGateCheck();
            const appState = context.getAppState();
            const autoModePromise = Promise.resolve(
              checkAndDisableAutoModeIfNeeded(appState.toolPermissionContext, context.setAppState, appState.fastMode),
            ).catch(err => {
              logForDebugging(
                `[login] checkAndDisableAutoModeIfNeeded failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
            const currentAccount = getOauthAccountInfoFromDisk();
            const sameAccount =
              previousAccount?.accountUuid === currentAccount?.accountUuid &&
              previousAccount?.organizationUuid === currentAccount?.organizationUuid;
            const accountSwitched = previousAccount?.accountUuid !== undefined && !sameAccount;
            if (accountSwitched) {
              context.setAppState(prev => {
                if (!(prev.replBridgeEnabled || prev.replBridgeError !== undefined)) {
                  return prev;
                }
                logForDebugging('[bridge:repl] Account changed via /login — disconnecting Remote Control session');
                return {
                  ...prev,
                  replBridgeEnabled: false,
                  replBridgeExplicit: false,
                  replBridgeOutboundOnly: false,
                  replBridgeError: undefined,
                  replBridgeErrorKind: undefined,
                };
              });
              context.setAppState(prev => ({
                ...prev,
                replBridgeSessionGroupingId: undefined,
                replBridgeInitialName: undefined,
                showRemoteCallout: false,
                ultrareviewOverageConfirmed: false,
              }));
            }
            context.setAppState(prev => ({
              ...prev,
              authChangeGeneration: prev.authChangeGeneration + 1,
              authVersion: prev.authVersion + 1,
            }));
            await Promise.all([enrollPromise, autoModePromise]);
          })().catch(err => {
            logForDebugging(
              `[login] background post-login refresh failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        };

        void finalizeLoginDone({
          success,
          willAutoQuery,
          hasForceLoginPin,
          doneMessage,
          onDone,
          validateOrg: validateForceLoginOrg,
          rollbackSignIn: rollbackRefusedSignIn,
          onOrgRefusedAfterDismiss: message => {
            context.setAppState(prev => ({
              ...prev,
              authChangeGeneration: prev.authChangeGeneration + 1,
              authVersion: prev.authVersion + 1,
            }));
            if (message) {
              context.setMessages(prev => [...prev, createSystemMessage(message, 'warning')]);
            }
          },
          onOrgRefusedBeforeDismiss: () => {
            context.setAppState(prev => ({
              ...prev,
              authChangeGeneration: prev.authChangeGeneration + 1,
              authVersion: prev.authVersion + 1,
            }));
          },
          runBackgroundRefresh: runPostLoginBackgroundRefresh,
        });
      }}
    />
  );
}

export function Login(props: {
  onDone: (success: boolean, mainLoopModel: string) => void;
  startingMessage?: string;
  /** Pre-computed auth status snapshot — passed from call() to avoid re-computing */
  authStatus?: import('./getAuthStatus.js').AuthStatus;
}): React.ReactNode {
  const mainLoopModel = useMainLoopModel();
  // densable I() / V / x — urlOutdent is Pane paddingX (modal 1, inline 2)
  const urlOutdent = useIsInsideModal() ? PANE_PADDING_X_MODAL : PANE_PADDING_X_INLINE;
  const [showWorkspaceKeyInput, setShowWorkspaceKeyInput] = React.useState(false);
  // Official 2.1.328 (#619): when an inner /login substep (e.g. Bedrock access keys)
  // owns Esc, disable the outer Dialog's Esc cancel so Esc goes back one step.
  const [oauthHandlesEscape, setOauthHandlesEscape] = React.useState(false);
  // Official 2.1.327 (#464): suppress extra summary/chrome while inside Bedrock/Vertex
  // setup steps so `/login` never renders a doubled divider line.
  const [inPlatformStep, setInPlatformStep] = React.useState(false);
  // Only handle W/D workspace key shortcuts while ConsoleOAuthFlow is on its idle method picker.
  const [inOAuthIdle, setInOAuthIdle] = React.useState(true);
  // 'idle' | 'confirm-remove' | 'removing' | { error: string }
  const [removeState, setRemoveState] = React.useState<
    { phase: 'idle' } | { phase: 'confirm-remove' } | { phase: 'removing' } | { phase: 'error'; message: string }
  >({ phase: 'idle' });
  // Re-snapshot auth status after a key is saved/removed so the row updates immediately
  const [liveAuthStatus, setLiveAuthStatus] = React.useState(props.authStatus);

  const workspaceKeySet = liveAuthStatus !== undefined && liveAuthStatus.workspaceKey.set;
  // Source distinguishes env-var (cannot be deleted from UI) vs settings-saved
  const workspaceKeyFromSettings = workspaceKeySet && liveAuthStatus.workspaceKey.source === 'settings';

  const refreshLiveStatus = React.useCallback(() => {
    const { getAuthStatus } = require('./getAuthStatus.js') as typeof import('./getAuthStatus.js');
    setLiveAuthStatus(getAuthStatus());
  }, []);

  // W = enter/replace key; D = delete (only when stored in settings)
  useInput(
    (input: string) => {
      if (showWorkspaceKeyInput || !inOAuthIdle) return;
      if (removeState.phase === 'confirm-remove') {
        if (input === 'y' || input === 'Y') {
          setRemoveState({ phase: 'removing' });
          void (async () => {
            try {
              await removeWorkspaceKey();
              refreshLiveStatus();
              setRemoveState({ phase: 'idle' });
            } catch (err) {
              setRemoveState({
                phase: 'error',
                message: err instanceof Error ? err.message : 'Failed to remove workspace API key',
              });
            }
          })();
          return;
        }
        if (input === 'n' || input === 'N') {
          setRemoveState({ phase: 'idle' });
          return;
        }
        return;
      }
      if (input === 'w' || input === 'W') {
        setShowWorkspaceKeyInput(true);
        return;
      }
      if ((input === 'd' || input === 'D') && workspaceKeyFromSettings) {
        setRemoveState({ phase: 'confirm-remove' });
      }
    },
    { isActive: !showWorkspaceKeyInput && inOAuthIdle },
  );

  const handleWorkspaceKeySaved = React.useCallback(() => {
    refreshLiveStatus();
    setShowWorkspaceKeyInput(false);
  }, [refreshLiveStatus]);

  const { onDone } = props;

  const handleDialogCancel = React.useCallback(() => {
    onDone(false, mainLoopModel);
  }, [onDone, mainLoopModel]);

  const handleOAuthDone = React.useCallback(() => {
    onDone(true, mainLoopModel);
  }, [onDone, mainLoopModel]);

  const handleWorkspaceKeyCancel = React.useCallback(() => {
    setShowWorkspaceKeyInput(false);
  }, []);

  return (
    <Dialog
      title="Login"
      onCancel={handleDialogCancel}
      isCancelActive={!oauthHandlesEscape && !showWorkspaceKeyInput}
      color="permission"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description={oauthHandlesEscape ? 'go back' : 'cancel'}
          />
        )
      }
    >
      <Box flexDirection="column">
        {!inPlatformStep && liveAuthStatus !== undefined && (
          <Box marginBottom={1}>
            <AuthPlaneSummary status={liveAuthStatus} />
          </Box>
        )}

        {showWorkspaceKeyInput ? (
          <WorkspaceKeyInputContainer onSaved={handleWorkspaceKeySaved} onCancel={handleWorkspaceKeyCancel} />
        ) : removeState.phase === 'confirm-remove' || removeState.phase === 'removing' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              Remove the saved workspace API key? <Text dimColor>(settings.json only — env var is unaffected)</Text>
            </Text>
            <Text dimColor>{removeState.phase === 'removing' ? 'Removing…' : 'Press Y to confirm, N to cancel'}</Text>
          </Box>
        ) : (
          <>
            {!inPlatformStep && (
              <Box flexDirection="column" marginBottom={1}>
                {!workspaceKeySet ? (
                  <Text dimColor>Press W to enter workspace API key (saves to settings, no restart needed)</Text>
                ) : workspaceKeyFromSettings ? (
                  <Text dimColor>Press W to replace workspace API key · Press D to remove it</Text>
                ) : (
                  <Text dimColor>
                    Workspace API key from ANTHROPIC_API_KEY env. Press W to override with a settings-saved key.
                  </Text>
                )}
                {removeState.phase === 'error' && <Text color="error">{removeState.message}</Text>}
              </Box>
            )}
            <ConsoleOAuthFlow
              onDone={handleOAuthDone}
              startingMessage={props.startingMessage}
              urlOutdent={urlOutdent}
              onHandlesEscapeChange={setOauthHandlesEscape}
              onPlatformStepChange={setInPlatformStep}
              onIdleStateChange={setInOAuthIdle}
            />
          </>
        )}
      </Box>
    </Dialog>
  );
}
