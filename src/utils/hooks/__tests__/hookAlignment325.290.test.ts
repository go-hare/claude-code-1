import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import {
  applyOnFailureBlockToHookResult,
  shouldBlockOnFailureForEvent,
} from '../../hooks.js'
import { clearCommandScopedAllowRules } from '../../permissions/permissionSetup.js'
import {
  getPluginCacheDir,
  parsePluginCacheIdentity,
  pluginDirectoryExists,
} from '../hookCommandRunner.js'

const SRC_ROOT = join(import.meta.dir, '..', '..', '..')

describe('#343 onFailure: block — stoppedAfterItsTimeout & shouldBlockOnFailureForEvent', () => {
  test('shouldBlockOnFailureForEvent returns true for non-ignored events and false for ignored events', () => {
    const blockHook = {
      type: 'command' as const,
      command: 'echo hi',
      onFailure: 'block' as const,
    }
    const continueHook = {
      type: 'command' as const,
      command: 'echo hi',
      onFailure: 'continue' as const,
    }

    expect(shouldBlockOnFailureForEvent(blockHook, 'PreToolUse')).toBe(true)
    expect(shouldBlockOnFailureForEvent(blockHook, 'UserPromptSubmit')).toBe(
      true,
    )
    expect(shouldBlockOnFailureForEvent(continueHook, 'PreToolUse')).toBe(false)

    for (const ignored of [
      'Stop',
      'SubagentStop',
      'TaskCompleted',
      'TeammateIdle',
    ] as const) {
      expect(shouldBlockOnFailureForEvent(blockHook, ignored)).toBe(false)
    }
  })

  test('applyOnFailureBlockToHookResult blocks when cancelled has stoppedAfterItsTimeout even if parent signal aborted', () => {
    const ac = new AbortController()
    ac.abort()
    const hook = {
      type: 'command' as const,
      command: 'sleep 10',
      onFailure: 'block' as const,
    }

    const blocked = applyOnFailureBlockToHookResult(
      {
        outcome: 'cancelled',
        hook,
        stoppedAfterItsTimeout: true,
      } as Parameters<typeof applyOnFailureBlockToHookResult>[0],
      'PreToolUse',
      ac.signal,
    )
    expect(blocked.outcome).toBe('blocking')
    expect(blocked.blockingError?.blockingError).toContain('timed out')

    const notBlocked = applyOnFailureBlockToHookResult(
      {
        outcome: 'cancelled',
        hook,
      },
      'PreToolUse',
      ac.signal,
    )
    expect(notBlocked.outcome).toBe('cancelled')
  })

  test('executeHooks and executeHooksOutsideREPL wire shouldBlockOnFailureForEvent and stoppedAfterItsTimeout', () => {
    const hooksSrc = readFileSync(join(SRC_ROOT, 'utils/hooks.ts'), 'utf8')
    expect(hooksSrc).toContain(
      'forceSyncExecution || shouldBlockOnFailureForEvent(hook, hookEvent)',
    )
    expect(hooksSrc).toContain(
      'shouldBlockOnFailureForEvent(\n            hook as HookWithOnFailure,\n            hookEvent as HookEvent,\n          )',
    )
    expect(hooksSrc).toContain('commandResult.stoppedAfterItsTimeout !== true')
    expect(hooksSrc).toContain('...(abortedByParent && { cancelled: true })')
    expect(hooksSrc).toContain(
      '...(commandResult.stoppedAfterItsTimeout && {\n            stoppedAfterItsTimeout: true,\n          })',
    )
  })
})

describe('#436 pluginDirectoryExists & storageV5 wiring', () => {
  test('parsePluginCacheIdentity anchors to getPluginCacheDir() with exact 3 segments and rejects .zip/traversal', () => {
    const cacheDir = getPluginCacheDir()
    expect(cacheDir).toBe(join(getClaudeConfigHomeDir(), 'plugins', 'cache'))

    expect(
      parsePluginCacheIdentity(join(cacheDir, 'mkt', 'plug', '1.0.0')),
    ).toEqual({
      marketplace: 'mkt',
      plugin: 'plug',
      version: '1.0.0',
    })

    // Rejects wrong cacheDir override
    expect(
      parsePluginCacheIdentity(
        join(cacheDir, 'mkt', 'plug', '1.0.0'),
        '/tmp/other',
      ),
    ).toBeNull()
    // Rejects .zip version
    expect(
      parsePluginCacheIdentity(join(cacheDir, 'mkt', 'plug', '1.0.0.zip')),
    ).toBeNull()
    // Rejects <3 or >3 segments
    expect(parsePluginCacheIdentity(join(cacheDir, 'mkt', 'plug'))).toBeNull()
    expect(
      parsePluginCacheIdentity(join(cacheDir, 'mkt', 'plug', '1.0.0', 'extra')),
    ).toBeNull()
    // Rejects path outside cacheDir
    expect(
      parsePluginCacheIdentity('/tmp/fake/plugins/cache/mkt/plug/1.0.0'),
    ).toBeNull()
  })

  test('pluginDirectoryExists gates scopeKind with isHoverRestOn() and falls back to pathExists', async () => {
    const runnerSrc = readFileSync(
      join(SRC_ROOT, 'utils/hooks/hookCommandRunner.ts'),
      'utf8',
    )
    expect(runnerSrc).toContain(
      'if (isHoverRestOn() && isStorageV5ScopeKindHost(storageV5))',
    )

    // With hover-rest off (default in unit tests), scopeKind is not called and pathExists is used
    let called = false
    const fakeHost = {
      scopeKind: async () => {
        called = true
        return { ok: true, value: { kind: 'directory' } }
      },
    }
    const exists = await pluginDirectoryExists(
      fakeHost,
      join(getPluginCacheDir(), 'mkt', 'plug', '1.0.0'),
    )
    expect(called).toBe(false)
    expect(exists).toBe(false)
  })

  test('storageV5 is forwarded through sessionStart.ts and all non-REPL/contextless hook dispatchers', () => {
    const sessionStartSrc = readFileSync(
      join(SRC_ROOT, 'utils/sessionStart.ts'),
      'utf8',
    )
    expect(sessionStartSrc).toContain('storageV5?: unknown')
    expect(sessionStartSrc).toContain('storageV5,')

    const hooksSrc = readFileSync(join(SRC_ROOT, 'utils/hooks.ts'), 'utf8')
    expect(hooksSrc).toContain('getPinnedStorageV5()')
    for (const fn of [
      'executeNotificationHooks',
      'executeStopFailureHooks',
      'executeTeammateIdleHooks',
      'executeSessionStartHooks',
      'executeSubagentStartHooks',
      'executeSessionEndHooks',
      'executeConfigChangeHooks',
      'executeCwdChangedHooks',
      'executeFileChangedHooks',
      'executeDirectoryAddedHooks',
      'executeElicitationHooks',
      'executeElicitationResultHooks',
      'executeStatusLineCommand',
      'executeFileSuggestionCommand',
    ]) {
      const idx =
        hooksSrc.indexOf(`function ${fn}`) !== -1
          ? hooksSrc.indexOf(`function ${fn}`)
          : hooksSrc.indexOf(`function* ${fn}`)
      expect(idx).toBeGreaterThan(-1)
      const slice = hooksSrc.slice(idx, idx + 1800)
      expect(slice).toContain('storageV5')
    }
  })
})

describe('#520 orphaned AbortSignal on /clear & clears counter', () => {
  test('wiring across hooks.ts, sessionStart.ts, clear/conversation.ts, conversationRecovery.ts, and print.ts', () => {
    const hooksSrc = readFileSync(join(SRC_ROOT, 'utils/hooks.ts'), 'utf8')
    expect(hooksSrc).toContain(
      'function armLaterLoadedSessionStart(\n  payload: SessionStartLateLoadPayload,\n  signal?: AbortSignal,\n  orphaned?: AbortSignal,',
    )
    expect(hooksSrc).toContain('if (orphaned?.aborted) {\n    return\n  }')

    const clearSrc = readFileSync(
      join(SRC_ROOT, 'commands/clear/conversation.ts'),
      'utf8',
    )
    expect(clearSrc).toContain('activeClearSessionStartController?.abort()')
    expect(clearSrc).toContain(
      "processSessionStartHooks('clear', {\n      orphaned: orphanedController.signal,",
    )

    const recoverySrc = readFileSync(
      join(SRC_ROOT, 'utils/conversationRecovery.ts'),
      'utf8',
    )
    expect(recoverySrc).toContain(
      'CLAUDE_CODE_RESUME_SESSIONSTART_HOOKS_WAIT_MS',
    )
    expect(recoverySrc).toContain('overdueSessionStartHooks')
    expect(recoverySrc).toContain('orphaned: overdueController.signal')

    const printSrc = readFileSync(join(SRC_ROOT, 'cli/print.ts'), 'utf8')
    expect(printSrc).toContain('supportOverdueSessionStartHooks: true')
    expect(printSrc).toContain('sessionStartState.clears !== snapshotClears')
    expect(printSrc).toContain(
      "event as { type?: string }).type === 'conversation_reset'",
    )
    expect(printSrc).toContain('overdueSessionStartHooks?.abort()')
    expect(printSrc).toContain('sessionStartState.clears++')
  })
})

describe('#206 print.ts pollEmptyDispatch clearCommandScopedAllowRules', () => {
  test('clearCommandScopedAllowRules clears both alwaysAllowRules.command and strippedDangerousRules.command', () => {
    const ctx = {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: { command: ['Bash(ls:*)'], session: ['Read'] },
      alwaysDenyRules: {},
      alwaysAskRules: {},
      strippedDangerousRules: { command: ['Bash(rm:*)'], session: ['Write'] },
      isBypassPermissionsModeAvailable: false,
    } as Parameters<typeof clearCommandScopedAllowRules>[0]

    const cleared = clearCommandScopedAllowRules(ctx)
    expect(cleared.alwaysAllowRules.command).toBeUndefined()
    expect(cleared.alwaysAllowRules.session).toEqual(['Read'])
    expect(cleared.strippedDangerousRules?.command).toBeUndefined()
    expect(cleared.strippedDangerousRules?.session).toEqual(['Write'])
  })

  test('print.ts pollEmptyDispatch calls clearCommandScopedAllowRules', () => {
    const printSrc = readFileSync(join(SRC_ROOT, 'cli/print.ts'), 'utf8')
    expect(printSrc).toContain(
      '...clearCommandScopedAllowRules(prev.toolPermissionContext),',
    )
  })
})
