/**
 * densable 2.1.248 #3 — `--client-label` / SELF_HOSTED_RUNNER_CLIENT_LABEL.
 * Gold: gold-248-feat-3.txt — parse trim, env trim||void 0, ye=t.clientLabel??Go().
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatRootHelp,
  parseRootArgs,
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
  delete process.env.SELF_HOSTED_RUNNER_CLIENT_LABEL
  delete process.env.SELF_HOSTED_RUNNER_LOCK_TO_ACCOUNT
})

function mockRegisterApi() {
  const registerRunner = mock(async () => ({
    runner_id: 'r_label',
    runner_token: 'rtok',
  }))
  return {
    registerRunner,
    api: {
      registerRunner,
      pollWork: mock(async () => ({
        assignment_ids: [] as string[],
        session_assignments: [],
      })),
      deregisterRunner: mock(async () => {}),
      refreshToken: mock(async () => ({ token: 'x' })),
    },
  }
}

async function registerOnce(
  argv: string[],
  hostname = 'test-host',
): Promise<unknown[]> {
  setEnv('SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET', 'test-secret')
  const baseDir = join(
    tmpdir(),
    `shr-clabel-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const { registerRunner, api } = mockRegisterApi()
  await selfHostedRunnerMain(
    ['--health-port', '0', '--base-dir', baseDir, ...argv],
    {
      enterPollLoop: false,
      apiFactory: () => api as never,
      hostname: () => hostname,
    },
  )
  expect(registerRunner).toHaveBeenCalledTimes(1)
  return registerRunner.mock.calls[0] as unknown[]
}

describe('densable 2.1.248 #3 --client-label parse/env', () => {
  test('env SELF_HOSTED_RUNNER_CLIENT_LABEL is trimmed', () => {
    setEnv('SELF_HOSTED_RUNNER_CLIENT_LABEL', '  vm-a  ')
    expect(parseRootArgs([]).clientLabel).toBe('vm-a')
  })

  test('empty / whitespace env becomes undefined', () => {
    setEnv('SELF_HOSTED_RUNNER_CLIENT_LABEL', '')
    expect(parseRootArgs([]).clientLabel).toBeUndefined()
    setEnv('SELF_HOSTED_RUNNER_CLIENT_LABEL', '   ')
    expect(parseRootArgs([]).clientLabel).toBeUndefined()
    setEnv('SELF_HOSTED_RUNNER_CLIENT_LABEL', undefined)
    expect(parseRootArgs([]).clientLabel).toBeUndefined()
  })

  test('flag sets trimmed clientLabel', () => {
    expect(parseRootArgs(['--client-label', '  pod-7  ']).clientLabel).toBe(
      'pod-7',
    )
  })

  test('flag does not consume a following --flag', () => {
    const a = parseRootArgs(['--client-label', '--lock-to-account', 'acct_1'])
    expect(a.clientLabel).toBeUndefined()
    expect(a.lockToAccountId).toBe('acct_1')
  })

  test('flag missing / whitespace value is ignored (no throw)', () => {
    expect(parseRootArgs(['--client-label']).clientLabel).toBeUndefined()
    expect(() => parseRootArgs(['--client-label', '   '])).toThrow(
      /no positional/,
    )
  })

  test('flag overrides env', () => {
    setEnv('SELF_HOSTED_RUNNER_CLIENT_LABEL', 'from-env')
    expect(parseRootArgs(['--client-label', 'from-flag']).clientLabel).toBe(
      'from-flag',
    )
  })
})

describe('densable 2.1.248 #3 formatRootHelp', () => {
  test('help sits after lock-to-account with gold copy + env', () => {
    const h = formatRootHelp()
    const lock = h.indexOf('--lock-to-account <id>')
    const label = h.indexOf('--client-label <label>')
    const proxy = h.indexOf('--proxy-authorization-command')
    expect(lock).toBeGreaterThan(-1)
    expect(label).toBeGreaterThan(lock)
    expect(proxy).toBeGreaterThan(label)
    expect(h).toContain(
      'Observability label sent at registration (default: hostname). Shown',
    )
    expect(h).toContain(
      'beside the runner in the Anthropic console; never used for',
    )
    expect(h).toContain(
      'authorization or routing. Set it when the hostname is not',
    )
    expect(h).toContain('meaningful, e.g. to a VM or container name.')
    expect(h).toContain('[env: SELF_HOSTED_RUNNER_CLIENT_LABEL]')
  })
})

describe('densable 2.1.248 #3 register ye=t.clientLabel??hostname()', () => {
  test('unset label registers hostname (Go default kept)', async () => {
    expect(await registerOnce([])).toEqual(['test-host', undefined])
  })

  test('flag overrides hostname at register', async () => {
    expect(await registerOnce(['--client-label', 'vm-west'])).toEqual([
      'vm-west',
      undefined,
    ])
  })

  test('env overrides hostname at register', async () => {
    setEnv('SELF_HOSTED_RUNNER_CLIENT_LABEL', '  env-box  ')
    expect(await registerOnce([])).toEqual(['env-box', undefined])
  })

  test('source is args.clientLabel ?? hostname()', () => {
    expect(src).toContain('args.clientLabel ??')
    expect(src).toContain(
      'process.env.SELF_HOSTED_RUNNER_CLIENT_LABEL?.trim() || undefined',
    )
    expect(src).toContain("case '--client-label':")
    expect(src).toContain('if (i && !i.startsWith')
  })
})
