/**
 * densable 2.1.212 #30 — false "Command timed out" only when we timed out
 * (status killed + code 143), not when the child exits 143 externally.
 */
import { spawn } from 'child_process'
import { describe, expect, test } from 'bun:test'
import { wrapSpawn } from '../ShellCommand.js'
import { TaskOutput } from '../task/TaskOutput.js'

describe('densable #30 ShellCommand exit 143 vs timeout', () => {
  test('local timeout kill reports Command timed out', async () => {
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'ping -n 60 127.0.0.1 >nul'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        : spawn('sleep', ['60'], { stdio: 'ignore' })

    const ac = new AbortController()
    const taskOutput = new TaskOutput('test-timeout-143', null, false)
    // 50ms timeout → #handleTimeout → #doKill(143)
    const shell = wrapSpawn(child, ac.signal, 50, taskOutput)
    const result = await shell.result
    expect(result.code).toBe(143)
    expect(result.stderr).toContain('Command timed out after')
    shell.cleanup()
  })

  test('external exit 143 without local kill does not claim timeout', async () => {
    // densable: wasKilled=false && code=143 → no "Command timed out"
    if (process.platform === 'win32') {
      // Windows process.kill(pid, 'SIGTERM') is unreliable for cmd; skip
      // the external path — logic is status-gated and covered by Unix + unit.
      return
    }

    const child = spawn('sleep', ['60'], { stdio: 'ignore' })
    expect(child.pid).toBeDefined()
    const ac = new AbortController()
    const taskOutput = new TaskOutput('test-ext-143', null, false)
    const shell = wrapSpawn(child, ac.signal, 60_000, taskOutput)

    // External SIGTERM → typically exit code 143 without ShellCommand #doKill
    process.kill(child.pid!, 'SIGTERM')
    const result = await shell.result
    expect(result.code).toBe(143)
    expect(result.stderr).not.toContain('Command timed out')
    expect(result.interrupted).toBe(false)
    shell.cleanup()
  })

  test('local kill() still marks interrupted (137)', async () => {
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'ping -n 30 127.0.0.1 >nul'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        : spawn('sleep', ['30'], { stdio: 'ignore' })

    const ac = new AbortController()
    const taskOutput = new TaskOutput('test-kill-137', null, false)
    const shell = wrapSpawn(child, ac.signal, 60_000, taskOutput)
    shell.kill()
    const result = await shell.result
    expect(result.interrupted).toBe(true)
    shell.cleanup()
  })
})
