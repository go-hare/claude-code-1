import React, { useCallback, useEffect, useState } from 'react';
import { checkIsGitClean, checkNeedsClaudeAiLogin } from 'src/utils/background/remote/preconditions.js';
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js';
import { Box, Dialog, PANE_PADDING_X_INLINE, PANE_PADDING_X_MODAL, Text, useIsInsideModal } from '@anthropic/ink';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { ConfirmSelect } from './ConfirmSelect.js';
import { ConsoleOAuthFlow } from './ConsoleOAuthFlow.js';
import { TeleportStash } from './TeleportStash.js';

export type TeleportLocalErrorType = 'needsLogin' | 'needsGitStash';

type TeleportErrorProps = {
  onComplete: () => void;
  onCancel?: () => void;
  errorsToIgnore?: ReadonlySet<TeleportLocalErrorType>;
  isStandalone?: boolean;
};

// Module-level sentinel so the default parameter has stable identity.
// Previously `= new Set()` created a fresh Set every render, which put
// a new object in checkErrors' deps and caused the mount effect to
// re-fire on every render.
const EMPTY_ERRORS_TO_IGNORE: ReadonlySet<TeleportLocalErrorType> = new Set();

function defaultCancel(): void {
  gracefulShutdownSync(0);
}

export function TeleportError({
  onComplete,
  onCancel: onCancelProp,
  errorsToIgnore = EMPTY_ERRORS_TO_IGNORE,
  isStandalone = false,
}: TeleportErrorProps): React.ReactNode {
  const [currentError, setCurrentError] = useState<TeleportLocalErrorType | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  // densable z() / K / H — same Pane paddingX as /login
  const urlOutdent = useIsInsideModal() ? PANE_PADDING_X_MODAL : PANE_PADDING_X_INLINE;

  // Check for errors on mount and when error resolution occurs
  const checkErrors = useCallback(async () => {
    const currentErrors = await getTeleportErrors();
    const filteredErrors = new Set(
      Array.from(currentErrors).filter((error: TeleportLocalErrorType) => !errorsToIgnore.has(error)),
    );

    // If no errors remain, call onComplete
    if (filteredErrors.size === 0) {
      onComplete();
      return;
    }

    // Set current error to handle (prioritize login over git)
    if (filteredErrors.has('needsLogin')) {
      setCurrentError('needsLogin');
    } else if (filteredErrors.has('needsGitStash')) {
      setCurrentError('needsGitStash');
    }
  }, [onComplete, errorsToIgnore]);

  // Check errors on mount
  useEffect(() => {
    void checkErrors();
  }, [checkErrors]);

  const cancelQuits = onCancelProp === undefined;
  const onCancel = onCancelProp ?? defaultCancel;

  const handleLoginComplete = useCallback(() => {
    setIsLoggingIn(false);
    void checkErrors();
  }, [checkErrors]);

  const handleLoginWithClaudeAI = useCallback(() => {
    setIsLoggingIn(true);
  }, []);

  const handleStashComplete = useCallback(() => {
    void checkErrors();
  }, [checkErrors]);

  const exitState = useExitOnCtrlCDWithKeybindings(onCancelProp, undefined, onCancelProp !== undefined && isLoggingIn);

  const isStandaloneStash = isStandalone && currentError === 'needsGitStash';
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: isStandaloneStash,
  });

  // Don't render anything if no current error (onComplete will be called)
  if (!currentError) {
    return null;
  }

  switch (currentError) {
    case 'needsGitStash':
      return <TeleportStash onStashAndContinue={handleStashComplete} onCancel={onCancel} cancelQuits={cancelQuits} />;

    case 'needsLogin': {
      const oauthFlow = (
        <ConsoleOAuthFlow
          onDone={handleLoginComplete}
          mode="login"
          forceLoginMethod="claudeai"
          urlOutdent={urlOutdent}
        />
      );
      const dialogOnCancel = isLoggingIn ? handleLoginComplete : onCancel;
      const inputGuide = exitState.pending ? `Press ${exitState.keyName} again to cancel` : undefined;

      return (
        <Dialog title="Log in to Claude" onCancel={dialogOnCancel} exitOnCtrlCD={cancelQuits} inputGuide={inputGuide}>
          {isLoggingIn ? (
            oauthFlow
          ) : (
            <>
              <Box flexDirection="column">
                <Text dimColor>Teleport requires a Claude.ai account.</Text>
                <Text dimColor>Your Claude Pro/Max subscription will be used by Claude Code.</Text>
              </Box>
              <ConfirmSelect
                confirmLabel="Login with Claude account"
                cancelLabel={cancelQuits ? 'Exit' : 'Cancel'}
                onConfirm={handleLoginWithClaudeAI}
                onCancel={onCancel}
              />
            </>
          )}
        </Dialog>
      );
    }
  }
}

/**
 * Gets current teleport errors that need to be resolved
 * @returns Set of teleport error types that need to be handled
 */
export async function getTeleportErrors(): Promise<Set<TeleportLocalErrorType>> {
  const errors = new Set<TeleportLocalErrorType>();

  const [needsLogin, isGitClean] = await Promise.all([checkNeedsClaudeAiLogin(), checkIsGitClean()]);

  if (needsLogin) {
    errors.add('needsLogin');
  }
  if (!isGitClean) {
    errors.add('needsGitStash');
  }

  return errors;
}
