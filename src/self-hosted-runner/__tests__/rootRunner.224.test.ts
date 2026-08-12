/**
 * densable 2.1.224 #1 — root runner parseArgs / secret / exec / poll helpers.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  BASE_DIR_CHECK_TIMEOUT_MS,
  DEFAULT_API_URL,
  DEFAULT_BASE_DIR,
  DEFAULT_CAPACITY,
  DEFAULT_HEALTH_PORT,
  TRUST_WORKSPACE_DEFAULT,
  computeShutdownBudgetSec,
  derivePollInterval,
  ensureBaseDirWritable,
  formatRootHelp,
  parseConfineRepoSettingsEnv,
  parseHealthPortEnv,
  parseRootArgs,
  parseTrustWorkspaceEnv,
  readEnvMs,
  readRetireAtEnvMs,
  resolveEnvironmentSecret,
  resolveExec,
  sessionBoundCapacityWarning,
  extractSpawnSessionId,
  selfHostedRunnerMain,
} from '../rootRunner.js'

const src = readFileSync(join(import.meta.dir, '../rootRunner.ts'), 'utf8')

const savedEnv: Record<string, string | undefined> = {}
function setEnv(k: string, v: string | undefined): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  // parseRootArgs mutates these; clear so later tests see densable defaults
  for (const k of [
    'SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS',
    'SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS',
    'SELF_HOSTED_RUNNER_MAX_LIFETIME_MS',
    'SELF_HOSTED_RUNNER_IDLE_SHUTDOWN_MS',
    'SELF_HOSTED_RUNNER_SESSION_IDLE_MS',
    'SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS',
    'SELF_HOSTED_RUNNER_DRAIN_WAIT_MS',
    'SELF_HOSTED_RUNNER_DRAIN_GRACE_MS',
    'SELF_HOSTED_RUNNER_RETIRE_AT',
    'SELF_HOSTED_RUNNER_HOOKS_DIR',
  ]) {
    delete process.env[k]
  }
})

describe('densable 2.1.224 #1 rootRunner constants + helpers', () => {
  test('defaults match SEA (hBh/gBh/SBh/TBh/tXl)', () => {
    expect(DEFAULT_API_URL).toBe('https://api.anthropic.com')
    expect(DEFAULT_CAPACITY).toBe(1)
    expect(DEFAULT_BASE_DIR).toBe('/workspace')
    expect(DEFAULT_HEALTH_PORT).toBe(8080)
    expect(TRUST_WORKSPACE_DEFAULT).toBe(true)
  })

  test('readEnvMs (MV)', () => {
    setEnv('SELF_HOSTED_RUNNER_TEST_MS', '1500')
    expect(readEnvMs('SELF_HOSTED_RUNNER_TEST_MS')).toBe(1500)
    setEnv('SELF_HOSTED_RUNNER_TEST_MS', '0')
    expect(readEnvMs('SELF_HOSTED_RUNNER_TEST_MS')).toBe(0)
    setEnv('SELF_HOSTED_RUNNER_TEST_MS', undefined)
    expect(readEnvMs('SELF_HOSTED_RUNNER_TEST_MS')).toBe(0)
  })

  test('readRetireAtEnvMs (bBh)', () => {
    setEnv('SELF_HOSTED_RUNNER_RETIRE_AT', '1700000000')
    expect(readRetireAtEnvMs()).toBe(1_700_000_000_000)
    setEnv('SELF_HOSTED_RUNNER_RETIRE_AT', '99')
    expect(readRetireAtEnvMs()).toBe(0)
  })

  test('parseHealthPortEnv (ozv)', () => {
    expect(parseHealthPortEnv(undefined, 8080)).toBe(8080)
    expect(parseHealthPortEnv('0', 8080)).toBe(0)
    expect(() => parseHealthPortEnv('99999', 8080)).toThrow(/\[0, 65535\]/)
  })

  test('parseTrustWorkspaceEnv (izv)', () => {
    expect(parseTrustWorkspaceEnv(undefined)).toBe(true)
    expect(parseTrustWorkspaceEnv('0')).toBe(false)
    expect(parseTrustWorkspaceEnv('yes')).toBe(true)
    expect(() => parseTrustWorkspaceEnv('maybe')).toThrow(/TRUST_WORKSPACE/)
  })

  test('parseConfineRepoSettingsEnv (szv)', () => {
    expect(parseConfineRepoSettingsEnv(undefined)).toBe('warn')
    expect(parseConfineRepoSettingsEnv('enforce')).toBe('enforce')
    expect(() => parseConfineRepoSettingsEnv('strict')).toThrow(
      /enforce\/warn\/off/,
    )
  })

  test('computeShutdownBudgetSec (XJl)', () => {
    // 5000+60000+0+0+15000 = 80000 → 80s
    expect(computeShutdownBudgetSec(5000, 60000)).toBe(80)
  })

  test('derivePollInterval (IBh)', () => {
    expect(derivePollInterval(undefined)).toBe(20_000)
    const now = Date.now()
    // lease in 90s → floor(90000/3)=30000 clamped max
    expect(derivePollInterval(new Date(now + 90_000).toISOString(), now)).toBe(
      30_000,
    )
    // lease past → min 5000
    expect(derivePollInterval(new Date(now - 1000).toISOString(), now)).toBe(
      5_000,
    )
  })

  test('extractSpawnSessionId (L2h) + sessionBoundCapacityWarning (CBh)', () => {
    expect(extractSpawnSessionId('env-secret')).toBeNull()
    expect(sessionBoundCapacityWarning('env-secret', 1)).toBeNull()
    expect(sessionBoundCapacityWarning('env-secret', 4)).toBeNull()
    // forge JWT payload with ccr:spawn_session_id
    const hdr = Buffer.from('{"alg":"none"}').toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ 'ccr:spawn_session_id': 'cse_bound_1' }),
    ).toString('base64url')
    // densable L2h strip is /^sk-ant-[a-z]+-/ (letters only in middle segment)
    const jwtPlain = `${hdr}.${payload}.sig`
    expect(extractSpawnSessionId(jwtPlain)).toBe('cse_bound_1')
    expect(sessionBoundCapacityWarning(jwtPlain, 3)).toContain('--capacity 3')
    const withPrefix = `sk-ant-api-${hdr}.${payload}.sig`
    expect(extractSpawnSessionId(withPrefix)).toBe('cse_bound_1')
  })
})

describe('densable 2.1.224 #1 rootRunner parseRootArgs (wBh)', () => {
  test('defaults + capacity/base-dir/api-url', () => {
    const a = parseRootArgs([
      '--capacity',
      '2',
      '--base-dir',
      '/tmp/ws',
      '--api-url',
      'https://api.example.test',
    ])
    expect(a.capacity).toBe(2)
    expect(a.baseDir).toBe(pathResolveLocal('/tmp/ws'))
    expect(a.apiUrl).toBe('https://api.example.test')
    expect(a.healthPort).toBe(8080)
  })

  test('environment-secret-file + deprecated pool-secret-file warn', () => {
    const a = parseRootArgs(['--environment-secret-file', '/secrets/env'])
    expect(a.poolSecretFile).toBe('/secrets/env')
  })

  test('git-host-rewrite + duplicate error', () => {
    const a = parseRootArgs([
      '--git-host-rewrite',
      'Ext.Example.com=int.example.com',
    ])
    expect(a.gitHostRewrites).toEqual([['ext.example.com', 'int.example.com']])
    expect(() =>
      parseRootArgs(['--git-host-rewrite', 'a=b', '--git-host-rewrite', 'a=c']),
    ).toThrow(/duplicate/)
  })

  test('git-host-rewrite rejects URLs', () => {
    expect(() =>
      parseRootArgs(['--git-host-rewrite', 'https://a=https://b']),
    ).toThrow(/bare hostnames/)
  })

  test('unknown flag / positional rejected', () => {
    expect(() => parseRootArgs(['--nope'])).toThrow(/unknown flag/)
    expect(() => parseRootArgs(['positional'])).toThrow(/no positional/)
  })

  test('sigkill rename error', () => {
    expect(() => parseRootArgs(['--sigkill-timeout-sec', '5'])).toThrow(
      /session-stop-grace-sec/,
    )
  })

  test('session-stop-grace-sec sets env ms', () => {
    parseRootArgs(['--session-stop-grace-sec', '7'])
    expect(process.env.SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS).toBe('7000')
  })

  test('kill-session-after-min sets env + envSetByFlag', () => {
    const a = parseRootArgs(['--kill-session-after-min', '30'])
    expect(process.env.SELF_HOSTED_RUNNER_MAX_LIFETIME_MS).toBe(
      String(30 * 60 * 1000),
    )
    expect(a.envSetByFlag.has('SELF_HOSTED_RUNNER_MAX_LIFETIME_MS')).toBe(true)
  })

  test('retire-at validation', () => {
    expect(() => parseRootArgs(['--retire-at', '99'])).toThrow(/Unix timestamp/)
    parseRootArgs(['--retire-at', '1700000000'])
    expect(process.env.SELF_HOSTED_RUNNER_RETIRE_AT).toBe('1700000000')
  })

  test('health-port bounds', () => {
    expect(() => parseRootArgs(['--health-port', '-1'])).toThrow(/65535/)
    expect(parseRootArgs(['--health-port', '0']).healthPort).toBe(0)
  })
})

function pathResolveLocal(p: string): string {
  return require('node:path').resolve(p) as string
}

describe('densable 2.1.224 #1 rootRunner resolveEnvironmentSecret (ABh)', () => {
  test('from env SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET', async () => {
    setEnv('SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET', '  secret-a  ')
    setEnv('SELF_HOSTED_RUNNER_POOL_SECRET', undefined)
    const s = await resolveEnvironmentSecret({ poolSecretFile: undefined })
    expect(s).toBe('secret-a')
  })

  test('deprecated POOL_SECRET fallback', async () => {
    setEnv('SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET', undefined)
    setEnv('SELF_HOSTED_RUNNER_POOL_SECRET', 'pool-legacy')
    const s = await resolveEnvironmentSecret({ poolSecretFile: undefined })
    expect(s).toBe('pool-legacy')
  })

  test('from file', async () => {
    const dir = join(tmpdir(), `shr-secret-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'secret')
    writeFileSync(f, '  file-secret\n', 'utf8')
    const s = await resolveEnvironmentSecret({ poolSecretFile: f })
    expect(s).toBe('file-secret')
  })

  test('missing secret throws densable message', async () => {
    setEnv('SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET', undefined)
    setEnv('SELF_HOSTED_RUNNER_POOL_SECRET', undefined)
    await expect(
      resolveEnvironmentSecret({ poolSecretFile: undefined }),
    ).rejects.toThrow(/No environment secret provided/)
  })
})

describe('densable 2.1.224 #1 rootRunner resolveExec (RBh)', () => {
  test('explicit exec path', () => {
    expect(resolveExec('/usr/bin/claude')).toEqual({
      execPath: '/usr/bin/claude',
      execArgs: [],
    })
  })

  test('default uses process.execPath', () => {
    const r = resolveExec(undefined)
    expect(r.execPath).toBe(process.execPath)
  })
})

describe('densable 2.1.224 #1 rootRunner help + main register', () => {
  test('formatRootHelp includes densable Usage line', () => {
    const h = formatRootHelp()
    expect(h).toContain('Usage: claude self-hosted-runner [options]')
    expect(h).toContain('--environment-secret-file')
    expect(h).toContain(DEFAULT_API_URL)
  })

  test('selfHostedRunnerMain --help does not require secret', async () => {
    await selfHostedRunnerMain(['--help'])
  })

  test('selfHostedRunnerMain registers then skips poll when enterPollLoop=false', async () => {
    setEnv('SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET', 'test-secret')
    // densable 2.1.225 izh: baseDir must be writable; default /workspace is often EROFS.
    const baseDir = join(
      tmpdir(),
      `shr-base-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    const registerRunner = mock(async () => ({
      runner_id: 'r_test',
      runner_token: 'rtok',
    }))
    const pollWork = mock(async () => ({
      assignment_ids: [] as string[],
      session_assignments: [],
    }))
    const deregisterRunner = mock(async () => {})
    const api = {
      registerRunner,
      pollWork,
      deregisterRunner,
      refreshToken: mock(async () => ({ token: 'x' })),
    }
    await selfHostedRunnerMain(
      ['--capacity', '1', '--health-port', '0', '--base-dir', baseDir],
      {
        enterPollLoop: false,
        apiFactory: () => api as never,
        hostname: () => 'test-host',
      },
    )
    expect(registerRunner).toHaveBeenCalledTimes(1)
    expect(registerRunner.mock.calls[0] as unknown[]).toEqual([
      'test-host',
      undefined,
    ])
    expect(pollWork).not.toHaveBeenCalled()
  })

  test('densable 2.1.225 ensureBaseDirWritable creates + accepts writable dir', async () => {
    const baseDir = join(
      tmpdir(),
      `shr-izh-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await ensureBaseDirWritable(baseDir)
    // idempotent
    await ensureBaseDirWritable(baseDir)
  })

  test('densable 2.1.225 ensureBaseDirWritable throws on unwritable path', async () => {
    // Prefer a path that cannot exist as a creatable dir (file path as baseDir).
    const filePath = join(
      tmpdir(),
      `shr-izh-file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    writeFileSync(filePath, 'not-a-dir')
    await expect(ensureBaseDirWritable(filePath)).rejects.toThrow(
      /cannot create or write to base directory/,
    )
  })
})

describe('densable 2.1.224 #1 rootRunner source gold', () => {
  test('exports densable names', () => {
    expect(src).toContain('export function parseRootArgs')
    expect(src).toContain('export async function resolveEnvironmentSecret')
    expect(src).toContain('export function resolveExec')
    expect(src).toContain('export async function selfHostedRunnerMain')
    expect(src).toContain('export async function runPollSkeleton')
    expect(src).toContain('export function derivePollInterval')
    expect(src).toContain("DEFAULT_BASE_DIR = '/workspace'")
    expect(src).toContain('--environment-secret-file')
    expect(src).toContain('SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET')
    // densable 2.1.225 #9
    expect(src).toContain('export async function ensureBaseDirWritable')
    expect(src).toContain('BASE_DIR_CHECK_TIMEOUT_MS')
    expect(src).toContain('10_000')
    expect(BASE_DIR_CHECK_TIMEOUT_MS).toBe(10_000)
  })
})
