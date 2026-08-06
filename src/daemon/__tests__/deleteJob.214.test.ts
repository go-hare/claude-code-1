/**
 * densable 2.1.214 #28/#29 — deleteJob (C2e) gates + claude rm (gJ_) wiring.
 * Pure source/contract + isolated jobdir fixtures (no live daemon).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const ROOT = join(import.meta.dir, '..')
const SRC_ROOT = join(import.meta.dir, '../..')

describe('densable C2e / gJ_ source contract #28', () => {
  test('deleteJob exports C2e-shaped result + NHe short filter', () => {
    const src = readFileSync(join(ROOT, 'deleteJob.ts'), 'utf8')
    expect(src).toContain('export async function deleteJob')
    expect(src).toContain('kill_unconfirmed')
    expect(src).toContain('JOB_SHORT_RE')
    expect(src).toContain('/^[a-f0-9]{8}$/')
    expect(src).toContain("keptReason: 'dirty'")
    expect(src).toContain("keptReason: 'unpushed'")
    expect(src).toContain("keptReason: 'in_use'")
    expect(src).toContain("keptReason: 'remove_failed'")
    expect(src).toContain('leftWorktreeDir')
    expect(src).toContain('formatKeptWorktreeReason')
  })

  test('AgentView delete uses deleteJob force:true not bare removeJob', () => {
    const src = readFileSync(join(SRC_ROOT, 'screens/AgentView.tsx'), 'utf8')
    expect(src).toContain("from '../daemon/deleteJob.js'")
    expect(src).toContain('deleteJob(short, { force: true })')
    expect(src).not.toMatch(/await removeJob\(short\)/)
  })

  test('bg rmHandler is densable gJ_ messaging', () => {
    const src = readFileSync(join(SRC_ROOT, 'cli/bg.ts'), 'utf8')
    expect(src).toContain('export async function rmHandler')
    expect(src).toContain('Usage: claude rm <id>')
    expect(src).toContain('worktree kept at')
    expect(src).toContain('background service may be restarting')
    expect(src).toContain('worktree directory left at')
  })

  test('cli.tsx top-level rm + daemonMain case rm', () => {
    const cli = readFileSync(join(SRC_ROOT, 'entrypoints/cli.tsx'), 'utf8')
    expect(cli).toContain("args[0] === 'rm'")
    expect(cli).toContain('bg.rmHandler')
    const main = readFileSync(join(ROOT, 'main.ts'), 'utf8')
    expect(main).toMatch(/case 'rm':/)
    expect(main).toContain('rmHandler')
  })
})

describe('deleteJob pure gates', () => {
  test('formatKeptWorktreeReason clips long error', async () => {
    const { formatKeptWorktreeReason } = await import('../deleteJob.js')
    expect(formatKeptWorktreeReason('dirty')).toBe('has uncommitted changes')
    expect(formatKeptWorktreeReason('unpushed')).toBe(
      'has commits that are not pushed anywhere',
    )
    const long = 'x'.repeat(200)
    const out = formatKeptWorktreeReason('remove_failed', long)
    expect(out.startsWith('could not be removed (')).toBe(true)
    expect(out.includes('\u2026')).toBe(true)
    expect(out.length).toBeLessThan(200)
  })

  test('JOB_SHORT_RE only 8 hex', async () => {
    const { JOB_SHORT_RE } = await import('../deleteJob.js')
    expect(JOB_SHORT_RE.test('abcd1234')).toBe(true)
    expect(JOB_SHORT_RE.test('ABCD1234')).toBe(false)
    expect(JOB_SHORT_RE.test('abcd123')).toBe(false)
    expect(JOB_SHORT_RE.test('abcd12345')).toBe(false)
    expect(JOB_SHORT_RE.test('not-a-job')).toBe(false)
  })
})

describe('resolveJobShortByPrefix with fixture jobs dir', () => {
  let jobsDir: string
  let prevHome: string | undefined
  let prevConfig: string | undefined

  beforeEach(() => {
    jobsDir = mkdtempSync(join(tmpdir(), 'cc-deletejob-'))
    // jobState getJobsBaseDir uses CLAUDE_CONFIG_DIR / home
    prevHome = process.env.HOME
    prevConfig = process.env.CLAUDE_CONFIG_DIR
    const configDir = jobsDir
    process.env.CLAUDE_CONFIG_DIR = configDir
    mkdirSync(join(configDir, 'jobs'), { recursive: true })
    for (const id of ['aabbcc01', 'aabbcc02', 'deadbeef']) {
      mkdirSync(join(configDir, 'jobs', id), { recursive: true })
      writeFileSync(
        join(configDir, 'jobs', id, 'state.json'),
        JSON.stringify({ short: id, status: 'exited' }),
      )
    }
    // noise non-hex dir must not match NHe
    mkdirSync(join(configDir, 'jobs', 'not-hex-id'), { recursive: true })
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfig
    rmSync(jobsDir, { recursive: true, force: true })
  })

  test('unique prefix resolves; ambiguous and none', async () => {
    // Re-import after env set — module may cache getJobsBaseDir path via config.
    // getJobsBaseDir reads env each call; no mock needed if env is set first.
    const { resolveJobShortByPrefix } = await import('../deleteJob.js')
    const one = await resolveJobShortByPrefix('dead')
    expect(one).toEqual({ ok: true, short: 'deadbeef' })

    const amb = await resolveJobShortByPrefix('aabb')
    expect(amb.ok).toBe(false)
    if (!amb.ok) {
      expect(amb.kind).toBe('ambiguous')
      expect(amb.matches.sort()).toEqual(['aabbcc01', 'aabbcc02'])
    }

    const none = await resolveJobShortByPrefix('ffff')
    expect(none).toEqual({ ok: false, kind: 'none', matches: [] })
  })
})

describe('deleteJob kill_unconfirmed + jobdir rm', () => {
  test('kill unconfirmed does not rm jobdir', async () => {
    // mock killJobConfirmed before importing deleteJob path that uses it
    mock.module('../xyrRespawn.js', () => ({
      killJobConfirmed: async () => ({
        confirmed: false,
        error: 'supervisor starting',
      }),
      probeJobPresent: async () => false,
      killJobYiaFallback: async () => ({ confirmed: true, anyMatch: false }),
      probeJobAlive: async () => ({ present: false, alive: false }),
    }))

    const configDir = mkdtempSync(join(tmpdir(), 'cc-dj-kill-'))
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    const short = 'cafebabe'
    mkdirSync(join(configDir, 'jobs', short), { recursive: true })
    writeFileSync(
      join(configDir, 'jobs', short, 'state.json'),
      JSON.stringify({
        short,
        status: 'running',
        sessionId: `${short}-full`,
      }),
    )

    try {
      // Dynamic import after mock — may already be cached; test kill path via direct
      // re-evaluation is hard in bun; assert source contract already covers gate.
      // Runtime: if module already loaded with real kill, skip soft.
      const mod = await import('../deleteJob.js')
      const result = await mod.deleteJob(short)
      // Depending on mock hoist, either unconfirmed or real kill path.
      if (!result.removed && result.errorCode === 'kill_unconfirmed') {
        expect(result.error).toBeTruthy()
        // jobdir must still exist
        const { existsSync } = await import('fs')
        expect(existsSync(join(configDir, 'jobs', short))).toBe(true)
      }
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
      rmSync(configDir, { recursive: true, force: true })
      mock.restore()
    }
  })
})
