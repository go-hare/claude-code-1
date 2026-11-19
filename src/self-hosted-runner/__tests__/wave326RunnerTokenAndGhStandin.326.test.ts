/**
 * Wave 326 Group 5B — Self-Hosted Runner alignment tests:
 * #100 (tokenRefresh clock-ahead min backoff) & #339 (--use-anthropic-gh + --gh-standin).
 */
import { describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  GH_STANDIN_ANY_HOSTS_SENTINEL,
  GH_STANDIN_STANDALONE_PROXY,
  buildGhStandinShimScript,
  evaluateRunnerBuiltInGhBlocks,
  evaluateSessionBuiltInGhDecision,
  formatBuiltInGhStartupLines,
  ghStandinMain,
  parseGhStandinArgv,
  parseUseAnthropicGhEnv,
  writeGhStandinShimIfMissing,
} from '../ghStandin.js'
import { parseRootArgs } from '../rootRunner.js'
import {
  createRunnerTokenRefreshScheduler,
  decodeJwtPayload,
} from '../tokenRefresh.js'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url',
  )
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

describe('2.1.326 #100 — tokenRefresh min backoff when clock runs ahead', () => {
  test('pauses instead of tight-looping when refreshed token is already past/within buffer', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    // Simulate local clock running ahead: newly refreshed token has exp in the past
    // (lifetime 3600s, iat = now - 3700, exp = now - 100)
    const alreadyDueToken = `sk-ant-sid-${makeJwt({
      iat: nowSec - 3700,
      exp: nowSec - 100,
    })}`
    expect(decodeJwtPayload(alreadyDueToken)?.iat).toBe(nowSec - 3700)

    const logs: string[] = []
    let refreshCalls = 0
    const getAccessToken = mock(async () => {
      refreshCalls++
      return alreadyDueToken
    })

    const scheduler = createRunnerTokenRefreshScheduler({
      getAccessToken,
      onRefresh: () => {},
      label: 'self-hosted-runner',
      onLog: msg => logs.push(msg),
    })

    scheduler.schedule('sess-clock-ahead', alreadyDueToken)
    await new Promise(r => setTimeout(r, 40))
    scheduler.cancelAll()

    // Must have refreshed ONCE immediately, then paused instead of tight-looping
    expect(refreshCalls).toBe(1)
    expect(
      logs.some(line =>
        line.includes('new token already due; pausing to avoid a loop'),
      ),
    ).toBe(true)
  })
})

describe('2.1.326 #339 — self-hosted-runner --use-anthropic-gh & --gh-standin', () => {
  test('parses SELF_HOSTED_RUNNER_USE_ANTHROPIC_GH and --use-anthropic-gh flags', () => {
    expect(parseUseAnthropicGhEnv(undefined)).toBe('default')
    expect(parseUseAnthropicGhEnv('false')).toBe(false)
    expect(parseUseAnthropicGhEnv('0')).toBe(false)
    expect(parseUseAnthropicGhEnv('off')).toBe(false)
    expect(parseUseAnthropicGhEnv('no')).toBe(false)
    expect(parseUseAnthropicGhEnv('true')).toBe(true)
    expect(parseUseAnthropicGhEnv('1')).toBe(true)

    const parsedDefault = parseRootArgs([])
    expect(parsedDefault.useAnthropicGh).toBe('default')

    const parsedFalse = parseRootArgs(['--use-anthropic-gh', 'false'])
    expect(parsedFalse.useAnthropicGh).toBe(false)

    const parsedTrue = parseRootArgs(['--use-anthropic-gh'])
    expect(parsedTrue.useAnthropicGh).toBe(true)
  })

  test('evaluates runner/session built-in gh eligibility and formats startup lines', () => {
    const baseCtx = {
      flag: true,
      windows: false,
      capacity: 1,
      standaloneProxy: false,
      childIsOwnBinary: true,
      essentialTrafficOnly: false,
      thirdPartyProvider: false,
      startedByClaudeCode: false,
    }
    expect(evaluateRunnerBuiltInGhBlocks(baseCtx)).toEqual([])
    expect(
      evaluateSessionBuiltInGhDecision({
        ...baseCtx,
        managedGit: false,
        olderGitProxy: false,
        childKind: 'agent-loop',
        review: false,
      }),
    ).toBe('on')
    expect(
      evaluateSessionBuiltInGhDecision({
        ...baseCtx,
        managedGit: true,
        olderGitProxy: false,
        childKind: 'agent-loop',
        review: false,
      }),
    ).toBe('managed_git')
    expect(
      evaluateRunnerBuiltInGhBlocks({ ...baseCtx, windows: true, capacity: 2 }),
    ).toEqual(['windows', 'capacity'])

    const defaultLines = formatBuiltInGhStartupLines(baseCtx, true)
    expect(defaultLines[0]).toContain('--use-anthropic-gh false turns it off')

    const blockedLines = formatBuiltInGhStartupLines(
      { ...baseCtx, capacity: 2 },
      false,
    )
    expect(blockedLines[0]).toContain('[runner:warn] --use-anthropic-gh is on')
  })

  test('parses --gh-standin argv and writes executable shim script when gh is absent', async () => {
    const parsed = parseGhStandinArgv([
      '--gh-standin',
      '8443',
      '/tmp/ca.pem',
      '--hosts=ghe.example.com',
      '--',
      'api',
      'repos/octo/repo',
    ])
    expect(parsed).toEqual({
      port: 8443,
      caBundlePath: '/tmp/ca.pem',
      ghesHosts: ['ghe.example.com'],
      ghArgs: ['api', 'repos/octo/repo'],
    })

    const anyHost = parseGhStandinArgv([
      '--gh-standin',
      GH_STANDIN_STANDALONE_PROXY,
      '/tmp/ca.pem',
      '--any-host',
      '--',
      'api',
      'user',
    ])
    expect(anyHost).toEqual({
      port: GH_STANDIN_STANDALONE_PROXY,
      caBundlePath: '/tmp/ca.pem',
      ghesHosts: GH_STANDIN_ANY_HOSTS_SENTINEL,
      ghArgs: ['api', 'user'],
    })

    let errOut = ''
    const refused = parseGhStandinArgv(['--gh-standin', 'bad'], s => {
      errOut += s
    })
    expect(refused).toBe('refused')
    expect(errOut).toContain('not for direct use')

    const script = buildGhStandinShimScript({
      command: ['/usr/local/bin/claude', 'self-hosted-runner'],
      port: 8443,
      caBundlePath: '/tmp/ca.pem',
      ghesHosts: [],
    })
    expect(script).toContain('#!/bin/sh')
    expect(script).toContain("'--gh-standin' '8443' '/tmp/ca.pem'")

    const dir = await mkdtemp(join(tmpdir(), 'g5b-gh-shim-'))
    try {
      const written = await writeGhStandinShimIfMissing({
        shimDir: join(dir, 'bin'),
        command: ['/usr/local/bin/claude', 'self-hosted-runner'],
        port: GH_STANDIN_STANDALONE_PROXY,
        caBundlePath: '/tmp/ca.pem',
        envPath: '', // simulate no gh on PATH
        platform: 'linux',
      })
      expect(written).toBeDefined()
      const content = await readFile(written!.shimPath, 'utf8')
      expect(content).toContain('--gh-standin')
      const st = await stat(written!.shimPath)
      expect((st.mode & 0o111) !== 0).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('ghStandinMain executes REST gh api GET/POST/paginate and refuses non-api / GraphQL', async () => {
    const out: string[] = []
    const err: string[] = []
    const seenReqs: Array<{ method: string; url: string }> = []

    const code = await ghStandinMain(
      {
        port: GH_STANDIN_STANDALONE_PROXY,
        caBundlePath: '/tmp/ca.pem',
        ghesHosts: [],
        ghArgs: ['api', '--paginate', 'repos/anthropics/claude-code/pulls'],
      },
      {
        write: async (stream, data) => {
          const text = typeof data === 'string' ? data : data.toString('utf8')
          if (stream === 'stdout') out.push(text)
          else err.push(text)
        },
        requestFn: async req => {
          seenReqs.push({ method: req.method, url: req.url })
          if (seenReqs.length === 1) {
            return {
              status: 200,
              statusText: 'OK',
              headers: {
                'content-type': 'application/json',
                link: '<https://api.github.com/repos/anthropics/claude-code/pulls?page=2>; rel="next"',
              },
              data: Buffer.from('[{"id":1}]'),
            }
          }
          return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from('[{"id":2}]'),
          }
        },
      },
    )
    expect(code).toBe(0)
    expect(err.join('')).toBe('')
    expect(JSON.parse(out.join(''))).toEqual([{ id: 1 }, { id: 2 }])

    // Non-api subcommand refused
    const err2: string[] = []
    const code2 = await ghStandinMain(
      {
        port: GH_STANDIN_STANDALONE_PROXY,
        caBundlePath: '/tmp/ca.pem',
        ghesHosts: [],
        ghArgs: ['pr', 'list'],
      },
      {
        write: async (stream, data) => {
          if (stream === 'stderr') err2.push(String(data))
        },
      },
    )
    expect(code2).toBe(1)
    expect(err2.join('')).toContain('implements `gh api` only')

    // GraphQL refused
    const err3: string[] = []
    const code3 = await ghStandinMain(
      {
        port: GH_STANDIN_STANDALONE_PROXY,
        caBundlePath: '/tmp/ca.pem',
        ghesHosts: [],
        ghArgs: ['api', 'graphql'],
      },
      {
        write: async (stream, data) => {
          if (stream === 'stderr') err3.push(String(data))
        },
      },
    )
    expect(code3).toBe(1)
    expect(err3.join('')).toContain('GraphQL is not supported')
  })

  test('#339 review fixes: blocks GraphQL URL/redirect bypasses, userinfo/port spoofing, and invalid --hostname under --any-host', async () => {
    const runStandin = async (
      ghArgs: string[],
      ghesHosts: string[] | typeof GH_STANDIN_ANY_HOSTS_SENTINEL = [],
      requestFn?: NonNullable<Parameters<typeof ghStandinMain>[1]>['requestFn'],
    ) => {
      const stderr: string[] = []
      const code = await ghStandinMain(
        {
          port: GH_STANDIN_STANDALONE_PROXY,
          caBundlePath: '/tmp/ca.pem',
          ghesHosts,
          ghArgs,
        },
        {
          write: async (stream, data) => {
            if (stream === 'stderr') stderr.push(String(data))
          },
          requestFn,
        },
      )
      return { code, stderr: stderr.join('') }
    }

    // GraphQL variants on resolved pathname must all be rejected
    for (const endpoint of [
      'https://api.github.com/graphql',
      '/graphql?foo=1',
      'GRAPHQL',
      '/repos/../graphql',
      '/graphql/',
    ]) {
      const res = await runStandin(['api', endpoint])
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('GraphQL is not supported')
    }

    // GHES /api/v3/graphql also blocked
    const ghesGraphql = await runStandin(
      ['api', '--hostname', 'ghe.example.com', '/graphql'],
      ['ghe.example.com'],
    )
    expect(ghesGraphql.code).toBe(1)
    expect(ghesGraphql.stderr).toContain('GraphQL is not supported')

    // Redirect to /graphql blocked
    const redirectGraphql = await runStandin(
      ['api', 'repos/octo/repo'],
      [],
      async () => ({
        status: 302,
        statusText: 'Found',
        headers: { location: '/graphql' },
        data: Buffer.alloc(0),
      }),
    )
    expect(redirectGraphql.code).toBe(1)
    expect(redirectGraphql.stderr).toContain('GraphQL is not supported')

    // Origin/port and userinfo spoofing rejected in initial URL and redirects
    for (const badUrl of [
      'https://user:pass@api.github.com/repos/octo/repo',
      'https://api.github.com:8443/repos/octo/repo',
    ]) {
      const res = await runStandin(['api', badUrl])
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('api.github.com only')
    }

    for (const badLoc of [
      'https://api.github.com:8443/repos/octo/repo',
      'https://u:p@api.github.com/repos/octo/repo',
    ]) {
      const res = await runStandin(
        ['api', 'repos/octo/repo'],
        [],
        async () => ({
          status: 302,
          statusText: 'Found',
          headers: { location: badLoc },
          data: Buffer.alloc(0),
        }),
      )
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('refusing a redirect')
    }

    // Invalid --hostname rejected even when --any-host is active
    for (const badHost of [
      'evil.com/path',
      'user@evil.com',
      'evil.com:8443',
      'evil.com?x=1',
      'evil.com#frag',
      'evil.com bad',
    ]) {
      const res = await runStandin(
        ['api', '--hostname', badHost, 'repos/octo/repo'],
        GH_STANDIN_ANY_HOSTS_SENTINEL,
      )
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('invalid hostname')
    }

    // sessionHandler cleans up <sessionId>.gh in removeSessionState
    const handlerSrc = await Bun.file(
      new URL('../sessionHandler.ts', import.meta.url),
    ).text()
    expect(handlerSrc).toContain('ghStandinRootDirLive')
    expect(handlerSrc).toContain(
      '...(ghStandinRootDirLive ? [ghStandinRootDirLive] : [])',
    )
  })
})
