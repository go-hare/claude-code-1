/**
 * Official 2.1.207 auto-mode feature flags (env → GrowthBook → default).
 * Pure resolvers so classifier / transcript / fleet paths can share one source.
 *
 * densable 2.1.236 #22: KD() → frozen qTa when GrowthBook/KIt is false
 * (3P / telemetry-off / DISABLE_GROWTHBOOK), including severityByModel.
 */

import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  isGrowthBookEnabled,
} from '../../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'

/** Official mwg — default edit-removal context cap (chars). */
export const AUTO_MODE_EDIT_REMOVAL_CAP_DEFAULT = 3000

/** Official vDg — default git status truncation limit (chars). */
export const AUTO_MODE_GIT_STATUS_LIMIT_DEFAULT = 2000

/** densable E8f / C8f — clamp fallbacks when severity entry exists but t1/t2 invalid. */
export const AUTO_MODE_SEVERITY_T1_FALLBACK = 15
export const AUTO_MODE_SEVERITY_T2_FALLBACK = 20

export type FlagSource = 'env' | 'gb' | 'default'

export type ResolvedFlag<T> = {
  value: T
  src: FlagSource
}

export type AutoModeSeverityThresholds = {
  t1: number
  t2: number
}

/** GrowthBook tengu_auto_mode_config subset for these knobs. */
export type AutoModeFlagConfig = {
  model?: string
  modelByMainModel?: Record<string, string>
  fallbackModelByModel?: Record<string, string>
  twoStageClassifier?: boolean | 'fast' | 'thinking'
  priorAssistantContext?: boolean
  sameTurnSiblingContext?: boolean
  editRemovalVisibility?: boolean
  editRemovalCap?: number
  gitStatusType?: boolean
  gitStatusUploads?: boolean
  gitStatusTruncationLimit?: number
  outcomeVisibility?: boolean
  classifyEditsModels?: string[]
  repoVisibility?: boolean
  forceExternalPermissions?: boolean
  jsonlTranscript?: boolean
  /** densable qTa.severityByModel — SEA keys only when baked. */
  severityByModel?: Record<string, { t1?: number; t2?: number }>
}

/** densable Eri — empty remote/default sentinel (reference equality in KD). */
export const EMPTY_AUTO_MODE_CONFIG: Readonly<AutoModeFlagConfig> =
  Object.freeze({})

/**
 * densable qTa — baked classifier defaults when !KIt (invent-ban: SEA fields/keys only).
 */
export const BAKED_AUTO_MODE_CONFIG: Readonly<AutoModeFlagConfig> =
  Object.freeze({
    twoStageClassifier: true,
    sameTurnSiblingContext: true,
    jsonlTranscript: true,
    editRemovalVisibility: true,
    editRemovalCap: 3000,
    outcomeVisibility: false,
    repoVisibility: true,
    gitStatusType: true,
    gitStatusUploads: false,
    severityByModel: Object.freeze({
      'claude-sonnet-5[1m]': Object.freeze({ t1: 25, t2: 35 }),
      'claude-opus-4-8[1m]': Object.freeze({ t1: 45, t2: 35 }),
      'claude-sonnet-5': Object.freeze({ t1: 25, t2: 35 }),
      'claude-opus-4-8': Object.freeze({ t1: 45, t2: 35 }),
    }),
  })

/**
 * densable KD — tengu_auto_mode_config with !KIt → qTa fallback.
 * 1. Read GB key with empty Eri default
 * 2. If remote !== Eri → use remote
 * 3. Else if KIt → Eri {}
 * 4. Else → qTa (incl. severityByModel)
 */
export function resolveTenguAutoModeConfig(): AutoModeFlagConfig {
  const remote = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_auto_mode_config',
    EMPTY_AUTO_MODE_CONFIG as AutoModeFlagConfig,
  )
  const config =
    remote && typeof remote === 'object'
      ? (remote as AutoModeFlagConfig)
      : (EMPTY_AUTO_MODE_CONFIG as AutoModeFlagConfig)
  if (config !== EMPTY_AUTO_MODE_CONFIG) {
    return config
  }
  // Incomplete process-global growthbook mocks may omit isGrowthBookEnabled.
  const kitOn =
    typeof isGrowthBookEnabled === 'function' ? isGrowthBookEnabled() : false
  return kitOn
    ? (EMPTY_AUTO_MODE_CONFIG as AutoModeFlagConfig)
    : (BAKED_AUTO_MODE_CONFIG as AutoModeFlagConfig)
}

function readGbConfig(): AutoModeFlagConfig {
  // GrowthBook may be mocked to return null in other suites (process-global
  // mock.module). Treat non-object as empty config so resolvers never throw on
  // `gb.editRemovalVisibility` etc.
  const raw = resolveTenguAutoModeConfig()
  if (raw && typeof raw === 'object') {
    return raw
  }
  return {}
}

function clampSeverityThreshold(value: unknown, fallback: number): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : fallback
}

function severityEntryAt(
  map: Record<string, { t1?: number; t2?: number }> | undefined,
  key: string,
): { t1?: number; t2?: number } | undefined {
  if (map == null || typeof map !== 'object') return undefined
  if (!Object.hasOwn(map, key)) return undefined
  return map[key]
}

/**
 * densable s2v / J8f — resolve severity thresholds for a classifier model.
 * Exact key first; when map is the baked qTa.severityByModel, also try GDr aliases.
 */
export function resolveSeverityThresholds(
  classifierModel: string,
  config: AutoModeFlagConfig = resolveTenguAutoModeConfig(),
): ResolvedFlag<AutoModeSeverityThresholds | null> {
  const map = config.severityByModel
  if (!map) {
    return { value: null, src: 'default' }
  }
  let entry = severityEntryAt(map, classifierModel)
  if (!entry && map === BAKED_AUTO_MODE_CONFIG.severityByModel) {
    for (const alias of getAutoModeModelLookupKeys(classifierModel)) {
      entry = severityEntryAt(map, alias)
      if (entry) break
    }
  }
  if (!entry) {
    return { value: null, src: 'default' }
  }
  return {
    value: {
      t1: clampSeverityThreshold(entry.t1, AUTO_MODE_SEVERITY_T1_FALLBACK),
      t2: clampSeverityThreshold(entry.t2, AUTO_MODE_SEVERITY_T2_FALLBACK),
    },
    src: 'gb',
  }
}

/**
 * Parse optional bool env: unset → undefined; truthy/falsy strings → boolean.
 * Matches official `Jv.X !== void 0` then use parsed bool.
 */
export function parseOptionalEnvBool(
  raw: string | undefined,
): boolean | undefined {
  if (raw === undefined) return undefined
  if (isEnvDefinedFalsy(raw)) return false
  if (isEnvTruthy(raw)) return true
  // Present but empty / unrecognized — treat as unset so GB can apply.
  if (raw.trim() === '') return undefined
  return false
}

export function parseOptionalEnvNumber(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return n
}

function resolveBool(
  envRaw: string | undefined,
  gbValue: unknown,
  defaultValue: boolean,
): ResolvedFlag<boolean> {
  const fromEnv = parseOptionalEnvBool(envRaw)
  if (fromEnv !== undefined) return { value: fromEnv, src: 'env' }
  if (typeof gbValue === 'boolean') return { value: gbValue, src: 'gb' }
  return { value: defaultValue, src: 'default' }
}

function resolveNumber(
  envRaw: string | undefined,
  gbValue: unknown,
  defaultValue: number,
): ResolvedFlag<number> {
  const fromEnv = parseOptionalEnvNumber(envRaw)
  if (fromEnv !== undefined) return { value: fromEnv, src: 'env' }
  if (typeof gbValue === 'number' && Number.isFinite(gbValue)) {
    return { value: gbValue, src: 'gb' }
  }
  return { value: defaultValue, src: 'default' }
}

/** Official VPu / $Qi — include prior assistant text in classifier context. */
export function resolvePriorAssistantContext(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<boolean> {
  return resolveBool(
    env.CLAUDE_CODE_AUTO_MODE_PRIOR_ASSISTANT_CONTEXT,
    gb.priorAssistantContext,
    false,
  )
}

/** Official vZi / hOg — same-turn sibling tool context. */
export function resolveSameTurnSiblingContext(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<boolean> {
  return resolveBool(
    env.CLAUDE_CODE_AUTO_MODE_SIBLING_CONTEXT,
    gb.sameTurnSiblingContext,
    false,
  )
}

/** Official awu / xXn — show edit removals in classifier context. */
export function resolveEditRemovalVisibility(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<boolean> {
  return resolveBool(
    env.CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL,
    gb.editRemovalVisibility,
    false,
  )
}

/** Official cwu / lwu — max chars of edit-removal context. */
export function resolveEditRemovalCap(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<number> {
  return resolveNumber(
    env.CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL_CAP,
    gb.editRemovalCap,
    AUTO_MODE_EDIT_REMOVAL_CAP_DEFAULT,
  )
}

/** Official lPu / SDg — attach git status porcelain type line. */
export function resolveGitStatusType(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<boolean> {
  return resolveBool(
    env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS,
    gb.gitStatusType,
    false,
  )
}

/** Official cPu / EDg — attach git status upload-related signal. */
export function resolveGitStatusUploads(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<boolean> {
  return resolveBool(
    env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS_UPLOADS,
    gb.gitStatusUploads,
    false,
  )
}

/** Official uPu / CDg — truncate git status to this many chars. */
export function resolveGitStatusTruncationLimit(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<number> {
  return resolveNumber(
    env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS_LIMIT,
    gb.gitStatusTruncationLimit,
    AUTO_MODE_GIT_STATUS_LIMIT_DEFAULT,
  )
}

/** Official fPu / sXt — surface automode outcome codes to callers. */
export function resolveOutcomeVisibility(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<boolean> {
  return resolveBool(
    env.CLAUDE_CODE_AUTO_MODE_OUTCOME_CODES,
    gb.outcomeVisibility,
    false,
  )
}

/**
 * Official kkr() lookup keys for model-id sets: if main model ends with [1m],
 * try `base[1m]` then `base`; else just base.
 */
export function getAutoModeModelLookupKeys(mainModel: string): string[] {
  const has1m = /\[1m\]$/i.test(mainModel)
  const base = has1m ? mainModel.replace(/\[1m\]$/i, '') : mainModel
  return has1m ? [`${base}[1m]`, base] : [base]
}

/**
 * Official zDu / VDu — whether FileEdit-like tools should hit the classifier
 * for the given main-loop model. Env is a global bool; GB is a model-id set.
 * Official: `kkr(mainModel).some(id => classifyEditsModels.includes(id))`.
 */
export function resolveClassifyEdits(
  mainModel: string,
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): ResolvedFlag<boolean> {
  const fromEnv = parseOptionalEnvBool(env.CLAUDE_CODE_AUTO_MODE_CLASSIFY_EDITS)
  if (fromEnv !== undefined) return { value: fromEnv, src: 'env' }
  const models = gb.classifyEditsModels
  if (Array.isArray(models) && models.length > 0) {
    const set = new Set(models)
    const hit = getAutoModeModelLookupKeys(mainModel).some(k => set.has(k))
    return { value: hit, src: 'gb' }
  }
  return { value: false, src: 'default' }
}

/**
 * Official KDu / mDg — Edit / Write / NotebookEdit must skip acceptEdits
 * fast-path when classifyEdits is enabled for the main-loop model.
 */
const AUTO_MODE_CLASSIFY_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export function isAutoModeClassifyEditTool(toolName: string): boolean {
  return AUTO_MODE_CLASSIFY_EDIT_TOOLS.has(toolName)
}

/**
 * Official `I = KDu(name) && VDu(mainModel)` — when true, acceptEdits fast-path
 * is suppressed so the classifier evaluates the edit.
 */
export function shouldGateEditClassification(
  toolName: string,
  mainModel: string,
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): boolean {
  return (
    isAutoModeClassifyEditTool(toolName) &&
    resolveClassifyEdits(mainModel, env, gb).value
  )
}

/** Official Eeo — attach repo visibility metadata for exfil-capable git/gh. */
export function resolveRepoVisibility(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): boolean {
  const fromEnv = parseOptionalEnvBool(
    env.CLAUDE_CODE_AUTO_MODE_REPO_VISIBILITY,
  )
  if (fromEnv !== undefined) return fromEnv
  return gb.repoVisibility === true
}

/**
 * Official TOr — FleetView past-sessions search.
 * Env true OR GrowthBook tengu_fleet_past_sessions.
 */
export function isFleetPastSessionsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (parseOptionalEnvBool(env.CLAUDE_CODE_FLEET_PAST_SESSIONS) === true) {
    return true
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_fleet_past_sessions', false)
}

/** Convenience: any git-status enrichment enabled. */
export function isGitStatusEnrichmentEnabled(
  env: NodeJS.ProcessEnv = process.env,
  gb: AutoModeFlagConfig = readGbConfig(),
): boolean {
  return (
    resolveGitStatusType(env, gb).value ||
    resolveGitStatusUploads(env, gb).value
  )
}

/**
 * Official kDg — truncate porcelain git status to limit chars, append
 * "…[+N more lines]" when clipped.
 */
export function truncateGitStatusLines(text: string, limit: number): string {
  const lines = text.split('\n').filter(a => a.length > 0)
  if (limit <= 0) return lines.join('\n')
  let out = ''
  let o = 0
  for (; o < lines.length; o++) {
    const add = (out === '' ? '' : '\n') + lines[o]
    if (out.length + add.length > limit) break
    out += add
  }
  const more = lines.length - o
  if (more === 0) return out
  const suffix = `…[+${more} more lines]`
  return out === '' ? suffix : `${out}\n${suffix}`
}

/**
 * Official xDg — count staged / modified / untracked from porcelain -b lines.
 */
export function countGitStatusPorcelain(text: string): {
  staged: number
  modified: number
  untracked: number
} {
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of text.split('\n')) {
    if (line.length < 2) continue
    const i = line[0]
    const s = line[1]
    if (i === '?' && s === '?') {
      untracked++
      continue
    }
    if (i !== ' ' && i !== '?') staged++
    if (s !== ' ') modified++
  }
  return { staged, modified, untracked }
}

/**
 * Official automode outcome code mapping when outcomeVisibility is on.
 * Portable subset of sXt consumers.
 */
export type AutoModeOutcomeCode =
  | 'automode-unavailable'
  | 'automode-parsing-error'
  | 'automode-blocked'
  | 'permission-rule'

export function mapAutoModeOutcomeCode(input: {
  unavailable?: boolean
  reason?: string
  shouldBlock?: boolean
  fromPermissionRule?: boolean
}): AutoModeOutcomeCode {
  if (input.fromPermissionRule) return 'permission-rule'
  if (input.unavailable) return 'automode-unavailable'
  if (
    input.reason?.startsWith(
      'Auto mode could not evaluate this action and is blocking it for safety',
    )
  ) {
    return 'automode-parsing-error'
  }
  if (input.shouldBlock) return 'automode-blocked'
  return 'permission-rule'
}
