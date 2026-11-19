import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { FileEditTool } from '../../../../packages/builtin-tools/src/tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from '../../../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.js'
import { serverClassifierBetasEligible } from '../../../services/api/autoModeClassifierTransport.js'
import {
  isAutoDefaultAwaitsServedSettings,
  setAutoDefaultAwaitsServedSettings,
} from '../autoModeState.js'
import { isBroadRule, matchesWildcardBroadPrefix } from '../broadRuleFilter.js'
import {
  classifyBlockedDeviceOrProcessPath,
  isBlockedDeviceOrProcessPath,
  isClaudeSignInFilePath,
  isModsFolderWithUnsafeSymlink,
} from '../filesystem.js'
import {
  buildUnfinishedCheckAsk,
  CIRCUIT_BREAKER_POLICY,
  extractDecisionReasonCause,
  formatNonInteractiveAskCauseMessage,
  hasBypassImmuneSafetyCheck,
  hasHostPersonOnlySafetyCheck,
  hasUnwaivableBypassImmuneSafetyCheck,
  isStandsForDenyRules,
  isUnwaivableBypassImmuneSafetyCheck,
} from '../nhoGates.js'
import { resolveAutoDefaultOnPolicySettingsLoad } from '../permissionSetup.js'
import {
  AUTO_MODE_DEFAULTS_SENTINEL,
  expandAutoModeEntriesWithDefaults,
  isAutoModeSectionReplacingDefaults,
  stripDefaultsFromFlagAutoModeSection,
} from '../yoloClassifier.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  setAutoDefaultAwaitsServedSettings(false)
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 326 Group 1 — Permissions, Auto Mode, File Safety', () => {
  test('#311 unfinishedCheck policy is unwaivable in bypass mode and standsForDenyRules helper works', () => {
    expect(CIRCUIT_BREAKER_POLICY.unfinishedCheck.waivableInBypass).toBe(false)
    expect(CIRCUIT_BREAKER_POLICY.unfinishedCheck.bypassImmune).toBe(true)

    const ask = buildUnfinishedCheckAsk({
      message: 'Check did not complete',
      reason: 'parser timed out',
    })
    expect(ask.behavior).toBe('ask')
    expect(ask.decisionReason?.type).toBe('safetyCheck')
    expect(isUnwaivableBypassImmuneSafetyCheck(ask.decisionReason)).toBe(true)
    expect(hasBypassImmuneSafetyCheck(ask.decisionReason)).toBe(true)
    expect(hasUnwaivableBypassImmuneSafetyCheck(ask.decisionReason)).toBe(true)
    expect(hasHostPersonOnlySafetyCheck(ask.decisionReason)).toBe(true)
    expect(
      hasHostPersonOnlySafetyCheck({
        type: 'subcommandResults',
        reasons: new Map([
          [
            'cmd',
            {
              behavior: 'ask',
              decisionReason: {
                type: 'safetyCheck',
                circuitBreaker: 'claudeSettingsFile',
              },
            },
          ],
        ]),
      }),
    ).toBe(true)
    expect(
      hasHostPersonOnlySafetyCheck({
        type: 'safetyCheck',
        circuitBreaker: 'dangerousRemoval',
      }),
    ).toBe(false)

    expect(
      isStandsForDenyRules({
        type: 'other',
        reason: 'too long',
        standsForDenyRules: true,
      }),
    ).toBe(true)
    expect(isStandsForDenyRules({ type: 'other', reason: 'normal' })).toBe(
      false,
    )
  })

  test('#253 non-interactive ask cause formatting preserves explicit cause', () => {
    const ask = buildUnfinishedCheckAsk({
      message: 'Permission check threw EACCES',
      reason: 'Permission check failed: EACCES',
    })
    // Self-described unfinishedCheck uses ask.message directly without duplicating suffix
    expect(extractDecisionReasonCause(ask.decisionReason)).toBeUndefined()
    expect(
      extractDecisionReasonCause({
        type: 'other',
        reason: 'Permission check failed: EACCES',
      }),
    ).toBe('Permission check failed: EACCES')
    const msg = formatNonInteractiveAskCauseMessage({
      message: 'Command requires approval.',
      decisionReason: {
        type: 'other',
        reason: 'Permission check failed: EACCES',
      },
    })
    expect(msg).toContain('Permission check failed: EACCES')
    expect(formatNonInteractiveAskCauseMessage(ask)).toContain(
      'Permission check threw EACCES',
    )
  })

  test('#320/#321/#294 broadRuleFilter rejects wildcard rules with no program, $HOME, or Windows backslash paths while keeping exact rules', () => {
    // Wildcard rules naming no program or starting with $HOME / env (#320)
    expect(matchesWildcardBroadPrefix('*')).toBe(true)
    expect(matchesWildcardBroadPrefix('$HOME/bin/tool*')).toBe(true)
    expect(matchesWildcardBroadPrefix('$HOME/bin/tool:*')).toBe(true)
    expect(matchesWildcardBroadPrefix('FOO=bar *')).toBe(true)

    // Windows backslash / drive wildcard rules (#321)
    expect(matchesWildcardBroadPrefix('C:\\Users\\me\\tool.exe*')).toBe(true)
    expect(matchesWildcardBroadPrefix('.\\scripts\\run.bat *')).toBe(true)
    // Exact rules without wildcards keep their allow (#321)
    expect(matchesWildcardBroadPrefix('C:\\Users\\me\\tool.exe')).toBe(false)
    expect(matchesWildcardBroadPrefix('git status')).toBe(false)

    // Expanded package runners & PowerShell broad cmdlets (#294)
    expect(isBroadRule('Bash', 'pnpx *')).toBe(true)
    expect(isBroadRule('Bash', 'bun x *')).toBe(true)
    expect(isBroadRule('PowerShell', 'Invoke-WmiMethod *')).toBe(true)
    expect(isBroadRule('PowerShell', 'Get-Module *')).toBe(true)
    expect(isBroadRule('Bash', 'C:\\Users\\me\\tool.exe')).toBe(false)
  })

  test('#322 managed autoMode.environment without "$defaults" replaces built-in defaults', () => {
    expect(AUTO_MODE_DEFAULTS_SENTINEL).toBe('$defaults')
    expect(isAutoModeSectionReplacingDefaults(['custom entry'])).toBe(true)
    expect(
      isAutoModeSectionReplacingDefaults([
        AUTO_MODE_DEFAULTS_SENTINEL,
        'custom entry',
      ]),
    ).toBe(false)

    const defaults = ['default-a', 'default-b']
    expect(
      expandAutoModeEntriesWithDefaults(['only-custom'], defaults, s => s),
    ).toEqual(['only-custom'])
    expect(
      expandAutoModeEntriesWithDefaults(
        [AUTO_MODE_DEFAULTS_SENTINEL, 'extra'],
        defaults,
        s => s,
      ),
    ).toEqual(['default-a', 'default-b', 'extra'])

    expect(
      stripDefaultsFromFlagAutoModeSection(
        'environment',
        [AUTO_MODE_DEFAULTS_SENTINEL, 'flag-entry'],
        ['managed-only'],
      ),
    ).toEqual(['flag-entry'])
    expect(
      stripDefaultsFromFlagAutoModeSection(
        'environment',
        [AUTO_MODE_DEFAULTS_SENTINEL, 'flag-entry'],
        [AUTO_MODE_DEFAULTS_SENTINEL, 'managed-extra'],
      ),
    ).toEqual([AUTO_MODE_DEFAULTS_SENTINEL, 'flag-entry'])
  })

  test('#297 resolveAutoDefaultOnPolicySettingsLoad adopts server defaultMode or falls back to Manual when awaited', () => {
    setAutoDefaultAwaitsServedSettings(true)
    expect(isAutoDefaultAwaitsServedSettings()).toBe(true)

    const ctx = {
      ...getEmptyToolPermissionContext(),
      mode: 'auto' as const,
    }
    const adopted = resolveAutoDefaultOnPolicySettingsLoad(ctx, {
      source: 'policySettings',
      policyDefaultModeOverride: 'acceptEdits',
      bridgeChildAutoDefault: false,
    })
    expect(adopted.exitedAutoMode).toBe(true)
    expect(adopted.context.mode).toBe('acceptEdits')
    expect(isAutoDefaultAwaitsServedSettings()).toBe(false)

    // When settings failed with no stored copy and policy requires default -> Manual ('default')
    setAutoDefaultAwaitsServedSettings(true)
    const fallback = resolveAutoDefaultOnPolicySettingsLoad(ctx, {
      source: 'policySettings',
      remoteSettingsFailed: true,
      policyRequiresDefault: true,
      bridgeChildAutoDefault: false,
    })
    expect(fallback.exitedAutoMode).toBe(true)
    expect(fallback.context.mode).toBe('default')
    expect(isAutoDefaultAwaitsServedSettings()).toBe(false)
  })

  test('#298 serverClassifierBetasEligible respects CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', () => {
    const prev = process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    try {
      process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
      expect(serverClassifierBetasEligible()).toBe(false)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
      } else {
        process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = prev
      }
    }
  })

  test('#307/#309 FileWriteTool and FileEditTool refuse Claude sign-in files and device/process files', async () => {
    const credsPath = join(homedir(), '.claude', '.credentials.json')
    const devKeysPath = join(homedir(), '.claude', '.device-keys.json')
    expect(isClaudeSignInFilePath(credsPath)).toBe(true)
    expect(isClaudeSignInFilePath(devKeysPath)).toBe(true)

    expect(isBlockedDeviceOrProcessPath('/dev/zero')).toBe(true)
    expect(isBlockedDeviceOrProcessPath('/proc/self/mem')).toBe(true)
    expect(isBlockedDeviceOrProcessPath('/proc/self/environ')).toBe(true)
    expect(classifyBlockedDeviceOrProcessPath('/dev/urandom')).not.toBeNull()
    expect(isBlockedDeviceOrProcessPath('/tmp/normal-file.txt')).toBe(false)

    const fakeContext = {
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
    } as never

    const writeCreds = await FileWriteTool.validateInput(
      { file_path: credsPath, content: '{}' },
      fakeContext,
    )
    expect(writeCreds.result).toBe(false)

    const writeDev = await FileWriteTool.validateInput(
      { file_path: '/proc/self/mem', content: 'x' },
      fakeContext,
    )
    expect(writeDev.result).toBe(false)

    const editCreds = await FileEditTool.validateInput(
      { file_path: credsPath, old_string: 'a', new_string: 'b' },
      fakeContext,
    )
    expect(editCreds.result).toBe(false)

    const editDev = await FileEditTool.validateInput(
      { file_path: '/dev/zero', old_string: 'a', new_string: 'b' },
      fakeContext,
    )
    expect(editDev.result).toBe(false)
  })

  test('#235 isModsFolderWithUnsafeSymlink only flags Claude config/session mods roots, not arbitrary user project mods dirs', () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
      const fakeConfigDir = makeTempDir('claude-config-mods-')
      process.env.CLAUDE_CONFIG_DIR = fakeConfigDir

      const claudeModsDir = join(fakeConfigDir, 'dev-mods')
      mkdirSync(claudeModsDir, { recursive: true })
      const claudeModFile = join(claudeModsDir, 'edit.ts')
      expect(isModsFolderWithUnsafeSymlink(claudeModFile)).toBe(false)

      symlinkSync('/net/remote-host/share', join(claudeModsDir, 'remote-link'))
      expect(isModsFolderWithUnsafeSymlink(claudeModFile)).toBe(true)

      // Arbitrary user project directory named `mods` or `dev-mods` must NOT trigger
      const userProjectDir = makeTempDir('user-game-project-')
      const userModsDir = join(userProjectDir, 'mods')
      mkdirSync(userModsDir, { recursive: true })
      symlinkSync('/net/remote-host/share', join(userModsDir, 'remote-link'))
      expect(isModsFolderWithUnsafeSymlink(join(userModsDir, 'edit.ts'))).toBe(
        false,
      )
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })

  test('#307 isClaudeSignInFilePath resolves symlinked ancestors for non-existent .credentials.json', () => {
    if (process.platform === 'win32') return
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
      const base = makeTempDir('signin-ancestor-')
      const realCfg = join(base, 'real-cfg')
      mkdirSync(realCfg, { recursive: true })
      const linkCfg = join(base, 'link-cfg')
      symlinkSync(realCfg, linkCfg)
      process.env.CLAUDE_CONFIG_DIR = realCfg

      // Leaf `.credentials.json` does not exist yet, accessed via symlinked ancestor
      expect(isClaudeSignInFilePath(join(linkCfg, '.credentials.json'))).toBe(
        true,
      )
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })
})
