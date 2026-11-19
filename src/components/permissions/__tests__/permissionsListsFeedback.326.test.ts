import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { buildPlanApprovalOptions } from '../ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js'

const ROOT = resolve(import.meta.dir, '../../../..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

describe('Wave 326 Group 4C — Permissions, Lists, Questions & Sub-Wave 326-I Wires', () => {
  test('#343 buildPlanApprovalOptions renders 2-option card for subagent plans', () => {
    const subagentOpts = buildPlanApprovalOptions({
      showClearContext: true,
      usedPercent: 42,
      isAutoModeAvailable: true,
      isBypassPermissionsModeAvailable: true,
      showUltraplan: true,
      isSubagentPlan: true,
      onFeedbackChange: () => {},
    })
    expect(subagentOpts).toEqual([
      {
        label: 'Yes, and switch to default (ask each time) for this session',
        value: 'yes-default-keep-context',
      },
      {
        label: 'No',
        value: 'no',
      },
    ])

    const mainOpts = buildPlanApprovalOptions({
      showClearContext: false,
      usedPercent: null,
      isAutoModeAvailable: false,
      isBypassPermissionsModeAvailable: false,
      isSubagentPlan: false,
      onFeedbackChange: () => {},
    })
    expect(mainOpts.length).toBeGreaterThan(2)
    expect(mainOpts.at(-1)?.value).toBe('no')
  })

  test('#16 /permissions rule save wires persistPermissionUpdates with onPersistError', () => {
    const addRulesSrc = readSrc(
      'src/components/permissions/rules/AddPermissionRules.tsx',
    )
    const ruleListSrc = readSrc(
      'src/components/permissions/rules/PermissionRuleList.tsx',
    )
    expect(addRulesSrc).toContain(
      'persistPermissionUpdates([update], { onPersistError: onNotSaved })',
    )
    expect(ruleListSrc).toContain('onNotSaved={handlePersistNotSaved}')
    expect(ruleListSrc).toContain(
      'persistPermissionUpdates([permissionUpdate], { onPersistError: handlePersistNotSaved })',
    )
  })

  test('#299 /cd wires captureSandboxRootMoveHold and clearSandboxRootMoveHold', () => {
    const cdSrc = readSrc('src/commands/cd/cdCommand.tsx')
    const sandboxSrc = readSrc('src/components/sandbox/SandboxSettings.tsx')
    expect(cdSrc).toContain('captureSandboxRootMoveHold()')
    expect(cdSrc).toContain('clearSandboxRootMoveHold()')
    expect(sandboxSrc).toContain('clearSandboxRootMoveHold()')
  })

  test('#27 Tab collapse clears hidden feedback note across permission dialogs', () => {
    expect(
      readSrc('src/components/permissions/useShellPermissionFeedback.ts'),
    ).toContain("setAcceptFeedback('')")
    expect(readSrc('src/dialog/permissionSelectFeedback.ts')).toContain(
      "setRejectFeedback('')",
    )
    expect(
      readSrc(
        'src/components/permissions/FilePermissionDialog/useFilePermissionDialog.ts',
      ),
    ).toContain("setAcceptFeedback('')")
    expect(
      readSrc('src/components/permissions/PermissionPrompt.tsx'),
    ).toContain('const isInputVisible =')
  })

  test('#29/#315/#120/#208/#163/#179/#44/#42/#43/#69 production call-chain wires', () => {
    expect(readSrc('src/components/sandbox/SandboxSettings.tsx')).toContain(
      'disablePrintableKeybindings',
    )
    expect(
      readSrc(
        'src/components/permissions/ComputerUseApproval/ComputerUseApproval.tsx',
      ),
    ).toContain('disablePrintableKeybindings')
    expect(readSrc('src/components/WorktreeExitDialog.tsx')).toContain(
      "['status', '--porcelain', '-uall']",
    )
    expect(readSrc('src/components/IdeAutoConnectDialog.tsx')).toContain(
      'exitOnCtrlCD = false',
    )
    expect(readSrc('src/components/LogSelector.tsx')).toContain(
      'hideIndexes={true}',
    )
    expect(
      readSrc('src/components/FeedbackSurvey/useFeedbackSurvey.tsx'),
    ).toContain('closeTranscriptPrompt()')
    expect(readSrc('src/components/Feedback.tsx')).not.toContain(
      "if (key.return || input === ' ')",
    )
    expect(
      readSrc(
        'src/components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx',
      ),
    ).toContain(
      'defaultFocusValue={questionStates[question.question]?.selectedValue',
    )
    expect(readSrc('src/components/ThemePicker.tsx')).toContain(
      '!skipExitHandling',
    )
  })
})
