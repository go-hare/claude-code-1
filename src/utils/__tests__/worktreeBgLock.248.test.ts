/**
 * densable 2.1.248 #35 — leftover pGe/Gct lock + bg-boot adopt hold.
 *
 * GOLD: gold-248-agents-verdict.txt / gold-248-35-pge.txt
 * pGe @186343793 sha=aaf9bd8afc6abce0
 * Gct @186344789 sha=d323c220d4b74f7e
 * j bg-boot @204222840 sha=b780c8c7af192372
 * U pid check @204223670 sha=b882d7e4f98a21d8
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  adoptWorktreeForBgBoot,
  parseClaudeWorktreeLockPid,
  restoreWorktreeSession,
} from '../worktree.js'

const GOLD_ADOPTED_WARN =
  '[worktree] bg boot: adopted ${e} but no worktree lock names this process'
const GOLD_NOT_ADOPTING =
  '[worktree] bg boot: not adopting ${e} \u2014 ${w.message}'
const GOLD_ADOPT_SKIPPED =
  '[worktree] bg adopt-time reclaim skipped: ${errorMessage(u)}'

const worktreeSrc = readFileSync(
  join(import.meta.dir, '..', 'worktree.ts'),
  'utf8',
)
const setupSrc = readFileSync(
  join(import.meta.dir, '..', '..', 'setup.ts'),
  'utf8',
)

afterEach(() => {
  restoreWorktreeSession(null)
})

describe('densable 2.1.248 #35 pGe lock matches official reason shape', () => {
  test('source uses official git worktree lock --reason (pGe/Cjr)', () => {
    expect(worktreeSrc).toContain("'worktree', 'lock'")
    expect(worktreeSrc).toContain("'--reason'")
    expect(worktreeSrc).toContain(
      '`claude ${kind} ${name} (pid ${process.pid} start ${procStart})`',
    )
    expect(worktreeSrc).toContain(
      '`claude ${kind} ${name} (pid ${process.pid})`',
    )
    expect(worktreeSrc).toContain("kind: 'session' | 'agent'")
    expect(worktreeSrc).toContain('await lockClaudeWorktree(')
    expect(worktreeSrc).toContain("'session'")
    expect(worktreeSrc).toContain(
      "locked = await lockClaudeWorktree(cwd, gitRoot, worktreeName, 'session')",
    )
  })

  test('Gct create/resume still writes the session lock', () => {
    const start = worktreeSrc.indexOf(
      'export async function createWorktreeForSession',
    )
    const end = worktreeSrc.indexOf('export async function keepWorktree')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const create = worktreeSrc.slice(start, end)
    expect(create).toContain('await lockClaudeWorktree(')
    expect(create).toContain("'session'")
    expect(create).toContain('enteredExisting: locked ? undefined : true')
  })
})

describe('densable 2.1.248 #35 bg-boot adopt hold', () => {
  test('gold warn strings are 1:1', () => {
    expect(worktreeSrc).toContain(GOLD_ADOPTED_WARN)
    expect(worktreeSrc).toContain(GOLD_NOT_ADOPTING)
    expect(setupSrc).toContain(GOLD_ADOPT_SKIPPED)
    expect(worktreeSrc).toContain("level: 'warn'")
  })

  test('U() pid check and enteredExisting:!1 owner hold', () => {
    expect(worktreeSrc).toContain(
      'export async function worktreeLockNamesThisProcess',
    )
    expect(worktreeSrc).toContain('parseClaudeWorktreeLockPid(')
    expect(worktreeSrc).toContain('=== process.pid')
    expect(worktreeSrc).toContain('await sleep(250)')
    expect(worktreeSrc).toContain('enteredExisting: false')
    expect(worktreeSrc).toContain('hookBased: false')
    expect(worktreeSrc).toContain(
      "await lockClaudeWorktree(cwd, gitRoot, worktreeName, 'session')",
    )
    expect(worktreeSrc).toContain(
      'await worktreeLockNamesThisProcess(cwd, gitRoot)',
    )
  })

  test('Xt leftover wires bg boot adopt after --worktree create', () => {
    expect(setupSrc).toContain(
      'else if (isBgSession() && !getCurrentWorktreeSession())',
    )
    expect(setupSrc).toContain('await adoptWorktreeForBgBoot(cwd, job)')
    expect(setupSrc).toContain('getBgJobDirectory')
    expect(setupSrc).toContain('readBgJobState')
    expect(setupSrc).toContain('saveWorktreeState(adopted)')
    const createIdx = setupSrc.indexOf('await createWorktreeForSession(')
    const adoptIdx = setupSrc.indexOf('await adoptWorktreeForBgBoot(')
    expect(createIdx).toBeGreaterThan(-1)
    expect(adoptIdx).toBeGreaterThan(createIdx)
  })

  test('U leftover parses lock pid as this process', () => {
    const own = `claude session slug (pid ${process.pid})`
    expect(parseClaudeWorktreeLockPid(own)).toBe(process.pid)
    expect(parseClaudeWorktreeLockPid('claude session x (pid 1)')).toBe(1)
    expect(parseClaudeWorktreeLockPid(undefined)).toBeNull()
  })

  test('adopt refuses hook-based and missing worktreePath', async () => {
    expect(await adoptWorktreeForBgBoot('/tmp/cwd', null)).toBeNull()
    expect(await adoptWorktreeForBgBoot('/tmp/cwd', {})).toBeNull()
    expect(
      await adoptWorktreeForBgBoot('/tmp/cwd', {
        worktreePath: '/tmp/cwd',
        worktreeHookBased: true,
      }),
    ).toBeNull()
  })

  test('adopt refuses when job worktreePath does not name cwd', async () => {
    expect(
      await adoptWorktreeForBgBoot('/tmp/cwd-a', {
        worktreePath: '/tmp/cwd-b',
      }),
    ).toBeNull()
  })
})
