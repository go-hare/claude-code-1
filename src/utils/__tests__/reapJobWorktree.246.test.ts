/**
 * densable 2.1.246 #16 — Slu + vjr + xMs + $jr + zr chain.
 *
 * Official:
 *   docs/upstream-extraction/v2.1.246/snippets/gold-worktree-job-reap.txt
 *
 * Do not wire Slu into cleanupStaleAgentWorktrees.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isProcessGone } from '../genericProcessUtils.js'
import {
  findWorktreePathSymlinkComponent,
  isWorktreePathRemovable,
  readWorktreeBaseline,
  reapJobWorktreeIfSafe,
  removeAgentWorktree,
  writeWorktreeBaseline,
} from '../worktree.js'

const utils = join(import.meta.dir, '..')
const worktreeSrc = readFileSync(join(utils, 'worktree.ts'), 'utf8')
const cleanupSrc = readFileSync(join(utils, 'cleanup.ts'), 'utf8')
const gold = readFileSync(
  join(
    import.meta.dir,
    '../../../docs/upstream-extraction/v2.1.246/snippets/gold-worktree-job-reap.txt',
  ),
  'utf8',
)

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('#16 Slu / vjr / xMs / $jr / zr (2.1.246)', () => {
  test('gold-locks official Slu/vjr/xMs/$jr/zr chain', () => {
    expect(gold).toContain('async function vjr(e,t)')
    expect(gold).toContain('async function jHt(e)')
    expect(gold).toContain('async function xMs(e,t,n,r,o)')
    expect(gold).toContain('async function $jr(e,t)')
    expect(gold).toContain('async function GHt(e)')
    expect(gold).toContain('async function UMs(e,t)')
    expect(gold).toContain('async function Ljr(e,t)')
    expect(gold).toContain('async function Slu(e)')
    expect(gold).toContain('BHt')
    expect(gold).toContain('CLAUDE_BASE')
    expect(gold).toContain('job_retention_sweep')
    expect(gold).toContain('if(!s&&!n?.prNumber)')
    expect(gold).toContain('upstream:track,nobracket')
    expect(gold).toContain('k(jobs/settled')
    expect(gold).toContain('Fe / nt')
    expect(gold).toContain('pins.json')
    expect(gold).toContain('if(e) return er(e)')
    expect(gold).toContain('filesRetainedFresh')
    expect(gold).toContain('filesPastCutoff')
    expect(gold).toContain('releaseStaleClaudeWorktreeLocks')
    expect(gold).toContain('restoreWorktreeConfigExtension')
    expect(gold).toContain('stale_cleanup')
    expect(gold).toContain('Rjr zeros porcelain')
    expect(gold).toContain('identity_changed')
    expect(gold).toContain('agent_tool')
    expect(gold).toContain('workflow_tool')
    expect(gold).toContain('Do not wire Slu into cleanupStaleAgentWorktrees')
    expect(gold).toContain('Official blu does not call Slu')
    expect(gold).toContain('Ane @216896913')
    expect(gold).toContain('$Xe @216866269')
    expect(gold).toContain('M4 / j @207666760')
    expect(gold).toContain('xXe @216885408')
    expect(gold).toContain('cleanupWorktree gjr')
    expect(gold).toContain('ywe persist')
    expect(gold).toContain('Ajr @216896631')
    expect(gold).toContain('PHt → M4 remove')
    expect(gold).toContain('shared_record')
    expect(gold).toContain('Sa(originCwd)')
    expect(gold).toContain('exit_tool|exit_dialog')
    expect(gold).toContain('$ee Se')
  })

  test('local hosts vjr/jHt/xMs/$jr/Slu on official sites, not blu←Slu', () => {
    expect(worktreeSrc).toContain('export const CLAUDE_BASE = ')
    expect(worktreeSrc).toContain("'CLAUDE_BASE'")
    expect(worktreeSrc).toContain(
      'export async function writeWorktreeBaseline(',
    )
    expect(worktreeSrc).toContain('export async function readWorktreeBaseline(')
    expect(worktreeSrc).toContain(
      'export async function reapJobWorktreeIfSafe(',
    )
    expect(worktreeSrc).toContain(
      'export async function resetResumedWorktreeIfFullyUpstream(',
    )
    expect(worktreeSrc).toContain(
      'await writeWorktreeBaseline(worktreePath, baseSha)',
    )
    expect(worktreeSrc).toContain('no Claude Code creation marker')
    expect(worktreeSrc).toContain('CLAUDE_BASE')
    expect(worktreeSrc).toContain("baseRef === 'head'")
    expect(worktreeSrc).toContain('refreshed: true')
    expect(worktreeSrc).toContain('upstream:track,nobracket')
    expect(worktreeSrc).toContain('--cherry-pick')
    expect(worktreeSrc).toContain('origin/main')
    expect(worktreeSrc).toContain('origin/master')
    expect(worktreeSrc).toContain('its previous work was fully upstream')
    const create = worktreeSrc.slice(
      worktreeSrc.indexOf('async function getOrCreateWorktree('),
      worktreeSrc.indexOf('export async function keepWorktree('),
    )
    expect(create).toContain(
      'await writeWorktreeBaseline(worktreePath, baseSha)',
    )
    expect(
      create.indexOf('await writeWorktreeBaseline(worktreePath, baseSha)'),
    ).toBeLessThan(create.lastIndexOf('existed: false'))
    expect(create).toContain('resetResumedWorktreeIfFullyUpstream(')
    expect(create).toContain('readWorktreeBaseline(worktreePath)')
    const blu = worktreeSrc.indexOf(
      'export async function cleanupStaleAgentWorktrees(',
    )
    const slu = worktreeSrc.indexOf(
      'export async function reapJobWorktreeIfSafe(',
    )
    expect(slu).toBeGreaterThan(-1)
    expect(blu).toBeGreaterThan(slu)
    expect(worktreeSrc.slice(blu)).not.toContain('reapJobWorktreeIfSafe(')
    expect(worktreeSrc.slice(blu)).toContain('isJobWorktreeSafeToReap(')
    expect(worktreeSrc.slice(blu)).toContain('porcelainLockReason(')
    expect(worktreeSrc.slice(blu)).toContain('releaseStaleClaudeWorktreeLocks(')
    expect(worktreeSrc.slice(blu)).toContain('restoreWorktreeConfigExtension(')
    expect(worktreeSrc.slice(blu)).toContain("'stale_cleanup'")
    expect(worktreeSrc.slice(blu)).not.toContain("'-uno'")
    expect(worktreeSrc).toContain("'job_retention_sweep'")
    expect(worktreeSrc).toContain("reason = 'unknown'")
    expect(worktreeSrc).toContain("outcome !== 'failed'")
    expect(worktreeSrc).toContain('isWorktreeToplevelElsewhere')
    expect(worktreeSrc).toContain('WORKTREE_RESOLUTION_CHANGED')
    expect(worktreeSrc).toContain('rev-parse')
    expect(worktreeSrc).toContain('--show-toplevel')
    expect(worktreeSrc).toContain('removeAgentWorktreeWithoutGitRoot(')
    expect(worktreeSrc).toContain('findWorktreePathSymlinkComponent(')
    expect(worktreeSrc).toContain('isWorktreePathRemovable(')
    expect(worktreeSrc).toContain(
      'has files but no repository to verify them against',
    )
    expect(worktreeSrc).toContain('unremovable reparse point in the worktree')
    expect(worktreeSrc).toContain('hasWorktreeRemoveHook()')
    expect(worktreeSrc).toContain('async function deleteWorktreeBranch(')
    expect(worktreeSrc).toContain(
      "errorLabel: 'Could not delete agent worktree branch'",
    )
    expect(worktreeSrc).toContain('logSuccess: true')
    expect(worktreeSrc).toContain('readWorktreeHeadSha(worktreePath)')
    expect(worktreeSrc).toContain('teardownFailedWorktreeCreate(')
    expect(worktreeSrc).toContain('unlinkDanglingWorktreeGitPointer(')
    expect(worktreeSrc).toContain('isProcessGone(')
    expect(worktreeSrc).not.toContain('function isWorktreeLockPidGone')
    expect(worktreeSrc).toContain(
      'executeWorktreeRemoveHook(hookPath, persist)',
    )
    expect(worktreeSrc).toContain(
      'executeWorktreeRemoveHook(worktreePath, persist)',
    )
    expect(worktreeSrc).toContain('resolveGitRootIfPresent(')
    expect(worktreeSrc).toContain(
      'No WorktreeRemove hook configured; falling back to git worktree remove',
    )
    expect(worktreeSrc).not.toContain(
      'No WorktreeRemove hook configured, hook-based worktree left',
    )

    expect(cleanupSrc).toContain(
      'export async function cleanupJobsRetentionSweep(',
    )
    expect(cleanupSrc).toContain('[cleanup] jobs/')
    expect(cleanupSrc).toContain('job state read threw')
    expect(cleanupSrc).toContain('reapJobWorktreeIfSafe({')
    expect(cleanupSrc).toContain(
      'await cleanupJobsRetentionSweep(getPinnedStorageV5())',
    )
    expect(cleanupSrc).toContain("join(home, 'jobs', 'settled')")
    expect(cleanupSrc).toContain("join(home, 'daemon', 'dispatch', 'rejected')")
    expect(cleanupSrc).toContain("join(home, 'daemon', 'auth')")
    expect(cleanupSrc).toContain("join(home, 'daemon', 'host-managed')")
    expect(cleanupSrc).toContain("'pins.json'")
    expect(cleanupSrc).toContain('readPinnedJobShorts')
    expect(cleanupSrc).toContain("namespace: 'jobsRoot'")
    expect(cleanupSrc).toContain("file: 'pins'")
    expect(cleanupSrc).toContain('if (storageV5)')
    expect(cleanupSrc).toContain('statMeta')
    expect(cleanupSrc).toContain('readText')
    expect(cleanupSrc).toContain('filesRetainedFresh')
    expect(cleanupSrc).toContain('filesPastCutoff')
    expect(cleanupSrc).toContain("'daemon.log'")
    const hooksSrc = readFileSync(join(utils, 'hooks.ts'), 'utf8')
    expect(hooksSrc).toContain('storageV5: persist.storageV5')
    expect(hooksSrc).toContain('credentials: persist.credentials')
    expect(hooksSrc).toContain('pluginDirectoryExists(storageV5, pluginRoot)')
    expect(hooksSrc).toContain(
      'await loadPluginOptionsNw(pluginId, credentials)',
    )
    expect(hooksSrc).toContain(
      'const persistStorageV5 = toolUseContext?.storageV5 ?? storageV5',
    )
    expect(hooksSrc).not.toMatch(
      /executeHooksOutsideREPL[\s\S]{0,800}void storageV5/,
    )
    const exitSrc = readFileSync(
      join(
        utils,
        '../../packages/builtin-tools/src/tools/ExitWorktreeTool/ExitWorktreeTool.ts',
      ),
      'utf8',
    )
    expect(exitSrc).toMatch(/source:\s*'exit_tool'/)
    expect(exitSrc).not.toContain("reason = 'exit_tool'")
    expect(exitSrc).toContain('cleanupWorktree({')
    const dialogSrc = readFileSync(
      join(utils, '../components/WorktreeExitDialog.tsx'),
      'utf8',
    )
    expect(dialogSrc).toContain("source: 'exit_dialog'")
    expect(dialogSrc).toContain('Worktree could not be removed')
    expect(cleanupSrc).toContain('roster.json.corrupt.')
    const bg = cleanupSrc.indexOf(
      'export async function cleanupOldMessageFilesInBackground',
    )
    expect(
      cleanupSrc.indexOf(
        'await cleanupJobsRetentionSweep(getPinnedStorageV5())',
        bg,
      ),
    ).toBeGreaterThan(bg)
  })

  test('Slu hookBased and missing CLAUDE_BASE keep the worktree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slu-keep-'))
    temps.push(dir)
    mkdirSync(join(dir, '.git'), { recursive: true })
    mkdirSync(join(dir, '.claude', 'worktrees', 'feature'), { recursive: true })
    const worktreePath = join(dir, '.claude', 'worktrees', 'feature')
    const cutoff = new Date(Date.now() + 86400000)

    expect(
      await reapJobWorktreeIfSafe({
        worktreePath,
        originCwd: dir,
        hookBased: true,
        cutoff,
      }),
    ).toBe(false)

    expect(
      await reapJobWorktreeIfSafe({
        worktreePath,
        originCwd: dir,
        cutoff,
      }),
    ).toBe(false)
  })

  test('Fe(e) uses storageV5 er(e) when the host is passed', async () => {
    const { cleanupJobsRetentionSweep } = await import('../cleanup.js')
    const shorts = ['abcd1234', 'deadbeef']
    const host = {
      statMeta: async () => ({
        ok: true as const,
        value: { size: JSON.stringify(shorts).length },
      }),
      readText: async () => ({
        ok: true as const,
        value: {
          items: [
            {
              found: true,
              totalBytes: JSON.stringify(shorts).length,
              value: JSON.stringify(shorts),
            },
          ],
        },
      }),
    }
    // The sweep still runs the disk sidecar, and it rm -rf's job dirs, worktrees
    // and daemon logs under getClaudeConfigHomeDir(). Point that at a temp dir —
    // the memo is keyed on CLAUDE_CONFIG_DIR, so setting it is enough.
    const configDir = mkdtempSync(join(tmpdir(), 'slu-cfg-'))
    temps.push(configDir)
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    try {
      const result = await cleanupJobsRetentionSweep(host)
      expect(result.filesRetainedFresh).toBeGreaterThanOrEqual(0)
      expect(result.filesPastCutoff).toBeGreaterThanOrEqual(0)
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })

  test('jHt rejects missing and non-sha CLAUDE_BASE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slu-base-'))
    temps.push(dir)
    const gitAdmin = join(dir, 'git', 'worktrees', 'wt')
    mkdirSync(gitAdmin, { recursive: true })
    const wt = join(dir, 'wt')
    mkdirSync(wt)
    writeFileSync(join(wt, '.git'), `gitdir: ${gitAdmin}\n`)

    expect(await readWorktreeBaseline(wt)).toBeNull()
    writeFileSync(join(gitAdmin, 'CLAUDE_BASE'), 'not-a-sha\n')
    expect(await readWorktreeBaseline(wt)).toBeNull()
    await writeWorktreeBaseline(wt, '0123456789abcdef0123456789abcdef01234567')
    expect(await readWorktreeBaseline(wt)).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    )
  })

  test('Ane refuses relative and non-.claude/worktrees paths', async () => {
    expect(await removeAgentWorktree('relative/wt')).toEqual({
      outcome: 'failed',
      errorSummary: 'path is not absolute',
    })
    const dir = mkdtempSync(join(tmpdir(), 'ane-root-'))
    temps.push(dir)
    const stray = join(dir, 'not-claude', 'wt')
    mkdirSync(stray, { recursive: true })
    const removed = await removeAgentWorktree(stray)
    expect(removed.outcome).toBe('failed')
    expect(removed.errorSummary).toBe(
      'not directly under a .claude/worktrees directory',
    )
    expect(existsSync(stray)).toBe(true)
  })

  test('Ane removes an empty .claude/worktrees dir when no git root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ane-empty-'))
    temps.push(dir)
    const wt = join(dir, '.claude', 'worktrees', 'slug')
    mkdirSync(wt, { recursive: true })
    const removed = await removeAgentWorktree(wt)
    expect(removed.outcome).toBe('removed')
    expect(existsSync(wt)).toBe(false)
  })

  test('Ane keeps a non-empty rootless worktree unless job_delete_force', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ane-files-'))
    temps.push(dir)
    const wt = join(dir, '.claude', 'worktrees', 'slug')
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, 'keep.txt'), 'x')
    const kept = await removeAgentWorktree(wt)
    expect(kept).toEqual({
      outcome: 'failed',
      errorSummary: 'has files but no repository to verify them against',
      needsForce: true,
    })
    expect(existsSync(join(wt, 'keep.txt'))).toBe(true)
    const forced = await removeAgentWorktree(
      wt,
      undefined,
      undefined,
      false,
      'job_delete_force',
    )
    expect(forced.outcome).toBe('removed')
    expect(existsSync(wt)).toBe(false)
  })

  test('$Xe reports a symlink component under the root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xe-link-'))
    temps.push(dir)
    const real = join(dir, 'real')
    const link = join(dir, 'link')
    mkdirSync(real)
    try {
      symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return
    }
    const hit = await findWorktreePathSymlinkComponent(
      join(link, 'nested'),
      dir,
    )
    expect(hit?.kind).toBe('symlink')
    expect(hit?.component).toBe(link)
  })

  test('$ee isProcessGone is not !isProcessRunning', () => {
    expect(isProcessGone(1)).toBe(false)
    expect(isProcessGone(0)).toBe(false)
    expect(isProcessGone(1.5)).toBe(false)
    expect(isProcessGone(2147483648)).toBe(false)
    expect(isProcessGone(process.pid)).toBe(false)
    expect(isProcessGone(2147483647)).toBe(true)
  })

  test('M4 is true off Windows', async () => {
    if (process.platform === 'win32') return
    const dir = mkdtempSync(join(tmpdir(), 'm4-ok-'))
    temps.push(dir)
    expect(await isWorktreePathRemovable(dir)).toBe(true)
  })
})
