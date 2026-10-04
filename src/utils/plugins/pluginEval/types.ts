export type AblationMode = 'none' | 'with-without' | 'auto'
export type MocksMode = 'record' | 'off'
export type CaseSource = 'case_yaml' | 'prose' | 'mixed'
export type TrustSource = 'installed' | 'folder' | 'flag' | 'gate'
export type EvalDirSource = 'flag' | 'manifest' | 'default'
export type RunArm = 'with' | 'without'

export type PluginEvalHandlerOptions = {
  evalDir?: string
  json?: boolean | string
  trustPlugin?: boolean
  ablation?: string
  case?: string
  tag?: string[]
  runs?: string
  concurrency?: string
  model?: string
  judgeModel?: string
  maxCostUsd?: string
  outputDir?: string
  threshold?: string
  allowTools?: string[]
  scaffold?: boolean
  noScaffold?: boolean
  mocks?: string
  allowRealServers?: boolean
  keepTemp?: boolean
  verbose?: boolean
  report?: boolean | string
  publishReport?: boolean
  publish?: boolean
}

export type PluginEvalInitOptions = {
  bare?: boolean
  forceInteractive?: boolean
  evalDir?: string
}

export type GraderArm = 'with-only' | 'both'

export type RegexTarget =
  | 'trace'
  | 'last_message'
  | 'files'
  | 'mock_calls'
  | { source: 'file'; path: string }

export type ToolMatch = {
  tool: string
  input_match?: string
}

export type RegexGrader = {
  type: 'regex'
  name: string
  target: RegexTarget
  pattern: string
  flags: string
  match: string
  weight: number
  arm?: GraderArm
}

export type ToolOrderGrader = {
  type: 'tool_order'
  name: string
  before: ToolMatch
  after: ToolMatch
  weight: number
  arm?: GraderArm
}

export type ToolUsedGrader = {
  type: 'tool_used'
  name: string
  tool: string
  input_match?: string
  min?: number
  max?: number
  weight: number
  arm?: GraderArm
}

export type FileExistsGrader = {
  type: 'file_exists'
  name: string
  path: string
  exists: boolean
  weight: number
  arm?: GraderArm
}

export type LlmGrader = {
  type: 'llm'
  name: string
  criteria: string
  focus: RegexTarget
  weight: number
  arm?: GraderArm
}

export type BaselineGrader = {
  type: 'baseline'
  name: string
  baseline_file: string
  criteria: string
  weight: number
  arm?: GraderArm
}

export type Grader =
  | RegexGrader
  | ToolOrderGrader
  | ToolUsedGrader
  | FileExistsGrader
  | LlmGrader
  | BaselineGrader

export type CaseDefinition = {
  schema_version: string
  name: string
  description?: string
  tags: string[]
  plugins?: string[]
  context: {
    scaffold_script?: string
    history_file?: string
    add_dirs: string[]
  }
  execution: {
    prompt?: string
    max_turns: number
    timeout_seconds: number
    model?: string
    allowed_tools: string[]
    artifact_publish?: boolean
    growthbook_overrides?: Record<string, unknown>
    append_system_prompt?: string
    env: Record<string, string>
  }
  runs: number
  graders: Grader[]
  expected_outcome?: string
}

export type ResolvedCase = CaseDefinition & {
  caseFile: string
  caseDir: string
  caseSource: CaseSource
  pluginDirs: string[]
  pluginDirsUnderTest: string[]
  evalDirSegments: string[]
}

export type CaseLoadError = {
  file: string
  error: string
}

export type EvalDirValue = {
  dir: string
  segments: string[]
  source: EvalDirSource
  manifestPath?: string
  componentOverlap?: string
  componentOverlapUnverifiable?: boolean
  componentOverlapRecourse?: string
}

export type EvalDirResult =
  | { ok: true; value: EvalDirValue; warning?: string }
  | { ok: false; error: string }

export type GraderResult = {
  name: string
  passed: boolean
  weight: number
  explanation: string
  with_only?: boolean
  scored?: boolean
}

export type ToolCallRecord = {
  name: string
  input: unknown
  inputText: string
  output?: string
  isError?: boolean
  deniedByChild?: boolean
  mock?: { responder?: string; verdict: string }
}

export type AgentRunResult = {
  lastAssistantText: string
  trace: unknown[]
  toolCalls: ToolCallRecord[]
  numTurns: number
  costUsd: number
  error: string | null
  timedOut: boolean
  /** densable `vp` `killedInFlight:n` — timeout/abort/oversize kill. */
  killedInFlight?: boolean
  aborted: { server: string; tool: string; reason: string } | null
  mockSetupFailure: string | null
  mockTally: { total: number; errors: number; unmocked: string[] } | null
  mockCalls: unknown[]
  mockRecordings: unknown[]
  artifactPublishes: unknown[]
  authRejected: boolean | null
  tracePath: string
}

export type RunReport = {
  score: number
  turns: number
  cost_usd: number
  judge_cost_usd: number
  graders: GraderResult[]
  trace_path: string
  error: string | null
  skipped_paid_graders?: boolean
  auth_rejected?: boolean | null
  aborted?: { server: string; tool: string; reason: string }
}

export type CaseReport = {
  name: string
  dir: string
  source: CaseSource
  score: number
  pass_rate: number
  runs: RunReport[]
  pass_rate_without?: number
  runs_without?: RunReport[]
  score_without?: number
  delta?: number
}

export type PluginIdentity = {
  name: string
  path: string
  version?: string
  problem?:
    | 'manifest_invalid'
    | 'identity_unverified'
    | 'disabled_by_default'
    | 'archive_not_probed'
    | 'will_not_load'
  problemDetail?: string
}

export type AggregateReport = {
  started_at: string
  version: string
  concurrency: number
  partial?: boolean
  partial_reason?: string
  cases: CaseReport[]
  plugins?: PluginIdentity[]
}

export type SuiteOutcome = {
  report: AggregateReport
  exitCode: number
  errors: CaseLoadError[]
  root: string
  resolvedCases: ResolvedCase[]
  authPreflightFailed?: boolean
  gitPreflightFailed?: boolean
  harnessFailures: number
  ablation: AblationMode
  suite: string | null
}

export type AuthPreflightResult =
  | { ok: true; warning?: string }
  | { ok: false; message: string }

export type PluginEvalTrustState = {
  realCwd?: Promise<string>
  consentRoot?: string
}

export type RunPluginEvalSuiteParams = {
  rootPath: string
  evalDirSegments: string[]
  frameRoot: string | null
  adoptionDecided: boolean
  trust: PluginEvalTrustState
  targetScreened: boolean
  consentDecided: boolean
  caseGlob?: string
  tags?: string[]
  runs?: number
  concurrency: number
  model?: string
  judgeModel?: string
  maxCostUsd?: number
  threshold: number
  allowTools: string[]
  /** densable `mc` `n.artifactPublish` — operator opt-in for gold `Ji`. */
  artifactPublish?: boolean
  /** densable `mc` `n.allowFlagOverrides` — gold `lg` GB key allowlist. */
  allowFlagOverrides?: string[]
  noScaffold: boolean
  keepTemp: boolean
  mocks: MocksMode
  allowRealServers: boolean
  keepFailedRuns: boolean
  verbose: boolean
  ablation: AblationMode | 'auto'
  onLine: (line: string) => void
  onNotice: (line: string) => void
  signal: AbortSignal
  authPreflight: () => Promise<AuthPreflightResult>
  credentials?: unknown
}

export type EvalSandbox = {
  root: string
  cwd: string
  configDir: string
  home: string
  outDir: string
  tmpDir: string
  operatorConfigDir: string
  cleanup: () => Promise<void>
}

export type ScreenedEvalTarget = {
  targetDir: string
  pluginRoot: string | null
  untrustedManifestDir: string | null
  targetResolved: boolean
  enclosingVerdict: {
    adopted: string | null
    refused: string | null
    namedOnly: string | null
  } | null
  targetIsCaseFile: boolean
}

export type TrustDecision =
  | { trusted: true; source: TrustSource }
  | { trusted: false; reason: 'no_prompt' | 'declined'; message: string }

export type MockServerBinding = {
  kind: 'shadow' | 'standalone'
  registeredName: string
  segment: string
  withheld?: boolean
  loaded: {
    dirName: string
    tools: Map<
      string,
      {
        kind: 'fixed' | 'agent'
        prompt?: string
        sourceHash?: string
        sourceFile?: string
        abortWhen?: string | null
        expect?: Record<string, unknown> | null
      }
    >
    listings: Map<string, unknown>
    recordings: Record<string, string>
    replayDir?: string
    pinNotes?: string[]
  }
}

export type PreparedMocks = {
  servers: MockServerBinding[]
  notes: string[]
}
