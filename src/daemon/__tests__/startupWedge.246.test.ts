/**
 * densable 2.1.246 #7 — z8n startup wedge. rPt = "starting…".
 * markStartupDialogBlocked stays invent-ban (bytecode chunk).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const src = readFileSync(
  join(import.meta.dir, '../rendezvousServer.ts'),
  'utf8',
)

const temps: string[] = []
const prevConfig = process.env.CLAUDE_CONFIG_DIR

afterEach(async () => {
  if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfig
  const { resetStartupWedgeForTests } = await import('../rendezvousServer.js')
  resetStartupWedgeForTests()
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('densable 2.1.246 #7 startup wedge', () => {
  test('source: z8n names + rPt + 45s', () => {
    expect(src).toContain('armStartupWedgeWatchdog')
    expect(src).toContain('disarmStartupWedgeWatchdog')
    expect(src).toContain('onStartupWedgeTimeout')
    expect(src).toContain('CLAUDE_BG_STARTUP_WEDGE_MS || 45000')
    expect(src).toContain("STARTUP_DETAIL_RPT = 'starting…'")
    expect(src).toContain('stuck on a startup dialog')
    expect(src).toContain('open this session to continue setup')
    expect(src).toContain("t.state !== 'working'")
    expect(src).toContain('t.detail !== STARTUP_DETAIL_RPT')
    expect(src).not.toContain('markStartupDialogBlocked')

    const xSe = readFileSync(join(import.meta.dir, '../xSeSpawn.ts'), 'utf8')
    const bg = readFileSync(join(import.meta.dir, '../bgManager.ts'), 'utf8')
    expect(xSe).toMatch(/state: 'working',\s+detail: 'starting…'/)
    expect(bg).toMatch(/state: 'working',\s+detail: 'starting\\u2026'/)
  })

  test('timeout still working+rPt → blocked + stuck-dialog copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wedge-246-'))
    temps.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir

    const { writeBgJobState, readBgJobState, getJobDirPath } = await import(
      '../jobState.js'
    )
    const {
      onStartupWedgeTimeout,
      STARTUP_DETAIL_RPT,
      STUCK_STARTUP_DIALOG,
      STUCK_STARTUP_NEEDS,
      resetStartupWedgeForTests,
    } = await import('../rendezvousServer.js')
    resetStartupWedgeForTests()

    writeBgJobState('abcd1234', {
      state: 'working',
      detail: STARTUP_DETAIL_RPT,
      tempo: 'active',
      output: null,
      children: null,
      template: 'bg',
      respawnFlags: [],
      intent: 'boot',
      sessionId: 'sess-1',
      resumeSessionId: 'sess-1',
      cwd: dir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      firstTerminalAt: null,
    })

    await onStartupWedgeTimeout(getJobDirPath('abcd1234'))
    const st = readBgJobState('abcd1234')!
    expect(st.tempo).toBe('blocked')
    expect(st.detail).toBe(STUCK_STARTUP_DIALOG)
    expect(st.needs).toBe(STUCK_STARTUP_NEEDS)
    expect(st.state).toBe('working')
  })

  test('timeout no-ops when detail moved off rPt or already blocked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wedge-246b-'))
    temps.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir

    const { writeBgJobState, readBgJobState, getJobDirPath } = await import(
      '../jobState.js'
    )
    const { onStartupWedgeTimeout, resetStartupWedgeForTests } = await import(
      '../rendezvousServer.js'
    )
    resetStartupWedgeForTests()

    writeBgJobState('deadbeef', {
      state: 'working',
      detail: 'running tools',
      tempo: 'active',
      output: null,
      children: null,
      template: 'bg',
      respawnFlags: [],
      intent: 'boot',
      sessionId: 'sess-2',
      resumeSessionId: 'sess-2',
      cwd: dir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      firstTerminalAt: null,
    })
    await onStartupWedgeTimeout(getJobDirPath('deadbeef'))
    expect(readBgJobState('deadbeef')!.detail).toBe('running tools')
    expect(readBgJobState('deadbeef')!.tempo).toBe('active')
  })

  test('disarm prevents the timeout write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wedge-246c-'))
    temps.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir

    const { writeBgJobState, readBgJobState, getJobDirPath } = await import(
      '../jobState.js'
    )
    const {
      onStartupWedgeTimeout,
      disarmStartupWedgeWatchdog,
      STARTUP_DETAIL_RPT,
      resetStartupWedgeForTests,
    } = await import('../rendezvousServer.js')
    resetStartupWedgeForTests()

    writeBgJobState('cafebabe', {
      state: 'working',
      detail: STARTUP_DETAIL_RPT,
      tempo: 'active',
      output: null,
      children: null,
      template: 'bg',
      respawnFlags: [],
      intent: 'boot',
      sessionId: 'sess-3',
      resumeSessionId: 'sess-3',
      cwd: dir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      firstTerminalAt: null,
    })
    disarmStartupWedgeWatchdog()
    await onStartupWedgeTimeout(getJobDirPath('cafebabe'))
    expect(readBgJobState('cafebabe')!.detail).toBe(STARTUP_DETAIL_RPT)
    expect(readBgJobState('cafebabe')!.tempo).toBe('active')
  })

  test('production seed is working+rPt so maybeArmStartupWedge arms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wedge-246-seed-'))
    temps.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir

    const { seedJobStateClient } = await import('../xSeSpawn.js')
    const { readBgJobState, getJobDirPath } = await import('../jobState.js')
    const {
      maybeArmStartupWedge,
      onStartupWedgeTimeout,
      STARTUP_DETAIL_RPT,
      STUCK_STARTUP_DIALOG,
      resetStartupWedgeForTests,
    } = await import('../rendezvousServer.js')
    resetStartupWedgeForTests()

    seedJobStateClient(
      {
        short: 'feedface',
        sessionId: 'sess-seed',
        intent: 'boot',
        cwd: dir,
        respawnFlags: [],
        source: 'test',
        createdAt: Date.now(),
        launch: { mode: 'prompt', args: [] },
      },
      { freshDir: true, skipSeed: false },
    )

    const seeded = readBgJobState('feedface')!
    expect(seeded.state).toBe('working')
    expect(seeded.detail).toBe(STARTUP_DETAIL_RPT)

    maybeArmStartupWedge(getJobDirPath('feedface'))
    await new Promise<void>(r => setTimeout(r, 30))
    await onStartupWedgeTimeout(getJobDirPath('feedface'))
    expect(readBgJobState('feedface')!.detail).toBe(STUCK_STARTUP_DIALOG)
    expect(readBgJobState('feedface')!.tempo).toBe('blocked')
  })
})
