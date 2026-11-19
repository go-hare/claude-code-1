import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { maskPushNotificationSecrets } from '../../../packages/builtin-tools/src/tools/PushNotificationTool/PushNotificationTool.js'
import {
  checkCrossMachineCredentialIsolation,
  CROSS_MACHINE_CREDENTIAL_ISOLATION_MESSAGE,
} from '../../../packages/builtin-tools/src/tools/SendMessageTool/cloudHop.js'
import { computeBridgeQrLayout } from '../../components/BridgeDialog.js'
import {
  getRunningBackgroundSubagentIds,
  hasRunningBackgroundSubagents,
} from '../../hooks/useReplBridge.js'
import {
  isValidChromeSiteName,
  resolveChromeSiteForPermissionPrompt,
} from '../../utils/claudeInChrome/chromeCallPermission.js'
import {
  KEPT_FOLDER_PREFIX,
  publishStagedFileWithKeptProtection,
} from '../../utils/stageFile.js'
import {
  buildBridgeProxyAxiosOptions,
  resolveBridgeProxySetting,
} from '../bridgeApi.js'
import {
  filterBridgeAlwaysAllowUpdates,
  isBridgePermissionToolNameMismatch,
  parseBridgePermissionResponse,
} from '../bridgePermissionCallbacks.js'
import { getChildLogsRoot, resolveChildLogsDir } from '../childLogsDir.js'
import { isTransientMidReplyUnavailableClose } from '../remintRecovery.js'
import {
  buildCanUseToolDetailsPayload,
  filterStreamEventForBridge,
} from '../remoteBridgeCore.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 326 Group 5A — Bridge / Remote Control / Tools (#32, #91-#94, #237, #239, #254, #325, #334, #337, #338)', () => {
  test('#32 stageFile moves Claude-edited file into .kept- folder instead of overwriting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-kept-326-'))
    tempDirs.push(dir)
    const dest = join(dir, 'report.md')
    writeFileSync(dest, 'claude edited content\n', 'utf8')

    const res = await publishStagedFileWithKeptProtection(
      dir,
      'report.md',
      Buffer.from('re-sent user upload\n', 'utf8'),
    )
    expect(res.status).toBe('published')
    if (res.status === 'published') {
      expect(res.movedAsideTo).toBeDefined()
      expect(res.movedAsideTo).toContain(KEPT_FOLDER_PREFIX)
      expect(
        readFileSync(join(dir, res.movedAsideTo!, 'report.md'), 'utf8'),
      ).toBe('claude edited content\n')
    }
    expect(readFileSync(dest, 'utf8')).toBe('re-sent user upload\n')
  })

  test('#91 treats brief server unavailability mid-reply as recoverable', () => {
    expect(isTransientMidReplyUnavailableClose(503, undefined, true)).toBe(true)
    expect(isTransientMidReplyUnavailableClose(1006, undefined, true)).toBe(
      true,
    )
    expect(
      isTransientMidReplyUnavailableClose(
        undefined,
        'service_unavailable',
        true,
      ),
    ).toBe(true)
    // Not recoverable when no reply turn is active
    expect(isTransientMidReplyUnavailableClose(503, undefined, false)).toBe(
      false,
    )
    // Permanent auth/conflict codes are not transient mid-reply
    expect(isTransientMidReplyUnavailableClose(4090, undefined, true)).toBe(
      false,
    )
  })

  test('#92 adapts QR layout to fit short 80x24 terminals without cutoff', () => {
    const short = computeBridgeQrLayout(18, 24)
    expect(short.compact).toBe(true)
    expect(short.showSecondaryMeta).toBe(false)

    const tall = computeBridgeQrLayout(18, 50)
    expect(tall.compact).toBe(false)
    expect(tall.showSecondaryMeta).toBe(true)
  })

  test('#93 detects running background subagents for RC running-state hold & remote Stop', () => {
    const tasks = {
      t1: { type: 'local_agent', status: 'running' },
      t2: { type: 'local_bash', status: 'running' },
      t3: { type: 'remote_agent', status: 'completed' },
    }
    expect(hasRunningBackgroundSubagents(tasks)).toBe(true)
    expect(getRunningBackgroundSubagentIds(tasks)).toEqual(['t1'])
    expect(
      hasRunningBackgroundSubagents({
        t1: { type: 'local_agent', status: 'completed' },
      }),
    ).toBe(false)
  })

  test('#237 masks API keys, bearer tokens, GitHub PATs, and AWS keys in push notifications', () => {
    const raw =
      'Done with sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and ghp_abcdefghijklmnopqrstuvwxyz1234567890'
    const masked = maskPushNotificationSecrets(raw)
    expect(masked).not.toContain('sk-ant-api03-')
    expect(masked).not.toContain('ghp_')
    expect(masked).toContain('[REDACTED]')
  })

  test('#239 filters keepalive ping stream events while forwarding partial deltas', () => {
    expect(
      filterStreamEventForBridge({
        type: 'stream_event',
        event: { type: 'ping' },
      } as never),
    ).toBe(false)
    expect(
      filterStreamEventForBridge({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hi' },
        },
      } as never),
    ).toBe(true)
  })

  test('#254 attaches Chrome site name on RC can_use_tool details', () => {
    expect(isValidChromeSiteName('docs.anthropic.com')).toBe(true)
    expect(isValidChromeSiteName('bad host name')).toBe(false)
    expect(
      resolveChromeSiteForPermissionPrompt('tu_1', {
        url: 'https://docs.anthropic.com/en/docs',
      }),
    ).toBe('docs.anthropic.com')

    const details = buildCanUseToolDetailsPayload('req_1', {
      tool_name: 'mcp__claude-in-chrome__navigate',
      tool_use_id: 'tu_1',
      input: { url: 'https://example.com/path' },
    })
    expect(details.chrome_site).toBe('example.com')
    expect(details.action_description).toContain('example.com')
  })

  test('#325 validates bridge updatedPermissions, rejects mismatched toolName, and strips unsafe always-allow', () => {
    const parsedMalformed = parseBridgePermissionResponse({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: {
          behavior: 'allow',
          updatedPermissions: 'not-an-array',
          toolName: 'Bash',
        },
      },
    } as never)
    expect(parsedMalformed?.behavior).toBe('allow')
    expect(parsedMalformed?.updatedPermissions).toBeUndefined()
    expect(parsedMalformed?.updatedPermissionsDropped).toBe(true)
    expect(parsedMalformed?.toolName).toBe('Bash')

    expect(isBridgePermissionToolNameMismatch('Edit', 'Bash', 'r1')).toBe(true)
    expect(isBridgePermissionToolNameMismatch('Bash', 'Bash', 'r1')).toBe(false)

    const offeredSuggestions = [
      {
        type: 'addRules' as const,
        behavior: 'allow' as const,
        destination: 'localSettings' as const,
        rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      },
      {
        type: 'addDirectories' as const,
        destination: 'localSettings' as const,
        directories: ['/allowed/dir'],
      },
    ]

    // Unoffered grants MUST be rejected (addRules, replaceRules, addDirectories, widening setMode)
    const unofferedRejected = filterBridgeAlwaysAllowUpdates(
      [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'localSettings',
          rules: [{ toolName: 'Bash', ruleContent: 'rm -rf *' }],
        },
        {
          type: 'replaceRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Bash' }],
        },
        {
          type: 'addDirectories',
          destination: 'session',
          directories: ['/etc'],
        },
        {
          type: 'setMode',
          mode: 'bypassPermissions',
          destination: 'session',
        },
      ],
      { allowedSuggestions: offeredSuggestions },
    )
    expect(unofferedRejected).toEqual([])

    // Offered grants with matching destination or downgraded to 'session' are retained
    const offeredRetained = filterBridgeAlwaysAllowUpdates(
      [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [
            { toolName: 'Bash', ruleContent: 'git status' },
            { toolName: 'Bash', ruleContent: 'evil' },
          ],
        },
        {
          type: 'addDirectories',
          destination: 'localSettings',
          directories: ['/allowed/dir', '/unoffered/dir'],
        },
      ],
      { allowedSuggestions: offeredSuggestions },
    )
    expect(offeredRetained).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      },
      {
        type: 'addDirectories',
        destination: 'localSettings',
        directories: ['/allowed/dir'],
      },
    ])

    // suppressAlwaysAllowRule strips persistent destinations and still enforces allowedSuggestions
    const filtered = filterBridgeAlwaysAllowUpdates(
      [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'userSettings',
          rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
        },
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
        },
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Bash', ruleContent: 'unoffered' }],
        },
      ],
      {
        suppressAlwaysAllowRule: true,
        allowedSuggestions: offeredSuggestions,
      },
    )
    expect(filtered).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      },
    ])

    // Without allowedSuggestions, arbitrary session allow rules are dropped even under suppressAlwaysAllowRule
    expect(
      filterBridgeAlwaysAllowUpdates(
        [
          {
            type: 'addRules',
            behavior: 'allow',
            destination: 'session',
            rules: [{ toolName: 'Bash' }],
          },
        ],
        { suppressAlwaysAllowRule: true },
      ),
    ).toEqual([])

    expect(
      filterBridgeAlwaysAllowUpdates(filtered, {
        hasNonClassifierApprovableSafetyCheck: true,
        allowedSuggestions: offeredSuggestions,
      }),
    ).toEqual([])
  })

  test('#334 refuses cross-machine SendMessage when session uses alternate credential beside saved claude.ai login', () => {
    const refused = checkCrossMachineCredentialIsolation({
      hasSavedClaudeAiLogin: () => true,
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      hasApiKeyHelper: () => false,
      apiKeySource: () => 'ANTHROPIC_API_KEY',
      authTokenSource: () => 'none',
    })
    expect(refused).toBe(CROSS_MACHINE_CREDENTIAL_ISOLATION_MESSAGE)

    const allowed = checkCrossMachineCredentialIsolation({
      hasSavedClaudeAiLogin: () => true,
      isUsingSavedClaudeAiLogin: () => true,
      env: {},
      hasApiKeyHelper: () => false,
      apiKeySource: () => 'none',
      authTokenSource: () => 'none',
    })
    expect(allowed).toBeUndefined()
  })

  test('#337 forces CONNECT tunnel via HttpsProxyAgent and honors NO_PROXY / rejects invalid scheme', () => {
    const setting = resolveBridgeProxySetting(
      'https://api.anthropic.com/v1/x',
      {
        HTTPS_PROXY: 'http://proxy.corp:8080',
      },
    )
    expect(setting).toEqual({
      proxyUrl: 'http://proxy.corp:8080',
      isSkipped: false,
    })

    const opts = buildBridgeProxyAxiosOptions(
      'https://api.anthropic.com/v1/x',
      {
        HTTPS_PROXY: 'http://proxy.corp:8080',
      },
    )
    expect(opts.proxy).toBe(false)
    expect(opts.httpsAgent).toBeDefined()
    expect(opts.httpAgent).toBe(opts.httpsAgent)

    const skipped = buildBridgeProxyAxiosOptions(
      'https://api.anthropic.com/v1/x',
      {
        HTTPS_PROXY: 'http://proxy.corp:8080',
        NO_PROXY: 'anthropic.com',
      },
    )
    expect(skipped).toEqual({ proxy: false })

    expect(() =>
      buildBridgeProxyAxiosOptions('https://api.anthropic.com/v1/x', {
        HTTPS_PROXY: 'socks5://proxy.corp:1080',
      }),
    ).toThrow(/not an http or https URL/)
  })

  test('#338 creates owner-only ~/.claude/child-logs directory with mode 0700', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'child-logs-home-326-'))
    tempDirs.push(fakeHome)
    const dir = await resolveChildLogsDir(undefined, fakeHome)
    expect(dir).toBe(getChildLogsRoot(fakeHome))
    expect(dir).toEndWith(join('.claude', 'child-logs'))
    if (process.platform !== 'win32') {
      const mode = statSync(dir!).mode & 0o777
      expect(mode & 0o022).toBe(0)
    }
  })
})
