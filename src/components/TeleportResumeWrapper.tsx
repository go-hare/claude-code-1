import React, { useEffect, useRef } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import type { TeleportRemoteResponse } from 'src/utils/conversationRecovery.js';
import type { CodeSession } from 'src/utils/teleport/api.js';
import { type TeleportResumeError, type TeleportSource, useTeleportResume } from '../hooks/useTeleportResume.js';
import { Box, Text } from '@anthropic/ink';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { ResumeTask } from './ResumeTask.js';
import { Spinner } from './Spinner.js';

interface TeleportResumeWrapperProps {
  onComplete: (result: TeleportRemoteResponse) => void;
  onCancel: () => void;
  onError?: (error: string, formattedMessage?: string) => void;
  isEmbedded?: boolean;
  source: TeleportSource;
}

/**
 * Wrapper component that manages the full teleport resume flow,
 * including session selection, loading state, and error handling
 */
export function TeleportResumeWrapper({
  onComplete,
  onCancel,
  onError,
  isEmbedded = false,
  source,
}: TeleportResumeWrapperProps): React.ReactNode {
  const { resumeSession, isResuming, error, selectedSession } = useTeleportResume(source);
  const reportedErrorRef = useRef<TeleportResumeError | null>(null);

  // Log when teleport flow starts (for funnel tracking)
  useEffect(() => {
    logEvent('tengu_teleport_started', {
      source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
  }, [source]);

  // Official 2.1.327 (#456): observe fresh `error` state rather than reading a
  // stale `error` closure inside `handleSelect` after `await resumeSession(...)`.
  useEffect(() => {
    if (error && onError && reportedErrorRef.current !== error) {
      reportedErrorRef.current = error;
      onError(error.message, error.formattedMessage);
    } else if (!error) {
      reportedErrorRef.current = null;
    }
  }, [error, onError]);

  const handleSelect = async (session: CodeSession) => {
    const result = await resumeSession(session);
    if (result) {
      onComplete(result);
    }
  };

  const handleCancel = () => {
    logEvent('tengu_teleport_cancelled', {});
    onCancel();
  };

  // Allow Esc to dismiss the standalone error state
  const showStandaloneError = !!error && !isEmbedded && !onError;
  useKeybinding('app:interrupt', handleCancel, {
    context: 'Global',
    isActive: showStandaloneError,
  });
  useKeybinding('confirm:no', handleCancel, {
    context: 'Confirmation',
    isActive: showStandaloneError,
  });

  // Show loading spinner when resuming
  if (isResuming && selectedSession) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box flexDirection="row">
          <Spinner />
          <Text bold>Resuming session…</Text>
        </Box>
        <Text dimColor>Loading &quot;{selectedSession.title}&quot;…</Text>
      </Box>
    );
  }

  // Official 2.1.327 (#456): render resume failure notice both standalone (CLI)
  // and inline inside ResumeTask (embedded /teleport).
  const errorNotice = error && !onError && (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="error">
        Couldn&apos;t resume the session
      </Text>
      <Text dimColor>{error.message}</Text>
    </Box>
  );

  // Show standalone error screen when not embedded
  if (errorNotice && !isEmbedded) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {errorNotice}
        <Text dimColor>
          Press <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    );
  }

  return <ResumeTask notice={errorNotice} onSelect={handleSelect} onCancel={handleCancel} isEmbedded={isEmbedded} />;
}
