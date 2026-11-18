import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  BG_ATTACH_HELD_EXIT_NOTICE,
  formatBgAttachHeldExitNotice,
} from '../../daemon/clientAttach.js'
import { purgeProjectHandler } from '../handlers/purgeProject.js'
import {
  hasPendingSessionWakeup,
  isBackgroundedLocalBashTask,
  nextPrintBgWaitGate,
} from '../printBgWait.js'

describe('v2.1.292-295 print/purge/daemon alignment (#210, #317, #457)', () => {
  let tempDir: string
  let origConfigDir: string | undefined
  let origExitCode: typeof process.exitCode

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'print-purge-293-'))
    origConfigDir = process.env.CLAUDE_CONFIG_DIR
    origExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    if (origConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = origConfigDir
    }
    process.exitCode = origExitCode
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('#210: nextPrintBgWaitGate holds for backgrounded local_bash when holdForBackgroundShells is true, and hasPendingSessionWakeup detects /loop wakeups', () => {
    const bashTask = {
      id: 'bash-1',
      type: 'local_bash',
      isBackgrounded: true,
    }
    expect(isBackgroundedLocalBashTask(bashTask)).toBe(true)

    const held = nextPrintBgWaitGate({
      runningBackgroundTasks: [bashTask],
      inputClosed: true,
      hasMainThreadQueued: false,
      hasActiveTeammates: false,
      hasPendingNotification: false,
      holdForBackgroundShells: true,
      ceilingExceeded: false,
      deadline: null,
      swept: false,
      now: 1000,
    })
    expect(held.deadline).toBeNull()
    expect(held.shouldSweep).toBe(false)

    const notHeld = nextPrintBgWaitGate({
      runningBackgroundTasks: [bashTask],
      inputClosed: true,
      hasMainThreadQueued: false,
      hasActiveTeammates: false,
      hasPendingNotification: false,
      holdForBackgroundShells: false,
      ceilingExceeded: false,
      deadline: null,
      swept: false,
      now: 1000,
    })
    expect(notHeld.deadline).toBe(6000)

    expect(
      hasPendingSessionWakeup([{ kind: 'loop', scheduledFor: 10_000 }], {
        now: 5_000,
        parkedSince: 1_000,
      }),
    ).toBe(true)
    expect(
      hasPendingSessionWakeup([{ kind: 'loop', scheduledFor: 10_000 }], {
        now: 200_000,
        parkedSince: 1_000,
      }),
    ).toBe(false)
  })

  test('#317: purgeProjectHandler deletes remaining items, lists failures, and sets exitCode = 1 when an item fails', async () => {
    // Skip on root where chmod 0o555 does not block deletion
    if (process.getuid?.() === 0) return

    const configDir = join(tempDir, 'cfg')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const projectPath = join(tempDir, 'proj')
    mkdirSync(projectPath, { recursive: true })

    // Create project transcript dir with one session + debug log
    const { getProjectDir } = await import('../../utils/sessionPaths.js')
    const projDir = getProjectDir(projectPath)
    mkdirSync(projDir, { recursive: true })
    const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    writeFileSync(join(projDir, `${sid}.jsonl`), '{}\n')

    const debugDir = join(configDir, 'debug')
    mkdirSync(debugDir, { recursive: true })
    const debugFile = join(debugDir, `${sid}.txt`)
    writeFileSync(debugFile, 'debug log')
    // Make debugDir read-only so deleting debugFile fails with EACCES
    chmodSync(debugDir, 0o555)

    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    const prevExitCode = process.exitCode
    try {
      await purgeProjectHandler({ yes: true }, projectPath)
    } finally {
      process.stderr.write = origWrite
      chmodSync(debugDir, 0o755)
    }

    expect(process.exitCode).toBe(1)
    process.exitCode = prevExitCode ?? 0
    const stderrOut = stderrChunks.join('')
    expect(stderrOut).toContain('item(s) failed:')
    expect(stderrOut).toContain('What could not be deleted is still on disk')
  })

  test('#457: formatBgAttachHeldExitNotice prints 1-minute notice when daemon down and no service on non-Windows TTY', () => {
    expect(
      formatBgAttachHeldExitNotice({
        daemonUp: false,
        viaService: false,
        platform: 'darwin',
        stdoutIsTTY: true,
      }),
    ).toBe(`${BG_ATTACH_HELD_EXIT_NOTICE}\n`)

    expect(
      formatBgAttachHeldExitNotice({
        daemonUp: true,
        viaService: false,
        platform: 'darwin',
        stdoutIsTTY: true,
      }),
    ).toBe('')

    expect(
      formatBgAttachHeldExitNotice({
        daemonUp: false,
        viaService: true,
        platform: 'linux',
        stdoutIsTTY: true,
      }),
    ).toBe('')
  })
})
