/**
 * Official Artifact tool env gates (portable).
 * Consumers: ArtifactTool isEnabled (force-on) + call (auto-open browser).
 *
 * densable SEA 2.1.289 `D()` / `I7n()` / `j$()` — withhold chain plus
 * `CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT` bypass of the sdk_default_off arm only.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

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
 * Official R9i densable — CLAUDE_CODE_DISABLE_ARTIFACT env OR
 * settings.disableArtifact.
 */
export function isArtifactToolDisabled(
  env: NodeJS.ProcessEnv = process.env,
  settingsDisableArtifact?: boolean,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_ARTIFACT)) return true
  return settingsDisableArtifact === true
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
