/**
 * densable 2.1.224 Ksn — native clipboard/primary read (WSL/windows/linux/macos).
 *
 * Production uses spawn (not execFile) so tests must mock child_process.spawn.
 */
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { ChildProcess } from 'child_process'
import * as childProcess from 'child_process'
import { _resetLinuxCopyCache, readNativeClipboard } from '../termio/osc.js'

type ExecCall = { cmd: string; args: string[]; input?: string }

function installSpawnSpy(
  record: ExecCall[],
  stdoutByCmd: Record<string, string> = {},
): () => void {
  const spy = spyOn(childProcess, 'spawn').mockImplementation(((
    cmd: string,
    args: readonly string[] = [],
    options?: { stdio?: Array<'pipe' | 'ignore' | string> },
  ) => {
    const a = Array.isArray(args) ? [...args] : []
    const call: ExecCall = { cmd: String(cmd), args: a }
    record.push(call)

    const stdio = options?.stdio
    const inMode = Array.isArray(stdio) ? stdio[0] : 'ignore'
    const outMode = Array.isArray(stdio) ? stdio[1] : 'pipe'
    const errMode = Array.isArray(stdio) ? stdio[2] : 'pipe'

    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter | null
      stderr: EventEmitter | null
      stdin: {
        write: (chunk: string | Buffer) => boolean
        end: () => void
      } | null
      kill: (signal?: string) => boolean
    }

    proc.stdout = outMode === 'ignore' ? null : new EventEmitter()
    proc.stderr = errMode === 'ignore' ? null : new EventEmitter()
    proc.stdin =
      inMode === 'ignore'
        ? null
        : {
            write: (chunk: string | Buffer) => {
              if (call.input === undefined) call.input = String(chunk)
              return true
            },
            end: () => {},
          }
    proc.kill = () => true

    const out = stdoutByCmd[String(cmd)] ?? ''
    queueMicrotask(() => {
      if (out && proc.stdout) {
        proc.stdout.emit('data', out)
      }
      proc.emit('close', 0)
    })

    return proc as unknown as ChildProcess
  }) as typeof childProcess.spawn)
  return () => spy.mockRestore()
}

describe('densable Ksn readNativeClipboard', () => {
  const prevSsh = process.env.SSH_CONNECTION
  let restoreSpawn: (() => void) | undefined
  let calls: ExecCall[] = []

  beforeEach(() => {
    _resetLinuxCopyCache()
    calls = []
    delete process.env.SSH_CONNECTION
  })

  afterEach(() => {
    restoreSpawn?.()
    restoreSpawn = undefined
    _resetLinuxCopyCache()
    delete process.env.__CLAUDE_INK_PLATFORM_TEST__
    if (prevSsh === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = prevSsh
  })

  test('SSH_CONNECTION returns empty without native spawn', async () => {
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    restoreSpawn = installSpawnSpy(calls, { 'wl-paste': 'secret' })
    await expect(readNativeClipboard('clipboard')).resolves.toBe('')
    expect(calls.length).toBe(0)
  })

  test('wsl uses powershell.exe Get-Clipboard -Raw', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'wsl'
    restoreSpawn = installSpawnSpy(calls, {
      'powershell.exe': 'hello-from-win\r\n',
    })
    const text = await readNativeClipboard('clipboard')
    expect(text).toBe('hello-from-win')
    expect(calls[0]!.cmd).toBe('powershell.exe')
    expect(calls[0]!.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw',
    ])
  })

  test('windows uses powershell Get-Clipboard -Raw', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'windows'
    restoreSpawn = installSpawnSpy(calls, {
      powershell: 'win-clip\r\nline2\r\n',
    })
    const text = await readNativeClipboard()
    expect(text).toBe('win-clip\nline2')
    expect(calls[0]!.cmd).toBe('powershell')
  })

  test('linux primary prefers wl-paste --primary --no-newline', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    restoreSpawn = installSpawnSpy(calls, { 'wl-paste': 'sel-text' })
    const text = await readNativeClipboard('primary')
    expect(text).toBe('sel-text')
    expect(calls[0]!.cmd).toBe('wl-paste')
    expect(calls[0]!.args).toEqual(['--primary', '--no-newline'])
  })

  test('macos uses pbpaste', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    restoreSpawn = installSpawnSpy(calls, { pbpaste: 'mac-clip' })
    await expect(readNativeClipboard()).resolves.toBe('mac-clip')
    expect(calls[0]!.cmd).toBe('pbpaste')
  })
})
