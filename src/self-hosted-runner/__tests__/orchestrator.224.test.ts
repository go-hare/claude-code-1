/**
 * densable 2.1.224 #1 — orchestrator parse/claims/secret/pool_id.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ORCH_DEFAULT_API_URL,
  ORCH_DEFAULT_EXPECTED_SPAWN_SECONDS,
  ORCH_DEFAULT_HOOK_CONCURRENCY,
  ORCH_DEFAULT_HOOK_TIMEOUT_MS,
  ORCH_SIGKILL_GRACE_MS,
  clockSkewMs,
  coerceAttempt,
  extractPoolIdFromSecret,
  extractSpawnHintClaims,
  formatOrchestratorHelp,
  hasControlChars,
  isSafeGitRevision,
  isSafeGitUrl,
  parseOrchestratorArgs,
  parseScmConnectorHost,
  resolveOrchestratorPoolSecret,
  validateSpawnRunnerHook,
} from '../orchestrator.js'

const saved: Record<string, string | undefined> = {}
function setEnv(k: string, v: string | undefined): void {
  if (!(k in saved)) saved[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
  delete process.env.SELF_HOSTED_RUNNER_HOOKS_DIR
  delete process.env.SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET
  delete process.env.SELF_HOSTED_RUNNER_POOL_SECRET
})

function fakeJwt(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${h}.${p}.sig`
}

describe('densable 2.1.224 #1 orchestrator constants', () => {
  test('defaults match SEA', () => {
    expect(ORCH_DEFAULT_API_URL).toBe('https://api.anthropic.com')
    expect(ORCH_DEFAULT_HOOK_CONCURRENCY).toBe(4)
    expect(ORCH_DEFAULT_HOOK_TIMEOUT_MS).toBe(60_000)
    expect(ORCH_DEFAULT_EXPECTED_SPAWN_SECONDS).toBe(120)
    expect(ORCH_SIGKILL_GRACE_MS).toBe(5_000)
  })
})

describe('densable 2.1.224 #1 parseOrchestratorArgs (jFh)', () => {
  test('defaults', () => {
    const a = parseOrchestratorArgs([])
    expect(a.apiUrl).toBe(ORCH_DEFAULT_API_URL)
    expect(a.hookConcurrency).toBe(4)
    expect(a.hookTimeoutMs).toBe(60_000)
    expect(a.expectedSpawnSeconds).toBe(120)
    expect(a.minIdle).toBe(0)
    expect(a.healthPort).toBe(8080)
  })

  test('flags', () => {
    const a = parseOrchestratorArgs([
      '--api-url',
      'https://x.test',
      '--hooks-dir',
      '/hooks',
      '--hook-concurrency',
      '8',
      '--hook-timeout',
      '30',
      '--expected-spawn-seconds',
      '90',
      '--min-idle',
      '2',
      '--health-port',
      '0',
      '--log-level',
      'debug',
    ])
    expect(a.apiUrl).toBe('https://x.test')
    expect(a.hooksDir).toBe('/hooks')
    expect(a.hookConcurrency).toBe(8)
    expect(a.hookTimeoutMs).toBe(30_000)
    expect(a.expectedSpawnSeconds).toBe(90)
    expect(a.minIdle).toBe(2)
    expect(a.healthPort).toBe(0)
    expect(a.logLevel).toBe('debug')
  })

  test('hook-timeout + grace must be < expected-spawn-seconds', () => {
    expect(() =>
      parseOrchestratorArgs([
        '--hook-timeout',
        '120',
        '--expected-spawn-seconds',
        '120',
      ]),
    ).toThrow(/SIGKILL grace/)
  })

  test('scm connector requires id with host', () => {
    expect(() =>
      parseOrchestratorArgs(['--scm-connector-host', 'ghe.example.com']),
    ).toThrow(/scm-connector-id/)
  })

  test('scm connector full', () => {
    const a = parseOrchestratorArgs([
      '--scm-connector-host',
      'ghe.example.com:8443',
      '--scm-connector-id',
      '42',
      '--scm-connector-provider',
      'ghe',
    ])
    expect(a.scmConnector?.host).toBe('ghe.example.com')
    expect(a.scmConnector?.port).toBe(8443)
    expect(a.scmConnector?.connectorId).toBe(42)
  })

  test('unknown flag', () => {
    expect(() => parseOrchestratorArgs(['--nope'])).toThrow(/unknown flag/)
  })
})

describe('densable 2.1.224 #1 orchestrator helpers', () => {
  test('parseScmConnectorHost (HJl)', () => {
    expect(parseScmConnectorHost('ghe.example.com')).toEqual({
      host: 'ghe.example.com',
      port: 443,
    })
    expect(() => parseScmConnectorHost('https://x')).toThrow()
  })

  test('extractPoolIdFromSecret (WFh)', () => {
    const tok = fakeJwt({ 'ccr:pool_id': 'ccpool_abc' })
    expect(extractPoolIdFromSecret(tok)).toBe('ccpool_abc')
    expect(extractPoolIdFromSecret(`sk-ant-si-${tok}`)).toBe('ccpool_abc')
    expect(() => extractPoolIdFromSecret(fakeJwt({}))).toThrow(/ccr:pool_id/)
  })

  test('extractSpawnHintClaims (VFh)', () => {
    const jwt = fakeJwt({
      jti: 'j1',
      'ccr:pool_id': 'ccpool_1',
      'ccr:spawn_account_id': 'acc',
      'ccr:spawn_account_email': 'a@b.c',
    })
    const claims = extractSpawnHintClaims(
      {
        session_uuid: 'sess',
        attempt: 2,
        work_order_jwt: jwt,
        sources: [{ url: 'https://github.com/a/b', revision: 'main' }],
        jti: 'j1',
      },
      'Wed, 01 Jan 2020 00:00:00 GMT',
    )
    expect(claims.jti).toBe('j1')
    expect(claims.session_id).toBe('sess')
    expect(claims.attempt).toBe(2)
    expect(claims.pool_id).toBe('ccpool_1')
    expect(claims.account_email).toBe('a@b.c')
    expect(claims.primary_repo_url).toBe('https://github.com/a/b')
    expect(claims.server_time).toContain('2020')
  })

  test('coerceAttempt / clockSkew / safety', () => {
    expect(coerceAttempt('12')).toBe(12)
    expect(coerceAttempt(3)).toBe(3)
    expect(clockSkewMs(undefined)).toBeNull()
    expect(hasControlChars('ok')).toBe(false)
    expect(hasControlChars('a\nb')).toBe(true)
    expect(isSafeGitRevision('main')).toBe(true)
    expect(isSafeGitRevision('../x')).toBe(false)
    expect(isSafeGitUrl('https://github.com/a/b')).toBe(true)
    expect(isSafeGitUrl('file:///etc/passwd')).toBe(false)
  })

  test('resolveOrchestratorPoolSecret (QFh)', async () => {
    setEnv('SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET', ' envsec ')
    expect(
      await resolveOrchestratorPoolSecret({ poolSecretFile: undefined }),
    ).toBe('envsec')
  })

  test('validateSpawnRunnerHook (zFh)', async () => {
    const dir = join(tmpdir(), `orch-hook-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const hook = join(dir, 'spawn-runner')
    writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    chmodSync(hook, 0o755)
    expect(await validateSpawnRunnerHook(dir)).toBe(hook)
    await expect(validateSpawnRunnerHook(undefined)).rejects.toThrow(
      /hooks-dir/,
    )
  })

  test('help mentions spawn-runner', () => {
    expect(formatOrchestratorHelp()).toContain('spawn-runner')
    expect(formatOrchestratorHelp()).toContain('--hook-concurrency')
  })
})
