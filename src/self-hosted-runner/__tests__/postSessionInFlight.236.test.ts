/**
 * densable 2.1.236 #17 — post-session inFlight gate (Bxy/Uxy/etu) +
 * shutdown/poll strings + clientPlatform env export (yCr).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { spawn as SpawnFn } from 'node:child_process'
import {
  formatClientPlatformForEnv,
  getPostSessionHookInFlight,
  getPostSessionHookInFlightCount,
  resetPostSessionHookInFlightForTests,
  runPostSessionHook,
} from '../sessionHooks.js'
import { RELEASE_IN_FLIGHT_SHUTDOWN_PAD_MS } from '../rootRunner.js'

afterEach(() => {
  resetPostSessionHookInFlightForTests()
})

function fakeSpawn(): {
  spawnFn: typeof SpawnFn
  getLastEnv: () => NodeJS.ProcessEnv | undefined
  close: (code?: number | null) => void
} {
  let lastEnv: NodeJS.ProcessEnv | undefined
  let child!: EventEmitter & {
    pid: number
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    stdout: EventEmitter
    stderr: EventEmitter
    kill: (sig?: NodeJS.Signals) => boolean
  }
  const spawnFn = ((_cmd, _args, opts) => {
    lastEnv = (opts as { env?: NodeJS.ProcessEnv } | undefined)?.env
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    child = Object.assign(new EventEmitter(), {
      pid: 4242,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdout,
      stderr,
      kill: () => true,
    })
    return child as unknown as ReturnType<typeof SpawnFn>
  }) as typeof SpawnFn
  return {
    spawnFn,
    getLastEnv: () => lastEnv,
    close: (code = 0) => {
      child.exitCode = code
      child.emit('close', code)
    },
  }
}

describe('densable 2.1.236 #17 post-session inFlight (Bxy/Uxy/etu)', () => {
  test('formatClientPlatformForEnv (yCr) rejects unknown / unsafe', () => {
    expect(formatClientPlatformForEnv(undefined)).toBeUndefined()
    expect(formatClientPlatformForEnv('unknown')).toBeUndefined()
    expect(formatClientPlatformForEnv('-web')).toBeUndefined()
    expect(formatClientPlatformForEnv('.')).toBeUndefined()
    expect(formatClientPlatformForEnv('..')).toBeUndefined()
    expect(formatClientPlatformForEnv('web/ui')).toBeUndefined()
    expect(formatClientPlatformForEnv('web')).toBe('web')
    expect(formatClientPlatformForEnv('claude_desktop')).toBe('claude_desktop')
  })

  test('runPostSessionHook increments inFlight on spawn and decrements on settle', async () => {
    const fake = fakeSpawn()
    expect(getPostSessionHookInFlightCount()).toBe(0)
    expect(getPostSessionHookInFlight().inFlight).toBe(0)
    const done = runPostSessionHook({
      hookPath: '/bin/true',
      sessionId: 'cse_1',
      exitReason: 'completed',
      debugLogPath: '/tmp/d',
      workspacePaths: ['/ws'],
      apiBaseUrl: 'https://api.anthropic.com',
      sessionAccessToken: 'tok',
      cwd: '/tmp',
      timeoutMs: 5_000,
      clientPlatform: 'web',
      onStatus: () => {},
      onDebug: () => {},
      spawnFn: fake.spawnFn,
    })
    expect(getPostSessionHookInFlightCount()).toBe(1)
    expect(getPostSessionHookInFlight().inFlight).toBe(1)
    expect(fake.getLastEnv()?.CLAUDE_RUNNER_CLIENT_PLATFORM).toBe('web')
    fake.close(0)
    await done
    expect(getPostSessionHookInFlightCount()).toBe(0)
  })

  test('CLAUDE_RUNNER_CLIENT_PLATFORM omitted when yCr rejects', async () => {
    const fake = fakeSpawn()
    const done = runPostSessionHook({
      hookPath: '/bin/true',
      sessionId: 's1',
      exitReason: 'completed',
      debugLogPath: '/tmp/d',
      workspacePaths: ['/ws'],
      apiBaseUrl: 'https://api.anthropic.com',
      sessionAccessToken: 'tok',
      cwd: '/tmp',
      timeoutMs: 5_000,
      clientPlatform: 'unknown',
      onStatus: () => {},
      onDebug: () => {},
      spawnFn: fake.spawnFn,
    })
    expect(fake.getLastEnv()?.CLAUDE_RUNNER_CLIENT_PLATFORM).toBeUndefined()
    fake.close(0)
    await done
  })

  test('RELEASE_IN_FLIGHT_SHUTDOWN_PAD_MS is densable Ttu (20s)', () => {
    expect(RELEASE_IN_FLIGHT_SHUTDOWN_PAD_MS).toBe(20_000)
  })

  test('rootRunner source contains SEA shutdown / ignore / ordered-release strings', () => {
    const src = readFileSync(join(import.meta.dir, '../rootRunner.ts'), 'utf8')
    expect(src).toContain(
      'awaiting server deassign (or its in-flight release to settle)',
    )
    expect(src).toContain(
      'a session release already in flight when shutdown begins can add up to ${RELEASE_IN_FLIGHT_SHUTDOWN_PAD_MS / 1000}s, normally well under 1s, before the runner deregisters',
    )
    expect(src).toContain(
      "Forced shutdown with ${still} post-session hook(s) still running — they continue in their own process group, but their output is no longer captured and the runner's timeout budget no longer applies.",
    )
    expect(src).toContain(
      "${running} post-session hook(s) still running — waiting for them within the budget above. Another SIGTERM force-exits the runner immediately; make sure your supervisor's stop timeout covers the full budget so hooks are not cut short.",
    )
    expect(src).toContain(
      'released after post-session hook — parked server-side',
    )
    expect(src).toContain(
      "released=false after post-session hook (pending user event) — respawns on the next poll, or is requeued by this runner's exit if it is draining (grace=0) or retiring",
    )
    expect(src).toContain('ordered release failed after the post-session hook:')
    expect(src).toContain("childAc.abort('idle-release')")
    expect(src).toContain('getPostSessionHookInFlightCount()')
  })
})
