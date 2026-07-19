/**
 * Official k$a / zU / Klr / Ex portable identity tests.
 * Covers recycled-pid safety, kill notes, and no-identity no-kill.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import {
  getProcessLstartString,
  killPidIfIdentityMatches,
  processLstartMatches,
} from '../genericProcessUtils.js'
import { createAdoptedShellCommand } from '../ShellCommand.js'

const children: ChildProcess[] = []

function spawnSleep(seconds = 60): { pid: number; child: ChildProcess } {
  const child = spawn('sleep', [String(seconds)], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  children.push(child)
  if (!child.pid) throw new Error('spawn failed')
  return { pid: child.pid, child }
}

function killQuiet(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* gone */
  }
}

afterEach(() => {
  for (const c of children) {
    if (c.pid) killQuiet(c.pid)
  }
  children.length = 0
})

describe('processLstartMatches (official zU)', () => {
  test('undefined expected always matches', async () => {
    await expect(processLstartMatches(process.pid, undefined)).resolves.toBe(
      true,
    )
  })

  test('matching lstart returns true on live pid', async () => {
    if (process.platform === 'win32') return
    const lstart = await getProcessLstartString(process.pid)
    if (!lstart) return // ps blocked
    await expect(processLstartMatches(process.pid, lstart)).resolves.toBe(true)
  })

  test('wrong lstart returns false on live pid', async () => {
    if (process.platform === 'win32') return
    const lstart = await getProcessLstartString(process.pid)
    if (!lstart) return
    await expect(
      processLstartMatches(process.pid, 'Mon Jan  1 00:00:00 1970'),
    ).resolves.toBe(false)
  })

  test('dead pid: current undefined → true (ps race, official zU)', async () => {
    // Official: r===void 0 || r===t — treat missing ps as still matching.
    await expect(
      processLstartMatches(2_000_000_001, 'Mon Jan  1 00:00:00 1970'),
    ).resolves.toBe(true)
  })
})

describe('killPidIfIdentityMatches (official Klr)', () => {
  test('no identity → no SIGTERM', async () => {
    const { pid } = spawnSleep(30)
    const ok = await killPidIfIdentityMatches(pid, {})
    expect(ok).toBe(false)
    // Still alive
    expect(() => process.kill(pid, 0)).not.toThrow()
  })

  test('ticks-only → no SIGTERM (xen stub)', async () => {
    const { pid } = spawnSleep(30)
    const ok = await killPidIfIdentityMatches(pid, { startTimeTicks: 42 })
    expect(ok).toBe(false)
    expect(() => process.kill(pid, 0)).not.toThrow()
  })

  test('wrong procStart → no SIGTERM', async () => {
    if (process.platform === 'win32') return
    const { pid } = spawnSleep(30)
    const ok = await killPidIfIdentityMatches(pid, {
      procStart: 'Mon Jan  1 00:00:00 1970',
    })
    expect(ok).toBe(false)
    expect(() => process.kill(pid, 0)).not.toThrow()
  })

  test('matching procStart → SIGTERM', async () => {
    if (process.platform === 'win32') return
    const { pid } = spawnSleep(30)
    const lstart = await getProcessLstartString(pid)
    if (!lstart) return
    const ok = await killPidIfIdentityMatches(pid, { procStart: lstart })
    expect(ok).toBe(true)
    // Give kernel a moment; sleep may ignore briefly on some systems — poll.
    let dead = false
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(pid, 0)
        await Bun.sleep(25)
      } catch {
        dead = true
        break
      }
    }
    expect(dead).toBe(true)
  })
})

describe('createAdoptedShellCommand (official k$a)', () => {
  test('kill with procStart appends identity still matched note', async () => {
    if (process.platform === 'win32') return
    const { pid } = spawnSleep(30)
    const lstart = await getProcessLstartString(pid)
    if (!lstart) return

    const shell = createAdoptedShellCommand({
      taskId: `adopt-id-note-${pid}`,
      pid,
      procStart: lstart,
      pollMs: 50_000, // avoid race with poll finish
    })
    const path = shell.taskOutput.path
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'seed\n')

    shell.kill()
    const result = await shell.result
    expect(result.code).toBe(-1)
    expect(result.interrupted).toBe(true)

    // Allow async append
    await Bun.sleep(50)
    expect(existsSync(path)).toBe(true)
    const body = readFileSync(path, 'utf8')
    expect(body).toContain(
      'SIGTERM requested for detached process tree (sent if identity still matched)',
    )
    expect(body).toContain('adopted handle released')
  })

  test('kill without identity appends detached process still running note', async () => {
    const { pid } = spawnSleep(30)
    const shell = createAdoptedShellCommand({
      taskId: `adopt-no-id-note-${pid}`,
      pid,
      pollMs: 50_000,
    })
    const path = shell.taskOutput.path
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'seed\n')

    shell.kill()
    await shell.result
    await Bun.sleep(50)
    const body = readFileSync(path, 'utf8')
    expect(body).toContain(
      '[detached process still running — adopted handle released]',
    )
    // Official Klr: no identity → no SIGTERM; child should still be alive.
    expect(() => process.kill(pid, 0)).not.toThrow()
  })

  test('identity mismatch on poll finishes as completed (recycled pid)', async () => {
    if (process.platform === 'win32') return
    const { pid } = spawnSleep(30)
    // Wrong lstart while pid is live → treat as dead (recycled).
    const shell = createAdoptedShellCommand({
      taskId: `adopt-mismatch-${pid}`,
      pid,
      procStart: 'Mon Jan  1 00:00:00 1970',
      pollMs: 50,
    })
    const path = shell.taskOutput.path
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'seed\n')

    const result = await Promise.race([
      shell.result,
      Bun.sleep(2000).then(() => null),
    ])
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.code).toBe(-1)
    expect(result.interrupted).toBe(false)
    await Bun.sleep(50)
    const body = readFileSync(path, 'utf8')
    expect(body).toContain(
      '[process exited while detached; exit code unknown]',
    )
    // Pid should still be alive (we did not kill on mismatch finish).
    expect(() => process.kill(pid, 0)).not.toThrow()
    shell.cleanup()
  })
})
