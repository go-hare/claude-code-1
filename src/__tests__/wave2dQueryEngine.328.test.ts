import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkCallDirectoryHold,
  extractDecisionReasonCode,
  isAutoModeNoVerdictDenialResult,
  MissingWorkingDirectoryError,
  missingWorkingDirectoryPins,
  recordPermissionCheckedCwd,
  resolveQueryEngineResultVerdict,
  setCwdOrPinMissing,
  verifyApprovedShellDirectory,
} from '../QueryEngine.js'
import type { Message } from '../types/message.js'

function makeAssistantErrorMessage(opts: {
  text: string
  status?: number
  code?: string
  errorType?: string
  apiError?: string
  stopReason?: string | null
}): Message {
  return {
    type: 'assistant',
    uuid: 'asst-err-1',
    timestamp: new Date().toISOString(),
    isApiErrorMessage: true,
    apiErrorStatus: opts.status,
    apiErrorCode: opts.code,
    apiErrorType: opts.errorType,
    apiError: opts.apiError,
    message: {
      id: 'msg_err_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: opts.text }],
      stop_reason: opts.stopReason ?? 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  } as unknown as Message
}

describe('Wave 2D QueryEngine alignment (P0-4, P2-#2, #1492, #1640)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('P0-4: API error assistant turns (401/429/413/500/PTL) emit subtype=success with is_error=true and actual error text', () => {
    const cases = [
      {
        status: 401,
        code: 'authentication_error',
        errorType: 'authentication_error',
        apiError: 'authentication_failed',
        text: 'Invalid API key · Fix external API key',
        terminalReason: 'api_error',
      },
      {
        status: 429,
        code: 'rate_limit_error',
        errorType: 'rate_limit_error',
        apiError: 'rate_limit',
        text: 'Rate limit reached — retry later',
        terminalReason: 'api_error',
      },
      {
        status: 413,
        code: 'prompt_too_long',
        errorType: 'invalid_request_error',
        apiError: 'prompt_too_long',
        text: 'Prompt is too long',
        terminalReason: 'prompt_too_long',
      },
      {
        status: 500,
        code: 'api_error',
        errorType: 'api_error',
        apiError: 'server_error',
        text: 'API Error: 500 Internal server error',
        terminalReason: 'model_error',
      },
    ]

    for (const c of cases) {
      const msg = makeAssistantErrorMessage(c)
      const verdict = resolveQueryEngineResultVerdict({
        result: msg,
        lastStopReason: 'end_turn',
        terminalReason: c.terminalReason,
        deferredThisTurn: false,
        isApiErrorLatched: true,
        apiErrorStatus: c.status,
        apiErrorCode: c.code,
        apiErrorType: c.errorType,
        apiErrorCategory: c.apiError,
        apiErrorText: c.text,
        lastTurnAssistantText: '',
        structuredOutput: undefined,
        refusalDroppedStructuredOutput: false,
        stoppedByPermissionCheck: false,
      })

      expect(verdict.subtype).toBe('success')
      if (verdict.subtype === 'success') {
        expect(verdict.isError).toBe(true)
        expect(verdict.resultText).toBe(c.text)
        expect(verdict.apiErrorStatus).toBe(c.status)
        expect(verdict.apiErrorCode).toBe(c.code)
        expect(verdict.apiErrorType).toBe(c.errorType)
        expect(verdict.apiError).toBe(c.apiError)
      }
    }
  })

  test('P0-4: error_during_execution fires only when !isResultSuccessful or permission/auto-mode stop', () => {
    const emptyUser = {
      type: 'user',
      uuid: 'u-1',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'hello' },
    } as unknown as Message

    const failedNoReply = resolveQueryEngineResultVerdict({
      result: emptyUser,
      lastStopReason: null,
      terminalReason: 'aborted_streaming',
      deferredThisTurn: false,
      isApiErrorLatched: false,
      apiErrorStatus: null,
      apiErrorText: '',
      lastTurnAssistantText: '',
      structuredOutput: undefined,
      refusalDroppedStructuredOutput: false,
      stoppedByPermissionCheck: false,
    })
    expect(failedNoReply.subtype).toBe('error_during_execution')
    expect(failedNoReply.isError).toBe(true)

    const src = readFileSync(join(import.meta.dir, '../QueryEngine.ts'), 'utf8')
    expect(src).not.toContain('terminatedWithFailure')
    expect(src).not.toContain('TERMINAL_FAILURE_REASONS')
  })

  test('P2-#2: budget_exhausted and max_turns_reached route through closeAtTurnEnd + recordTranscript', () => {
    const budgetVerdict = resolveQueryEngineResultVerdict({
      result: undefined,
      lastStopReason: null,
      terminalReason: 'budget_exhausted',
      deferredThisTurn: false,
      isApiErrorLatched: false,
      apiErrorStatus: null,
      apiErrorText: '',
      lastTurnAssistantText: '',
      structuredOutput: undefined,
      refusalDroppedStructuredOutput: false,
      stoppedByPermissionCheck: false,
    })
    expect(budgetVerdict.subtype).toBe('error_max_budget_usd')

    const turnsVerdict = resolveQueryEngineResultVerdict({
      result: undefined,
      lastStopReason: 'tool_use',
      terminalReason: 'max_turns',
      deferredThisTurn: false,
      maxTurnsReached: { turnCount: 5, maxTurns: 5 },
      isApiErrorLatched: false,
      apiErrorStatus: null,
      apiErrorText: '',
      lastTurnAssistantText: '',
      structuredOutput: undefined,
      refusalDroppedStructuredOutput: false,
      stoppedByPermissionCheck: false,
    })
    expect(turnsVerdict.subtype).toBe('error_max_turns')
    if (turnsVerdict.subtype === 'error_max_turns') {
      expect(turnsVerdict.turnCount).toBe(5)
      expect(turnsVerdict.maxTurns).toBe(5)
    }

    const src = readFileSync(join(import.meta.dir, '../QueryEngine.ts'), 'utf8')
    expect(src).toContain("msgType !== 'stream_event'")
    expect(src).toContain('await recordTranscript(this.mutableMessages)')
  })

  test('#1492: extractDecisionReasonCode + auto-mode no-verdict denial emits error_during_execution', () => {
    expect(
      extractDecisionReasonCode({
        type: 'classifier',
        classifier: 'auto-mode',
        reason: 'Auto mode unavailable',
        noVerdict: true,
        hostCode: 'auto_mode_stop_no_verdict',
      }),
    ).toBe('auto_mode_stop_no_verdict')

    expect(
      extractDecisionReasonCode({
        type: 'subcommandResults',
        reasons: new Map([
          [
            'cmd1',
            {
              decisionReason: {
                type: 'classifier',
                hostCode: 'auto_mode_stop_no_verdict',
              },
            },
          ],
          [
            'cmd2',
            {
              decisionReason: {
                type: 'safetyCheck',
                circuitBreaker: 'outsideReadsBlocked',
              },
            },
          ],
        ]),
      }),
    ).toBe('outside_reads_blocked')

    expect(
      isAutoModeNoVerdictDenialResult({
        behavior: 'deny',
        endsTurn: true,
        decisionReason: {
          type: 'classifier',
          noVerdict: true,
          hostCode: 'auto_mode_stop_no_verdict',
        },
      }),
    ).toBe(true)

    const verdict = resolveQueryEngineResultVerdict({
      result: makeAssistantErrorMessage({ text: 'ok' }),
      lastStopReason: 'end_turn',
      terminalReason: 'completed',
      deferredThisTurn: false,
      isApiErrorLatched: false,
      apiErrorStatus: null,
      apiErrorText: '',
      lastTurnAssistantText: 'ok',
      structuredOutput: undefined,
      refusalDroppedStructuredOutput: false,
      stoppedByPermissionCheck: true,
      permissionStopMessage:
        'Auto mode unavailable — stopped after repeated responses with no safety verdict',
    })
    expect(verdict.subtype).toBe('error_during_execution')
    expect(verdict.isError).toBe(true)
  })

  test('#1640: MissingWorkingDirectoryError pinning, call_directory_hold, and verifyApprovedShellDirectory', () => {
    const sessionKey = {}
    const dirA = mkdtempSync(join(tmpdir(), 'wave2d-dir-a-'))
    const dirB = mkdtempSync(join(tmpdir(), 'wave2d-dir-b-'))
    tempDirs.push(dirA, dirB)

    // 1. Missing working directory pins session and warns once
    const missingPath = join(dirA, 'deleted-subdir')
    const warning1 = setCwdOrPinMissing(missingPath, sessionKey, () => {
      throw new MissingWorkingDirectoryError(missingPath)
    })
    expect(warning1).toBeDefined()
    expect(missingWorkingDirectoryPins.get(sessionKey)?.pinned).toBe(true)

    // Second call while already pinned emits no duplicate warning
    const warning2 = setCwdOrPinMissing(missingPath, sessionKey, () => {
      throw new MissingWorkingDirectoryError(missingPath)
    })
    expect(warning2).toBeUndefined()

    // 2. call_directory_hold: pinned_refusal when pinned & missing
    const pinnedHold = checkCallDirectoryHold({
      cwd: missingPath,
      sessionKey,
    })
    expect(pinnedHold.ok).toBe(false)
    if (!pinnedHold.ok) {
      expect(pinnedHold.holdReason).toBe('pinned_refusal')
    }

    // 3. call_directory_hold: gone when not pinned & missing
    const goneHold = checkCallDirectoryHold({
      cwd: missingPath,
    })
    expect(goneHold.ok).toBe(false)
    if (!goneHold.ok) {
      expect(goneHold.holdReason).toBe('gone')
    }

    // 4. call_directory_hold: changed_before_shell when physical dir changed
    const checkedPhysical = recordPermissionCheckedCwd(sessionKey, 'tu_1', dirA)
    expect(checkedPhysical).toBe(realpathSync(dirA))
    const changedHold = checkCallDirectoryHold({
      cwd: dirB,
      checkedPhysicalCwd: checkedPhysical,
      sessionKey,
    })
    expect(changedHold.ok).toBe(false)
    if (!changedHold.ok) {
      expect(changedHold.holdReason).toBe('changed_before_shell')
    }

    // 5. verifyApprovedShellDirectory: approves matching dir, denies mismatch with shellNotInApprovedDirectory
    const okCheck = verifyApprovedShellDirectory({
      askedInDirectory: '.',
      projectRoot: dirA,
      currentCwd: dirA,
      toolUseID: 'tu_bash_1',
    })
    expect(okCheck.ok).toBe(true)

    const mismatchCheck = verifyApprovedShellDirectory({
      askedInDirectory: '.',
      projectRoot: dirA,
      currentCwd: dirB,
      toolUseID: 'tu_bash_2',
    })
    expect(mismatchCheck.ok).toBe(false)
    if (!mismatchCheck.ok) {
      expect(mismatchCheck.denial.behavior).toBe('deny')
      expect(mismatchCheck.denial.decisionReason.label).toBe(
        'shellNotInApprovedDirectory',
      )
    }
  })
})
