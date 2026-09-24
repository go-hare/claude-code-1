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
import { SessionChildSupervisor } from '../sessionChildSupervisor.js'

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

  test('f analytics stage is taskkill on spawn error', async () => {
    const killer = readFileSync(
      join(import.meta.dir, '../killSessionProcessTree.ts'),
      'utf8',
    )
    expect(killer).toContain('tengu_bash_tool_kill_error')
    expect(killer).toContain("reportKillProcessTreeFailure('taskkill'")
    expect(killer).toContain('stage:')
  })

  test('session abort wiring calls supervisor terminate → ug', () => {
    const session = readFileSync(
      join(import.meta.dir, '../sessionHandler.ts'),
      'utf8',
    )
    expect(session).toContain('new SessionChildSupervisor({')
    expect(session).toContain('supervisor.terminate()')
    expect(session).toContain('supervisor.stop()')
    expect(session).toContain('supervisor.noteTurnStart()')
    expect(session).toContain('supervisor.noteTurnEnd()')
    const supervisorSrc = readFileSync(
      join(import.meta.dir, '../sessionChildSupervisor.ts'),
      'utf8',
    )
    expect(supervisorSrc).toContain(
      '[runner:session] Abort signal received, killing process tree at pid=',
    )
    const killer = readFileSync(
      join(import.meta.dir, '../killSessionProcessTree.ts'),
      'utf8',
    )
    expect(killer).toContain("'/T'")
    expect(killer).toContain("'/F'")
    expect(killer).not.toContain('SIGTERM')
    expect(killer).not.toContain('process.kill(-')
    // gold f fires tengu_bash_tool_kill_error with stage:"taskkill"
    expect(killer).toContain('tengu_bash_tool_kill_error')
  })
})

describe('densable 2.1.251 #30 SessionChildSupervisor mr', () => {
  function fakeChild(pid: number | undefined): ChildProcess {
    return {
      pid,
      kill: () => true,
    } as unknown as ChildProcess
  }

  function make(
    child: ChildProcess,
    extra?: Partial<ConstructorParameters<typeof SessionChildSupervisor>[0]>,
  ) {
    const debug: string[] = []
    const status: string[] = []
    const killed: number[] = []
    const supervisor = new SessionChildSupervisor({
      child,
      sessionId: 'sess-1',
      maxLifetimeMs: 0,
      maxLifetimeGraceMs: 900_000,
      sigkillTimeoutMs: 5_000,
      sigkillGraceMs: 30_000,
      onDebug: m => debug.push(m),
      onStatus: m => status.push(m),
      killProcessTree: async pid => {
        killed.push(pid)
      },
      ...extra,
    })
    return { supervisor, debug, status, killed }
  }

  test('terminate with pid calls ug/killProcessTree and logs abort', () => {
    const { supervisor, debug, killed } = make(fakeChild(4242))
    supervisor.terminate()
    expect(debug).toEqual([
      '[runner:session] Abort signal received, killing process tree at pid=4242',
    ])
    expect(killed).toEqual([4242])
    expect(supervisor.terminationRequested).toBe(true)
  })

  test('terminate without pid falls back to child.kill', () => {
    let killedChild = 0
    const child = {
      pid: undefined,
      kill: () => {
        killedChild++
        return true
      },
    } as unknown as ChildProcess
    const { supervisor, killed } = make(child)
    supervisor.terminate()
    expect(killedChild).toBe(1)
    expect(killed).toEqual([])
  })

  test('second terminate is a no-op', () => {
    const { supervisor, killed } = make(fakeChild(9))
    supervisor.terminate()
    supervisor.terminate()
    expect(killed).toEqual([9])
  })

  test('stop after terminate does not invent identity reap', () => {
    const { supervisor } = make(fakeChild(3))
    supervisor.terminate()
    supervisor.stop()
    expect(supervisor.stopped).toBe(true)
    expect(supervisor.treeSnapshot).toBeUndefined()
  })

  test('max lifetime with no in-flight turn aborts immediately', async () => {
    const { supervisor, debug, killed } = make(fakeChild(11), {
      maxLifetimeMs: 5,
    })
    await Bun.sleep(20)
    expect(debug.some(m => m.includes('exceeded max lifetime'))).toBe(true)
    expect(killed).toEqual([11])
    supervisor.stop()
  })

  test('max lifetime mid-turn waits then aborts; noteTurnEnd aborts after age', async () => {
    const { supervisor, status, killed } = make(fakeChild(12), {
      maxLifetimeMs: 8,
      maxLifetimeGraceMs: 50,
    })
    supervisor.noteTurnStart()
    await Bun.sleep(20)
    expect(killed).toEqual([])
    expect(status.some(m => m.includes('max session age reached'))).toBe(true)
    supervisor.noteTurnEnd()
    expect(killed).toEqual([12])
    expect(
      status.some(m =>
        m.includes('in-flight turn finished after max session age'),
      ),
    ).toBe(true)
    supervisor.stop()
  })
})
