import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getOriginalCwd, setOriginalCwd } from '../../../bootstrap/state.js'
import { isConfigSaveOutOfMemoryError } from '../../config.js'
import { getFastPathPolicyHelperEnv } from '../../fastPathPolicy.js'
import { addFileGlobRuleToGitignore } from '../../git/gitignore.js'
import {
  clearFrozenStartupEnvForTests,
  getFrozenStartupEnv,
  getPolicyHelperEnv,
  stripHostManagedSettingsEnv,
} from '../../managedEnv.js'
import { getSubagentStatusLineCommand } from '../../subagentStatusLine.js'
import {
  extractParentManagedOffSwitches,
  isLocalThirdPartyDesktopManagedSession,
  stripHostManagedPolicyModelKeys,
} from '../hostModelOverlay.js'
import {
  checkProjectSettingsSymlinkEscape,
  UNTRUSTED_WORKSPACE_STRIP_KEYS,
  updateSettingsForSource,
} from '../settings.js'
import { resetSettingsCache } from '../settingsCache.js'
import { SettingsSchema } from '../types.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  clearFrozenStartupEnvForTests()
  resetSettingsCache()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 323 Group 2 — Settings, Config, Managed Env, Gitignore, Trust', () => {
  test('#1968: preserves CLAUDE_CODE_AUTO_MODE_MODEL for local 3P Desktop managed sessions', () => {
    const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    const prevHostManaged = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevCowork = process.env.CLAUDE_CODE_IS_COWORK
    try {
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop-3p'
      process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
      delete process.env.CLAUDE_CODE_REMOTE
      delete process.env.CLAUDE_CODE_IS_COWORK
      expect(isLocalThirdPartyDesktopManagedSession()).toBe(true)

      const policySettings = {
        model: 'claude-opus-4-6',
        env: {
          ANTHROPIC_MODEL: 'claude-opus-4-6',
          CLAUDE_CODE_AUTO_MODE_MODEL: 'claude-sonnet-4-6',
          OTHER_VAR: 'keep',
        },
      }
      const strippedDefault = stripHostManagedPolicyModelKeys(
        { ...policySettings, env: { ...policySettings.env } },
        false,
      )
      expect(strippedDefault.env?.CLAUDE_CODE_AUTO_MODE_MODEL).toBeUndefined()

      const strippedDesktop3p = stripHostManagedPolicyModelKeys(
        { ...policySettings, env: { ...policySettings.env } },
        true,
      )
      expect(strippedDesktop3p.env?.CLAUDE_CODE_AUTO_MODE_MODEL).toBe(
        'claude-sonnet-4-6',
      )
      expect(strippedDesktop3p.env?.ANTHROPIC_MODEL).toBeUndefined()
      expect(strippedDesktop3p.env?.OTHER_VAR).toBe('keep')

      const envKept = stripHostManagedSettingsEnv(policySettings.env, {
        managedByHost: true,
        managedByHostFlag: true,
        localThirdPartyDesktop: true,
        source: 'policySettings',
      })
      expect(envKept.CLAUDE_CODE_AUTO_MODE_MODEL).toBe('claude-sonnet-4-6')
      expect(envKept.ANTHROPIC_MODEL).toBeUndefined()
    } finally {
      if (prevEntrypoint === undefined) {
        delete process.env.CLAUDE_CODE_ENTRYPOINT
      } else {
        process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
      }
      if (prevHostManaged === undefined) {
        delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
      } else {
        process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = prevHostManaged
      }
      if (prevRemote === undefined) {
        delete process.env.CLAUDE_CODE_REMOTE
      } else {
        process.env.CLAUDE_CODE_REMOTE = prevRemote
      }
      if (prevCowork === undefined) {
        delete process.env.CLAUDE_CODE_IS_COWORK
      } else {
        process.env.CLAUDE_CODE_IS_COWORK = prevCowork
      }
    }
  })

  test('#1983: updateSettingsForSource merges fresh hand edits and does not resurrect deleted files', () => {
    const configHome = makeTempDir('w323-settings-')
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
      process.env.CLAUDE_CONFIG_DIR = configHome
      resetSettingsCache()
      const settingsPath = join(configHome, 'settings.json')
      writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }, null, 2))

      // Hand edit on disk after initial load
      writeFileSync(
        settingsPath,
        JSON.stringify({ theme: 'dark', handEdited: true }, null, 2),
      )

      const res1 = updateSettingsForSource('userSettings', {
        cleanupPeriodDays: 14,
      })
      expect(res1.error).toBeNull()
      const saved = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<
        string,
        unknown
      >
      expect(saved.handEdited).toBe(true)
      expect(saved.cleanupPeriodDays).toBe(14)

      // Deleting settings.json and clearing a key must NOT recreate the file
      unlinkSync(settingsPath)
      const res2 = updateSettingsForSource('userSettings', {
        cleanupPeriodDays: undefined,
      })
      expect(res2.error).toBeNull()
      expect(existsSync(settingsPath)).toBe(false)
    } finally {
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
    }
  })

  test('#1986: isConfigSaveOutOfMemoryError detects ENOMEM and Out of memory messages', () => {
    const errWithCode = Object.assign(new Error('alloc failed'), {
      code: 'ENOMEM',
    })
    expect(isConfigSaveOutOfMemoryError(errWithCode)).toBe(true)
    expect(isConfigSaveOutOfMemoryError(new Error('Out of memory'))).toBe(true)
    expect(isConfigSaveOutOfMemoryError(new Error('EACCES'))).toBe(false)
  })

  test('#2029: checkProjectSettingsSymlinkEscape blocks symlinks escaping project root', () => {
    const outside = makeTempDir('w323-symlink-outside-')
    const outsideSettings = join(outside, 'settings.json')
    writeFileSync(outsideSettings, '{"hooks":{}}')
    const linkDir = makeTempDir('w323-symlink-link-')
    const linkPath = join(linkDir, 'settings.json')
    symlinkSync(outsideSettings, linkPath)

    const escapeErr = checkProjectSettingsSymlinkEscape(
      'projectSettings',
      linkPath,
    )
    expect(escapeErr).not.toBeNull()
    expect(escapeErr?.message).toContain('was not read')
  })

  test('#2029/#1983: updateSettingsForSource blocks projectSettings/localSettings writes via symlink escape', () => {
    const prevOriginalCwd = getOriginalCwd()
    const projectDir = makeTempDir('w323-proj-root-')
    const outsideDir = makeTempDir('w323-outside-target-')
    const outsideExisting = join(outsideDir, 'victim.json')
    writeFileSync(outsideExisting, '{"secret":true}\n')
    const outsideDangling = join(outsideDir, 'dangling-target.json')

    const claudeDir = join(projectDir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    symlinkSync(outsideExisting, join(claudeDir, 'settings.json'))
    symlinkSync(outsideDangling, join(claudeDir, 'settings.local.json'))

    try {
      setOriginalCwd(projectDir)
      resetSettingsCache()

      const projRes = updateSettingsForSource('projectSettings', {
        cleanupPeriodDays: 7,
      })
      expect(projRes.error).not.toBeNull()
      expect(projRes.error?.message).toContain('was not read')
      expect(readFileSync(outsideExisting, 'utf8')).toBe('{"secret":true}\n')

      const localRes = updateSettingsForSource('localSettings', {
        cleanupPeriodDays: 7,
      })
      expect(localRes.error).not.toBeNull()
      expect(localRes.error?.message).toContain('was not read')
      expect(existsSync(outsideDangling)).toBe(false)
    } finally {
      setOriginalCwd(prevOriginalCwd)
      resetSettingsCache()
    }
  })

  test('#2059: addFileGlobRuleToGitignore writes to global gitignore outside a git repo when writeOutsideGitRepo=true', async () => {
    const nonGitDir = makeTempDir('w323-nongit-')
    const xdgDir = makeTempDir('w323-xdg-')
    const prevXdg = process.env.XDG_CONFIG_HOME
    const prevGitGlobal = process.env.GIT_CONFIG_GLOBAL
    try {
      process.env.XDG_CONFIG_HOME = xdgDir
      process.env.GIT_CONFIG_GLOBAL = '/dev/null'
      const res = await addFileGlobRuleToGitignore(
        '.claude/settings.local.json',
        nonGitDir,
        true,
      )
      expect(res.written).toBe(true)
      const globalIgnore = join(xdgDir, 'git', 'ignore')
      expect(existsSync(globalIgnore)).toBe(true)
      expect(readFileSync(globalIgnore, 'utf8')).toContain(
        '**/.claude/settings.local.json',
      )
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      if (prevGitGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = prevGitGlobal
    }
  })

  test('#2120: extractParentManagedOffSwitches extracts disable* and false enable* flags', () => {
    const extracted = extractParentManagedOffSwitches({
      disableRemoteControl: true,
      disableAgentView: true,
      disableWorkflows: false,
      disableArtifact: true,
      enableWorkflows: false,
      enableArtifact: true,
    } as Record<string, unknown>)
    expect(extracted).toEqual({
      disableRemoteControl: true,
      disableAgentView: true,
      disableArtifact: true,
      enableWorkflows: false,
    })
  })

  test('#2187: UNTRUSTED_WORKSPACE_STRIP_KEYS includes disableAllHooks and enabledPlugins', () => {
    expect(UNTRUSTED_WORKSPACE_STRIP_KEYS).toContain('disableAllHooks')
    expect(UNTRUSTED_WORKSPACE_STRIP_KEYS).toContain('enabledPlugins')
    expect(UNTRUSTED_WORKSPACE_STRIP_KEYS).toContain('extraKnownMarketplaces')
  })

  test('#2193: getPolicyHelperEnv and getFastPathPolicyHelperEnv isolate from user env mutations', () => {
    const prevFoo = process.env.W323_SHELL_ONLY
    const prevUser = process.env.W323_USER_SETTINGS_LEAK
    try {
      process.env.W323_SHELL_ONLY = 'from-shell'
      delete process.env.W323_USER_SETTINGS_LEAK
      getFrozenStartupEnv()
      process.env.W323_USER_SETTINGS_LEAK = 'from-user-settings'

      const helperEnv = getPolicyHelperEnv()
      const fastEnv = getFastPathPolicyHelperEnv()
      expect(helperEnv.W323_SHELL_ONLY).toBe('from-shell')
      expect(helperEnv.W323_USER_SETTINGS_LEAK).toBeUndefined()
      expect(fastEnv.W323_USER_SETTINGS_LEAK).toBeUndefined()
    } finally {
      if (prevFoo === undefined) delete process.env.W323_SHELL_ONLY
      else process.env.W323_SHELL_ONLY = prevFoo
      if (prevUser === undefined) delete process.env.W323_USER_SETTINGS_LEAK
      else process.env.W323_USER_SETTINGS_LEAK = prevUser
    }
  })

  test('#2210: subagentStatusLine stays schema-compatible and getSubagentStatusLineCommand returns undefined', () => {
    const parsed = SettingsSchema().safeParse({
      subagentStatusLine: { type: 'command', command: 'echo hi' },
    })
    expect(parsed.success).toBe(true)
    const parsedLegacyInvalid = SettingsSchema().safeParse({
      subagentStatusLine: 'legacy-value',
    })
    expect(parsedLegacyInvalid.success).toBe(true)
    expect(getSubagentStatusLineCommand()).toBeUndefined()
  })
})
