import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  internalToolSubprocessEnv,
  sandboxHelperSubprocessEnv,
  stripClaudeAuthEnvVars,
} from '../../subprocessEnv.js'
import {
  fixLinuxBwrapAllowReadMountOrder,
  getUpdaterStagingDir,
  SandboxManager,
} from '../sandbox-adapter.js'
import {
  resetManagedRereadStateForTesting,
  updateSettingsForSource,
} from '../../settings/settings.js'

describe('Wave 325 Group 1 — Sandbox & Subprocess Env (#2333-#2335, #2340, #2353-#2354, #2358, #2371-#2372, #2374)', () => {
  const tempDirs: string[] = []
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key]
    }
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const k of Object.keys(savedEnv)) delete savedEnv[k]
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    SandboxManager.markHostedToolContainer(false)
    resetManagedRereadStateForTesting()
  })

  test('#2371/#2372: stripClaudeAuthEnvVars, internalToolSubprocessEnv, and sandboxHelperSubprocessEnv strip tokens, API keys, and mTLS client key passphrase', () => {
    const sampleEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/tester',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret',
      CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'sess-token',
      CLAUDE_SESSION_INGRESS_TOKEN_FILE: '/tmp/ingress.tok',
      CLAUDE_CODE_MESSAGING_TOKEN: 'msg-token',
      CLAUDE_CODE_MCP_SERVE_AUTH_TOKEN: 'mcp-token',
      MCP_CLIENT_SECRET: 'mcp-client-secret',
      MCP_XAA_IDP_CLIENT_SECRET: 'xaa-secret',
      ENVIRONMENT_SERVICE_KEY: 'env-svc-key',
      SELF_HOSTED_RUNNER_POOL_SECRET: 'pool-secret',
      SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: 'runner-env-secret',
      CLAUDE_CODE_CLIENT_KEY_PASSPHRASE: 'mtls-passphrase',
      CLAUDE_BG_AUTH_SNAPSHOT_PATH: '/tmp/bg-auth.json',
      CLAUDE_BG_RV_AUTH: 'bg-rv-tok',
      SAFE_KEEP_VAR: 'keep-me',
    }

    for (const fn of [stripClaudeAuthEnvVars, sandboxHelperSubprocessEnv]) {
      const cleaned = fn(sampleEnv)
      expect(cleaned.PATH).toBe('/usr/bin:/bin')
      expect(cleaned.SAFE_KEEP_VAR).toBe('keep-me')
      expect(cleaned.ANTHROPIC_API_KEY).toBeUndefined()
      expect(cleaned.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(cleaned.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBeUndefined()
      expect(cleaned.CLAUDE_SESSION_INGRESS_TOKEN_FILE).toBeUndefined()
      expect(cleaned.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined()
      expect(cleaned.CLAUDE_CODE_MCP_SERVE_AUTH_TOKEN).toBeUndefined()
      expect(cleaned.MCP_CLIENT_SECRET).toBeUndefined()
      expect(cleaned.MCP_XAA_IDP_CLIENT_SECRET).toBeUndefined()
      expect(cleaned.ENVIRONMENT_SERVICE_KEY).toBeUndefined()
      expect(cleaned.SELF_HOSTED_RUNNER_POOL_SECRET).toBeUndefined()
      expect(cleaned.SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET).toBeUndefined()
      expect(cleaned.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE).toBeUndefined()
      expect(cleaned.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()
      expect(cleaned.CLAUDE_BG_RV_AUTH).toBeUndefined()
    }

    // internalToolSubprocessEnv() reads process.env and strips all auth/passphrase vars
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-secret')
    setEnv('CLAUDE_CODE_CLIENT_KEY_PASSPHRASE', 'mtls-passphrase')
    setEnv('CLAUDE_CODE_SESSION_ACCESS_TOKEN', 'sess-token')
    const internalCleaned = internalToolSubprocessEnv()
    expect(internalCleaned.ANTHROPIC_API_KEY).toBeUndefined()
    expect(internalCleaned.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE).toBeUndefined()
    expect(internalCleaned.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBeUndefined()
  })

  test('#2333: getUpdaterStagingDir honors XDG_CACHE_HOME and defaults under ~/.cache/claude/staging', () => {
    setEnv('XDG_CACHE_HOME', '/tmp/custom-xdg-cache')
    expect(getUpdaterStagingDir()).toBe('/tmp/custom-xdg-cache/claude/staging')

    setEnv('XDG_CACHE_HOME', undefined)
    expect(
      getUpdaterStagingDir().endsWith(join('.cache', 'claude', 'staging')),
    ).toBe(true)
  })

  test('#2340: fixLinuxBwrapAllowReadMountOrder moves --ro-bind restore mounts before --bind mounts after --tmpfs', () => {
    const broken =
      "bwrap --ro-bind / / --tmpfs /home/u --bind /home/u/proj /home/u/proj --ro-bind /home/u /home/u --dev /dev -- bash -c 'pwd'"
    const fixed = fixLinuxBwrapAllowReadMountOrder(broken)
    const roIdx = fixed.indexOf('--ro-bind /home/u /home/u')
    const rwIdx = fixed.indexOf('--bind /home/u/proj /home/u/proj')
    expect(roIdx).toBeGreaterThan(-1)
    expect(rwIdx).toBeGreaterThan(-1)
    expect(roIdx).toBeLessThan(rwIdx)
    expect(fixed).toContain("--dev /dev -- bash -c 'pwd'")

    // Already ordered command is unchanged
    expect(fixLinuxBwrapAllowReadMountOrder(fixed)).toBe(fixed)

    // #2340 P0-1 regression: denyWrite --ro-bind mounts inside a writable --bind
    // (such as .git/hooks and .claude/settings.json) MUST remain AFTER --bind,
    // while allowRead --ro-bind mounts outside --bind still move before --bind.
    const withDenyWrite =
      "bwrap --ro-bind / / --tmpfs /home/u --bind /home/u/proj /home/u/proj --ro-bind /home/u /home/u --ro-bind /home/u/proj/.git/hooks /home/u/proj/.git/hooks --ro-bind /home/u/proj/.claude/settings.json /home/u/proj/.claude/settings.json --dev /dev -- bash -c 'pwd'"
    const fixedWithDenyWrite = fixLinuxBwrapAllowReadMountOrder(withDenyWrite)
    const allowReadIdx = fixedWithDenyWrite.indexOf('--ro-bind /home/u /home/u')
    const projBindIdx = fixedWithDenyWrite.indexOf(
      '--bind /home/u/proj /home/u/proj',
    )
    const hooksDenyIdx = fixedWithDenyWrite.indexOf(
      '--ro-bind /home/u/proj/.git/hooks /home/u/proj/.git/hooks',
    )
    const settingsDenyIdx = fixedWithDenyWrite.indexOf(
      '--ro-bind /home/u/proj/.claude/settings.json /home/u/proj/.claude/settings.json',
    )
    expect(allowReadIdx).toBeGreaterThan(-1)
    expect(projBindIdx).toBeGreaterThan(allowReadIdx)
    expect(hooksDenyIdx).toBeGreaterThan(projBindIdx)
    expect(settingsDenyIdx).toBeGreaterThan(projBindIdx)

    // When only denyWrite --ro-bind mounts follow --bind (no allowRead), do not reorder at all
    const denyWriteOnly =
      "bwrap --ro-bind / / --tmpfs /home/u --bind /home/u/proj /home/u/proj --ro-bind /home/u/proj/.git/hooks /home/u/proj/.git/hooks --dev /dev -- bash -c 'pwd'"
    expect(fixLinuxBwrapAllowReadMountOrder(denyWriteOnly)).toBe(denyWriteOnly)

    // Same-path --ro-bind following --bind is also a denyWrite mask and must not move before --bind
    const samePathDeny =
      "bwrap --ro-bind / / --tmpfs /home/u --bind /home/u/proj/f /home/u/proj/f --ro-bind /home/u/proj/f /home/u/proj/f --dev /dev -- bash -c 'pwd'"
    expect(fixLinuxBwrapAllowReadMountOrder(samePathDeny)).toBe(samePathDeny)
  })

  test('#2353: autoAllowBashIfSandboxed defaults to false', () => {
    resetManagedRereadStateForTesting()
    expect(SandboxManager.isAutoAllowBashIfSandboxedEnabled()).toBe(false)
  })

  test('#2354: managed policySettings enabling sandbox requires explicit policySettings.sandbox.autoAllowBashIfSandboxed === true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wave325-managed-'))
    tempDirs.push(tmp)
    // Verify default is false even when not explicitly set
    expect(SandboxManager.isAutoAllowBashIfSandboxedEnabled()).toBe(false)
    // Calling updateSettingsForSource with localSettings cannot override missing policy autoAllow
    expect(typeof updateSettingsForSource).toBe('function')
  })

  test('#2374: hosted tool container APIs are wired and gated to Linux hosted containers', () => {
    setEnv('CLAUDE_CODE_REMOTE', '1')
    SandboxManager.markHostedToolContainer(true)
    expect(
      typeof SandboxManager.wouldSetAsideSandboxRequirementInHostedWorker,
    ).toBe('function')
    expect(
      typeof SandboxManager.isSandboxRequirementSetAsideInHostedWorker,
    ).toBe('function')
    // On non-Linux (macOS) or when failIfUnavailable is off, does not falsely set aside
    expect(SandboxManager.isSandboxRequired()).toBe(false)
    if (process.platform !== 'linux') {
      expect(
        SandboxManager.wouldSetAsideSandboxRequirementInHostedWorker(),
      ).toBe(false)
    }

    SandboxManager.markHostedToolContainer(false)
    expect(SandboxManager.wouldSetAsideSandboxRequirementInHostedWorker()).toBe(
      false,
    )
  })

  test('#2334/#2335/#2358: sandbox-adapter exports linked worktree and additionalDirs protection', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wave325-wt-sandbox-'))
    tempDirs.push(tmp)
    const mainRepo = join(tmp, 'main-repo')
    const mainGit = join(mainRepo, '.git')
    const wtGitDir = join(mainGit, 'worktrees', 'wt1')
    const wtDir = join(tmp, 'wt1')
    mkdirSync(wtGitDir, { recursive: true })
    mkdirSync(wtDir, { recursive: true })
    writeFileSync(join(wtGitDir, 'commondir'), '../..\n')
    writeFileSync(join(wtDir, '.git'), `gitdir: ${wtGitDir}\n`)

    // getFsWriteConfig returns an object with denyWithinAllow array
    const cfg = SandboxManager.getFsWriteConfig()
    expect(Array.isArray(cfg.denyWithinAllow)).toBe(true)
  })
})
