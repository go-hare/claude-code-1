/**
 * densable 2.1.246 #14 — official `Kn` respawn-in-flight.
 *
 * `present && !alive` is a booting worker: do not kill.
 * After a kill, re-read `stopped` → official sentence.
 * The 246 early return makes the sentence unreachable without an external
 * state flip; keep the copy and do not invent it on !present.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../xyrRespawn.ts'), 'utf8')

const temps: string[] = []
const prevConfig = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfig
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('densable 2.1.246 #14 Kn respawn-in-flight', () => {
  test('source: present && !alive returns without kill; official sentence kept', () => {
    expect(src).toContain('if (!force && probe.present && !probe.alive)')
    expect(src).toContain('return null')
    expect(src).toContain('was stopped while the respawn was in flight')
    expect(src).toContain("stateBefore.state !== 'stopped'")
  })

  test('!present !alive with a working job does not invent the in-flight sentence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xyr-246-'))
    temps.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir

    const { writeBgJobState } = await import('../jobState.js')
    const { xyrPreflightBeforeRespawn } = await import('../xyrRespawn.js')

    writeBgJobState('abcabc01', {
      state: 'working',
      detail: '',
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

    const err = await xyrPreflightBeforeRespawn({
      short: 'abcabc01',
      resumeSessionId: 'sess-1',
      hasMessages: false,
    })
    expect(err).toBeNull()
  })
})
