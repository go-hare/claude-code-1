import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAIN_RECIPIENT_NAME } from 'src/utils/swarm/constants.js'
import {
  getUdsMessagingSocketPath,
  startUdsMessaging,
  stopUdsMessaging,
} from 'src/utils/udsMessaging.js'
import {
  __resetRegisteredSessionNameForTests,
  getHeldSessionNames,
  getRegisteredSessionName,
  setRegisteredName,
} from 'src/utils/concurrentSessions.js'
import { sessionNameState } from 'src/utils/sessionNameUniqueness.js'
import { pinDigest } from '../nameResolve.js'
import {
  callerIsSubagentFromContext,
  classifyOwnNameTarget,
  describeOwnSession,
  formatOwnNameNotSentDisplay,
  formatOwnSessionListing,
  formatSelfSendMessage,
  isOwnNameSearchComplete,
  isOwnSessionTarget,
  leftoverAmbiguousIsSelfSend,
  leftoverClosestHasSameName,
  leftoverNotFoundIsSelfSend,
  sanitizeOwnSessionName,
} from '../ownSession.js'

describe('densable 2.1.239 #50 DHm / G1w / DEe', () => {
  let previousConfigDir: string | undefined
  let tempConfigDir = ''

  function socket(label: string): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\claude-dhm-${process.pid}-${label}`
    }
    return join(tempConfigDir, `${label}.sock`)
  }

  beforeEach(async () => {
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempConfigDir = await mkdtemp(join(tmpdir(), 'dhm-239-'))
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  })

  afterEach(async () => {
    await stopUdsMessaging()
    __resetRegisteredSessionNameForTests()
    sessionNameState.reset()
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

  test('DHm is null when UDS is down', () => {
    setRegisteredName('alpha-bot', 'user')
    expect(describeOwnSession(false)).toBeNull()
  })

  test('DHm is null when QV is unset', async () => {
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    expect(describeOwnSession(false)).toBeNull()
  })

  test('DHm builds name [socket-ref] and G1w names this session', async () => {
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    expect(getUdsMessagingSocketPath()).toBe(own)
    setRegisteredName('alpha-bot', 'user')
    const self = describeOwnSession(false)
    expect(self?.name).toBe('alpha-bot')
    const ref = pinDigest('session', own).slice(0, 6)
    expect(self?.token).toBe(`alpha-bot [${ref}]`)
    expect(formatOwnSessionListing(self)).toContain(
      'a message to it would be a message to yourself',
    )
    expect(formatOwnSessionListing(self)).toContain(self!.token)
  })

  test('G1w subagent header points at main', async () => {
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    setRegisteredName('alpha-bot', 'user')
    const self = describeOwnSession(true)
    expect(formatOwnSessionListing(self)).toContain(
      `address the main conversation as "${MAIN_RECIPIENT_NAME}"`,
    )
  })

  test('DEe own-name is yourself, not no-agent-named', () => {
    const msg = formatSelfSendMessage('alpha-bot', 'alpha-bot', false)
    expect(msg).toContain('is this session itself')
    expect(msg).toContain('no one else by that name to send to')
    expect(msg).not.toContain('no agent named')
  })

  test('g5: teammateContext or non-main subagent', () => {
    expect(
      callerIsSubagentFromContext({
        teammateContext: undefined,
        agentContext: undefined,
      }),
    ).toBe(false)
    expect(
      callerIsSubagentFromContext({
        teammateContext: { agentId: 'worker-1' },
        agentContext: undefined,
      }),
    ).toBe(true)
    expect(
      callerIsSubagentFromContext({
        teammateContext: undefined,
        agentContext: { agentType: 'subagent' },
      }),
    ).toBe(true)
    expect(
      callerIsSubagentFromContext({
        teammateContext: undefined,
        agentContext: { agentType: 'subagent', isMainSession: true },
      }),
    ).toBe(false)
    expect(
      callerIsSubagentFromContext({
        teammateContext: undefined,
        agentContext: { agentType: 'teammate' },
      }),
    ).toBe(false)
  })

  test('isOwnSessionTarget matches name and token', async () => {
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    setRegisteredName('alpha-bot', 'user')
    const self = describeOwnSession(false)!
    expect(isOwnSessionTarget('alpha-bot', self)).toBe(true)
    expect(isOwnSessionTarget(self.token, self)).toBe(true)
    expect(isOwnSessionTarget('other', self)).toBe(false)
    setRegisteredName(MAIN_RECIPIENT_NAME, 'user')
    expect(describeOwnSession()).toBeNull()
  })

  test('sWt own-name display', () => {
    expect(formatOwnNameNotSentDisplay('alpha-bot')).toBe(
      "Not sent — 'alpha-bot' is this session's own name.",
    )
  })

  test('MFn reuses ALe + ELe + MAIN reject', () => {
    expect(sanitizeOwnSessionName('')).toBe('untitled session')
    expect(sanitizeOwnSessionName('  hello   world  ')).toBe('hello world')
    expect(sanitizeOwnSessionName(MAIN_RECIPIENT_NAME)).toBeNull()
    expect(sanitizeOwnSessionName('foo@bar')).toBeNull()
    expect(sanitizeOwnSessionName('*')).toBeNull()
  })

  test('Qen is no without inbox, QV, or other-scheme', async () => {
    expect(classifyOwnNameTarget('alpha-bot')).toBe('no')
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    expect(classifyOwnNameTarget('alpha-bot')).toBe('no')
    setRegisteredName('alpha-bot', 'derived')
    expect(classifyOwnNameTarget('uds:/tmp/x.sock')).toBe('no')
    expect(classifyOwnNameTarget('random-other-name')).toBe('no')
  })

  test('Qen uses QV source + userTypedName, not session title', async () => {
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    setRegisteredName('alpha-bot', 'derived')
    sessionNameState.userTypedName = 'something-else'
    expect(classifyOwnNameTarget('alpha-bot')).toBe('categorical')

    setRegisteredName('alpha-bot', 'user')
    sessionNameState.userTypedName = 'alpha-bot'
    expect(classifyOwnNameTarget('alpha-bot')).toBe('categorical')

    sessionNameState.userTypedName = 'typed-other'
    expect(classifyOwnNameTarget('alpha-bot')).toBe('note')
  })

  test('Qen name-ref consults heldNames when the label is a former name', async () => {
    const own = socket('own')
    await startUdsMessaging(own, { isExplicit: true })
    const ref = pinDigest('session', own).slice(0, 8)
    setRegisteredName('old-name', 'derived')
    setRegisteredName('new-name', 'user')
    expect(classifyOwnNameTarget(`old-name [${ref}]`)).toBe('categorical')
    expect(classifyOwnNameTarget(`never-held [${ref}]`)).toBe('no')

    setRegisteredName('older-user', 'user')
    setRegisteredName('newest', 'user')
    expect(classifyOwnNameTarget(`older-user [${ref}]`)).toBe('note')
  })

  test('setRegisteredName same Vu-key keeps since and skips heldNames', () => {
    setRegisteredName('Alpha Bot', 'user')
    const since = getRegisteredSessionName()!.since
    setRegisteredName('alpha-bot', 'collision')
    expect(getRegisteredSessionName()).toEqual({
      name: 'alpha-bot',
      source: 'collision',
      since,
    })
    expect(getHeldSessionNames().size).toBe(0)
  })

  test('leftover Zen is false when truncated or claimed locally', () => {
    expect(isOwnNameSearchComplete({})).toBe(true)
    expect(isOwnNameSearchComplete({ searchTruncated: true })).toBe(false)
    expect(
      isOwnNameSearchComplete({ pinnedIdentityClaimedLocally: 'alpha' }),
    ).toBe(false)
  })

  test('not-found DEe needs categorical + no closest same-name + Zen', () => {
    const same = [{ name: 'alpha-bot' }]
    const other = [{ name: 'alpha-bot-2' }]
    expect(leftoverClosestHasSameName('alpha-bot', same)).toBe(true)
    expect(leftoverClosestHasSameName('alpha-bot [abcdef]', same)).toBe(true)
    expect(leftoverClosestHasSameName('alpha-bot', other)).toBe(false)
    expect(
      leftoverNotFoundIsSelfSend('categorical', 'alpha-bot', same, true),
    ).toBe(false)
    expect(
      leftoverNotFoundIsSelfSend('categorical', 'alpha-bot', other, true),
    ).toBe(true)
    expect(leftoverNotFoundIsSelfSend('note', 'alpha-bot', other, true)).toBe(
      false,
    )
    expect(
      leftoverNotFoundIsSelfSend('categorical', 'alpha-bot', other, false),
    ).toBe(false)
  })

  test('ambiguous DEe needs categorical + matchedBy prefix + Zen', () => {
    expect(leftoverAmbiguousIsSelfSend('categorical', 'prefix', true)).toBe(
      true,
    )
    expect(leftoverAmbiguousIsSelfSend('categorical', 'exact', true)).toBe(
      false,
    )
    expect(leftoverAmbiguousIsSelfSend('note', 'prefix', true)).toBe(false)
    expect(leftoverAmbiguousIsSelfSend('categorical', 'prefix', false)).toBe(
      false,
    )
  })
})
