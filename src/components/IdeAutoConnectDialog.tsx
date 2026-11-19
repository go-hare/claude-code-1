import React, { useCallback, useRef } from 'react';
import { Text, Dialog } from '@anthropic/ink';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { isSupportedTerminal } from '../utils/ide.js';
import { useIsWithinWindow } from '../hooks/useRefuseWithin.js';
import { ConfirmSelect } from './ConfirmSelect.js';
import { Select } from './CustomSelect/index.js';

type IdeAutoConnectDialogProps = {
  onComplete: () => void;
  /** Official 2.1.326 #208: default false so `/ide` does not quit Claude Code on double Ctrl+C. */
  exitOnCtrlCD?: boolean;
};

export function IdeAutoConnectDialog({ onComplete, exitOnCtrlCD = false }: IdeAutoConnectDialogProps): React.ReactNode {
  const refuseInput = useIsWithinWindow();
  const doneRef = useRef(false);
  const finishOnce = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  }, [onComplete]);

  const handleSelect = useCallback(
    (value: string) => {
      if (refuseInput() || doneRef.current) return;
      const autoConnect = value === 'yes';

      // Save the preference and mark dialog as shown
      saveGlobalConfig(current => ({
        ...current,
        autoConnectIde: autoConnect,
        hasIdeAutoConnectDialogBeenShown: true,
      }));

      finishOnce();
    },
    [refuseInput, finishOnce],
  );

  const handleCancel = useCallback(() => {
    if (refuseInput() || doneRef.current) return;
    finishOnce();
  }, [refuseInput, finishOnce]);

  const options = [
    { label: 'Yes, connect automatically', value: 'yes' },
    { label: 'No, connect with /ide', value: 'no' },
  ];

  return (
    <Dialog title="Connect to your IDE automatically?" color="ide" onCancel={handleCancel} exitOnCtrlCD={exitOnCtrlCD}>
      <Select
        options={options}
        hideIndexes
        disablePrintableKeybindings
        declineValue="no"
        defaultFocusValue="no"
        refuseInput={refuseInput}
        onChange={handleSelect}
        onCancel={handleCancel}
      />
      <Text dimColor>You can also configure this in /config or with the --ide flag</Text>
    </Dialog>
  );
}

export function shouldShowAutoConnectDialog(): boolean {
  const config = getGlobalConfig();
  return !isSupportedTerminal() && config.autoConnectIde !== true && config.hasIdeAutoConnectDialogBeenShown !== true;
}

type IdeDisableAutoConnectDialogProps = {
  onComplete: (disableAutoConnect: boolean) => void;
};

export function IdeDisableAutoConnectDialog({ onComplete }: IdeDisableAutoConnectDialogProps): React.ReactNode {
  const handleSelect = useCallback(
    (value: string) => {
      const disableAutoConnect = value === 'yes';

      if (disableAutoConnect) {
        saveGlobalConfig(current => ({
          ...current,
          autoConnectIde: false,
        }));
      }

      onComplete(disableAutoConnect);
    },
    [onComplete],
  );

  const handleCancel = useCallback(() => {
    onComplete(false);
  }, [onComplete]);

  return (
    <Dialog
      title="Do you wish to disable auto-connect to IDE?"
      subtitle="You can also configure this in /config"
      onCancel={handleCancel}
      color="ide"
    >
      <ConfirmSelect
        hideIndexes
        cancelFirst
        focus="cancel"
        onConfirm={() => handleSelect('yes')}
        onCancel={handleCancel}
      />
    </Dialog>
  );
}

export function shouldShowDisableAutoConnectDialog(): boolean {
  const config = getGlobalConfig();
  return !isSupportedTerminal() && config.autoConnectIde === true;
}
