/**
 * Official Artifact tool env gates (portable).
 * Consumers: ArtifactTool isEnabled (force-on) + call (auto-open browser).
 *
 * densable SEA 2.1.289 `D()` / `I7n()` / `j$()` — withhold chain plus
 * `CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT` bypass of the sdk_default_off arm only.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import type { SettingSource } from './settings/constants.js'

/** densable `j$` — SDK host entrypoints. */
const SDK_ARTIFACT_ENTRYPOINTS = new Set(['sdk-ts', 'sdk-py', 'sdk-cli'])

/** densable `D()` withhold strings (SEA 2.1.289). */
export type ArtifactDWithholdReason =
  | 'third_party_provider'
  | 'essential_traffic_only'
  | 'artifact_env_off'
  | 'sdk_default_off'

/**
 * densable `I7n()` — SDK default-off surface:
 * j$() || entrypoint ∈ {claude-code-github-action, mcp}.
 */
export function isSdkArtifactDefaultOffEntrypoint(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  if (typeof entry !== 'string') return false
  return (
    SDK_ARTIFACT_ENTRYPOINTS.has(entry) ||
    entry === 'claude-code-github-action' ||
    entry === 'mcp'
  )
}

/**
 * densable `He()!=="firstParty"` for `D()`. Gold `He` is the USE_* cloud-vendor
 * ladder (plus gateway pin) — JS-truthy env, not isEnvTruthy. OpenAI/Gemini/Grok
 * are not on this gold `He` — do not invent them here.
 */
function isArtifactDThirdPartyProvider(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    env.CLAUDE_CODE_USE_BEDROCK ||
    env.CLAUDE_CODE_USE_FOUNDRY ||
    env.CLAUDE_CODE_USE_ANTHROPIC_AWS ||
    env.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD ||
    env.CLAUDE_CODE_USE_MANTLE ||
    env.CLAUDE_CODE_USE_VERTEX
  ) {
    return true
  }
  if (env !== process.env) return false
  try {
    const { getGatewayAuth } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./gatewayEnv.js') as typeof import('./gatewayEnv.js')
    return Boolean(getGatewayAuth())
  } catch {
    return false
  }
}

/**
 * densable `Tt()` / `Ivt()==="essential-traffic"` for `D()`.
 * JS-truthy `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` only.
 */
function isArtifactDEssentialTrafficOnly(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)
}

/**
 * densable `D()`:
 * 1. He()!=="firstParty" → `third_party_provider`
 * 2. Tt() → `essential_traffic_only`
 * 3. Ss(CLAUDE_CODE_ARTIFACT) → `artifact_env_off`
 * 4. I7n && !Le(ARTIFACT) && !Le(BRIDGE_CHILD_ARTIFACT) → `sdk_default_off`
 *
 * CHILD_ARTIFACT bypasses only the sdk_default_off arm — never He/Tt/Ss, and
 * never a general ASe/cobalt ON.
 */
export function getArtifactSdkDefaultOffReason(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactDWithholdReason | null {
  if (isArtifactDThirdPartyProvider(env)) return 'third_party_provider'
  if (isArtifactDEssentialTrafficOnly(env)) return 'essential_traffic_only'
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_ARTIFACT)) return 'artifact_env_off'
  if (!isSdkArtifactDefaultOffEntrypoint(env)) return null
  if (isEnvTruthy(env.CLAUDE_CODE_ARTIFACT)) return null
  if (isEnvTruthy(env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT)) return null
  return 'sdk_default_off'
}

/** densable `ne()` — true when D() === null. */
export function isArtifactSdkDefaultAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getArtifactSdkDefaultOffReason(env) === null
}

/** Official awy — entrypoints that force direct/inline artifact upload. */
export const ARTIFACT_DIRECT_UPLOAD_ENTRYPOINTS = new Set([
  'remote',
  'remote_cowork',
])

/**
 * densable `C` catalog for `Lht`/`L()`.
 */
const ARTIFACT_LHT_CATALOG = {
  enableKey: 'enableArtifact' as const,
  legacyDisableKey: 'disableArtifact' as const,
  envDisableVar: 'CLAUDE_CODE_DISABLE_ARTIFACT',
  defaultOn: true,
}

const ARTIFACT_LHT_ADMIN: SettingSource[] = [
  'policySettings',
  'flagSettings',
  'userSettings',
]
const ARTIFACT_LHT_PROJECT: SettingSource[] = [
  'localSettings',
  'projectSettings',
]

type ArtifactLhtOff = { layer: string; via: string }

function artifactSettingsRow(
  source: SettingSource,
): { enableArtifact?: boolean; disableArtifact?: boolean } | null {
  try {
    const { getSettingsForSource } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    return getSettingsForSource(source)
  } catch {
    return null
  }
}

function artifactSourceAllowed(source: SettingSource): boolean {
  try {
    const { getAllowedSettingSources } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    return getAllowedSettingSources().includes(source)
  } catch {
    return true
  }
}

/**
 * densable `YWe` — policySettings slot/admin compose present.
 */
function artifactPolicyEnableCounts(): boolean {
  return artifactSettingsRow('policySettings') !== null
}

type ArtifactSettingsRow = {
  enableArtifact?: boolean
  disableArtifact?: boolean
} | null

function machineLocalManagedTiers(): {
  mdm: ArtifactSettingsRow
  file: ArtifactSettingsRow
  hkcu: ArtifactSettingsRow
} {
  try {
    const { collectMachineLocalManagedSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    return collectMachineLocalManagedSettings()
  } catch {
    return { mdm: null, file: null, hkcu: null }
  }
}

/**
 * densable `Ou()`/`DRn`/`B_` — allTiers. No helper/remote: MDM + file, not hkcu.
 */
function artifactPolicyOu(): ArtifactSettingsRow[] {
  const { mdm, file } = machineLocalManagedTiers()
  return [mdm, file].filter(
    (row): row is NonNullable<ArtifactSettingsRow> => row != null,
  )
}

/**
 * densable `mee()`/`ZZr`/`W_` — durableTiers. Admin present → MDM/file;
 * else hkcu. Remote helper still cut.
 */
function artifactPolicyMee(): ArtifactSettingsRow[] {
  const { mdm, file, hkcu } = machineLocalManagedTiers()
  if (mdm || file) {
    return [mdm, file].filter(
      (row): row is NonNullable<ArtifactSettingsRow> => row != null,
    )
  }
  return hkcu != null ? [hkcu] : []
}

/**
 * densable `R("policySettings")` then `[...c, ...mee()]`:
 * `[...Ou(), ge("policySettings"), ...mee()]`.
 */
function artifactPolicyAdminTiers(): ArtifactSettingsRow[] {
  return [
    ...artifactPolicyOu(),
    artifactSettingsRow('policySettings'),
    ...artifactPolicyMee(),
  ]
}

/**
 * densable `wee` — cwd-root localSettings path only when cwd is not the
 * project/git root. No repoTierFreeze host.
 */
function artifactWeeLocalSettingsPath(): string | undefined {
  try {
    const { getCwd } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./cwd.js') as typeof import('./cwd.js')
    const { findCanonicalGitRoot } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./git.js') as typeof import('./git.js')
    const { join, resolve } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('path') as typeof import('path')
    const cwd = resolve(getCwd())
    const gitRoot = findCanonicalGitRoot(cwd)
    if (gitRoot === null || resolve(gitRoot) === cwd) return undefined
    return join(cwd, '.claude', 'settings.local.json')
  } catch {
    return undefined
  }
}

/**
 * densable `Asr` — freeze.legacy if present, else `C$(wee())`. Leftover has
 * no freeze host: parse wee path or null.
 */
function artifactLocalSettingsAsr(): ArtifactSettingsRow {
  const wee = artifactWeeLocalSettingsPath()
  if (!wee) return null
  try {
    const { parseSettingsFile } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    return parseSettingsFile(wee).settings
  } catch {
    return null
  }
}

/**
 * densable `hS` — projectSettings path aliases userSettings.
 */
function artifactProjectAliasesUser(): boolean {
  try {
    const { projectSettingsAliasesUserSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    return projectSettingsAliasesUserSettings()
  } catch {
    return false
  }
}

function collectArtifactLhtOff(
  off: ArtifactLhtOff[],
  layer: string,
  rows: Array<{ enableArtifact?: boolean; disableArtifact?: boolean } | null>,
): void {
  if (rows.some(u => u?.enableArtifact === false)) {
    off.push({ layer, via: 'enableKey' })
  }
  if (rows.some(u => u?.disableArtifact === true)) {
    off.push({ layer, via: 'legacyDisableKey' })
  }
}

/**
 * densable `Lht`/`L(C)` — env / policy / flag / user / local / project ladder.
 * `{enabled: offSources.length===0 && (defaultOn || decided enable)}`.
 */
export function isArtifactLhtEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const off: ArtifactLhtOff[] = []
  if (isEnvTruthy(env[ARTIFACT_LHT_CATALOG.envDisableVar])) {
    off.push({ layer: 'env', via: 'envVar' })
  }
  // Isolated env bags (tests) only apply the env arm — gold Lht reads process
  // settings when `env===process.env`.
  if (env !== process.env) {
    return off.length === 0 && ARTIFACT_LHT_CATALOG.defaultOn
  }
  let decided: string | undefined
  for (const layer of ARTIFACT_LHT_ADMIN) {
    if (!artifactSourceAllowed(layer)) continue
    const row = artifactSettingsRow(layer)
    const rRows =
      layer === 'policySettings' ? [...artifactPolicyOu(), row] : [row]
    collectArtifactLhtOff(
      off,
      layer,
      layer === 'policySettings' ? artifactPolicyAdminTiers() : rRows,
    )
    if (
      decided === undefined &&
      rRows.some(p => p?.enableArtifact === true) &&
      (layer !== 'policySettings' || artifactPolicyEnableCounts())
    ) {
      decided = layer
    }
  }
  for (const layer of ARTIFACT_LHT_PROJECT) {
    if (!artifactSourceAllowed(layer)) continue
    if (layer === 'projectSettings' && artifactProjectAliasesUser()) continue
    const row = artifactSettingsRow(layer)
    collectArtifactLhtOff(
      off,
      layer,
      layer === 'localSettings' ? [row, artifactLocalSettingsAsr()] : [row],
    )
  }
  return (
    off.length === 0 &&
    (ARTIFACT_LHT_CATALOG.defaultOn || decided !== undefined)
  )
}

/**
 * Official R9i densable — CLAUDE_CODE_DISABLE_ARTIFACT env OR
 * settings.disableArtifact. Gold `g()=!Lht().enabled` for M7n switched_off.
 * Optional `settingsDisableArtifact` still OR-ed (callers that already resolved).
 */
export function isArtifactToolDisabled(
  env: NodeJS.ProcessEnv = process.env,
  settingsDisableArtifact?: boolean,
): boolean {
  if (settingsDisableArtifact === true) return true
  return !isArtifactLhtEnabled(env)
}

/**
 * Official CLAUDE_CODE_ARTIFACT force-enable (when not disabled).
 * Unset defaults to enabled for the tool's own isEnabled path.
 */
export function isArtifactEnvForceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isArtifactToolDisabled(env)) return false
  return isEnvTruthy(env.CLAUDE_CODE_ARTIFACT)
}

/**
 * Official CLAUDE_CODE_ARTIFACT_AUTO_OPEN (ou polarity).
 * Default ON when unset; only an explicit falsy value skips auto-open
 * (`auto_open_skipped_env` when ou(env) is true).
 */
export function isArtifactAutoOpenEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isArtifactToolDisabled(env)) return false
  return !isEnvDefinedFalsy(env.CLAUDE_CODE_ARTIFACT_AUTO_OPEN)
}

/**
 * Official skip-reason densable for artifact frame auto-open (207 chain).
 * Returns a telemetry mode string when auto-open should be skipped, else null.
 */
export function planArtifactAutoOpenSkip(input: {
  redeployShared?: boolean
  isBackground?: boolean
  isTeammate?: boolean
  isRemote?: boolean
  pane?: string | null
  env?: NodeJS.ProcessEnv
}): string | null {
  if (input.redeployShared) return 'auto_open_skipped_redeploy'
  if (input.isBackground) return 'auto_open_skipped_bg'
  if (input.isTeammate) return 'auto_open_skipped_teammate'
  if (input.isRemote) return 'auto_open_skipped_remote'
  if (input.pane === 'desktop_pane') return 'auto_open_skipped_desktop'
  if (input.pane === 'epitaxy_pane') return 'auto_open_skipped_vscode'
  if (!isArtifactAutoOpenEnabled(input.env ?? process.env)) {
    return 'auto_open_skipped_env'
  }
  return null
}

type ArtifactDirectUploadInput =
  | NodeJS.ProcessEnv
  | {
      env?: NodeJS.ProcessEnv
      /** tengu_cobalt_plinth_direct */
      gbValue?: boolean
      /** CLAUDE_CODE_ENTRYPOINT (remote / remote_cowork force direct). */
      entrypoint?: string | null
      forceByEntrypoint?: boolean
    }

function splitArtifactDirectUploadInput(input?: ArtifactDirectUploadInput): {
  env: NodeJS.ProcessEnv
  gbValue?: boolean
  forceByEntrypoint: boolean
} {
  if (!input) {
    return { env: process.env, forceByEntrypoint: false }
  }
  // Options bag: only known keys
  if (typeof input === 'object' && !Array.isArray(input)) {
    const keys = Object.keys(input)
    if (
      keys.length > 0 &&
      keys.every(
        k =>
          k === 'env' ||
          k === 'gbValue' ||
          k === 'entrypoint' ||
          k === 'forceByEntrypoint',
      )
    ) {
      const o = input as {
        env?: NodeJS.ProcessEnv
        gbValue?: boolean
        entrypoint?: string | null
        forceByEntrypoint?: boolean
      }
      const ep = o.entrypoint ?? o.env?.CLAUDE_CODE_ENTRYPOINT
      const force =
        o.forceByEntrypoint === true ||
        (typeof ep === 'string' && ARTIFACT_DIRECT_UPLOAD_ENTRYPOINTS.has(ep))
      return {
        env: o.env ?? process.env,
        gbValue: o.gbValue,
        forceByEntrypoint: force,
      }
    }
  }
  // Treat as ProcessEnv
  const env = input as NodeJS.ProcessEnv
  const ep = env.CLAUDE_CODE_ENTRYPOINT
  return {
    env,
    forceByEntrypoint:
      typeof ep === 'string' && ARTIFACT_DIRECT_UPLOAD_ENTRYPOINTS.has(ep),
  }
}

/**
 * Official CLAUDE_CODE_ARTIFACT_DIRECT_UPLOAD || tengu_cobalt_plinth_direct
 * || entrypoint ∈ {remote, remote_cowork}.
 *
 * Accepts either a ProcessEnv (back-compat) or an options bag.
 */
export function isArtifactDirectUploadEnabled(
  input?: ArtifactDirectUploadInput,
): boolean {
  const { env, gbValue, forceByEntrypoint } =
    splitArtifactDirectUploadInput(input)
  if (isArtifactToolDisabled(env)) return false
  if (forceByEntrypoint) return true
  if (isEnvTruthy(env.CLAUDE_CODE_ARTIFACT_DIRECT_UPLOAD)) return true
  return gbValue ?? false
}
