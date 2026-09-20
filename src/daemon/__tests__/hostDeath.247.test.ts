import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ATTACH_FAIL_CLASS_RE,
  EHOSTDEAD,
  EHOSTDEAD_LOWER,
  HOST_DEAD_EXEC_ATTACH_ERROR,
  HOST_DEAD_EXEC_DETAIL,
  HOST_DEAD_SESSION_ATTACH_ERROR,
  HOST_DEAD_SESSION_DETAIL,
  WIN32_STILL_ACTIVE,
  _resetWin32HostDeathForTesting,
  classifyWin32HostProcessState,
  formatHostDeadAttachError,
  getHostProcessState,
  hostDeadAttachError,
  hostDeadKillDetail,
  isUnreapedHostDeadState,
  parseProcStatState,
} from '../hostDeath.js'

const workerSrc = readFileSync(join(import.meta.dir, '../bgWorker.ts'), 'utf8')
const managerSrc = readFileSync(
  join(import.meta.dir, '../bgManager.ts'),
  'utf8',
)

describe('densable 2.1.247 #15 EHOSTDEAD / failIfHostExited', () => {
  test('locks official copy and error code', () => {
    expect(EHOSTDEAD).toBe('EHOSTDEAD')
    expect(EHOSTDEAD_LOWER).toBe('ehostdead')
    expect(HOST_DEAD_SESSION_DETAIL).toBe(
      'terminal host process died \u2014 press Enter to restart',
    )
    expect(HOST_DEAD_SESSION_ATTACH_ERROR).toBe(
      "This session's terminal host process died (the conversation is saved)",
    )
    expect(HOST_DEAD_EXEC_DETAIL).toBe(
      'terminal host process died \u2014 its output is gone; the command was not run again',
    )
    expect(HOST_DEAD_EXEC_ATTACH_ERROR).toBe(
      "This command's terminal host process died \u2014 its output is gone and the command was not run again",
    )
    expect(ATTACH_FAIL_CLASS_RE.source).toBe('ESTALLED|EUNVERIFIED|EHOSTDEAD')
    expect(ATTACH_FAIL_CLASS_RE.test('EHOSTDEAD')).toBe(true)
  })

  test('official ze/wi is only Z or X', () => {
    expect(isUnreapedHostDeadState('Z')).toBe(true)
    expect(isUnreapedHostDeadState('X')).toBe(true)
    expect(isUnreapedHostDeadState('S')).toBe(false)
    expect(isUnreapedHostDeadState('R')).toBe(false)
    expect(isUnreapedHostDeadState(undefined)).toBe(false)
  })

  test('official Ge parses /proc/stat state after comm', () => {
    expect(parseProcStatState('1234 (claude) Z 1 1 1')).toBe('Z')
    expect(parseProcStatState('1234 (claude code) S 1 1 1')).toBe('S')
    expect(parseProcStatState('no-paren')).toBeUndefined()
  })

  test('attach/kill copy is session vs exec', () => {
    expect(hostDeadAttachError('prompt')).toBe(HOST_DEAD_SESSION_ATTACH_ERROR)
    expect(hostDeadAttachError('exec')).toBe(HOST_DEAD_EXEC_ATTACH_ERROR)
    expect(hostDeadKillDetail('prompt')).toBe(HOST_DEAD_SESSION_DETAIL)
    expect(hostDeadKillDetail('exec')).toBe(HOST_DEAD_EXEC_DETAIL)
  })

  test('ah strips EHOSTDEAD: prefix without wrapping', () => {
    expect(
      formatHostDeadAttachError(
        `${EHOSTDEAD}: ${HOST_DEAD_SESSION_ATTACH_ERROR}`,
      ),
    ).toBe(HOST_DEAD_SESSION_ATTACH_ERROR)
    expect(formatHostDeadAttachError(EHOSTDEAD)).toBe(
      HOST_DEAD_SESSION_ATTACH_ERROR,
    )
    expect(formatHostDeadAttachError('ENOJOB: gone')).toBeUndefined()
  })

  test('worker and attach call sites are official', () => {
    expect(workerSrc).toContain('async failIfHostExited(')
    expect(workerSrc).toContain("failIfHostExited('poll')")
    expect(workerSrc).toContain("this.kill(\n      'SIGKILL',\n      'failed',")
    expect(workerSrc).toContain('tengu_bg_ptyhost_zombie')
    expect(managerSrc).toContain("failIfHostExited('attach')")
    expect(managerSrc).toContain('code: EHOSTDEAD')
    expect(managerSrc).toContain('hostDeadAttachError(')
  })

  test('checkPid kill(0) only when !pty (not win32 LOCAL)', () => {
    expect(workerSrc).toContain('if (!this.pty) {')
    expect(workerSrc).toContain('process.kill(this.record.pid, 0)')
    expect(workerSrc).not.toContain("!this.pty || process.platform === 'win32'")
  })
})

describe('densable 2.1.247 #15 Node/Windows host liveness adapter', () => {
  afterEach(() => {
    _resetWin32HostDeathForTesting()
  })

  test('classify: FFI STILL_ACTIVE is live; any other exit code is X', () => {
    expect(
      classifyWin32HostProcessState({
        kind: 'exit-code',
        code: WIN32_STILL_ACTIVE,
      }),
    ).toBeUndefined()
    expect(classifyWin32HostProcessState({ kind: 'exit-code', code: 0 })).toBe(
      'X',
    )
    expect(classifyWin32HostProcessState({ kind: 'exit-code', code: 1 })).toBe(
      'X',
    )
  })

  test('classify: Node missing Win32_Process row is X; listed is live', () => {
    expect(classifyWin32HostProcessState({ kind: 'gone' })).toBe('X')
    expect(classifyWin32HostProcessState({ kind: 'alive' })).toBeUndefined()
    expect(classifyWin32HostProcessState({ kind: 'unknown' })).toBeUndefined()
  })

  test('hostDeath does not invent PTY kill(0)', () => {
    const src = readFileSync(join(import.meta.dir, '../hostDeath.ts'), 'utf8')
    expect(src).not.toContain('process.kill')
    expect(src).toContain('Win32_Process')
    expect(src).toContain('falling back to spawn')
  })

  test('Node adapter: injected gone probe returns X when FFI is off', async () => {
    _resetWin32HostDeathForTesting({
      disableFfi: true,
      probe: async () => 'gone',
    })
    if (process.platform !== 'win32') {
      // Classifier is what Node uses; getHostProcessState is win32-only.
      expect(classifyWin32HostProcessState({ kind: 'gone' })).toBe('X')
      return
    }
    expect(await getHostProcessState(4242)).toBe('X')
    expect(isUnreapedHostDeadState('X')).toBe(true)
  })

  test('Node adapter: injected alive probe stays undefined when FFI is off', async () => {
    _resetWin32HostDeathForTesting({
      disableFfi: true,
      probe: async () => 'alive',
    })
    if (process.platform !== 'win32') return
    expect(await getHostProcessState(process.pid)).toBeUndefined()
  })

  test('Node adapter: spawn lists the current pid as alive', async () => {
    if (process.platform !== 'win32') return
    _resetWin32HostDeathForTesting({ disableFfi: true })
    expect(await getHostProcessState(process.pid)).toBeUndefined()
  })
})
