/**
 * densable naming/notification residual pure gates:
 *   tet / tengu_amber_anchor  → "daemon" vs "background service" (rb)
 *   ZFh / tengu_quiet_harbor  → permission notif mode "ask" | "transient"
 *   y1i / tengu_copper_lantern — companion gate (default false)
 *   Fje / tengu_maple_sundial → preference swap (ior: when on prefer alt)
 *
 * Full UI/config consumers remain denser.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

/** densable tet — amber_anchor GB (default false). */
export function isAmberAnchorEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_anchor', false)
}

/** densable y1i — copper_lantern GB (default false). */
export function isCopperLanternEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_copper_lantern', false)
}

/** densable quiet_harbor raw boolean (default false). */
export function isQuietHarborEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_quiet_harbor', false)
}

/**
 * densable ZFh — quiet_harbor dual use in densable:
 *   - exported as daemonColdStartGbDefault: "ask" | "transient"
 *   - GB true → "ask", false → "transient"
 * Used as cold-start / permission notif mode string (not a boolean).
 */
export function quietHarborPermissionNotifMode(
  input: { gbValue?: boolean } = {},
): 'ask' | 'transient' {
  return isQuietHarborEnabled(input) ? 'ask' : 'transient'
}

/** densable export alias — daemonColdStartGbDefault. */
export const daemonColdStartGbDefault = quietHarborPermissionNotifMode

/**
 * densable rb — background process label from amber_anchor.
 * true → "daemon", false → "background service"
 */
export function backgroundServiceLabel(
  input: { amberAnchor?: boolean } = {},
): 'daemon' | 'background service' {
  const on =
    input.amberAnchor !== undefined
      ? input.amberAnchor
      : isAmberAnchorEnabled()
  return on ? 'daemon' : 'background service'
}

/** densable r$ — capitalize first letter. */
export function capitalizeFirst(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** densable tCe — capitalized rb() noun for sentence starts. */
export function backgroundServiceLabelCap(
  input: { amberAnchor?: boolean } = {},
): string {
  return capitalizeFirst(backgroundServiceLabel(input))
}

/**
 * densable T9e — optional daemon subcommand hint when daemon mode available.
 * densable Zvt/Nk is separate; callers pass `daemonAvailable`.
 */
export function daemonCommandHint(
  subcommand: string,
  input: { daemonAvailable?: boolean } = {},
): string {
  if (!input.daemonAvailable) return ''
  return ` — run 'claude daemon ${subcommand}'`
}

/** densable Fje — maple_sundial preference redesign (default false). */
export function isMapleSundialEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_maple_sundial', false)
}

/**
 * densable ior(e,t) — when maple_sundial on, prefer `alt`, else `primary`.
 */
export function mapleSundialPick<T>(primary: T, alt: T, input: { gbValue?: boolean } = {}): T {
  return isMapleSundialEnabled(input) ? alt : primary
}

/**
 * densable lmo — map legacy preferredNotifChannel enum → maple_sundial labels.
 */
export function mapleSundialNotifChannelLabel(
  channel: string,
): string {
  switch (channel) {
    case 'terminal_bell':
      return 'bell'
    case 'iterm2_with_bell':
      return 'iterm2+bell'
    case 'notifications_disabled':
      return 'none'
    default:
      return channel
  }
}

/** densable copper_thistle — MCP background label "job" vs "task". */
export function isCopperThistleEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_copper_thistle', false)
}

/**
 * densable alt mcp_task branch — copper_thistle on → "job", else "task".
 */
export function mcpBackgroundTaskNoun(
  input: { copperThistle?: boolean } = {},
): 'job' | 'task' {
  const on =
    input.copperThistle !== undefined
      ? input.copperThistle
      : isCopperThistleEnabled()
  return on ? 'job' : 'task'
}

/**
 * densable alt mcp_task label: `1 MCP job` / `N MCP jobs` (or task/tasks).
 */
export function formatMcpBackgroundTaskLabel(
  count: number,
  input: { copperThistle?: boolean } = {},
): string {
  const noun = mcpBackgroundTaskNoun(input)
  if (count === 1) return `1 MCP ${noun}`
  return `${count} MCP ${noun}s`
}

/** densable tengu_silk_hinge — message timestamps UI option (default false). */
export function isSilkHingeEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_silk_hinge', false)
}

/**
 * densable Messages residual U — show stamps when setting on AND silk_hinge GB.
 */
export function shouldShowMessageTimestamps(input: {
  showMessageTimestampsSetting: boolean
  silkHinge?: boolean
}): boolean {
  if (!input.showMessageTimestampsSetting) return false
  const hinge =
    input.silkHinge !== undefined ? input.silkHinge : isSilkHingeEnabled()
  return hinge
}

/** densable tengu_amber_lark — usage cost breakdown footer append (default false). */
export function isAmberLarkEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_lark', false)
}

/**
 * densable amber_lark gate + breakdown pure — when GB off or breakdown null → null.
 * Callers pass preformatted densable Ggu string (see usageCostBreakdown).
 */
export function amberLarkBreakdownSuffix(input: {
  amberLark?: boolean
  breakdown: string | null
}): string | null {
  const on =
    input.amberLark !== undefined ? input.amberLark : isAmberLarkEnabled()
  if (!on) return null
  if (!input.breakdown) return null
  return input.breakdown
}

/** densable aAs / tengu_amber_relay (default false). */
export function isAmberRelayEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_relay', false)
}

/** densable tengu_amber_lynx — feedback survey bundle surface (default false). */
export function isAmberLynxEnabled(input: { gbValue?: boolean } = {}): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_lynx', false)
}

/**
 * densable alder_compass tip isRelevant pure half:
 *   numStartups < 10 && !powerupsUnlocked.length && et("tengu_alder_compass", false)
 */
export function isAlderCompassTipRelevant(input: {
  numStartups: number
  powerupsUnlockedLength?: number
  alderCompass?: boolean
}): boolean {
  if (input.numStartups >= 10) return false
  if ((input.powerupsUnlockedLength ?? 0) > 0) return false
  const on =
    input.alderCompass !== undefined
      ? input.alderCompass
      : getFeatureValue_CACHED_MAY_BE_STALE('tengu_alder_compass', false)
  return on
}

/**
 * densable Lra / tengu_birch_lantern — powerup onboarding mode.
 * env CLAUDE_CODE_POWERUP_ONBOARDING ∈ {banner,step} wins; else GB default "off".
 */
export type BirchLanternOnboardingMode = 'banner' | 'step' | 'off'

export function resolveBirchLanternOnboardingMode(input: {
  envValue?: string | undefined
  gbValue?: BirchLanternOnboardingMode
} = {}): BirchLanternOnboardingMode {
  const env =
    input.envValue !== undefined
      ? input.envValue
      : process.env.CLAUDE_CODE_POWERUP_ONBOARDING
  if (env === 'banner' || env === 'step') return env
  if (input.gbValue !== undefined) return input.gbValue
  const gb = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_birch_lantern',
    'off',
  )
  return gb === 'banner' || gb === 'step' || gb === 'off' ? gb : 'off'
}

/** densable PQg / tengu_cloth_snorkel — artifact MCP enable (env wins over GB). */
export function isClothSnorkelArtifactMcpEnabled(input: {
  envValue?: boolean | undefined
  gbValue?: boolean
} = {}): boolean {
  if (input.envValue !== undefined) return input.envValue
  const env = process.env.CLAUDE_CODE_ARTIFACT_MCP
  if (env !== undefined) {
    return env === '1' || env.toLowerCase() === 'true'
  }
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cloth_snorkel', false)
}

/**
 * densable Kv residual pure — reduced motion effective flag.
 * settingsPrefersReducedMotion true → true; else isXtermJs && cedar_marsh GB.
 */
export function isReducedMotionEffective(input: {
  settingsPrefersReducedMotion?: boolean
  isXtermJs?: boolean
  cedarMarsh?: boolean
}): boolean {
  if (input.settingsPrefersReducedMotion) return true
  const xterm = input.isXtermJs ?? false
  if (!xterm) return false
  const marsh =
    input.cedarMarsh !== undefined
      ? input.cedarMarsh
      : getFeatureValue_CACHED_MAY_BE_STALE('tengu_cedar_marsh', false)
  return marsh
}

/**
 * densable XXr residual pure half — remote control at startup when not
 * PM/disabled-path. settings key `remote_control_at_startup` wins over
 * tengu_cobalt_harbor GB (default false).
 */
export function isCobaltHarborRemoteControlAtStartup(input: {
  settingsValue?: boolean | undefined
  gbValue?: boolean
  /** densable PM() / fit() hard-off paths — when true, always false. */
  forceDisabled?: boolean
}): boolean {
  if (input.forceDisabled) return false
  if (input.settingsValue !== undefined) return input.settingsValue
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_harbor', false)
}
