/**
 * densable 2.1.218 tNt — relocateSessionTranscript rehomes session jsonl.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
  stripProtoFields: <T>(v: T) => v,
}))

const {
  relocateSessionTranscript,
  setSessionFileForTesting,
  resetProjectForTesting,
  getTranscriptPath,
  getProjectDir,
} = await import('../sessionStorage.js')
const { getSessionId, getSessionProjectDir, setOriginalCwd, switchSession } =
  await import('../../bootstrap/state.js')
const { asSessionId } = await import('../../types/ids.js')

const temps: string[] = []
const envKeys = [
  'CLAUDE_CONFIG_DIR',
  'TEST_ENABLE_SESSION_PERSISTENCE',
  'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE',
] as const
const envSnap: Partial<Record<(typeof envKeys)[number], string | undefined>> =
  {}

beforeEach(() => {
  for (const k of envKeys) {
    if (!(k in envSnap)) envSnap[k] = process.env[k]
  }
  const cfg = mkdtempSync(join(tmpdir(), 'tnt-cfg-'))
  temps.push(cfg)
  process.env.CLAUDE_CONFIG_DIR = cfg
  process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
  // Host agent sets CLAUDE_CODE_CHILD_SESSION=1 → nested_marker suppress;
  // densable FORCE overrides so tNt can actually move files in unit tests.
  process.env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1'
  resetProjectForTesting()
})

afterEach(() => {
  for (const t of temps.splice(0)) {
    try {
      rmSync(t, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  for (const k of envKeys) {
    if (k in envSnap) {
      const v = envSnap[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
      delete envSnap[k]
    }
  }
  resetProjectForTesting()
})

describe('relocateSessionTranscript (densable tNt)', () => {
  test('null sessionFile pins relocated cwd + project dir without throw', async () => {
    const a = mkdtempSync(join(tmpdir(), 'tnt-a-'))
    const b = mkdtempSync(join(tmpdir(), 'tnt-b-'))
    temps.push(a, b)
    setOriginalCwd(a)
    switchSession(asSessionId(getSessionId()), null)
    setOriginalCwd(b)
    await relocateSessionTranscript()
    expect(getSessionProjectDir()).toBe(getProjectDir(b))
  })

  test('moves materialised jsonl into new project slot and stamps relocated', async () => {
    const a = mkdtempSync(join(tmpdir(), 'tnt-move-a-'))
    const b = mkdtempSync(join(tmpdir(), 'tnt-move-b-'))
    temps.push(a, b)
    setOriginalCwd(a)
    const sid = getSessionId()
    switchSession(asSessionId(sid), getProjectDir(a))
    const oldPath = getTranscriptPath()
    mkdirSync(join(oldPath, '..'), { recursive: true })
    writeFileSync(
      oldPath,
      `${JSON.stringify({ type: 'user', message: { content: 'hi' } })}\n`,
      {
        mode: 0o600,
      },
    )
    setSessionFileForTesting(oldPath)

    setOriginalCwd(b)
    await relocateSessionTranscript()

    const newPath = join(getProjectDir(b), `${sid}.jsonl`)
    expect(getTranscriptPath()).toBe(newPath)
    const body = readFileSync(newPath, 'utf8')
    expect(body).toContain('"type":"user"')
    expect(body).toContain('"type":"relocated"')
    expect(body).toContain(b)
    expect(getSessionProjectDir()).toBe(getProjectDir(b))
  })

  test('same-path rehome only stamps when cwd string changes', async () => {
    const a = mkdtempSync(join(tmpdir(), 'tnt-same-a-'))
    temps.push(a)
    setOriginalCwd(a)
    const sid = getSessionId()
    const projectDir = getProjectDir(a)
    switchSession(asSessionId(sid), projectDir)
    const path = join(projectDir, `${sid}.jsonl`)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({ type: 'tag', tag: 'x', sessionId: sid })}\n`,
    )
    setSessionFileForTesting(path)

    await relocateSessionTranscript()
    const body = readFileSync(path, 'utf8')
    expect(body).toContain('"type":"relocated"')
    expect(body).toContain(a)

    // second call with same cwd should not throw / need new stamp path change
    await relocateSessionTranscript()
  })
})
