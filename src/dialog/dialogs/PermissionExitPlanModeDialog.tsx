/**
 * densable teu — permission_exit_plan_mode_v2 DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(EQr,teu)`. mLo modal KEEP. Esc/onCancel → deny.
 * Local function is DualInk ExitPlanModePermissionRequest (Lcy options,
 * disk plan via getPlan/getPlanFilePath, Ctrl+G, feedback, images).
 * Do not invent storageV5 / gold tn / credentials / remote publish.
 * Ultraplan stays DualInk FEATURE_ULTRAPLAN. Host answer is store.answer.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { ExitPlanModeV2Tool } from '@claude-code/builtin-tools/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js';
import { ExitPlanModePermissionRequest } from '../../components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js';
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js';
import type { ToolUseContext } from '../../Tool.js';
import type { AssistantMessage } from '../../types/message.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { usePermissionDialogHost } from '../PermissionDialogHostContext.js';
import type { ExitPlanModePermissionPayload } from '../permissionExitPlan.js';

function coercePermissionDecision(raw: unknown): PermissionDecision {
  if (typeof raw === 'object' && raw !== null && 'behavior' in raw) {
    const behavior = (raw as { behavior?: unknown }).behavior;
    if (behavior === 'allow' || behavior === 'deny' || behavior === 'ask') {
      return raw as PermissionDecision;
    }
  }
  return { behavior: 'ask', message: '' };
}

export function PermissionExitPlanModeDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as ExitPlanModePermissionPayload;
  const host = usePermissionDialogHost();
  const answered = useRef(false);
  const finish = useCallback(
    (result: unknown) => {
      if (answered.current) return;
      answered.current = true;
      answer(result);
    },
    [answer],
  );

  const toolUseConfirm = useMemo((): ToolUseConfirm => {
    const input = {
      ...(p.input !== null && typeof p.input === 'object' ? p.input : {}),
      plan: p.plan,
      planFilePath: p.planFilePath,
    };
    return {
      tool: ExitPlanModeV2Tool,
      description: '',
      input,
      toolUseID: p.requestId,
      permissionResult: coercePermissionDecision(p.permissionResult),
      permissionPromptStartTimeMs: 0,
      assistantMessage: {
        message: { usage: p.usage },
      } as AssistantMessage,
      toolUseContext: (host?.getToolUseContext() ?? {}) as ToolUseContext,
      onUserInteraction() {},
      onAbort() {
        finish({ behavior: 'deny' });
      },
      onAllow(updatedInput, permissionUpdates, feedback) {
        finish({
          behavior: 'allow',
          updatedInput,
          permissionUpdates,
          ...(feedback ? { feedback } : {}),
        });
      },
      onReject(feedback) {
        finish({
          behavior: 'deny',
          ...(feedback ? { feedback } : {}),
        });
      },
      async recheckPermission() {},
    };
  }, [p, host, finish]);

  return (
    <ExitPlanModePermissionRequest
      toolUseConfirm={toolUseConfirm}
      toolUseContext={(host?.getToolUseContext() ?? {}) as ToolUseContext}
      onDone={() => {}}
      onReject={() => {}}
      verbose={host?.verbose ?? false}
      workerBadge={undefined}
      setStickyFooter={host?.setStickyFooter}
    />
  );
}
