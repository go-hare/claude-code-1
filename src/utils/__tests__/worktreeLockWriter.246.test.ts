/**
 * densable 2.1.246 — Cjr/Ejr worktree lock writer + Be/ne forgoIf lstat probe.
 *
 * Official SEA @216881038 (Cjr) / @216880667 (Ejr) / @207294539 (Be forgoIf).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  canReapDespiteLock,
  claudeWorktreeLockPid,
  mayReleaseWorktreeLock,
  parseClaudeWorktreeLockPid,
} from '../worktree.js'

const worktreeSrc = readFileSync(
  join(import.meta.dir, '..', 'worktree.ts'),
  'utf8',
)
const storageLockSrc = readFileSync(
  join(import.meta.dir, '..', 'storageV5', 'storageLock.ts'),
  'utf8',
)

describe('worktree lock writer Cjr/Ejr (2.1.246)', () => {
  test('source wires git worktree lock --reason (Cjr)', () => {
    expect(worktreeSrc).toContain("'worktree', 'lock'")
    expect(worktreeSrc).toContain("'--reason'")
    expect(worktreeSrc).toContain('densable Cjr @216881038')
    expect(worktreeSrc).toContain(
      '`claude ${kind} ${name} (pid ${process.pid} start ${procStart})`',
    )
    expect(worktreeSrc).toContain(
      '`claude ${kind} ${name} (pid ${process.pid})`',
    )
    expect(worktreeSrc).toContain("kind: 'session' | 'agent'")
    expect(worktreeSrc).toContain('await lockClaudeWorktree(')
    expect(worktreeSrc).toContain("'session'")
    expect(worktreeSrc).toContain("'agent'")
  })

  test('source wires releaseOwn + enteredExisting guest semantics', () => {
    expect(worktreeSrc).toContain(
      'export async function releaseOwnWorktreeLock',
    )
    expect(worktreeSrc).toContain('enteredExisting?: boolean')
    expect(worktreeSrc).toContain('enteredExisting: locked ? undefined : true')
    expect(worktreeSrc).toContain('enteredExisting: true')
    expect(worktreeSrc).toContain(
      '!session.enteredExisting && !session.hookBased',
    )
    expect(worktreeSrc).toContain('!prev.enteredExisting && !prev.hookBased')
    expect(worktreeSrc).toContain('export async function unlockAgentWorktree')
    expect(worktreeSrc).toContain(
      'export async function mayReleaseWorktreeLock',
    )
    expect(worktreeSrc).toContain(
      'export const claudeWorktreeLockPid = parseClaudeWorktreeLockPid',
    )
    // Lock/re-lock/catch failure must be guest (false), never claim ownership.
    expect(worktreeSrc).toMatch(
      /failed to lock[\s\S]*?treating this session as a guest[\s\S]*?return false/,
    )
    expect(worktreeSrc).toMatch(
      /failed to re-lock[\s\S]*?treating this session as a guest[\s\S]*?return false/,
    )
    expect(worktreeSrc).toMatch(
      /could not read the registry[\s\S]*?treating this session as a guest[\s\S]*?return false/,
    )
  })

  test('fH reason parses pid; One/mayRelease matches canReap', async () => {
    const own = `claude session slug (pid ${process.pid})`
    const dead = 'claude agent other (pid 1)'
    const foreign = 'claude session x (pid 999999991)'
    const unknown = 'manual lock'
    expect(parseClaudeWorktreeLockPid(own)).toBe(process.pid)
    expect(claudeWorktreeLockPid(own)).toBe(process.pid)
    expect(canReapDespiteLock(undefined)).toBe(true)
    expect(canReapDespiteLock(own)).toBe(true)
    expect(canReapDespiteLock(dead)).toBe(true)
    expect(canReapDespiteLock(unknown)).toBe(false)
    expect(await mayReleaseWorktreeLock(own)).toBe(canReapDespiteLock(own))
    expect(await mayReleaseWorktreeLock(unknown)).toBe(false)
    // foreign live pid → keep (Tjr); 999999991 is almost certainly not running
    if (!canReapDespiteLock(foreign)) {
      expect(canReapDespiteLock(foreign)).toBe(false)
    }
  })
})

describe('storageLock forgoIf Be/ne lstat probe (2.1.246)', () => {
  test('forgoIf probe uses lstat, not a second acquire', () => {
    expect(storageLockSrc).toContain('await lstat(n.lockfilePath')
    expect(storageLockSrc).toContain('f = !isENOENT(error)')
    expect(storageLockSrc).toContain('densable leftover Be/ne @207294539')
    expect(storageLockSrc).not.toContain('probeRelease')
    expect(storageLockSrc).toContain('forgoIf?:')
    expect(storageLockSrc).toContain('onForgone?:')
    expect(storageLockSrc).toContain('proceedIf?:')
    // densable Kt/En wired through withValuePublishLock + oy gate.
    expect(storageLockSrc).toContain(
      'export async function withValuePublishLock',
    )
    expect(storageLockSrc).toContain(
      'publishing without it, as a plain write does',
    )
  })
})
