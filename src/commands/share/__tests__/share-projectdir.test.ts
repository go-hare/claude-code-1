/**
 * Covers the getTranscriptPath projectDir branch (line 127 in share/index.ts).
 *
 * This file mocks src/bootstrap/state.js to return a non-null projectDir,
 * which exercises the if (projectDir) branch of getTranscriptPath.
 *
 * It is isolated in a separate file to avoid state mock contamination.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── child_process mock (gh fails → shows gh not installed) ──
let _execFileImplPD: (
  cmd: string,
  args: string[],
  opts: unknown,
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => void = (_cmd, _args, _opts, cb) => cb(new Error('ENOENT'), '', '')

const execFileMockPD = (
  cmd: string,
  args: string[],
  opts: unknown,
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => _execFileImplPD(cmd, args, opts, cb)

;(execFileMockPD as unknown as Record<symbol, unknown>)[
  promisify.custom as symbol
] = (
  cmd: string,
  args: string[],
  opts: unknown,
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) =>
    _execFileImplPD(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout, stderr })
    }),
  )

// Spread real child_process + gate stub behind useShareProjectdirCpStubs.
// Default OFF: only this suite's beforeAll flips on; afterAll flips off.
// Without spread, every other test in the same `bun test` run that imports
// child_process (e.g. src/services/skillLearning/projectContext.ts which uses
// execFileSync for git) gets our stubs and breaks.
let useShareProjectdirCpStubs = false
mock.module('node:child_process', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require('node:child_process') as Record<string, unknown>
  return {
    ...real,
    default: real,
    execFile: ((...args: unknown[]) =>
      useShareProjectdirCpStubs
        ? (execFileMockPD as (...a: unknown[]) => unknown)(...args)
        : (real.execFile as (...a: unknown[]) => unknown)(
            ...args,
          )) as typeof real.execFile,
    execFileSync: ((...args: unknown[]) =>
      useShareProjectdirCpStubs
        ? Buffer.from('')
        : (real.execFileSync as (...a: unknown[]) => unknown)(
            ...args,
          )) as typeof real.execFileSync,
  }
})

mock.module('bun:bundle', () => ({
  feature: (_name: string) => true,
}))

import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
  stripProtoFields: (v: unknown) => v,
}))

// ── State mock with non-null projectDir (spread real — restore in afterAll) ──
let _mockProjectDir: string | null = null
const realBootstrap = await import('src/bootstrap/state.js')
const bootstrapSnap = snapshotModuleExports(realBootstrap)
const bootstrapOverlay = () => ({
  ...bootstrapSnap,
  getSessionId: () => 'test-session-pd',
  getSessionProjectDir: () => _mockProjectDir,
  getOriginalCwd: () => '/mock/cwd',
  getProjectRoot: () => '/mock/project',
  getCwdState: () => '/mock/cwd',
  getIsNonInteractiveSession: () => false,
  getParentSessionId: () => undefined,
  // Keep real setCwd*/setOriginalCwd/setProjectRoot so pathQuote co-suites work
  // while this mock is still registered mid-suite; afterAll restores fully.
})
mock.module('src/bootstrap/state.js', bootstrapOverlay)
mock.module('../../../bootstrap/state.js', bootstrapOverlay)

// ── State ──
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'share-pd-test-'))
  _execFileImplPD = (_cmd, _args, _opts, cb) => cb(new Error('ENOENT'), '', '')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  _mockProjectDir = null
})

// ── Helpers ──
type CallFn = (args: string) => Promise<{ type: string; value: string }>

async function getCallFn(): Promise<CallFn> {
  const mod = await import('../index.js')
  const loaded = await (
    mod.default as unknown as { load: () => Promise<{ call: CallFn }> }
  ).load()
  return loaded.call.bind(loaded) as CallFn
}

// Gate child_process stub on for this suite only.
beforeAll(() => {
  useShareProjectdirCpStubs = true
})
afterAll(() => {
  useShareProjectdirCpStubs = false
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('../../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
})

describe('share command — getTranscriptPath projectDir branch', () => {
  test('getSessionProjectDir non-null → uses projectDir path (session log not found)', async () => {
    // Set projectDir to tmpDir — session file won't exist → "Session log not found"
    _mockProjectDir = tmpDir
    const call = await getCallFn()
    const result = await call('--private')
    expect(result.type).toBe('text')
    // Since log doesn't exist at projectDir/test-session-pd.jsonl → log not found
    expect(result.value).toContain('Session log not found')
    expect(result.value).toContain('test-session-pd')
  })

  test('getSessionProjectDir non-null + log exists → proceeds past log check', async () => {
    // Write session log at projectDir/test-session-pd.jsonl
    _mockProjectDir = tmpDir
    const logPath = join(tmpDir, 'test-session-pd.jsonl')
    writeFileSync(
      logPath,
      JSON.stringify({ role: 'user', content: 'test' }) + '\n',
    )
    const call = await getCallFn()
    const result = await call('--private')
    expect(result.type).toBe('text')
    // gh fails → shows gh install instructions
    expect(typeof result.value).toBe('string')
    expect(result.value.length).toBeGreaterThan(0)
  })
})
