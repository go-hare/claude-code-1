/**
 * densable NMs — DialogHost: render top dialog via kind→component registry.
 *
 * layout default "inline"; variant filter matches densable LyN/MyN.
 * answer debounce densable c_y=150 after swap (swappedAt / suppress lift).
 */
import React, { createContext, useEffect, useRef, useState } from 'react';
import { Box, Text, useTerminalNotification } from '@anthropic/ink';
import { useNotifyAfterTimeout } from '../hooks/useNotifyAfterTimeout.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import { useDialogStore, useTopDialog } from './DialogStoreContext.js';
import { AX_BELL_CLAIM_KEY, claimIfChanged, noteAxBellNow } from './dialogHostBell.js';
import { HOST_PARKED_TYPING_QUESTION, HOST_PARKED_TYPING_SUGGESTION, type HostParkMode } from './hostPark.js';
import { PermissionAskUserQuestionDialog } from './dialogs/PermissionAskUserQuestionDialog.js';
import { PermissionBashDialog } from './dialogs/PermissionBashDialog.js';
import { PermissionBrowserDialog } from './dialogs/PermissionBrowserDialog.js';
import { PermissionEnterPlanModeDialog } from './dialogs/PermissionEnterPlanModeDialog.js';
import { PermissionExitPlanModeDialog } from './dialogs/PermissionExitPlanModeDialog.js';
import { PermissionFileDialog } from './dialogs/PermissionFileDialog.js';
import { PermissionMonitorDialog } from './dialogs/PermissionMonitorDialog.js';
import { PermissionPowerShellDialog } from './dialogs/PermissionPowerShellDialog.js';
import { PermissionPromptDialog } from './dialogs/PermissionPromptDialog.js';
import { PermissionSkillDialog } from './dialogs/PermissionSkillDialog.js';
import { PermissionWebFetchDialog } from './dialogs/PermissionWebFetchDialog.js';
import { JSU_NON_PERMISSION_COMPONENTS } from './jsuRenderers.js';
import {
  AUTO_MODE_FLAGGED_ALLOW_KIND,
  AUTO_MODE_SERVER_FALLBACK_KIND,
  AUTO_MODE_SETUP_REVIEW_KIND,
  CHROME_INSTALL_SETUP_KIND,
  CHROME_INSTALL_UPSELL_KIND,
  COMPUTER_USE_APPROVAL_KIND,
  FABLE_OVERAGE_CONSENT_PROMPT_KIND,
  GOAL_PROPOSAL_KIND,
  IT2_SETUP_KIND,
  isSoftNmsDialogKind,
  MCP_ELICITATION_KIND,
  MCP_ELICITATION_WAITING_KIND,
  MCP_URL_ELICITATION_KIND,
  PEER_INBOUND_APPROVAL_KIND,
  REFUSAL_FALLBACK_PROMPT_KIND,
  SANDBOX_NETWORK_ACCESS_KIND,
} from './specs/jsuKinds.js';
import {
  isPermissionDialogKind,
  PERMISSION_ASK_USER_QUESTION_KIND,
  PERMISSION_BASH_KIND,
  PERMISSION_BROWSER_KIND,
  PERMISSION_ENTER_PLAN_MODE_KIND,
  PERMISSION_EXIT_PLAN_MODE_V2_KIND,
  PERMISSION_FILE_KIND,
  PERMISSION_MONITOR_KIND,
  PERMISSION_POWERSHELL_KIND,
  PERMISSION_PROMPT_KIND,
  PERMISSION_SKILL_KIND,
  PERMISSION_WEBFETCH_KIND,
  PERMISSION_WORKFLOW_KIND,
} from './specs/permissionKinds.js';
import { resolveHostWaitingFor } from './permissionWaiting.js';

/** densable OVe — active dialog entry id inside DialogHost. */
export const CurrentDialogIdContext = createContext<string | null>(null);

/** densable c_y */
export const DIALOG_ANSWER_SWAP_DEBOUNCE_MS = 150;

export type DialogHostVariant = 'inline' | 'modal' | 'bottom';

export type DialogRendererProps = {
  payload: unknown;
  answer: (result: unknown) => unknown;
  wouldTakeAnswer?: () => boolean;
};

type DialogRenderer = (props: DialogRendererProps) => React.ReactNode;

/**
 * densable mLo / ig.layout:
 * EQr exit-plan v2 → modal; Gbt $7 / W7 / wne elicitation + m$e
 * classifier billing → bottom (tot.abovePrompt vh); GSn / bEt default inline (bJ).
 */
const DIALOG_LAYOUTS: Record<string, DialogHostVariant> = {
  [PERMISSION_EXIT_PLAN_MODE_V2_KIND]: 'modal',
  [MCP_URL_ELICITATION_KIND]: 'bottom',
  [MCP_ELICITATION_KIND]: 'bottom',
  [MCP_ELICITATION_WAITING_KIND]: 'bottom',
  [AUTO_MODE_SERVER_FALLBACK_KIND]: 'bottom',
};

/** @internal test — densable mLo map */
export const DIALOG_LAYOUTS_FOR_TEST = DIALOG_LAYOUTS;

/** densable But / uy */
const CLAUDE_NEEDS_PERMISSION = 'Claude needs your permission';
/** densable c8e */
const CLAUDE_NEEDS_INPUT = 'Claude Code needs your input';

export type DialogNotificationType =
  | 'permission_prompt'
  | 'agent_needs_input'
  | 'elicitation_dialog'
  | 'elicitation_url_dialog';

export type DialogNotificationSpec = {
  text: string;
  type?: DialogNotificationType;
};

type DialogNotificationEntry = DialogNotificationSpec | ((payload: unknown) => DialogNotificationSpec | undefined);

/** densable dso — W7 URL mode check for notification type. */
function isMcpElicitationUrlMode(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  if (!('serverName' in payload) || !('params' in payload)) return false;
  const params = (payload as { params?: unknown }).params;
  return typeof params === 'object' && params !== null && (params as { mode?: unknown }).mode === 'url';
}

/** densable cso — wne notifies only when waitingState is omitted. */
function isMcpWaitingWithoutCustomState(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  if (!('serverName' in payload) || !('params' in payload)) return false;
  return (payload as { waitingState?: unknown }).waitingState === undefined;
}

/**
 * densable Usu — 2.1.239 OS notify title per kind (locked for .239/.246 tests).
 * Not in Usu (gold): GSn / Wxt / Gxt / CHr / FRr / DIi / qSn / _Bi / Gbt.
 * HMs review-artifact is feature-gated in gold; local has no that kind — do not invent.
 */
const USU_NOTIFICATIONS: Record<string, string> = {
  [PERMISSION_PROMPT_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_WEBFETCH_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_SKILL_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_POWERSHELL_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_FILE_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_ASK_USER_QUESTION_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_ENTER_PLAN_MODE_KIND]: 'Claude Code wants to enter plan mode',
  [PERMISSION_EXIT_PLAN_MODE_V2_KIND]: 'Claude Code needs your approval for the plan',
  [PERMISSION_MONITOR_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_BASH_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_BROWSER_KIND]: CLAUDE_NEEDS_PERMISSION,
  [PERMISSION_WORKFLOW_KIND]: CLAUDE_NEEDS_PERMISSION,
  [REFUSAL_FALLBACK_PROMPT_KIND]: 'Session paused',
  [FABLE_OVERAGE_CONSENT_PROMPT_KIND]: 'Session paused',
  [PEER_INBOUND_APPROVAL_KIND]: 'A message from another session needs your approval',
  [CHROME_INSTALL_UPSELL_KIND]: 'Claude wants to use your browser',
  [CHROME_INSTALL_SETUP_KIND]: 'Setting up Claude in Chrome',
  [AUTO_MODE_SETUP_REVIEW_KIND]: 'Auto-mode setup proposal is ready for review',
  [AUTO_MODE_FLAGGED_ALLOW_KIND]: 'Auto-mode setup flagged some permission rules for review',
  [GOAL_PROPOSAL_KIND]: 'Claude proposed a session goal',
};

/** @internal test — densable Usu map */
export const DIALOG_NOTIFICATIONS_FOR_TEST = USU_NOTIFICATIONS;

/**
 * densable 2.1.289 `ig` notification table — adds the 7 kinds + per-kind `type`.
 */
const DIALOG_NOTIFICATIONS: Record<string, DialogNotificationEntry> = {
  [IT2_SETUP_KIND]: {
    text: 'Teammate setup needs your input',
    type: 'agent_needs_input',
  },
  [COMPUTER_USE_APPROVAL_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [AUTO_MODE_SERVER_FALLBACK_KIND]: {
    text: 'Auto mode has a classifier billing notice to acknowledge',
    type: 'agent_needs_input',
  },
  [SANDBOX_NETWORK_ACCESS_KIND]: {
    text: 'A sandboxed command needs network access',
  },
  [MCP_ELICITATION_KIND]: payload => ({
    text: CLAUDE_NEEDS_INPUT,
    type: isMcpElicitationUrlMode(payload) ? 'elicitation_url_dialog' : 'elicitation_dialog',
  }),
  [MCP_ELICITATION_WAITING_KIND]: payload =>
    isMcpWaitingWithoutCustomState(payload) ? { text: CLAUDE_NEEDS_INPUT, type: 'elicitation_url_dialog' } : undefined,
  [MCP_URL_ELICITATION_KIND]: {
    text: 'An MCP server needs your input',
    type: 'elicitation_url_dialog',
  },
  [PERMISSION_PROMPT_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_WEBFETCH_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_SKILL_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_POWERSHELL_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_FILE_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_ASK_USER_QUESTION_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_ENTER_PLAN_MODE_KIND]: { text: 'Claude Code wants to enter plan mode' },
  [PERMISSION_EXIT_PLAN_MODE_V2_KIND]: {
    text: 'Claude Code needs your approval for the plan',
  },
  [PERMISSION_MONITOR_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_BASH_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_BROWSER_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [PERMISSION_WORKFLOW_KIND]: { text: CLAUDE_NEEDS_PERMISSION },
  [REFUSAL_FALLBACK_PROMPT_KIND]: { text: 'Session paused' },
  [FABLE_OVERAGE_CONSENT_PROMPT_KIND]: { text: 'Session paused' },
  [PEER_INBOUND_APPROVAL_KIND]: {
    text: 'A message from another session needs your approval',
  },
  [CHROME_INSTALL_UPSELL_KIND]: { text: 'Claude wants to use your browser' },
  [CHROME_INSTALL_SETUP_KIND]: { text: 'Setting up Claude in Chrome' },
  [AUTO_MODE_SETUP_REVIEW_KIND]: {
    text: 'Auto-mode setup proposal is ready for review',
  },
  [AUTO_MODE_FLAGGED_ALLOW_KIND]: {
    text: 'Auto-mode setup flagged some permission rules for review',
  },
  [GOAL_PROPOSAL_KIND]: { text: 'Claude proposed a session goal' },
};

/** densable oP — resolve notification spec for a dialog kind and payload. */
export function resolveDialogNotification(
  kind: string | undefined,
  payload?: unknown,
): DialogNotificationSpec | undefined {
  if (!kind) return undefined;
  const entry = DIALOG_NOTIFICATIONS[kind];
  return typeof entry === 'function' ? entry(payload) : entry;
}

/** densable aM — suggestion-tier engine dialogs use the "suggestion" draft cue. */
function isSuggestionDialogKind(kind: string): boolean {
  return (
    isSoftNmsDialogKind(kind) ||
    kind === GOAL_PROPOSAL_KIND ||
    kind === 'lsp_recommendation' ||
    kind === 'plugin_hint' ||
    kind === 'left_arrow_confirm' ||
    kind === 'remote_callout' ||
    kind === 'fullscreen_upsell'
  );
}

/** densable Bsu — mLo lookup, default inline. */
export function getDialogHostLayout(kind: string | undefined): DialogHostVariant {
  if (!kind) return 'inline';
  return DIALOG_LAYOUTS[kind] ?? 'inline';
}

/** densable KA = Bsu()==="modal" */
export function isTopDialogModalLayout(kind: string | undefined): boolean {
  return getDialogHostLayout(kind) === 'modal';
}

export type ModalChromeVisibility = 'none' | 'suppressed' | 'visible';

/** densable RPs — !KUe() ? none : zIr()!=null ? suppressed : visible */
export function getModalChromeVisibility(opts: {
  hasOpenDialogs: boolean;
  suppressReason: HostParkMode;
}): ModalChromeVisibility {
  if (!opts.hasOpenDialogs) return 'none';
  if (opts.suppressReason != null) return 'suppressed';
  return 'visible';
}

/** densable ozs occupy: KA || PCn (local-jsx centered). */
export function shouldOccupyFullscreenModalSlot(opts: { toolJsxCentered?: boolean; topDialogKind?: string }): boolean {
  return opts.toolJsxCentered === true || isTopDialogModalLayout(opts.topDialogKind);
}

/**
 * densable kZt — `KA && wi==="visible" || PCn!=null`.
 * Gates placeholder / scroll onScroll / scrollRef swap — NOT bare KA||PCn.
 * When typing suppresses RPs, KA alone must not keep chrome-active gates.
 */
export function isFullscreenModalChromeActive(opts: {
  toolJsxCentered?: boolean;
  topDialogKind?: string;
  modalChrome: ModalChromeVisibility;
}): boolean {
  const kaVisible = isTopDialogModalLayout(opts.topDialogKind) && opts.modalChrome === 'visible';
  return kaVisible || opts.toolJsxCentered === true;
}
/**
 * densable nau / VH — default is useNotifyAfterTimeout(message, 'permission_prompt') + claimIfChanged("ax-bell")
 * then aAr (screen-reader + lastBellAt 500ms + notifyBell). Returns null.
 * Process-singleton bag (no Ink WeakMap host API).
 */
function DialogHostNotification({
  dialogId,
  message,
  notificationType = 'permission_prompt',
}: {
  dialogId: string;
  message: string;
  notificationType?: DialogNotificationType;
}): null {
  useNotifyAfterTimeout(message, notificationType);
  const terminal = useTerminalNotification();
  const screenReader = isScreenReaderModeEnabled();
  useEffect(() => {
    if (!claimIfChanged(AX_BELL_CLAIM_KEY, dialogId)) return;
    if (!screenReader) return;
    if (!noteAxBellNow()) return;
    terminal.notifyBell();
  }, [dialogId, screenReader, terminal]);
  return null;
}

/** densable jsu — permission_* + pealed non-permission arms */
const DIALOG_COMPONENTS: Record<string, DialogRenderer> = {
  [PERMISSION_PROMPT_KIND]: PermissionPromptDialog,
  [PERMISSION_BASH_KIND]: PermissionBashDialog,
  [PERMISSION_FILE_KIND]: PermissionFileDialog,
  [PERMISSION_SKILL_KIND]: PermissionSkillDialog,
  [PERMISSION_POWERSHELL_KIND]: PermissionPowerShellDialog,
  [PERMISSION_WEBFETCH_KIND]: PermissionWebFetchDialog,
  [PERMISSION_ASK_USER_QUESTION_KIND]: PermissionAskUserQuestionDialog,
  [PERMISSION_ENTER_PLAN_MODE_KIND]: PermissionEnterPlanModeDialog,
  [PERMISSION_EXIT_PLAN_MODE_V2_KIND]: PermissionExitPlanModeDialog,
  [PERMISSION_BROWSER_KIND]: PermissionBrowserDialog,
  [PERMISSION_MONITOR_KIND]: PermissionMonitorDialog,
  [PERMISSION_WORKFLOW_KIND]: PermissionPromptDialog,
  ...JSU_NON_PERMISSION_COMPONENTS,
};

/** @internal test — densable jsu registered kinds */
export const DIALOG_COMPONENTS_KINDS_FOR_TEST = Object.keys(DIALOG_COMPONENTS);

/** @internal test — densable jsu renderer identity */
export const DIALOG_COMPONENTS_FOR_TEST = DIALOG_COMPONENTS;

type Props = {
  variant?: DialogHostVariant;
  /**
   * densable zIr / Rf suppress — when set, Host withholds the dialog renderer.
   * When `'draft'` suppresses an engine dialog matching `variant`, paints the draft cue.
   */
  suppressReason?: HostParkMode;
};

/**
 * densable yv / NMs / dQc host.
 */
export function DialogHost({ variant = 'inline', suppressReason = null }: Props): React.ReactNode {
  const store = useDialogStore();
  const top = useTopDialog();
  const [suppressLiftedAt, setSuppressLiftedAt] = useState(0);
  const wasSuppressed = useRef(suppressReason != null);

  // densable rau — stamp time when suppress lifts (legacy→visible)
  useEffect(() => {
    const now = suppressReason != null;
    if (wasSuppressed.current && !now) {
      setSuppressLiftedAt(Date.now());
    }
    wasSuppressed.current = now;
  }, [suppressReason]);

  // densable P1u / msf permission needs — Host top owns emit (not tip queue).
  useEffect(() => {
    let cancelled = false;
    const permissionToolUseID =
      top?.payload &&
      typeof top.payload === 'object' &&
      'requestId' in top.payload &&
      typeof (top.payload as { requestId?: unknown }).requestId === 'string'
        ? (top.payload as { requestId: string }).requestId
        : undefined;
    if (suppressReason != null) {
      void import('../utils/bgNeedsInputBridge.js').then(m => {
        if (cancelled) return;
        if (!m.isBgJobSession()) return;
        if (permissionToolUseID) m.clearHookFailure(permissionToolUseID);
        m.emitBgNeedsInput(null, 'permission');
        m.emitBgNeedsFromDialogKind(null);
      });
      return () => {
        cancelled = true;
      };
    }
    void import('../utils/bgNeedsInputBridge.js').then(m => {
      if (cancelled) return;
      if (!m.isBgJobSession()) return;
      m.ensureBgNeedsPermissionBridge();
      const label = resolveHostWaitingFor(top?.kind, top?.payload);
      if (label && isPermissionDialogKind(top?.kind)) {
        m.emitBgNeedsInput(label, 'permission', permissionToolUseID ? { toolUseID: permissionToolUseID } : undefined);
        m.emitBgNeedsFromDialogKind(null);
        return;
      }
      m.emitBgNeedsInput(null, 'permission');
      // densable UIb dialog slot — keys in DIALOG_NEEDS_BY_KIND only
      // (refusal / fable / mcp_url / cost / resume / auto_default / ide).
      // goal_proposal is Host waitingFor / Usu notify, not UIb (gold table has no Dot).
      m.emitBgNeedsFromDialogKind(top?.kind);
    });
    return () => {
      cancelled = true;
    };
  }, [suppressReason, top?.kind, top?.id, top?.payload]);

  // densable Xye / yv draft suppression cue
  if (suppressReason != null) {
    if (suppressReason === 'draft') {
      const openList = store.getState().open;
      const hiddenEngine =
        top && top.userInvoked !== true
          ? top
          : (openList.findLast(d => d.userInvoked !== true && !isSuggestionDialogKind(d.kind)) ??
            openList.findLast(d => d.userInvoked !== true) ??
            null);
      if (hiddenEngine && (DIALOG_LAYOUTS[hiddenEngine.kind] ?? 'inline') === variant) {
        const hiddenNotification = resolveDialogNotification(hiddenEngine.kind, hiddenEngine.payload);
        const cueText = isSuggestionDialogKind(hiddenEngine.kind)
          ? HOST_PARKED_TYPING_SUGGESTION
          : HOST_PARKED_TYPING_QUESTION;
        return (
          <CurrentDialogIdContext.Provider value={hiddenEngine.id} key={hiddenEngine.id}>
            {hiddenNotification !== undefined ? (
              <DialogHostNotification
                dialogId={hiddenEngine.id}
                message={hiddenNotification.text}
                notificationType={hiddenNotification.type}
              />
            ) : null}
            <Text dimColor>{cueText}</Text>
          </CurrentDialogIdContext.Provider>
        );
      }
    }
    return null;
  }

  if (!top) return null;

  const layout = DIALOG_LAYOUTS[top.kind] ?? 'inline';
  if (layout !== variant) return null;

  const Renderer = DIALOG_COMPONENTS[top.kind];
  if (!Renderer) {
    store.dismiss(top.id);
    return null;
  }

  // Live payload from store (updates may change settings)
  const current = store.getState().open.find(d => d.id === top.id) ?? top;
  const payload = current.payload;

  const wouldTakeAnswer = (): boolean => {
    const entry = store.getState().open.find(d => d.id === top.id);
    if (!entry) return false;
    if (!(entry.payload === current.payload)) return false;
    const swappedAt = Math.max(entry.swappedAt ?? 0, entry.userInvoked ? 0 : suppressLiftedAt);
    return Date.now() - swappedAt >= DIALOG_ANSWER_SWAP_DEBOUNCE_MS;
  };

  const answer = (result: unknown): boolean => {
    if (!wouldTakeAnswer()) return false;
    store.answer(top.id, result);
    return true;
  };

  const notification = resolveDialogNotification(top.kind, payload);

  return (
    <CurrentDialogIdContext.Provider value={top.id} key={top.id}>
      <Box flexDirection="column">
        {notification !== undefined ? (
          <DialogHostNotification dialogId={top.id} message={notification.text} notificationType={notification.type} />
        ) : null}
        <Renderer payload={payload} answer={answer} wouldTakeAnswer={wouldTakeAnswer} />
      </Box>
    </CurrentDialogIdContext.Provider>
  );
}

export function isPermissionPromptDialog(kind: string | undefined): boolean {
  return isPermissionDialogKind(kind);
}
