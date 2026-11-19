import { describe, expect, test } from 'bun:test'
import {
  buildClaudeLogsCursorPrefix,
  formatClaudeLogsReplay,
} from '../bg/logsReplay.js'
import {
  formatCliActionSuccess,
  formatCliDetail,
  formatCliError,
  formatCliInactive,
  formatCliSuccess,
  formatCliWarning,
  isCliInteractiveTty,
} from '../cliStatusMarkers.js'
import {
  formatRevokeUnconfirmedMessage,
  isAnthropicRequestId,
  revokeOAuthRefreshTokenWithRetry,
} from '../handlers/designOauth.js'
import {
  checkPurgeInteractiveTerminal,
  resolvePurgeTerminalOutput,
} from '../handlers/purgeProject.js'
import {
  formatApiRetryStatusLabel,
  PrintRetryNoticeWriter,
  PrintTextResults,
} from '../print.js'
import {
  detectPromptReadAsOptionValue,
  findInitializeCliOption,
  formatInitializeConflictError,
  shouldSkipEarlyInputForPipedHelp,
} from '../promptAfterListOption.js'
import {
  CutOffReRunStopTracker,
  declareSdkRapidFollowupPreempt,
  getSdkRapidFollowupPreempt,
  isEligibleRapidFollowup,
  RapidFollowupPreemptController,
} from '../rapidFollowupPreempt.js'
import {
  detectIncompleteCliToolListWarnings,
  looksLikeIncompleteToolRule,
  looksLikeInvalidToolsEntry,
} from '../toolListWarnings.js'

describe('Wave 326 Group 5A — CLI (#2, #34, #45, #149, #173, #204, #238, #246, #274, #341, #346)', () => {
  test('#2 detects incomplete --allowedTools / --disallowedTools / --tools entries', () => {
    expect(looksLikeIncompleteToolRule('Bash(git')).toBe(true)
    expect(looksLikeIncompleteToolRule('Read()')).toBe(true)
    expect(looksLikeIncompleteToolRule('Bash(git status)')).toBe(false)
    expect(looksLikeInvalidToolsEntry('Bash(git status)')).toBe(true)
    expect(looksLikeInvalidToolsEntry('Read')).toBe(false)

    const warnings = detectIncompleteCliToolListWarnings({
      allowedTools: ['Bash(git', 'Read'],
      disallowedTools: ['Write()'],
      tools: ['Edit(foo)'],
    })
    expect(warnings.length).toBeGreaterThanOrEqual(3)
    expect(warnings.some(w => w.includes('--allowedTools'))).toBe(true)
    expect(warnings.some(w => w.includes('--disallowedTools'))).toBe(true)
    expect(warnings.some(w => w.includes('--tools'))).toBe(true)
  })

  test('#34 & #346 claude purge writes prompts to TTY when stdout is redirected', () => {
    const fakeStderr = { isTTY: true } as unknown as NodeJS.WriteStream
    const res = resolvePurgeTerminalOutput({
      stdout: { isTTY: false } as unknown as NodeJS.WriteStream,
      stderr: fakeStderr,
      stdoutIsTTY: false,
      stderrIsTTY: true,
    })
    expect(res.stream).toBe(fakeStderr)
    res.dispose()

    const check = checkPurgeInteractiveTerminal(
      'claude purge',
      { kind: 'stdin', stream: process.stdin, dispose: () => {} },
      false,
      true,
    )
    expect(check).toBeNull()
  })

  test('#45 detects prompt accidentally swallowed by variadic list option', () => {
    const warn = detectPromptReadAsOptionValue([
      '--add-dir',
      './src',
      'fix the failing auth test',
    ])
    expect(warn).toBeDefined()
    expect(warn?.problem).toContain('--add-dir')
    expect(warn?.problem).toContain('fix the failing auth test')

    // Explicit `--` separator avoids ambiguity
    expect(
      detectPromptReadAsOptionValue([
        '--add-dir',
        './src',
        '--',
        'fix the failing auth test',
      ]),
    ).toBeUndefined()
  })

  test('#149 formats retry labels, emits delayed wait notice, and mirrors errors to TTY stderr', () => {
    expect(formatApiRetryStatusLabel(529).toLowerCase()).toContain('overloaded')
    expect(formatApiRetryStatusLabel(429).toLowerCase()).toContain(
      'rate limited',
    )
    expect(formatApiRetryStatusLabel(undefined).toLowerCase()).toContain(
      'api error',
    )

    const lines: string[] = []
    const writer = new PrintRetryNoticeWriter('text', {
      writeStderr: line => lines.push(line),
      stderrIsTerminal: true,
      stdoutIsTerminal: false,
      delayMs: 5000,
    })
    writer.observe({
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 5,
      retry_delay_ms: 6000,
      error_status: 529,
    })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]?.toLowerCase()).toContain('overloaded')

    const errOut: string[] = []
    const results = new PrintTextResults(
      {},
      () => {},
      () => false,
      s => errOut.push(s),
      () => true,
    )
    results.printAtTurnEnd({
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['API failed with 503'],
    })
    expect(errOut.join('')).toContain('Execution error')
  })

  test('#173 skips early input capture when --help is piped to a pager', () => {
    expect(shouldSkipEarlyInputForPipedHelp(['--help'], false)).toBe(true)
    expect(shouldSkipEarlyInputForPipedHelp(['-h'], false)).toBe(true)
    expect(
      shouldSkipEarlyInputForPipedHelp(['--verbose', '--help'], false),
    ).toBe(true)
    expect(shouldSkipEarlyInputForPipedHelp(['--model', '--help'], false)).toBe(
      false,
    )
    expect(shouldSkipEarlyInputForPipedHelp(['--', '--help'], false)).toBe(
      false,
    )
    expect(shouldSkipEarlyInputForPipedHelp(['--help'], true)).toBe(false)
    expect(shouldSkipEarlyInputForPipedHelp(['-p', 'hi'], false)).toBe(false)
  })

  test('#204 claude logs prefixes cursor-addressed replay to preserve scrollback', () => {
    expect(buildClaudeLogsCursorPrefix(true, true, 24)).toBe(
      `${'\n'.repeat(23)}\x1B[1;1H`,
    )
    expect(buildClaudeLogsCursorPrefix(false, true, 24)).toBe('')
    const replay = formatClaudeLogsReplay(
      ['\x1B[?1049h\x1B[1;1Hhi'],
      true,
      24,
      {
        preserveScrollback: true,
        rawRows: 24,
      },
    )
    expect(replay.startsWith(`${'\n'.repeat(23)}\x1B[1;1H`)).toBe(true)
    // Backward-compatible default (without preserveScrollback) stays intact
    expect(formatClaudeLogsReplay(['\x1B[?1049hhi'], true, 24)).toBe(
      'hi\x1B[0m\x1B[24;1H\n',
    )
  })

  test('#238 validates Anthropic request-id, retries revoke, and formats manual revoke guidance', async () => {
    expect(isAnthropicRequestId('req_01ABCdef_123')).toBe(true)
    expect(isAnthropicRequestId('not_a_req')).toBe(false)

    let attempts = 0
    const outcome = await revokeOAuthRefreshTokenWithRetry(
      'rt_test',
      'client_id',
      'refresh_token',
      async () => {
        attempts++
        return attempts < 2 ? 'retryable' : 'acknowledged'
      },
    )
    expect(outcome).toBe('acknowledged')
    expect(attempts).toBe(2)

    const guidance = await formatRevokeUnconfirmedMessage()
    expect(guidance).toContain('https://')
    expect(guidance.toLowerCase()).toContain('revoke')
  })

  test('#246 rapidFollowupPreempt preempts open active turn on eligible follow-up', () => {
    declareSdkRapidFollowupPreempt(true)
    expect(getSdkRapidFollowupPreempt()).toBe(true)
    expect(
      isEligibleRapidFollowup({
        mode: 'prompt',
        value: 'actually do B instead',
        priority: 'next',
        uuid: 'u2',
      }),
    ).toBe(true)

    const emitted: unknown[] = []
    const ac = new AbortController()
    const queue: Array<{
      mode: 'prompt'
      value: string
      priority: 'next'
      uuid: string
    }> = []
    let listener: (() => void) | undefined
    const ctrl = new RapidFollowupPreemptController({
      messageQueue: {
        getCommandQueueSnapshot: () => queue,
        subscribe: fn => {
          listener = fn
          return () => {}
        },
      },
      drain: {
        abortController: ac,
        endSessionRequested: false,
      },
      enabled: () => true,
      emit: frame => emitted.push(frame),
    })
    ctrl.install()
    ctrl.noteTurnStart({
      command: { mode: 'prompt', value: 'do A', priority: 'next', uuid: 'u1' },
      members: [],
    })
    ctrl.noteFrame({ type: 'system', subtype: 'init' })
    queue.push({
      mode: 'prompt',
      value: 'actually do B instead',
      priority: 'next',
      uuid: 'u2',
    })
    listener?.()
    expect(ac.signal.aborted).toBe(true)
    expect(emitted.length).toBe(1)
    declareSdkRapidFollowupPreempt(false)
  })

  test('#274 & #346 unifies TTY status markers while preserving piped output', () => {
    expect(isCliInteractiveTty(true, true)).toBe(true)
    expect(isCliInteractiveTty(false, true)).toBe(false)

    const ttyOk = formatCliSuccess('Connected', '', true)
    const pipedOk = formatCliSuccess('Connected', '', false)
    expect(ttyOk).toContain('Connected')
    expect(ttyOk).not.toBe('Connected')
    expect(pipedOk).toBe('Connected')

    expect(formatCliError('Failed', '', false)).toBe('Failed')
    expect(formatCliWarning('Careful', '', false)).toBe('Careful')
    expect(formatCliInactive('Off', true)).not.toBe(
      formatCliInactive('Off', false),
    )
    expect(formatCliDetail('Info', true)).toContain('\u21b3')
    expect(formatCliActionSuccess('Successfully updated', '', true)).toContain(
      'Updated',
    )
    expect(formatCliActionSuccess('Successfully updated', '', false)).toBe(
      'Successfully updated',
    )
  })

  test('#341 refuses --await-initialize / --initialize-fields with --bg or --worktree --tmux', () => {
    expect(findInitializeCliOption(['--bg', '--await-initialize'])).toBe(
      '--await-initialize',
    )
    expect(
      findInitializeCliOption([
        '--worktree',
        '--tmux',
        '--initialize-fields=a',
      ]),
    ).toBe('--initialize-fields')
    expect(findInitializeCliOption(['--bg', 'hello'])).toBeUndefined()

    const errBg = formatInitializeConflictError(['--bg', '--await-initialize'])
    expect(errBg).toContain('--await-initialize')
    expect(errBg).toContain('--bg')
    const errTmux = formatInitializeConflictError([
      '--worktree',
      '--tmux',
      '--managed-settings-in-initialize',
    ])
    expect(errTmux).toContain('--worktree --tmux')
  })

  test('#95 CutOffReRunStopTracker cancels queued re-run and persists interruption marker', async () => {
    const tracker = new CutOffReRunStopTracker()
    const takenOut = {
      type: 'user',
      uuid: 'u-cutoff',
      message: { content: 'hi' },
    }
    tracker.arm('rerun-1', takenOut)
    expect(tracker.hasPendingCutOffReRun()).toBe(true)

    let persisted: Record<string, unknown>[] | undefined
    const cancelled = tracker.handleInterruptBeforeStart({
      removeFromQueue: uuid => uuid === 'rerun-1',
      currentMessages: [{ type: 'user', uuid: 'u-prev' }],
      buildInterruptionMessage: () => ({
        type: 'user',
        uuid: 'u-interrupt',
        message: { content: '[Request interrupted by user]' },
      }),
      persistTranscript: async msgs => {
        persisted = msgs
      },
    })
    expect(cancelled).toBe(true)
    expect(tracker.hasPendingCutOffReRun()).toBe(false)
    await tracker.getStopSettlingPromise()
    expect(persisted?.length).toBe(3)
    expect(persisted?.[1]?.uuid).toBe('u-cutoff')
    expect(persisted?.[2]?.uuid).toBe('u-interrupt')
  })
})
