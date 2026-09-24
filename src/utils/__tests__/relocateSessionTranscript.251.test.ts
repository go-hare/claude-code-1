/**
 * densable 2.1.251 #25 — dpe set-aside before relocate.
 *
 * GOLD: gold-251-d.md S0e / gold-251-k.md dpe + DVt(lutimes) + HA(rename).
 * Dest is HA-renamed to `${dest}.superseded-${ts}`; Y(ENOENT) is a no-op;
 * failed move HA-restores aside → dest. Vjn isRetentionExemptionDisabled
 * is ABSENT — lutimes is the gold default arm.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.js', analyticsMock)

const {
  getProjectDir,
  getTranscriptPath,
  relocateSessionTranscript,
  resetProjectForTesting,
  setSessionFileForTesting,
} = await import('../sessionStorage.js')
const {
  getSessionId,
  getSessionProjectDir,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
  switchSession,
} = await import('../../bootstrap/state.js')
const { asSessionId } = await import('../../types/ids.js')

const temps: string[] = []
const suiteCwd = process.cwd()
const suiteSessionId = getSessionId()
const suiteSessionProjectDir = getSessionProjectDir()
const envKeys = [
  'CLAUDE_CONFIG_DIR',
  'TEST_ENABLE_SESSION_PERSISTENCE',
  'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE',
] as const
const envSnap: Partial<Record<(typeof envKeys)[number], string | undefined>> =
  {}

function supersededSiblings(dir: string, sessionId: string): string[] {
  return readdirSync(dir).filter(
    name =>
      name.startsWith(`${sessionId}.jsonl.superseded-`) &&
      !name.endsWith('.jsonl'),
  )
}

beforeEach(() => {
  for (const k of envKeys) {
    if (!(k in envSnap)) envSnap[k] = process.env[k]
  }
  const cfg = mkdtempSync(join(tmpdir(), 'dpe-cfg-'))
  temps.push(cfg)
  process.env.CLAUDE_CONFIG_DIR = cfg
  process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
  process.env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1'
  resetProjectForTesting()
})

afterEach(() => {
  try {
    process.chdir(suiteCwd)
  } catch {
    // ignore
  }
  try {
    setCwdState(suiteCwd)
    setOriginalCwd(suiteCwd)
    setProjectRoot(suiteCwd)
    switchSession(suiteSessionId, suiteSessionProjectDir)
  } catch {
    // ignore
  }
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

describe('relocateSessionTranscript densable 2.1.251 dpe', () => {
  test('renames an existing dest to .superseded-<ts> instead of overwriting', async () => {
    const a = mkdtempSync(join(tmpdir(), 'dpe-a-'))
    const b = mkdtempSync(join(tmpdir(), 'dpe-b-'))
    temps.push(a, b)
    setOriginalCwd(a)
    const sid = getSessionId()
    switchSession(asSessionId(sid), getProjectDir(a))
    const oldPath = getTranscriptPath()
    mkdirSync(dirname(oldPath), { recursive: true })
    writeFileSync(
      oldPath,
      `${JSON.stringify({ type: 'user', tag: 'src' })}\n`,
      {
        mode: 0o600,
      },
    )
    setSessionFileForTesting(oldPath)

    const destDir = getProjectDir(b)
    mkdirSync(destDir, { recursive: true })
    const destPath = join(destDir, `${sid}.jsonl`)
    writeFileSync(
      destPath,
      `${JSON.stringify({ type: 'user', tag: 'dest' })}\n`,
    )
    const old = new Date('2020-01-01T00:00:00.000Z')
    utimesSync(destPath, old, old)

    setOriginalCwd(b)
    await relocateSessionTranscript()

    const newPath = join(destDir, `${sid}.jsonl`)
    expect(getTranscriptPath()).toBe(newPath)
    const body = readFileSync(newPath, 'utf8')
    expect(body).toContain('"tag":"src"')
    expect(body).not.toContain('"tag":"dest"')
    expect(body).toContain('"type":"relocated"')

    const asides = supersededSiblings(destDir, sid)
    expect(asides).toHaveLength(1)
    expect(asides[0]).toMatch(new RegExp(`^${sid}\\.jsonl\\.superseded-\\d+$`))
    const asidePath = join(destDir, asides[0]!)
    expect(readFileSync(asidePath, 'utf8')).toContain('"tag":"dest"')
    expect(statSync(asidePath).mtimeMs).toBeGreaterThan(old.getTime() + 1)
  })

  test('ENOENT dest is a no-op for dpe (no .superseded file)', async () => {
    const a = mkdtempSync(join(tmpdir(), 'dpe-miss-a-'))
    const b = mkdtempSync(join(tmpdir(), 'dpe-miss-b-'))
    temps.push(a, b)
    setOriginalCwd(a)
    const sid = getSessionId()
    switchSession(asSessionId(sid), getProjectDir(a))
    const oldPath = getTranscriptPath()
    mkdirSync(dirname(oldPath), { recursive: true })
    writeFileSync(oldPath, `${JSON.stringify({ type: 'user', tag: 'only' })}\n`)
    setSessionFileForTesting(oldPath)

    setOriginalCwd(b)
    await relocateSessionTranscript()

    const destDir = getProjectDir(b)
    expect(supersededSiblings(destDir, sid)).toEqual([])
    expect(readFileSync(join(destDir, `${sid}.jsonl`), 'utf8')).toContain(
      '"tag":"only"',
    )
  })

  test('failed ENOENT move restores the set-aside dest via HA(rename)', async () => {
    const a = mkdtempSync(join(tmpdir(), 'dpe-rest-a-'))
    const b = mkdtempSync(join(tmpdir(), 'dpe-rest-b-'))
    temps.push(a, b)
    setOriginalCwd(a)
    const sid = getSessionId()
    const sourceDir = getProjectDir(a)
    switchSession(asSessionId(sid), sourceDir)
    const ghost = join(sourceDir, `${sid}.jsonl`)
    mkdirSync(sourceDir, { recursive: true })
    setSessionFileForTesting(ghost)

    const destDir = getProjectDir(b)
    mkdirSync(destDir, { recursive: true })
    const destPath = join(destDir, `${sid}.jsonl`)
    writeFileSync(
      destPath,
      `${JSON.stringify({ type: 'user', tag: 'keep' })}\n`,
    )

    setOriginalCwd(b)
    await expect(relocateSessionTranscript()).rejects.toThrow()

    expect(readFileSync(destPath, 'utf8')).toContain('"tag":"keep"')
    expect(existsSync(ghost)).toBe(false)
    expect(supersededSiblings(destDir, sid)).toEqual([])
  })
})
