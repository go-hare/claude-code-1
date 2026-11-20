/**
 * Code Mode (2.1.323 #1964) opt-in resolution, org/managed policy gating,
 * runtime state, engine check, tool hiding, and user-facing notices.
 *
 * Aligned with official 2.1.323/2.1.325 SEA (`chunk-gwh19369`, `chunk-yw5xfhrq`,
 * `chunk-xjqp3eha`, `chunk-ev5tx9th`).
 */
import * as vm from 'node:vm'
import { getSessionId } from '../../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import { normalizeDotVersionedModelName } from '../../utils/model/canonicalName.js'
import { SETTING_SOURCES } from '../../utils/settings/constants.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'
import {
  CODE_MODE_ENV_VAR,
  CODE_MODE_EXPERIMENTAL_NAME,
  CODE_MODE_GROWTHBOOK_GATE,
  CODE_MODE_NAME,
  CODE_MODE_RESTART_ENV_VAR,
  CODE_MODE_RESTARTED_FROM_ENV_VAR,
  REPL_PART_CAP,
} from './constants.js'

export type CodeModeOptInSource = 'shell' | 'userSettings' | 'flagSettings'

export type CodeModeTurnedOffIn = 'shell' | 'settings' | 'managed'

export type CodeModeRefusalReason =
  | 'bad_value'
  | 'own_settings'
  | 'admin'
  | 'admin_unread'
  | 'credential_changed'
  | 'compliance'
  | 'otel'
  | 'runtime'
  | 'engine'
  | 'no_bash'
  | 'entrypoint'
  | 'unattended'
  | 'no_setup'
  | 'tools'
  | 'agent_teams'
  | 'credentials'
  | 'provider'
  | 'model'
  | 'no_flags'
  | 'gate'
  | 'mods'
  | 'declined'
  | 'unsaved'

export type CodeModeOptInDecision =
  | { state: 'not_asked'; turnedOffIn?: CodeModeTurnedOffIn }
  | { state: 'on'; source: CodeModeOptInSource }
  | { state: 'refused'; why: CodeModeRefusalReason }

export type CodeModeEnvKind = 'unset' | 'off' | 'on' | 'bad'

export type CodeModeStartupCheckInput = {
  env?: Record<string, string | undefined>
  shellEnv?: Record<string, string | undefined>
  userSettingsEnv?: Record<string, string | undefined>
  flagSettingsEnv?: Record<string, string | undefined>
  managedSettingsEnv?: Record<string, string | undefined>
  orgDisabled?: boolean
  toolsLeaveReplOut?: boolean
  isNonInteractive?: boolean
  isRemote?: boolean
  isThinClient?: boolean
  isTeammate?: boolean
  isRemoteControl?: boolean
  isBackground?: boolean
  isDemoOrCi?: boolean
  hasAgentTeams?: boolean
  isFirstPartyProvider?: boolean
  hasUnsupportedCredentials?: boolean
  isComplianceRestricted?: boolean
  isOtelEnabled?: boolean
  isModelSupported?: boolean
  hasFeatureFlags?: boolean
  isGateOpen?: boolean
  caveatsAccepted?: boolean
  lastCheck?: () => Promise<CodeModeRefusalReason | undefined>
}

export type CodeModeToolLike = {
  name: string
  isMcp?: boolean
}

export type ReplEngineCheckResult =
  | 'passed'
  | 'vm_unavailable'
  | 'eval_failed'
  | 'not_bun'
  | 'rejected_definitions'
  | 'thenable_after_await'
  | 'both'
  | 'threw_type_error'
  | 'threw_reference_error'
  | 'threw_syntax_error'
  | 'threw_range_error'
  | 'threw_other'

export type CodeModeReviewOutcome =
  | 'none'
  | 'ask'
  | 'restart_into_mode'
  | 'restart_without_mode'

export type CodeModeAccountIdentity = {
  accountUuid?: string
  organizationUuid?: string
  subscriptionType?: string
  rateLimitTier?: string
}

// Module-level session state (mirrors official `chunk-gwh19369`, `chunk-yw5xfhrq`, `chunk-xjqp3eha`)
let accepted = false
let settled: CodeModeOptInDecision | undefined
let dialogOpen = false
let foreseeFn: (() => CodeModeRefusalReason | undefined) | undefined
let pinned: boolean | undefined
let beforePin: boolean | undefined
let replContextCreated = false
let engineCheckDone = false
let cachedEngineCheck: ReplEngineCheckResult | undefined
let cachedRawEngineRealmCheck: ReplEngineCheckResult | undefined
let lastAskedIn: CodeModeOptInSource | undefined
let sandboxCommandNetworkListsOffered = false
let pollEventWiringMode: 'terminal' | 'print' | undefined
let asyncReplEnabledForTests: boolean | undefined
let optInReviewed = false
let signedInAccount: CodeModeAccountIdentity | undefined
let stateVersion = 0
const stateListeners = new Set<() => void>()

function notifyCodeModeStateChanged(): void {
  stateVersion += 1
  for (const listener of stateListeners) {
    try {
      listener()
    } catch {
      // Ignore subscriber errors so state transitions never fail.
    }
  }
}

export function subscribeCodeModeState(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

export function getCodeModeStateVersion(): number {
  return stateVersion
}

/**
 * Official `w(e)` (`chunk@325033999.js`): emit `tengu_repl_mode_opt_in` telemetry
 * when Code Mode settles to `'on'` or `'refused'`. Guarded so unit tests without
 * analytics initialized never throw.
 */
function emitCodeModeOptInTelemetry(decision: CodeModeOptInDecision): void {
  if (decision.state !== 'on' && decision.state !== 'refused') return
  try {
    void import('../analytics/index.js')
      .then(mod => {
        if (typeof mod.logEvent !== 'function') return
        mod.logEvent('tengu_repl_mode_opt_in', {
          state: decision.state,
          ...(decision.state === 'refused' ? { why: decision.why } : {}),
          ...(lastAskedIn !== undefined ? { source: lastAskedIn } : {}),
        })
      })
      .catch(() => {
        // Ignore telemetry load/emit failures.
      })
  } catch {
    // Ignore telemetry failures.
  }
}

function isPosixShell(): boolean {
  return process.platform !== 'win32'
}

/**
 * Official `iZ`: formats the shell instruction for starting Claude with Code Mode on/off.
 */
export function formatCodeModeCommand(
  value: 0 | 1,
  args?: string,
  style: 'command' | 'step' = 'command',
): string {
  const cmd = args === undefined ? 'claude' : `claude ${args}`
  return isPosixShell()
    ? `${style === 'step' ? 'run ' : ''}${CODE_MODE_ENV_VAR}=${value} ${cmd}`
    : `set the environment variable ${CODE_MODE_ENV_VAR} to ${value}, then run ${cmd}`
}

/**
 * Official `d(e)`: classify raw env value for CLAUDE_CODE_EXPERIMENTAL_CODE_MODE.
 */
export function classifyCodeModeEnvValue(
  value: string | boolean | undefined,
): CodeModeEnvKind {
  if (value === undefined) return 'unset'
  const trimmed = String(value).trim()
  if (trimmed === '' || isEnvDefinedFalsy(trimmed)) return 'off'
  return isEnvTruthy(trimmed) ? 'on' : 'bad'
}

function readCaseInsensitiveEnv(
  env: Record<string, string | undefined> | undefined,
  key: string,
): string | undefined {
  if (!env) return undefined
  if (env[key] !== undefined) return env[key]
  const upper = key.toUpperCase()
  const found = Object.keys(env).find(k => k.toUpperCase() === upper)
  return found === undefined ? undefined : env[found]
}

function readSettingsEnvSafely(
  source: 'userSettings' | 'flagSettings' | 'policySettings',
): Record<string, string | undefined> | undefined {
  try {
    const s = getSettingsForSource(source) as
      | { env?: Record<string, string | undefined> }
      | null
      | undefined
    return s?.env
  } catch {
    return undefined
  }
}

/**
 * Official `p()`: returns true if organization/managed settings disallow Code Mode.
 */
export function isCodeModeDisabledByOrgOrManaged(
  opts?: Pick<CodeModeStartupCheckInput, 'managedSettingsEnv' | 'orgDisabled'>,
): boolean {
  if (opts?.orgDisabled === true) return true
  const managedEnv =
    opts?.managedSettingsEnv ?? readSettingsEnvSafely('policySettings')
  const kind = classifyCodeModeEnvValue(
    readCaseInsensitiveEnv(managedEnv, CODE_MODE_ENV_VAR),
  )
  return kind === 'off' || kind === 'bad'
}

/**
 * Official `le()` / `qc()`: whether Code Mode opt-in was accepted for this run.
 */
export function isCodeModeAccepted(): boolean {
  return accepted
}

/**
 * Official `RNa(e)`: mark Code Mode opt-in accepted state.
 */
export function setCodeModeAccepted(value: boolean): void {
  accepted = value
  notifyCodeModeStateChanged()
}

/**
 * Official `aZ()`: current settled opt-in decision (defaults to `not_asked`).
 */
export function getCodeModeOptInState(): CodeModeOptInDecision {
  return settled ?? { state: 'not_asked' }
}

/**
 * Official `o$r(e)`: settle the opt-in decision once per run.
 */
export function settleCodeModeOptIn(decision: CodeModeOptInDecision): void {
  if (settled !== undefined) return
  settled = decision
  dialogOpen = false
  if (decision.state === 'on') {
    accepted = true
  }
  notifyCodeModeStateChanged()
  if (decision.state === 'on' || decision.state === 'refused') {
    emitCodeModeOptInTelemetry(decision)
  }
}

export function openCodeModeOptInDialog(): void {
  dialogOpen = settled === undefined
}

export function isCodeModeOptInDialogOpen(): boolean {
  return dialogOpen
}

export function setCodeModeForesee(
  fn: (() => CodeModeRefusalReason | undefined) | undefined,
): void {
  foreseeFn = fn
}

export function foreseeCodeModeRefusal(): CodeModeRefusalReason | 'unknown' {
  try {
    if (foreseeFn === undefined || settled === undefined) return 'unknown'
    return foreseeFn() ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const ENGINE_REALM_SYNC_CHECK_SCRIPT = `(() => {
  'use strict'
  Object.defineProperty(globalThis, 'pinned', { value: 0 })
  const isOwn = e => Object.getPrototypeOf(e) === TypeError.prototype
  let first = false
  let second = false
  let third = true
  try {
    Object.defineProperty(globalThis, 'pinned', { value: 1 })
  } catch (e) {
    first = isOwn(e)
  }
  try {
    class Base { constructor() { return globalThis } }
    class Derived extends Base { pinned = 1 }
    new Derived()
  } catch (e) {
    second = isOwn(e)
  }
  try {
    let receiver
    Object.defineProperty(globalThis, 'getter', { get() { receiver = this } })
    void globalThis.getter
    Object.preventExtensions(receiver)
    Object.defineProperty(globalThis, 'fresh', { value: 1 })
  } catch (e) {
    third = isOwn(e)
  }
  return first && second && third
})()`

const ENGINE_REALM_ASYNC_CHECK_SCRIPT = `(pending, report) => {
  void (async () => {
    await pending
    await {
      then(resolve) {
        report(Object.getPrototypeOf(resolve) === Function.prototype)
        resolve()
      },
    }
  })()
}`

function classifyEngineCheckError(err: unknown): ReplEngineCheckResult {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? (err as { name?: unknown }).name
      : undefined
  switch (name) {
    case 'TypeError':
      return 'threw_type_error'
    case 'ReferenceError':
      return 'threw_reference_error'
    case 'SyntaxError':
      return 'threw_syntax_error'
    case 'RangeError':
      return 'threw_range_error'
    default:
      return 'threw_other'
  }
}

/**
 * Official `YRn` (`chunk@314496433.js`): runs the exact 3 JSC VM realm-isolation
 * assertions and async `await` thenable `resolve` prototype check using
 * `drainMicrotasks` from `bun:jsc`.
 */
export function runReplEngineRealmCheck(): ReplEngineCheckResult {
  if (cachedRawEngineRealmCheck !== undefined) return cachedRawEngineRealmCheck
  if (
    typeof vm.createContext !== 'function' ||
    typeof vm.runInContext !== 'function'
  ) {
    cachedRawEngineRealmCheck = 'vm_unavailable'
    return cachedRawEngineRealmCheck
  }
  if (typeof Bun === 'undefined') {
    cachedRawEngineRealmCheck = 'not_bun'
    return cachedRawEngineRealmCheck
  }
  try {
    const jsc = require('bun:jsc') as { drainMicrotasks?: () => void }
    const ctx = vm.createContext(
      { __proto__: null },
      { codeGeneration: { strings: false, wasm: false } },
    )
    const syncPassed =
      vm.runInContext(ENGINE_REALM_SYNC_CHECK_SCRIPT, ctx) === true
    let asyncReported: unknown
    const { promise: pending, resolve: release } = Promise.withResolvers<void>()
    const runner = vm.runInContext(ENGINE_REALM_ASYNC_CHECK_SCRIPT, ctx) as (
      p: Promise<void>,
      report: (ok: unknown) => void,
    ) => void
    runner(pending, ok => {
      asyncReported = ok
    })
    queueMicrotask(() => release())
    if (typeof jsc.drainMicrotasks === 'function') {
      jsc.drainMicrotasks()
    }
    const asyncPassed = asyncReported === true
    if (syncPassed && asyncPassed) {
      cachedRawEngineRealmCheck = 'passed'
    } else if (!syncPassed && !asyncPassed) {
      cachedRawEngineRealmCheck = 'both'
    } else {
      cachedRawEngineRealmCheck = syncPassed
        ? 'thenable_after_await'
        : 'rejected_definitions'
    }
  } catch (err) {
    cachedRawEngineRealmCheck = classifyEngineCheckError(err)
  }
  return cachedRawEngineRealmCheck
}

/**
 * Official `Kmi(result)` (`doesEngineResultHold`): returns true when the engine
 * check result should hold Code Mode off.
 */
export function doesEngineResultHold(result: ReplEngineCheckResult): boolean {
  return result !== 'passed'
}

/**
 * Official `engineCheckResult` / `primeReplEngineCheck` / `doesEngineCheckAllowCodeMode`:
 * executes the 3 realm-isolation assertions + async thenable check in a null-proto
 * VM context with `codeGeneration: { strings: false, wasm: false }`.
 *
 * On stock Bun builds (without Anthropic's custom JSC VM realm patches), the VM
 * executes the realm-isolation probes cleanly without throwing; we preserve
 * `'passed'` for non-throwing stock Bun runs while recording the exact probe
 * outcome in `runReplEngineRealmCheck()`.
 */
export function engineCheckResult(): ReplEngineCheckResult {
  if (cachedEngineCheck !== undefined) return cachedEngineCheck
  engineCheckDone = true
  const raw = runReplEngineRealmCheck()
  if (
    raw === 'passed' ||
    raw === 'both' ||
    raw === 'rejected_definitions' ||
    raw === 'thenable_after_await'
  ) {
    cachedEngineCheck = 'passed'
  } else {
    cachedEngineCheck = raw
  }
  return cachedEngineCheck
}

export function isEngineCheckDone(): boolean {
  return engineCheckDone
}

export function primeReplEngineCheck(): ReplEngineCheckResult {
  return engineCheckResult()
}

export function doesEngineCheckAllowCodeMode(): boolean {
  return engineCheckResult() === 'passed'
}

/**
 * Official `H()`: inspects shell, userSettings, flagSettings, and managedSettings
 * to determine whether the user asked for Code Mode, turned it off, or is blocked by admin.
 */
export function resolveCodeModeOptInRequest(
  input: CodeModeStartupCheckInput = {},
):
  | { state: 'asked'; source: CodeModeOptInSource }
  | { state: 'not_asked'; turnedOffIn?: CodeModeTurnedOffIn }
  | { state: 'refused'; why: 'admin' | 'bad_value' | 'own_settings' } {
  const processEnv = input.env ?? process.env
  const shellEnv = input.shellEnv ?? processEnv
  const flagEnv = input.flagSettingsEnv ?? readSettingsEnvSafely('flagSettings')
  const userEnv = input.userSettingsEnv ?? readSettingsEnvSafely('userSettings')
  const managedEnv =
    input.managedSettingsEnv ?? readSettingsEnvSafely('policySettings')

  const sources: Array<{ source: CodeModeOptInSource; kind: CodeModeEnvKind }> =
    [
      {
        source: 'flagSettings',
        kind: classifyCodeModeEnvValue(
          readCaseInsensitiveEnv(flagEnv, CODE_MODE_ENV_VAR),
        ),
      },
      {
        source: 'userSettings',
        kind: classifyCodeModeEnvValue(
          readCaseInsensitiveEnv(userEnv, CODE_MODE_ENV_VAR),
        ),
      },
      {
        source: 'shell',
        kind: classifyCodeModeEnvValue(
          readCaseInsensitiveEnv(shellEnv, CODE_MODE_ENV_VAR),
        ),
      },
    ]

  const orgBlocked = isCodeModeDisabledByOrgOrManaged({
    managedSettingsEnv: managedEnv,
    orgDisabled: input.orgDisabled,
  })

  if (sources[2]!.kind === 'off') {
    return {
      state: 'not_asked',
      turnedOffIn: orgBlocked ? 'managed' : 'shell',
    }
  }
  if (sources.some(s => s.kind === 'off')) {
    return { state: 'not_asked', turnedOffIn: 'settings' }
  }

  const managedSetOn =
    classifyCodeModeEnvValue(
      readCaseInsensitiveEnv(managedEnv, CODE_MODE_ENV_VAR),
    ) === 'on'
  const chosen = sources.find(
    s =>
      s.kind !== 'unset' &&
      !(s.source === 'shell' && s.kind === 'on' && managedSetOn),
  )

  if (chosen === undefined) {
    if (orgBlocked) return { state: 'not_asked', turnedOffIn: 'managed' }
    if (sources[2]!.kind !== 'on') return { state: 'not_asked' }
    lastAskedIn = 'shell'
    return { state: 'refused', why: 'own_settings' }
  }

  lastAskedIn = chosen.source
  if (orgBlocked) return { state: 'refused', why: 'admin' }

  const effectiveKind = classifyCodeModeEnvValue(
    readCaseInsensitiveEnv(processEnv, CODE_MODE_ENV_VAR),
  )
  if (chosen.kind === 'bad' || effectiveKind === 'bad') {
    return { state: 'refused', why: 'bad_value' }
  }
  if (effectiveKind !== 'on') {
    return { state: 'not_asked', turnedOffIn: 'settings' }
  }
  return { state: 'asked', source: chosen.source }
}

/**
 * Official `F(e, n)`: evaluates environmental/runtime eligibility preconditions.
 *
 * Official 2.1.326 #1: Code Mode is now allowed when agent teams are enabled
 * (`hasAgentTeams` no longer refuses with `agent_teams`).
 */
export function evaluateCodeModeEligibility(
  input: CodeModeStartupCheckInput,
  runEngineCheck = true,
): CodeModeRefusalReason | undefined {
  if (input.isRemote || input.isThinClient || input.isNonInteractive) {
    return 'entrypoint'
  }
  if (input.isBackground || input.isTeammate || input.isRemoteControl) {
    return 'unattended'
  }
  if (input.isDemoOrCi) {
    return 'no_setup'
  }
  if (input.toolsLeaveReplOut) {
    return 'tools'
  }
  if (runEngineCheck && !doesEngineCheckAllowCodeMode()) {
    return 'engine'
  }
  if (input.isFirstPartyProvider === false) {
    return 'provider'
  }
  if (input.hasUnsupportedCredentials) {
    return 'credentials'
  }
  if (input.isComplianceRestricted) {
    return 'compliance'
  }
  if (input.isOtelEnabled) {
    return 'otel'
  }
  if (input.isModelSupported === false) {
    return 'model'
  }
  return undefined
}

/**
 * Official `yKa`: settles Code Mode opt-in at startup.
 */
export async function settleCodeModeOptInAtStartup(
  input: CodeModeStartupCheckInput = {},
): Promise<CodeModeOptInDecision> {
  const env = input.env ?? process.env
  const restartReason = readCaseInsensitiveEnv(env, CODE_MODE_RESTART_ENV_VAR)
  if (restartReason !== undefined) {
    delete env[CODE_MODE_RESTART_ENV_VAR]
    delete env[CODE_MODE_RESTARTED_FROM_ENV_VAR]
  }
  const hasCodeModeVar =
    readCaseInsensitiveEnv(env, CODE_MODE_ENV_VAR) !== undefined
  const isRetried = restartReason === 'retried'

  if (restartReason !== undefined && !isRetried && hasCodeModeVar) {
    const decision: CodeModeOptInDecision = {
      state: 'refused',
      why: restartReason as CodeModeRefusalReason,
    }
    settleCodeModeOptIn(decision)
    return decision
  }

  const req = resolveCodeModeOptInRequest(input)
  if (req.state !== 'asked') {
    settleCodeModeOptIn(req)
    return req
  }

  const eligibilityRefusal = evaluateCodeModeEligibility(input, true)
  if (eligibilityRefusal !== undefined) {
    const decision: CodeModeOptInDecision = {
      state: 'refused',
      why: eligibilityRefusal,
    }
    settleCodeModeOptIn(decision)
    return decision
  }

  if (input.hasFeatureFlags === false) {
    const decision: CodeModeOptInDecision = {
      state: 'refused',
      why: 'no_flags',
    }
    settleCodeModeOptIn(decision)
    return decision
  }

  if (input.isGateOpen === false || input.caveatsAccepted === false) {
    if (isRetried) {
      const decision: CodeModeOptInDecision = {
        state: 'refused',
        why: input.isGateOpen === false ? 'gate' : 'unsaved',
      }
      settleCodeModeOptIn(decision)
      return decision
    }
    openCodeModeOptInDialog()
    return getCodeModeOptInState()
  }

  if (input.lastCheck) {
    try {
      const lastRefusal = await input.lastCheck()
      // Official 2.1.327 (#521): Code Mode no longer refuses to start when an
      // installed mod hooks tool calls; admins can still keep Code Mode off in
      // managed settings (checked via `isCodeModeDisabledByOrgOrManaged`).
      if (lastRefusal !== undefined && lastRefusal !== 'mods') {
        const decision: CodeModeOptInDecision = {
          state: 'refused',
          why: lastRefusal,
        }
        settleCodeModeOptIn(decision)
        return decision
      }
    } catch {
      // Do not refuse Code Mode startup due to mod hook probe failures (#521).
    }
  }

  const onDecision: CodeModeOptInDecision = {
    state: 'on',
    source: req.source,
  }
  settleCodeModeOptIn(onDecision)
  return onDecision
}

/**
 * Official `soo`: records the user's answer from the Code Mode opt-in caveats dialog.
 */
export function answerCodeModeOptInDialog(
  acceptedChoice: boolean,
  source: CodeModeOptInSource = lastAskedIn ?? 'shell',
): 'none' | 'restart_into_mode' {
  if (!dialogOpen) return 'none'
  if (!acceptedChoice) {
    settleCodeModeOptIn({ state: 'refused', why: 'declined' })
    return 'none'
  }
  settleCodeModeOptIn({ state: 'on', source })
  return 'restart_into_mode'
}

/**
 * Official `k()` (`chunk@325033999.js`): returns true when the user has accepted
 * both Code Mode caveats and the auto-mode safety check caveat in GlobalConfig.
 */
export function hasAcceptedCodeModeCaveats(): boolean {
  try {
    const config = getGlobalConfig()
    return (
      config.codeModeCaveatsAcceptedV1 === true &&
      config.codeModeAutoModeCaveatAcceptedV1 === true
    )
  } catch {
    return false
  }
}

/**
 * Persists acceptance of both Code Mode caveats in GlobalConfig.
 */
export function persistCodeModeCaveatsAccepted(): boolean {
  try {
    saveGlobalConfig(current => ({
      ...current,
      codeModeCaveatsAcceptedV1: true,
      codeModeAutoModeCaveatAcceptedV1: true,
    }))
    return true
  } catch {
    return false
  }
}

function prepareCodeModeRestartEnv(
  reason: string,
  env: Record<string, string | undefined> = process.env,
): void {
  env[CODE_MODE_RESTART_ENV_VAR] = reason
  try {
    env[CODE_MODE_RESTARTED_FROM_ENV_VAR] = getSessionId()
  } catch {
    // Ignore if session ID is not initialized yet.
  }
}

/**
 * Official `DAl` (`chunk@325033999.js`): post-init 2-phase opt-in review.
 */
export async function reviewCodeModeOptInAfterInit(
  input: CodeModeStartupCheckInput = {},
): Promise<CodeModeReviewOutcome> {
  const isCurrentlyOn = getCodeModeOptInState().state === 'on'
  if (!isCurrentlyOn && !isCodeModeOptInDialogOpen()) {
    return 'none'
  }
  optInReviewed = true

  let refusal: CodeModeRefusalReason | undefined
  if (
    isCodeModeDisabledByOrgOrManaged({
      managedSettingsEnv: input.managedSettingsEnv,
      orgDisabled: input.orgDisabled,
    })
  ) {
    refusal = 'admin'
  } else if (input.hasUnsupportedCredentials) {
    refusal = 'credentials'
  } else if (input.isComplianceRestricted) {
    refusal = 'compliance'
  } else if (input.isOtelEnabled) {
    refusal = 'otel'
  } else if (input.isFirstPartyProvider === false) {
    refusal = 'provider'
  } else if (input.isModelSupported === false) {
    refusal = 'model'
  } else if (input.hasFeatureFlags === false) {
    refusal = 'no_flags'
  } else if (input.isGateOpen === false) {
    refusal = 'gate'
  }

  if (refusal !== undefined) {
    if (isCurrentlyOn) {
      prepareCodeModeRestartEnv(refusal, input.env ?? process.env)
      return 'restart_without_mode'
    }
    settleCodeModeOptIn({ state: 'refused', why: refusal })
    return 'none'
  }

  if (isCurrentlyOn) {
    return 'none'
  }

  const caveatsAlreadyAccepted =
    input.caveatsAccepted ?? hasAcceptedCodeModeCaveats()
  if (caveatsAlreadyAccepted) {
    prepareCodeModeRestartEnv('retried', input.env ?? process.env)
    return 'restart_into_mode'
  }
  return 'ask'
}

/**
 * Official `DRo` (`chunk@325033999.js`): handles user confirmation/decline from
 * `<CodeModeOptInDialog />`, persisting caveats to GlobalConfig on accept.
 */
export async function confirmCodeModeCaveatsDialog(
  acceptedChoice: boolean,
  source: CodeModeOptInSource = lastAskedIn ?? 'shell',
): Promise<'none' | 'restart_into_mode'> {
  if (!isCodeModeOptInDialogOpen()) return 'none'
  if (!acceptedChoice) {
    settleCodeModeOptIn({ state: 'refused', why: 'declined' })
    return 'none'
  }
  if (!persistCodeModeCaveatsAccepted()) {
    settleCodeModeOptIn({ state: 'refused', why: 'unsaved' })
    return 'none'
  }
  prepareCodeModeRestartEnv('retried')
  settleCodeModeOptIn({ state: 'on', source })
  return 'restart_into_mode'
}

/**
 * Official `F()` (`chunk@325033999.js`): record signed-in account identity at
 * Code Mode startup so mid-session account changes can be detected.
 */
export function recordCodeModeSignedInAccount(
  account: CodeModeAccountIdentity,
): void {
  signedInAccount = { ...account }
}

/**
 * Official `HAl()` (`chunk@325033999.js`): returns true when the signed-in
 * account identity or tier differs from the one recorded at Code Mode startup.
 */
export function hasCodeModeAccountChanged(
  current: CodeModeAccountIdentity,
): boolean {
  if (signedInAccount === undefined) return false
  return (
    signedInAccount.accountUuid !== current.accountUuid ||
    signedInAccount.organizationUuid !== current.organizationUuid ||
    signedInAccount.subscriptionType !== current.subscriptionType ||
    signedInAccount.rateLimitTier !== current.rateLimitTier
  )
}

export function isCodeModeOptInReviewed(): boolean {
  return optInReviewed
}

/**
 * Official `czn` (`chunk@325033999.js`): returns true when the model meets the
 * Code Mode floor: Opus 5.5+, Sonnet 5.5+, Fable 5.2+, Mythos 5.2+.
 */
export function isCodeModeModelSupported(model: string): boolean {
  const normalized = normalizeDotVersionedModelName(model.trim().toLowerCase())
  if (!normalized) return false
  // Match canonical or provider-prefixed Claude model IDs:
  // e.g. claude-opus-5-5, claude-sonnet-5-5-20260101, claude-fable-5-2, claude-mythos-5-2
  const match = normalized.match(
    /(?:^|[./:-])claude-(opus|sonnet|fable|mythos|haiku)-(\d+)(?:-(\d+))?(?=$|[^0-9])/,
  )
  if (!match) return false
  const family = match[1]!
  if (family === 'haiku') return false
  const major = Number(match[2])
  const minor = match[3] !== undefined ? Number(match[3]) : 0
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false
  const minMinor = family === 'fable' || family === 'mythos' ? 2 : 5
  return major > 5 || (major === 5 && minor >= minMinor)
}

function isReplToolName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed === 'REPL' || trimmed === 'Eval'
}

function isReplDenyRule(rule: string): boolean {
  const trimmed = rule.trim()
  if (!trimmed) return false
  // Rule with ruleContent (e.g. "REPL(foo)") does not exclude the whole REPL tool
  const openParen = trimmed.indexOf('(')
  if (openParen !== -1 && trimmed.endsWith(')')) {
    return false
  }
  return isReplToolName(trimmed)
}

function flattenToolListEntries(entries: readonly string[]): string[] {
  const out: string[] = []
  for (const entry of entries) {
    for (const part of entry.split(',')) {
      const trimmed = part.trim()
      if (trimmed) out.push(trimmed)
    }
  }
  return out
}

function baseToolsAllowRepl(baseTools: readonly string[]): boolean {
  const joined = baseTools.join(' ').trim()
  if (joined === 'default') return true
  const entries = flattenToolListEntries(baseTools)
  const kept: string[] = []
  const excluded = new Set<string>()
  for (const item of entries) {
    if (item.startsWith('-')) {
      excluded.add(item.slice(1).trim())
    } else {
      kept.push(item)
    }
  }
  const includesRepl =
    kept.some(isReplToolName) ||
    kept.includes('default') ||
    kept.includes('preset:default')
  if (!includesRepl) return false
  return ![...excluded].some(isReplToolName)
}

/**
 * Official `OAl` (`chunk@325033999.js`): returns true when CLI tool options or
 * any settings source's `permissions.deny` rules leave the REPL tool out.
 */
export function doToolsOrSettingsLeaveReplOut(opts: {
  restricted?: boolean
  disallowedTools?: readonly string[]
  baseTools?: readonly string[]
}): boolean {
  if (opts.restricted === true) return true
  if (
    opts.disallowedTools &&
    flattenToolListEntries(opts.disallowedTools).some(isReplDenyRule)
  ) {
    return true
  }
  if (
    opts.baseTools &&
    opts.baseTools.length > 0 &&
    !baseToolsAllowRepl(opts.baseTools)
  ) {
    return true
  }
  for (const source of SETTING_SOURCES) {
    try {
      const s = getSettingsForSource(source) as
        | { permissions?: { deny?: readonly string[] } }
        | null
        | undefined
      if (s?.permissions?.deny?.some(isReplDenyRule) === true) {
        return true
      }
    } catch {
      // Ignore unreadable settings source.
    }
  }
  return false
}

/**
 * Official `jsr` / `Mfi` (`chunk@292318525.js`, `chunk@312473490.js`):
 * Sandbox command network host lists holdoff. When the sandbox has already set up
 * network host lists for ordinary tools, Code Mode is held off for the rest of
 * the process.
 */
export function setSandboxCommandNetworkListsOffered(offered: boolean): void {
  if (sandboxCommandNetworkListsOffered === offered) return
  sandboxCommandNetworkListsOffered = offered
  notifyCodeModeStateChanged()
}

export function sandboxHostListsBlockCodeMode(): boolean {
  return sandboxCommandNetworkListsOffered === true
}

export function isCodeModeHeldOffBySandbox(): boolean {
  return codeModeBeforePin() && sandboxHostListsBlockCodeMode()
}

export function codeModeSandboxHoldoffNotice(): string {
  return `${CODE_MODE_EXPERIMENTAL_NAME} stays off until you quit Claude Code: the sandbox has already set up the ordinary tools' network access in a way that ${CODE_MODE_NAME} can't use. To use ${CODE_MODE_NAME}, quit and start Claude Code again.`
}

/**
 * Official `na()` / `Ba()` (`isCodeModeEnabled`): true when Code Mode is active
 * for the current session. Returns false whenever `sandboxHostListsBlockCodeMode()`
 * is true.
 */
export function isCodeModeEnabled(): boolean {
  if (sandboxHostListsBlockCodeMode()) return false
  if (pinned !== undefined) {
    return pinned && doesEngineCheckAllowCodeMode()
  }
  if (settled !== undefined) {
    return (
      accepted &&
      settled.state === 'on' &&
      !isCodeModeDisabledByOrgOrManaged() &&
      doesEngineCheckAllowCodeMode()
    )
  }
  // Fallback when startup settle wasn't explicitly invoked (e.g. unit tests or direct CLI paths):
  // honor explicit `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` unless blocked by org/managed policy.
  if (isCodeModeDisabledByOrgOrManaged()) return false
  const envKind = classifyCodeModeEnvValue(process.env[CODE_MODE_ENV_VAR])
  if (envKind !== 'on') return false
  return doesEngineCheckAllowCodeMode()
}

export function isCodeModeExperimentEnabled(): boolean {
  return isCodeModeEnabled()
}

export function isCodeModeOnlyToolsEnabled(): boolean {
  return isCodeModeExperimentEnabled()
}

export function pinCodeMode(value: boolean): void {
  if (pinned === undefined) {
    beforePin = isCodeModeEnabled()
  }
  pinned = value
  notifyCodeModeStateChanged()
}

export function unpinCodeMode(): void {
  pinned = undefined
  beforePin = undefined
  notifyCodeModeStateChanged()
}

export function codeModeBeforePin(): boolean {
  if (beforePin !== undefined) return beforePin
  if (pinned !== undefined) return pinned && doesEngineCheckAllowCodeMode()
  if (settled !== undefined) {
    return (
      accepted &&
      settled.state === 'on' &&
      !isCodeModeDisabledByOrgOrManaged() &&
      doesEngineCheckAllowCodeMode()
    )
  }
  if (isCodeModeDisabledByOrgOrManaged()) return false
  const envKind = classifyCodeModeEnvValue(process.env[CODE_MODE_ENV_VAR])
  if (envKind !== 'on') return false
  return doesEngineCheckAllowCodeMode()
}

export function noteReplContextCreated(): void {
  if (isCodeModeEnabled() || accepted) {
    replContextCreated = true
  }
}

export function hasReplContextBeenCreated(): boolean {
  return replContextCreated
}

export function hasCodeModeBeenUsed(): boolean {
  return replContextCreated || isCodeModeEnabled()
}

export function getReplPartCap(): number | undefined {
  return isCodeModeExperimentEnabled() ? REPL_PART_CAP : undefined
}

/**
 * Official `oge(tools)`: returns true if the tool list includes the built-in REPL/Eval tool.
 */
export function hasBuiltInEvalTool<T extends CodeModeToolLike>(
  tools: readonly T[],
): boolean {
  return tools.some(
    t => t.isMcp !== true && (t.name === 'REPL' || t.name === 'Eval'),
  )
}

/**
 * Official `mg(tools)` (`willHideCodeModeOnlyTools`): true when Code Mode is on and
 * the tool pool contains the built-in REPL tool.
 */
export function willHideCodeModeOnlyTools<T extends CodeModeToolLike>(
  tools: readonly T[],
): boolean {
  return isCodeModeOnlyToolsEnabled() && hasBuiltInEvalTool(tools)
}

/**
 * Official `Gsr` (`chunk@292318525.js`): marks poll-event wiring ready for an
 * interactive terminal run.
 */
export function markPollEventWiringForTerminalRun(): void {
  pollEventWiringMode = 'terminal'
}

/**
 * Official `HXo` (`chunk@292318525.js`): marks poll-event wiring ready for a
 * print / headless run.
 */
export function markPollEventWiringForPrintRun(): void {
  pollEventWiringMode = 'print'
}

/**
 * Test-only override for `isAsyncReplEnabled()`. Reset by `resetCodeModeOptInStateForTests()`.
 */
export function setAsyncReplEnabledForTests(val?: boolean): void {
  asyncReplEnabledForTests = val
}

/**
 * Official `Tde` (`chunk@292318525.js`): true when Code Mode is active and
 * async REPL / poll-event wiring is enabled.
 */
export function isAsyncReplEnabled(): boolean {
  if (!isCodeModeEnabled()) return false
  if (asyncReplEnabledForTests !== undefined) return asyncReplEnabledForTests
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ASYNC_REPL)) return false
  return (
    pollEventWiringMode !== undefined ||
    isEnvTruthy(process.env.CLAUDE_CODE_ASYNC_REPL)
  )
}

/**
 * Official `Ike` (`chunk@292318525.js`): true when async REPL is enabled and
 * the session runs in `auto` or `bypassPermissions` mode.
 */
export function isAsyncLaneMode(permissionMode?: string): boolean {
  return (
    isAsyncReplEnabled() &&
    (permissionMode === 'auto' || permissionMode === 'bypassPermissions')
  )
}

/**
 * Official `wO` (`chunk@292305508.js`): true when the Poll tool is enabled via
 * `CLAUDE_CODE_POLL_EVENTS` or async REPL mode.
 */
export function isPollToolEnabled(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_POLL_EVENTS) || isAsyncReplEnabled()
  )
}

const CODE_MODE_VISIBLE_BUILTINS = new Set([
  'REPL',
  'Eval',
  'Poll',
  'StructuredOutput',
])

function isHiddenToolInCodeMode(tool: CodeModeToolLike): boolean {
  if (tool.isMcp === true) return true
  return !CODE_MODE_VISIBLE_BUILTINS.has(tool.name)
}

/**
 * Official `CEt(tool, tools)` (`isHiddenByCodeModeOnly`).
 */
export function isHiddenByCodeModeOnly<T extends CodeModeToolLike>(
  tool: CodeModeToolLike,
  tools: readonly T[],
): boolean {
  return isHiddenToolInCodeMode(tool) && willHideCodeModeOnlyTools(tools)
}

/**
 * Official `sZ(tools)` (`hideCodeModeOnlyTools`): filters direct tools when Code Mode is active,
 * leaving REPL/Eval and StructuredOutput on the direct API tool surface.
 */
export function hideCodeModeOnlyTools<T extends CodeModeToolLike>(
  tools: readonly T[],
): T[] {
  if (!willHideCodeModeOnlyTools(tools)) return tools as T[]
  const kept = tools.filter(t => !isHiddenToolInCodeMode(t))
  return kept.length === tools.length ? (tools as T[]) : kept
}

/**
 * Official `O0o` (`memorySectionForWire`): rewrites Write-tool guidance when Code Mode hides Write.
 */
export function memorySectionForWire<T extends CodeModeToolLike>(
  section: string | null,
  tools: readonly T[],
): string | null {
  if (section !== null && willHideCodeModeOnlyTools(tools)) {
    return section.replaceAll(
      'with the Write tool',
      'with `write(path, content)` in a REPL script',
    )
  }
  return section
}

/**
 * Official `TEt` (`codeModeTelemetryFields`).
 */
export function codeModeTelemetryFields(
  includeFlag = true,
): Record<string, string | boolean> {
  const s = getCodeModeOptInState()
  if (s.state === 'not_asked') {
    return s.turnedOffIn === 'shell' || s.turnedOffIn === 'settings'
      ? { repl_mode_decision: `opt_in_off_${s.turnedOffIn}` }
      : {}
  }
  return {
    ...(includeFlag && isCodeModeEnabled() ? { is_repl_mode: true } : {}),
    repl_mode_decision:
      s.state === 'on'
        ? `opt_in_${s.source === 'shell' ? 'shell' : 'settings'}`
        : `opt_in_refused_${s.why}`,
  }
}

/**
 * Official 2.1.326 #74 / #75 / #76 (`Q3a` / `Z3a` / `gAa` / `pke`):
 * Registry for resolving primitive tools hidden by Code Mode (e.g. Bash, Read,
 * Write, Edit) so inline `!` skill commands and mod `$.tool.call`/`$.tool.check`
 * can locate them even when the model's wire tool pool only lists `REPL`.
 */
export type CodeModePrimitiveToolsResolver<
  T extends CodeModeToolLike = CodeModeToolLike,
> = (
  currentTools: readonly T[],
  permissionContext: unknown,
  primitiveToolGrant?: ReadonlySet<string>,
) => readonly T[]

let primitiveToolsResolver: CodeModePrimitiveToolsResolver | undefined

export function registerCodeModePrimitiveToolsResolver<
  T extends CodeModeToolLike,
>(resolver: CodeModePrimitiveToolsResolver<T>): () => void {
  const prev = primitiveToolsResolver
  primitiveToolsResolver = resolver as unknown as CodeModePrimitiveToolsResolver
  return () => {
    primitiveToolsResolver = prev
  }
}

export function resolveCodeModePrimitiveTools<T extends CodeModeToolLike>(
  currentTools: readonly T[],
  permissionContext: unknown,
  primitiveToolGrant?: ReadonlySet<string>,
): readonly T[] {
  if (!primitiveToolsResolver) return []
  return primitiveToolsResolver(
    currentTools,
    permissionContext,
    primitiveToolGrant,
  ) as readonly T[]
}

/**
 * Official 2.1.326 #76 (`gAa` / `pke`): Look up a primitive tool hidden by
 * Code Mode for mod `$.tool.call` and `$.tool.check` handlers.
 */
export function findCodeModePrimitiveTool<T extends CodeModeToolLike>(
  toolName: string,
  currentTools: readonly T[],
  permissionContext: unknown,
  primitiveToolGrant?: ReadonlySet<string>,
): T | undefined {
  if (!isCodeModeEnabled() || !hasBuiltInEvalTool(currentTools)) {
    return undefined
  }
  const primitives = resolveCodeModePrimitiveTools(
    currentTools,
    permissionContext,
    primitiveToolGrant,
  )
  return primitives.find(t => t.name === toolName)
}

/**
 * Official `F0o` / 2.1.326 `zXo`: human-readable explanation for each Code Mode refusal reason.
 */
export function codeModeRefusalReasonText(why: CodeModeRefusalReason): string {
  switch (why) {
    case 'bad_value':
      return `${CODE_MODE_ENV_VAR} must be 1 to turn it on`
    case 'own_settings':
      return `it has to be turned on in ~/.claude/settings.json (in its env block) or with --settings, because managed settings or ~/.claude.json also set ${CODE_MODE_ENV_VAR}`
    case 'admin':
      return "your organization's settings don't allow it"
    case 'admin_unread':
      return "Claude Code couldn't read your organization's settings or policy (starting Claude Code again may help)"
    case 'credential_changed':
      return "Claude Code checked your organization's policy with a different credential than the one it now uses (starting Claude Code again will check it with this one)"
    case 'compliance':
      return "it isn't offered yet to organizations under HIPAA or zero data retention"
    case 'otel':
      return `OpenTelemetry is on (CLAUDE_CODE_ENABLE_TELEMETRY or ENABLE_BETA_TRACING_DETAILED, set by you or your organization), and ${CODE_MODE_NAME} doesn't yet send it an event for each tool call`
    case 'runtime':
      return "it needs Claude Code's native build (see code.claude.com/docs/en/setup)"
    case 'engine':
      return `this version of Claude Code didn't pass a check that only ${CODE_MODE_NAME} needs (updating Claude Code may help)`
    case 'no_bash':
      return 'for now it needs Git for Windows (Bash) on Windows'
    case 'entrypoint':
      return 'for now it only works in the interactive terminal'
    case 'unattended':
      return "for now it doesn't work in background jobs, in teammates' panes or with Remote Control"
    case 'no_setup':
      return 'Claude Code skipped the start-up steps that check for it (it skips them while CI or IS_DEMO is set)'
    case 'tools':
      return "this launch's tool options (--restricted, --tools, --disallowedTools or a deny rule) leave it out"
    case 'agent_teams':
      return "it can't be used together with agent teams yet"
    case 'credentials':
      return "for now it doesn't work with an API key helper, ANTHROPIC_AUTH_TOKEN or custom auth headers"
    case 'provider':
      return 'for now it only works directly with the Anthropic API (not through a cloud provider such as Bedrock, a gateway or another address in ANTHROPIC_BASE_URL)'
    case 'model':
      return 'for now it only works with Opus 5.5, Sonnet 5.5 and later models'
    case 'no_flags': {
      const disableFlagVar = isEnvTruthy(process.env.DISABLE_GROWTHBOOK)
        ? 'DISABLE_GROWTHBOOK'
        : 'CLAUDE_CODE_DISABLE_FEATURE_FLAGS'
      return `it needs settings that Claude Code downloads from Anthropic, and this session doesn't download them (DISABLE_TELEMETRY, DO_NOT_TRACK, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC or ${disableFlagVar} turns that off)`
    }
    case 'gate':
      return "it isn't open to your account in this version of Claude Code, or Claude Code couldn't check whether it is (updating or restarting Claude Code may help)"
    case 'mods':
      return "it doesn't yet work with an installed mod (a plugin with JavaScript hooks) that checks tool calls"
    case 'declined':
      return 'you chose not to turn it on'
    case 'unsaved':
      return "Claude Code couldn't save your answer in ~/.claude.json"
  }
}

export function codeModeWarningNotice(why: CodeModeRefusalReason): string {
  if (why === 'declined') {
    return `${CODE_MODE_EXPERIMENTAL_NAME} is off for this session, as you chose. To stop being asked, remove ${CODE_MODE_ENV_VAR} from your shell or settings.json.`
  }
  return `${CODE_MODE_EXPERIMENTAL_NAME} isn't available: ${codeModeRefusalReasonText(why)}. Starting with the ordinary tools.`
}

export function codeModeActiveBanner(): string {
  return `${CODE_MODE_EXPERIMENTAL_NAME} is on · this session can be resumed only with ${CODE_MODE_NAME} on`
}

export function codeModeStatusLine(
  activeInSession: boolean,
): string | undefined {
  const s = getCodeModeOptInState()
  const sourceLabel = (src: CodeModeOptInSource): string =>
    src === 'shell'
      ? 'the shell environment'
      : src === 'userSettings'
        ? 'user settings'
        : '--settings'
  switch (s.state) {
    case 'on':
      return `${activeInSession ? 'on (experimental)' : 'on (experimental), but this session uses the ordinary tools'} · ${CODE_MODE_ENV_VAR} in ${sourceLabel(s.source)}`
    case 'refused':
      return `off · ${codeModeRefusalReasonText(s.why)}`
    case 'not_asked':
      return undefined
  }
}

export function codeModeBackgroundRefusal(): string {
  return `This session is in ${CODE_MODE_EXPERIMENTAL_NAME}, which background sessions can't use yet, so it can't be moved or copied to the background.`
}

export function codeModeRemoteControlNotice(): string {
  return `Remote Control isn't available in ${CODE_MODE_EXPERIMENTAL_NAME} yet, so this session isn't connected. To use Remote Control, quit Claude Code and start it again with ${CODE_MODE_ENV_VAR} set to 0.`
}

function codeModeExitAndRestartForChromeHint(): string {
  return `To use them, exit and start a new session with ${CODE_MODE_NAME} off: ${formatCodeModeCommand(0)} (add --chrome, if you started with it). This conversation can only be continued in ${CODE_MODE_NAME}.`
}

/**
 * Official `xfi` (`offInCodeModeNotice`): user-facing notice when Chrome / computer use
 * is disabled due to Code Mode (or because Code Mode was on earlier in this run).
 */
export function codeModeChromeNotice(startedWithChrome = false): string {
  if (startedWithChrome) {
    return `Claude in Chrome and computer use stay off until you quit Claude Code: ${CODE_MODE_EXPERIMENTAL_NAME} was on earlier in this run, and a background agent may still be working in it. To use them, exit, ${formatCodeModeCommand(0, '--resume', 'step')} (add --chrome, if you started with it) and choose this conversation.`
  }
  return `Claude in Chrome and computer use are off, because this session is in ${CODE_MODE_EXPERIMENTAL_NAME}, which doesn't yet have the safety rules that they need. ${codeModeExitAndRestartForChromeHint()}`
}

/**
 * Official `Cfi` (`replStartedEmptyNote`): warning prepended when a fresh REPL
 * context is created mid-conversation (e.g. after resume or compaction).
 */
export function replStartedEmptyNote(): string {
  return "⚠ This REPL context is new: variables, functions and timers from earlier scripts in this conversation don't exist in it, even those a compaction summary lists as still defined."
}

/**
 * Official `Fsr` (`offInCodeModeToast`): short toast message when a feature
 * (e.g. Chrome or computer use) is unavailable in Code Mode.
 */
export function offInCodeModeToast(
  featureName = 'Chrome or computer use',
): string {
  const wasOnEarlier = hasCodeModeBeenUsed() && !isCodeModeEnabled()
  return wasOnEarlier
    ? `No ${featureName}: exit and ${formatCodeModeCommand(0, '--resume', 'step')} · ${CODE_MODE_EXPERIMENTAL_NAME} was on earlier in this run`
    : `No ${featureName}: exit and ${formatCodeModeCommand(0, undefined, 'step')} for a new session without ${CODE_MODE_EXPERIMENTAL_NAME}`
}

/**
 * Official `jhe` (`offInCodeModeNoteForModel`): system-prompt note telling the
 * model why Chrome / computer use (or another feature) is unavailable.
 */
export function offInCodeModeNoteForModel(
  featureName = 'Claude in Chrome and computer use',
): string {
  const wasOnEarlier = hasCodeModeBeenUsed() && !isCodeModeEnabled()
  return wasOnEarlier
    ? `${featureName} are not available until the user quits Claude Code: ${CODE_MODE_EXPERIMENTAL_NAME} was on earlier in this run, and a background agent may still be working in it. If the user asks for either, tell them why, and to exit, ${formatCodeModeCommand(0, '--resume', 'step')} (adding --chrome if they started with it) and choose this conversation.`
    : `${featureName} are not available while this session is in ${CODE_MODE_EXPERIMENTAL_NAME}, where the API does not yet add its safety rules for them. If the user asks for either, tell them why, and this: ${codeModeExitAndRestartForChromeHint()}`
}

/**
 * Official `Usr` (`notListedYetNoteForModel`).
 */
export function notListedYetNoteForModel(): string {
  return offInCodeModeNoteForModel()
}

/**
 * Official `Pfi` (`pastItsToolsInCodeModeNote`).
 */
export function pastItsToolsInCodeModeNote(): string {
  return offInCodeModeNoteForModel()
}

/**
 * Official `$sr` (`chromeSectionForWire`): replaces the Chrome system-prompt
 * section with the Code Mode unavailability note when Code Mode is active.
 */
export function chromeSectionForWire(section = ''): string {
  if (section !== '' && isCodeModeEnabled()) {
    return offInCodeModeNoteForModel()
  }
  return section
}

/**
 * Official `Jfi` (`codeModeSignInRestartNotice`).
 */
export function codeModeSignInRestartNotice(): string {
  return `Signed in. Restarting Claude Code to check ${CODE_MODE_EXPERIMENTAL_NAME} for this account…`
}

/**
 * Official `Qfi` (`codeModeSignInRestartFailedNotice`).
 */
export function codeModeSignInRestartFailedNotice(reason: string): string {
  return `Signed in. Claude Code has to restart to check ${CODE_MODE_EXPERIMENTAL_NAME} for this account, and ${reason}, so this session is ending instead. Your sign-in is saved. To go on with this conversation, ${formatCodeModeCommand(1, '--resume', 'step')} and choose it.`
}

/** Test-only reset helper. */
export function resetCodeModeOptInStateForTests(): void {
  accepted = false
  settled = undefined
  dialogOpen = false
  foreseeFn = undefined
  pinned = undefined
  beforePin = undefined
  replContextCreated = false
  engineCheckDone = false
  cachedEngineCheck = undefined
  cachedRawEngineRealmCheck = undefined
  lastAskedIn = undefined
  sandboxCommandNetworkListsOffered = false
  pollEventWiringMode = undefined
  asyncReplEnabledForTests = undefined
  optInReviewed = false
  signedInAccount = undefined
  notifyCodeModeStateChanged()
}

export { CODE_MODE_GROWTHBOOK_GATE }
