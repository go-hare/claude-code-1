/**
 * densable NMs — DialogHost: render top dialog via kind→component registry.
 *
 * layout default "inline"; variant filter matches densable LyN/MyN.
 * answer debounce densable c_y=150 after swap (swappedAt / suppress lift).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@anthropic/ink';
import { ManagedSettingsSecurityDialog } from '../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js';
import { PermissionRequest } from '../components/permissions/PermissionRequest.js';
import { useDialogStore, useTopDialog } from './DialogStoreContext.js';
import { getPermissionConfirm } from './permissionConfirmRegistry.js';
import { usePermissionDialogHost } from './PermissionDialogHostContext.js';
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
import { JSU_NON_PERMISSION_COMPONENTS } from './jsuRenderers.js';
import { PermissionBrowserDialog } from './dialogs/PermissionBrowserDialog.js';
import type { DialogSuppressReason } from './legacyDialogFocus.js';

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
 * densable Iiu — permission_prompt. Tip: PermissionRequest + confirm registry.
 */
function PermissionPromptRenderer({ payload, answer }: DialogRendererProps): React.ReactNode {
  const host = usePermissionDialogHost();
  const store = useDialogStore();
  const requestId =
    typeof payload === 'object' &&
    payload !== null &&
    'requestId' in payload &&
    typeof (payload as { requestId: unknown }).requestId === 'string'
      ? (payload as { requestId: string }).requestId
      : '';
  const confirm = requestId ? getPermissionConfirm(requestId) : undefined;

  useEffect(() => {
    if (host && confirm) return;
    // Missing host/confirm: settle cancelled. Bypass Host answer debounce
    // (c_y) via store.answer — one-shot answer() can be swallowed right after
    // suppress lift / swap and leave a blank top dialog forever.
    const entry = store.getState().open.find(d => {
      if (!requestId) return false;
      const p = d.payload as { requestId?: unknown };
      return p?.requestId === requestId;
    });
    if (entry) {
      store.answer(entry.id, { behavior: 'cancelled' });
    } else {
      answer({ behavior: 'cancelled' });
    }
    if (requestId) host?.dequeue(requestId);
  }, [host, confirm, requestId, store, answer]);

  if (!host || !confirm) return null;

  return (
    <PermissionRequest
      key={confirm.toolUseID}
      toolUseConfirm={confirm}
      toolUseContext={confirm.toolUseContext ?? host.getToolUseContext()}
      verbose={host.verbose}
      workerBadge={confirm.workerBadge}
      setStickyFooter={host.setStickyFooter}
      onDone={() => {
        // densable: accept already claims via confirm.onAllow + dismissAndTeardown.
        // Do NOT answer allow here — FilePermissionDialog reject calls onDone()
        // before onReject; answering allow would settle doo W() as allow.
        host.dequeue(confirm.toolUseID);
      }}
      onReject={() => {
        // densable deny path: pop queued cmds then answer deny for doo W
        host.onReject();
        answer({ behavior: 'deny' });
        host.dequeue(confirm.toolUseID);
      }}
    />
  );
}

/** densable jsu — GSn + permission_* + pealed non-permission arms */
const DIALOG_COMPONENTS: Record<string, DialogRenderer> = {
  [MANAGED_SETTINGS_SECURITY_KIND]: managedSettingsSecurityRenderer,
  [PERMISSION_PROMPT_KIND]: PermissionPromptRenderer,
  [PERMISSION_BASH_KIND]: PermissionPromptRenderer,
  [PERMISSION_FILE_KIND]: PermissionPromptRenderer,
  [PERMISSION_SKILL_KIND]: PermissionPromptRenderer,
  [PERMISSION_POWERSHELL_KIND]: PermissionPromptRenderer,
  [PERMISSION_WEBFETCH_KIND]: PermissionPromptRenderer,
  [PERMISSION_ASK_USER_QUESTION_KIND]: PermissionPromptRenderer,
  [PERMISSION_ENTER_PLAN_MODE_KIND]: PermissionPromptRenderer,
  [PERMISSION_EXIT_PLAN_MODE_V2_KIND]: PermissionPromptRenderer,
  [PERMISSION_BROWSER_KIND]: PermissionBrowserDialog,
  [PERMISSION_MONITOR_KIND]: PermissionPromptRenderer,
  [PERMISSION_WORKFLOW_KIND]: PermissionPromptRenderer,
  ...JSU_NON_PERMISSION_COMPONENTS,
};

/** @internal test — densable jsu registered kinds */
export const DIALOG_COMPONENTS_KINDS_FOR_TEST = Object.keys(DIALOG_COMPONENTS);

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

  // tip bg needs-input when managed-settings is top (old REPL register path)
  useEffect(() => {
    if (suppressReason != null) return;
    if (top?.kind !== MANAGED_SETTINGS_SECURITY_KIND) return;
    void import('../utils/bgNeedsInputBridge.js').then(m => {
      if (!m.isBgJobSession()) return;
      m.ensureBgNeedsPermissionBridge();
      m.emitBgNeedsInput(m.MANAGED_SETTINGS_NEEDS, 'managed-settings');
    });
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

  return (
    <Box flexDirection="column" key={top.id}>
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
