import { afterEach, describe, expect, mock, test } from 'bun:test'

describe('submitDispatch resume/fork path (official Hbe subset)', () => {
  afterEach(() => {
    mock.restore()
  })

  test('builds launch.mode=resume with fork for exit handoff', async () => {
    const written: Array<{ path: string; body: string }> = []

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    mock.module('fs/promises', () => ({
      mkdir: async () => undefined,
      writeFile: async (path: string, body: string) => {
        written.push({ path, body })
      },
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
    expect(written.length).toBe(1)
    const payload = JSON.parse(written[0]!.body) as {
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
