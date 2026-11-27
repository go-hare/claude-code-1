/**
 * Settings-to-SandboxRuntimeConfig conversion, trusted-source resolution, and
 * filesystem read/write restriction config getters.
 */

import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import { SandboxManager as BaseSandboxManager } from '@anthropic-ai/sandbox-runtime'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from 'path'
import {
  getAdditionalDirectoriesForClaudeMd,
  getCwdState,
  getOriginalCwd,
} from '../../../bootstrap/state.js'
import { getAutoMemPath } from '../../../memdir/paths.js'
import { logForDebugging } from '../../debug.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { errorMessage } from '../../errors.js'
import { readHostProxyPorts } from '../../hostProxyPorts.js'
import { expandPath } from '../../path.js'
import {
  getClaudeTempDir,
  getFlagMcpConfigFilePaths,
  getProfileStoreDenyPaths,
} from '../../permissions/filesystem.js'
import { settingsHaveBlockReadsOutsideWorkingDirectories } from '../../permissions/outsideReads.js'
import {
  getWorktreeAddDirPinState,
  resolveWorktreeAddDirEntry,
} from '../../permissions/permissionSetup.js'
import {
  collectUngatedAdditionalDirectories,
  collectUngatedAllowRuleStrings,
  isSourceGrantsGated,
} from '../../permissions/projectGrantsGate.js'
import { getPlatform } from '../../platform.js'
import {
  getCommandProducerScanRoots,
  isPathEqualOrUnder,
  scanInstalledCommandProducerDirs,
} from '../../plugins/commandProducerDirs.js'
import { ripgrepCommand } from '../../ripgrep.js'
import { getProjectDir } from '../../sessionPaths.js'
import {
  isSettingSourceEnabled,
  SETTING_SOURCES,
} from '../../settings/constants.js'
import {
  getManagedSettingsDropInDir,
  WSL_WINDOWS_MANAGED_PATH,
} from '../../settings/managedPath.js'
import {
  getSettings_DEPRECATED,
  getSettingsFilePathForSource,
  getSettingsForSource,
} from '../../settings/settings.js'
import type { SettingsJson } from '../../settings/types.js'
import {
  type ForwardedUntrustedGrant,
  recordReadDenyRecheckBaseline,
} from '../readDenyRecheck.js'
import {
  clearSymlinkedDenyLists,
  recordSymlinkedDenyPath,
  rememberBuiltConfigAllowlist,
} from '../symlinkedDenyScrub.js'
import {
  ALLOW_WRITE_SYSTEM_DIRS,
  DENY_READ_ENV_GLOBS,
  DENY_READ_SOCKET_PATHS,
  ENV_FILES,
  hasGlobCharacters,
  pathHasGlobChars,
  permissionRuleValueFromString,
  SRT_ALLOW_NESTED_USERNS_ENV,
  stripTrailingGlob,
} from './constants.js'
import {
  detectWorktreeMainRepoPath,
  ensureLinuxGitWorktreeConfigPlaceholder,
  guardWorktreeCommonDirDotGit,
  pushGitDirMetadataDenyWrite,
  pushLinkedWorktreeConfigDenyWrite,
} from './gitDirGuard.js'
import { getSandboxHostState } from './hostState.js'
import {
  collectSensitiveHomeDenyWritePaths,
  expandSymlinkedDenyWriteGlobs,
  filterLinuxNetSymlinkDenyRead,
  getDisabledSandboxFsReadConfig,
  getDisabledSandboxFsWriteConfig,
  getInlinePluginRoots,
  getUpdaterStagingDir,
  hasTrustedSandboxNetworkRestriction,
  isAllowWriteSymlinkEscapingOrDangling,
  isSandboxAdminMandated,
  mergeSandboxCredentialsForRuntime,
  mergeTrustedIgnoreViolations,
  mergeTrustedSandboxArray,
  pickPolicySandboxValue,
  pickTrustedSandboxValue,
  pushProtectedClaudeDirEntries,
  resolvePathPatternForSandbox,
  resolveSandboxFilesystemDisabled,
  resolveSandboxFilesystemPath,
  resolveSandboxRipgrep,
  resolveSandboxStrictAllowlist,
  resolveSandboxTlsTerminate,
  SANDBOX_NETWORK_BYPASS_KEYS,
  SANDBOX_PROXY_PORT_KEYS,
  shouldAllowManagedReadPathsOnly,
  shouldAllowManagedSandboxDomainsOnly,
} from './pathPolicy.js'

export type TrustedSandboxSettingsResolution = {
  allowAppleEvents: boolean | undefined
  allowNestedUserNamespaces: boolean | undefined
  enableWeakerNestedSandbox: boolean | undefined
  enableWeakerNetworkIsolation: boolean | undefined
  ignoreViolations: Record<string, string[]> | undefined
  network: {
    allowUnixSockets: string[] | undefined
    allowAllUnixSockets: boolean | undefined
    allowLocalBinding: boolean | undefined
    allowMachLookup: string[] | undefined
    httpProxyPort: number | undefined
    socksProxyPort: number | undefined
  }
  adminMandated: boolean
  trustedNetworkRestricted: boolean
  managedDomainsOnly: boolean
}

/**
 * Official 2.1.328 `wpl` + `nG(e)` (`chunk@283546038.js@20294`,
 * `chunk@290312616.js@926803`):
 * - Reads `allowAppleEvents`, `allowNestedUserNamespaces`,
 *   `enableWeakerNestedSandbox`, and `enableWeakerNetworkIsolation` strictly
 *   from trusted sources (`policySettings`, `flagSettings`, enabled
 *   `userSettings`) — never from `projectSettings` or `localSettings`.
 * - Under admin sandbox mandate (`policySettings.sandbox.enabled` / `Xo()`),
 *   drops all 6 network bypass keys (`allowUnixSockets`, `allowAllUnixSockets`,
 *   `allowLocalBinding`, `allowMachLookup`, `httpProxyPort`, `socksProxyPort`)
 *   from `projectSettings`/`localSettings`.
 * - Under trusted deny/strict allowlist (`$me()`), blocks project/local
 *   `httpProxyPort`/`socksProxyPort`.
 * - Under `allowManagedDomainsOnly` (`bhe()`), restricts `httpProxyPort` and
 *   `socksProxyPort` to `policySettings` only.
 */
export function resolveTrustedSandboxSettings(
  settings: SettingsJson,
  hostProxy?: { httpProxyPort?: number; socksProxyPort?: number },
): TrustedSandboxSettingsResolution {
  const adminMandated = isSandboxAdminMandated()
  const trustedNetworkRestricted = hasTrustedSandboxNetworkRestriction()
  const managedDomainsOnly = shouldAllowManagedSandboxDomainsOnly()

  // Strictly trusted sources only (policy -> flag -> enabled userSettings);
  // projectSettings and localSettings can NEVER enable weakening flags.
  const allowAppleEvents = pickTrustedSandboxValue(s => s.allowAppleEvents)
  const allowNestedUserNamespaces = pickTrustedSandboxValue(
    s => s.allowNestedUserNamespaces,
  )
  const enableWeakerNestedSandbox = pickTrustedSandboxValue(
    s => s.enableWeakerNestedSandbox,
  )
  const enableWeakerNetworkIsolation = pickTrustedSandboxValue(
    s => s.enableWeakerNetworkIsolation,
  )

  const ignoreViolations = adminMandated
    ? mergeTrustedIgnoreViolations()
    : settings.sandbox?.ignoreViolations

  const mergedNetwork = settings.sandbox?.network
  if (!adminMandated && !trustedNetworkRestricted) {
    return {
      allowAppleEvents,
      allowNestedUserNamespaces,
      enableWeakerNestedSandbox,
      enableWeakerNetworkIsolation,
      ignoreViolations,
      network: {
        allowUnixSockets: mergedNetwork?.allowUnixSockets,
        allowAllUnixSockets: mergedNetwork?.allowAllUnixSockets,
        allowLocalBinding: mergedNetwork?.allowLocalBinding,
        allowMachLookup: mergedNetwork?.allowMachLookup,
        httpProxyPort: mergedNetwork?.httpProxyPort ?? hostProxy?.httpProxyPort,
        socksProxyPort:
          mergedNetwork?.socksProxyPort ?? hostProxy?.socksProxyPort,
      },
      adminMandated,
      trustedNetworkRestricted,
      managedDomainsOnly,
    }
  }

  const hostState = getSandboxHostState()
  if (!hostState.droppedRepoNetworkAllowancesLogged) {
    hostState.droppedRepoNetworkAllowancesLogged = true
    const repoSources = (['projectSettings', 'localSettings'] as const).map(
      src => (isSettingSourceEnabled(src) ? getSettingsForSource(src) : null),
    )
    const keysToCheck = adminMandated
      ? SANDBOX_NETWORK_BYPASS_KEYS
      : SANDBOX_PROXY_PORT_KEYS
    const droppedKeys = keysToCheck.filter(key =>
      repoSources.some(src => {
        const val = src?.sandbox?.network?.[key]
        return val !== undefined && val !== false
      }),
    )
    if (droppedKeys.length > 0) {
      logForDebugging(
        adminMandated
          ? `[sandbox] admin sandbox mandate: ignoring sandbox.network.${droppedKeys.join(', ')} from project/local settings`
          : `[sandbox] trusted network deny list or strict allowlist: ignoring sandbox.network.${droppedKeys.join(', ')} from project/local settings (a project may not replace the filtering proxy)`,
      )
    }
    if (managedDomainsOnly) {
      const nonPolicyTrusted = [
        getSettingsForSource('flagSettings'),
        isSettingSourceEnabled('userSettings')
          ? getSettingsForSource('userSettings')
          : null,
      ]
      const droppedProxyKeys = SANDBOX_PROXY_PORT_KEYS.filter(key =>
        nonPolicyTrusted.some(
          src => src?.sandbox?.network?.[key] !== undefined,
        ),
      )
      if (droppedProxyKeys.length > 0) {
        logForDebugging(
          `[sandbox] network.allowManagedDomainsOnly: ignoring sandbox.network.${droppedProxyKeys.join(', ')} from --settings/user settings; only managed settings may replace the filtering proxy`,
        )
      }
    }
  }

  const pickProxyPort = managedDomainsOnly
    ? pickPolicySandboxValue
    : pickTrustedSandboxValue
  const httpProxyPort =
    pickProxyPort(s => s.network?.httpProxyPort) ?? hostProxy?.httpProxyPort
  const socksProxyPort =
    pickProxyPort(s => s.network?.socksProxyPort) ?? hostProxy?.socksProxyPort

  if (!adminMandated) {
    return {
      allowAppleEvents,
      allowNestedUserNamespaces,
      enableWeakerNestedSandbox,
      enableWeakerNetworkIsolation,
      ignoreViolations,
      network: {
        allowUnixSockets: mergedNetwork?.allowUnixSockets,
        allowAllUnixSockets: mergedNetwork?.allowAllUnixSockets,
        allowLocalBinding: mergedNetwork?.allowLocalBinding,
        allowMachLookup: mergedNetwork?.allowMachLookup,
        httpProxyPort,
        socksProxyPort,
      },
      adminMandated,
      trustedNetworkRestricted,
      managedDomainsOnly,
    }
  }

  const allowUnixSockets = mergeTrustedSandboxArray(
    s => s.network?.allowUnixSockets,
  )
  const allowMachLookup = mergeTrustedSandboxArray(
    s => s.network?.allowMachLookup,
  )
  const allowAllUnixSockets =
    mergedNetwork?.allowAllUnixSockets === false
      ? false
      : pickTrustedSandboxValue(s => s.network?.allowAllUnixSockets)
  const allowLocalBinding =
    mergedNetwork?.allowLocalBinding === false
      ? false
      : pickTrustedSandboxValue(s => s.network?.allowLocalBinding)

  return {
    allowAppleEvents,
    allowNestedUserNamespaces,
    enableWeakerNestedSandbox,
    enableWeakerNetworkIsolation,
    ignoreViolations,
    network: {
      allowUnixSockets:
        allowUnixSockets.length > 0 ? allowUnixSockets : undefined,
      allowAllUnixSockets,
      allowLocalBinding,
      allowMachLookup: allowMachLookup.length > 0 ? allowMachLookup : undefined,
      httpProxyPort,
      socksProxyPort,
    },
    adminMandated,
    trustedNetworkRestricted,
    managedDomainsOnly,
  }
}

/**
 * Build the `{ SRT_ALLOW_NESTED_USERNS: '0' | '1' }` signal from trusted sandbox settings.
 * Default-deny (`'0'`) unless `sandbox.allowNestedUserNamespaces === true` in a trusted tier.
 */
export function getSrtAllowNestedUsernsEnv(
  settings: SettingsJson = getSettings_DEPRECATED(),
): Record<typeof SRT_ALLOW_NESTED_USERNS_ENV, '0' | '1'> {
  const allow =
    resolveTrustedSandboxSettings(settings).allowNestedUserNamespaces === true
  return { [SRT_ALLOW_NESTED_USERNS_ENV]: allow ? '1' : '0' }
}

/**
 * Convert Claude Code settings format to SandboxRuntimeConfig format
 * (Function exported for testing)
 *
 * @param settings Merged settings (used for sandbox config like network, ripgrep, etc.)
 */
export function convertToSandboxRuntimeConfig(
  settings: SettingsJson,
): SandboxRuntimeConfig {
  const permissions = settings.permissions || {}

  // Extract network domains from WebFetch rules
  const allowedDomains: string[] = []
  const deniedDomains: string[] = []

  // When allowManagedSandboxDomainsOnly is enabled, only use domains from policy settings
  if (shouldAllowManagedSandboxDomainsOnly()) {
    const policySettings = getSettingsForSource('policySettings')
    for (const domain of policySettings?.sandbox?.network?.allowedDomains ||
      []) {
      allowedDomains.push(domain)
    }
    for (const ruleString of policySettings?.permissions?.allow || []) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        allowedDomains.push(rule.ruleContent.substring('domain:'.length))
      }
    }
  } else {
    for (const domain of settings.sandbox?.network?.allowedDomains || []) {
      allowedDomains.push(domain)
    }
    // Ungated sources only: an untrusted project must not add to the sandbox
    // network allowlist via WebFetch(domain:...).
    for (const ruleString of collectUngatedAllowRuleStrings()) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        allowedDomains.push(rule.ruleContent.substring('domain:'.length))
      }
    }
    // densable LOr: for (let Be of t.sessionAllowedHosts) s.push(Be)
    // Only outside allowManagedDomainsOnly — policy path ignores session bag.
    for (const host of getSandboxHostState().sessionAllowedHosts) {
      allowedDomains.push(host)
    }
  }

  // densable 2.1.219: sandbox.network.deniedDomains from settings, then
  // WebFetch(domain:...) deny rules. Survives allowManagedDomainsOnly.
  for (const domain of settings.sandbox?.network?.deniedDomains || []) {
    deniedDomains.push(domain)
  }
  for (const ruleString of permissions.deny || []) {
    const rule = permissionRuleValueFromString(ruleString)
    if (
      rule.toolName === WEB_FETCH_TOOL_NAME &&
      rule.ruleContent?.startsWith('domain:')
    ) {
      deniedDomains.push(rule.ruleContent.substring('domain:'.length))
    }
  }

  // Extract filesystem paths from Edit and Read rules
  // Always include current directory and Claude temp directory as writable
  // The temp directory is needed for Shell.ts cwd tracking files
  // densable dual facade: when filesystem.disabled we still build full path
  // lists for OUTER getFs* diagnostics; package gets disabled:true + same lists.
  const allowWrite: string[] = ['.', getClaudeTempDir()]
  const denyWrite: string[] = []
  const denyRead: string[] = []
  const allowRead: string[] = []
  const trustedDenyRoots: string[] = []
  const forwardedUntrustedGrants: ForwardedUntrustedGrant[] = []

  // Always deny writes to settings.json files to prevent sandbox escape
  // This blocks settings in the original working directory (where Claude Code started)
  // densable Pa: t.symlinkedDenyScrubPaths.length=0 then C.map(Zt)
  clearSymlinkedDenyLists()
  const settingsPaths = SETTING_SOURCES.map(source =>
    getSettingsFilePathForSource(source),
  ).filter((p): p is string => p !== undefined)
  denyWrite.push(...settingsPaths.map(recordSymlinkedDenyPath))
  denyWrite.push(recordSymlinkedDenyPath(getManagedSettingsDropInDir()))
  // 2.1.299 #598 (SEA OH): On WSL2, protect Windows-side managed settings under DrvFs
  // only when the directory exists so bwrap does not fail with `Can't mkdir /mnt/c/Program Files/ClaudeCode`.
  if (getPlatform() === 'wsl' && existsSync(WSL_WINDOWS_MANAGED_PATH)) {
    denyWrite.push(join(WSL_WINDOWS_MANAGED_PATH, 'managed-settings.json'))
    denyWrite.push(join(WSL_WINDOWS_MANAGED_PATH, 'managed-settings.d'))
  }

  // Also block settings, skills, commands, agents, hooks, workflows, routines,
  // and .mcp.json in original and current working directories (2.1.325 #2334).
  const cwd = getCwdState()
  const originalCwd = getOriginalCwd()
  pushProtectedClaudeDirEntries(denyWrite, originalCwd)
  if (cwd !== originalCwd) {
    pushProtectedClaudeDirEntries(denyWrite, cwd)
  }

  // densable jEr: for (const p of lDs(RPo())) if absolute && !BFs(resolve(p))
  //   m(resolve(p), false, true) → denyWrite. BFs(e) = cpe(e, cwd) = cwd under e.
  // Folds session zvt bag + installed sourceProducerPath / previousProducerPaths
  // so sandboxed Bash cannot mutate mode:"link" producer trees (app-layer DXS
  // alone is not enough). cDs → refreshConfig re-runs this builder.
  for (const producer of scanInstalledCommandProducerDirs(
    getCommandProducerScanRoots(),
  )) {
    if (!isAbsolute(producer)) continue
    const abs = resolve(producer)
    // densable BFs — skip when cwd is the producer or under it (would lock workspace)
    if (isPathEqualOrUnder(abs, cwd)) continue
    denyWrite.push(abs)
  }

  // 2.1.299 #591 (SEA i3n / pc): Protect `--plugin-dir` / `--plugin-dir-no-mcp` roots
  // from sandboxed writes unless originalCwd is equal to or under the plugin root.
  for (const pluginRoot of getInlinePluginRoots(originalCwd)) {
    if (!isPathEqualOrUnder(pluginRoot, originalCwd)) {
      denyWrite.push(recordSymlinkedDenyPath(pluginRoot))
    }
  }

  // SECURITY: Git's is_git_directory() treats cwd as a bare repo if it has
  // HEAD + objects/ + refs/. An attacker planting these (plus a config with
  // core.fsmonitor) escapes the sandbox when Claude's unsandboxed git runs.
  //
  // Unconditionally denying these paths makes sandbox-runtime mount
  // /dev/null at non-existent ones, which (a) leaves a 0-byte HEAD stub on
  // the host and (b) breaks `git log HEAD` inside bwrap ("ambiguous argument").
  // So: if a file exists, denyWrite (ro-bind in place, no stub). If not, scrub
  // it post-command in scrubBareGitRepoFiles() — planted files are gone before
  // unsandboxed git runs; inside the command, git is itself sandboxed.
  const hostState = getSandboxHostState()
  hostState.bareGitRepoScrubPaths.length = 0
  const bareGitRepoFiles = ['HEAD', 'objects', 'refs', 'hooks', 'config']
  for (const dir of cwd === originalCwd ? [originalCwd] : [originalCwd, cwd]) {
    for (const gitFile of bareGitRepoFiles) {
      const p = resolve(dir, gitFile)
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        statSync(p)
        denyWrite.push(p)
      } catch {
        hostState.bareGitRepoScrubPaths.push(p)
      }
    }
  }

  // ==========================================================================
  // Credential & config file write protection (from official CXq() /
  // sandbox.credentials). Prevents sandboxed commands from modifying shell
  // RC files, package manager config, env files, git config, CI/CD runner
  // paths, and credential directories — all of which are vectors for
  // sandbox escape or credential exfiltration.
  // ==========================================================================
  const home = homedir()

  // Shell RC files — modifying these lets an attacker persist across shell
  // sessions (e.g. alias sudo=..., PATH injection, PROMPT_COMMAND hook)
  denyWrite.push(
    join(home, '.bash_profile'),
    join(home, '.bashrc'),
    join(home, '.bash_aliases'),
    join(home, '.bash_login'),
    join(home, '.bash_logout'),
    join(home, '.profile'),
    join(home, '.zshrc'),
    join(home, '.zprofile'),
    join(home, '.zshenv'),
    join(home, '.zlogin'),
    join(home, '.zlogout'),
  )

  // Claude config — modifying these lets an attacker change model, auth,
  // permission rules, hooks, MCP servers, or sandbox settings.
  // Official 2.1.323 #2025: also protect legacy config file (`.config.json`
  // inside config dir / `~/.claude/.config.json`) and backup/lock siblings.
  const claudeConfigDir = getClaudeConfigHomeDir()
  const claudeConfigFiles = [
    join(home, '.claude'),
    join(home, '.claude.json'),
    join(home, '.claude.json.backup'),
    join(home, '.claude.json.lock'),
    join(home, '.claude', '.config.json'),
    join(home, '.claude', '.config.json.backup'),
    join(home, '.claude', '.config.json.lock'),
    claudeConfigDir,
    join(claudeConfigDir, '.claude.json'),
    join(claudeConfigDir, '.claude.json.backup'),
    join(claudeConfigDir, '.claude.json.lock'),
    join(claudeConfigDir, '.config.json'),
    join(claudeConfigDir, '.config.json.backup'),
    join(claudeConfigDir, '.config.json.lock'),
  ]
  for (const cfgPath of claudeConfigFiles) {
    denyWrite.push(cfgPath)
    try {
      const realCfg = realpathSync(cfgPath)
      if (realCfg !== cfgPath) denyWrite.push(realCfg)
    } catch {
      // File may not exist; literal denyWrite still protects it
    }
  }

  // Official 2.1.323 #2027 (`Wb`): block sandboxed commands from reading (or
  // writing) Claude Code's file checkpoint copies (`file-history`) and daemon
  // state under the config directory.
  for (const sub of ['file-history', 'daemon'] as const) {
    const protectedDir = resolve(claudeConfigDir, sub)
    denyRead.push(protectedDir)
    denyWrite.push(protectedDir)
    trustedDenyRoots.push(protectedDir)
    try {
      const realProtected = realpathSync(protectedDir)
      if (realProtected !== protectedDir) {
        denyRead.push(realProtected)
        denyWrite.push(realProtected)
        trustedDenyRoots.push(realProtected)
      }
    } catch {
      // Directory may not exist yet; literal deny still applies
    }
  }

  // Git config — core.fsmonitor / core.sshCommand escape, credential helper
  // poisoning, insteadOf URL rewriting
  denyWrite.push(join(home, '.gitconfig'), join(home, '.config', 'git'))

  // Package manager config files — registry rewriting, script hooks, CA bundle
  // overrides, install-time code execution
  denyWrite.push(
    join(home, '.bunfig.toml'),
    join(originalCwd, 'bunfig.toml'),
    join(originalCwd, 'package.json'),
    ...ENV_FILES.map(f => join(originalCwd, f)),
    join(home, '.npmrc'),
    join(originalCwd, '.npmrc'),
    join(home, '.yarnrc'),
    join(home, '.yarnrc.yml'),
    join(originalCwd, '.yarnrc'),
    join(originalCwd, '.yarnrc.yml'),
    join(home, '.config', 'pip'),
    join(home, '.pip'),
  )

  // Lock files — tampering enables supply-chain attacks by swapping dependency
  // hashes for malicious packages
  denyWrite.push(
    join(originalCwd, 'package-lock.json'),
    join(originalCwd, 'yarn.lock'),
    join(originalCwd, 'pnpm-lock.yaml'),
  )

  // Project-level paths that are gateways for sandbox escape or code execution
  denyWrite.push(
    join(originalCwd, 'node_modules', '.bin'),
    join(originalCwd, '.git', 'modules'),
    join(originalCwd, 'scripts'),
    join(originalCwd, '.claude'),
    join(originalCwd, '.github'),
  )

  // CI/CD self-hosted runner directories — modifying these enables persistent
  // code execution on the runner host
  denyWrite.push(
    join(home, '.local', 'bin'),
    join(home, 'runners'),
    join(home, 'actions-runner'),
  )

  // Official 2.1.325 #2333 (`D5n`): protect the native updater's download
  // staging folder (`$XDG_CACHE_HOME/claude/staging` or `~/.cache/claude/staging`).
  const updaterStagingDir = getUpdaterStagingDir()
  if (isAbsolute(updaterStagingDir)) {
    denyWrite.push(recordSymlinkedDenyPath(updaterStagingDir))
    if (getPlatform() === 'macos') {
      const stagingGrandparent = dirname(dirname(updaterStagingDir))
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        const realGrandparent = realpathSync(stagingGrandparent)
        if (realGrandparent !== stagingGrandparent) {
          denyWrite.push(
            join(
              realGrandparent,
              relative(stagingGrandparent, updaterStagingDir),
            ),
          )
        }
      } catch {
        // Grandparent may not exist yet; literal denyWrite still applies
      }
    }
  }

  // Shared temp buffer used by inline-comments — modifying this could inject
  // content into the conversation context
  denyWrite.push('/tmp/inline-comments-buffer.jsonl')

  // PATH directories under system paths — binaries in these locations could
  // shadow or override expected commands.
  // Equivalent to official fU.pathDirs computation in SXq().
  const pathDirs = (process.env.PATH ?? '')
    .split(':')
    .map(p => (p ? posix.normalize(p).replace(/\/+$/, '') : p))
    .filter(p => p && ALLOW_WRITE_SYSTEM_DIRS.some(d => p.startsWith(`${d}/`)))
  denyWrite.push(...pathDirs)

  // GitHub Actions runner file commands directory — set-env / add-path /
  // set-output commands execute in the runner context, outside the sandbox
  const githubEnv = process.env.GITHUB_ENV
  if (githubEnv) {
    denyWrite.push(dirname(githubEnv))
  }

  // GitHub Actions action path — modifying action source is remote code
  // execution on the runner
  const githubActionPath = process.env.GITHUB_ACTION_PATH
  if (githubActionPath) {
    denyWrite.push(githubActionPath)
    // Also protect the _actions/ prefix directory (the checked-out actions tree)
    if (githubActionPath.includes('/_actions/')) {
      denyWrite.push(
        githubActionPath.slice(0, githubActionPath.indexOf('/_actions/') + 9),
      )
    }
  }

  // GitHub Actions event payload — modifying this can alter workflow behavior
  const githubEventPath = process.env.GITHUB_EVENT_PATH
  if (githubEventPath) {
    denyWrite.push(githubEventPath)
  }

  // Credential & sensitive home directories — Official 2.1.326 #300 (`Tii` / `Cii`):
  // Write-protect sensitive home folders on macOS, Linux, and WSL by default;
  // trusted user/flag/managed `sandbox.filesystem.allowWrite` can explicitly allow them.
  const trustedAllowWriteForHome = [
    ...(getSettingsForSource('userSettings')?.sandbox?.filesystem?.allowWrite ??
      []),
    ...(getSettingsForSource('flagSettings')?.sandbox?.filesystem?.allowWrite ??
      []),
    ...(getSettingsForSource('policySettings')?.sandbox?.filesystem
      ?.allowWrite ?? []),
  ]
  denyWrite.push(
    ...collectSensitiveHomeDenyWritePaths(home, trustedAllowWriteForHome),
  )

  // Git internals in project directory — hooks, config, modules, exclude.
  // densable 2.1.232 #6: project-local glab-cli store (`.git/glab-cli`).
  // densable 2.1.239 #36 CXq: config.lock / config.worktree(+.lock) /
  // commondir / worktrees. G() materializes missing config.worktree on
  // linux/wsl before denyWrite so bwrap does not stub an unreadable hole.
  const projectGitDir = join(originalCwd, '.git')
  const projectWorktreeConfig = join(projectGitDir, 'config.worktree')
  ensureLinuxGitWorktreeConfigPlaceholder(projectWorktreeConfig)
  // Official 2.1.323 #2174: protect `.git/glab-cli` (and materialize placeholder
  // on Linux/WSL if `.git` is a directory so `glab config set` / `glab config edit --local`
  // fail read-only inside the sandbox).
  const projectGlabDir = join(projectGitDir, 'glab-cli')
  ensureLinuxGitWorktreeConfigPlaceholder(projectGlabDir)
  // Official 2.1.323 #2177: protect `.git/worktrees` (and materialize placeholder
  // on Linux/WSL if missing so `git worktree add/move/remove` and commits to
  // ungranted worktrees fail read-only).
  const projectWorktreesDir = join(projectGitDir, 'worktrees')
  denyWrite.push(
    join(projectGitDir, 'hooks'),
    join(projectGitDir, 'config'),
    join(projectGitDir, 'config.lock'),
    projectWorktreeConfig,
    join(projectGitDir, 'config.worktree.lock'),
    join(projectGitDir, 'commondir'),
    projectWorktreesDir,
    join(originalCwd, '.gitmodules'),
    join(projectGitDir, 'info', 'exclude'),
    projectGlabDir,
  )
  pushLinkedWorktreeConfigDenyWrite(denyWrite, projectGitDir)

  // When GITHUB_WORKSPACE differs from cwd (e.g. reusable workflows,
  // composite actions), also protect the workspace's git metadata
  const workspace = process.env.GITHUB_WORKSPACE
  if (workspace && resolve(workspace) !== resolve(originalCwd)) {
    const workspaceGitDir = join(workspace, '.git')
    const workspaceWorktreeConfig = join(workspaceGitDir, 'config.worktree')
    ensureLinuxGitWorktreeConfigPlaceholder(workspaceWorktreeConfig)
    denyWrite.push(
      join(workspaceGitDir, 'hooks'),
      join(workspaceGitDir, 'config'),
      join(workspaceGitDir, 'config.lock'),
      workspaceWorktreeConfig,
      join(workspaceGitDir, 'config.worktree.lock'),
      join(workspaceGitDir, 'commondir'),
      join(workspaceGitDir, 'worktrees'),
      join(workspaceGitDir, 'modules'),
      join(workspaceGitDir, 'info', 'exclude'),
      join(workspaceGitDir, 'glab-cli'),
      join(workspace, '.gitmodules'),
      join(workspace, '.github'),
      join(workspace, '.claude'),
    )
    pushLinkedWorktreeConfigDenyWrite(denyWrite, workspaceGitDir)
  }

  // Deny read access to container runtime sockets — these allow escaping
  // the sandbox by spawning privileged containers on the host
  denyRead.push(...DENY_READ_SOCKET_PATHS)
  denyRead.push(...DENY_READ_ENV_GLOBS)

  // Official 2.1.326 #22: when home or config directory resolves through a
  // symlink into `/net` on Linux/WSL, avoid failing bwrap startup on `/net`
  // autofs denyRead ancestors while preserving literal path protection.
  const filteredDenyRead = filterLinuxNetSymlinkDenyRead(
    denyRead,
    home,
    claudeConfigDir,
  )
  denyRead.length = 0
  denyRead.push(...filteredDenyRead)

  // #200 SEA CXq: ~/.claude/seed-admin holds private git directories of
  // cloud-session /ultrareview uploads — materialize and block both reads and writes.
  const seedAdminDir = join(getClaudeConfigHomeDir(), 'seed-admin')
  try {
    mkdirSync(seedAdminDir, { recursive: true, mode: 0o700 })
  } catch {
    // Best-effort materialization; deny rules still apply.
  }
  denyWrite.push(seedAdminDir)
  denyRead.push(seedAdminDir)
  trustedDenyRoots.push(seedAdminDir)
  try {
    const realSeedAdminDir = realpathSync(seedAdminDir)
    if (realSeedAdminDir !== seedAdminDir) {
      denyWrite.push(realSeedAdminDir)
      denyRead.push(realSeedAdminDir)
      trustedDenyRoots.push(realSeedAdminDir)
    }
  } catch {
    // Directory may not exist if mkdirSync failed.
  }

  // Include directories added via --add-dir CLI flag or /add-dir command.
  // These must be in allowWrite so that Bash commands (which run inside the
  // sandbox) can access them — not just file tools, which check permissions
  // at the app level via pathInAllowedWorkingPath().
  // Two sources: persisted in settings, and session-only in bootstrap state.
  // collectUngatedAdditionalDirectories rather than the merged settings: when
  // autoAllowBashIfSandboxed is on Bash runs unprompted, so this list is the
  // only boundary left, and an untrusted project's additionalDirectories must
  // not widen it just because the app-level gate dropped them elsewhere.
  const worktreePin = getWorktreeAddDirPinState()
  const rawAdditionalDirs = [
    ...collectUngatedAdditionalDirectories(),
    ...getAdditionalDirectoriesForClaudeMd(),
  ]
  const additionalDirs = new Set(
    worktreePin.launchFolder !== undefined
      ? rawAdditionalDirs.map(dir =>
          resolveWorktreeAddDirEntry(
            dir,
            worktreePin.launchFolder!,
            true,
            rel => join(cwd, rel),
          ),
        )
      : rawAdditionalDirs,
  )
  allowWrite.push(...additionalDirs)

  // Official 2.1.325 #2358 (`jf` / `_o`): refuse sandboxed writes to `.claude`
  // settings, skills, agents, commands, hooks, and `.mcp.json` in added
  // directories, matching the launch folder protection.
  for (const addedDir of additionalDirs) {
    if (!addedDir || pathHasGlobChars(addedDir)) continue
    pushProtectedClaudeDirEntries(denyWrite, addedDir)
    if (getPlatform() === 'macos') {
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        const realAddedDir = realpathSync(addedDir)
        if (realAddedDir !== addedDir) {
          pushProtectedClaudeDirEntries(denyWrite, realAddedDir)
        }
      } catch {
        // Directory may not exist yet
      }
    }
  }

  // Official 2.1.323 #2177/#2174 + 2.1.325 #2334/#2335 (`Hf` / `$r`):
  // Protect linked worktrees' shared git folder (`commonDir`), main repo
  // `.claude` settings/hooks, and `<commonDir>/.git` across originalCwd, cwd,
  // cached startup worktree, and any added worktree directories.
  const linkedWorktreeCommonDirs = new Set<string>()
  const worktreeCheckDirs = new Set<string>([originalCwd, cwd])
  for (const addedDir of additionalDirs) {
    if (addedDir && !pathHasGlobChars(addedDir)) {
      worktreeCheckDirs.add(addedDir)
    }
  }
  if (hostState.worktreeMainRepoPath) {
    linkedWorktreeCommonDirs.add(hostState.worktreeMainRepoPath)
  }
  for (const dir of worktreeCheckDirs) {
    const detected = detectWorktreeMainRepoPath(dir)
    if (detected) {
      linkedWorktreeCommonDirs.add(detected)
      // Protect `.git` file inside a linked worktree from tampering
      const wtDotGit = join(dir, '.git')
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        if (lstatSync(wtDotGit).isFile()) {
          denyWrite.push(wtDotGit)
        }
      } catch {
        // Ignore if vanished
      }
    }
  }
  for (const commonDir of linkedWorktreeCommonDirs) {
    if (commonDir !== cwd && !allowWrite.includes(commonDir)) {
      allowWrite.push(commonDir)
    }
    pushGitDirMetadataDenyWrite(denyWrite, commonDir)
    guardWorktreeCommonDirDotGit(denyWrite, commonDir)
    // Also protect the main repo root's `.claude` settings & hooks (#2334)
    if (basename(commonDir) === '.git') {
      const mainRepoRoot = dirname(commonDir)
      if (
        mainRepoRoot &&
        mainRepoRoot !== originalCwd &&
        mainRepoRoot !== cwd
      ) {
        pushProtectedClaudeDirEntries(denyWrite, mainRepoRoot)
      }
    }
  }

  // Iterate through each settings source to resolve paths correctly
  // Path patterns like `/foo` are relative to the settings file directory,
  // so we need to know which source each rule came from
  for (const source of SETTING_SOURCES) {
    const sourceSettings = getSettingsForSource(source)
    // densable 2.1.246 #61 — `--setting-sources` must skip disabled sources
    // (network already did; filesystem/permission rules did not).
    if (!isSettingSourceEnabled(source)) {
      if (sourceSettings?.permissions || sourceSettings?.sandbox?.filesystem) {
        logForDebugging(
          `Sandbox: ignoring permission rules and sandbox.filesystem entries from disabled setting source ${source}`,
          { level: 'info' },
        )
      }
      continue
    }

    // Extract filesystem paths from permission rules
    if (sourceSettings?.permissions) {
      // Allow only — deny is never gated.
      const gatedGrants = isSourceGrantsGated(source)
      for (const ruleString of gatedGrants
        ? []
        : sourceSettings.permissions.allow || []) {
        const rule = permissionRuleValueFromString(ruleString)
        if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
          const resolvedWrite = resolvePathPatternForSandbox(
            rule.ruleContent,
            source,
          )
          allowWrite.push(resolvedWrite)
          if (source === 'projectSettings' || source === 'localSettings') {
            forwardedUntrustedGrants.push({
              literal: resolvedWrite,
              list: 'allowWrite',
            })
          }
        }
      }

      for (const ruleString of sourceSettings.permissions.deny || []) {
        const rule = permissionRuleValueFromString(ruleString)
        if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
          denyWrite.push(resolvePathPatternForSandbox(rule.ruleContent, source))
        }
        if (rule.toolName === FILE_READ_TOOL_NAME && rule.ruleContent) {
          const resolvedDeny = resolvePathPatternForSandbox(
            rule.ruleContent,
            source,
          )
          denyRead.push(resolvedDeny)
          if (
            source === 'policySettings' ||
            source === 'flagSettings' ||
            source === 'userSettings'
          ) {
            trustedDenyRoots.push(resolvedDeny)
          }
        }
      }
    }

    // Extract filesystem paths from sandbox.filesystem settings
    // sandbox.filesystem.* uses standard path semantics (/path = absolute),
    // NOT the permission-rule convention (/path = settings-relative). #30067
    const fs = sourceSettings?.sandbox?.filesystem
    if (fs) {
      for (const p of fs.allowWrite || []) {
        const resolvedWrite = resolveSandboxFilesystemPath(p, source)
        allowWrite.push(resolvedWrite)
        if (source === 'projectSettings' || source === 'localSettings') {
          forwardedUntrustedGrants.push({
            literal: resolvedWrite,
            list: 'allowWrite',
          })
        }
      }
      for (const p of fs.denyWrite || []) {
        denyWrite.push(resolveSandboxFilesystemPath(p, source))
      }
      for (const p of fs.denyRead || []) {
        const resolvedDeny = resolveSandboxFilesystemPath(p, source)
        denyRead.push(resolvedDeny)
        if (
          source === 'policySettings' ||
          source === 'flagSettings' ||
          source === 'userSettings'
        ) {
          trustedDenyRoots.push(resolvedDeny)
        }
      }
      if (!shouldAllowManagedReadPathsOnly() || source === 'policySettings') {
        for (const p of fs.allowRead || []) {
          const resolvedRead = resolveSandboxFilesystemPath(p, source)
          allowRead.push(resolvedRead)
          if (source === 'projectSettings' || source === 'localSettings') {
            forwardedUntrustedGrants.push({
              literal: resolvedRead,
              list: 'allowRead',
            })
          }
        }
      }
    }

    // densable: credentials.files are NOT merged into filesystem.denyRead here.
    // Host convert only path-resolves them onto runtime `credentials` (merge
    // below). Package Gvg/Dou unions WZn(credentials) with filesystem.denyRead
    // at enforcement time (Vzi). When filesystem.disabled, Gvg drops both FS
    // denyRead and credential file denies; env scrub still applies.
  }
  // densable 2.1.232 #48: rkt().map(s => s?.sandbox?.ripgrep).find(...)
  // — policy / flag / user only; project+local must not override the binary.
  // In embedded mode (argv0='rg' dispatch), sandbox-runtime spawns with argv0 set.
  const { rgPath, rgArgs, argv0 } = ripgrepCommand()
  const ripgrepConfig = resolveSandboxRipgrep() ?? {
    command: rgPath,
    args: rgArgs,
    argv0,
  }

  // Official: host-injected CLAUDE_CODE_HOST_*_PROXY_PORT fill sandbox
  // network ports when settings omit them (bwrap --setenv path).
  const hostProxy = readHostProxyPorts()

  // densable credentials merge (files path-resolved; env mask trust gates)
  const credentials = mergeSandboxCredentialsForRuntime()
  recordReadDenyRecheckBaseline({
    trustedDenyRoots,
    forwardedUntrustedGrants,
  })

  // #1120 SEA: include --mcp-config file paths (and resolved targets) in denyWrite
  for (const mcpPath of getFlagMcpConfigFilePaths()) {
    denyWrite.push(mcpPath)
    try {
      const realMcp = realpathSync(mcpPath)
      if (realMcp !== mcpPath) denyWrite.push(realMcp)
    } catch {
      // Target may not exist yet
    }
  }

  // #1128 SEA Ger(): include Anthropic profile store dirs/files in denyWrite
  const profileStore = getProfileStoreDenyPaths()
  if (profileStore !== null) {
    for (const d of profileStore.dirs) {
      denyWrite.push(d)
      try {
        const realD = realpathSync(d)
        if (realD !== d) denyWrite.push(realD)
      } catch {
        // Ignore
      }
    }
    for (const f of profileStore.files) {
      denyWrite.push(f)
      try {
        const realF = realpathSync(f)
        if (realF !== f) denyWrite.push(realF)
      } catch {
        // Ignore
      }
    }
  }

  // Official 2.1.323 #2175 (`N3`): on macOS, Linux, and WSL, ignore write
  // access granted through a symlink inside a writable folder that leads
  // elsewhere or to a missing path; users must grant the real path instead.
  const currentPlat = getPlatform()
  if (
    currentPlat === 'macos' ||
    currentPlat === 'linux' ||
    currentPlat === 'wsl'
  ) {
    const tempDir = getClaudeTempDir()
    for (let i = allowWrite.length - 1; i >= 0; i--) {
      const entry = allowWrite[i]
      if (!entry || entry === '.' || entry === tempDir) continue
      if (isAllowWriteSymlinkEscapingOrDangling(entry, currentPlat)) {
        logForDebugging(
          `[Sandbox] Ignoring allowWrite entry "${entry}": it passes through a symlink leading elsewhere or to a missing path (grant the real path instead)`,
          { level: 'warn' },
        )
        allowWrite.splice(i, 1)
      }
    }
  }

  // #1119 SEA tk/nk: on macOS, expand denyWrite glob patterns whose parent
  // folder is reached through a symlink so Seatbelt denies writes at the real path.
  if (getPlatform() === 'macos') {
    const expanded = expandSymlinkedDenyWriteGlobs(denyWrite)
    denyWrite.length = 0
    denyWrite.push(...expanded)
  }

  // #1272 SEA: apply permissions.blockReadsOutsideWorkingDirectories to sandbox
  // denyRead / allowRead unless allowManagedReadPathsOnly is enabled in policySettings.
  if (
    settingsHaveBlockReadsOutsideWorkingDirectories() &&
    !shouldAllowManagedReadPathsOnly()
  ) {
    const workingDirs = [
      originalCwd,
      ...Array.from(additionalDirs).map(d => expandPath(d)),
    ]
    const nonGlobWorkingDirs = workingDirs.filter(p => !/[*?[\]]/.test(p))
    const inlinePluginRoots = getInlinePluginRoots(originalCwd)
    const inlinePluginRootSet = new Set(inlinePluginRoots)

    // Prevent `bwrap: Can't create file` when a `--plugin-dir` folder is also
    // an added directory (`additionalDirectories`): keep it in `allowRead` and
    // `denyWrite`, not `allowWrite`.
    for (let i = allowWrite.length - 1; i >= 0; i--) {
      const w = allowWrite[i]
      if (
        w !== undefined &&
        inlinePluginRootSet.has(w) &&
        !isPathEqualOrUnder(w, originalCwd)
      ) {
        allowWrite.splice(i, 1)
      }
    }

    // Snapshot pre-existing denyRead entries (expanded) BEFORE adding
    // fenceRoots so reopenCandidates (originalCwd, additionalDirectories,
    // project/memory dirs, explicit Claude subdirs) are only filtered by
    // pre-existing denies and NOT by the fenceRoots we are about to add.
    const existingDenies = denyRead.map(d => {
      try {
        return expandPath(d)
      } catch {
        return d
      }
    })

    const fenceRoots = [
      '~/',
      '/home/',
      '/Users/',
      '/root/',
      '/mnt/',
      '/media/',
      '/run/media/',
      '/Volumes/',
      '/srv/',
    ]
    for (const rawRoot of fenceRoots) {
      const resolvedRoot = expandPath(rawRoot)
      if (nonGlobWorkingDirs.some(wd => isPathEqualOrUnder(wd, resolvedRoot))) {
        continue
      }
      denyRead.push(resolvedRoot)
    }

    const claudeDir = getClaudeConfigHomeDir()
    const projectConfigDir = getProjectDir(originalCwd)
    let autoMemDir: string | undefined
    try {
      const rawAutoMem = resolve(getAutoMemPath())
      if (!/[*?[\]]/.test(rawAutoMem)) {
        autoMemDir = rawAutoMem
      }
    } catch {
      // ignore if auto-memory path cannot be computed
    }
    const reopenCandidates = [
      ...nonGlobWorkingDirs,
      ...inlinePluginRoots.filter(p => !/[*?[\]]/.test(p)),
      ...inlinePluginRoots.flatMap(p => {
        try {
          const real = realpathSync(p)
          return real !== p && !/[*?[\]]/.test(real) ? [real] : []
        } catch {
          return []
        }
      }),
      getClaudeTempDir(),
      ...(!/[*?[\]]/.test(projectConfigDir) ? [projectConfigDir] : []),
      ...(autoMemDir !== undefined ? [autoMemDir] : []),
      join(claudeDir, 'shell-snapshots'),
      join(claudeDir, 'session-env'),
      join(claudeDir, 'skills'),
      join(claudeDir, 'plugins'),
      join(claudeDir, 'rules'),
      join(claudeDir, 'agents'),
      join(claudeDir, 'commands'),
    ]
    for (const candidate of reopenCandidates) {
      if (
        existingDenies.some(
          expandedDeny =>
            !/[*?[\]]/.test(expandedDeny) &&
            isPathEqualOrUnder(expandedDeny, candidate),
        )
      ) {
        continue
      }
      if (!allowRead.includes(candidate)) {
        allowRead.push(candidate)
      }
    }
  }

  // densable Xot()==="relaxed": attach filesystem.disabled + keep full path lists
  // on getConfig(). sandbox-runtime@0.0.70 honors filesystem.disabled natively
  // (Gvg empty / Wvg allowOnly['/'] / Bou skip FS mounts). OUTER getFs* still
  // returns raw diagnostic lists from this stash.
  const filesystemDisabled = resolveSandboxFilesystemDisabled()
  if (filesystemDisabled) {
    hostState.disabledFsDiagnostic = {
      denyRead: [...denyRead],
      allowRead: [...allowRead],
      allowWrite: [...allowWrite],
      denyWrite: [...denyWrite],
    }
  } else {
    hostState.disabledFsDiagnostic = null
  }

  // densable FQt tlsTerminate: policy → flag → enabled userSettings only
  // (project/local ignored). Windows without CA paths: warn + skip ephemeral.
  // densable 2.1.219: strictAllowlist via GDt() sources (policy/flag/user only).
  // Package @anthropic-ai/sandbox-runtime@0.0.70 does not yet read the field;
  // host still stamps it for forward-compat and enforces via ask-callback.
  const strictAllowlist = resolveSandboxStrictAllowlist() || undefined
  const trusted = resolveTrustedSandboxSettings(settings, hostProxy)
  const network: SandboxRuntimeConfig['network'] & {
    strictAllowlist?: boolean
  } = {
    allowedDomains,
    deniedDomains,
    ...(strictAllowlist ? { strictAllowlist: true } : {}),
    allowUnixSockets: trusted.network.allowUnixSockets,
    allowAllUnixSockets: trusted.network.allowAllUnixSockets,
    // densable 2.1.251 #66 qe — network.allowMachLookup (macOS XPC allowlist)
    allowMachLookup: trusted.network.allowMachLookup,
    allowLocalBinding: trusted.network.allowLocalBinding,
    httpProxyPort: trusted.network.httpProxyPort,
    socksProxyPort: trusted.network.socksProxyPort,
  }
  const tlsTerminate = resolveSandboxTlsTerminate()
  if (tlsTerminate !== undefined) {
    if (
      getPlatform() === 'windows' &&
      tlsTerminate.caCertPath === undefined &&
      tlsTerminate.caKeyPath === undefined
    ) {
      logForDebugging(
        '[sandbox] settings tlsTerminate has no caCertPath/caKeyPath; on Windows an ephemeral CA cannot pass srt-win user trust-ca — ignoring until a persistent CA is configured',
        { level: 'warn' },
      )
    } else {
      network.tlsTerminate = tlsTerminate
    }
  }

  // densable Pa: `Nu=!1`; WeakMap.set(Ya, Nu) then return Ya
  // Official 2.1.328 (`chunk@283546038.js@20294`, `chunk@290312616.js@926803`):
  // weakening flags (allowAppleEvents, allowNestedUserNamespaces,
  // enableWeakerNestedSandbox, enableWeakerNetworkIsolation) are read STRICTLY
  // from trusted sources (`policySettings`, `flagSettings`, enabled
  // `userSettings`) — NEVER from `projectSettings` or `localSettings`.
  const config = {
    network,
    filesystem: {
      denyRead,
      allowRead,
      allowWrite,
      denyWrite,
      ...(filesystemDisabled ? { disabled: true as const } : {}),
    },
    ...(credentials !== undefined ? { credentials } : {}),
    ignoreViolations: trusted.ignoreViolations,
    enableWeakerNestedSandbox: trusted.enableWeakerNestedSandbox,
    enableWeakerNetworkIsolation: trusted.enableWeakerNetworkIsolation,
    allowAppleEvents: trusted.allowAppleEvents,
    allowNestedUserNamespaces: trusted.allowNestedUserNamespaces,
    ripgrep: ripgrepConfig,
  }
  rememberBuiltConfigAllowlist(config, false)
  return config
}

function buildRawFsReadConfig(
  cfg: ReturnType<NonNullable<typeof BaseSandboxManager.getConfig>>,
  credPaths: readonly string[],
): FsReadRestrictionConfig {
  const denySet = new Set([
    ...(cfg?.filesystem?.denyRead ?? []).map(stripTrailingGlob),
    ...credPaths.map(stripTrailingGlob),
  ])
  return {
    denyOnly: [...denySet],
    allowWithinDeny: (cfg?.filesystem?.allowRead ?? []).map(stripTrailingGlob),
  }
}

/**
 * densable OUTER getFsReadConfig (~223611065):
 * when getConfig().filesystem.disabled → RAW config denyRead/allowRead
 * (diagnostic; does not include credentials.files — those are package-side
 * WZn/Dou only while isolation is on). Enforcement Gvg is unrestricted when
 * disabled. When isolation on → forward package getFsReadConfig (Gvg).
 *
 * Host keeps a convert-time diagnostic stash so tests / pre-init callers still
 * see raw lists when package getConfig() is not yet populated; shape matches
 * densable `e.filesystem.denyRead` (no credential-file paths).
 */
export function getFsReadConfig(): FsReadRestrictionConfig {
  const hostState = getSandboxHostState()
  const cfg = BaseSandboxManager.getConfig?.()
  if (cfg?.filesystem?.disabled) {
    return {
      denyOnly: cfg.filesystem.denyRead.map(stripTrailingGlob),
      allowWithinDeny: (cfg.filesystem.allowRead ?? []).map(stripTrailingGlob),
    }
  }
  if (resolveSandboxFilesystemDisabled()) {
    if (hostState.disabledFsDiagnostic) {
      return {
        denyOnly: hostState.disabledFsDiagnostic.denyRead,
        allowWithinDeny: hostState.disabledFsDiagnostic.allowRead,
      }
    }
    // convert not yet run — densable empty until hl is set
    return getDisabledSandboxFsReadConfig()
  }
  const fsReadConfigMemo = hostState.fsReadConfigMemo
  if (fsReadConfigMemo !== undefined && fsReadConfigMemo.cfg === cfg) {
    return fsReadConfigMemo.result
  }
  const platform = getPlatform()
  const credFiles =
    (
      cfg as
        | (typeof cfg & {
            credentials?: { files?: Array<{ mode?: string; path: string }> }
          })
        | undefined
    )?.credentials?.files ?? []
  const denyCredPaths = credFiles
    .filter(f => f.mode === 'deny')
    .map(f => f.path)
  // #90 SEA (@286068500): on Linux/WSL, avoid synchronous glob expansion in
  // BaseSandboxManager.getFsReadConfig() when any read rule contains a glob
  // (e.g. `~/**/.env`), which would walk large directory trees and freeze
  // before the first request and in `/sandbox` Config tab.
  if (
    (platform === 'linux' || platform === 'wsl') &&
    [
      ...(cfg?.filesystem?.denyRead ?? []),
      ...(cfg?.filesystem?.allowRead ?? []),
      ...denyCredPaths,
    ].some(p => hasGlobCharacters(stripTrailingGlob(p)))
  ) {
    const result = buildRawFsReadConfig(cfg, denyCredPaths)
    hostState.fsReadConfigMemo = { cfg, result }
    return result
  }
  try {
    const result = BaseSandboxManager.getFsReadConfig()
    hostState.fsReadConfigMemo = { cfg, result }
    return result
  } catch (err) {
    logForDebugging(
      `[sandbox] getFsReadConfig threw; falling back to raw deny lists: ${errorMessage(err)}`,
    )
    const result = buildRawFsReadConfig(
      cfg,
      credFiles.map(f => f.path),
    )
    hostState.fsReadConfigMemo = { cfg, result }
    return result
  }
}

/**
 * densable OUTER getFsWriteConfig:
 * when getConfig().filesystem.disabled → RAW config allowWrite/denyWrite.
 * Enforcement Wvg is unrestricted (allowOnly:['/']) when disabled.
 */
export function getFsWriteConfig(): FsWriteRestrictionConfig {
  const cfg = BaseSandboxManager.getConfig?.()
  if (cfg?.filesystem?.disabled) {
    return {
      allowOnly: [...cfg.filesystem.allowWrite],
      denyWithinAllow: [...cfg.filesystem.denyWrite],
    }
  }
  if (resolveSandboxFilesystemDisabled()) {
    const disabledFsDiagnostic = getSandboxHostState().disabledFsDiagnostic
    if (disabledFsDiagnostic) {
      return {
        allowOnly: disabledFsDiagnostic.allowWrite,
        denyWithinAllow: disabledFsDiagnostic.denyWrite,
      }
    }
    return getDisabledSandboxFsWriteConfig()
  }
  return BaseSandboxManager.getFsWriteConfig()
}

/**
 * densable enforcement-only Gvg/Wvg shapes (unrestricted when disabled).
 * Prefer these for wrap/path-safety when UI must keep raw lists via getFs*.
 */
export function getEnforcementFsReadConfig(): FsReadRestrictionConfig {
  if (resolveSandboxFilesystemDisabled()) {
    return getDisabledSandboxFsReadConfig()
  }
  return BaseSandboxManager.getFsReadConfig()
}

export function getEnforcementFsWriteConfig(): FsWriteRestrictionConfig {
  if (resolveSandboxFilesystemDisabled()) {
    return getDisabledSandboxFsWriteConfig()
  }
  return BaseSandboxManager.getFsWriteConfig()
}
