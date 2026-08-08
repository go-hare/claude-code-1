/**
 * densable 2.1.218 #28 — /cd resolve + E7p/pVo/cVo/Srd + trust-root helpers.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
  stripProtoFields: <T>(v: T) => v,
}))

const {
  resolveCdTarget,
  isDirectoryTrusted,
  acceptTrustForDirectory,
  projectTrustConfigKey,
  rehomeBgJobCwd,
  relocateSessionCwd,
  handleSetCwdControlRequest,
  buildSetCwdMoveNoticeCommand,
} = await import('../cdCommand.js')
const {
  checkCdPermission,
  cdRuleRefusalMessage,
  cdPathGlobToRegExp,
  hasUnsafePathChars,
  CD_TOOL_NAME,
  safeWireMessage,
  rewriteCdAllowPath,
  getCdPathRewriteMap,
  resetCdPathRewriteMapForTests,
} = await import('../cdPermission.js')
const { formatCdRepoTrustNote } = await import(
  '../../../components/TrustDialog/trustDialogCopy.js'
)
const { setCwdState } = await import('../../../bootstrap/state.js')
const { writeBgJobState, readBgJobState } = await import(
  '../../../daemon/jobState.js'
)
const { isFilePatternTool } = await import(
  '../../../utils/settings/toolValidationConfig.js'
)
const { isPathTrusted } = await import('../../../utils/config.js')

const temps: string[] = []
const envKeys = [
  'CLAUDE_JOB_DIR',
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_BG_SHORT',
  'CLAUDE_CONFIG_DIR',
] as const
const envSnap: Partial<Record<(typeof envKeys)[number], string | undefined>> =
  {}

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
})

function snapEnv(key: (typeof envKeys)[number]): void {
  if (!(key in envSnap)) envSnap[key] = process.env[key]
}

describe('resolveCdTarget (densable dVo)', () => {
  test('not_found for missing path', async () => {
    const r = await resolveCdTarget('/tmp/definitely-missing-cd-218-xyz')
    expect(r.result).toBe('not_found')
  })

  test('not_a_directory for file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-218-'))
    temps.push(dir)
    const file = join(dir, 'f.txt')
    writeFileSync(file, 'x')
    const r = await resolveCdTarget(file)
    expect(r.result).toBe('not_a_directory')
  })

  test('same when already there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-218-same-'))
    temps.push(dir)
    const { realpath } = await import('fs/promises')
    const canonical = await realpath(dir)
    setCwdState(canonical)
    const r = await resolveCdTarget(canonical)
    expect(r.result).toBe('same')
  })

  test('ok for other directory', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-218-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-218-b-'))
    temps.push(a, b)
    setCwdState(a)
    const r = await resolveCdTarget(b)
    expect(r.result).toBe('ok')
    if (r.result === 'ok') {
      expect(r.directory).toContain('cd-218-b-')
    }
  })

  test('unsafe_path when path has narrow no-break space', async () => {
    // densable cVo rejects \u202F (macOS screenshot folder spacing)
    const base = mkdtempSync(join(tmpdir(), 'cd-218-unsafe-'))
    temps.push(base)
    const unsafeName = `Screenshots\u202FFolder`
    const unsafeDir = join(base, unsafeName)
    mkdirSync(unsafeDir)
    setCwdState(base)
    const r = await resolveCdTarget(unsafeDir)
    expect(r.result).toBe('unsafe_path')
  })

  test('blocked_by_rule when deny Cd()', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-218-deny-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-218-deny-b-'))
    temps.push(a, b)
    setCwdState(a)
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        userSettings: [CD_TOOL_NAME],
      },
    }
    const r = await resolveCdTarget(b, ctx)
    expect(r.result).toBe('blocked_by_rule')
    if (r.result === 'blocked_by_rule') {
      expect(r.check.result).toBe('blockedByRule')
      const msg = cdRuleRefusalMessage(r.directory, r.check)
      expect(msg).toContain("Can't move to")
      expect(msg).toContain('/cd is turned off')
      expect(msg).toContain('user settings')
    }
  })

  test('blocked_by_rule outside allow Cd(pattern)', async () => {
    // densable session-root patterns are cwd-relative (not absolute FS paths).
    // Use children under one base so Cd(ok/**) matches via patternWithRoot(session).
    // realpath base/cwd so macOS /var → /private/var matches dVo canonical paths.
    const { realpath } = await import('fs/promises')
    const baseRaw = mkdtempSync(join(tmpdir(), 'cd-218-allow-base-'))
    temps.push(baseRaw)
    const base = await realpath(baseRaw)
    const allowed = join(base, 'ok')
    const blocked = join(base, 'no')
    mkdirSync(allowed)
    mkdirSync(blocked)
    setCwdState(base)
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        session: [`${CD_TOOL_NAME}(ok/**)`],
      },
    }
    const ok = await resolveCdTarget(allowed, ctx)
    expect(ok.result).toBe('ok')
    const no = await resolveCdTarget(blocked, ctx)
    expect(no.result).toBe('blocked_by_rule')
    if (no.result === 'blocked_by_rule') {
      expect(no.check.result).toBe('outsideAllowedPatterns')
      const msg = cdRuleRefusalMessage(no.directory, no.check)
      expect(msg).toContain('limited to directories matching')
    }
  })
})

describe('cdPermission helpers (densable E7p/dCb/cVo)', () => {
  test('Cd is a filePatternTool', () => {
    expect(isFilePatternTool('Cd')).toBe(true)
  })

  test('hasUnsafePathChars matches densable cVo', () => {
    expect(hasUnsafePathChars('/safe/path')).toBe(false)
    expect(hasUnsafePathChars('a\u202Fb')).toBe(true)
    expect(hasUnsafePathChars('a\u2800b')).toBe(true)
    expect(hasUnsafePathChars('a\u0000b')).toBe(true)
  })

  test('cdPathGlobToRegExp ** prefix and segment *', () => {
    const re = cdPathGlobToRegExp('src/**')
    expect(re.test('src')).toBe(true)
    expect(re.test('src/a/b')).toBe(true)
    expect(re.test('lib/a')).toBe(false)
    const star = cdPathGlobToRegExp('pkg/*/lib')
    expect(star.test('pkg/foo/lib')).toBe(true)
    expect(star.test('pkg/foo/bar/lib')).toBe(false)
  })

  test('checkCdPermission deny wins over allow', () => {
    // Bare Cd deny (ruleContent undefined) blocks any path; allow-all does not override.
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        userSettings: [CD_TOOL_NAME],
      },
      alwaysAllowRules: {
        session: [CD_TOOL_NAME],
      },
    }
    const r = checkCdPermission(
      { requestedPath: '/tmp/x', canonicalPath: '/tmp/x' },
      ctx,
    )
    expect(r.result).toBe('blockedByRule')
  })

  test('checkCdPermission relative pattern deny', () => {
    const base = mkdtempSync(join(tmpdir(), 'cd-218-deny-pat-'))
    temps.push(base)
    const secret = join(base, 'secret')
    mkdirSync(secret)
    setCwdState(base)
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        session: [`${CD_TOOL_NAME}(secret/**)`],
      },
    }
    const r = checkCdPermission(
      { requestedPath: secret, canonicalPath: secret },
      ctx,
    )
    expect(r.result).toBe('blockedByRule')
    const open = checkCdPermission(
      { requestedPath: base, canonicalPath: base },
      ctx,
    )
    // base itself is not under secret/** — allowed (no allow-list)
    expect(open.result).toBe('allowed')
  })

  test('Idn/QOy rewriteCdAllowPath private→public when realpath gates', () => {
    resetCdPathRewriteMapForTests()
    const map = getCdPathRewriteMap()
    // On macOS, /tmp realpaths to /private/tmp so QOy includes that pair.
    if (map.has('/private/tmp')) {
      expect(rewriteCdAllowPath('/private/tmp')).toBe('/tmp')
      expect(rewriteCdAllowPath('/private/tmp/foo')).toBe('/tmp/foo')
      expect(rewriteCdAllowPath('/private/tmpish')).toBe('/private/tmpish')
    } else {
      // Non-macOS or missing /tmp: Idn is identity
      expect(rewriteCdAllowPath('/private/tmp/foo')).toBe('/private/tmp/foo')
    }
    // Unrelated paths never rewrite
    expect(rewriteCdAllowPath('/Users/x')).toBe('/Users/x')
  })
})

describe('rehomeBgJobCwd (densable Srd)', () => {
  test('no-op without CLAUDE_JOB_DIR / SESSION_KIND=bg', () => {
    snapEnv('CLAUDE_JOB_DIR')
    snapEnv('CLAUDE_CODE_SESSION_KIND')
    delete process.env.CLAUDE_JOB_DIR
    delete process.env.CLAUDE_CODE_SESSION_KIND
    // should not throw
    rehomeBgJobCwd('/tmp/anywhere')
  })

  test('patches cwd/originCwd for bg job state', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'cd-218-jobcfg-'))
    temps.push(configDir)
    snapEnv('CLAUDE_CONFIG_DIR')
    snapEnv('CLAUDE_JOB_DIR')
    snapEnv('CLAUDE_CODE_SESSION_KIND')
    snapEnv('CLAUDE_BG_SHORT')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const short = 'cd218srd'
    const jobDir = join(configDir, 'jobs', short)
    mkdirSync(jobDir, { recursive: true })
    process.env.CLAUDE_JOB_DIR = jobDir
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_BG_SHORT = short

    writeBgJobState(short, {
      state: 'working',
      detail: '',
      tempo: 'active',
      intent: 'test',
      sessionId: '00000000-0000-4000-8000-000000000001',
      cwd: '/old/cwd',
      originCwd: '/old/cwd',
      template: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      firstTerminalAt: null,
      output: null,
      children: null,
      respawnFlags: [],
    })

    const next = '/new/cwd/path'
    rehomeBgJobCwd(next)
    const st = readBgJobState(short)
    expect(st?.cwd).toBe(next)
    expect(st?.originCwd).toBe(next)
  })

  test('preserves originCwd when worktreePath is set', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'cd-218-jobwt-'))
    temps.push(configDir)
    snapEnv('CLAUDE_CONFIG_DIR')
    snapEnv('CLAUDE_JOB_DIR')
    snapEnv('CLAUDE_CODE_SESSION_KIND')
    snapEnv('CLAUDE_BG_SHORT')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const short = 'cd218wt'
    const jobDir = join(configDir, 'jobs', short)
    mkdirSync(jobDir, { recursive: true })
    process.env.CLAUDE_JOB_DIR = jobDir
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_BG_SHORT = short

    writeBgJobState(short, {
      state: 'working',
      detail: '',
      tempo: 'active',
      intent: 'test',
      sessionId: '00000000-0000-4000-8000-000000000002',
      cwd: '/wt/path',
      originCwd: '/origin/repo',
      worktreePath: '/wt/path',
      template: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      firstTerminalAt: null,
      output: null,
      children: null,
      respawnFlags: [],
    })

    rehomeBgJobCwd('/wt/path/subdir')
    const st = readBgJobState(short)
    expect(st?.cwd).toBe('/wt/path/subdir')
    expect(st?.originCwd).toBe('/origin/repo')
  })
})

describe('relocateSessionCwd (densable fVo)', () => {
  test('returns transcriptRelocated true (tNt wired) + system-reminder wrap', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-218-reloc-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-218-reloc-b-'))
    temps.push(a, b)
    setCwdState(a)
    process.chdir(a)
    // no materialised sessionFile → tNt short-circuit still succeeds
    const r = await relocateSessionCwd(b, 'cd_command')
    expect(r.transcriptRelocated).toBe(true)
    expect(r.modelMessage).toContain('<system-reminder>')
    expect(r.modelMessage).toContain("session's working directory has changed")
    expect(r.modelMessage).toContain('via /cd')
    expect(r.modelMessage).toContain('</system-reminder>')
    // restore cwd for other tests
    process.chdir(a)
    setCwdState(a)
  })

  test('set_cwd source uses "by the user" via text', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-218-reloc2-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-218-reloc2-b-'))
    temps.push(a, b)
    setCwdState(a)
    process.chdir(a)
    const r = await relocateSessionCwd(b, 'set_cwd')
    expect(r.modelMessage).toContain('by the user')
    process.chdir(a)
    setCwdState(a)
  })
})

describe('handleSetCwdControlRequest (densable fCb)', () => {
  test('busy rejects without moving', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-218-busy-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-218-busy-b-'))
    temps.push(a, b)
    setCwdState(a)
    process.chdir(a)
    const notices: string[] = []
    const r = await handleSetCwdControlRequest(
      { subtype: 'set_cwd', path: b },
      {
        isBusy: () => true,
        toolPermissionContext: getEmptyToolPermissionContext(),
        enqueueMoveNotice: m => notices.push(m),
      },
    )
    expect(r.kind).toBe('response')
    if (r.kind === 'response') {
      expect(r.response.status).toBe('rejected')
      if (r.response.status === 'rejected') {
        expect(r.response.reason).toBe('busy')
      }
    }
    expect(notices).toHaveLength(0)
  })

  test('invalid empty path', async () => {
    const r = await handleSetCwdControlRequest(
      { subtype: 'set_cwd', path: '   ' },
      {
        isBusy: () => false,
        toolPermissionContext: getEmptyToolPermissionContext(),
        enqueueMoveNotice: () => {},
      },
    )
    expect(r.kind).toBe('invalid')
  })

  test('trust_accepted without trusted_directory is invalid', async () => {
    const r = await handleSetCwdControlRequest(
      { subtype: 'set_cwd', path: '/tmp', trust_accepted: true },
      {
        isBusy: () => false,
        toolPermissionContext: getEmptyToolPermissionContext(),
        enqueueMoveNotice: () => {},
      },
    )
    expect(r.kind).toBe('invalid')
  })

  test('same directory → ok changed:false transcript_relocated:true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-218-same-set-'))
    temps.push(dir)
    const { realpath } = await import('fs/promises')
    const canonical = await realpath(dir)
    setCwdState(canonical)
    process.chdir(canonical)
    const r = await handleSetCwdControlRequest(
      { subtype: 'set_cwd', path: canonical },
      {
        isBusy: () => false,
        toolPermissionContext: getEmptyToolPermissionContext(),
        enqueueMoveNotice: () => {},
      },
    )
    expect(r.kind).toBe('response')
    if (r.kind === 'response' && r.response.status === 'ok') {
      expect(r.response.changed).toBe(false)
      expect(r.response.transcript_relocated).toBe(true)
      expect(r.response.cwd).toBe(canonical)
    } else {
      throw new Error('expected ok')
    }
  })

  test('untrusted target → needs_trust', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-218-needstrust-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-218-needstrust-b-'))
    temps.push(a, b)
    setCwdState(a)
    process.chdir(a)
    // ensure not trusted
    expect(isDirectoryTrusted(b)).toBe(false)
    const r = await handleSetCwdControlRequest(
      { subtype: 'set_cwd', path: b },
      {
        isBusy: () => false,
        toolPermissionContext: getEmptyToolPermissionContext(),
        enqueueMoveNotice: () => {},
      },
    )
    expect(r.kind).toBe('response')
    if (r.kind === 'response') {
      expect(r.response.status).toBe('needs_trust')
      if (r.response.status === 'needs_trust') {
        expect(r.response.directory).toContain('cd-218-needstrust-b-')
      }
    }
  })

  test('not_found rejected', async () => {
    const r = await handleSetCwdControlRequest(
      {
        subtype: 'set_cwd',
        path: '/tmp/definitely-missing-setcwd-218-xyz',
      },
      {
        isBusy: () => false,
        toolPermissionContext: getEmptyToolPermissionContext(),
        enqueueMoveNotice: () => {},
      },
    )
    expect(r.kind).toBe('response')
    if (r.kind === 'response' && r.response.status === 'rejected') {
      expect(r.response.reason).toBe('not_found')
    } else {
      throw new Error('expected rejected not_found')
    }
  })

  test('buildSetCwdMoveNoticeCommand is meta prompt', () => {
    const cmd = buildSetCwdMoveNoticeCommand('hello move')
    expect(cmd.mode).toBe('prompt')
    expect(cmd.isMeta).toBe(true)
    expect(cmd.skipSlashCommands).toBe(true)
    expect(cmd.value).toBe('hello move')
    expect(cmd.uuid).toBeTruthy()
  })

  test('safeWireMessage substitutes on unsafe text', () => {
    expect(safeWireMessage('ok path', 'fb')).toBe('ok path')
    expect(safeWireMessage('a\u202Fb', 'fb')).toBe('fb')
  })
})

describe('Cd trust copy (densable CdTrustPrompt)', () => {
  test('formatCdRepoTrustNote matches densable sentence', () => {
    const s = formatCdRepoTrustNote('/repo')
    expect(s).toBe(
      'This directory is part of the repository at /repo. Trusting it trusts that whole repository, including its other worktrees and subdirectories.',
    )
  })

  test('isDirectoryTrusted false for synthetic untrusted path', () => {
    expect(isDirectoryTrusted(`/tmp/untrusted-cd-218-${Date.now()}`)).toBe(
      false,
    )
  })

  test('Omt/EUe: aq key latch is visible to isDirectoryTrusted', () => {
    const d = mkdtempSync(join(tmpdir(), 'cd-218-omt-'))
    temps.push(d)
    const key = projectTrustConfigKey(d)
    expect(key.includes('\\')).toBe(false)
    acceptTrustForDirectory(d)
    // densable EUe: first probe hits aq(d) even when ancestor walk would miss
    // (e.g. canonical git root key ≠ resolve walk on macOS /var vs /private/var).
    expect(isDirectoryTrusted(d)).toBe(true)
    // skipCanonicalKeyProbe forces ancestor walk only — may be false when the
    // latch lives solely under aq; still equals isPathTrusted(d).
    expect(isDirectoryTrusted(d, { skipCanonicalKeyProbe: true })).toBe(
      isPathTrusted(d),
    )
  })
})
