import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getUniqueForkName } from '../../commands/branch/branch.js'
import { shouldSuppressAlwaysAllowRule } from '../bridgePermissionCallbacks.js'
import {
  formatForkSessionTitle,
  resolveForkSessionTitle,
} from '../bridgeMain.js'
import { createBridgeSession } from '../createSession.js'
import { createSessionSpawner } from '../sessionRunner.js'
import {
  SDKControlInitializeResponseSchema,
  SDKHookCallbackMatcherSchema,
} from '../../entrypoints/sdk/controlSchemas.js'

describe('Wave 316-318 Group E bridge & SDK alignment', () => {
  const dirsToClean: string[] = []

  afterEach(() => {
    for (const d of dirsToClean.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('#1543: shouldSuppressAlwaysAllowRule suppresses for hookCaller / pluginSteered / explicit', () => {
    expect(shouldSuppressAlwaysAllowRule({ hookCaller: 'my-plugin' })).toBe(
      true,
    )
    expect(shouldSuppressAlwaysAllowRule({ pluginSteered: true })).toBe(true)
    expect(shouldSuppressAlwaysAllowRule({}, true)).toBe(true)
    expect(shouldSuppressAlwaysAllowRule({})).toBe(false)
    expect(shouldSuppressAlwaysAllowRule(undefined)).toBe(false)
  })

  test('#1601 & #1686: formatForkSessionTitle preserves (fork) suffix and increments terminal fork', () => {
    expect(formatForkSessionTitle('Fix bug')).toBe('Fix bug (fork)')
    expect(formatForkSessionTitle('Fix bug (fork)')).toBe('Fix bug (fork 2)')
    expect(formatForkSessionTitle('Fix bug (fork 2)')).toBe('Fix bug (fork 3)')
    expect(formatForkSessionTitle('Fix bug \u2442')).toBe('Fix bug (fork 2)')
    expect(formatForkSessionTitle('   ')).toBe('')

    const longName = 'A'.repeat(250)
    const formatted = formatForkSessionTitle(longName)
    expect(formatted.endsWith(' (fork)')).toBe(true)
    expect([...formatted].length).toBeLessThanOrEqual(200)
  })

  test('#1601 & #1686 wiring: createBridgeSession, remoteBridgeCore, and /branch use formatForkSessionTitle', async () => {
    // 1. resolveForkSessionTitle semantics
    expect(
      resolveForkSessionTitle({
        explicitTitle: '  ',
        parentTitle: 'Fix bug \u2442',
      }),
    ).toBe('Fix bug (fork 2)')
    expect(
      resolveForkSessionTitle({
        explicitTitle: 'Custom Title',
        parentTitle: 'Fix bug (fork)',
      }),
    ).toBe('Custom Title')

    // 2. End-to-end createBridgeSession HTTP payload uses formatForkSessionTitle when forkFromTitle is set
    const receivedBodies: Array<Record<string, unknown>> = []
    const prevBridgeUrl = process.env.CLAUDE_BRIDGE_BASE_URL
    const prevAnthropicModel = process.env.ANTHROPIC_MODEL
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBodies.push((await req.json()) as Record<string, unknown>)
        return new Response(JSON.stringify({ id: 'session_fork_1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    process.env.CLAUDE_BRIDGE_BASE_URL = `http://127.0.0.1:${server.port}`
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'
    try {
      const sid = await createBridgeSession({
        environmentId: 'env_1',
        forkFromTitle: 'Fix bug \u2442',
        events: [],
        gitRepoUrl: null,
        branch: 'main',
        signal: AbortSignal.timeout(5000),
        baseUrl: `http://127.0.0.1:${server.port}`,
        getAccessToken: () => 'test-token',
      })
      expect(sid).toBe('session_fork_1')
      expect(receivedBodies[0]?.title).toBe('Fix bug (fork 2)')

      await createBridgeSession({
        environmentId: 'env_1',
        title: 'Explicit Fork Name',
        forkFromTitle: 'Fix bug (fork)',
        events: [],
        gitRepoUrl: null,
        branch: 'main',
        signal: AbortSignal.timeout(5000),
        baseUrl: `http://127.0.0.1:${server.port}`,
        getAccessToken: () => 'test-token',
      })
      expect(receivedBodies[1]?.title).toBe('Explicit Fork Name')
    } finally {
      server.stop(true)
      if (prevBridgeUrl === undefined) delete process.env.CLAUDE_BRIDGE_BASE_URL
      else process.env.CLAUDE_BRIDGE_BASE_URL = prevBridgeUrl
      if (prevAnthropicModel === undefined) delete process.env.ANTHROPIC_MODEL
      else process.env.ANTHROPIC_MODEL = prevAnthropicModel
    }

    // 3. /branch getUniqueForkName formats via formatForkSessionTitle
    const uniqueStem = `branch-wiring-${Date.now()}`
    expect(await getUniqueForkName(uniqueStem)).toBe(`${uniqueStem} (fork)`)
    expect(await getUniqueForkName(`${uniqueStem} (fork)`)).toBe(
      `${uniqueStem} (fork 2)`,
    )
    expect(await getUniqueForkName(`${uniqueStem} \u2442`)).toBe(
      `${uniqueStem} (fork 2)`,
    )
    const longBranch = await getUniqueForkName('Z'.repeat(240))
    expect(longBranch.endsWith(' (fork)')).toBe(true)
    expect([...longBranch].length).toBeLessThanOrEqual(200)

    // 4. remoteBridgeCore.ts wires resolveForkSessionTitle into sessionTitle
    const coreSrc = readFileSync(
      join(process.cwd(), 'src/bridge/remoteBridgeCore.ts'),
      'utf8',
    )
    expect(coreSrc).toContain('resolveForkSessionTitle')
  })

  test('#1685: sessionRunner reports missing working folder name on ENOENT', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wave-e-runner-'))
    dirsToClean.push(base)
    const missingDir = join(base, 'nonexistent-workdir')

    const runner = createSessionSpawner({
      execPath: process.execPath,
      scriptArgs: ['-e', 'process.exit(0)'],
      debugFile: undefined,
      verbose: false,
      sandbox: false,
      env: process.env,
      onDebug: () => {},
    })

    const handle = runner.spawn(
      {
        sessionId: 'sess-enoent-1',
        sdkUrl: 'https://example.com/sdk',
        accessToken: 'tok',
      },
      missingDir,
    )

    const status = await handle.done
    expect(status).toBe('failed')
    expect(handle.lastStderr.some(line => line.includes(missingDir))).toBe(true)
  })

  test('#1530: SDKHookCallbackMatcherSchema accepts onFailure and SDKControlInitializeResponseSchema accepts hook_on_failure_supported', () => {
    const matcher = SDKHookCallbackMatcherSchema().safeParse({
      matcher: 'Bash',
      hookCallbackIds: ['cb_1'],
      onFailure: 'block',
    })
    expect(matcher.success).toBe(true)
    if (matcher.success) {
      expect(matcher.data.onFailure).toBe('block')
    }

    const resp = SDKControlInitializeResponseSchema().safeParse({
      commands: [],
      agents: [],
      output_style: 'default',
      available_output_styles: ['default'],
      models: [],
      account: {},
      hook_on_failure_supported: true,
    })
    expect(resp.success).toBe(true)
  })
})
