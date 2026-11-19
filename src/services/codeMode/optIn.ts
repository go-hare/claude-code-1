/**
 * Code Mode (2.1.323 #1964) opt-in resolution, org/managed policy gating,
 * runtime state, engine check, tool hiding, and user-facing notices.
 *
 * Aligned with official 2.1.323/2.1.325 SEA (`chunk-gwh19369`, `chunk-yw5xfhrq`,
 * `chunk-xjqp3eha`, `chunk-ev5tx9th`).
 */
import * as vm from 'node:vm'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
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

export type ReplEngineCheckResult = 'passed' | 'vm_unavailable' | 'eval_failed'

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
let lastAskedIn: CodeModeOptInSource | undefined

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

/**
 * Official `engineCheckResult` / `primeReplEngineCheck` / `doesEngineCheckAllowCodeMode`:
 * verifies the JS VM engine works cleanly before enabling Code Mode.
 */
export function engineCheckResult(): ReplEngineCheckResult {
  if (cachedEngineCheck !== undefined) return cachedEngineCheck
  engineCheckDone = true
  try {
    if (
      typeof vm.createContext !== 'function' ||
      typeof vm.Script !== 'function'
    ) {
      cachedEngineCheck = 'vm_unavailable'
      return cachedEngineCheck
    }
    const ctx = vm.createContext({ __x: 21 })
    const script = new vm.Script('__x * 2')
    const out = script.runInContext(ctx, { timeout: 1_000 })
    cachedEngineCheck = out === 42 ? 'passed' : 'eval_failed'
  } catch {
    cachedEngineCheck = 'eval_failed'
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
      if (lastRefusal !== undefined) {
        const decision: CodeModeOptInDecision = {
          state: 'refused',
          why: lastRefusal,
        }
        settleCodeModeOptIn(decision)
        return decision
      }
    } catch {
      const decision: CodeModeOptInDecision = {
        state: 'refused',
        why: 'mods',
      }
      settleCodeModeOptIn(decision)
      return decision
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
 * Official `na()` (`isCodeModeEnabled`): true when Code Mode is active for the current session.
 * Also supports direct opt-in via `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` when not explicitly
 * settled/refused and not disabled by org/managed settings.
 */
export function isCodeModeEnabled(): boolean {
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
}

export function unpinCodeMode(): void {
  pinned = undefined
  beforePin = undefined
}

export function codeModeBeforePin(): boolean {
  return beforePin ?? isCodeModeEnabled()
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

const CODE_MODE_VISIBLE_BUILTINS = new Set(['REPL', 'Eval', 'StructuredOutput'])

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
    case 'no_flags':
      return "it needs settings that Claude Code downloads from Anthropic, and this session doesn't download them (DISABLE_TELEMETRY, DO_NOT_TRACK, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC or CLAUDE_CODE_DISABLE_FEATURE_FLAGS turns that off)"
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

export function codeModeChromeNotice(): string {
  return `Claude in Chrome and computer use are off, because this session is in ${CODE_MODE_EXPERIMENTAL_NAME}, which doesn't yet have the safety rules that they need. To use them, exit and start a new session with ${CODE_MODE_NAME} off: ${formatCodeModeCommand(0)} (add --chrome, if you started with it). This conversation can only be continued in ${CODE_MODE_NAME}.`
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
  lastAskedIn = undefined
}

export { CODE_MODE_GROWTHBOOK_GATE }
