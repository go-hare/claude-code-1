import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isChildSessionWithoutSdkUrl,
  isolatedRemoteSessionId,
} from '../sessionRoot.js'
import {
  getResumeInterruptedTurnMaxAge,
  isResumeInterruptedTurnStale,
  isUnattendedStartUnconfirmedError,
} from '../conversationRecovery.js'
import {
  consumeRelaunchResumeHintFlags,
  extractResumeHintLaunchFlags,
  getResumeHintLaunchFlags,
  resetShutdownState,
  setResumeHintLaunchFlags,
  type CommanderOptionLike,
} from '../gracefulShutdown.js'
import {
  consumePendingShutdownRequest,
  recordPendingShutdownRequest,
  resetPendingShutdownRequestsForTesting,
  writeToMailbox,
} from '../teammateMailbox.js'
import { buildInheritedCliArgParts } from '../swarm/spawnUtils.js'
import { updateBgRespawnFlag } from '../cliRelaunch.js'
import { getProject, syncExitReStamp } from '../sessionStorage.js'

describe('Wave 316-318 Group E utils alignment', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wave-e-316-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    resetShutdownState()
    resetPendingShutdownRequestsForTesting()
  })

  test('#1536/#1582/#1583: child session isolates CLAUDE_CODE_REMOTE_SESSION_ID unless --sdk-url or disable flag', () => {
    const envBase = {
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_REMOTE_SESSION_ID: 'parent-session-123',
    }
    expect(isChildSessionWithoutSdkUrl(['bun', 'cli.tsx'], envBase)).toBe(true)
    expect(isolatedRemoteSessionId(['bun', 'cli.tsx'], envBase)).toBeNull()

    expect(
      isolatedRemoteSessionId(['bun', 'cli.tsx'], {
        ...envBase,
        CLAUDE_CODE_DISABLE_NESTED_SESSION_ID: '1',
      }),
    ).not.toBeNull()

    expect(
      isChildSessionWithoutSdkUrl(
        ['bun', 'cli.tsx', '--sdk-url', 'https://example.com'],
        envBase,
      ),
    ).toBe(false)
    expect(
      isolatedRemoteSessionId(
        ['bun', 'cli.tsx', '--sdk-url=https://example.com'],
        envBase,
      ),
    ).not.toBeNull()
  })

  test('#1599: isUnattendedStartUnconfirmedError & isResumeInterruptedTurnStale & getResumeInterruptedTurnMaxAge', () => {
    const errMsg = {
      type: 'assistant',
      isApiErrorMessage: true,
      apiError: 'unattended_start_unconfirmed',
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(isUnattendedStartUnconfirmedError(errMsg)).toBe(true)
    expect(
      isUnattendedStartUnconfirmedError({
        type: 'assistant',
        isApiErrorMessage: true,
        apiError: 'rate_limit',
      }),
    ).toBe(false)

    const now = Date.parse('2026-01-02T00:00:00.000Z')
    const freshTs = '2026-01-01T23:55:00.000Z'
    const msgs = [
      { type: 'user', timestamp: freshTs },
      { ...errMsg, timestamp: '2025-01-01T00:00:00.000Z' },
    ]
    // Should skip unattended_start_unconfirmed and use freshTs (5 min ago < 1h)
    expect(
      isResumeInterruptedTurnStale(
        msgs,
        { CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '3600000' },
        now,
      ),
    ).toBe(false)

    expect(
      getResumeInterruptedTurnMaxAge(false, {
        CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '60000',
      }),
    ).toEqual({ maxAgeMs: 60000, source: 'env' })
    expect(
      getResumeInterruptedTurnMaxAge(false, {
        CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '0',
      }),
    ).toBeUndefined()
  })

  test('#1587: extractResumeHintLaunchFlags and relaunch env consumption', () => {
    const opts: CommanderOptionLike[] = [
      { long: '--model', short: '-m', required: true, name: () => 'model' },
      { long: '--verbose', name: () => 'verbose' },
      { long: '--resume', short: '-r', optional: true, name: () => 'resume' },
      { long: '--agent-id', required: true, name: () => 'agent-id' },
    ]
    expect(
      extractResumeHintLaunchFlags(opts, [
        '--model',
        'claude-sonnet-4-6',
        '--verbose',
        '--resume',
        'abc',
      ]),
    ).toBe('--model claude-sonnet-4-6 --verbose')

    expect(extractResumeHintLaunchFlags(opts, ['--agent-id', 'worker-1'])).toBe(
      '',
    )

    process.env.CLAUDE_CODE_RELAUNCH_RESUME_HINT_FLAGS = '--verbose'
    expect(consumeRelaunchResumeHintFlags(opts)).toBe('--verbose')
    expect(process.env.CLAUDE_CODE_RELAUNCH_RESUME_HINT_FLAGS).toBeUndefined()

    setResumeHintLaunchFlags('--model opus')
    expect(getResumeHintLaunchFlags()).toBe('--model opus')
  })

  test('#1555: writeToMailbox does not recreate deleted team inbox', async () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempDir
    try {
      const teamName = 'deleted-team'
      // Team directory exists or doesn't, but config.json is absent -> deleted
      const result = await writeToMailbox(
        'worker-a',
        {
          from: 'team-lead',
          text: 'late message',
          timestamp: new Date().toISOString(),
        },
        teamName,
      )
      expect(result).toBeUndefined()
      expect(
        existsSync(
          join(tempDir, 'teams', teamName, 'inboxes', 'worker-a.json'),
        ),
      ).toBe(false)
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })

  test('#1556: consumePendingShutdownRequest prevents replay and mismatched addressee', () => {
    recordPendingShutdownRequest('req-1', 'worker-a', true)
    expect(consumePendingShutdownRequest('unknown-req', 'worker-a')).toBe(false)
    expect(consumePendingShutdownRequest('req-1', 'worker-b')).toBe(false)
    expect(consumePendingShutdownRequest('req-1', 'worker-a')).toBe(true)
    // Replay must fail
    expect(consumePendingShutdownRequest('req-1', 'worker-a')).toBe(false)
  })

  test('#1577: buildInheritedCliArgParts passes --permission-mode default for default/plan/dontAsk/bubble', () => {
    for (const mode of ['default', 'plan', 'dontAsk', 'bubble'] as const) {
      const args = buildInheritedCliArgParts({
        permissionMode: mode as Parameters<
          typeof buildInheritedCliArgParts
        >[0] extends { permissionMode?: infer P }
          ? P
          : never,
      })
      const idx = args.indexOf('--permission-mode')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(args[idx + 1]).toBe('default')
    }
  })

  test('#1578: updateBgRespawnFlag updates --permission-mode in bg job state.json', () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempDir
    try {
      const jobShort = 'job-123'
      const jobDir = join(tempDir, 'jobs', jobShort)
      mkdirSync(jobDir, { recursive: true })
      writeFileSync(
        join(jobDir, 'state.json'),
        JSON.stringify({
          state: 'working',
          detail: '',
          tempo: 'active',
          intent: 'test',
          sessionId: 'sess-1',
          cwd: tempDir,
          template: 'default',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          firstTerminalAt: null,
          output: null,
          children: null,
          respawnFlags: ['--inherit-permission-mode', 'default', '--verbose'],
        }),
      )
      const changed = updateBgRespawnFlag(
        '--permission-mode',
        ['--inherit-permission-mode'],
        'acceptEdits',
        {
          CLAUDE_JOB_DIR: jobDir,
          CLAUDE_CODE_SESSION_KIND: 'bg',
        },
      )
      expect(changed).toBe(true)
      const updated = JSON.parse(
        require('fs').readFileSync(join(jobDir, 'state.json'), 'utf8'),
      )
      expect(updated.respawnFlags).toEqual([
        '--verbose',
        '--permission-mode',
        'acceptEdits',
      ])
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })

  test('#1635: reAppendSessionMetadata(..., true) does not recreate deleted transcript', () => {
    const deletedPath = join(tempDir, 'deleted-session.jsonl')
    const proj = getProject()
    const prevFile = proj.sessionFile
    const prevTitle = proj.currentSessionTitle
    try {
      proj.sessionFile = deletedPath
      proj.currentSessionTitle = 'My Title'
      proj.reAppendSessionMetadata(true, true)
      expect(existsSync(deletedPath)).toBe(false)
    } finally {
      proj.sessionFile = prevFile
      proj.currentSessionTitle = prevTitle
    }
  })
})
