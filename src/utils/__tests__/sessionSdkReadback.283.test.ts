/**
 * densable 2.1.283 — SDK get_session_info / get_session_messages read local JSONL.
 * parseSessionInfoFromLite skips metadata-only; persistSession flush must land
 * a file with an extractable firstPrompt before process exit.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'
import {
  getSessionInfoImpl,
  getSessionMessagesImpl,
  parseSessionInfoFromLite,
} from '../listSessionsImpl.js'
import {
  canonicalizePath,
  getProjectDir,
  readSessionLite,
} from '../sessionStoragePortable.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.js', analyticsMock)

const {
  flushSessionStorage,
  getTranscriptPath,
  recordTranscript,
  resetProjectForTesting,
} = await import('../sessionStorage.js')
const { createAssistantMessage, createUserMessage } = await import(
  '../messages.js'
)
const { getSessionId, setCwdState, setOriginalCwd, setProjectRoot } =
  await import('../../bootstrap/state.js')

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('QueryEngine persistSession flush (densable 2.1.283)', () => {
  test('result/error paths await flushSessionStorage without eager gate', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../QueryEngine.ts'),
      'utf8',
    )
    expect(src).not.toContain('isEagerFlushEnabled')
    expect(src).toContain('await flushSessionStorage()')
    expect(
      src.match(/await flushSessionStorage\(\)/g)?.length,
    ).toBeGreaterThanOrEqual(5)
  })

  test('P$e nested_marker requires interactive (SDK/print still writes)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../sessionPersistenceStatus.ts'),
      'utf8',
    )
    expect(src).toContain('opts?.interactive ?? getIsInteractive()')
    expect(src).toContain('opts?.isTeammate ?? isTeammate()')
  })
})

describe('parseSessionInfoFromLite densable 2.1.283 SDK summary', () => {
  test('user+assistant jsonl yields extractable summary from firstPrompt', () => {
    const head =
      `{"type":"user","sessionId":"${SID}","cwd":"/p","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"say hello"}}\n` +
      `{"type":"assistant","sessionId":"${SID}","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}\n`
    const info = parseSessionInfoFromLite(
      SID,
      { head, tail: head, mtime: Date.now(), size: head.length },
      '/p',
    )
    expect(info).not.toBeNull()
    expect(info!.summary).toBe('say hello')
    expect(info!.firstPrompt).toBe('say hello')
  })

  test('empty metadata-only jsonl still returns null', () => {
    const head = `{"type":"mode","mode":"default","sessionId":"${SID}"}\n`
    const info = parseSessionInfoFromLite(
      SID,
      { head, tail: head, mtime: Date.now(), size: head.length },
      '/p',
    )
    expect(info).toBeNull()
  })
})

describe('getSessionInfoImpl / getSessionMessagesImpl disk helpers', () => {
  let cfg: string
  let project: string
  const envKeys = ['CLAUDE_CONFIG_DIR'] as const
  const envSnap: Partial<Record<(typeof envKeys)[number], string | undefined>> =
    {}

  beforeEach(async () => {
    for (const k of envKeys) envSnap[k] = process.env[k]
    cfg = mkdtempSync(join(tmpdir(), 'sdk-readback-cfg-'))
    process.env.CLAUDE_CONFIG_DIR = cfg
    project = await canonicalizePath(
      mkdtempSync(join(tmpdir(), 'sdk-readback-proj-')),
    )
    const projectDir = getProjectDir(project)
    mkdirSync(projectDir, { recursive: true })
    const jsonl =
      `{"type":"user","sessionId":"${SID}","cwd":${JSON.stringify(project)},"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"say hello"}}\n` +
      `{"type":"assistant","sessionId":"${SID}","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}\n`
    writeFileSync(join(projectDir, `${SID}.jsonl`), jsonl)
  })

  afterEach(() => {
    for (const k of envKeys) {
      const v = envSnap[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    if (cfg && existsSync(cfg)) rmSync(cfg, { recursive: true, force: true })
    if (project && existsSync(project))
      rmSync(project, { recursive: true, force: true })
  })

  test('getSessionInfoImpl returns summary for on-disk user+assistant jsonl', async () => {
    const info = await getSessionInfoImpl(SID, project)
    expect(info).not.toBeNull()
    expect(info!.summary).toBe('say hello')
  })

  test('getSessionMessagesImpl parses jsonl lines', async () => {
    const msgs = await getSessionMessagesImpl(SID, project)
    expect(msgs).not.toBeNull()
    expect(msgs!.length).toBe(2)
  })

  test('getSessionInfoImpl returns null when file is missing', async () => {
    const missing = await getSessionInfoImpl(
      '11111111-2222-3333-4444-555555555555',
      project,
    )
    expect(missing).toBeNull()
  })
})

describe('recordTranscript + flushSessionStorage materializes jsonl', () => {
  const temps: string[] = []
  const suiteCwd = process.cwd()
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
    const cfg = mkdtempSync(join(tmpdir(), 'sdk-flush-cfg-'))
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

  test('after recordTranscript + flushSessionStorage, file size > 0', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sdk-flush-cwd-'))
    temps.push(cwd)
    setOriginalCwd(cwd)
    setProjectRoot(cwd)
    setCwdState(cwd)

    const user = createUserMessage({ content: 'say hello' })
    const assistant = createAssistantMessage({ content: 'hello' })
    await recordTranscript([user, assistant])
    await flushSessionStorage()

    const path = getTranscriptPath()
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).size).toBeGreaterThan(0)

    const lite = await readSessionLite(path)
    expect(lite).not.toBeNull()
    const parsed = parseSessionInfoFromLite(getSessionId(), lite!, cwd)
    expect(parsed).not.toBeNull()
    expect(parsed!.summary).toBe('say hello')
  })
})
