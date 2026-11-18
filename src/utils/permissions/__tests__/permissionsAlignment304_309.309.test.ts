import { afterEach, describe, expect, test } from 'bun:test'
import {
  applySplendidHorizonBypassDeny,
  findDangerousRemovalReason,
  getSplendidHorizonConfig,
  isHostCardEntrypoint,
} from '../permissions.js'

describe('permissions alignment (#973, #1171)', () => {
  const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  const origDisableRm = process.env.CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT

  afterEach(() => {
    if (origEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
    if (origDisableRm === undefined)
      delete process.env.CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT
    else process.env.CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT = origDisableRm
  })

  test('#1171 isHostCardEntrypoint recognizes Desktop and VS Code entrypoints', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
    expect(isHostCardEntrypoint()).toBe(true)
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode'
    expect(isHostCardEntrypoint()).toBe(true)
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    expect(isHostCardEntrypoint()).toBe(false)
  })

  test('#1171 getSplendidHorizonConfig honors CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT', () => {
    delete process.env.CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT
    expect(getSplendidHorizonConfig().enabled).toBe(true)
    process.env.CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT = '1'
    expect(getSplendidHorizonConfig().enabled).toBe(false)
  })

  test('#1171 applySplendidHorizonBypassDeny denies dangerousRemoval in bypassPermissions on host card', () => {
    const askResult = {
      behavior: 'ask' as const,
      message: 'Use a specific path instead of rm -rf $VAR',
      decisionReason: {
        type: 'safetyCheck' as const,
        reason: 'dangerous removal',
        classifierApprovable: false,
        circuitBreaker: 'dangerousRemoval' as const,
      },
    }
    const denied = applySplendidHorizonBypassDeny(
      askResult,
      'bypassPermissions',
      true,
      {
        enabled: true,
        showDialog: true,
        denyOnHostCard: true,
        timeoutMs: 120_000,
        maxDialogTimeouts: 3,
      },
    )
    expect(denied.behavior).toBe('deny')
    if (denied.behavior === 'deny') {
      expect(denied.message).toContain(
        'Dangerous removal blocked in bypassPermissions mode, not by the user.',
      )
      expect(denied.message).toContain(
        'Use a specific path instead of rm -rf $VAR',
      )
    }

    // Non-host card leaves ask intact
    const kept = applySplendidHorizonBypassDeny(
      askResult,
      'bypassPermissions',
      false,
    )
    expect(kept.behavior).toBe('ask')
  })

  test('#1171 findDangerousRemovalReason unwraps subcommandResults', () => {
    const innerReason = {
      type: 'safetyCheck' as const,
      reason: 'rm -rf /',
      classifierApprovable: false,
      circuitBreaker: 'dangerousRemoval' as const,
    }
    const found = findDangerousRemovalReason({
      type: 'subcommandResults',
      reasons: new Map([
        [
          'rm -rf /',
          {
            behavior: 'ask' as const,
            message: 'dangerous',
            decisionReason: innerReason,
          },
        ],
      ]),
    })
    expect(found).toBe(innerReason)
  })

  test('#1171 applySplendidHorizonBypassDeny denies compound subcommandResults dangerousRemoval and uses inner message', () => {
    const innerReason = {
      type: 'safetyCheck' as const,
      reason: 'rm -rf /',
      classifierApprovable: false,
      circuitBreaker: 'dangerousRemoval' as const,
    }
    const compoundAsk = {
      behavior: 'ask' as const,
      message: 'Outer compound wrapper message',
      decisionReason: {
        type: 'subcommandResults' as const,
        reasons: new Map([
          [
            'rm -rf /',
            {
              behavior: 'ask' as const,
              message: 'Inner dangerous rm rewrite hint',
              decisionReason: innerReason,
            },
          ],
        ]),
      },
    }
    const denied = applySplendidHorizonBypassDeny(
      compoundAsk,
      'bypassPermissions',
      true,
      {
        enabled: true,
        showDialog: true,
        denyOnHostCard: true,
        timeoutMs: 120_000,
        maxDialogTimeouts: 3,
      },
    )
    expect(denied.behavior).toBe('deny')
    if (denied.behavior === 'deny') {
      expect(denied.message).toContain('Inner dangerous rm rewrite hint')
      expect(denied.message).not.toContain('Outer compound wrapper message')
      expect(denied.decisionReason).toBe(innerReason)
    }
  })
})
