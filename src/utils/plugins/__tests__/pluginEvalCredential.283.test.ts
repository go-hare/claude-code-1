import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'fs/promises'
import {
  EVAL_CREDENTIAL_FD,
  EvalTokenGate,
  evalOauthExpiryWarning,
  injectEvalCredential,
  resolveEvalCredential,
  type EvalCredential,
} from '../pluginEval/evalCredential.js'

const temps: string[] = []

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe('densable xa/zi/ap eval credential', () => {
  test('zi enter/leave does not throw', async () => {
    const gate = new EvalTokenGate()
    await gate.enter()
    expect(gate.holding).toBe(1)
    gate.leave()
    expect(gate.holding).toBe(0)
  })

  test('zi rotate skip backoff does not throw', async () => {
    const gate = new EvalTokenGate(10)
    await gate.enter()
    const expiry = Date.now() - 1
    await gate.rotate(expiry, Date.now() + 60_000, async () => expiry)
    await gate.rotate(expiry, Date.now() + 60_000, async () => {
      throw new Error('should skip')
    })
    gate.leave()
  })

  test('xa warning copy contains before this run', () => {
    expect(evalOauthExpiryWarning(3, 120)).toContain("before this run's")
    expect(evalOauthExpiryWarning(3, 120)).toContain('120s timeout')
  })

  test('xa with no gateway and no oauth is null or object', async () => {
    const gate = new EvalTokenGate()
    const cred = await resolveEvalCredential(30, (a, b, c) =>
      gate.rotate(a, b, c),
    )
    expect(cred === null || typeof cred === 'object').toBe(true)
    if (cred && cred.kind === 'oauth') {
      expect(typeof cred.accessToken).toBe('string')
    }
  })

  test('ap oauth unix viaFd true and env key present', async () => {
    if (process.platform === 'win32') return
    const cred: EvalCredential = {
      kind: 'oauth',
      accessToken: 'tok',
      scopes: ['user:inference'],
      subscriptionType: null,
      rateLimitTier: null,
    }
    const injected = await injectEvalCredential(cred)
    expect(injected.viaFd).toBe(true)
    expect(injected.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBe(
      String(EVAL_CREDENTIAL_FD),
    )
    expect(injected.env.CLAUDE_CODE_OAUTH_SCOPES).toBe('user:inference')
    await injected.cleanup()
  })

  test('ap gateway unix sets GATEWAY fd and base url', async () => {
    if (process.platform === 'win32') return
    const injected = await injectEvalCredential({
      kind: 'gateway',
      url: 'https://gw.example',
      jwt: 'jwt',
    })
    expect(injected.viaFd).toBe(true)
    expect(injected.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR).toBe('3')
    expect(injected.env.CLAUDE_CODE_USE_GATEWAY).toBe('1')
    expect(injected.env.ANTHROPIC_BASE_URL).toBe('https://gw.example')
    await injected.cleanup()
  })
})
