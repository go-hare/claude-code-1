/**
 * densable jsu non-permission renderers — tip + pealed dialog bridges.
 */
import React, { useMemo } from 'react';
import { CostThresholdDialog } from '../components/CostThresholdDialog.js';
import { FableConsentDialog } from '../components/FableConsentDialog.js';
import { IdeOnboardingDialog } from '../components/IdeOnboardingDialog.js';
import { ResumeReturnDialog } from '../components/ResumeReturnDialog.js';
import { PeerInboundApprovalDialog } from '../components/PeerInboundApprovalDialog.js';
import { ElicitationDialog } from '../components/mcp/ElicitationDialog.js';
import { ComputerUseApproval } from '../components/permissions/ComputerUseApproval/ComputerUseApproval.js';
import { SandboxPermissionRequest } from '../components/permissions/SandboxPermissionRequest.js';
import { It2SetupPrompt } from '../utils/swarm/It2SetupPrompt.js';
import type { DialogRendererProps } from './DialogHost.js';
import { AutoDefaultNudgeDialog } from './dialogs/AutoDefaultNudgeDialog.js';
import { AutoModeServerFallbackNotice } from './dialogs/AutoModeServerFallbackNotice.js';
import { AutoModeFlaggedAllowDialog, AutoModeSetupReviewDialog } from './dialogs/AutoModeSetupDialogs.js';
import {
  ChromeInstallSetupDialog,
  ChromeInstallUpsellDialog,
  isChromeInstallSetupPhase,
  type ChromeInstallSetupPayload,
} from './dialogs/ChromeInstallDialogs.js';
import { GoalProposalDialog } from './dialogs/GoalProposalDialog.js';
import { RefusalFallbackDialog } from './dialogs/RefusalFallbackDialog.js';
import { withSandboxNetworkPersistRow } from './sandboxNetworkAccess.js';
import {
  AUTO_DEFAULT_NUDGE_KIND,
  AUTO_MODE_FLAGGED_ALLOW_KIND,
  AUTO_MODE_SERVER_FALLBACK_KIND,
  AUTO_MODE_SETUP_REVIEW_KIND,
  CHROME_INSTALL_SETUP_KIND,
  CHROME_INSTALL_UPSELL_KIND,
  COMPUTER_USE_APPROVAL_KIND,
  COST_THRESHOLD_KIND,
  FABLE_OVERAGE_CONSENT_PROMPT_KIND,
  GOAL_PROPOSAL_KIND,
  IDE_ONBOARDING_KIND,
  IT2_SETUP_KIND,
  MCP_ELICITATION_KIND,
  MCP_ELICITATION_WAITING_KIND,
  MCP_URL_ELICITATION_KIND,
  PEER_INBOUND_APPROVAL_KIND,
  REFUSAL_FALLBACK_PROMPT_KIND,
  RESUME_RETURN_KIND,
  SANDBOX_NETWORK_ACCESS_KIND,
} from './specs/jsuKinds.js';

type DialogRenderer = (props: DialogRendererProps) => React.ReactNode;

const costThresholdRenderer: DialogRenderer = ({ answer }) => (
  <CostThresholdDialog onDone={() => answer('acknowledged')} onCancel={() => answer('cancelled')} />
);

/** densable W8c / Gxt — compact | continue | never; Esc → PPo("dismiss") */
const resumeReturnRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = (payload ?? {}) as {
    sessionAgeMinutes?: number;
    estimatedTokens?: number;
  };
  return (
    <ResumeReturnDialog
      sessionAgeMinutes={p.sessionAgeMinutes ?? 0}
      estimatedTokens={p.estimatedTokens ?? 0}
      onChoice={choice => answer(choice)}
      onCancel={() => answer('dismiss')}
    />
  );
};

const ideOnboardingRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = (payload ?? {}) as { installationStatus?: unknown };
  return (
    <IdeOnboardingDialog
      installationStatus={(p.installationStatus as never) ?? null}
      onDone={() => answer('dismissed')}
    />
  );
};

/** densable m2A / FRr — yes-dont-ask-again mints persistRow.applies for K8c */
const sandboxNetworkRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = payload as { host: string; port?: number | string };
  return (
    <SandboxPermissionRequest
      hostPattern={{ host: p.host, port: p.port as never }}
      onUserResponse={response => answer(withSandboxNetworkPersistRow(response, p.host))}
    />
  );
};

/** densable c2A / DIi — payload is the request body, not `{request}` */
const computerUseRenderer: DialogRenderer = ({ payload, answer }) => (
  <ComputerUseApproval request={payload as never} onDone={response => answer(response)} />
);

const fableOverageRenderer: DialogRenderer = ({ answer }) => (
  <FableConsentDialog onAccept={() => answer('consent')} onDecline={() => answer('cancelled')} />
);

const peerInboundRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = payload as {
    fromAddress?: string;
    claimedName?: string;
    verifiedPeerPid?: number;
    holdCause?: unknown;
    preview?: string;
  };
  if (!p?.holdCause || typeof p.preview !== 'string') {
    answer({ behavior: 'cancelled' });
    return null;
  }
  return (
    <PeerInboundApprovalDialog
      payload={{
        fromAddress: p.fromAddress,
        claimedName: p.claimedName,
        verifiedPeerPid: p.verifiedPeerPid,
        holdCause: p.holdCause as never,
        preview: p.preview,
      }}
      onAnswer={result => answer({ behavior: result })}
    />
  );
};

/** densable Kmy / jOo — installUpsell Mby (HAVE) */
const chromeInstallSetupRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = (payload ?? {}) as ChromeInstallSetupPayload;
  if (!isChromeInstallSetupPhase(p.phase)) {
    answer('cancelled');
    return null;
  }
  return <ChromeInstallSetupDialog payload={p} onAnswer={result => answer(result)} />;
};

/** densable znu / zOo — installUpsell KBA (HAVE) */
const chromeInstallUpsellRenderer: DialogRenderer = ({ answer }) => (
  <ChromeInstallUpsellDialog onAnswer={result => answer(result)} />
);

/** densable l2A / _Bi */
const it2SetupRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = (payload ?? {}) as { tmuxAvailable?: boolean };
  return <It2SetupPrompt tmuxAvailable={p.tmuxAvailable === true} onDone={result => answer(result)} />;
};

type LeftoverMcpElicitationParams = {
  message?: string;
  mode?: 'form' | 'url';
  url?: string;
  elicitationId?: string;
};

function leftoverMcpElicitationEvent(
  payload: unknown,
  signal: AbortSignal,
  waitingState: { actionLabel: string; showCancel?: boolean } | undefined,
  startWaiting: boolean,
): {
  params: LeftoverMcpElicitationParams;
  userConfirmsCompletion: boolean;
  event: {
    serverName: string;
    requestId: string;
    params: never;
    signal: AbortSignal;
    waitingState: { actionLabel: string; showCancel?: boolean } | undefined;
    startWaiting: boolean;
    respond: () => void;
  };
} | null {
  const p = payload as {
    serverName?: string;
    params?: LeftoverMcpElicitationParams;
    waitingState?: { actionLabel?: string; showCancel?: boolean };
    userConfirmsCompletion?: boolean;
  };
  if (!p?.serverName || !p.params) return null;
  const elicitationId = p.params.elicitationId ?? 'dialog';
  const fromPayload =
    p.waitingState && typeof p.waitingState.actionLabel === 'string'
      ? {
          actionLabel: p.waitingState.actionLabel,
          ...(p.waitingState.showCancel !== undefined ? { showCancel: p.waitingState.showCancel } : {}),
        }
      : undefined;
  return {
    params: p.params,
    userConfirmsCompletion: p.userConfirmsCompletion === true,
    event: {
      serverName: p.serverName,
      requestId: `dialog-${elicitationId}`,
      params: p.params as never,
      signal,
      waitingState: fromPayload ?? waitingState,
      startWaiting,
      respond: () => {},
    },
  };
}

/** densable g2A / $7 — URL retry in one Host (userConfirmsCompletion). */
function McpUrlElicitationRenderer({ payload, answer }: DialogRendererProps): React.ReactNode {
  const signal = useMemo(() => new AbortController().signal, []);
  const built = leftoverMcpElicitationEvent(payload, signal, { actionLabel: 'Retry now', showCancel: true }, false);
  if (!built) {
    answer({ action: 'cancel' });
    return null;
  }

  return (
    <ElicitationDialog
      event={built.event}
      onResponse={(action, content) => {
        if (action === 'accept' && built.params.mode === 'url') return;
        answer({ action, content });
      }}
      onWaitingDismiss={action => {
        if (action === 'cancel') answer({ action: 'cancel' });
        if (action === 'retry') answer({ action: 'accept' });
      }}
    />
  );
}

/** densable W7 — elicitation/create Host. Waiting is wne, not this dialog. */
function leftoverMcpElicitationRenderer({ payload, answer }: DialogRendererProps): React.ReactNode {
  const signal = useMemo(() => new AbortController().signal, []);
  const built = leftoverMcpElicitationEvent(payload, signal, undefined, false);
  if (!built) {
    answer({ action: 'cancel' });
    return null;
  }

  return (
    <ElicitationDialog
      event={built.event}
      onResponse={(action, content) => {
        if (action === 'accept' && built.params.mode === 'url' && built.userConfirmsCompletion) return;
        answer({ action, content });
      }}
      onWaitingDismiss={action => {
        if (built.userConfirmsCompletion) {
          if (action === 'cancel') answer({ action: 'cancel' });
          if (action === 'retry') answer({ action: 'accept' });
          return;
        }
        if (action === 'cancel') answer({ action: 'cancel' });
      }}
    />
  );
}

/** densable wne — URL waiting after W7 accept. */
function leftoverMcpElicitationWaitingRenderer({ payload, answer }: DialogRendererProps): React.ReactNode {
  const signal = useMemo(() => new AbortController().signal, []);
  const built = leftoverMcpElicitationEvent(payload, signal, { actionLabel: 'Skip confirmation' }, true);
  if (!built) {
    answer('cancelled');
    return null;
  }

  return (
    <ElicitationDialog
      event={built.event}
      onResponse={(action, content) => {
        answer({ action, content });
      }}
      onWaitingDismiss={action => {
        answer(action);
      }}
    />
  );
}

/** densable Giu / $ne */
const refusalFallbackRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = payload as {
    originalModel?: string;
    fallbackModel?: string;
    apiRefusalCategory?: string | null;
    guidanceText?: string;
    retractedMessageUuids?: string[];
  };
  if (!p?.originalModel || !p.fallbackModel) {
    answer('cancelled');
    return null;
  }
  return (
    <RefusalFallbackDialog
      payload={{
        originalModel: p.originalModel,
        fallbackModel: p.fallbackModel,
        apiRefusalCategory: p.apiRefusalCategory,
        guidanceText: p.guidanceText,
        retractedMessageUuids: p.retractedMessageUuids,
      }}
      onAnswer={result => answer(result)}
    />
  );
};

/** densable xou / Dot — payload is `{condition}` only; extras are live-read in xou. */
const goalProposalRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = payload as { condition?: string };
  if (typeof p?.condition !== 'string' || p.condition === '') {
    answer({ approved: false });
    return null;
  }
  return <GoalProposalDialog payload={{ condition: p.condition }} onAnswer={result => answer(result)} />;
};

/** densable Veu / qSn */
const autoDefaultNudgeRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = (payload ?? {}) as { currentMode?: string };
  return <AutoDefaultNudgeDialog currentMode={p.currentMode} onAnswer={result => answer(result)} />;
};

/** densable snu / AEo */
const autoModeSetupReviewRenderer: DialogRenderer = ({ payload, answer }) => (
  <AutoModeSetupReviewDialog payload={(payload ?? {}) as never} onAnswer={result => answer(result)} />
);

/** densable anu / TEo */
const autoModeFlaggedAllowRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = payload as { flagged?: string[]; runId?: string };
  if (!p?.runId || !Array.isArray(p.flagged)) {
    answer('cancelled');
    return null;
  }
  return (
    <AutoModeFlaggedAllowDialog payload={{ flagged: p.flagged, runId: p.runId }} onAnswer={result => answer(result)} />
  );
};

/** densable fme — auto-mode classifier billing notice. */
const autoModeServerFallbackRenderer: DialogRenderer = ({ payload, answer }) => {
  const p = (payload ?? {}) as { title?: string; paragraphs?: string[] };
  return (
    <AutoModeServerFallbackNotice
      title={typeof p.title === 'string' ? p.title : ''}
      paragraphs={Array.isArray(p.paragraphs) ? p.paragraphs : []}
      onDone={result => answer(result)}
    />
  );
};

/** densable jsu — full pealed non-permission set */
export const JSU_NON_PERMISSION_COMPONENTS: Record<string, DialogRenderer> = {
  [IT2_SETUP_KIND]: it2SetupRenderer,
  [COST_THRESHOLD_KIND]: costThresholdRenderer,
  [AUTO_MODE_SERVER_FALLBACK_KIND]: autoModeServerFallbackRenderer,
  [RESUME_RETURN_KIND]: resumeReturnRenderer,
  [IDE_ONBOARDING_KIND]: ideOnboardingRenderer,
  [SANDBOX_NETWORK_ACCESS_KIND]: sandboxNetworkRenderer,
  [COMPUTER_USE_APPROVAL_KIND]: computerUseRenderer,
  [AUTO_DEFAULT_NUDGE_KIND]: autoDefaultNudgeRenderer,
  [MCP_URL_ELICITATION_KIND]: McpUrlElicitationRenderer,
  [MCP_ELICITATION_KIND]: leftoverMcpElicitationRenderer,
  [MCP_ELICITATION_WAITING_KIND]: leftoverMcpElicitationWaitingRenderer,
  [REFUSAL_FALLBACK_PROMPT_KIND]: refusalFallbackRenderer,
  [FABLE_OVERAGE_CONSENT_PROMPT_KIND]: fableOverageRenderer,
  [GOAL_PROPOSAL_KIND]: goalProposalRenderer,
  [AUTO_MODE_SETUP_REVIEW_KIND]: autoModeSetupReviewRenderer,
  [AUTO_MODE_FLAGGED_ALLOW_KIND]: autoModeFlaggedAllowRenderer,
  [PEER_INBOUND_APPROVAL_KIND]: peerInboundRenderer,
  [CHROME_INSTALL_SETUP_KIND]: chromeInstallSetupRenderer,
  [CHROME_INSTALL_UPSELL_KIND]: chromeInstallUpsellRenderer,
};

export const JSU_NON_PERMISSION_KIND_LIST = Object.keys(JSU_NON_PERMISSION_COMPONENTS) as readonly string[];
