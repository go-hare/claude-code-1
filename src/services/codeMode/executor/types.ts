/**
 * Shared types and internal runtime constants for the Code Mode VM executor.
 */
import type { REPLMediaBlock } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import type { AsyncLocalStorage } from 'node:async_hooks'
import type * as vm from 'node:vm'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../../Tool.js'
import type { PermissionResult } from '../../../utils/permissions/PermissionResult.js'
import type { RemoteNativeToolSession } from '../../../utils/toolCreateRuntime.js'
import type {
  ReplDosLimits,
  ReplPlainErrorLine,
  ReplTurnCallBudget,
  ResolvedReplDosLimits,
} from '../replDosGuards.js'
import type { ReplEvalAccess } from '../replSessions.js'

export type CodeModeExecutionResult = {
  result: string
  tool_calls: number
  /** Official 2.1.325 #2315: extra text typed with Yes at permission/plan dialogs. */
  userFeedback?: string[]
  /** Official 2.1.328 #653: tool calls that were still running when the script failed. */
  inFlightAtFailure?: string[]
  /** Official 2.1.328 #576: top-level variables declared in a failed script that remained unset. */
  unsetVariables?: string[]
  /** Inner PreToolUse / PostToolUse hook returned continue: false. */
  hookStoppedContinuation?: boolean
  /** Stop reason from an inner hook that returned continue: false. */
  hookStopReason?: string
  /** Additional context emitted by inner PreToolUse / PostToolUse hooks. */
  hookAdditionalContext?: string[]
  /** Blocking error messages emitted by inner PostToolUse / PreToolUse hooks. */
  hookBlockingErrors?: string[]
  /** Official 2.1.328 (`cs.mapToolResultToToolResultBlockParam`): media blocks (images/documents) returned by inner tools. */
  media?: REPLMediaBlock[]
  /** Official 2.1.328: async REPL eval ID assigned by ReplSessions. */
  evalId?: number
  /** Official 2.1.328: elapsed milliseconds for async REPL eval. */
  ms?: number
  /** Official 2.1.328: true when the eval was dispatched asynchronously past the settle window (or rejected by cap). */
  asyncDispatched?: boolean
  /** Official 2.1.331 (`o$a` / `Sei`): concise user-facing line replacing a verbose REPL TypeError. */
  plainErrorLine?: ReplPlainErrorLine
}

/**
 * Official 2.1.328 (#651): Live command execution progress events emitted while
 * a Code Mode script runs shell commands.
 */
export type CodeModeProgressEvent =
  | { type: 'command_start'; command: string; toolName: string }
  | {
      type: 'command_output'
      command: string
      chunk: string
      stream: 'stdout' | 'stderr'
    }

/**
 * Official 2.1.327 (#386) & 2.1.328 (`J.scriptChecks`): Per-script auto-mode
 * verdict tracker state.
 */
export type AutoScriptVerdictState =
  | 'pending'
  | 'unchecked'
  | 'allowed'
  | 'blocked'
  | 'atLimit'
  | 'none'

export type AutoScriptRecord = {
  id: string
  state: AutoScriptVerdictState
  blockedReason?: string
  blockedDecision?: PermissionResult
}

export type DeferredAutoScriptCheckEntry = {
  id: string
  code: string
  toolUseId: string
  runCheck: (
    combinedCode: string,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
  ) => Promise<PermissionResult>
  stop: (
    message: string,
    batchSize: number,
    cause: 'classifier' | 'monitor',
  ) => void
}

export type AutoScriptAwaitVerdictResult =
  | { kind: 'ride' }
  | { kind: 'checkCall' }
  | { kind: 'blocked'; decision: PermissionResult }

/**
 * Official 2.1.328 (#571): Pauseable timer so the 10-minute Code Mode script
 * deadline does NOT count time spent waiting on an interactive permission
 * prompt (outside auto/bypass), a plan approval (`ExitPlanMode`), or a user
 * question (`AskUserQuestion`).
 */
export type PausableCodeModeTimer = {
  pause: () => void
  resume: () => void
  clear: () => void
  isPaused: () => boolean
  getRemainingMs: () => number
}

/**
 * Official 2.1.328 (#574): Preserve loaded skills, hook context, and
 * permission-approval notes across all scripts in a multi-script reply when
 * resuming a Code Mode session.
 */
export type CodeModeScriptSideEffects = {
  toolUseId: string
  loadedSkills?: string[]
  hookContexts?: string[]
  approvalNotes?: string[]
}

export type CodeModeToolInvoker = (
  toolName: string,
  input: Record<string, unknown>,
  execSignal?: AbortSignal,
) => Promise<unknown>

export type ExecuteCodeModeScriptOptions = {
  code: string
  invokeTool: CodeModeToolInvoker
  timeoutMs?: number
  toolCallCap?: number
  signal?: AbortSignal
  shellKind?: 'bash' | 'powershell'
  /** Official 2.1.328: per-agent/session VM key for persistent VM context reuse across turns. */
  sessionKey?: string
  /** Official 2.1.328 #581: restrict exposed primitive helpers (e.g. omit write/edit for read-only subagents). */
  allowedTools?: ReadonlySet<string>
  /** Official 2.1.328 #576: top-level variables declared in earlier failed scripts that remained unset. */
  unsetVars?: ReadonlySet<string>
  /** Official 2.1.328 #651: live progress callback for commands and streaming output. */
  onProgress?: (event: CodeModeProgressEvent) => void
  /** Official 2.1.328 #571: permission mode used to decide whether tool waits pause the script clock. */
  permissionMode?: string
  /** Optional cache lookup for already-read file contents (used for Edit closest-match hints without prompting). */
  getCachedFileContent?: (filePath: string) => string | undefined
  /** Optional list of all available tool names to expose as PascalCase globals inside the VM. */
  availableToolNames?: readonly string[]
  /** Optional tool metadata for `searchTools()` and `describeTool()` helpers inside the VM. */
  toolDescriptors?: ReadonlyArray<{ name: string; description: string }>
  /** Official 2.1.328: eval ID for `self.running()` self-identification inside the VM. */
  evalId?: number
  /** Official 2.1.331: optional overrides for REPL host-call DoS & input validation limits. */
  dosLimits?: ReplDosLimits
  /** Optional explicit root session for per-session VM/runtime state isolation. */
  session?: RemoteNativeToolSession
}

export type CodeModeResumePlan = {
  pin?: boolean
  unpin?: boolean
  switched: boolean
  refused?: string
  refusedWhy?: string
  /** Official 2.1.328 (`C`): true when an sdkUrlWorker session is downgraded out of Code Mode. */
  declined?: boolean
  /** Official 2.1.328 (`C`/`M`): notice + reminder when taken out of Code Mode on sdkUrlWorker. */
  takenOut?: {
    notice: string
    reminder: string
  }
  /**
   * Official 2.1.325 #2316: true when the resumed session ended mid-Code Mode
   * script — the host MUST wait for the user's next prompt instead of
   * auto-continuing the turn on resume.
   */
  waitForNextPrompt?: boolean
  /**
   * Official 2.1.328 #575: notice delivered to Claude when a Code Mode script
   * was cut off before finishing (including on picker resume or ask-permission mode).
   */
  interruptedScriptNotice?: string
  /**
   * Official 2.1.328 #573: true when resumed Code Mode session is eligible to
   * run scripts in the background in auto/bypass-permissions mode.
   */
  autoBackgroundEligible?: boolean
}

export type ResumedTranscriptMessageLike = {
  type?: string
  message?: {
    role?: string
    content?: unknown
  }
}

export type RealmBridge = {
  cloneToRealm: (val: unknown) => unknown
  makeError: (message: string, name?: string) => Error
  wrapSyncHostFn: (fn: (...args: unknown[]) => unknown) => unknown
  wrapIdentityHostFn: (fn: (...args: unknown[]) => unknown) => unknown
  wrapAsyncHostFn: (fn: (...args: unknown[]) => unknown) => unknown
  createRealmObj: (
    entries: ReadonlyArray<readonly [string, unknown]>,
  ) => unknown
  createNullProtoObj: (
    entries: ReadonlyArray<readonly [string, unknown]>,
  ) => unknown
  createDollarFn: (
    dispatchHost: (
      first: unknown,
      values: unknown[],
    ) => (
      nothrow: boolean,
      ms: number | undefined,
      cwd: string | undefined,
      env: unknown,
    ) => Promise<Record<string, unknown>>,
    escapeHost: (s: unknown) => string,
  ) => unknown
  realmObjectPrototype: object
  realmArrayPrototype: object
}

export type RawRealmBridge = {
  newObj: () => object
  newNullObj: () => object
  newArray: (len: number) => unknown[]
  newDate: (ms: number) => Date
  newRegExp: (source: string, flags: string) => RegExp
  newUint8Array: (
    len: number,
    readByte: (index: number) => number,
  ) => Uint8Array
  newMap: () => Map<unknown, unknown>
  mapSet: (map: Map<unknown, unknown>, key: unknown, value: unknown) => void
  newSet: () => Set<unknown>
  setAdd: (set: Set<unknown>, value: unknown) => void
  defineDataProp: (obj: object, key: string | number, value: unknown) => void
  makeError: (message: string, name?: string) => Error
  wrapSyncHostInvoke: (
    invokeHost: (
      vmArgs: ArrayLike<unknown>,
      onOk: (val: unknown) => void,
      onErr: (msg: string, name: string) => void,
    ) => void,
  ) => unknown
  wrapAsyncHostInvoke: (
    invokeHost: (
      vmArgs: ArrayLike<unknown>,
      onResolve: (val: unknown) => void,
      onReject: (msg: string, name: string) => void,
    ) => void,
  ) => unknown
  createDollarFn: (
    dispatchHost: (
      vmArgs: ArrayLike<unknown>,
      onHandleOk: (
        startRun: (
          readOpts: (
            cb: (
              nothrow: boolean,
              ms: unknown,
              cwd: unknown,
              env: unknown,
            ) => void,
          ) => void,
          onResolve: (val: unknown) => void,
          onReject: (msg: string, name: string) => void,
        ) => void,
      ) => void,
      onErr: (msg: string, name: string) => void,
    ) => void,
    escapeFn: unknown,
  ) => unknown
  attachShellResultMethods: (out: object) => object
  realmObjectPrototype: object
  realmArrayPrototype: object
}

export type CodeModeTurnState = {
  bound: number
  deadline: number
  lastClock: number
  stride: number
  left: number
  rest: number
  budget: number
  stopped: boolean
  budgetStopped: boolean
  clockStops: number
  budgetStops: number
}

export type CodeModeShellRunner = (
  nothrow: boolean,
  msOverride: number | undefined,
  cwdVal: string | undefined,
  envVal: unknown,
) => Promise<Record<string, unknown>>

export type CodeModeEvalBinding = {
  outside: boolean
  ended: boolean
  noMoreCalls: boolean
  shellKind: 'bash' | 'powershell'
  logs: string[]
  turnState: CodeModeTurnState
  clampedTimeout: number
  timers: Set<number>
  allowedTools: ReadonlySet<string> | undefined
  exposedTools: string[]
  toolDescriptors: ReadonlyArray<{ name: string; description: string }>
  evalsAccess: ReplEvalAccess
  dosLimits: ResolvedReplDosLimits
  turnCallBudget: ReplTurnCallBudget
  isStopped: () => boolean
  getStopMessage: () => string
  guardedCall: (toolName: unknown, input?: unknown) => Promise<unknown>
  dispatchDollar: (first: unknown, values: unknown[]) => CodeModeShellRunner
}

export type CodeModeTimerEntry = {
  owner: CodeModeEvalBinding
  clear: () => void
}

export type PersistentCodeModeVmSession = {
  sandbox: Record<string, unknown>
  context: vm.Context
  bridge: RealmBridge
  /** Official `Go`/`Tl` AsyncLocalStorage holding per-eval bindings so concurrent/detached evals never clobber shared sandbox globals. */
  currentCall: AsyncLocalStorage<CodeModeEvalBinding>
  /** Official `L` outside-eval fallback binding when no active eval store is present. */
  outsideBinding: CodeModeEvalBinding
  /** Session-wide timer table (per-eval timers tracked in `binding.timers`). */
  timers: {
    nextId: number
    armed: Map<number, CodeModeTimerEntry>
  }
  /** Tool global names already sealed and bound onto `sandbox` once. */
  boundToolNames: Set<string>
  /** Clear every armed timer owned by any eval in this VM session. */
  clearAllTimers: () => void
  /** Tracks `{ raw: "..." }` literals written directly in script source and their original string value. */
  rawLiteralValues: WeakMap<object, string>
  /** Realm-sealed step-budget checker injected via per-eval IIFE closure param (never exposed on sandbox/self). */
  checkBudgetFn: unknown
  /** Realm-sealed raw-literal marker injected via per-eval IIFE closure param (never exposed on sandbox/self). */
  rawLiteralMarkerFn: unknown
  /** Console ring buffer persisted across turns in this VM session. */
  consoleBuffer: string[]
  consoleDropped: number
}

export type PollEventQueueCommandLike = {
  mode?: string
  agentId?: string
  pollEvent?: {
    kind?: string
    envelope?: string
    settleDropped?: (err: Error) => void
  }
}

export const VALID_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const PRIMITIVE_SHORTHAND_MAP: ReadonlyArray<readonly [string, string]> =
  [
    ['read', 'Read'],
    ['write', 'Write'],
    ['edit', 'Edit'],
    ['glob', 'Glob'],
    ['grep', 'Grep'],
    ['bash', 'Bash'],
    ['powerShell', 'PowerShell'],
    ['notebookEdit', 'NotebookEdit'],
    ['agent', 'Agent'],
  ]

export const MAX_LOG_ENTRY_CHARS = 256 * 1024
export const MAX_FORMAT_DEPTH = 12
export const MAX_CODE_MODE_TIMERS_PER_EVAL = 64
export const CONSOLE_RING_BUFFER_MAX = 500
export const MAX_PERSISTENT_VM_SESSIONS = 32

/**
 * Per-turn step budget, mirroring official `ur()` (REPL step budget) and the
 * stride allocator in `Uc`. A turn is the code from the script's start, a tool
 * call's result, or a timer's firing until the next tool call's result/timer.
 */
export const CODE_MODE_STEP_BUDGET = 50_000_000
export const CODE_MODE_STRIDE_CLOCK_MS = 25
export const CODE_MODE_MAX_STRIDE = 1_000
