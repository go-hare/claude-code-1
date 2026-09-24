/**
 * densable 2.1.251 #28 — zue/W/h: SSH skips native; opened bg tmux
 * attacher socket uses `-S`; else $TMUX load-buffer; else OSC 52.
 */
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { ChildProcess } from 'child_process'
import * as childProcess from 'child_process'
import {
  _resetLinuxCopyCache,
  getClipboardPath,
  setClipboard,
  setClipboardAttacherCapsGetter,
  tmuxLoadBuffer,
} from '../termio/osc.js'

type ExecCall = {
  cmd: string
  args: string[]
  input?: string
  windowsHide?: boolean
}

function createMockChild(
  call: ExecCall,
  options: { stdio?: Array<'pipe' | 'ignore' | string> } | undefined,
  code: number,
): ChildProcess {
  const stdio = options?.stdio
  const inMode = Array.isArray(stdio) ? stdio[0] : 'ignore'
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter | null
    stderr: EventEmitter | null
    stdin: {
      write: (chunk: string | Buffer) => boolean
      end: () => void
    } | null
    kill: (signal?: string) => boolean
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
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
  queueMicrotask(() => proc.emit('close', code))
  return proc as unknown as ChildProcess
}

describe('densable 2.1.251 zue/W/h clipboard attacher', () => {
  const prevSsh = process.env.SSH_CONNECTION
  const prevTmux = process.env.TMUX
  const prevLc = process.env.LC_TERMINAL
  let restoreSpawn: (() => void) | undefined
  let calls: ExecCall[] = []
  let tmuxExit = 0

  beforeEach(() => {
    _resetLinuxCopyCache()
    calls = []
    tmuxExit = 0
    delete process.env.SSH_CONNECTION
    delete process.env.TMUX
    delete process.env.LC_TERMINAL
    restoreSpawn = (() => {
      const spy = spyOn(childProcess, 'spawn').mockImplementation(((
        cmd: string,
        args: readonly string[] = [],
        options?: {
          stdio?: Array<'pipe' | 'ignore' | string>
          windowsHide?: boolean
        },
      ) => {
        const a = Array.isArray(args) ? [...args] : []
        const call: ExecCall = {
          cmd: String(cmd),
          args: a,
          windowsHide: options?.windowsHide,
        }
        calls.push(call)
        return createMockChild(call, options, tmuxExit)
      }) as typeof childProcess.spawn)
      return () => spy.mockRestore()
    })()
  })

  afterEach(() => {
    restoreSpawn?.()
    restoreSpawn = undefined
    _resetLinuxCopyCache()
    if (prevSsh === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = prevSsh
    if (prevTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = prevTmux
    if (prevLc === undefined) delete process.env.LC_TERMINAL
    else process.env.LC_TERMINAL = prevLc
    delete process.env.__CLAUDE_INK_PLATFORM_TEST__
  })

  test('SSH + $TMUX → tmux-buffer (zue skips native)', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    expect(getClipboardPath()).toBe('tmux-buffer')
  })

  test('opened bg attacher tmux socket over SSH → tmux-buffer, not osc52', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    delete process.env.TMUX
    setClipboardAttacherCapsGetter(() => ({
      mux: 'tmux',
      tmuxSocket: '/tmp/tmux-1000/attached',
      ssh: true,
    }))
    expect(getClipboardPath()).toBe('tmux-buffer')
  })

  test('attacher mux not tmux does not fall through to $TMUX (h)', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    setClipboardAttacherCapsGetter(() => ({
      mux: 'screen',
      tmuxSocket: '/tmp/tmux-1000/attached',
      ssh: true,
    }))
    expect(getClipboardPath()).toBe('osc52')
  })

  test('p() nullish: attacher.ssh missing falls through to SSH_CONNECTION', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    setClipboardAttacherCapsGetter(() => ({ mux: 'none' }))
    expect(getClipboardPath()).toBe('osc52')
  })

  test('p() nullish: attacher.ssh false does not use SSH_CONNECTION', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    setClipboardAttacherCapsGetter(() => ({ ssh: false }))
    expect(getClipboardPath()).toBe('native')
  })

  test('W load-buffer uses -S attacher socket then retries without -w', async () => {
    tmuxExit = 1
    setClipboardAttacherCapsGetter(() => ({
      mux: 'tmux',
      tmuxSocket: '/tmp/tmux-1000/attached',
    }))
    const ok = await tmuxLoadBuffer('selected')
    expect(ok).toBe(false)
    expect(calls.filter(c => c.cmd === 'tmux').length).toBe(2)
    expect(calls[0]!.args).toEqual([
      '-S',
      '/tmp/tmux-1000/attached',
      'load-buffer',
      '-w',
      '-',
    ])
    expect(calls[1]!.args).toEqual([
      '-S',
      '/tmp/tmux-1000/attached',
      'load-buffer',
      '-',
    ])
    expect(calls[0]!.input).toBe('selected')
  })

  test('W $TMUX path has empty prefix (no -S)', async () => {
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    const ok = await tmuxLoadBuffer('fg')
    expect(ok).toBe(true)
    expect(calls[0]!.args).toEqual(['load-buffer', '-w', '-'])
  })

  test('h N: relative attacher socket is not -S and does not fall through to $TMUX', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    setClipboardAttacherCapsGetter(() => ({
      mux: 'tmux',
      tmuxSocket: 'relative-socket',
      ssh: true,
    }))
    expect(getClipboardPath()).toBe('osc52')
  })

  test('h Tx: UNC share attacher socket is not a local socket', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    setClipboardAttacherCapsGetter(() => ({
      mux: 'tmux',
      tmuxSocket: '\\\\server\\share\\tmux.sock',
      ssh: true,
    }))
    expect(getClipboardPath()).toBe('osc52')
  })

  test('h empty tmuxSocket is null (no $TMUX fallthrough)', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    setClipboardAttacherCapsGetter(() => ({
      mux: 'tmux',
      tmuxSocket: '',
    }))
    expect(getClipboardPath()).toBe('osc52')
    expect(await tmuxLoadBuffer('x')).toBe(false)
    expect(calls.filter(c => c.cmd === 'tmux')).toEqual([])
  })

  test('yy emit uses Al mux even when W load-buffer fails', async () => {
    tmuxExit = 1
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    delete process.env.TMUX
    setClipboardAttacherCapsGetter(() => ({
      mux: 'tmux',
      tmuxSocket: '/tmp/tmux-1000/attached',
      ssh: true,
    }))
    const seq = await setClipboard('hi')
    expect(seq.startsWith('\x1b]52;c;')).toBe(true)
    expect(seq).toContain('\x1bPtmux;')
    expect(calls.filter(c => c.cmd === 'tmux').length).toBe(2)
  })

  test('y5e Al mux=screen does not fall through to $TMUX emit', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'macos'
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    setClipboardAttacherCapsGetter(() => ({
      mux: 'screen',
      ssh: true,
    }))
    const seq = await setClipboard('hi')
    expect(seq.startsWith('\x1bP\x1b]52;c;')).toBe(true)
    expect(seq.includes('\x1bPtmux;')).toBe(false)
    expect(calls.filter(c => c.cmd === 'tmux')).toEqual([])
  })

  test('L3u windows powershell spawn keeps yn/execa windowsHide', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'windows'
    delete process.env.SSH_CONNECTION
    delete process.env.TMUX
    await setClipboard('hi')
    const ps = calls.find(c => c.cmd === 'powershell')
    expect(ps).toBeDefined()
    expect(ps!.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
    ])
    expect(ps!.windowsHide).toBe(true)
    expect(ps!.input).toBe('hi')
  })
})
