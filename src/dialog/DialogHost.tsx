/**
 * densable NMs — DialogHost: render top dialog via kind→component registry.
 *
 * layout default "inline"; variant filter matches densable LyN/MyN.
 * answer debounce densable c_y=150 after swap (swappedAt / suppress lift).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, useTerminalNotification } from '@anthropic/ink';
import { ManagedSettingsSecurityDialog } from '../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js';
import { useNotifyAfterTimeout } from '../hooks/useNotifyAfterTimeout.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import { useDialogStore, useTopDialog } from './DialogStoreContext.js';
import { AX_BELL_CLAIM_KEY, claimIfChanged, noteAxBellNow } from './dialogHostBell.js';
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
import type { DialogSuppressReason } from './legacyDialogFocus.js';
import {
  AUTO_MODE_FLAGGED_ALLOW_KIND,
  AUTO_MODE_SETUP_REVIEW_KIND,
  CHROME_INSTALL_SETUP_KIND,
  CHROME_INSTALL_UPSELL_KIND,
  FABLE_OVERAGE_CONSENT_PROMPT_KIND,
  GOAL_PROPOSAL_KIND,
  PEER_INBOUND_APPROVAL_KIND,
  REFUSAL_FALLBACK_PROMPT_KIND,
} from './specs/jsuKinds.js';
import {
  MANAGED_SETTINGS_SECURITY_KIND,
  type ManagedSettingsSecurityPayload,
} from './specs/managedSettingsSecurity.js';
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

/** densable c_y */
export const DIALOG_ANSWER_SWAP_DEBOUNCE_MS = 150;

export type DialogHostVariant = 'inline' | 'modal';

export type DialogRendererProps = {
  payload: unknown;
  answer: (result: unknown) => void;
};

type DialogRenderer = (props: DialogRendererProps) => React.ReactNode;

/** densable mLo — only EQr (exit-plan v2) forces modal; GSn / bEt default inline. */
const DIALOG_LAYOUTS: Record<string, DialogHostVariant> = {
  [PERMISSION_EXIT_PLAN_MODE_V2_KIND]: 'modal',
};

/** @internal test — densable mLo map */
export const DIALOG_LAYOUTS_FOR_TEST = DIALOG_LAYOUTS;

/** densable But */
const CLAUDE_NEEDS_PERMISSION = 'Claude needs your permission';

/**
 * densable Usu — OS notify title per kind. Missing key → no nau child.
 * Not in Usu (gold): GSn / Wxt / Gxt / CHr / FRr / DIi / qSn / _Bi / Gbt.
 * HMs review-artifact is feature-gated in gold; local has no that kind — do not invent.
 */
const DIALOG_NOTIFICATIONS: Record<string, string> = {
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
export const DIALOG_NOTIFICATIONS_FOR_TEST = DIALOG_NOTIFICATIONS;

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
  suppressReason: DialogSuppressReason;
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
 * densable h2A — managed_settings_security → zko
 * densable Host answer goes through c_y debounce (same as permission kinds).
 */
const managedSettingsSecurityRenderer: DialogRenderer = ({ payload, answer }) => {
  const { settings } = payload as ManagedSettingsSecurityPayload;
  return (
    <ManagedSettingsSecurityDialog
      key="managed-settings-security"
      settings={settings}
      onAccept={() => {
        void import('../utils/bgNeedsInputBridge.js').then(m => {
          m.emitBgNeedsInput(null, 'managed-settings');
        });
        answer('approved');
      }}
      onReject={() => {
        void import('../utils/bgNeedsInputBridge.js').then(m => {
          m.emitBgNeedsInput(null, 'managed-settings');
        });
        answer('rejected');
      }}
    />
  );
};

/**
 * densable nau — WRr(message, "permission_prompt") + claimIfChanged("ax-bell")
 * then aAr (screen-reader + lastBellAt 500ms + notifyBell). Returns null.
 * Process-singleton bag (no Ink WeakMap host API).
 */
function DialogHostNotification({ dialogId, message }: { dialogId: string; message: string }): null {
  useNotifyAfterTimeout(message, 'permission_prompt');
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

/** densable jsu — GSn + permission_* + pealed non-permission arms */
const DIALOG_COMPONENTS: Record<string, DialogRenderer> = {
  [MANAGED_SETTINGS_SECURITY_KIND]: managedSettingsSecurityRenderer,
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
   * densable zIr suppress — when set, dQc returns null (dialog stays in store).
   * Tip: pass 'typing' when isPromptInputActive.
   */
  suppressReason?: 'typing' | 'legacy-dialog' | null;
};

/**
 * densable NMs / dQc host.
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
    if (suppressReason != null) {
      void import('../utils/bgNeedsInputBridge.js').then(m => {
        if (cancelled) return;
        if (!m.isBgJobSession()) return;
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
        m.emitBgNeedsInput(label, 'permission');
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

  // tip bg needs-input when managed-settings is top (old REPL register path)
  useEffect(() => {
    if (suppressReason != null) return;
    if (top?.kind !== MANAGED_SETTINGS_SECURITY_KIND) return;
    let cancelled = false;
    void import('../utils/bgNeedsInputBridge.js').then(m => {
      if (cancelled) return;
      if (!m.isBgJobSession()) return;
      m.ensureBgNeedsPermissionBridge();
      m.emitBgNeedsInput(m.MANAGED_SETTINGS_NEEDS, 'managed-settings');
    });
    return () => {
      cancelled = true;
    };
  }, [suppressReason, top?.kind, top?.id]);

  // densable dQc
  if (suppressReason != null || !top) return null;

  const layout = DIALOG_LAYOUTS[top.kind] ?? 'inline';
  if (layout !== variant) return null;

  const Renderer = DIALOG_COMPONENTS[top.kind];
  if (!Renderer) {
    store.dismiss(top.id);
    return null;
  }

  // Live payload from store (updates may change settings)
  const entry = store.getState().open.find(d => d.id === top.id) ?? top;
  const payload = entry.payload;

  const answer = (result: unknown) => {
    const live = store.getState().open.find(d => d.id === top.id);
    if (!live) return;
    const swappedAt = Math.max(live.swappedAt ?? 0, suppressLiftedAt);
    if (Date.now() - swappedAt < DIALOG_ANSWER_SWAP_DEBOUNCE_MS) return;
    store.answer(top.id, result);
  };

  const title = DIALOG_NOTIFICATIONS[top.kind];

  return (
    <Box flexDirection="column" key={top.id}>
      {title !== undefined ? <DialogHostNotification dialogId={top.id} message={title} /> : null}
      <Renderer payload={payload} answer={answer} />
    </Box>
  );
}

/** For focusedInputDialog / waitingFor — densable y2A[GSn]="dialog open" */
export function isManagedSettingsSecurityDialog(kind: string | undefined): boolean {
  return kind === MANAGED_SETTINGS_SECURITY_KIND;
}

export function isPermissionPromptDialog(kind: string | undefined): boolean {
  return isPermissionDialogKind(kind);
}
