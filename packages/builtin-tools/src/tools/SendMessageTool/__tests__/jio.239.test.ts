/**
 * densable 2.1.239 Jio / Zio / Kwm — name [ref] impersonation refuse.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pinDigest } from '../nameResolve.js'
import {
  formatImpersonationDisplay,
  formatImpersonationMessage,
  isImpersonatingOwnSession,
  isOwnSessionNameRefToken,
} from '../ownSession.js'
import {
  getUdsMessagingSocketPath,
  startUdsMessaging,
  stopUdsMessaging,
} from 'src/utils/udsMessaging.js'

describe('densable 2.1.239 Jio impersonation', () => {
  let previousConfigDir: string | undefined
  let tempConfigDir = ''

  function socket(label: string): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\claude-jio-${process.pid}-${label}`
    }
    return join(tempConfigDir, `${label}.sock`)
  }

  beforeEach(async () => {
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempConfigDir = await mkdtemp(join(tmpdir(), 'jio-239-'))
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  })

  afterEach(async () => {
    await stopUdsMessaging()
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    }
    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true })
      tempConfigDir = ''
    }
  })

  test('Zio / Kwm copy', () => {
    expect(formatImpersonationMessage('alpha [abc123]')).toContain(
      'A record impersonating this session is suspicious: ask the user.',
    )
    expect(formatImpersonationDisplay('alpha [abc123]')).toBe(
      "Not sent — 'alpha [abc123]' is this session's own name and ref, but another session record on this machine claims it.",
    )
  })

  test('lRw matches our session ref; Jio when candidate sock is not HFn-ours', async () => {
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    expect(getUdsMessagingSocketPath()).toBe(own)
    const ref = pinDigest('session', own).slice(0, 6)
    const token = `alpha [${ref}]`
    expect(isOwnSessionNameRefToken(token)).toBe(true)
    expect(isImpersonatingOwnSession(token, own)).toBe(false)
    expect(isImpersonatingOwnSession(token, socket('other'))).toBe(true)
    expect(isImpersonatingOwnSession('alpha', socket('other'))).toBe(false)
  })
})
