import { spawn } from 'child_process'
import { describe, expect, test } from 'bun:test'
import { wrapSpawn } from '../ShellCommand.js'
import { TaskOutput } from '../task/TaskOutput.js'

/**
 * Windows: #doKill must not shell out via child_process.exec('taskkill …')
 * (tree-kill stock path) — that flashes a console on every Bash abort/timeout.
 * wrapSpawn().kill() exercises the LOCAL windowsHide taskkill path.
 */
describe('ShellCommand tree kill (Windows flash)', () => {
  test('kill completes without throwing when child is alive', async () => {
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'ping -n 30 127.0.0.1 >nul'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        : spawn('sleep', ['30'], { stdio: 'ignore' })

    expect(child.pid).toBeDefined()
    const ac = new AbortController()
    const taskOutput = new TaskOutput('test-tree-kill', null, false)
    const shell = wrapSpawn(child, ac.signal, 60_000, taskOutput)
    shell.kill()
    const result = await shell.result
    expect(result.interrupted).toBe(true)
    shell.cleanup()
  })
})
