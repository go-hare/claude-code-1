/**
 * densable 2.1.246 `ee` / CdTrustPrompt.
 * Move prompt, or `backstop` after a gated-grants relocate.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  Box,
  type DOMElement,
  measureElement,
  StatusIcon,
  Text,
  useModalOrTerminalSize,
  useTerminalSize,
} from '@anthropic/ink';
import {
  CONFIRM_SELECT_ARM_MS,
  ConfirmSelect,
  ConfirmSelectHint,
  confirmSelectRefused,
} from '../../components/ConfirmSelect.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import {
  ACCESSING_CAPABILITY,
  CD_TRUST_REPO_PREFIX,
  CD_TRUST_REPO_SUFFIX,
} from '../../components/TrustDialog/trustDialogCopy.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { isFullscreenActive } from '../../utils/fullscreen.js';
import {
  type CdDisclosures,
  formatCdDisclosureCount,
  formatCdDisclosureList,
  shouldShowCdDisclosures,
} from './cdDisclosures.js';

/** Official 2.1.326 #348: message shown when a fullscreen window is too short to show all trust disclosures. */
export const CD_TRUST_SHORT_WINDOW_WARNING = 'To trust this folder, first make the window taller';

/** Official 2.1.326 #348: pure helper for whether a fullscreen trust prompt is cut off vertically. */
export function isTrustPromptCutOff(opts: {
  fullscreen: boolean;
  contentHeight: number;
  availableRows: number;
  chromeRows?: number;
}): boolean {
  if (!opts.fullscreen) {
    return false;
  }
  const chrome = opts.chromeRows ?? 4;
  return opts.contentHeight > Math.max(1, opts.availableRows - chrome);
}

type Props = {
  directory: string;
  trustRoot?: string | null;
  disclosures?: CdDisclosures;
  backstop?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CdTrustPrompt({
  directory,
  trustRoot,
  disclosures,
  backstop = false,
  onConfirm,
  onCancel,
}: Props): React.ReactNode {
  const doneRef = useRef(false);
  const contentRef = useRef<DOMElement | null>(null);
  const [openedAt] = useState(() => Date.now());
  const terminalSize = useTerminalSize();
  const { rows: availableRows, columns: availableColumns } = useModalOrTerminalSize(terminalSize);
  const fullscreen = isFullscreenActive();
  const [isCutOff, setIsCutOff] = useState(false);

  useLayoutEffect(() => {
    if (!fullscreen || !contentRef.current) {
      setIsCutOff(false);
      return;
    }
    const { height } = measureElement(contentRef.current);
    setIsCutOff(
      isTrustPromptCutOff({
        fullscreen,
        contentHeight: height,
        availableRows,
      }),
    );
  }, [fullscreen, availableRows, availableColumns, directory, trustRoot, disclosures, backstop]);

  const isInputRefused = () => confirmSelectRefused(openedAt, CONFIRM_SELECT_ARM_MS, Date.now());
  const once = (fn: () => void) => {
    if (doneRef.current) return;
    doneRef.current = true;
    fn();
  };

  const exitState = useExitOnCtrlCDWithKeybindings(() => once(onCancel));
  useKeybinding('confirm:no', () => once(onCancel), {
    context: 'Confirmation',
  });

  const showDisclosures = shouldShowCdDisclosures(disclosures, backstop);
  const title = backstop ? 'Now in a new directory:' : 'Moving to a new directory:';
  const confirmLabel = backstop ? 'Yes, trust it and apply them' : 'Yes, move here';
  const cancelLabel = backstop ? 'No, keep them off' : 'No, stay put';

  return (
    <PermissionDialog color="warning" titleColor="warning" title={title}>
      <Box ref={contentRef} flexDirection="column" gap={1} paddingTop={1}>
        <Text bold>{directory}</Text>
        {trustRoot != null && trustRoot.length > 0 ? (
          <Text>
            {CD_TRUST_REPO_PREFIX} <Text bold>{trustRoot}</Text>
            {CD_TRUST_REPO_SUFFIX}
          </Text>
        ) : null}
        {backstop ? (
          <Text>
            Its settings declare project permission rules and/or additional directories. They apply only if you trust
            this directory explicitly.
          </Text>
        ) : (
          <Text>{"This session hasn't worked here before. Is this a directory you created or one you trust?"}</Text>
        )}
        {showDisclosures && disclosures ? <CdDisclosureLines disclosures={disclosures} backstop={backstop} /> : null}
        {!backstop ? <Text>{ACCESSING_CAPABILITY}</Text> : null}
        <Text dimColor>Security guide: https://code.claude.com/docs/en/security</Text>
        {isCutOff ? (
          <Text bold color="warning">
            <StatusIcon status="warning" withSpace />
            {CD_TRUST_SHORT_WINDOW_WARNING}
          </Text>
        ) : null}
        <ConfirmSelect
          openedAt={openedAt}
          windowMs={CONFIRM_SELECT_ARM_MS}
          refuseInput={() => isInputRefused() || isCutOff}
          cancelFirst
          focus="cancel"
          hideIndexes
          disablePrintableKeybindings
          onUpFromFirstItem={backstop ? () => {} : undefined}
          confirmLabel={isCutOff ? `${confirmLabel} (window too short)` : confirmLabel}
          cancelLabel={cancelLabel}
          onConfirm={() => {
            if (isCutOff || isInputRefused()) {
              return;
            }
            once(onConfirm);
          }}
          onCancel={() => {
            if (isInputRefused()) {
              return;
            }
            once(onCancel);
          }}
        />
        <ConfirmSelectHint pending={exitState.pending} pendingKeyName={exitState.keyName ?? undefined} />
      </Box>
    </PermissionDialog>
  );
}

function CdDisclosureLines({
  disclosures,
  backstop,
}: {
  disclosures: CdDisclosures;
  backstop: boolean;
}): React.ReactNode {
  const allow = disclosures.allowRules;
  const extra = disclosures.additionalDirectories;
  const settingsFiles = disclosures.settingsFiles;
  return (
    <Box flexDirection="column" gap={1}>
      {allow.sources.length > 0 ? (
        <Text bold color="warning">
          This directory pre-approves {allow.rawCount}{' '}
          {formatCdDisclosureCount(allow.rawCount, 'tool permission', 'tool permissions')} in{' '}
          {formatCdDisclosureList(allow.sources)}: {formatCdDisclosureList(allow.rules, 8)}
        </Text>
      ) : null}
      {extra.sources.length > 0 ? (
        <Text bold color="warning">
          This directory grants access to {extra.rawCount} additional{' '}
          {formatCdDisclosureCount(extra.rawCount, 'directory', 'directories')} in{' '}
          {formatCdDisclosureList(extra.sources)}: {formatCdDisclosureList(extra.dirs, 6)}
        </Text>
      ) : null}
      {!backstop && disclosures.hookSources.length > 0 ? (
        <Text bold color="warning">
          Hooks declared in {formatCdDisclosureList(disclosures.hookSources)}
        </Text>
      ) : null}
      {!backstop && disclosures.commandHelperSources.length > 0 ? (
        <Text bold color="warning">
          Command helpers declared in {formatCdDisclosureList(disclosures.commandHelperSources)}
        </Text>
      ) : null}
      {!backstop && settingsFiles.length > 0 ? (
        <Text>Trusting this directory loads {formatCdDisclosureList(settingsFiles)}.</Text>
      ) : null}
    </Box>
  );
}
