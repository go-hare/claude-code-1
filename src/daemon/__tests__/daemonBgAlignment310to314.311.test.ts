import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  eagerFirstOperand,
  mayDispatchSubcommand,
  respawnHandler,
} from '../../cli/bg.js'
import { stalledSubscribeMessage } from '../../cli/bg/logsSubscribe.js'
import {
  classifyBetweenTurnCrashRespawn,
  isSessionPinned,
} from '../bgWorker.js'
import type { BgJobState } from '../jobState.js'

describe('daemon & cli/bg 2.1.311–2.1.314 alignment (#1244, #1245, #1246, #1276, #1281, #1417)', () => {
  let tempDir: string | undefined
  const origConfigDir = process.env.CLAUDE_CONFIG_DIR

  afterEach(() => {
    process.exitCode = 0
    if (origConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = origConfigDir
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('#1244 & #1276: classifyBetweenTurnCrashRespawn restarts settled done session when attached/cron/pinned, else settles with resume hint', () => {
    const nowIso = new Date().toISOString()
    const baseState: BgJobState = {
      sessionId: 'sess-1',
      cwd: '/tmp',
      pid: 0,
      state: 'done',
      detail: '',
      intent: '',
      template: 'default',
      createdAt: nowIso,
      updatedAt: nowIso,
      firstTerminalAt: nowIso,
      output: null,
      children: null,
      respawnFlags: [],
      tempo: 'idle',
    }

    // Attached -> respawn
    expect(
      classifyBetweenTurnCrashRespawn({
        state: baseState,
        attachersCount: 1,
        isPinned: false,
        attempt: 1,
      }),
    ).toEqual({ action: 'respawn', neededBy: 'attached' })

    // Scheduled task / wakeup -> respawn
    expect(
      classifyBetweenTurnCrashRespawn({
        state: {
          ...baseState,
          inFlight: { tasks: 1, queued: 0, kinds: ['session_cron'] },
        },
        attachersCount: 0,
        isPinned: false,
        attempt: 1,
      }),
    ).toEqual({ action: 'respawn', neededBy: 'session_cron' })

    // Pinned -> respawn
    expect(
      classifyBetweenTurnCrashRespawn({
        state: baseState,
        attachersCount: 0,
        isPinned: true,
        attempt: 1,
      }),
    ).toEqual({ action: 'respawn', neededBy: 'pinned' })

    // Idle & unattached/unpinned -> settle with resume notice (no restart promise)
    const settled = classifyBetweenTurnCrashRespawn({
      state: baseState,
      attachersCount: 0,
      isPinned: false,
      attempt: 1,
    })
    expect(settled.action).toBe('settle')
    if (settled.action === 'settle') {
      expect(settled.notice).toContain('not restarted')
      expect(settled.notice).toContain('claude --resume')
    }
  })

  test('#1245: stalledSubscribeMessage suggests stop --any and notes it ends background sessions', () => {
    const msg = stalledSubscribeMessage()
    expect(msg).toContain('did not respond')
    expect(msg).not.toContain('daemon restart')
    if (msg.includes('stop --any')) {
      expect(msg).toContain('ends background sessions')
    }
  })

  test('#1246: respawnHandler reports no matching job before starting background service', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bg-respawn-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    let stderr = ''
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk)
      return true
    }) as typeof process.stderr.write
    try {
      await respawnHandler('deadbeef')
    } finally {
      process.stderr.write = origWrite
    }
    expect(stderr).toContain("No job matching 'deadbeef'")
    expect(process.exitCode).toBe(1)
  })

  test('#1281: mayDispatchSubcommand returns false for option-only launches like --model opus', () => {
    expect(mayDispatchSubcommand(['--model', 'opus'])).toBe(false)
    expect(mayDispatchSubcommand(['--verbose', '--model=sonnet'])).toBe(false)
    expect(mayDispatchSubcommand(['--help'])).toBe(true)
    expect(mayDispatchSubcommand(['daemon', 'status'])).toBe(true)
    expect(mayDispatchSubcommand(['--model', 'opus', 'mcp'])).toBe(true)
    expect(eagerFirstOperand(['--model', 'opus'])).toBeUndefined()
    expect(eagerFirstOperand(['--model', 'opus', 'mcp'])).toBe('mcp')
  })

  test('#1417: bgWorker checks binary presence on disk before claiming daemon binary was deleted', () => {
    const src = readFileSync(join(import.meta.dir, '../bgWorker.ts'), 'utf8')
    expect(src).toContain('binaryMissing')
    expect(src).toContain(
      "Couldn't start the session. Run \\`claude daemon stop --any\\` (ends background sessions)",
    )
  })

  test('#1244: isSessionPinned reads pins.json and scheduleRespawn passes it instead of false', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bg-pins-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    writeFileSync(join(tempDir, 'pins.json'), JSON.stringify(['abcd1234']))
    expect(isSessionPinned('abcd1234')).toBe(true)
    expect(isSessionPinned('other999')).toBe(false)

    const workerSrc = readFileSync(
      join(import.meta.dir, '../bgWorker.ts'),
      'utf8',
    )
    expect(workerSrc).toContain(
      'isPinned: isSessionPinned(this.dispatch.short)',
    )
  })

  test('#1267: bgWorker wires resolveAttacherHyperlinks and clientAttach sends caps.hyperlinks', () => {
    const workerSrc = readFileSync(
      join(import.meta.dir, '../bgWorker.ts'),
      'utf8',
    )
    const attachSrc = readFileSync(
      join(import.meta.dir, '../clientAttach.ts'),
      'utf8',
    )
    expect(workerSrc).toContain('resolveAttacherHyperlinks(last.caps)')
    expect(attachSrc).toContain('hyperlinks: supportsHyperlinks()')
  })

  test('#1276: controlSocketClient, orphanAgentResume, and bgWorker align non-restart & resume copy', () => {
    const clientSrc = readFileSync(
      join(import.meta.dir, '../controlSocketClient.ts'),
      'utf8',
    )
    const orphanSrc = readFileSync(
      join(import.meta.dir, '../../utils/orphanAgentResume.ts'),
      'utf8',
    )
    const workerSrc = readFileSync(
      join(import.meta.dir, '../bgWorker.ts'),
      'utf8',
    )
    expect(clientSrc).toContain(
      'connection dropped mid-request — it may have restarted; retry',
    )
    expect(orphanSrc).toContain(
      'so it was not restarted and no further task notification will arrive',
    )
    expect(workerSrc).toContain(
      'not restarted; run \\`claude --resume\\` to continue',
    )
  })
})
