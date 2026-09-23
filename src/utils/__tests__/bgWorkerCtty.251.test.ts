import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  acquireBgWorkerControllingTty,
  applyBgWorkerCttyOutcome,
  devTtyAlreadyOpen,
  doesOwnControllingTerminal,
  ensureBgWorkerControllingTty,
  resetOwnsControllingTerminalForTests,
} from '../bgWorkerCtty.js'
import { getPlatform } from '../platform.js'

describe('bg worker controlling tty (251 #33)', () => {
  test('z() is unsupported on windows', async () => {
    const outcome = await acquireBgWorkerControllingTty()
    if (getPlatform() === 'windows') {
      expect(outcome).toBe('unsupported')
    } else {
      expect(outcome).not.toBe('unsupported')
    }
  })

  test('/dev/tty probe does not throw', async () => {
    const openable = await devTtyAlreadyOpen()
    expect(typeof openable).toBe('boolean')
    if (getPlatform() === 'windows') expect(openable).toBe(false)
  })

  test('flag off is already or switched_off', async () => {
    const outcome = await ensureBgWorkerControllingTty(false)
    expect(outcome === 'already' || outcome === 'switched_off').toBe(true)
  })

  test('daemon startup awaits z() when tengu_bg_worker_ctty is on', () => {
    const setup = readFileSync(join(import.meta.dir, '../../setup.ts'), 'utf8')
    expect(setup).toContain("process.env.CLAUDE_BG_BACKEND === 'daemon'")
    expect(setup).toContain("'tengu_bg_worker_ctty'")
    expect(setup).toContain(
      'applyBgWorkerCttyOutcome(await ensureBgWorkerControllingTty(cttyEnabled))',
    )
    const src = readFileSync(
      join(import.meta.dir, '../bgWorkerCtty.ts'),
      'utf8',
    )
    expect(src).toContain(
      "open('/dev/tty', constants.O_RDWR | constants.O_NOCTTY)",
    )
    expect(src).toContain('login_tty')
    expect(src).toContain("['libc.so.6', 'libutil.so.1', 'libc.so']")
    expect(src).toContain("['/usr/lib/libSystem.B.dylib', 'libSystem.B.dylib']")
  })

  test('acquired and already mark the controlling tty; sad outcomes do not', () => {
    resetOwnsControllingTerminalForTests()
    applyBgWorkerCttyOutcome('unsupported')
    expect(doesOwnControllingTerminal()).toBe(false)
    applyBgWorkerCttyOutcome('already')
    expect(doesOwnControllingTerminal()).toBe(true)
    resetOwnsControllingTerminalForTests()
    applyBgWorkerCttyOutcome('acquired')
    expect(doesOwnControllingTerminal()).toBe(true)
    resetOwnsControllingTerminalForTests()
    applyBgWorkerCttyOutcome('failed')
    applyBgWorkerCttyOutcome('ffi_unavailable')
    applyBgWorkerCttyOutcome('not_a_tty')
    applyBgWorkerCttyOutcome('switched_off')
    expect(doesOwnControllingTerminal()).toBe(false)
  })
})
