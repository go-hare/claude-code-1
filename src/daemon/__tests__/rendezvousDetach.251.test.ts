/**
 * densable 2.1.251 KW / _Nn / Ej — daemon detach.
 * Gold: if (YK({type:"detach-request",msg,broadcast})) { Hlt(); return }
 * else stdout.write(Ej(msg)). Hlt is sync and only on sendRv success.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  isAttachUnstable,
  resetAttachStampForTests,
  stampAttachTime,
} from '@anthropic/ink'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BG_DETACH_DEBOUNCE_MS,
  createOnBgDetach,
  detachInFlightMessage,
  requestBgDetach,
} from '../rendezvousServer.js'
import {
  _resetBgNeedsInputBridgeForTests,
  setBgInFlightRegistry,
} from '../../utils/bgNeedsInputBridge.js'

const ROOT = join(import.meta.dir, '../..')
const prevBackend = process.env.CLAUDE_BG_BACKEND

afterEach(() => {
  resetAttachStampForTests()
  _resetBgNeedsInputBridgeForTests()
  if (prevBackend === undefined) delete process.env.CLAUDE_BG_BACKEND
  else process.env.CLAUDE_BG_BACKEND = prevBackend
})

describe('densable _Nn detachInFlightMessage', () => {
  test('undefined when tasks===0', () => {
    expect(detachInFlightMessage()).toBeUndefined()
  })

  test('singular and plural match gold copy', () => {
    setBgInFlightRegistry({ tasks: 1, queued: 0, kinds: [] })
    expect(detachInFlightMessage()).toBe(
      'Detached — 1 task still running. Run `claude agents` to see your background sessions.',
    )
    setBgInFlightRegistry({ tasks: 3, queued: 0, kinds: [] })
    expect(detachInFlightMessage()).toBe(
      'Detached — 3 tasks still running. Run `claude agents` to see your background sessions.',
    )
  })
})

describe('densable KW requestBgDetach', () => {
  test('no-op when not daemon', () => {
    delete process.env.CLAUDE_BG_BACKEND
    process.env.CLAUDE_BG_BACKEND = 'tmux'
    const writes: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    }) as typeof process.stdout.write
    try {
      requestBgDetach()
      expect(writes).toEqual([])
      expect(isAttachUnstable(Date.now())).toBe(false)
    } finally {
      process.stdout.write = orig
    }
  })

  test('APC fallback does not Hlt when sendRv fails', () => {
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    const writes: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    }) as typeof process.stdout.write
    try {
      requestBgDetach()
      expect(writes.join('')).toContain('\x1B_cc-daemon-detach\x1B\\')
      expect(isAttachUnstable(Date.now())).toBe(false)
    } finally {
      process.stdout.write = orig
    }
  })

  test('source: Hlt only on sendRv success arm', () => {
    const src = readFileSync(
      join(ROOT, 'daemon/rendezvousServer.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain("type: 'detach-request'")
    expect(src).toContain('markDetachedSinceLastAttach()')
    expect(src).toContain('process.stdout.write(encodeDetachApc(msg))')
    const start = src.indexOf('export function requestBgDetach')
    const end = src.indexOf(
      '\n// ---------------------------------------------------------------------------',
      start,
    )
    const kw = src.slice(start, end === -1 ? undefined : end)
    expect(kw).toContain('markDetachedSinceLastAttach()')
    const fallback = kw.slice(
      kw.indexOf('process.stdout.write(encodeDetachApc'),
    )
    expect(fallback).not.toContain('markDetachedSinceLastAttach')
  })

  test('PromptInput holds per-screen createOnBgDetach; launcher does not', () => {
    const prompt = readFileSync(
      join(ROOT, 'components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(prompt).toContain('createOnBgDetach()')
    expect(prompt).not.toContain('sendBgDetachRequest')
    expect(prompt).not.toMatch(/onLeftArrowOnEmpty:[\s\S]{0,80}requestBgDetach/)
    const repl = readFileSync(join(ROOT, 'replLauncher.tsx'), 'utf8')
    expect(repl).not.toMatch(/from ['"].*rendezvousServer/)
    expect(repl).not.toMatch(/createOnBgDetach\s*\(/)
    expect(repl).toContain("CLAUDE_BG_BACKEND === 'daemon'")
    expect(repl).toContain('? undefined')
  })

  test('gold KW call sites: /exit, Desktop broadcast, already-bg', () => {
    const exit = readFileSync(join(ROOT, 'commands/exit/exit.tsx'), 'utf8')
    expect(exit).toContain('requestBgDetach()')
    expect(exit).toContain("spawnSync('tmux', ['detach-client']")
    const desktop = readFileSync(
      join(ROOT, 'components/DesktopHandoff.tsx'),
      'utf8',
    )
    expect(desktop).toContain('requestBgDetach({ broadcast: true })')
    const bg = readFileSync(
      join(ROOT, 'components/BackgroundAndExit.tsx'),
      'utf8',
    )
    expect(bg).toContain("logEvent('tengu_background_already_bg'")
    expect(bg).toContain('requestBgDetach()')
    const repl = readFileSync(join(ROOT, 'screens/REPL.tsx'), 'utf8')
    expect(repl).toContain('Session stopped.')
    expect(repl).not.toMatch(/handleExit[\s\S]{0,800}requestBgDetach/)
  })
})

describe('densable onBgDetach fEe + U$', () => {
  test('fEe is 1000', () => {
    expect(BG_DETACH_DEBOUNCE_MS).toBe(1000)
  })

  test('second press within 1s is dropped when attach stamp is not newer', () => {
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    const writes: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    }) as typeof process.stdout.write
    try {
      const onBgDetach = createOnBgDetach()
      onBgDetach()
      const first = writes.length
      expect(first).toBeGreaterThan(0)
      onBgDetach()
      expect(writes.length).toBe(first)
    } finally {
      process.stdout.write = orig
    }
  })

  test('two createOnBgDetach instances do not share #s', () => {
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    const writes: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    }) as typeof process.stdout.write
    try {
      const a = createOnBgDetach()
      const b = createOnBgDetach()
      a()
      const afterA = writes.length
      b()
      expect(writes.length).toBeGreaterThan(afterA)
    } finally {
      process.stdout.write = orig
    }
  })

  test('U$ newer than last KW bypasses the 1s window', () => {
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    const writes: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    }) as typeof process.stdout.write
    try {
      const onBgDetach = createOnBgDetach()
      onBgDetach()
      const first = writes.length
      stampAttachTime(Date.now() + 1)
      onBgDetach()
      expect(writes.length).toBeGreaterThan(first)
    } finally {
      process.stdout.write = orig
    }
  })

  test('/exit Desktop already-bg still call requestBgDetach not onBgDetach', () => {
    const exit = readFileSync(join(ROOT, 'commands/exit/exit.tsx'), 'utf8')
    expect(exit).toContain('requestBgDetach()')
    expect(exit).not.toContain('onBgDetach')
    const desktop = readFileSync(
      join(ROOT, 'components/DesktopHandoff.tsx'),
      'utf8',
    )
    expect(desktop).toContain('requestBgDetach({ broadcast: true })')
    expect(desktop).not.toContain('onBgDetach')
    const bg = readFileSync(
      join(ROOT, 'components/BackgroundAndExit.tsx'),
      'utf8',
    )
    expect(bg).toContain('requestBgDetach()')
    expect(bg).not.toContain('onBgDetach')
  })
})
