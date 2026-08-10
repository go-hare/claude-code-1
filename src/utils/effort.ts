// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import chalk from 'chalk'
import { getInitialSettings } from './settings/settings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getAPIProvider } from './model/providers.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { isAlwaysEnableEffortEnvEnabled } from './residualFinalEnvGates.js'
import type { EffortLevel } from 'src/entrypoints/sdk/runtimeTypes.js'
import { resolveAntModel } from './model/antModels.js'
import { getAntModelOverrideConfig } from './model/antModels.js'
import {
  isChatGPTAuthMode,
  isChatGPTCodexReasoningModel,
} from './model/chatgptModels.js'
import {
  catalogHasEffort,
  catalogHasMaxEffort,
  catalogHasXhighEffort,
  catalogSupportedLevels,
  clampEffortToOrgLimit,
  filterEffortLevelsByOrgLimit,
  getCatalogDefaultEffort,
  getOrgMaxEffortLevel,
  isEffortDenyListed,
  isEffortLaunchPinned,
  isMaxEffortDenyListed,
  isXhighEffortDenyListed,
  providerDefaultsEffortSupport,
  unpinAllEffortLaunchPins,
} from './model/effortCatalog.js'

export type { EffortLevel }
export { isEffortLaunchPinned, unpinAllEffortLaunchPins }

// NOTE: 'ultracode' is NOT an effort level. It is a session-scoped multi-agent
// orchestration opt-in injected by the harness (claude.ai/client) as a
// system-reminder, orthogonal to the effort parameter. EffortLevel / EffortValue
// must never include 'ultracode'; /effort only accepts the levels below.
export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly EffortLevel[]

export type EffortValue = EffortLevel | number

/**
 * densable Host `apply_flag_settings` pure patch for effortLevel / ultracode.
 * print.ts applies this via setAppState; tests cover without the full CLI.
 *
 * ## Same-packet conflict order (fixed)
 *
 * Keys are applied **effortLevel first, then ultracode** (later key wins for
 * the flag field; ultracode may also overwrite effortValue to catalog wire).
 * This is intentional and stable — Hosts must not rely on JSON key order.
 *
 * | Same-packet keys | Result |
 * |------------------|--------|
 * | only effortLevel normal | wire=that level, ultracode=false, N9 |
 * | only effortLevel null | clear effort, ultracode=false, N9 |
 * | only effortLevel "ultracode" | if wire: top+flag+N9; else **no-op** + note |
 * | only effortLevel unparseable | **no-op** + `effort_level_ignored` note |
 * | only ultracode:true | if wire: top+flag+N9; else force false + note |
 * | only ultracode:false | flag=false (effortValue untouched) |
 * | effortLevel normal + ultracode:false | wire + flag false (idempotent) |
 * | effortLevel normal + ultracode:true | ultracode block **overwrites** → top wire + flag |
 * | effortLevel "ultracode" + ultracode:false | alias opens then false **wins** → wire top kept, flag false |
 * | effortLevel "ultracode" + ultracode:true | same as open (wire+flag) |
 * | effortLevel null + ultracode:true | clear then ultra open → top+flag if wire |
 * | effortLevel garbage + ultracode:true | ignore effort + open ultra if wire |
 *
 * ## No-wire Host feedback (product decision)
 *
 * **Do not hard-fail** `apply_flag_settings` (`control_response` error).
 * Reasons:
 * 1. Multi-key merge: model / other flags may already be applied in the same
 *    request before effort resolution — a hard error would leave partial state
 *    with a failed request_id (worse for Host reconcilers).
 * 2. densable bootstrap / settings path also soft-refuses empty ultracode flag
 *    rather than aborting the whole settings apply.
 * 3. Authoritative UI state is always `get_settings.applied` after apply.
 *
 * Instead: still return **success**, and surface soft refusals in
 * `response.effortNotes` (see HostEffortFlagNote). Hosts that care about
 * "user asked ultracode but model has no wire" should read notes and/or
 * re-query `applied.ultracode` / `applied.ultracodeOfferable`.
 *
 * Rules (align bootstrap + applySettingsChange):
 * - null effortLevel → clear effortValue + ultracode flag + N9
 * - normal effortLevel → set wire + clear ultracode + N9
 * - effortLevel "ultracode" → only if model has wire; else no-op (no empty flag) + note
 * - ultracode true → only if wire; else force ultracode false + note
 * - ultracode false → clear flag (keep effortValue)
 */
export type HostEffortFlagNoteCode =
  /** effortLevel:"ultracode" but model has no catalog wire — patch left empty */
  | 'ultracode_alias_no_wire'
  /** ultracode:true but model has no catalog wire — forced flag false */
  | 'ultracode_true_no_wire'
  /**
   * Same packet had both effortLevel (non-alias) and ultracode:true with wire:
   * ultracode overwrote effortValue to catalog top tier.
   */
  | 'same_packet_ultracode_overrode_effort'
  /**
   * Same packet: effortLevel "ultracode" opened flag+wire, then ultracode:false
   * cleared flag (wire top effort may remain).
   */
  | 'same_packet_ultracode_false_after_alias'
  /**
   * effortLevel present but not null/alias/parseable EffortValue — ignored
   * (soft success; same as no-wire refusals, not control error).
   */
  | 'effort_level_ignored'

export type HostEffortFlagNote = {
  code: HostEffortFlagNoteCode
  message: string
}

export type HostEffortFlagPatch = {
  effortValue?: EffortValue | undefined
  ultracode?: boolean
  clearEffort?: boolean
  unpin?: boolean
  /** Soft refusals / conflict resolutions for Host (never hard-fail). */
  notes?: HostEffortFlagNote[]
}

function pushNote(
  patch: HostEffortFlagPatch,
  code: HostEffortFlagNoteCode,
  message: string,
): void {
  if (!patch.notes) patch.notes = []
  patch.notes.push({ code, message })
}

export function resolveHostEffortFlagPatch(args: {
  model: string
  effortLevel?: unknown
  hasEffortLevel?: boolean
  ultracode?: unknown
  hasUltracode?: boolean
}): HostEffortFlagPatch {
  const patch: HostEffortFlagPatch = {}
  const hasEffort = args.hasEffortLevel === true
  const hasUltra = args.hasUltracode === true

  // Snapshot pre-ultra effort intent for conflict notes (effort applied first).
  let effortOpenedUltraAlias = false
  let effortSetNormalLevel = false

  if (hasEffort) {
    const raw = args.effortLevel
    if (raw == null) {
      patch.clearEffort = true
      patch.ultracode = false
      patch.unpin = true
    } else if (isUltracodeEffortAlias(raw)) {
      const wire = getUltracodeEffortForModel(args.model)
      if (wire !== undefined) {
        patch.effortValue = wire
        patch.ultracode = true
        patch.unpin = true
        effortOpenedUltraAlias = true
      } else {
        // no wire → refuse empty ultracode flag (matches bootstrap/settings)
        pushNote(
          patch,
          'ultracode_alias_no_wire',
          `effortLevel "ultracode" ignored: model ${args.model} has no effort catalog wire (no empty ultracode flag).`,
        )
      }
    } else {
      const wire = parseEffortValue(raw)
      if (wire !== undefined) {
        patch.effortValue = wire
        patch.ultracode = false
        patch.unpin = true
        effortSetNormalLevel = true
      } else {
        // Unparseable effortLevel (not null / not ultracode alias) — soft ignore.
        // Hosts should re-query get_settings.applied; do not hard-fail the packet.
        pushNote(
          patch,
          'effort_level_ignored',
          `effortLevel ${JSON.stringify(raw)} ignored: not a known EffortLevel or ultracode alias.`,
        )
      }
    }
  }

  // ultracode key always runs second — later key wins for the flag; may
  // overwrite effortValue when turning on with wire.
  if (hasUltra) {
    const on = args.ultracode === true
    if (on) {
      const wire = getUltracodeEffortForModel(args.model)
      if (wire !== undefined) {
        if (
          effortSetNormalLevel &&
          patch.effortValue !== undefined &&
          patch.effortValue !== wire
        ) {
          pushNote(
            patch,
            'same_packet_ultracode_overrode_effort',
            `Same packet: ultracode:true overrode effortLevel to catalog wire "${wire}" (effortLevel applied first, ultracode second).`,
          )
        }
        patch.effortValue = wire
        patch.ultracode = true
        patch.unpin = true
      } else {
        patch.ultracode = false
        pushNote(
          patch,
          'ultracode_true_no_wire',
          `ultracode:true refused: model ${args.model} has no effort catalog wire; forced ultracode=false (soft success, not control error).`,
        )
      }
    } else {
      patch.ultracode = false
      if (effortOpenedUltraAlias) {
        pushNote(
          patch,
          'same_packet_ultracode_false_after_alias',
          'Same packet: effortLevel "ultracode" opened wire+flag, then ultracode:false cleared the flag (wire effort may remain at catalog top).',
        )
      }
    }
  }

  return patch
}

/**
 * densable kk — whether the model accepts output_config.effort.
 */
export function modelSupportsEffort(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (isEffortDenyListed(model)) {
    return false
  }
  if (isAlwaysEnableEffortEnvEnabled()) {
    return true
  }
  // Fork: ChatGPT Codex reasoning models expose effort-like controls.
  if (
    getAPIProvider() === 'openai' &&
    isChatGPTAuthMode() &&
    isChatGPTCodexReasoningModel(model)
  ) {
    return true
  }
  const catalog = catalogHasEffort(model)
  if (catalog !== undefined) {
    return catalog
  }
  if (getEffortCanonicalMythos(model)) {
    return true
  }
  // densable Uq(Nb): Anthropic-style providers default true for unknown strings.
  return providerDefaultsEffortSupport()
}

function getEffortCanonicalMythos(model: string): boolean {
  return model.toLowerCase().includes('mythos-5')
}

/** densable h4e */
export function modelSupportsMaxEffort(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'max_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (isMaxEffortDenyListed(model)) {
    return false
  }
  const catalog = catalogHasMaxEffort(model)
  if (catalog !== undefined) {
    return catalog
  }
  if (getEffortCanonicalMythos(model)) {
    return true
  }
  return providerDefaultsEffortSupport()
}

/** densable ume */
export function modelSupportsXhighEffort(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'xhigh_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (isXhighEffortDenyListed(model)) {
    return false
  }
  const catalog = catalogHasXhighEffort(model)
  if (catalog !== undefined) {
    return catalog
  }
  if (getEffortCanonicalMythos(model)) {
    return true
  }
  return providerDefaultsEffortSupport()
}

/**
 * Capability ladder only (no org MDe filter).
 * Used by clamp/resolve/ultracode wire so densable cme can still receive
 * requested levels above org cap and clamp via wve — Ulc needs the pre-org value.
 */
export function getCapabilitySupportedEffortLevels(
  model: string,
): EffortLevel[] {
  if (!modelSupportsEffort(model)) {
    return []
  }
  const fromCatalog = catalogSupportedLevels(model)
  if (fromCatalog !== undefined) {
    return fromCatalog
  }
  return EFFORT_LEVELS.filter(level => {
    if (level === 'max') return modelSupportsMaxEffort(model)
    if (level === 'xhigh') return modelSupportsXhighEffort(model)
    return true
  })
}

/**
 * Supported effort ladder for UI + /effort help (densable MDe).
 * Capability levels filtered by org maxEffortLevel (g4e) when present.
 * API resolve uses clampEffortForModel → clampEffortToOrgLimit instead.
 */
export function getSupportedEffortLevels(model: string): EffortLevel[] {
  return filterEffortLevelsByOrgLimit(
    getCapabilitySupportedEffortLevels(model),
    model,
  )
}

/**
 * densable Ulc(requested, model) — bootstrap org-exceed message, or null.
 * When requested string effort exceeds org maxEffortLevel, warn with the
 * post-cme clamped value that will actually apply.
 */
export function formatOrgEffortExceedMessage(
  requested: EffortValue | undefined,
  model: string,
): string | null {
  if (typeof requested !== 'string' || !isEffortLevel(requested)) {
    return null
  }
  const cap = getOrgMaxEffortLevel(model)
  if (cap === null) return null
  // densable: HQe(e) <= HQe(r) → null
  const order = EFFORT_LEVELS as readonly EffortLevel[]
  if (order.indexOf(requested) <= order.indexOf(cap)) {
    return null
  }
  // densable: n = cme(t, e) ?? r
  const using = resolveAppliedEffort(model, requested) ?? cap
  return `Effort '${requested}' exceeds your organization's limit for ${model}; using '${using}'.`
}

/**
 * densable Ulc emit after QBn: Q6 yellow stderr unless json/stream-json/bg.
 * densable else branch: C(`[effort] ${on}`, {level:"warn"}).
 */
export function emitOrgEffortExceedWarning(
  requested: EffortValue | undefined,
  model: string,
  opts?: {
    outputFormat?: string
    sessionKind?: string | null
  },
): void {
  const msg = formatOrgEffortExceedMessage(requested, model)
  if (msg === null) return
  const format = opts?.outputFormat
  const sessionKind =
    opts?.sessionKind ?? process.env.CLAUDE_CODE_SESSION_KIND ?? null
  if (format !== 'json' && format !== 'stream-json' && sessionKind !== 'bg') {
    // densable Q6: yellow + newline
    process.stderr.write(chalk.yellow(msg) + '\n')
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logForDebugging } =
        require('./debug.js') as typeof import('./debug.js')
      logForDebugging(`[effort] ${msg}`, { level: 'warn' })
    } catch {
      // optional in isolated tests
    }
  }
}

/**
 * densable ultracode wire effort (sLy uses xhigh when ume allows).
 * Prefer xhigh when on the catalog ladder; otherwise the highest supported
 * tier (max → high → medium → low). Ultracode is NOT an EffortLevel —
 * orchestration is separate; wire must still follow per-model catalog.
 */
export function getUltracodeEffortForModel(
  model: string,
): EffortLevel | undefined {
  // densable UBn → "xhigh" without org; cme/wve clamp later. Use capability
  // ladder only so settings.ultracode still surfaces Ulc when org caps below.
  const levels = getCapabilitySupportedEffortLevels(model)
  if (levels.length === 0) return undefined
  if (levels.includes('xhigh')) return 'xhigh'
  for (let i = EFFORT_LEVELS.length - 1; i >= 0; i--) {
    const cand = EFFORT_LEVELS[i]!
    if (levels.includes(cand)) return cand
  }
  return levels[levels.length - 1]
}

/**
 * densable XLr — CLI/settings effort aliases that are not EffortLevels.
 * Currently only `ultracode` (maps via UBn-shaped resolve below).
 */
export function isUltracodeEffortAlias(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'ultracode'
}

/**
 * densable UBn-shaped alias → wire effort.
 * densable hardcodes ultracode→xhigh; we map to catalog top tier for the model.
 */
export function resolveUltracodeAliasWire(
  model: string,
): EffortLevel | undefined {
  return getUltracodeEffortForModel(model)
}

/**
 * densable Qwi(cli, settings) adapted for multi-model catalog wire:
 *   M9(cli.effort) ?? UBn(cli.effort)
 *   if settings.ultracode → catalog wire (densable: always "xhigh")
 *   else f4e(settings.effortLevel)
 *
 * densable QBn side-effect: parseable CLI effort (M9) → N9 unpin.
 * (sAi also unpins for ultracode — see resolveBootstrapUltracodeFlag.)
 *
 * Does not set AppState.ultracode — use resolveBootstrapUltracodeFlag.
 */
export function resolveBootstrapEffortValue(args: {
  cliEffort?: string | undefined
  settingsUltracode?: boolean | undefined
  settingsEffortLevel?: EffortLevel | undefined
  model: string
}): EffortValue | undefined {
  const parsedCli = parseEffortValue(args.cliEffort)
  if (parsedCli !== undefined) {
    // densable QBn: if (M9(cli) !== undefined) N9()
    unpinAllEffortLaunchPins()
    return parsedCli
  }
  if (isUltracodeEffortAlias(args.cliEffort)) {
    // densable UBn → xhigh; fork → catalog top tier (may be high on grok).
    // No wire for this model → undefined (do not fall through to settings).
    // Unpin here too so Qwi alone (without sAi) cannot leave pin active.
    const wire = resolveUltracodeAliasWire(args.model)
    if (wire !== undefined) {
      unpinAllEffortLaunchPins()
    }
    return wire
  }
  if (args.settingsUltracode === true) {
    return resolveUltracodeAliasWire(args.model)
  }
  return toPersistableEffort(args.settingsEffortLevel)
}

/**
 * densable sAi(cliEffort): settings.ultracode || XLr(cli)==="ultracode".
 * densable side-effect: when true, N9 unpins all launch defaults.
 *
 * Fork: if model is known and has no ultracode wire tier, return false so we
 * never raise an empty ultracode flag (densable only offers xhigh-capable models).
 */
export function resolveBootstrapUltracodeFlag(args: {
  cliEffort?: string | undefined
  settingsUltracode?: boolean | undefined
  /** When provided, refuse flag if model has no catalog ultracode wire. */
  model?: string
}): boolean {
  const wants =
    args.settingsUltracode === true || isUltracodeEffortAlias(args.cliEffort)
  if (!wants) return false
  if (
    args.model !== undefined &&
    args.model !== '' &&
    getUltracodeEffortForModel(args.model) === undefined
  ) {
    return false
  }
  unpinAllEffortLaunchPins()
  return true
}

/**
 * densable gY-shaped offerable (fork: no xhigh-only org hard-reject):
 * FE() workflows feature on AND model has a catalog ultracode wire tier.
 *
 * Same FE gate as keyword attachments (policy allow_workflows + disable +
 * available + enableWorkflows), so panel / /effort ultracode / Dee stay
 * consistent with workflow_keyword_request.
 */
export function isUltracodeOfferable(model: string): boolean {
  try {
    const { isWorkflowFeatureEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./workflowDisableGate.js') as typeof import('./workflowDisableGate.js')
    const settings = getInitialSettings()
    if (
      !isWorkflowFeatureEnabled(process.env, {
        settingsDisableWorkflows: settings.disableWorkflows,
        enableWorkflows: settings.enableWorkflows,
      })
    ) {
      return false
    }
  } catch {
    // Gate module optional in some test stubs — treat as unavailable.
    return false
  }
  return getUltracodeEffortForModel(model) !== undefined
}

/**
 * densable Dee(model, appStateEffort, ultracodeFlag) adapted for catalog:
 * flag on + workflows on + resolved wire effort equals catalog ultracode tier.
 * densable required cme === "xhigh"; we require the model-specific top tier.
 */
export function isUltracodeModeActive(
  model: string,
  appStateEffort: EffortValue | undefined,
  ultracodeFlag: boolean | undefined,
): boolean {
  if (ultracodeFlag !== true) return false
  if (!isUltracodeOfferable(model)) return false
  const wire = getUltracodeEffortForModel(model)
  if (wire === undefined) return false
  const applied = resolveAppliedEffort(model, appStateEffort)
  return applied === wire
}

/**
 * Clamp a chosen effort onto the model's supported ladder.
 *
 * densable Claude: unsupported max/xhigh → high.
 * Custom ladders (DeepSeek high|max, Kimi low|high|max, Grok low|med|high):
 * map to nearest tier by EFFORT_LEVELS order (prefer lower or equal, else higher).
 * DeepSeek official compat: xhigh → max (when max is supported and xhigh is not).
 */
export function clampEffortForModel(
  value: EffortValue,
  model: string,
): EffortValue {
  if (typeof value !== 'string') {
    return value
  }
  // Capability ladder first (densable max/xhigh→high), then org wve.
  // Do not use MDe-filtered getSupportedEffortLevels here — that would
  // pre-hide org-exceeding levels and skip densable Ulc messaging paths.
  const supported = getCapabilitySupportedEffortLevels(model)
  if (supported.length === 0) {
    return clampEffortToOrgLimit(value, model)
  }
  if (supported.includes(value)) {
    return clampEffortToOrgLimit(value, model)
  }

  // Official DeepSeek / Kimi-style: xhigh → max when max exists and xhigh does not
  // and the ladder is not densable-style (densable keeps medium).
  if (
    value === 'xhigh' &&
    !supported.includes('xhigh') &&
    supported.includes('max') &&
    !supported.includes('medium')
  ) {
    return clampEffortToOrgLimit('max', model)
  }

  // Kimi-style (low|high|max): medium is not an API value → high
  if (
    value === 'medium' &&
    !supported.includes('medium') &&
    supported.includes('high')
  ) {
    return clampEffortToOrgLimit('high', model)
  }

  // densable: max/xhigh without capability → high when high is available
  if (
    (value === 'max' || value === 'xhigh') &&
    supported.includes('high') &&
    !supported.includes(value)
  ) {
    return clampEffortToOrgLimit('high', model)
  }

  // Nearest tier on full order: walk down then up from requested index
  const order = EFFORT_LEVELS as readonly EffortLevel[]
  const idx = order.indexOf(value)
  if (idx >= 0) {
    for (let i = idx; i >= 0; i--) {
      const cand = order[i]!
      if (supported.includes(cand)) {
        return clampEffortToOrgLimit(cand, model)
      }
    }
    for (let i = idx + 1; i < order.length; i++) {
      const cand = order[i]!
      if (supported.includes(cand)) {
        return clampEffortToOrgLimit(cand, model)
      }
    }
  }

  const fallback =
    supported.find(l => l === 'high') ??
    supported[supported.length - 1] ??
    supported[0]!
  return clampEffortToOrgLimit(fallback, model)
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

/**
 * densable `Ie` capture for assistant transcript stamping (2.1.212 #44).
 *
 * densable (paramsFromContext / queryModel):
 * ```js
 * let ra = Qa.output_config?.effort
 * Ie = typeof ra === "string" && MPe(ra) ? ra : void 0
 * ```
 * Only string wire levels in AR (`MPe` ≡ `isEffortLevel`) are recorded.
 * Numeric `effort_override` (ant-only) is intentionally NOT stamped.
 */
export function transcriptEffortFromOutputConfig(
  outputConfig: { effort?: unknown } | null | undefined,
): EffortLevel | undefined {
  const ra = outputConfig?.effort
  return typeof ra === 'string' && isEffortLevel(ra) ? ra : undefined
}

/**
 * densable qlc — CLI/settings effort string aliases that are not EffortLevels.
 * `med` → `medium` (densable only; keep table explicit so we do not invent more).
 */
const EFFORT_STRING_ALIASES: Readonly<Record<string, EffortLevel>> = {
  med: 'medium',
}

/**
 * densable ZSt — string → EffortLevel after qlc alias, no numeric.
 * Used by CLI soft-parse (YBn) before alias/ultracode (XLr).
 */
export function parseEffortLevelString(value: string): EffortLevel | undefined {
  const raw = value.trim().toLowerCase()
  const aliased = EFFORT_STRING_ALIASES[raw] ?? raw
  return isEffortLevel(aliased) ? aliased : undefined
}

/**
 * densable YBn — CLI `--effort` soft parser.
 * Known level (incl. `med`) or ultracode alias → {level}; unknown → warning + ignore.
 * densable warning lists cH only (not ultracode); ultracode is accepted via XLr.
 */
export function parseCliEffortArg(raw: string): {
  level: string | undefined
  warning: string | undefined
} {
  const level = parseEffortLevelString(raw)
  if (level !== undefined) {
    return { level, warning: undefined }
  }
  if (isUltracodeEffortAlias(raw)) {
    return { level: 'ultracode', warning: undefined }
  }
  return {
    level: undefined,
    warning: `Unknown --effort value '${raw}' — ignoring it and using the default effort. Valid values: ${EFFORT_LEVELS.join(', ')}.`,
  }
}

export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && isValidNumericEffort(value)) {
    return value
  }
  // densable M9: String(e).toLowerCase(), then qlc[t]??t, then DQe / numeric.
  const str = String(value).trim().toLowerCase()
  const aliased = EFFORT_STRING_ALIASES[str] ?? str
  if (isEffortLevel(aliased)) {
    return aliased
  }
  const numericValue = parseInt(str, 10)
  if (!isNaN(numericValue) && isValidNumericEffort(numericValue)) {
    return numericValue
  }
  return undefined
}

/**
 * Numeric values are model-default only and not persisted.
 * 'max' is session-scoped for external users (ants can persist it).
 * Write sites call this before saving to settings so the Zod schema
 * (which only accepts string levels) never rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value
  }
  if (value === 'max' && process.env.USER_TYPE === 'ant') {
    return value
  }
  return undefined
}

export function getInitialEffortSetting(): EffortLevel | undefined {
  // toPersistableEffort filters 'max' for non-ants on read, so a manually
  // edited settings.json doesn't leak session-scoped max into a fresh session.
  return toPersistableEffort(getInitialSettings().effortLevel)
}

/**
 * Decide what effort level (if any) to persist when the user selects a model
 * in ModelPicker. Keeps an explicit prior /effort choice sticky even when it
 * matches the picked model's default, while letting purely-default and
 * session-ephemeral effort (CLI --effort, EffortCallout default) fall through
 * to undefined so it follows future model-default changes.
 *
 * priorPersisted must come from userSettings on disk
 * (getSettingsForSource('userSettings')?.effortLevel), NOT merged settings
 * (project/policy layers would leak into the user's global settings.json)
 * and NOT AppState.effortValue (includes session-scoped sources that
 * deliberately do not write to settings.json).
 */
export function resolvePickerEffortPersistence(
  picked: EffortLevel | undefined,
  modelDefault: EffortLevel,
  priorPersisted: EffortLevel | undefined,
  toggledInPicker: boolean,
): EffortLevel | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== modelDefault ? picked : undefined
}

export function getEffortEnvOverride(): EffortValue | null | undefined {
  // Official EFFORT_LEVEL densable pure parse (resolveEffortLevelOverride).
  let envOverride: string | null | undefined
  try {
    const { resolveEffortLevelOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    envOverride = resolveEffortLevelOverride()
  } catch {
    envOverride = process.env.CLAUDE_CODE_EFFORT_LEVEL?.toLowerCase() ?? null
  }
  if (envOverride === null || envOverride === undefined || envOverride === '') {
    return undefined
  }
  // auto/unset mapping densable at call sites — suppress effort param.
  if (envOverride === 'unset' || envOverride === 'auto') {
    return null
  }
  return parseEffortValue(envOverride)
}

/**
 * densable cme(model, appStateEffort) — single resolve path for API + UI.
 *
 * ```
 * if !supports → undefined
 * env = CLAUDE_CODE_EFFORT_LEVEL (auto/unset → null)
 * if env===null && !pin → undefined
 * s = env ?? (pin ? modelDefault : undefined) ?? appState ?? modelDefault
 * clamp org + max/xhigh capability
 * ```
 */
export function resolveAppliedEffort(
  model: string,
  appStateEffortValue: EffortValue | undefined,
): EffortValue | undefined {
  const supports = modelSupportsEffort(model)
  const envOverride = getEffortEnvOverride()

  // Fork: OpenAI-compatible stack can still send explicit reasoning_effort for
  // custom model strings that fail Claude-family heuristics. Only honor an
  // explicit env/session override (never invent a catalog default).
  // Skip Claude max/xhigh capability clamp — OpenAI reasoning_effort accepts
  // low|medium|high|xhigh for custom model strings.
  if (!supports) {
    if (getAPIProvider() !== 'openai') {
      return undefined
    }
    if (envOverride === null) {
      return undefined
    }
    const explicit = envOverride ?? appStateEffortValue
    if (explicit === undefined) {
      return undefined
    }
    return explicit
  }

  const pin = isEffortLaunchPinned(model)
  const modelDefault = getDefaultEffortForModel(model)

  // densable: env auto/unset suppresses unless launch-pinned
  if (envOverride === null && !pin) {
    return undefined
  }

  let selected: EffortValue | undefined =
    envOverride === null
      ? undefined
      : (envOverride ??
        (pin ? modelDefault : undefined) ??
        appStateEffortValue ??
        modelDefault)

  // When pin and env is null, densable uses modelDefault (env null && pin continues)
  if (envOverride === null && pin) {
    selected = modelDefault
  }

  if (selected === undefined) {
    return undefined
  }

  return clampEffortForModel(selected, model)
}

/**
 * Resolve the effort level to show the user. Wraps resolveAppliedEffort
 * with the 'high' fallback (what the API uses when no effort param is sent).
 * Single source of truth for the status bar and /effort output (CC-1088).
 */
export function getDisplayedEffortLevel(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel {
  const resolved = resolveAppliedEffort(model, appStateEffort) ?? 'high'
  return convertEffortValueToLevel(resolved)
}

/**
 * Whether effort-related UI should be shown for the current model.
 *
 * OpenAI-compatible requests can carry explicit `reasoning_effort` even for
 * custom model strings, so an explicit env or session override must remain
 * visible in the UI even when the Claude-family heuristic cannot classify the
 * model as supporting effort.
 */
export function shouldShowEffortUI(
  model: string,
  appStateEffort: EffortValue | undefined,
): boolean {
  if (modelSupportsEffort(model)) {
    return true
  }
  if (getAPIProvider() === 'openai') {
    const envOverride = getEffortEnvOverride()
    return envOverride !== undefined || appStateEffort !== undefined
  }
  return false
}

/**
 * densable Spinner effort source: `But(h??Zi(), m??F)`.
 *
 * - `F` = session `appState.effortValue`
 * - `m` = turnEffort (densable per-agent spinner store / LocalAgentTask.effort)
 * - `h` = turnModel (agent model stamp)
 * - `Zi` = main-loop model
 *
 * 2.1.222 #13: subagent transcript spinner must show the agent's own
 * `effort:` setting, not the parent session effort.
 */
export function resolveSpinnerEffortSource(args: {
  sessionEffort: EffortValue | undefined
  sessionModel: string
  viewingAgentTaskId?: string | null
  tasks?: Record<string, unknown> | null
}): { model: string; effortValue: EffortValue | undefined } {
  const { sessionEffort, sessionModel, viewingAgentTaskId, tasks } = args
  if (!viewingAgentTaskId || !tasks) {
    return { model: sessionModel, effortValue: sessionEffort }
  }
  const raw = tasks[viewingAgentTaskId]
  if (!raw || typeof raw !== 'object') {
    return { model: sessionModel, effortValue: sessionEffort }
  }
  const task = raw as {
    type?: string
    effort?: EffortValue
    model?: string
    selectedAgent?: { effort?: EffortValue; model?: string }
  }
  // densable UCa(agentId) is for agent surfaces; local_agent stamps effort at register.
  // In-process teammates do not carry frontmatter effort — keep session F.
  if (task.type !== 'local_agent') {
    return { model: sessionModel, effortValue: sessionEffort }
  }
  const turnEffort =
    task.effort !== undefined
      ? task.effort
      : task.selectedAgent?.effort !== undefined
        ? task.selectedAgent.effort
        : undefined
  const agentModel =
    typeof task.model === 'string' && task.model !== ''
      ? task.model
      : typeof task.selectedAgent?.model === 'string' &&
          task.selectedAgent.model !== ''
        ? task.selectedAgent.model
        : undefined
  return {
    // densable h??Zi()
    model: agentModel ?? sessionModel,
    // densable m??F
    effortValue: turnEffort !== undefined ? turnEffort : sessionEffort,
  }
}

/**
 * Build the ` with {level} effort` suffix shown in Logo/Spinner.
 *
 * densable OQe(model, appStateEffort):
 *   if appStateEffort === undefined → ""
 *   r = cme(model, appStateEffort); if r undefined → ""
 *   return ` with ${level} effort`
 *
 * Only AppState effort (session /effort / panel) triggers the logo suffix —
 * env-only override does not (env is still applied inside cme for API).
 * Wire level is post-clamp (grok max → high). Ultracode is not a suffix.
 */
export function getEffortSuffix(
  model: string,
  effortValue: EffortValue | undefined,
  _ultracodeFlag?: boolean,
): string {
  // densable: gate on appState effort only (not env-alone).
  if (effortValue === undefined) return ''
  if (!shouldShowEffortUI(model, effortValue)) return ''
  const resolved = resolveAppliedEffort(model, effortValue)
  if (resolved === undefined) return ''
  return ` with ${convertEffortValueToLevel(resolved)} effort`
}

export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}

export function convertEffortValueToLevel(value: EffortValue): EffortLevel {
  if (typeof value === 'string') {
    // Runtime guard: value may come from remote config (GrowthBook) where
    // TypeScript types can't help us. Coerce unknown strings to 'high'
    // rather than passing them through unchecked.
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 100) return 'high'
    return 'max'
  }
  return 'high'
}

/**
 * Get user-facing description for effort levels
 *
 * @param level The effort level to describe
 * @returns Human-readable description
 */
export function getEffortLevelDescription(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return 'Quick, straightforward implementation with minimal overhead'
    case 'medium':
      return 'Balanced approach with standard implementation and testing'
    case 'high':
      return 'Comprehensive implementation with extensive testing and documentation'
    case 'xhigh':
      // densable KBn targets Fable 5 / Opus 4.7+ / Sonnet 5; keep user-facing
      // copy free of model names (matches /effort help + existing tests).
      return 'Extended reasoning beyond high, short of maximum capability'
    case 'max':
      return 'Maximum capability with deepest reasoning. May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks.'
  }
}

/**
 * Get user-facing description for effort values (both string and numeric)
 *
 * @param value The effort value to describe
 * @returns Human-readable description
 */
export function getEffortValueDescription(value: EffortValue): string {
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    return `[ANT-ONLY] Numeric effort value of ${value}`
  }

  if (typeof value === 'string') {
    return getEffortLevelDescription(value)
  }
  return 'Balanced approach with standard implementation and testing'
}

export type OpusDefaultEffortConfig = {
  enabled: boolean
  dialogTitle: string
  dialogDescription: string
}

const OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT: OpusDefaultEffortConfig = {
  enabled: true,
  dialogTitle: 'Effort defaults follow the model catalog',
  dialogDescription:
    'Effort controls how deeply Claude reasons. Each model has a catalog default (e.g. Opus 4.7 → xhigh). Use /effort to override for this session or settings.',
}

export function getOpusDefaultEffortConfig(): OpusDefaultEffortConfig {
  const config = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_grey_step2',
    OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
  )
  return {
    ...OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
    ...config,
  }
}

/**
 * densable LQe + ant/ChatGPT extensions.
 * Returns catalog default when model supports effort; undefined when it does not.
 */
export function getDefaultEffortForModel(
  model: string,
): EffortValue | undefined {
  if (process.env.USER_TYPE === 'ant') {
    const config = getAntModelOverrideConfig()
    const isDefaultModel =
      config?.defaultModel !== undefined &&
      model.toLowerCase() === (config.defaultModel as string).toLowerCase()
    if (isDefaultModel && config?.defaultModelEffortLevel) {
      return config.defaultModelEffortLevel as EffortValue
    }
    const antModel = resolveAntModel(model)
    if (antModel) {
      if (antModel.defaultEffortLevel) {
        return antModel.defaultEffortLevel
      }
      if (antModel.defaultEffortValue !== undefined) {
        return antModel.defaultEffortValue
      }
    }
  }

  // Fork-only: ChatGPT Codex reasoning default medium (not densable).
  if (
    getAPIProvider() === 'openai' &&
    isChatGPTAuthMode() &&
    isChatGPTCodexReasoningModel(model)
  ) {
    return 'medium'
  }

  if (!modelSupportsEffort(model)) {
    return undefined
  }

  // densable LQe: catalog.default_effort ?? "high"
  return getCatalogDefaultEffort(model)
}
