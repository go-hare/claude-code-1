import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'stream'
import { isPromptFlushTranscriptEntry } from '../../utils/sessionStorage.js'
import {
  clearWindowsPathCacheForTesting,
  resolveWindowsExecutableOnPath,
  shouldFallbackToWhereExe,
} from '../../utils/windowsPaths.js'
import {
  checkPurgeInteractiveTerminal,
  resolvePurgeTerminalInput,
} from '../handlers/purgeProject.js'
import {
  handleOrphanedPermissionResponse,
  recheckOrphanedPermissionAgainstDenyRules,
  validateApplyFlagSettingsPatch,
} from '../headless/HeadlessControlPlane.js'
import {
  hasCachedOAuthAccountData,
  PrintTextResults,
  sanitizePrintTextForTty,
  waitForCachedAccountDataBeforePrint,
} from '../print.js'
import {
  dispatchPrintControlExtra,
  redactPermissionRuleForRemote,
  redactPermissionRulesStateForRemote,
  redactSettingsResponseForRemote,
  resolveControlConnectionTrustLevel,
} from '../printControlExtras.js'

describe('Wave 325 Group 4 — CLI, SessionStorage, WindowsPaths & Control Plane', () => {
  test('#2266: isPromptFlushTranscriptEntry identifies turn entries for immediate flush', () => {
    expect(
      isPromptFlushTranscriptEntry({ type: 'user' } as Parameters<
        typeof isPromptFlushTranscriptEntry
      >[0]),
    ).toBe(true)
    expect(
      isPromptFlushTranscriptEntry({ type: 'assistant' } as Parameters<
        typeof isPromptFlushTranscriptEntry
      >[0]),
    ).toBe(true)
    expect(
      isPromptFlushTranscriptEntry({
        type: 'system',
        subtype: 'turn_duration',
      } as unknown as Parameters<typeof isPromptFlushTranscriptEntry>[0]),
    ).toBe(true)
    expect(
      isPromptFlushTranscriptEntry({
        type: 'progress',
      } as unknown as Parameters<typeof isPromptFlushTranscriptEntry>[0]),
    ).toBe(false)
  })

  test('#2281: claude purge uses /dev/tty when stdin is piped and refuses cleanly when no terminal exists', () => {
    const pipedStdin = Object.assign(new PassThrough(), { isTTY: false })
    const fakeTty = new PassThrough()

    const override = resolvePurgeTerminalInput({
      stdin: pipedStdin,
      openTty: () => fakeTty,
    })
    expect(override.kind).toBe('override')
    expect(checkPurgeInteractiveTerminal('hint', override, true)).toBeNull()
    const bothPipedErr = checkPurgeInteractiveTerminal('hint', override, false)
    expect(bothPipedErr).toContain('stdin and stdout are both piped')
    if (override.kind === 'override') {
      override.dispose()
    }

    const unavailable = resolvePurgeTerminalInput({
      stdin: pipedStdin,
      openTty: () => null,
    })
    expect(unavailable.kind).toBe('unavailable')
    const noTtyErr = checkPurgeInteractiveTerminal('hint', unavailable, true)
    expect(noTtyErr).toContain('no interactive terminal is available')
  })

  test('#2283: claude -p strips non-SGR control sequences on TTY while preserving SGR styling and pipes', () => {
    const raw =
      '\x1b[32mgreen\x1b[0m\x1b]0;evil-title\x07\x1b[2J\r\nhello\x00world'
    const sanitized = sanitizePrintTextForTty(raw)
    expect(sanitized).toContain('\x1b[32mgreen\x1b[0m')
    expect(sanitized).not.toContain('\x07')
    expect(sanitized).not.toContain('\x1b[2J')
    expect(sanitized).not.toContain('\x00')
    expect(sanitized).not.toContain('\r')

    const ttyChunks: string[] = []
    const ttyPrinter = new PrintTextResults(
      {},
      s => ttyChunks.push(s),
      () => true,
    )
    ttyPrinter.printAtExit({ type: 'result', subtype: 'success', result: raw })
    expect(ttyChunks.join('')).toContain('\x1b[32mgreen\x1b[0m')
    expect(ttyChunks.join('')).not.toContain('\x1b[2J')

    const pipeChunks: string[] = []
    const pipePrinter = new PrintTextResults(
      {},
      s => pipeChunks.push(s),
      () => false,
    )
    pipePrinter.printAtExit({ type: 'result', subtype: 'success', result: raw })
    expect(pipeChunks.join('')).toBe(`${raw}\n`)
  })

  test('#2296: applyFlagSettings validation refuses invalid value without discarding prior valid settings', () => {
    const existing = { effortLevel: 'high', language: 'en' }
    const bad = validateApplyFlagSettingsPatch(existing, {
      permissions: 'not-an-object',
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toContain(
        'apply_flag_settings rejected invalid settings',
      )
    }

    const good = validateApplyFlagSettingsPatch(existing, {
      language: 'fr',
    })
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.merged).toEqual({ effortLevel: 'high', language: 'fr' })
    }
  })

  test('#2323: delayed orphaned permission approval after restart is overridden by alwaysDenyRules', async () => {
    const assistantMessage = {
      type: 'assistant' as const,
      uuid: 'a-1',
      message: {
        id: 'msg-1',
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'Bash',
            input: { command: 'rm -rf /tmp/demo' },
          },
        ],
      },
    }
    const permContext = {
      mode: 'default',
      alwaysAllowRules: {},
      alwaysAskRules: {},
      alwaysDenyRules: { policySettings: ['Bash(rm -rf:*)'] },
      additionalWorkingDirectories: new Map(),
    } as unknown as Parameters<
      typeof recheckOrphanedPermissionAgainstDenyRules
    >[2]

    const checked = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { command: 'rm -rf /tmp/demo' },
        toolUseID: 'toolu_123',
      } as unknown as Parameters<
        typeof recheckOrphanedPermissionAgainstDenyRules
      >[0],
      assistantMessage,
      permContext,
    )
    expect(checked.behavior).toBe('deny')
    if (checked.behavior === 'deny') {
      expect(checked.message).toContain('Bash(rm -rf:*)')
    }

    const enqueued: unknown[] = []
    const handled = await handleOrphanedPermissionResponse({
      message: {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-1',
          response: {
            behavior: 'allow',
            updatedInput: { command: 'rm -rf /tmp/demo' },
            toolUseID: 'toolu_123',
          },
        },
      } as Parameters<typeof handleOrphanedPermissionResponse>[0]['message'],
      setAppState: () => {},
      getAppState: () => ({ toolPermissionContext: permContext }) as never,
      handledToolUseIds: new Set(),
      findUnresolvedToolUseFn: async () => assistantMessage as never,
      enqueueFn: cmd => {
        enqueued.push(cmd)
      },
    })
    expect(handled).toBe(true)
    expect(enqueued).toHaveLength(1)
    const entry = enqueued[0] as {
      orphanedPermission: { permissionResult: { behavior: string } }
    }
    expect(entry.orphanedPermission.permissionResult.behavior).toBe('deny')
  })

  test('#2337: windowsPaths short-circuits unreadable ancestor directories and avoids unnecessary where.exe fallback', () => {
    clearWindowsPathCacheForTesting()
    const readdirCalls: string[] = []
    const lstatCalls: string[] = []
    const hit = resolveWindowsExecutableOnPath('git', {
      pathEnv: 'C:\\Locked\\SubA\\bin;C:\\Locked\\SubB\\bin;C:\\Good\\bin',
      pathExtEnv: '.EXE',
      cwd: 'C:\\Work',
      lstatFn: p => {
        lstatCalls.push(p)
        if (p.toLowerCase() === 'c:\\locked') {
          const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
          throw err
        }
        return {
          isSymbolicLink: () => false,
          isDirectory: () => !p.toLowerCase().endsWith('.exe'),
        }
      },
      readdirFn: d => {
        readdirCalls.push(d)
        return d.toLowerCase() === 'c:\\good\\bin' ? ['git.exe'] : []
      },
      realpathFn: p => p,
    })
    expect(hit).toBe('C:\\Good\\bin\\git.exe')
    // Locked subdirs must never be passed to readdirSync, and C:\Locked probed only once
    expect(readdirCalls).toEqual(['C:\\Good\\bin'])
    expect(
      lstatCalls.filter(p => p.toLowerCase() === 'c:\\locked'),
    ).toHaveLength(1)
    expect(shouldFallbackToWhereExe('git', 'C:\\Good\\bin')).toBe(false)
    expect(shouldFallbackToWhereExe('git', '')).toBe(true)
  })

  test('#2375: cloud / self-hosted connections refuse get_status and redact list_permission_rules & get_settings', () => {
    expect(
      resolveControlConnectionTrustLevel({ isRemoteTransport: true }),
    ).toBe('redacted')
    expect(
      resolveControlConnectionTrustLevel({
        isRemoteTransport: false,
        isCloudHosted: false,
        env: {},
      }),
    ).toBe('full')

    expect(redactPermissionRuleForRemote('Read', 'allow')).toBe('Read')
    expect(
      redactPermissionRuleForRemote('Bash(git push origin main)', 'allow'),
    ).toBe('Bash(withheld)')
    expect(redactPermissionRuleForRemote('bad tool(x)', 'deny')).toBe(
      '*(withheld)',
    )
    expect(redactPermissionRuleForRemote('bad tool(x)', 'allow')).toBe(
      '(withheld)',
    )

    const redactedPermState = redactPermissionRulesStateForRemote({
      mode: 'default',
      alwaysAllowRules: { userSettings: ['Bash(npm test)', 'Read'] },
      alwaysDenyRules: { policySettings: ['Read(/etc/shadow)'] },
      alwaysAskRules: {},
      additionalWorkingDirectories: { '/secret': {} },
    })
    expect(redactedPermState.withheld).toBe(true)
    expect(redactedPermState.originalCwd).toBe('')
    expect(redactedPermState.workspaceDirectories).toEqual([])
    expect(
      (
        redactedPermState.context as {
          alwaysAllowRules: Record<string, string[]>
        }
      ).alwaysAllowRules.userSettings,
    ).toEqual(['Bash(withheld)', 'Read'])

    const redactedSettings = redactSettingsResponseForRemote({
      effective: {
        env: { SECRET: '123' },
        permissions: {
          allow: ['Bash(ls)'],
          additionalDirectories: ['/secret'],
        },
      },
      sources: [
        {
          source: 'policySettings',
          settings: {
            disableSideloadFlags: true,
            permissions: { deny: ['Bash(rm -rf)'] },
          },
        },
      ],
      errors: [{ file: '/secret/settings.json', path: 'foo', message: 'bad' }],
    })
    expect(redactedSettings.withheld).toBe(true)
    expect(
      (redactedSettings.effective as Record<string, unknown>).env,
    ).toBeUndefined()
    expect((redactedSettings.errors as Array<{ path: string }>)[0]?.path).toBe(
      '',
    )

    const errors: string[] = []
    const successes: unknown[] = []
    dispatchPrintControlExtra(
      'get_status',
      {},
      {
        getMcpClients: () => [],
        getPermissionContext: () => ({}),
        setPromptSuggestionEnabled: () => {},
        sendSuccess: r => successes.push(r),
        sendError: e => errors.push(e),
        defer: () => {},
        isRemoteTransport: true,
        errorMessage: String,
      },
    )
    expect(errors[0]).toContain('not available on this connection')
    expect(successes).toHaveLength(0)
  })

  test('#2376: claude -p waits for OAuth account data when no cached account data exists', async () => {
    expect(hasCachedOAuthAccountData(undefined)).toBe(false)
    expect(
      hasCachedOAuthAccountData({
        accountUuid: 'a1',
        organizationUuid: 'o1',
        billingType: 'stripe',
        accountCreatedAt: '2025-01-01',
        subscriptionCreatedAt: '2025-01-02',
      }),
    ).toBe(true)

    let fetched = false
    const waited = await waitForCachedAccountDataBeforePrint({
      isSubscriber: () => true,
      hasProfileScope: () => true,
      getOAuthAccount: () => undefined,
      populateAccountInfo: async () => {
        fetched = true
        return true
      },
      timeoutMs: 1000,
    })
    expect(waited).toEqual({ waited: true, populated: true, timedOut: false })
    expect(fetched).toBe(true)

    const skipped = await waitForCachedAccountDataBeforePrint({
      isSubscriber: () => true,
      hasProfileScope: () => true,
      getOAuthAccount: () => ({
        accountUuid: 'a1',
        organizationUuid: 'o1',
        billingType: 'stripe',
        accountCreatedAt: '2025-01-01',
        subscriptionCreatedAt: '2025-01-02',
      }),
      populateAccountInfo: async () => {
        throw new Error('should not be called when cached')
      },
    })
    expect(skipped).toEqual({
      waited: false,
      populated: false,
      timedOut: false,
    })
  })
})
