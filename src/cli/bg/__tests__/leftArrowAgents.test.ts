import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// jobState.createInitialJobState reads MACRO.VERSION (build define).
beforeAll(() => {
  ;(globalThis as { MACRO?: { VERSION: string } }).MACRO = {
    VERSION: '2.6.33-test',
  }
})

describe('seedForLeftArrow + writeA8qJobState (official Sj4/A8q)', () => {
  const prevHome = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevHome
    if (dir) rmSync(dir, { recursive: true, force: true })
    mock.restore()
  })

  test('seedForLeftArrow empty → intent ""', async () => {
    const { seedForLeftArrow } = await import('../helpers.js')
    expect(seedForLeftArrow([], {})).toEqual({ intent: '' })
  })

  test('seedForLeftArrow fills haiku title when name missing', async () => {
    const { seedForLeftArrow } = await import('../helpers.js')
    const seed = seedForLeftArrow(
      [{ type: 'user', message: { content: 'fix the flaky test' } }],
      { haikuTitle: 'flaky-fix' },
    )
    expect(seed.intent).toBe('fix the flaky test')
    expect(seed.name).toBe('flaky-fix')
    expect(seed.nameSource).toBe('auto')
  })

  test('writeA8qJobState empty seed → idle blocked needs prompt', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const { writeA8qJobState, readBgJobState } = await import(
      '../../../daemon/jobState.js'
    )
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const { short } = writeA8qJobState({
      sessionId,
      cwd: '/tmp/proj',
      intent: '',
    })
    expect(short).toBe('aaaaaaaa')
    const state = readBgJobState(short)!
    expect(state.intent).toBe('')
    expect(state.template).toBe('bg')
    expect(state.state).toBe('working')
    expect(state.tempo).toBe('blocked')
    expect(state.needs).toBe('send a prompt to start')
    expect(state.detail).toContain('send a prompt to start')
    // Must not default name to "new session"
    expect(state.name).toBeUndefined()
  })

  test('writeA8qJobState with intent keeps name and detail', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const { writeA8qJobState, readBgJobState } = await import(
      '../../../daemon/jobState.js'
    )
    const sessionId = '11111111-2222-3333-4444-555555555555'
    writeA8qJobState({
      sessionId,
      cwd: '/tmp/proj',
      intent: 'push 12000 proxy',
      name: 'push 12000',
      nameSource: 'user',
      detail: 'Pushing via proxy…',
    })
    const state = readBgJobState('11111111')!
    expect(state.intent).toBe('push 12000 proxy')
    expect(state.name).toBe('push 12000')
    expect(state.detail).toBe('Pushing via proxy…')
    expect(state.tempo).toBe('active')
    expect(state.state).toBe('starting')
  })

  test('submitDispatch providedSessionId matches A8q short', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const { writeA8qJobState } = await import('../../../daemon/jobState.js')
    const provided = 'cccccccc-dddd-eeee-ffff-000000000000'
    writeA8qJobState({
      sessionId: provided,
      cwd: '/tmp',
      intent: 'from left arrow',
      name: 'from left',
    })

    const { submitDispatch } = await import('../../../daemon/bgManager.js')
    const result = await submitDispatch({
      intent: 'from left arrow',
      name: 'from left',
      source: 'left_arrow',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      forkSession: true,
      providedSessionId: provided,
    })
    expect(result.short).toBe('cccccccc')
    expect(result.sessionId).toBe(provided)

    const { getDispatchDir } = await import('../../../daemon/bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as {
      short: string
      sessionId: string
      source: string
      launch: { mode: string; sessionId?: string; fork?: boolean }
      name?: string
      intent: string
    }
    expect(payload.short).toBe('cccccccc')
    expect(payload.source).toBe('left_arrow')
    expect(payload.launch.mode).toBe('resume')
    expect(payload.launch.fork).toBe(true)
    expect(payload.launch.sessionId).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(payload.name).toBe('from left')
    expect(payload.intent).toBe('from left arrow')
  })
})
