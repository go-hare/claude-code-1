/**
 * densable 2.1.247 #11 — `_752` ae/xe hop-walk used by WZ Qi/Vm.
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { gitdirHopWalkOk, gitdirPointerHopUnsafe } from '../gitdirHopWalk.js'

function canSymlink(dir: string): boolean {
  const target = join(dir, 't')
  const link = join(dir, 'l')
  try {
    writeFileSync(target, 'x')
    symlinkSync(target, link)
    return true
  } catch {
    return false
  }
}

describe('densable 2.1.247 #11 Qi/xe hop-walk', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  function scratch(): string {
    root = join(
      tmpdir(),
      `hop-247-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    mkdirSync(root, { recursive: true })
    return root
  }

  test('depth 0 fails', () => {
    expect(gitdirHopWalkOk('/tmp/x', '/tmp', 0)).toBe(false)
  })

  test('plain relative pointer is not unsafe', () => {
    const dir = scratch()
    expect(gitdirPointerHopUnsafe('.git/worktrees/wt', dir)).toBe(false)
  })

  test('file hop is skipped (accepted); only other / bad symlink fail', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'mid'), 'x')
    // official ae: file|dir|absent continue. WZ skip=$o stub + this arm.
    expect(gitdirHopWalkOk(join(dir, 'mid', 'tail'), dir)).toBe(true)
    expect(gitdirPointerHopUnsafe('mid/tail', dir)).toBe(false)
  })

  test('symlink hop to UNC is unsafe', () => {
    const dir = scratch()
    if (!canSymlink(dir)) return
    symlinkSync('//evil/share', join(dir, 'hop'))
    expect(gitdirPointerHopUnsafe('hop/worktrees/x', dir)).toBe(true)
  })

  test('source: ae depth 40, follow symlink, $o stub', () => {
    const src = readFileSync(
      new URL('../gitdirHopWalk.ts', import.meta.url),
      'utf8',
    )
    expect(src).toContain('depth = 40')
    expect(src).toContain('readlinkSync')
    expect(src).toContain('volumeHopRejects')
    expect(src).toContain('return false')
    expect(src).toContain("encoding: 'buffer'")
  })

  test('local symlink hop stays safe', () => {
    const dir = scratch()
    if (!canSymlink(dir)) return
    mkdirSync(join(dir, 'real'))
    symlinkSync(join(dir, 'real'), join(dir, 'hop'))
    expect(gitdirPointerHopUnsafe('hop/a', dir)).toBe(false)
  })
})
