import { useCallback, useState } from 'react';
import { setTeleportedSessionInfo } from 'src/bootstrap/state.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import type { TeleportRemoteResponse } from 'src/utils/conversationRecovery.js';
import type { CodeSession } from 'src/utils/teleport/api.js';
import { disconnectBridgeBeforeConversationSwitch } from '../bridge/replBridgeShareCheck.js';
import { useAppStateStore } from '../state/AppState.js';
import { errorMessage, TeleportOperationError } from '../utils/errors.js';
import { teleportResumeCodeSession } from '../utils/teleport.js';

export type TeleportResumeError = {
  message: string;
  formattedMessage?: string;
  isOperationError: boolean;
};

export type TeleportSource = 'cliArg' | 'localCommand';

export function useTeleportResume(source: TeleportSource) {
  const store = useAppStateStore();
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<TeleportResumeError | null>(null);
  const [selectedSession, setSelectedSession] = useState<CodeSession | null>(null);

  const resumeSession = useCallback(
    async (session: CodeSession): Promise<TeleportRemoteResponse | null> => {
      setIsResuming(true);
      setError(null);
      setSelectedSession(session);

      // Log teleport session selection
      logEvent('tengu_teleport_resume_session', {
        source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        session_id: session.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      try {
        // Official 2.1.325 (#2373): disconnect Remote Control before /teleport
        // switches conversations if the connected session has a share link or
        // share visibility cannot be checked.
        await disconnectBridgeBeforeConversationSwitch({
          outboundOnly: store.getState().replBridgeOutboundOnly === true,
          onDisconnected: () => {
            store.setState(prev =>
              prev.replBridgeEnabled
                ? {
                    ...prev,
                    replBridgeEnabled: false,
                    replBridgeConnected: false,
                    replBridgeSessionActive: false,
                    replBridgeSessionGroupingId: undefined,
                  }
                : prev,
            );
          },
        });
        const result = await teleportResumeCodeSession(session.id);
        // Track teleported session for reliability logging
        setTeleportedSessionInfo({ sessionId: session.id });
        setIsResuming(false);
        return result;
      } catch (err) {
        const teleportError: TeleportResumeError = {
          message: err instanceof TeleportOperationError ? err.message : errorMessage(err),
          formattedMessage: err instanceof TeleportOperationError ? err.formattedMessage : undefined,
          isOperationError: err instanceof TeleportOperationError,
        };
        setError(teleportError);
        setIsResuming(false);
        return null;
      }
    },
    [source, store],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    resumeSession,
    isResuming,
    error,
    selectedSession,
    clearError,
  };
}
