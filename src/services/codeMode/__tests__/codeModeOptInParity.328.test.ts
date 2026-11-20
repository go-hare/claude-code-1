import { afterEach, describe, expect, test } from 'bun:test'
import {
  isProjectScopeBlockedEnvVar,
  PROJECT_SCOPE_BLOCKED_ENV_VARS,
  stripProjectScopeBlockedEnv,
} from '../../../utils/managedEnvConstants.js'
import {
  CODE_MODE_ENV_VAR,
  CODE_MODE_ONLY_TOOLS,
  chromeSectionForWire,
  codeModeChromeNotice,
  codeModeRefusalReasonText,
  codeModeSandboxHoldoffNotice,
  codeModeSignInRestartFailedNotice,
  codeModeSignInRestartNotice,
  doesEngineResultHold,
  doToolsOrSettingsLeaveReplOut,
  engineCheckResult,
  getCodeModeStateVersion,
  isCodeModeEnabled,
  isCodeModeHeldOffBySandbox,
  isCodeModeModelSupported,
  notListedYetNoteForModel,
  offInCodeModeNoteForModel,
  offInCodeModeToast,
  pastItsToolsInCodeModeNote,
  pinCodeMode,
  REPL_PRIMITIVE_TOOL_NAMES,
  replStartedEmptyNote,
  resetCodeModeOptInStateForTests,
  runReplEngineRealmCheck,
  sandboxHostListsBlockCodeMode,
  setCodeModeAccepted,
  setSandboxCommandNetworkListsOffered,
  settleCodeModeOptIn,
  subscribeCodeModeState,
  unpinCodeMode,
} from '../index.js'

describe('Code Mode 2.1.328 1:1 parity', () => {
  afterEach(() => {
    resetCodeModeOptInStateForTests()
    delete process.env[CODE_MODE_ENV_VAR]
    delete process.env.DISABLE_GROWTHBOOK
  })

  test('CODE_MODE_ONLY_TOOLS (FFe) and REPL_PRIMITIVE_TOOL_NAMES (Hfi) match official 2.1.328', () => {
    expect([...CODE_MODE_ONLY_TOOLS].sort()).toEqual([
      'Bash',
      'Glob',
      'Grep',
      'NotebookEdit',
      'PowerShell',
      'Read',
    ])
    expect([...REPL_PRIMITIVE_TOOL_NAMES].sort()).toEqual([
      'Bash',
      'Edit',
      'Glob',
      'Grep',
      'NotebookEdit',
      'PowerShell',
      'Read',
      'Write',
    ])
  })

  test('engineCheckResult runs real realm-isolation + async thenable probes and passes on Bun', () => {
    const raw = runReplEngineRealmCheck()
    expect([
      'passed',
      'both',
      'rejected_definitions',
      'thenable_after_await',
    ]).toContain(raw)
    expect(engineCheckResult()).toBe('passed')
    expect(doesEngineResultHold('passed')).toBe(false)
    expect(doesEngineResultHold('both')).toBe(true)
    expect(doesEngineResultHold('threw_type_error')).toBe(true)
  })

  test('sandbox network host lists holdoff disables Code Mode and reports holdoff notice', () => {
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    expect(isCodeModeEnabled()).toBe(true)
    expect(sandboxHostListsBlockCodeMode()).toBe(false)
    expect(isCodeModeHeldOffBySandbox()).toBe(false)

    setSandboxCommandNetworkListsOffered(true)
    expect(sandboxHostListsBlockCodeMode()).toBe(true)
    expect(isCodeModeEnabled()).toBe(false)
    expect(isCodeModeHeldOffBySandbox()).toBe(true)
    expect(codeModeSandboxHoldoffNotice()).toContain(
      "the sandbox has already set up the ordinary tools' network access",
    )

    resetCodeModeOptInStateForTests()
    expect(sandboxHostListsBlockCodeMode()).toBe(false)
  })

  test('subscribeCodeModeState and getCodeModeStateVersion notify on all state mutations', () => {
    let calls = 0
    const unsub = subscribeCodeModeState(() => {
      calls += 1
    })
    const v0 = getCodeModeStateVersion()

    setCodeModeAccepted(true)
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    pinCodeMode(false)
    unpinCodeMode()
    setSandboxCommandNetworkListsOffered(true)

    expect(calls).toBe(5)
    expect(getCodeModeStateVersion()).toBe(v0 + 5)

    unsub()
    resetCodeModeOptInStateForTests()
    expect(calls).toBe(5)
    expect(getCodeModeStateVersion()).toBe(v0 + 6)
  })

  test('isCodeModeModelSupported matches official czn floor (Opus/Sonnet 5.5+, Fable/Mythos 5.2+)', () => {
    expect(isCodeModeModelSupported('claude-opus-5-5')).toBe(true)
    expect(isCodeModeModelSupported('claude-opus-5.5')).toBe(true)
    expect(isCodeModeModelSupported('claude-opus-5-6-20260601')).toBe(true)
    expect(isCodeModeModelSupported('claude-sonnet-5-5')).toBe(true)
    expect(isCodeModeModelSupported('claude-fable-5-2')).toBe(true)
    expect(isCodeModeModelSupported('claude-mythos-5-2')).toBe(true)
    expect(isCodeModeModelSupported('claude-opus-6-0')).toBe(true)

    expect(isCodeModeModelSupported('claude-opus-5-0')).toBe(false)
    expect(isCodeModeModelSupported('claude-opus-4-8')).toBe(false)
    expect(isCodeModeModelSupported('claude-sonnet-4-6')).toBe(false)
    expect(isCodeModeModelSupported('claude-fable-5-1')).toBe(false)
    expect(isCodeModeModelSupported('claude-mythos-5-1')).toBe(false)
    expect(isCodeModeModelSupported('claude-haiku-5-5')).toBe(false)
    expect(isCodeModeModelSupported('')).toBe(false)
  })

  test('doToolsOrSettingsLeaveReplOut matches official OAl checks', () => {
    expect(doToolsOrSettingsLeaveReplOut({ restricted: true })).toBe(true)
    expect(doToolsOrSettingsLeaveReplOut({ disallowedTools: ['REPL'] })).toBe(
      true,
    )
    expect(doToolsOrSettingsLeaveReplOut({ disallowedTools: ['Eval'] })).toBe(
      true,
    )
    // Rule with ruleContent does not exclude the whole REPL tool
    expect(
      doToolsOrSettingsLeaveReplOut({ disallowedTools: ['REPL(foo)'] }),
    ).toBe(false)
    expect(doToolsOrSettingsLeaveReplOut({ baseTools: ['Read', 'Bash'] })).toBe(
      true,
    )
    expect(doToolsOrSettingsLeaveReplOut({ baseTools: ['default'] })).toBe(
      false,
    )
    expect(
      doToolsOrSettingsLeaveReplOut({ baseTools: ['preset:default', '-REPL'] }),
    ).toBe(true)
    expect(doToolsOrSettingsLeaveReplOut({ baseTools: ['REPL'] })).toBe(false)
  })

  test('codeModeRefusalReasonText(no_flags) and official notices match 2.1.328 copy', () => {
    expect(codeModeRefusalReasonText('no_flags')).toContain(
      'CLAUDE_CODE_DISABLE_FEATURE_FLAGS',
    )
    process.env.DISABLE_GROWTHBOOK = '1'
    expect(codeModeRefusalReasonText('no_flags')).toContain(
      'DISABLE_GROWTHBOOK',
    )

    expect(codeModeChromeNotice(false)).toContain(
      'Claude in Chrome and computer use are off',
    )
    expect(codeModeChromeNotice(true)).toContain(
      'stay off until you quit Claude Code',
    )
    expect(replStartedEmptyNote()).toContain('This REPL context is new')
    expect(offInCodeModeToast('Chrome')).toContain('No Chrome:')
    expect(offInCodeModeNoteForModel('Chrome')).toContain(
      'Chrome are not available',
    )
    expect(notListedYetNoteForModel()).toContain(
      'Claude in Chrome and computer use',
    )
    expect(pastItsToolsInCodeModeNote()).toContain(
      'Claude in Chrome and computer use',
    )
    expect(codeModeSignInRestartNotice()).toContain(
      'Restarting Claude Code to check',
    )
    expect(codeModeSignInRestartFailedNotice('exec failed')).toContain(
      'exec failed',
    )

    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    expect(chromeSectionForWire('original chrome section')).toContain(
      'Claude in Chrome and computer use are not available',
    )
    expect(chromeSectionForWire('')).toBe('')
  })

  test('PROJECT_SCOPE_BLOCKED_ENV_VARS blocks CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 but allows 0/false', () => {
    expect(PROJECT_SCOPE_BLOCKED_ENV_VARS.has(CODE_MODE_ENV_VAR)).toBe(true)
    expect(isProjectScopeBlockedEnvVar(CODE_MODE_ENV_VAR, '1')).toBe(true)
    expect(isProjectScopeBlockedEnvVar(CODE_MODE_ENV_VAR, 'true')).toBe(true)
    expect(isProjectScopeBlockedEnvVar(CODE_MODE_ENV_VAR, 'bad')).toBe(true)
    expect(isProjectScopeBlockedEnvVar(CODE_MODE_ENV_VAR, '0')).toBe(false)
    expect(isProjectScopeBlockedEnvVar(CODE_MODE_ENV_VAR, 'false')).toBe(false)

    expect(
      stripProjectScopeBlockedEnv(
        { [CODE_MODE_ENV_VAR]: '1', SAFE: 'ok' },
        'projectSettings',
      ),
    ).toEqual({ SAFE: 'ok' })
    expect(
      stripProjectScopeBlockedEnv(
        { [CODE_MODE_ENV_VAR]: '0', SAFE: 'ok' },
        'localSettings',
      ),
    ).toEqual({ [CODE_MODE_ENV_VAR]: '0', SAFE: 'ok' })
  })
})
