/**
 * densable mGw apply-file — y0t / jge / wHe / Hqi (no envelope unwrap).
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import { createHash } from 'crypto'
import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import {
  getCwdState,
  getOriginalCwd,
  getProjectRoot,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../../bootstrap/state.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import type { LocalCommandCall } from '../../../types/command.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
  stripProtoFields: <T>(v: T) => v,
}))

afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
})

const { call } = await import('../headless.js')

const TEST_ROOT = join(
  tmpdir(),
  `claude-auto-mode-setup-apply-${process.pid}-${Date.now()}`,
)

const VALID_BODY = {
  environment: [
    '### Org-wide',
    '**Organization**: example',
    '### User-specific',
    '**Primary use of Claude Code**: development',
  ],
  allow: [],
  soft_deny: [],
  hard_deny: [],
  remove_from_permissions_allow: [],
  notes: [],
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function permissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  } as ToolPermissionContext
}

function makeContext(
  ctx: ToolPermissionContext = permissionContext(),
): Parameters<LocalCommandCall>[1] {
  return {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext: ctx }),
    setMessages: () => {},
    options: { ideInstallationStatus: null, theme: 'dark' },
    onChangeAPIKey: () => {},
  } as unknown as Parameters<LocalCommandCall>[1]
}

async function applyFile(
  filePath: string,
  expected: string,
  extra = '',
  ctx?: ToolPermissionContext,
): Promise<Record<string, unknown>> {
  const result = await call(
    `${extra}--expect-sha256 ${expected} --apply-file ${filePath}`.trim(),
    makeContext(ctx),
  )
  expect(result.type).toBe('text')
  if (result.type !== 'text') return {}
  return JSON.parse(result.value) as Record<string, unknown>
}

describe('mGw apply-file (densable y0t/jge/wHe/Hqi)', () => {
  let prevConfigDir: string | undefined
  let prevCwd: string
  let prevOriginal: string
  let prevProject: string
  const suiteCwd = process.cwd()

  beforeEach(() => {
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
      prevCwd = getCwdState()
    } catch {
      prevCwd = suiteCwd
    }
    try {
      prevOriginal = getOriginalCwd()
    } catch {
      prevOriginal = suiteCwd
    }
    try {
      prevProject = getProjectRoot()
    } catch {
      prevProject = suiteCwd
    }
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(TEST_ROOT, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = TEST_ROOT
    setCwdState(TEST_ROOT)
    setOriginalCwd(TEST_ROOT)
    setProjectRoot(TEST_ROOT)
    resetSettingsCache()
  })

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    try {
      setCwdState(prevCwd ?? suiteCwd)
      setOriginalCwd(prevOriginal ?? suiteCwd)
      setProjectRoot(prevProject ?? suiteCwd)
    } catch {
      // ignore
    }
    resetSettingsCache()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  test('gold-shaped top-level mode/scope applies', async () => {
    const body = JSON.stringify({
      ...VALID_BODY,
      mode: 'replace',
      scope: 'project',
    })
    const filePath = join(TEST_ROOT, 'proposal.json')
    writeFileSync(filePath, body)
    const result = await applyFile(
      filePath,
      sha256(body),
      '--apply-target project ',
    )
    expect(result.ok).toBe(true)
    expect(result.target).toBe('project')
    const written = JSON.parse(
      readFileSync(join(TEST_ROOT, 'settings.json'), 'utf-8'),
    ) as { autoMode: { environment: string[] } }
    expect(written.autoMode.environment).toContain('**Organization**: example')
  })

  test('{ok, proposal} envelope is parse_failed (no unwrap invent)', async () => {
    const body = JSON.stringify({ ok: true, proposal: VALID_BODY })
    const filePath = join(TEST_ROOT, 'envelope.json')
    writeFileSync(filePath, body)
    const result = await applyFile(filePath, sha256(body))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('parse_failed')
    expect(String(result.reason)).toContain('doesn’t contain a proposal')
  })

  test('deny Read(denied.json) → read_denied', async () => {
    const body = JSON.stringify(VALID_BODY)
    const filePath = join(TEST_ROOT, 'denied.json')
    writeFileSync(filePath, body)
    const result = await applyFile(
      filePath,
      sha256(body),
      '',
      permissionContext({
        alwaysDenyRules: { session: ['Read(denied.json)'] },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('read_denied')
    expect(String(result.reason)).toContain('permissions.deny read rule')
  })

  test('symlink → read_failed (O_NOFOLLOW)', async () => {
    const body = JSON.stringify(VALID_BODY)
    const target = join(TEST_ROOT, 'real.json')
    const linkPath = join(TEST_ROOT, 'link.json')
    writeFileSync(target, body)
    try {
      symlinkSync(target, linkPath)
    } catch {
      // Windows without Developer Mode / privilege: skip
      return
    }
    const result = await applyFile(linkPath, sha256(body))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('read_failed')
  })

  test('hardlink nlink>1 → read_failed', async () => {
    const body = JSON.stringify(VALID_BODY)
    const filePath = join(TEST_ROOT, 'hard.json')
    const other = join(TEST_ROOT, 'hard-other.json')
    writeFileSync(filePath, body)
    try {
      linkSync(filePath, other)
    } catch {
      // Filesystem may not support hardlinks
      return
    }
    const result = await applyFile(filePath, sha256(body))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('read_failed')
  })

  test('network UNC → bad_path (y0t)', async () => {
    const unc = '//nas/share/proposal.json'
    const result = await applyFile(unc, 'a'.repeat(64))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('bad_path')
    expect(String(result.reason)).toContain('system temp directory')
  })
})
