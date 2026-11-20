import { afterEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { ThemeProvider, wrappedRender as render } from '@anthropic/ink'
import { CodeModeOptInDialog } from '../../../components/CodeModeOptInDialog.js'
import { getGlobalConfig, saveGlobalConfig } from '../../../utils/config.js'
import {
  CODE_MODE_ENV_VAR,
  CODE_MODE_RESTART_ENV_VAR,
  CODE_MODE_RESTARTED_FROM_ENV_VAR,
} from '../constants.js'
import {
  confirmCodeModeCaveatsDialog,
  getCodeModeOptInState,
  hasAcceptedCodeModeCaveats,
  hasCodeModeAccountChanged,
  hideCodeModeOnlyTools,
  isAsyncLaneMode,
  isAsyncReplEnabled,
  isCodeModeEnabled,
  isCodeModeOptInDialogOpen,
  isPollToolEnabled,
  markPollEventWiringForPrintRun,
  markPollEventWiringForTerminalRun,
  openCodeModeOptInDialog,
  persistCodeModeCaveatsAccepted,
  recordCodeModeSignedInAccount,
  resetCodeModeOptInStateForTests,
  reviewCodeModeOptInAfterInit,
  setAsyncReplEnabledForTests,
  settleCodeModeOptIn,
  settleCodeModeOptInAtStartup,
} from '../optIn.js'

const CURSOR_FORWARD_RE = new RegExp(
  `${String.fromCharCode(0x1b)}\\[(\\d+)C`,
  'g',
)
const ANSI_RE = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-9;?]*[ -/]*[@-~]`,
  'g',
)
function stripAnsi(s: string): string {
  return s
    .replace(CURSOR_FORWARD_RE, (_m, n) => ' '.repeat(Number(n)))
    .replace(ANSI_RE, '')
}

async function renderToText(element: React.ReactElement): Promise<string> {
  const stdout = Object.assign(new PassThrough(), {
    columns: 140,
    rows: 40,
    isTTY: true,
  }) as unknown as NodeJS.WriteStream
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return stdin
    },
    ref() {
      return stdin
    },
    unref() {
      return stdin
    },
  }) as unknown as NodeJS.ReadStream

  let output = ''
  stdout.on('data', chunk => {
    output += String(chunk)
  })

  const instance = await render(
    React.createElement(
      ThemeProvider as React.ComponentType<{
        initialState: 'dark'
        children?: React.ReactNode
      }>,
      { initialState: 'dark' },
      element,
    ),
    { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
  )
  await new Promise(resolve => setTimeout(resolve, 40))
  instance.unmount()
  return stripAnsi(output)
}

describe('Code Mode 2.1.328 caveats dialog, 2-phase opt-in & async/Poll gates', () => {
  const originalConfig = getGlobalConfig()
  const originalCaveats = originalConfig.codeModeCaveatsAcceptedV1
  const originalAutoCaveat = originalConfig.codeModeAutoModeCaveatAcceptedV1

  afterEach(() => {
    resetCodeModeOptInStateForTests()
    delete process.env[CODE_MODE_ENV_VAR]
    delete process.env[CODE_MODE_RESTART_ENV_VAR]
    delete process.env[CODE_MODE_RESTARTED_FROM_ENV_VAR]
    delete process.env.CLAUDE_CODE_ASYNC_REPL
    delete process.env.CLAUDE_CODE_POLL_EVENTS
    saveGlobalConfig(current => ({
      ...current,
      codeModeCaveatsAcceptedV1: originalCaveats,
      codeModeAutoModeCaveatAcceptedV1: originalAutoCaveat,
    }))
  })

  test('hasAcceptedCodeModeCaveats and persistCodeModeCaveatsAccepted round-trip via GlobalConfig', () => {
    saveGlobalConfig(current => ({
      ...current,
      codeModeCaveatsAcceptedV1: false,
      codeModeAutoModeCaveatAcceptedV1: false,
    }))
    expect(hasAcceptedCodeModeCaveats()).toBe(false)

    // Partial acceptance is not enough
    saveGlobalConfig(current => ({
      ...current,
      codeModeCaveatsAcceptedV1: true,
      codeModeAutoModeCaveatAcceptedV1: false,
    }))
    expect(hasAcceptedCodeModeCaveats()).toBe(false)

    expect(persistCodeModeCaveatsAccepted()).toBe(true)
    expect(hasAcceptedCodeModeCaveats()).toBe(true)
    const saved = getGlobalConfig()
    expect(saved.codeModeCaveatsAcceptedV1).toBe(true)
    expect(saved.codeModeAutoModeCaveatAcceptedV1).toBe(true)
  })

  test('reviewCodeModeOptInAfterInit returns none / ask / restart_into_mode / restart_without_mode', async () => {
    // Neither on nor dialogOpen -> none
    expect(await reviewCodeModeOptInAfterInit()).toBe('none')

    // Dialog open + caveats not accepted -> ask
    openCodeModeOptInDialog()
    expect(await reviewCodeModeOptInAfterInit({ caveatsAccepted: false })).toBe(
      'ask',
    )

    // Dialog open + caveats already accepted -> restart_into_mode + sets restart env
    const env: Record<string, string | undefined> = {}
    expect(
      await reviewCodeModeOptInAfterInit({ caveatsAccepted: true, env }),
    ).toBe('restart_into_mode')
    expect(env[CODE_MODE_RESTART_ENV_VAR]).toBe('retried')

    // Dialog open + refused by admin -> settles refused and returns none
    expect(await reviewCodeModeOptInAfterInit({ orgDisabled: true })).toBe(
      'none',
    )
    expect(getCodeModeOptInState()).toEqual({ state: 'refused', why: 'admin' })

    // Currently on + refused by compliance -> restart_without_mode + sets restart env
    resetCodeModeOptInStateForTests()
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    const env2: Record<string, string | undefined> = {}
    expect(
      await reviewCodeModeOptInAfterInit({
        isComplianceRestricted: true,
        env: env2,
      }),
    ).toBe('restart_without_mode')
    expect(env2[CODE_MODE_RESTART_ENV_VAR]).toBe('compliance')
  })

  test('confirmCodeModeCaveatsDialog persists caveats and settles on accept, or settles declined on reject', async () => {
    saveGlobalConfig(current => ({
      ...current,
      codeModeCaveatsAcceptedV1: false,
      codeModeAutoModeCaveatAcceptedV1: false,
    }))

    await settleCodeModeOptInAtStartup({
      env: { [CODE_MODE_ENV_VAR]: '1' },
      shellEnv: { [CODE_MODE_ENV_VAR]: '1' },
      caveatsAccepted: false,
    })
    expect(isCodeModeOptInDialogOpen()).toBe(true)

    const outcome = await confirmCodeModeCaveatsDialog(true, 'shell')
    expect(outcome).toBe('restart_into_mode')
    expect(getCodeModeOptInState()).toEqual({ state: 'on', source: 'shell' })
    expect(hasAcceptedCodeModeCaveats()).toBe(true)
    expect(process.env[CODE_MODE_RESTART_ENV_VAR]).toBe('retried')

    // Decline path
    resetCodeModeOptInStateForTests()
    openCodeModeOptInDialog()
    const declineOutcome = await confirmCodeModeCaveatsDialog(false)
    expect(declineOutcome).toBe('none')
    expect(getCodeModeOptInState()).toEqual({
      state: 'refused',
      why: 'declined',
    })
  })

  test('recordCodeModeSignedInAccount and hasCodeModeAccountChanged detect account/tier changes', () => {
    expect(hasCodeModeAccountChanged({ accountUuid: 'a1' })).toBe(false)
    recordCodeModeSignedInAccount({
      accountUuid: 'a1',
      organizationUuid: 'o1',
      subscriptionType: 'max',
      rateLimitTier: 't1',
    })
    expect(
      hasCodeModeAccountChanged({
        accountUuid: 'a1',
        organizationUuid: 'o1',
        subscriptionType: 'max',
        rateLimitTier: 't1',
      }),
    ).toBe(false)
    expect(
      hasCodeModeAccountChanged({
        accountUuid: 'a2',
        organizationUuid: 'o1',
        subscriptionType: 'max',
        rateLimitTier: 't1',
      }),
    ).toBe(true)
    expect(
      hasCodeModeAccountChanged({
        accountUuid: 'a1',
        organizationUuid: 'o1',
        subscriptionType: 'pro',
        rateLimitTier: 't1',
      }),
    ).toBe(true)
  })

  test('isAsyncReplEnabled, isAsyncLaneMode, isPollToolEnabled and Poll visibility in hideCodeModeOnlyTools', () => {
    expect(isAsyncReplEnabled()).toBe(false)
    expect(isAsyncLaneMode('auto')).toBe(false)
    expect(isPollToolEnabled()).toBe(false)

    // Code Mode ON without poll wiring -> still false by default
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    expect(isCodeModeEnabled()).toBe(true)
    expect(isAsyncReplEnabled()).toBe(false)

    // Terminal wiring enables async REPL & Poll
    markPollEventWiringForTerminalRun()
    expect(isAsyncReplEnabled()).toBe(true)
    expect(isPollToolEnabled()).toBe(true)
    expect(isAsyncLaneMode('default')).toBe(false)
    expect(isAsyncLaneMode('auto')).toBe(true)
    expect(isAsyncLaneMode('bypassPermissions')).toBe(true)

    // Explicit falsy env disables async REPL
    process.env.CLAUDE_CODE_ASYNC_REPL = '0'
    expect(isAsyncReplEnabled()).toBe(false)
    delete process.env.CLAUDE_CODE_ASYNC_REPL

    // Test override helper works and resets cleanly
    setAsyncReplEnabledForTests(false)
    expect(isAsyncReplEnabled()).toBe(false)
    setAsyncReplEnabledForTests(true)
    expect(isAsyncReplEnabled()).toBe(true)

    // Print wiring also enables async REPL
    resetCodeModeOptInStateForTests()
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    markPollEventWiringForPrintRun()
    expect(isAsyncReplEnabled()).toBe(true)

    // Poll is preserved by hideCodeModeOnlyTools
    const filtered = hideCodeModeOnlyTools([
      { name: 'REPL' },
      { name: 'Poll' },
      { name: 'StructuredOutput' },
      { name: 'Bash' },
      { name: 'Read' },
      { name: 'mcp__foo__bar', isMcp: true },
    ])
    expect(filtered.map(t => t.name)).toEqual([
      'REPL',
      'Poll',
      'StructuredOutput',
    ])

    // CLAUDE_CODE_POLL_EVENTS enables Poll even when Code Mode is off
    resetCodeModeOptInStateForTests()
    process.env.CLAUDE_CODE_POLL_EVENTS = '1'
    expect(isPollToolEnabled()).toBe(true)
  })

  test('CodeModeOptInDialog renders all 4 caveats paragraphs, cancel-first options, and /feedback footer', async () => {
    const text = await renderToText(
      React.createElement(CodeModeOptInDialog, {
        onDone: () => {},
        onAnswer: () => 'none' as const,
      }),
    )

    const normalized = text.replace(/\s+/g, ' ')
    expect(normalized).toContain('Code Mode (experimental)')
    expect(normalized).toContain(
      'In Code Mode, Claude works by writing and running JavaScript that calls its tools, instead of calling them one at a time.',
    )
    expect(normalized).toContain(
      'Remote Control, Claude in Chrome and computer use are off in Code Mode.',
    )
    expect(normalized).toContain(
      'A session that you start in Code Mode can be resumed only with Code Mode on.',
    )
    expect(normalized).toContain(
      'In auto mode, the safety check reads each piece of JavaScript once, before it runs.',
    )
    expect(text).toContain('No, start without it')
    expect(text).toContain('Yes, turn on Code Mode')
    expect(text).toContain('Tell us how it goes with /feedback')

    // Cancel-first order: "No, start without it" appears before "Yes, turn on Code Mode"
    expect(text.indexOf('No, start without it')).toBeLessThan(
      text.indexOf('Yes, turn on Code Mode'),
    )
  })

  test('CodeModeOptInDialog renders restart messages for restart_into_mode and restart_without_mode', async () => {
    const intoText = await renderToText(
      React.createElement(CodeModeOptInDialog, {
        step: 'restart_into_mode',
        onDone: () => {},
      }),
    )
    expect(intoText).toContain('Restarting Claude Code in Code Mode…')

    const withoutText = await renderToText(
      React.createElement(CodeModeOptInDialog, {
        step: 'restart_without_mode',
        onDone: () => {},
      }),
    )
    expect(withoutText).toContain('Restarting Claude Code without Code Mode…')
  })
})
