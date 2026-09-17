/**
 * densable 2.1.246 `Lo` / `ae` / `CdUntrustedMoveFlow`.
 * Trust prompt (with disclosures), then gated-grants backstop, then MCP `V`.
 */
import React from 'react';
import {
  CdPendingMcpApproval,
  type McpApprovalPersistResult,
  type McpApprovalSkipWarning,
  type PendingMcpApprovals,
} from '../../services/mcpServerApproval.js';
import { wrapInSystemReminder } from '../../utils/messages.js';
import { type CdDisclosures, readCdBackstopDisclosures } from './cdDisclosures.js';
import { CdTrustPrompt } from './CdTrustPrompt.js';

export type CdMoveOutcome = {
  modelMessage: string;
  pending: PendingMcpApprovals;
  projectGrantsGated?: boolean;
  gatedNotice?: string;
  skipNotice?: McpApprovalSkipWarning;
};

type Props = {
  directory: string;
  trustRoot?: string | null;
  disclosures?: CdDisclosures;
  onConfirm: () => Promise<CdMoveOutcome | null>;
  onComplete: (modelMessage: string, persist?: McpApprovalPersistResult, skipNotice?: McpApprovalSkipWarning) => void;
  onCancel: () => void;
  onTrustFlip?: () => void;
  /** Trusted parent-grant move that still needs `ae` backstop. */
  initialOutcome?: CdMoveOutcome;
};

export function replaceGatedNotice(modelMessage: string, gatedNotice: string | undefined): string {
  if (!gatedNotice) {
    return modelMessage;
  }
  return modelMessage.replace(
    gatedNotice,
    wrapInSystemReminder(
      'The user trusted this directory explicitly: its project permission rules and additional directories are now applied.',
    ),
  );
}

export function CdUntrustedMoveFlow({
  directory,
  trustRoot,
  disclosures,
  onConfirm,
  onComplete,
  onCancel,
  onTrustFlip,
  initialOutcome,
}: Props): React.ReactNode {
  const [outcome, setOutcome] = React.useState<CdMoveOutcome | null>(initialOutcome ?? null);
  const [backstopDone, setBackstopDone] = React.useState(false);

  if (outcome !== null && outcome.projectGrantsGated && !backstopDone) {
    return (
      <CdGatedGrantsBackstop
        directory={directory}
        trustRoot={trustRoot}
        outcome={outcome}
        onApplied={message => {
          setBackstopDone(true);
          if (outcome.pending.pendingServers.length === 0) {
            onComplete(message, undefined, outcome.skipNotice);
            return;
          }
          setOutcome({ ...outcome, modelMessage: message, projectGrantsGated: false });
        }}
        onKeepOff={() => {
          setBackstopDone(true);
          if (outcome.pending.pendingServers.length === 0) {
            onComplete(outcome.modelMessage, undefined, outcome.skipNotice);
            return;
          }
          setOutcome({ ...outcome, projectGrantsGated: false });
        }}
        onTrustFlip={onTrustFlip}
      />
    );
  }

  if (outcome !== null) {
    return (
      <CdPendingMcpApproval
        pending={outcome.pending}
        onComplete={persist => onComplete(outcome.modelMessage, persist, outcome.skipNotice)}
      />
    );
  }

  return (
    <CdTrustPrompt
      directory={directory}
      trustRoot={trustRoot}
      disclosures={disclosures}
      onConfirm={() => {
        void onConfirm().then(next => {
          if (next === null) {
            return;
          }
          if (!next.projectGrantsGated && next.pending.pendingServers.length === 0) {
            onComplete(next.modelMessage, undefined, next.skipNotice);
            return;
          }
          setOutcome(next);
        });
      }}
      onCancel={onCancel}
    />
  );
}

export function CdGatedGrantsBackstop({
  directory,
  trustRoot,
  outcome,
  onApplied,
  onKeepOff,
  onTrustFlip,
}: {
  directory: string;
  trustRoot?: string | null;
  outcome: CdMoveOutcome;
  onApplied: (modelMessage: string) => void;
  onKeepOff: () => void;
  onTrustFlip?: () => void;
}): React.ReactNode {
  let disclosures: CdDisclosures | undefined;
  try {
    disclosures = readCdBackstopDisclosures();
  } catch {
    disclosures = undefined;
  }
  return (
    <CdTrustPrompt
      directory={directory}
      trustRoot={trustRoot}
      disclosures={disclosures}
      backstop
      onConfirm={() => {
        onTrustFlip?.();
        onApplied(replaceGatedNotice(outcome.modelMessage, outcome.gatedNotice));
      }}
      onCancel={onKeepOff}
    />
  );
}
