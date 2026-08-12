/**
 * densable 2.1.224 #15 — Wayland/Linux native clipboard dual-write.
 * Sequential CLIPBOARD then PRIMARY; generation abort for wl-copy primary.
 *
 * Production uses spawn (not execFile) so tests must mock child_process.spawn.
 */
import { EventEmitter } from 'events'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import type { ChildProcess } from 'child_process'
import * as childProcess from 'child_process'
import {
  _getLinuxCopyTool,
  _getWaylandCopyGen,
  _resetLinuxCopyCache,
  setClipboard,
} from '../termio/osc.js'

type ExecCall = { cmd: string; args: string[]; input?: string }

type SpawnSpyOpts = {
  /** Delay close of the first matching cmd until gate resolves (D3u race). */
  delayFirstClose?: { cmd: string; gate: Promise<void> }
}

function createMockChild(
  call: ExecCall,
  options: { stdio?: Array<'pipe' | 'ignore' | string> } | undefined,
  out: string,
  onClose: (finish: () => void) => void,
): ChildProcess {
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

  const finish = () => {
    if (out && proc.stdout) {
      proc.stdout.emit('data', out)
    }
    proc.emit('close', 0)
  }
  onClose(finish)

  return proc as unknown as ChildProcess
}

function installSpawnSpy(
  record: ExecCall[],
  stdoutByCmd: Record<string, string> = {},
  opts: SpawnSpyOpts = {},
): () => void {
  let matchCount = 0
  const spy = spyOn(childProcess, 'spawn').mockImplementation(((
    cmd: string,
    args: readonly string[] = [],
    options?: { stdio?: Array<'pipe' | 'ignore' | string> },
  ) => {
    const a = Array.isArray(args) ? [...args] : []
    const call: ExecCall = { cmd: String(cmd), args: a }
    record.push(call)
    const out = stdoutByCmd[String(cmd)] ?? ''

    return createMockChild(call, options, out, finish => {
      if (opts.delayFirstClose && cmd === opts.delayFirstClose.cmd) {
        matchCount++
        if (matchCount === 1) {
          void opts.delayFirstClose.gate.then(finish)
          return
        }
      }
      queueMicrotask(finish)
    })
  }) as typeof childProcess.spawn)
  return () => spy.mockRestore()
}

/** Spy Bun.which — never reassign globalThis.Bun (readonly in bun:test). */
function installWhichSpy(map: Record<string, string | null>): () => void {
  const bun = (globalThis as { Bun?: { which?: (c: string) => string | null } })
    .Bun
  if (!bun || typeof bun.which !== 'function') {
    // Node fallback: commandOnPath shells out to `which` via spawn — treat listed
    // bins as present by answering code 0 for matching which args in spawn spy.
    return () => {}
  }
  const spy = spyOn(bun, 'which').mockImplementation(
    (c: string) => map[c] ?? null,
  )
  return () => {
    spy.mockRestore()
  }
}

describe('densable 2.1.224 #15 linux dual-write clipboard+primary', () => {
  const prevPlatform = process.platform
  const prevWayland = process.env.WAYLAND_DISPLAY
  const prevDisplay = process.env.DISPLAY
  const prevSsh = process.env.SSH_CONNECTION
  const prevTmux = process.env.TMUX
  const prevSty = process.env.STY
  let restoreSpawn: (() => void) | undefined
  let restoreWhich: (() => void) | undefined
  let calls: ExecCall[] = []

  beforeEach(() => {
    // densable Wt()==="linux" for dual-write tests (not wsl/windows)
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    _resetLinuxCopyCache()
    calls = []
    restoreSpawn = installSpawnSpy(calls)
    delete process.env.SSH_CONNECTION
    delete process.env.TMUX
    delete process.env.STY
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
  })

  afterEach(() => {
    restoreSpawn?.()
    restoreWhich?.()
    restoreSpawn = undefined
    restoreWhich = undefined
    _resetLinuxCopyCache()
    Object.defineProperty(process, 'platform', {
      value: prevPlatform,
      configurable: true,
    })
    if (prevWayland === undefined) delete process.env.WAYLAND_DISPLAY
    else process.env.WAYLAND_DISPLAY = prevWayland
    if (prevDisplay === undefined) delete process.env.DISPLAY
    else process.env.DISPLAY = prevDisplay
    if (prevSsh === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = prevSsh
    if (prevTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = prevTmux
    if (prevSty === undefined) delete process.env.STY
    else process.env.STY = prevSty
    delete process.env.__CLAUDE_INK_PLATFORM_TEST__
    mock.restore()
  })

  test('wl-copy: sequential clipboard then --primary with generation', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    delete process.env.DISPLAY
    restoreWhich = installWhichSpy({ 'wl-copy': '/usr/bin/wl-copy' })

    await setClipboard('hello-wayland')
    await new Promise(r => setTimeout(r, 50))

    const wl = calls.filter(c => c.cmd === 'wl-copy')
    expect(wl.length).toBeGreaterThanOrEqual(2)
    expect(wl[0]!.args).toEqual([])
    expect(wl[1]!.args).toEqual(['--primary'])
    expect(wl[0]!.input).toBe('hello-wayland')
    expect(wl[1]!.input).toBe('hello-wayland')
    expect(_getLinuxCopyTool()).toBe('wl-copy')
    expect(_getWaylandCopyGen()).toBeGreaterThanOrEqual(1)
  })

  test('xclip: dual fire clipboard + primary selections', async () => {
    delete process.env.WAYLAND_DISPLAY
    process.env.DISPLAY = ':0'
    restoreWhich = installWhichSpy({ xclip: '/usr/bin/xclip' })

    await setClipboard('hello-x11')
    await new Promise(r => setTimeout(r, 50))

    const xc = calls.filter(c => c.cmd === 'xclip')
    expect(xc.length).toBeGreaterThanOrEqual(2)
    const selections = xc.map(c => c.args.join(' '))
    expect(selections).toContain('-selection clipboard')
    expect(selections).toContain('-selection primary')
    expect(_getLinuxCopyTool()).toBe('xclip')
  })

  test('xsel: dual fire --clipboard and --primary', async () => {
    delete process.env.WAYLAND_DISPLAY
    process.env.DISPLAY = ':0'
    restoreWhich = installWhichSpy({ xclip: null, xsel: '/usr/bin/xsel' })

    await setClipboard('hello-xsel')
    await new Promise(r => setTimeout(r, 50))

    const xs = calls.filter(c => c.cmd === 'xsel')
    expect(xs.length).toBeGreaterThanOrEqual(2)
    const joined = xs.map(c => c.args.join(' '))
    expect(joined.some(a => a.includes('--clipboard'))).toBe(true)
    expect(joined.some(a => a.includes('--primary'))).toBe(true)
    expect(_getLinuxCopyTool()).toBe('xsel')
  })

  test('newer wl-copy aborts stale primary write (D3u generation)', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    delete process.env.DISPLAY
    restoreWhich = installWhichSpy({ 'wl-copy': '/usr/bin/wl-copy' })

    let firstResolve: (() => void) | undefined
    const gate = new Promise<void>(r => {
      firstResolve = r
    })
    restoreSpawn?.()
    restoreSpawn = installSpawnSpy(
      calls,
      {},
      {
        delayFirstClose: { cmd: 'wl-copy', gate },
      },
    )

    void setClipboard('first')
    await new Promise(r => setTimeout(r, 30))
    void setClipboard('second')
    await new Promise(r => setTimeout(r, 10))
    firstResolve?.()
    await new Promise(r => setTimeout(r, 50))

    const wl = calls.filter(c => c.cmd === 'wl-copy')
    const primaries = wl.filter(c => c.args.includes('--primary'))
    expect(primaries.length).toBe(1)
    expect(primaries[0]!.input).toBe('second')
    expect(_getWaylandCopyGen()).toBeGreaterThanOrEqual(2)
  })

  test('SSH_CONNECTION skips native dual-write entirely', async () => {
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    restoreWhich = installWhichSpy({ 'wl-copy': '/usr/bin/wl-copy' })
    await setClipboard('ssh-text')
    await new Promise(r => setTimeout(r, 30))
    expect(calls.filter(c => c.cmd === 'wl-copy').length).toBe(0)
  })

  test('densable L3u wsl: powershell.exe Set-Clipboard (not linux wl-copy)', async () => {
    // densable Wt()==="wsl" — force via test override (no invent heuristics)
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'wsl'
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    restoreWhich = installWhichSpy({ 'wl-copy': '/usr/bin/wl-copy' })
    _resetLinuxCopyCache()

    await setClipboard('hello-wsl')
    await new Promise(r => setTimeout(r, 50))

    expect(calls.filter(c => c.cmd === 'wl-copy').length).toBe(0)
    const ps = calls.filter(c => c.cmd === 'powershell.exe')
    expect(ps.length).toBeGreaterThanOrEqual(1)
    expect(ps[0]!.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
    ])
    expect(ps[0]!.input).toBe('hello-wsl')
    delete process.env.__CLAUDE_INK_PLATFORM_TEST__
  })

  test('densable L3u windows: powershell Set-Clipboard', async () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'windows'
    _resetLinuxCopyCache()
    await setClipboard('hello-win')
    await new Promise(r => setTimeout(r, 50))
    const ps = calls.filter(c => c.cmd === 'powershell')
    expect(ps.length).toBeGreaterThanOrEqual(1)
    expect(ps[0]!.args[0]).toBe('-NoProfile')
    expect(ps[0]!.input).toBe('hello-win')
    delete process.env.__CLAUDE_INK_PLATFORM_TEST__
  })
})
