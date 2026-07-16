import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('submitDispatch resume/fork path (official Hbe subset)', () => {
  const prevHome = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevHome
    if (dir) rmSync(dir, { recursive: true, force: true })
    mock.restore()
  })

  test('builds launch.mode=resume with fork for exit handoff', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const { submitDispatch } = await import('../bgManager.js')
    const result = await submitDispatch({
      intent: 'continue work',
      name: 'exit-job',
      source: 'exit',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      forkSession: true,
      extraArgs: ['--reply-on-resume'],
    })

    expect(result.short).toHaveLength(8)

    const { getDispatchDir } = await import('../bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as {
      launch: {
        mode: string
        sessionId?: string
        fork?: boolean
        flagArgs?: string[]
      }
      source: string
    }
    expect(payload.source).toBe('exit')
    expect(payload.launch.mode).toBe('resume')
    expect(payload.launch.sessionId).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(payload.launch.fork).toBe(true)
    expect(payload.launch.flagArgs).toContain('--reply-on-resume')
    // Must not use the old print-mode argv that left orphan -p children.
    expect(JSON.stringify(payload)).not.toContain('"-p"')
  })
})
