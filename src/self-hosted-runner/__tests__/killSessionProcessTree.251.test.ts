/**
 * densable 2.1.251 #30 — ug/P taskkill /T /F. No Unix branch in the killer.
 */
import { describe, expect, test } from 'bun:test'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  killSessionProcessTree,
  windowsTaskkillSpec,
} from '../killSessionProcessTree.js'

describe('densable 2.1.251 #30 killSessionProcessTree', () => {
  test('taskkill spec is System32 /PID /T /F', () => {
    const spec = windowsTaskkillSpec(4242, { SYSTEMROOT: 'D:\\Win' })
    expect(spec.exe).toBe(join('D:\\Win', 'System32', 'taskkill.exe'))
    expect(spec.args).toEqual(['/PID', '4242', '/T', '/F'])
  })

  test('missing SYSTEMROOT falls back to C:\\Windows', () => {
    const spec = windowsTaskkillSpec(7, {})
    expect(spec.exe).toBe(join('C:\\Windows', 'System32', 'taskkill.exe'))
  })

  test('pid <= 1 or non-integer does not spawn', async () => {
    let spawned = 0
    const spawnImpl = (() => {
      spawned++
      return { once() {} } as unknown as ChildProcess
    }) as unknown as typeof import('node:child_process').spawn
    await killSessionProcessTree(0, undefined, spawnImpl)
    await killSessionProcessTree(1, undefined, spawnImpl)
    await killSessionProcessTree(1.5, undefined, spawnImpl)
    expect(spawned).toBe(0)
  })

  test('spawn uses ignore stdio and windowsHide, logs taskkill failure', async () => {
    const logs: string[] = []
    const killed: number[] = []
    let opts:
      | { cwd?: string; stdio?: string; windowsHide?: boolean }
      | undefined
    const spawnImpl = ((
      _exe: string,
      _args: string[],
      options: typeof opts,
    ) => {
      opts = options
      return {
        once(event: string, fn: (err: Error) => void) {
          if (event === 'error') fn(new Error('taskkill-missing'))
          return this
        },
      } as unknown as ChildProcess
    }) as unknown as typeof import('node:child_process').spawn

    await killSessionProcessTree(
      99,
      message => logs.push(message),
      spawnImpl,
      pid => {
        killed.push(pid)
      },
    )
    expect(opts).toEqual({
      cwd: undefined,
      stdio: 'ignore',
      windowsHide: true,
    })
    expect(logs).toEqual(['killProcessTree taskkill failed: taskkill-missing'])
    expect(killed).toEqual([99])
  })

  test('session abort on win32 calls the tree killer', () => {
    const session = readFileSync(
      join(import.meta.dir, '../sessionHandler.ts'),
      'utf8',
    )
    expect(session).toContain("process.platform === 'win32'")
    expect(session).toContain(
      '[runner:session] Abort signal received, killing process tree at pid=',
    )
    expect(session).toContain('killSessionProcessTree')
    const killer = readFileSync(
      join(import.meta.dir, '../killSessionProcessTree.ts'),
      'utf8',
    )
    expect(killer).toContain("'/T'")
    expect(killer).toContain("'/F'")
    expect(killer).not.toContain('SIGTERM')
    expect(killer).not.toContain('process.kill(-')
  })
})
