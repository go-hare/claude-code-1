/**
 * densable 2.1.224 #1 residual — njv / WJl / G2h / oBh / YMt / F2h / rjv.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HOST_SEED_WRITE_TIMEOUT_MS,
  KW_PATH_BYTE_LIMIT,
  SESSION_SEED_FS_TIMEOUT_MS,
  assertConfigDirOutsideGlobalTemp,
  claudeConfigFileSuffix,
  densableF2tResolved,
  densableKwTempDir,
  densableSgResolved,
  resolveChildCwdAndAddDirs,
  resolveUnderSessionRoot,
  seedHostConfigIntoSession,
  seedPersistedWorkspaceTrust,
  writeDebugTokenFile,
  writeGovernedGitconfigSeed,
  writeRemoteMcpConfig,
  writeSessionIngressToken,
} from '../sessionSeed.js'
import type { HostConfigSnapshot } from '../hostConfig.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
})

function tmp(): string {
  const d = join(
    tmpdir(),
    `shr-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('densable 2.1.224 #1 sessionSeed (YMt/oBh/G2h)', () => {
  test('claudeConfigFileSuffix (YMt)', () => {
    expect(claudeConfigFileSuffix()).toBe('')
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL = 'https://oauth.example'
    expect(claudeConfigFileSuffix()).toBe('-custom-oauth')
  })

  test('resolveUnderSessionRoot (oBh) blocks escape', () => {
    const root = '/tmp/session-root'
    expect(resolveUnderSessionRoot(root, 'repo')).toBe(join(root, 'repo'))
    expect(resolveUnderSessionRoot(root, root)).toBe(root)
    expect(resolveUnderSessionRoot(root, '/etc/passwd')).toBeNull()
    expect(resolveUnderSessionRoot(root, '../escape')).toBeNull()
  })

  test('resolveChildCwdAndAddDirs (G2h)', () => {
    const root = '/ws/_sessions/s1'
    const a = `${root}/a`
    const b = `${root}/b`
    expect(resolveChildCwdAndAddDirs(root, [a], `${root}/a`)).toEqual({
      childCwd: a,
      addDirs: [a, root],
    })
    expect(resolveChildCwdAndAddDirs(root, [a])).toEqual({
      childCwd: a,
      addDirs: [a, root],
    })
    expect(resolveChildCwdAndAddDirs(root, [a, b])).toEqual({
      childCwd: root,
      addDirs: [a, b],
    })
    expect(resolveChildCwdAndAddDirs(root, [])).toEqual({
      childCwd: root,
      addDirs: [],
    })
    expect(SESSION_SEED_FS_TIMEOUT_MS).toBe(10_000)
    expect(HOST_SEED_WRITE_TIMEOUT_MS).toBe(60_000)
  })
})

describe('densable 2.1.224 #1 sessionSeed (WJl/njv/F2h/rjv)', () => {
  test('writeSessionIngressToken (WJl)', async () => {
    const dir = tmp()
    const path = join(dir, 'nested', 'session-token')
    const ok = await writeSessionIngressToken(path, 'tok-abc', () => {})
    expect(ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('tok-abc')
  })

  test('seedHostConfigIntoSession (njv)', async () => {
    const dir = tmp()
    const snap: HostConfigSnapshot = {
      sourceDir: '/host/.claude',
      files: new Map([
        ['settings.json', { buf: Buffer.from('{"x":1}'), mode: 0o600 }],
      ]),
      mcpServers: { local: { command: 'echo' } },
    }
    const debug: string[] = []
    await seedHostConfigIntoSession(
      dir,
      snap,
      m => debug.push(m),
      () => {},
    )
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{"x":1}')
    expect(JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf8'))).toEqual(
      { mcpServers: { local: { command: 'echo' } } },
    )
    expect(debug.some(m => m.includes('Seeded'))).toBe(true)
  })

  test('writeDebugTokenFile (F2h) + writeGovernedGitconfigSeed (rjv)', async () => {
    const dir = tmp()
    await writeDebugTokenFile(dir, 'jwt.txt', 'eyJ', () => {})
    expect(readFileSync(join(dir, 'jwt.txt'), 'utf8')).toBe('eyJ')
    // densable rBh: F2h(j, `session_token_${e}.jwt`, tt.session_token, d)
    await writeDebugTokenFile(
      dir,
      'session_token_sess-1.jwt',
      'sess.jwt',
      () => {},
    )
    expect(readFileSync(join(dir, 'session_token_sess-1.jwt'), 'utf8')).toBe(
      'sess.jwt',
    )
    const gc = join(dir, 'session.gitconfig')
    await writeGovernedGitconfigSeed(gc, '[user]\n\tname = Claude\n')
    expect(readFileSync(gc, 'utf8')).toContain('Claude')
  })
})

describe('densable 2.1.224 #1 sessionSeed (D trust + sG/Kw/f2t + mcp_config)', () => {
  test('seedPersistedWorkspaceTrust (D) writes projects + host mcpServers', async () => {
    const dir = tmp()
    const repo = join(dir, 'repo')
    mkdirSync(repo, { recursive: true })
    const debug: string[] = []
    await seedPersistedWorkspaceTrust({
      configDir: dir,
      trustPaths: [repo, repo],
      hostMcpServers: { local: { command: 'echo' } },
      onDebug: m => debug.push(m),
    })
    const parsed = JSON.parse(
      readFileSync(join(dir, '.claude.json'), 'utf8'),
    ) as {
      projects: Record<string, { hasTrustDialogAccepted: boolean }>
      mcpServers?: Record<string, unknown>
    }
    expect(parsed.mcpServers).toEqual({ local: { command: 'echo' } })
    const keys = Object.keys(parsed.projects)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      expect(parsed.projects[k]?.hasTrustDialogAccepted).toBe(true)
    }
    expect(debug.some(m => m.includes('Seeded persisted trust'))).toBe(true)
  })

  test('seedPersistedWorkspaceTrust honors custom oauth suffix (Xqv)', async () => {
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL = 'https://oauth.example'
    const dir = tmp()
    await seedPersistedWorkspaceTrust({
      configDir: dir,
      trustPaths: [dir],
      configSuffix: claudeConfigFileSuffix(),
      onDebug: () => {},
    })
    expect(
      readFileSync(join(dir, '.claude-custom-oauth.json'), 'utf8'),
    ).toContain('hasTrustDialogAccepted')
  })

  test('writeRemoteMcpConfig base64 → mcp-config.json (wx 0600)', async () => {
    const dir = tmp()
    const body = JSON.stringify({ mcpServers: { x: { command: 'true' } } })
    const b64 = Buffer.from(body, 'utf8').toString('base64')
    const debug: string[] = []
    const path = await writeRemoteMcpConfig(dir, b64, m => debug.push(m))
    expect(path).toBe(join(dir, 'mcp-config.json'))
    expect(readFileSync(path, 'utf8')).toBe(body)
    expect(debug.some(m => m.includes('Wrote MCP config'))).toBe(true)
  })

  test('assertConfigDirOutsideGlobalTemp (sG/Kw/f2t EKn)', () => {
    expect(KW_PATH_BYTE_LIMIT).toBe(44)
    const kw = densableKwTempDir()
    const sg = densableSgResolved()
    const f2t = densableF2tResolved()
    expect(kw.includes('claude-')).toBe(true)
    expect(sg.length).toBeGreaterThan(0)
    expect(f2t.length).toBeGreaterThan(0)
    // normal session config under /workspace is fine
    expect(() =>
      assertConfigDirOutsideGlobalTemp('/workspace/_sessions/s1.claude-config'),
    ).not.toThrow()
    // config nested under Kw must refuse
    expect(() =>
      assertConfigDirOutsideGlobalTemp(join(kw, 'evil-session-config')),
    ).toThrow(/overlaps the child's auto-allowed write scope/)
  })
})
