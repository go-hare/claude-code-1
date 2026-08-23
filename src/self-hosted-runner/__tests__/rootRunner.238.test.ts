/**
 * densable 2.1.238 #4/#5 — Batch3a parse/help/env for defer-shutdown + proxy-authorization.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { resolve as pathResolve } from 'node:path'
import {
  MAX_MINUTES_FLAG,
  formatRootHelp,
  formatShutdownSignalContext,
  parseRootArgs,
  readDeferShutdownMaxMs,
  readUpstreamHttpProxyUrl,
  resolveProxyAuthorizationConfig,
  resolveProxyAuthorizationSource,
  runPollSkeleton,
} from '../rootRunner.js'
import { createRunnerHealthState } from '../healthMetrics.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  for (const k of [
    'SELF_HOSTED_RUNNER_DEFER_SHUTDOWN_MAX_MS',
    'SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_COMMAND',
    'SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_FILE',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'https_proxy',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]) {
    delete process.env[k]
  }
})

describe('densable 2.1.238 #4 --defer-shutdown-max-min', () => {
  test('parse sets SELF_HOSTED_RUNNER_DEFER_SHUTDOWN_MAX_MS (minutes→ms) + envSetByFlag', () => {
    const a = parseRootArgs(['--defer-shutdown-max-min', '15'])
    expect(process.env.SELF_HOSTED_RUNNER_DEFER_SHUTDOWN_MAX_MS).toBe(
      String(15 * 60 * 1000),
    )
    expect(a.envSetByFlag.has('SELF_HOSTED_RUNNER_DEFER_SHUTDOWN_MAX_MS')).toBe(
      true,
    )
    expect(readDeferShutdownMaxMs()).toBe(15 * 60 * 1000)
  })

  test('0 disables (writes 0 ms)', () => {
    parseRootArgs(['--defer-shutdown-max-min', '0'])
    expect(process.env.SELF_HOSTED_RUNNER_DEFER_SHUTDOWN_MAX_MS).toBe('0')
    expect(readDeferShutdownMaxMs()).toBe(0)
  })

  test('fractional minutes accepted', () => {
    parseRootArgs(['--defer-shutdown-max-min', '1.5'])
    expect(process.env.SELF_HOSTED_RUNNER_DEFER_SHUTDOWN_MAX_MS).toBe(
      String(1.5 * 60 * 1000),
    )
  })

  test('rejects missing / negative / over max', () => {
    expect(() => parseRootArgs(['--defer-shutdown-max-min'])).toThrow(
      /non-negative number of minutes/,
    )
    expect(() => parseRootArgs(['--defer-shutdown-max-min', '-1'])).toThrow(
      /non-negative number of minutes/,
    )
    expect(() =>
      parseRootArgs(['--defer-shutdown-max-min', String(MAX_MINUTES_FLAG + 1)]),
    ).toThrow(new RegExp(`max ${MAX_MINUTES_FLAG}`))
  })

  test('help includes defer flag + env (≠ drain-wait)', () => {
    const h = formatRootHelp()
    expect(h).toContain('--defer-shutdown-max-min')
    expect(h).toContain('SELF_HOSTED_RUNNER_DEFER_SHUTDOWN_MAX_MS')
    expect(h).toContain('FIRST SIGTERM/SIGINT')
    expect(h).toContain('--drain-wait-sec')
  })
})

describe('densable 2.1.238 #5 --proxy-authorization-*', () => {
  test('parse command/file into RootRunnerArgs', () => {
    const cmd = parseRootArgs([
      '--proxy-authorization-command',
      'vault read -field=token',
    ])
    expect(cmd.proxyAuthorizationCommand).toBe('vault read -field=token')
    expect(cmd.proxyAuthorizationFile).toBeUndefined()

    const file = parseRootArgs([
      '--proxy-authorization-file',
      '/secrets/proxy-auth',
    ])
    expect(file.proxyAuthorizationFile).toBe('/secrets/proxy-auth')
    expect(file.proxyAuthorizationCommand).toBeUndefined()
  })

  test('requires a value (not another flag)', () => {
    expect(() => parseRootArgs(['--proxy-authorization-command'])).toThrow(
      /requires a value/,
    )
    expect(() =>
      parseRootArgs(['--proxy-authorization-file', '--capacity']),
    ).toThrow(/requires a value/)
  })

  test('rrC empty / mutex errors (SEA gold strings)', () => {
    expect(() => resolveProxyAuthorizationSource({ command: '   ' })).toThrow(
      '--proxy-authorization-command / --proxy-authorization-file must not be empty',
    )
    expect(() =>
      resolveProxyAuthorizationSource({
        command: 'echo Bearer x',
        file: '/tmp/a',
      }),
    ).toThrow(
      'set only one of --proxy-authorization-command (SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_COMMAND) and --proxy-authorization-file (SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_FILE)',
    )
  })

  test('rrC merges env; file path is resolved', () => {
    setEnv('SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_COMMAND', ' echo tok ')
    expect(resolveProxyAuthorizationSource({})).toEqual({
      kind: 'command',
      command: 'echo tok',
    })
    setEnv('SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_COMMAND', undefined)
    setEnv('SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_FILE', 'rel-auth')
    const src = resolveProxyAuthorizationSource({})
    expect(src).toEqual({ kind: 'file', path: pathResolve('rel-auth') })
  })

  test('N4y requires HTTPS_PROXY|HTTP_PROXY (ALL_PROXY alone insufficient)', () => {
    setEnv('ALL_PROXY', 'http://all-proxy:8080')
    expect(() =>
      resolveProxyAuthorizationConfig({ command: 'echo Bearer x' }),
    ).toThrow(
      /require HTTPS_PROXY \(or HTTP_PROXY\).*ALL_PROXY alone is not consulted/,
    )

    setEnv('HTTPS_PROXY', 'http://egress:3128')
    const cfg = resolveProxyAuthorizationConfig({ command: 'echo Bearer x' })
    expect(cfg?.source).toEqual({ kind: 'command', command: 'echo Bearer x' })
    expect(cfg?.upstreamProxyUrl).toBe('http://egress:3128')
  })

  test('N4y rejects non-http(s) upstream scheme', () => {
    setEnv('HTTPS_PROXY', 'socks5://egress:1080')
    expect(() =>
      resolveProxyAuthorizationConfig({ file: '/tmp/auth' }),
    ).toThrow(/support http:\/\/ and https:\/\/ upstream proxies only/)
  })

  test('readUpstreamHttpProxyUrl prefers https_proxy order; ignores ALL_PROXY', () => {
    setEnv('ALL_PROXY', 'http://all:1')
    setEnv('HTTP_PROXY', 'http://http-only:2')
    expect(readUpstreamHttpProxyUrl()).toBe('http://http-only:2')
    setEnv('https_proxy', 'http://https-lower:3')
    expect(readUpstreamHttpProxyUrl()).toBe('http://https-lower:3')
  })

  test('help includes proxy-authorization flags + env names', () => {
    const h = formatRootHelp()
    expect(h).toContain('--proxy-authorization-command')
    expect(h).toContain('--proxy-authorization-file')
    expect(h).toContain('SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_COMMAND')
    expect(h).toContain('SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_FILE')
    expect(h).toContain('ALL_PROXY alone is not consulted')
  })
})

describe('densable 2.1.238 #4 deferShutdown runtime (poll)', () => {
  test('defer abort refuses new work (available=0) and exits with shutdown gold line', async () => {
    const statuses: string[] = []
    const deferAc = new AbortController()
    const pollAc = new AbortController()
    let pollCalls = 0
    const availabilities: number[] = []
    const pollWork = mock(
      async (
        _token: string,
        _runnerId: string,
        available: number,
        _signal?: AbortSignal,
      ) => {
        pollCalls++
        availabilities.push(available)
        if (pollCalls === 1) {
          deferAc.abort(Date.now())
          return { assignment_ids: [] as string[], lease_expires_at: undefined }
        }
        // If we poll again after defer, capacity must be 0.
        expect(available).toBe(0)
        return { assignment_ids: [] as string[], lease_expires_at: undefined }
      },
    )
    const apiClient = {
      pollWork,
      deregisterRunner: mock(async () => {}),
    } as any

    const result = await runPollSkeleton(
      {
        apiClient,
        runnerId: 'r_defer',
        tokenState: { runnerToken: 'rtok' },
        capacity: 1,
        onStatus: m => statuses.push(m),
        onDebug: () => {},
        sseHintsEnabledOverride: false,
        pollIntervalOverrideMs: 5,
        deferShutdown: {
          signal: deferAc.signal,
          maxMs: 60_000,
          requestDrain: () => {
            throw new Error('requestDrain should not fire with empty slots')
          },
          ceilingGraceMsOverride: 50,
        },
      },
      pollAc.signal,
    )

    expect(result).toBe('drained')
    expect(availabilities[0]).toBe(1)
    expect(
      statuses.some(s =>
        s.includes(
          '[runner:exit] shutdown requested and every attached session has been released',
        ),
      ),
    ).toBe(true)
    expect(
      statuses.some(s => s.includes('[runner:shutdown] shutdown requested')),
    ).toBe(true)
  })

  test('formatShutdownSignalContext G() — startup vs idle counts', () => {
    expect(formatShutdownSignalContext('SIGTERM', undefined, 12_000)).toBe(
      '(SIGTERM; uptime 12s; session counts not yet initialized (startup in progress))',
    )
    const health = createRunnerHealthState({
      runnerId: 'r',
      version: '2.1.238',
      clientLabel: 'host',
      capacity: 2,
    })
    health.sessionIdle.set('session_a', Date.now())
    health.sessionIdle.set('session_b', null)
    expect(formatShutdownSignalContext('SIGINT', health, 65_000)).toBe(
      '(SIGINT; uptime 1m 5s; 2 active session(s), 1 of them idle)',
    )
  })

  test('poll finally fires onClosed (densable F latch)', async () => {
    const deferAc = new AbortController()
    const pollAc = new AbortController()
    let closed = 0
    const pollWork = mock(async () => {
      deferAc.abort(Date.now())
      return { assignment_ids: [] as string[], lease_expires_at: undefined }
    })
    await runPollSkeleton(
      {
        apiClient: {
          pollWork,
          deregisterRunner: mock(async () => {}),
        } as any,
        runnerId: 'r_closed',
        tokenState: { runnerToken: 'rtok' },
        capacity: 1,
        onStatus: () => {},
        onDebug: () => {},
        sseHintsEnabledOverride: false,
        pollIntervalOverrideMs: 5,
        deferShutdown: {
          signal: deferAc.signal,
          maxMs: 60_000,
          requestDrain: () => {
            throw new Error('requestDrain should not fire with empty slots')
          },
          onClosed: () => {
            closed++
          },
        },
      },
      pollAc.signal,
    )
    expect(closed).toBe(1)
  })

  test('deferring before ceiling still serves a newly assigned session', async () => {
    const statuses: string[] = []
    const deferAc = new AbortController()
    const pollAc = new AbortController()
    let pollCalls = 0
    const pollWork = mock(async () => {
      pollCalls++
      if (pollCalls === 1) {
        deferAc.abort(Date.now())
        return {
          assignment_ids: ['cse_after_signal'],
          lease_expires_at: undefined,
        }
      }
      return { assignment_ids: [] as string[], lease_expires_at: undefined }
    })
    const handleSessionFn = mock(async () => ({ result: 'completed' as const }))
    const result = await runPollSkeleton(
      {
        apiClient: {
          pollWork,
          deregisterRunner: mock(async () => {}),
          releaseSession: mock(async () => ({ released: true })),
        } as any,
        runnerId: 'r_serve',
        tokenState: { runnerToken: 'rtok' },
        capacity: 1,
        onStatus: m => statuses.push(m),
        onDebug: () => {},
        sseHintsEnabledOverride: false,
        pollIntervalOverrideMs: 5,
        skipSessionSpawn: true,
        handleSessionFn: handleSessionFn as any,
        deferShutdown: {
          signal: deferAc.signal,
          maxMs: 60_000,
          requestDrain: () => {
            throw new Error('requestDrain should not fire')
          },
        },
      },
      pollAc.signal,
    )
    expect(result).toBe('drained')
    expect(handleSessionFn).toHaveBeenCalled()
    expect(
      statuses.some(s =>
        s.includes(
          'cse_after_signal was assigned after the shutdown signal — serving it',
        ),
      ),
    ).toBe(true)
  })

  test('skeleton E2E: defer ceiling parks attached session then post-ceiling drain', async () => {
    const statuses: string[] = []
    const deferAc = new AbortController()
    const pollAc = new AbortController()
    let pollCalls = 0
    // Keep re-advertising the assignment so the server-side deassign path
    // does not abort the child before the defer ceiling fires.
    const pollWork = mock(async () => {
      pollCalls++
      if (pollCalls === 1) deferAc.abort(Date.now())
      return {
        assignment_ids: ['cse_ceiling_live'],
        lease_expires_at: undefined,
      }
    })
    const handleSessionFn = mock(
      async (_sid: string, _opts: unknown, signal: AbortSignal) => {
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return { result: 'interrupted' as const }
      },
    )
    const requestDrain = mock((reason: string) => {
      expect(reason).toContain('post-ceiling grace')
      pollAc.abort()
    })
    const result = await runPollSkeleton(
      {
        apiClient: {
          pollWork,
          deregisterRunner: mock(async () => {}),
          releaseSession: mock(async () => ({ released: true })),
        } as any,
        runnerId: 'r_ceiling',
        tokenState: { runnerToken: 'rtok' },
        capacity: 1,
        onStatus: m => statuses.push(m),
        onDebug: () => {},
        sseHintsEnabledOverride: false,
        pollIntervalOverrideMs: 5,
        skipSessionSpawn: true,
        handleSessionFn: handleSessionFn as any,
        deferShutdown: {
          signal: deferAc.signal,
          maxMs: 40,
          requestDrain,
          ceilingGraceMsOverride: 25,
        },
      },
      pollAc.signal,
    )
    expect(result).toBe('aborted')
    expect(handleSessionFn).toHaveBeenCalled()
    expect(
      statuses.some(s =>
        s.includes('cse_ceiling_live was assigned after the shutdown signal'),
      ),
    ).toBe(true)
    // formatDelayMs(40) → "0s" (rounds sub-second to seconds).
    expect(
      statuses.some(s =>
        /defer ceiling reached \(0s\) — releasing the remaining 1 session/.test(
          s,
        ),
      ),
    ).toBe(true)
    expect(requestDrain).toHaveBeenCalled()
  })

  test('rootRunner source keeps densable F/G/onClosed/Another SIGTERM gold', () => {
    const src = readFileSync(join(import.meta.dir, '../rootRunner.ts'), 'utf8')
    expect(src).toContain('let deferPathOpen = true')
    expect(src).toContain('onClosed: () => {')
    expect(src).toContain('deferPathOpen = false')
    expect(src).toContain('formatShutdownSignalContext(sig, healthState)')
    expect(src).toContain('Another SIGTERM force-exits the runner immediately')
    expect(src).toContain(
      'declined session(s) held for re-spawn dropped at the ceiling',
    )
    expect(src).toContain('was assigned after the shutdown signal — serving it')
    expect(src).toContain('A second signal drains immediately.')
    expect(src).toContain('Size the stop timeout to at least')
  })
})
