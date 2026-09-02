/**
 * densable nau / Usu / Ynu / csu (239 SEA).
 *
 * Gold: NMs children [nau, Renderer] when Usu[kind] is set; jsu
 * vM(xno,Ynu) / vM(Uno,csu). rhy cancel → deny; Ryy cancel → cancelled.
 * Hyy has no behavior==="ask" gate. Iyy addRules domain:hostname
 * destination localSettings. Do not render DialogHost.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { EnterPlanModeTool } from '@claude-code/builtin-tools/tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { WebFetchTool } from '@claude-code/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import {
  DIALOG_COMPONENTS_FOR_TEST,
  DIALOG_LAYOUTS_FOR_TEST,
  DIALOG_NOTIFICATIONS_FOR_TEST,
} from '../DialogHost.js'
import { PermissionAskUserQuestionDialog } from '../dialogs/PermissionAskUserQuestionDialog.js'
import { PermissionBashDialog } from '../dialogs/PermissionBashDialog.js'
import { PermissionBrowserDialog } from '../dialogs/PermissionBrowserDialog.js'
import { PermissionEnterPlanModeDialog } from '../dialogs/PermissionEnterPlanModeDialog.js'
import { PermissionExitPlanModeDialog } from '../dialogs/PermissionExitPlanModeDialog.js'
import { PermissionFileDialog } from '../dialogs/PermissionFileDialog.js'
import { PermissionMonitorDialog } from '../dialogs/PermissionMonitorDialog.js'
import { PermissionPowerShellDialog } from '../dialogs/PermissionPowerShellDialog.js'
import { PermissionPromptDialog } from '../dialogs/PermissionPromptDialog.js'
import { PermissionSkillDialog } from '../dialogs/PermissionSkillDialog.js'
import { PermissionWebFetchDialog } from '../dialogs/PermissionWebFetchDialog.js'
import {
  AX_BELL_CLAIM_KEY,
  AX_BELL_THROTTLE_MS,
  claimIfChanged,
  noteAxBellNow,
  resetAxBellBagForTest,
} from '../dialogHostBell.js'
import {
  ENTER_PLAN_MODE_CONFIRM_LABEL,
  mintEnterPlanModeRow,
  resolveEnterPlanModeAnswer,
} from '../permissionEnterPlanMode.js'
import {
  buildWebFetchDomainAllowRow,
  resolveWebFetchPermissionAnswer,
  shouldShowWebFetchDomainAllow,
  type WebFetchPermissionPayload,
} from '../permissionWebFetch.js'
import { selectPermissionDialogFwl } from '../selectPermissionDialog.js'
import {
  AUTO_DEFAULT_NUDGE_KIND,
  AUTO_MODE_FLAGGED_ALLOW_KIND,
  AUTO_MODE_SETUP_REVIEW_KIND,
  CHROME_INSTALL_SETUP_KIND,
  CHROME_INSTALL_UPSELL_KIND,
  COMPUTER_USE_APPROVAL_KIND,
  COST_THRESHOLD_KIND,
  FABLE_OVERAGE_CONSENT_PROMPT_KIND,
  GOAL_PROPOSAL_KIND,
  IDE_ONBOARDING_KIND,
  IT2_SETUP_KIND,
  MCP_URL_ELICITATION_KIND,
  PEER_INBOUND_APPROVAL_KIND,
  REFUSAL_FALLBACK_PROMPT_KIND,
  RESUME_RETURN_KIND,
  SANDBOX_NETWORK_ACCESS_KIND,
} from '../specs/jsuKinds.js'
import { MANAGED_SETTINGS_SECURITY_KIND } from '../specs/managedSettingsSecurity.js'
import {
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
} from '../specs/permissionKinds.js'

const root = join(import.meta.dir, '../../..')

function confirm(
  tool: { name: string },
  input: Record<string, unknown> = {},
): ToolUseConfirm {
  return {
    toolUseID: 'tu',
    tool,
    input,
    description: 'd',
    permissionResult: { behavior: 'ask' },
    assistantMessage: { message: { id: 'm1' } },
    toolUseContext: {},
  } as unknown as ToolUseConfirm
}

const fetchPayload = (
  extra: Partial<WebFetchPermissionPayload> = {},
): WebFetchPermissionPayload => ({
  requestId: 'r',
  toolName: 'WebFetch',
  permissionResult: { behavior: 'ask' },
  hostname: 'example.com',
  input: { url: 'https://example.com/x', prompt: 'p' },
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
  ...extra,
})

describe('Usu (DIALOG_NOTIFICATIONS)', () => {
  test('But + special titles; GSn/cost/resume/ide/sandbox/DIi/qSn/_Bi/elicitation absent', () => {
    const But = 'Claude needs your permission'
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_PROMPT_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_WEBFETCH_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_SKILL_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_POWERSHELL_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_FILE_KIND]).toBe(But)
    expect(
      DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_ASK_USER_QUESTION_KIND],
    ).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_MONITOR_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_BASH_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_BROWSER_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_WORKFLOW_KIND]).toBe(But)
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_ENTER_PLAN_MODE_KIND]).toBe(
      'Claude Code wants to enter plan mode',
    )
    expect(
      DIALOG_NOTIFICATIONS_FOR_TEST[PERMISSION_EXIT_PLAN_MODE_V2_KIND],
    ).toBe('Claude Code needs your approval for the plan')
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[REFUSAL_FALLBACK_PROMPT_KIND]).toBe(
      'Session paused',
    )
    expect(
      DIALOG_NOTIFICATIONS_FOR_TEST[FABLE_OVERAGE_CONSENT_PROMPT_KIND],
    ).toBe('Session paused')
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[PEER_INBOUND_APPROVAL_KIND]).toBe(
      'A message from another session needs your approval',
    )
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[CHROME_INSTALL_UPSELL_KIND]).toBe(
      'Claude wants to use your browser',
    )
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[CHROME_INSTALL_SETUP_KIND]).toBe(
      'Setting up Claude in Chrome',
    )
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[AUTO_MODE_SETUP_REVIEW_KIND]).toBe(
      'Auto-mode setup proposal is ready for review',
    )
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[AUTO_MODE_FLAGGED_ALLOW_KIND]).toBe(
      'Auto-mode setup flagged some permission rules for review',
    )
    expect(DIALOG_NOTIFICATIONS_FOR_TEST[GOAL_PROPOSAL_KIND]).toBe(
      'Claude proposed a session goal',
    )

    for (const kind of [
      MANAGED_SETTINGS_SECURITY_KIND,
      COST_THRESHOLD_KIND,
      RESUME_RETURN_KIND,
      IDE_ONBOARDING_KIND,
      SANDBOX_NETWORK_ACCESS_KIND,
      COMPUTER_USE_APPROVAL_KIND,
      AUTO_DEFAULT_NUDGE_KIND,
      IT2_SETUP_KIND,
      MCP_URL_ELICITATION_KIND,
    ]) {
      expect(DIALOG_NOTIFICATIONS_FOR_TEST[kind]).toBeUndefined()
    }
  })
})

describe('jsu Ynu / csu / Hnu / Iiu / Jiu / Wou / DualInk split', () => {
  test('each gold permission kind has an independent Host renderer', () => {
    const iiu = DIALOG_COMPONENTS_FOR_TEST[PERMISSION_PROMPT_KIND]
    expect(iiu).toBe(PermissionPromptDialog)
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_WORKFLOW_KIND]).toBe(
      PermissionPromptDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_ENTER_PLAN_MODE_KIND]).toBe(
      PermissionEnterPlanModeDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_WEBFETCH_KIND]).toBe(
      PermissionWebFetchDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_BROWSER_KIND]).toBe(
      PermissionBrowserDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_SKILL_KIND]).toBe(
      PermissionSkillDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_MONITOR_KIND]).toBe(
      PermissionMonitorDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_BASH_KIND]).toBe(
      PermissionBashDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_FILE_KIND]).toBe(
      PermissionFileDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_POWERSHELL_KIND]).toBe(
      PermissionPowerShellDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_ASK_USER_QUESTION_KIND]).toBe(
      PermissionAskUserQuestionDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_EXIT_PLAN_MODE_V2_KIND]).toBe(
      PermissionExitPlanModeDialog,
    )
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_BASH_KIND]).not.toBe(iiu)
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_SKILL_KIND]).not.toBe(iiu)
    expect(DIALOG_COMPONENTS_FOR_TEST[PERMISSION_MONITOR_KIND]).not.toBe(iiu)
  })
})

describe('rhy (Ynu mailbox)', () => {
  test('yes + row → allow + empty updatedInput + setMode session', () => {
    const row = mintEnterPlanModeRow()
    expect(row.label).toBe(ENTER_PLAN_MODE_CONFIRM_LABEL)
    expect(resolveEnterPlanModeAnswer('yes', row)).toEqual({
      behavior: 'allow',
      updatedInput: {},
      permissionUpdates: [
        { type: 'setMode', mode: 'plan', destination: 'session' },
      ],
    })
  })

  test('yes + null/invalid → deny; no → deny', () => {
    expect(resolveEnterPlanModeAnswer('yes', null)).toEqual({
      behavior: 'deny',
    })
    expect(
      resolveEnterPlanModeAnswer('yes', { label: 'x', applies: [] }),
    ).toEqual({ behavior: 'deny' })
    expect(resolveEnterPlanModeAnswer('no', mintEnterPlanModeRow())).toEqual({
      behavior: 'deny',
    })
  })
})

describe('Ryy / Hyy / Iyy (csu mailbox)', () => {
  test('yes allow; domain+valid permissionUpdates; domain+invalid degrades; no deny', () => {
    const payload = fetchPayload()
    const row = buildWebFetchDomainAllowRow(payload)
    expect(resolveWebFetchPermissionAnswer('yes', payload, row)).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(
      resolveWebFetchPermissionAnswer(
        'yes-dont-ask-again-domain',
        payload,
        row,
      ),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: row!.applies,
    })
    expect(
      resolveWebFetchPermissionAnswer(
        'yes-dont-ask-again-domain',
        payload,
        null,
      ),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(resolveWebFetchPermissionAnswer('no', payload, row)).toEqual({
      behavior: 'deny',
    })
  })

  test('Hyy: no behavior===ask gate; safetyCheck / org cap / empty / wildcard hide', () => {
    expect(shouldShowWebFetchDomainAllow(fetchPayload())).toBe(true)
    expect(
      shouldShowWebFetchDomainAllow(
        fetchPayload({ permissionResult: { behavior: 'deny' } }),
      ),
    ).toBe(true)
    expect(
      shouldShowWebFetchDomainAllow(
        fetchPayload({
          permissionResult: {
            decisionReason: {
              type: 'safetyCheck',
              classifierApprovable: false,
            },
          },
        }),
      ),
    ).toBe(false)
    expect(
      shouldShowWebFetchDomainAllow(
        fetchPayload({
          permissionResult: {
            decisionReason: {
              type: 'safetyCheck',
              classifierApprovable: true,
            },
          },
        }),
      ),
    ).toBe(true)
    expect(
      shouldShowWebFetchDomainAllow(fetchPayload({ isAskCappedByOrg: true })),
    ).toBe(false)
    expect(shouldShowWebFetchDomainAllow(fetchPayload({ hostname: '' }))).toBe(
      false,
    )
    expect(
      shouldShowWebFetchDomainAllow(
        fetchPayload({ hostname: '*.example.com' }),
      ),
    ).toBe(false)
    expect(
      shouldShowWebFetchDomainAllow(fetchPayload({ showAlwaysAllow: false })),
    ).toBe(false)
  })

  test('Iyy addRules domain:hostname destination localSettings', () => {
    const row = buildWebFetchDomainAllowRow(fetchPayload())
    expect(row?.display).toBe('example.com')
    expect(row?.applies).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'WebFetch', ruleContent: 'domain:example.com' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
  })
})

describe('Fwl descriptors', () => {
  test('WebFetch Sum extras: showAlwaysAllow / isAskCappedByOrg / requestSource', () => {
    const fwl = selectPermissionDialogFwl(
      confirm(WebFetchTool, { url: 'https://example.com/x' }),
    )
    expect(fwl?.spec.kind).toBe(PERMISSION_WEBFETCH_KIND)
    expect(fwl?.descriptor).toMatchObject({
      hostname: 'example.com',
      isAskCappedByOrg: false,
    })
    expect(typeof fwl?.descriptor.showAlwaysAllow).toBe('boolean')
    expect('requestSource' in (fwl?.descriptor ?? {})).toBe(true)
  })

  test('EnterPlanMode Fwl carries requestSource', () => {
    const fwl = selectPermissionDialogFwl(confirm(EnterPlanModeTool, {}))
    expect(fwl?.spec.kind).toBe(PERMISSION_ENTER_PLAN_MODE_KIND)
    expect('requestSource' in (fwl?.descriptor ?? {})).toBe(true)
  })
})

describe('nau bag (claimIfChanged / lastBellAt)', () => {
  test('first-win until value changes; throttle does not bump lastBellAt', () => {
    resetAxBellBagForTest()
    expect(claimIfChanged(AX_BELL_CLAIM_KEY, 'd1')).toBe(true)
    expect(claimIfChanged(AX_BELL_CLAIM_KEY, 'd1')).toBe(false)
    expect(claimIfChanged(AX_BELL_CLAIM_KEY, 'd2')).toBe(true)

    const t0 = 1_000
    expect(noteAxBellNow(t0)).toBe(true)
    expect(noteAxBellNow(t0 + AX_BELL_THROTTLE_MS - 1)).toBe(false)
    expect(noteAxBellNow(t0 + AX_BELL_THROTTLE_MS)).toBe(true)
  })
})

describe('source-lock Ynu / csu / nau / Iiu notify', () => {
  test('Ynu: tengu only entryMethod tool; cancel → no → deny; no dequeue', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionEnterPlanModeDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("entryMethod: 'tool'")
    expect(src).not.toContain('interviewPhaseEnabled')
    expect(src).toContain("onCancel={() => handleChoice('no')}")
    expect(src).toContain('ENTER_PLAN_MODE_CONFIRM_LABEL')
    expect(src).toContain('ENTER_PLAN_MODE_CANCEL_LABEL')
    expect(src).toContain('handlePlanModeTransition')
    expect(src).not.toContain('dequeue(')
  })

  test('csu: onCancel cancelled; Fetch title; no dequeue; no dh invent', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionWebFetchDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'cancelled' })")
    expect(src).toContain('title="Fetch"')
    expect(src).toContain('Do you want to allow Claude to fetch this content?')
    expect(src).not.toContain('dequeue(')
    expect(src).not.toContain('WebFetchPermissionRequest')
  })

  test('NMs children [nau, Renderer]; PermissionRequest no WRr', () => {
    const host = readFileSync(join(root, 'src/dialog/DialogHost.tsx'), 'utf8')
    expect(host).toContain('DialogHostNotification')
    expect(host).toContain(
      "useNotifyAfterTimeout(message, 'permission_prompt')",
    )
    expect(host).toContain('claimIfChanged(AX_BELL_CLAIM_KEY, dialogId)')
    expect(host).toContain('noteAxBellNow()')
    expect(host).toContain(
      '[PERMISSION_ENTER_PLAN_MODE_KIND]: PermissionEnterPlanModeDialog',
    )
    expect(host).toContain(
      '[PERMISSION_WEBFETCH_KIND]: PermissionWebFetchDialog',
    )
    expect(host).toContain('[PERMISSION_PROMPT_KIND]: PermissionPromptDialog')
    expect(host).toContain('[PERMISSION_SKILL_KIND]: PermissionSkillDialog')
    expect(host).toContain('[PERMISSION_MONITOR_KIND]: PermissionMonitorDialog')
    expect(host).toContain('[PERMISSION_BASH_KIND]: PermissionBashDialog')
    expect(host).toContain('[PERMISSION_FILE_KIND]: PermissionFileDialog')
    expect(host).toContain(
      '[PERMISSION_POWERSHELL_KIND]: PermissionPowerShellDialog',
    )
    expect(host).toContain(
      '[PERMISSION_ASK_USER_QUESTION_KIND]: PermissionAskUserQuestionDialog',
    )
    expect(host).toContain(
      '[PERMISSION_EXIT_PLAN_MODE_V2_KIND]: PermissionExitPlanModeDialog',
    )
    expect(host).toContain('[PERMISSION_WORKFLOW_KIND]: PermissionPromptDialog')
    expect(host).not.toContain('PermissionPromptRenderer')
    expect(host).not.toContain('dequeue(')
    expect(DIALOG_LAYOUTS_FOR_TEST).toEqual({
      [PERMISSION_EXIT_PLAN_MODE_V2_KIND]: 'modal',
    })

    const perm = readFileSync(
      join(root, 'src/components/permissions/PermissionRequest.tsx'),
      'utf8',
    )
    expect(perm).not.toContain('useNotifyAfterTimeout')
    expect(perm).not.toContain('getNotificationMessage')

    const elicitation = readFileSync(
      join(root, 'src/components/mcp/ElicitationDialog.tsx'),
      'utf8',
    )
    expect(elicitation).toContain('useNotifyAfterTimeout')
  })

  test('Jiu: onCancel deny; skill title; no dequeue', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionSkillDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'deny' })")
    expect(src).toContain('Use this skill?')
    expect(src).toContain('Use skill "')
    expect(src).toContain(
      'Claude may use instructions, code, or files from this Skill.',
    )
    expect(src).toContain('yes-exact')
    expect(src).toContain('yes-prefix')
    expect(src).not.toContain('dequeue(')
  })

  test('Wou: onCancel deny; Monitor title; no dequeue; no yes-dont-ask-again', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionMonitorDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'deny' })")
    expect(src).toContain('title="Monitor"')
    expect(src).toContain('Poll ')
    expect(src).toContain('Open WebSocket')
    expect(src).toContain('yes-apply-suggestions')
    expect(src).not.toContain("'yes-dont-ask-again'")
    expect(src).not.toContain('dequeue(')
  })

  test('Iiu: onCancel cancelled; Tool use title; no dequeue; m0n workflow auto-mode', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionPromptDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'cancelled' })")
    expect(src).toContain('title="Tool use"')
    expect(src).toContain('yes-dont-ask-again')
    expect(src).toContain('yes-enable-auto-mode')
    expect(src).toContain('useWorkflowAutoModeOffer')
    expect(src).not.toContain('dequeue(')
  })

  test('Cmy: onCancel deny; Bash command title; no dequeue; m0n workflow auto-mode; no DualInk wrap', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionBashDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'deny' })")
    expect(src).toContain('bashCommandTitle')
    expect(src).toContain('yes-apply-suggestions')
    expect(src).toContain('yes-prefix-edited')
    expect(src).toContain('editablePrefixSeed')
    expect(src).toContain('sanitizeEditablePrefix')
    expect(src).toContain('} *')
    expect(src).toContain('BASH_PREFIX_PLACEHOLDER')
    expect(src).toContain('Do you want to proceed?')
    expect(
      readFileSync(join(root, 'src/dialog/permissionBash.ts'), 'utf8'),
    ).toContain('command prefix (e.g., npm run *)')
    expect(src).toContain('usePermissionExplainerUI')
    expect(src).toContain('explainerState.chord')
    expect(src).toContain('getDestructiveCommandWarning')
    expect(src).toContain('yes-enable-auto-mode')
    expect(src).toContain('useWorkflowAutoModeOffer')
    expect(src).toContain('hostChrome')
    expect(src).toContain('onAmendHintChange')
    expect(src).toContain('action="amend"')
    expect(src).not.toContain('PermissionDualInkMailbox')
    expect(src).not.toContain('getPermissionConfirm(')
    expect(src).not.toContain('dequeue(')
    expect(src).toContain('classifierState')
    expect(src).toContain('isDisabled={classifierApproved}')
    expect(src).toContain('Auto-approved')
    expect(src).toContain('Attempting to auto-approve')
  })

  test('tyy: onCancel deny; PowerShell command title; no dequeue; no DualInk wrap', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionPowerShellDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'deny' })")
    expect(src).toContain('powerShellCommandTitle')
    expect(src).toContain('yes-apply-suggestions')
    expect(src).toContain('yes-prefix-edited')
    expect(src).toContain('editablePrefixSeed')
    expect(src).toContain('sanitizeEditablePrefix')
    expect(src).toContain('} *')
    expect(src).toContain('POWERSHELL_PREFIX_PLACEHOLDER')
    expect(src).toContain('Do you want to proceed?')
    expect(
      readFileSync(join(root, 'src/dialog/permissionPowerShell.ts'), 'utf8'),
    ).toContain('command prefix (e.g., Get-Process *)')
    expect(src).toContain('usePermissionExplainerUI')
    expect(src).toContain('explainerState.chord')
    expect(src).toContain('getDestructiveCommandWarning')
    expect(src).toContain('hostChrome')
    expect(src).toContain('onAmendHintChange')
    expect(src).toContain('action="amend"')
    expect(src).not.toContain('PermissionDualInkMailbox')
    expect(src).not.toContain('getPermissionConfirm(')
    expect(src).not.toContain('dequeue(')
  })

  test('Mhy: onCancel deny; DualInk analog showingDiffInIDE; no dequeue; no DualInk wrap; no getPermissionConfirm', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionFileDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'deny' })")
    expect(src).toContain('mintFileStandingRow')
    expect(src).toContain('filePermissionQuestionNode')
    expect(src).toContain('useAppState(s => s.toolPermissionContext)')
    expect(src).toContain('showingDiffInIDE')
    expect(src).toContain('filePermissionDialogTitle')
    expect(src).toContain('Save file to continue')
    expect(src).toContain('isSupportedVSCodeTerminal')
    expect(src).toContain('FileEditToolDiff')
    expect(src).toContain('FileWriteToolDiff')
    expect(src).toContain('NotebookEditToolDiff')
    expect(src).toContain('verbose={true}')
    expect(src).toContain('width={120}')
    expect(src).toContain('toTildePath')
    expect(src).toContain('remoteOldContent')
    expect(src).toContain('skipLocalRead')
    expect(src).toContain('remoteOldContent={content.remoteOldContent}')
    expect(src).toContain('skipLocalRead={content.skipLocalRead}')
    expect(
      readFileSync(
        join(
          root,
          'src/components/permissions/NotebookEditPermissionRequest/NotebookEditToolDiff.tsx',
        ),
        'utf8',
      ),
    ).toContain('if (props.remoteOldContent !== undefined)')
    expect(src).toContain('hostChrome')
    expect(src).toContain('onAmendHintChange')
    expect(src).toContain('action="amend"')
    expect(src).toContain('cycleModeAction')
    expect(src).toContain('userFacingName')
    expect(src).toContain('renderedToolUseMessage')
    expect(src).toContain("case 'tool-use-line'")
    expect(src).toContain('isValidElement')
    expect(src).not.toContain('useDiffInIDE')
    expect(src).not.toContain('ShowInIDEPrompt')
    expect(src).not.toContain('PermissionDualInkMailbox')
    expect(src).not.toContain('getPermissionConfirm(')
    expect(src).not.toContain('<FilePermissionDialog')
    expect(src).not.toContain('dequeue(')
  })

  test('PermissionPrompt DualInk analog confirm:cycleMode opt-in; File Host only', () => {
    const src = readFileSync(
      join(root, 'src/components/permissions/PermissionPrompt.tsx'),
      'utf8',
    )
    expect(src).toContain('cycleModeAction')
    expect(src).toContain('resolveConfirmCycleModeAction')
    expect(src).toContain("'confirm:cycleMode'")
    expect(src).toContain('if (cycleModeAction)')
    expect(src).toContain('hostChrome')
    expect(src).toContain('onAmendHintChange')
  })

  test('Vru: onCancel deny; DualInk analog preview/multiSelect/annotations; no dequeue; no DualInk wrap', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionAskUserQuestionDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("answer({ behavior: 'deny' })")
    expect(src).toContain('normalizeAskQuestions')
    expect(src).toContain('resolveAskUserQuestionSubmit')
    expect(src).toContain('AfkCountdown')
    expect(src).toContain('askUserQuestionTimeoutToMs')
    expect(src).toContain('onImagePaste')
    expect(src).toContain('convertImagesToBlocks')
    expect(src).toContain('QuestionView')
    expect(src).toContain('SubmitQuestionsView')
    expect(src).toContain('useMultipleChoiceState')
    expect(src).toContain('buildAskUserQuestionAnnotations')
    expect(src).toContain('formatAskUserQuestionChatAboutFeedback')
    expect(src).toContain('getCliHighlightPromise')
    expect(src).toContain('syntaxHighlightingDisabled')
    expect(src).toContain('toDualInkQuestions')
    expect(
      readFileSync(join(root, 'src/dialog/permissionAsk.ts'), 'utf8'),
    ).toContain('OFY_PREVIEW_CAP = 2000')
    expect(
      readFileSync(join(root, 'src/dialog/permissionAsk.ts'), 'utf8'),
    ).toContain("kind: 'withheld'")
    expect(src).not.toContain('$fy')
    expect(src).not.toContain('<AskUserQuestionPermissionRequest')
    expect(src).not.toContain('PermissionDualInkMailbox')
    expect(src).not.toContain('getPermissionConfirm(')
    expect(src).not.toContain('dequeue(')
  })

  test('teu: DualInk local Lcy; no storageV5/tn; no dequeue', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionExitPlanModeDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('ExitPlanModePermissionRequest')
    expect(src).toContain("behavior: 'deny'")
    expect(
      readFileSync(join(root, 'src/dialog/permissionExitPlan.ts'), 'utf8'),
    ).toContain('buildExitPlanKeepContext')
    expect(
      readFileSync(join(root, 'src/dialog/permissionExitPlan.ts'), 'utf8'),
    ).toContain('mintSetModeRow')
    expect(
      readFileSync(join(root, 'src/dialog/permissionExitPlan.ts'), 'utf8'),
    ).toContain('mintExitPlanResumeRow')
    expect(
      readFileSync(
        join(
          root,
          'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
        ),
        'utf8',
      ),
    ).toContain('resolveExitPlanKeepContextAnswer')
    expect(
      readFileSync(
        join(
          root,
          'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
        ),
        'utf8',
      ),
    ).toContain('keepContext.options[0]')
    expect(
      readFileSync(
        join(
          root,
          'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
        ),
        'utf8',
      ),
    ).toContain('offerExitPlanResumeAuto')
    expect(
      readFileSync(
        join(
          root,
          'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
        ),
        'utf8',
      ),
    ).toContain('resume-auto after gate off')
    expect(src).not.toContain('tn()')
    expect(src).not.toContain('{storageV5')
    expect(src).not.toContain('storageV5.')
    expect(src).not.toContain('PermissionDualInkMailbox')
    expect(src).not.toContain('getPermissionConfirm(')
    expect(src).not.toContain('dequeue(')
  })

  test('DualInk mailbox wrap deleted — Host permission_* are answer-only', () => {
    expect(
      existsSync(join(root, 'src/dialog/permissionConfirmMailbox.tsx')),
    ).toBe(false)
  })
})
