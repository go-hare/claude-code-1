/**
 * densable `mc` — plugin eval suite runner.
 * Empty-case is AFTER loadCases (`ma`); gold `$R` then interpolates
 * `No eval cases found${gt} under ${b}.`
 */

import { dirname, relative } from 'path'
import { logForDebugging } from '../../debug.js'
import { assertPluginEvalGitVersion } from '../pluginEvalGit.js'
import { EVAL_AGENT_MOCK_BUDGET_PER_TURN, NEVER_IN_EVAL } from './constants.js'
import { snapshotEvalCwd } from './evalCwdWalk.js'
import {
  addStubPublishListings,
  cwdPlantedEvalArtifacts,
  evalStubPublishDir,
  PLANTED_EVAL_ARTIFACTS,
  PLANTED_EVAL_ARTIFACTS_SCAFFOLD,
} from './evalArtifactsFence.js'
import { logEvalArtifactPublish, logEvalMocks } from './evalAnalytics.js'
import { EvalTokenGate, resolveEvalCredential } from './evalCredential.js'
import {
  grantEvalAllowedTools,
  isEvalArtifactPublishGranted,
  resolveInsideEvalRoot,
  seedEvalGrowthbookOverrides,
} from './evalFence.js'
import {
  adviseFileCreateGraders,
  keptSandboxRmRecipe,
  keptSandboxSealedNotice,
  KEPT_SANDBOX_UNSEALED,
  runEvalScaffold,
  sealKeptEvalSandbox,
} from './evalScaffold.js'
import { gradeRun, scoreGraders } from './graders.js'
import { loadEvalCases } from './loadCases.js'
import { startEvalAgentRelay, type AgentRelayService } from './agentRelay.js'
import { applyAgentMockAnswerIntegrity } from './mockIntegrity.js'
import {
  agentMockCallBudget,
  mockCallsWithOnly,
  mockedToolNames,
  mocksForArm,
  prepareCaseMocks,
  summarizeMocks,
  writeRunMocks,
} from './mocks.js'
import { PluginEvalPathError } from './pathVet.js'
import { averageScores, buildAggregateReport, evalVersion } from './report.js'
import { createEvalSandbox } from './sandbox.js'
import { spawnEvalChild as spawnChild } from './spawnEval.js'
import type {
  AblationMode,
  CaseLoadError,
  CaseReport,
  MockServerBinding,
  PluginIdentity,
  ResolvedCase,
  RunArm,
  RunPluginEvalSuiteParams,
  RunReport,
  SuiteOutcome,
} from './types.js'

function stripAnsi(text: string): string {
  const esc = String.fromCharCode(0x1b, 0x9b)
  const bel = String.fromCharCode(7)
  return text.replace(
    new RegExp(
      `[${esc}][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?${bel})|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))`,
      'g',
    ),
    '',
  )
}

function sink(fn: (line: string) => void): (line: string) => void {
  return line => {
    try {
      fn(line)
    } catch (error) {
      logForDebugging(
        `eval: progress sink failed: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'error' },
      )
    }
  }
}

function filterAllowTools(entries: string[]): {
  allowed: string[]
  denied: string[]
} {
  const allowed: string[] = []
  const denied: string[] = []
  for (const entry of entries) {
    const name = entry.split('(')[0] ?? entry
    if (!name || NEVER_IN_EVAL.has(name) || /[*?]/.test(name))
      denied.push(entry)
    else allowed.push(entry)
  }
  return { allowed: [...new Set(allowed)], denied: [...new Set(denied)] }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

function quote(value: string, max: number): string {
  const cleaned = stripAnsi(value.replace(/\s+/g, ' '))
  const clipped = cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned
  return JSON.stringify(clipped)
}

async function identifyPlugins(dirs: string[]): Promise<PluginIdentity[]> {
  const out: PluginIdentity[] = []
  const seen = new Set<string>()
  for (const dir of dirs) {
    if (seen.has(dir)) continue
    seen.add(dir)
    const name = dir.split(/[\\/]/).pop() ?? dir
    try {
      const { readFile } = await import('fs/promises')
      const { join } = await import('path')
      let raw: string | null = null
      for (const candidate of [
        join(dir, '.claude-plugin', 'plugin.json'),
        join(dir, 'plugin.json'),
      ]) {
        try {
          raw = await readFile(candidate, 'utf8')
          break
        } catch {}
      }
      if (raw === null) {
        out.push({
          name,
          path: dir,
          problem: 'will_not_load',
          problemDetail: 'nothing loadable at this path',
        })
        continue
      }
      const manifest = JSON.parse(raw) as {
        name?: string
        version?: string
        defaultEnabled?: boolean
      }
      out.push({
        name: typeof manifest.name === 'string' ? manifest.name : name,
        ...(typeof manifest.version === 'string'
          ? { version: manifest.version }
          : {}),
        path: dir,
        ...(manifest.defaultEnabled === false
          ? { problem: 'disabled_by_default' as const }
          : {}),
      })
    } catch (error) {
      out.push({
        name,
        path: dir,
        problem: 'manifest_invalid',
        problemDetail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return out
}

function ablationArms(
  cse: ResolvedCase,
  ablation: AblationMode,
  auto: boolean,
): RunArm[] {
  if (ablation !== 'with-without' || cse.pluginDirs.length === 0)
    return ['with']
  if (auto && cse.context.history_file) return ['with']
  return ['with', 'without']
}

function relativeCaseDir(root: string, cse: ResolvedCase): string {
  const rel = relative(root, cse.caseDir)
  return rel === '' ? '.' : rel
}

function warnDuplicateNames(
  cases: ResolvedCase[],
  onLine: (line: string) => void,
): void {
  const byName = new Map<string, string[]>()
  for (const cse of cases) {
    const list = byName.get(cse.name) ?? []
    list.push(cse.caseDir)
    byName.set(cse.name, list)
  }
  for (const [name, dirs] of byName) {
    if (dirs.length > 1) {
      onLine(
        stripAnsi(
          `⚠ ${dirs.length} cases share the name "${name}" (${dirs.join(', ')}); the report and --case filter cannot distinguish them`,
        ),
      )
    }
  }
}

function cwdDiff(before: Set<string>, after: Set<string>): string {
  return [...after]
    .filter(path => !before.has(path))
    .sort()
    .join('\n')
}

async function runOne(
  cse: ResolvedCase,
  index: number,
  runs: number,
  allowed: string[],
  params: RunPluginEvalSuiteParams,
  spent: { value: number },
  arm: RunArm | undefined,
  mockServers: MockServerBinding[],
  mockNotes: string[],
  agentRelay: AgentRelayService | undefined,
  grant: { granted: boolean; seededFlags: Record<string, unknown> },
  tokenGate: EvalTokenGate,
): Promise<RunReport> {
  const started = Date.now()
  const sandbox = await createEvalSandbox()
  let costUsd = 0
  let failed = false
  let holdingGate = false
  try {
    if (cse.context.scaffold_script && !params.noScaffold) {
      const script = await resolveInsideEvalRoot(
        cse.caseDir,
        cse.context.scaffold_script,
        `case "${cse.name}"`,
        'case directory',
      )
      params.onLine(`  scaffold: ${script}`)
      const result = await runEvalScaffold(script, sandbox, params.signal)
      if (result.code !== 0) {
        failed = true
        return {
          score: 0,
          turns: 0,
          cost_usd: 0,
          judge_cost_usd: 0,
          graders: [],
          trace_path: '',
          error: `scaffold failed (exit ${result.code}): ${stripAnsi(result.stderr).slice(0, 500)}`,
        }
      }
    }
    const armServers = mocksForArm(mockServers, arm)
    const agentRun =
      agentRelay !== undefined &&
      agentMockCallBudget(armServers, cse.execution.max_turns) > 0
        ? agentRelay.registerRun({
            model: params.model,
            callBudget:
              EVAL_AGENT_MOCK_BUDGET_PER_TURN * cse.execution.max_turns,
          })
        : null
    if (agentRun) {
      agentRun.attachSpecs(
        armServers.map(server => ({
          registeredName: server.registeredName,
          server: server.loaded.dirName,
          responders: Object.fromEntries(
            [...server.loaded.tools].map(([name, spec]) => [
              name,
              spec.kind === 'agent'
                ? {
                    kind: 'agent' as const,
                    prompt: spec.prompt,
                    abortWhen: spec.abortWhen ?? null,
                    expect: spec.expect ?? null,
                    baseDir: server.loaded.replayDir
                      ? dirname(dirname(server.loaded.replayDir))
                      : cse.caseDir,
                    replay:
                      spec.sourceHash !== undefined
                        ? {
                            mockHash: spec.sourceHash,
                            replayDir: server.loaded.replayDir,
                            pinned: server.loaded.recordings,
                          }
                        : undefined,
                  }
                : spec,
            ]),
          ),
        })),
      )
    }
    const mocks = await writeRunMocks(armServers, sandbox.outDir, {
      maxTurns: cse.execution.max_turns,
      agentRun,
    })
    if (!mocks) agentRun?.dispose()
    await tokenGate.enter()
    holdingGate = true
    const cred = await resolveEvalCredential(
      cse.execution.timeout_seconds,
      tokenGate.rotate.bind(tokenGate),
    )
    if (cred?.warning) params.onLine(`  ⚠ ${cred.warning}`)
    const before = await snapshotEvalCwd(sandbox.cwd)
    if (await cwdPlantedEvalArtifacts(sandbox.cwd, before, 'scaffold')) {
      throw new PluginEvalPathError(
        PLANTED_EVAL_ARTIFACTS_SCAFFOLD,
        'eval scaffold created the reserved publish directory',
      )
    }
    const agent = await spawnChild({
      case_: arm === 'without' ? { ...cse, pluginDirs: [] } : cse,
      sandbox,
      allowedTools: allowed,
      operatorAllowedTools: params.allowTools,
      modelOverride: params.model,
      artifactPublishGranted: grant.granted,
      growthbookOverrides: grant.seededFlags,
      verbose: params.verbose,
      mocks: mocks ?? undefined,
      signal: params.signal,
      credential: cred,
    })
    holdingGate = false
    tokenGate.leave()
    logEvalMocks(agent)
    logEvalArtifactPublish(grant, arm, {
      published: agent.artifactPublishes.length > 0,
      errored: agent.error !== null || agent.timedOut,
    })
    if (mocks) await applyAgentMockAnswerIntegrity(agent, mocks)
    costUsd = agent.costUsd
    const after = await snapshotEvalCwd(sandbox.cwd)
    void mockNotes
    void index
    void runs
    void started
    // densable runOne: aborted or mockSetupFailure skip Yi/gradeRun
    if (agent.aborted !== null || agent.mockSetupFailure !== null) {
      return {
        score: 0,
        turns: agent.numTurns,
        cost_usd: agent.costUsd,
        judge_cost_usd: 0,
        graders: [],
        trace_path: agent.tracePath,
        error:
          agent.mockSetupFailure !== null && agent.error !== null
            ? agent.error
            : null,
        ...(agent.aborted ? { aborted: agent.aborted } : {}),
        ...(agent.authRejected !== null
          ? { auth_rejected: agent.authRejected }
          : {}),
      }
    }
    // densable Yi + dc — planted .eval-artifacts/ refuses file evidence
    if (await cwdPlantedEvalArtifacts(sandbox.cwd, after, 'run')) {
      throw new PluginEvalPathError(
        PLANTED_EVAL_ARTIFACTS,
        'eval run planted the reserved publish directory',
      )
    }
    const granted = grant.granted
    const stubDir = evalStubPublishDir(sandbox)
    if (granted) await addStubPublishListings(after, stubDir)
    // gold ng: skipPaid = this spawn >= maxCostUsd - prior spent (spawn not
    // yet in spent). eg then spent += spawn+judge via returned cost_usd.
    const skipPaid =
      params.maxCostUsd !== undefined &&
      agent.costUsd >= params.maxCostUsd - spent.value
    const graded = await gradeRun({
      case_: cse,
      run: agent,
      cwdDiff: cwdDiff(before, after),
      sandboxCwd: sandbox.cwd,
      stubPublishDir: granted ? stubDir : undefined,
      judgeModel: params.judgeModel,
      skipPaidGraders: skipPaid,
      arm,
      mockCallsWithOnly: mockCallsWithOnly(mockServers, arm),
      signal: params.signal,
      credentials: params.credentials,
    })
    return {
      score: scoreGraders(graded.results),
      turns: agent.numTurns,
      cost_usd: agent.costUsd + graded.judgeCostUsd,
      judge_cost_usd: graded.judgeCostUsd,
      graders: graded.results,
      trace_path: agent.tracePath,
      error: agent.error,
      ...(graded.paidGradersSkipped ? { skipped_paid_graders: true } : {}),
      ...(agent.authRejected !== null
        ? { auth_rejected: agent.authRejected }
        : {}),
      ...(agent.aborted ? { aborted: agent.aborted } : {}),
    }
  } catch (error) {
    failed = true
    return {
      score: 0,
      turns: 0,
      cost_usd: costUsd,
      judge_cost_usd: 0,
      graders: [],
      trace_path: '',
      error: stripAnsi(error instanceof Error ? error.message : String(error)),
    }
  } finally {
    if (holdingGate) tokenGate.leave()
    const keepFailed = failed && params.keepFailedRuns && !params.signal.aborted
    if (params.keepTemp || keepFailed) {
      const sealed = await sealKeptEvalSandbox(sandbox).then(
        path => ({ path, error: null as string | null }),
        error => ({
          path: null as string | null,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      params.onLine(
        `  kept temp${keepFailed && !params.keepTemp ? ' (run failed)' : ''}: ${sandbox.root}`,
      )
      params.onNotice(
        sealed.path !== null
          ? `⚠ kept ${sandbox.root}: ${keptSandboxSealedNotice(sandbox, sealed.path)}`
          : `⚠ kept ${sandbox.root}: ${KEPT_SANDBOX_UNSEALED(sandbox.root, sealed.error ?? 'unknown')}`,
      )
    } else {
      await sandbox.cleanup().catch(error => {
        params.onNotice(
          `⚠ could not remove ${sandbox.root} (${error instanceof Error ? error.message : String(error)}); it holds what the plugin under test wrote — do not run git or anything that loads configuration from a working directory inside it, and remove it (\`${keptSandboxRmRecipe(sandbox.root)}\`)`,
        )
      })
    }
  }
}

function emptyOutcome(
  params: RunPluginEvalSuiteParams,
  errors: CaseLoadError[],
  root: string,
  suite: string | null,
  started: Date,
  ablation: AblationMode,
  plugins: PluginIdentity[],
  extra: Partial<SuiteOutcome> = {},
): SuiteOutcome {
  const report =
    extra.report ??
    buildAggregateReport(
      [],
      started,
      undefined,
      evalVersion(),
      plugins,
      params.concurrency,
    )
  return {
    report,
    exitCode:
      extra.exitCode ?? (params.signal.aborted ? 2 : errors.length > 0 ? 1 : 0),
    errors,
    ablation,
    root,
    suite,
    resolvedCases: extra.resolvedCases ?? [],
    harnessFailures: extra.harnessFailures ?? 0,
    authPreflightFailed: extra.authPreflightFailed,
    gitPreflightFailed: extra.gitPreflightFailed,
  }
}

/** densable `mc`. */
export async function runPluginEvalSuite(
  params: RunPluginEvalSuiteParams,
): Promise<SuiteOutcome> {
  const onLine = sink(line => params.onLine(stripAnsi(line)))
  const onNotice = sink(params.onNotice)
  const concurrency = params.concurrency ?? 1
  const started = new Date()
  const loaded = await loadEvalCases(
    params.rootPath,
    { caseGlob: params.caseGlob, tags: params.tags },
    {
      evalDirSegments: params.evalDirSegments,
      frameRoot: params.frameRoot,
      adoptionDecided: params.adoptionDecided,
      trust: params.trust,
      targetScreened: params.targetScreened,
      consentDecided: params.consentDecided,
    },
  )
  const errors = loaded.errors
  const root = loaded.root
  const suite = loaded.suite
  const allow = filterAllowTools(params.allowTools)
  if (allow.denied.length > 0) {
    errors.push({
      file: '--allow-tools',
      error: `refused ${allow.denied.length} ${plural(allow.denied.length, 'entry', 'entries')}: malformed, a wildcard tool name the child does not support, or a tool never available in an evaluation (Monitor, EnterWorktree, ExitWorktree): ${allow.denied.join(', ')}`,
    })
  }
  params.allowTools = allow.allowed
  for (const error of errors) onLine(`✗ ${error.file}: ${error.error}`)

  let ablation: AblationMode =
    params.ablation === 'auto'
      ? loaded.cases.some(cse => cse.pluginDirs.length > 0)
        ? 'with-without'
        : 'none'
      : params.ablation
  if (params.ablation === 'auto' && ablation === 'with-without') {
    onNotice(
      'Ablation: defaulting to with-without — a plugin resolved from this path, so each case also runs a no-plugin baseline arm (2× runs) and reports Δ; graders marked with-only (including `tool_used: Skill`) become a plugin-fired indicator rather than part of the score. Pass --ablation none for the previous single-arm run and scoring.',
    )
  }
  let cases = loaded.cases
  if (params.ablation === 'auto' && ablation === 'with-without') {
    const single = cases.filter(
      cse => ablationArms(cse, ablation, true).length === 1,
    )
    if (single.length > 0) {
      onNotice(
        `${single.length} ${plural(single.length, 'case')} ${plural(single.length, 'runs', 'run')} single-arm (no Δ) — no plugin to strip, or a replay case whose history carries the plugin into both arms: ${single.map(cse => cse.name).join(', ')}`,
      )
    }
  }
  if (params.ablation === 'with-without') {
    const missing = cases.filter(cse => cse.pluginDirs.length === 0)
    for (const cse of missing) {
      const message =
        'ablation requested but no plugin resolved for this case: auto-detection found no plugin.json, .claude-plugin/plugin.json, or SKILL.md ' +
        'it may load between the case directory and the discovery root — ' +
        'a manifest or skill folder that is not owned by you, is writable by other users, is a symlink, or could not be fully examined (see --debug) is not loaded. The with and without arms would run identical ' +
        'configs, so Δ would measure nothing. Fix: target the plugin ' +
        'directory itself (or run from within it), declare `plugins:` in the case pointing at a plugin or skill directory beneath the discovery root, or pass --ablation none for a single-arm eval.'
      errors.push({
        file: cse.caseSource === 'prose' ? cse.caseDir : cse.caseFile,
        error: message,
      })
      onLine(`✗ ${cse.name}: ${message}`)
    }
    if (missing.length > 0)
      cases = cases.filter(cse => cse.pluginDirs.length > 0)
  }

  if (cases.length === 0) {
    return emptyOutcome(params, errors, root, suite, started, ablation, [], {
      exitCode: params.signal.aborted ? 2 : errors.length > 0 ? 1 : 0,
    })
  }

  warnDuplicateNames(cases, onLine)
  const plugins = await identifyPlugins(cases.flatMap(cse => cse.pluginDirs))
  if (plugins.length === 0) {
    onLine(
      'Plugin under test: none resolved — cases run against baseline Claude Code',
    )
  }
  const dual = ablation === 'with-without'
  const armLabel = dual ? 'the with-arm' : 'this eval'
  for (const plugin of plugins) {
    const version =
      plugin.version === undefined
        ? '(no version)'
        : `version ${quote(plugin.version, 80)}`
    ;(plugin.problem === undefined ? onLine : onNotice)(
      `Plugin under test: ${quote(plugin.name, 160)} ${version} at ${quote(plugin.path, 1000)}`,
    )
    switch (plugin.problem) {
      case undefined:
        break
      case 'manifest_invalid':
        onNotice(
          params.mocks !== 'off' && params.allowRealServers !== true
            ? `  ⚠ its manifest is invalid: its cases are refused (record mode cannot enumerate the MCP servers it declares) — fix the manifest, or pass --mocks off / --allow-real-servers to run ${armLabel} WITHOUT this plugin`
            : `  ⚠ its manifest is invalid, so ${armLabel} will run WITHOUT this plugin`,
        )
        break
      case 'identity_unverified':
        onNotice(
          `  ⚠ identity not verified; the child decides at load time whether it loads${dual ? ' — read a zero Δ here as "may not have loaded"' : ''}`,
        )
        break
      case 'disabled_by_default':
        onNotice(
          `  ⚠ its manifest sets defaultEnabled: false and nothing in the eval sandbox enables it, so ${armLabel} will run WITHOUT this plugin`,
        )
        break
      case 'archive_not_probed':
        onNotice(
          '  ⚠ a plugin archive: its identity was not probed here — the child extracts and loads what is inside it',
        )
        break
      case 'will_not_load':
        onNotice(
          `  ⚠ ${plugin.problemDetail ?? 'nothing loadable at this path'}, so ${armLabel} will run WITHOUT this plugin`,
        )
        break
    }
  }

  const auth = await params.authPreflight()
  if (params.signal.aborted) {
    return emptyOutcome(
      params,
      errors,
      root,
      suite,
      started,
      ablation,
      plugins,
      {
        exitCode: 130,
        report: buildAggregateReport(
          [],
          started,
          'interrupted',
          evalVersion(),
          plugins,
          concurrency,
        ),
      },
    )
  }
  if (!auth.ok) {
    const message = `authentication check failed before running any case — every run would use this same credential: ${auth.message}`
    errors.push({ file: root, error: message })
    onLine(`✗ ${message}`)
    return emptyOutcome(
      params,
      errors,
      root,
      suite,
      started,
      ablation,
      plugins,
      {
        exitCode: 2,
        authPreflightFailed: true,
        report: buildAggregateReport(
          [],
          started,
          'auth_failed',
          evalVersion(),
          plugins,
          concurrency,
        ),
      },
    )
  }
  if (auth.warning !== undefined) onNotice(`Note: ${auth.warning}`)

  try {
    await assertPluginEvalGitVersion()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.push({ file: root, error: message })
    onLine(`✗ ${message}`)
    return emptyOutcome(
      params,
      errors,
      root,
      suite,
      started,
      ablation,
      plugins,
      {
        exitCode: 1,
        gitPreflightFailed: true,
      },
    )
  }

  // densable `Ji` + no --max-cost-usd notice (gold after git preflight).
  if (
    params.maxCostUsd === undefined &&
    cases.some(cse => isEvalArtifactPublishGranted(cse, params))
  ) {
    onNotice(
      'Note: artifact publishing enabled with no --max-cost-usd; consider setting a cost ceiling',
    )
  }

  const mockByCase = new Map<ResolvedCase, MockServerBinding[] | Error>()
  const notesByCase = new Map<ResolvedCase, string[]>()
  let agentRelay: Awaited<ReturnType<typeof startEvalAgentRelay>> | undefined
  const tokenGate = new EvalTokenGate()
  if (params.mocks !== 'off') {
    for (const cse of cases) {
      try {
        const prepared = await prepareCaseMocks(
          cse,
          root,
          params.evalDirSegments,
          {
            allowRealServers: params.allowRealServers === true,
          },
        )
        mockByCase.set(cse, prepared.servers)
        for (const note of prepared.notes) onNotice(`  ${cse.name}: ${note}`)
        notesByCase.set(cse, prepared.notes)
        const needsAgent = prepared.servers.some(server =>
          [...server.loaded.tools.values()].some(tool => tool.kind === 'agent'),
        )
        if (needsAgent && agentRelay === undefined) {
          agentRelay = await startEvalAgentRelay()
        }
      } catch (error) {
        mockByCase.set(
          cse,
          error instanceof Error
            ? error
            : new Error(
                'mocks: could not be prepared for this case (see --verbose)',
              ),
        )
      }
    }
  }

  for (const cse of cases) {
    if (cse.context.scaffold_script && params.noScaffold) {
      onNotice(
        `⚠ case "${cse.name}": its scaffold_script is not run without --scaffold (author-supplied bash that runs as you - pass it only for suites you trust); the case runs against an unstaged workspace`,
      )
    }
    const mock = mockByCase.get(cse)
    const servers = mock === undefined || mock instanceof Error ? [] : mock
    const advice = adviseFileCreateGraders(cse, params.allowTools, {
      scaffolded: Boolean(cse.context.scaffold_script) && !params.noScaffold,
      artifactPublishGranted: isEvalArtifactPublishGranted(cse, params),
      mockedTools: mockedToolNames(servers),
    })
    for (const item of advice) {
      onNotice(`⚠ case "${cse.name}": ${item.text}`)
    }
  }

  type Plan = {
    case_: ResolvedCase
    runs: number
    grant: { granted: boolean; seededFlags: Record<string, unknown> }
    arms: Array<{ arm: RunArm; allowed: string[] }>
    mockServers: MockServerBinding[]
    mockNotes: string[]
    results: Map<RunArm, Array<RunReport | undefined>>
    landed: number
    finalized: boolean
  }
  const reports = new Map<
    ResolvedCase,
    { case_: ResolvedCase; report: CaseReport }
  >()
  const plans: Plan[] = []
  const spent = { value: 0 }
  let partialReason: string | undefined
  let harnessFailures = 0

  const failPlan = (cse: ResolvedCase, error: string) => {
    reports.set(cse, {
      case_: cse,
      report: {
        name: cse.name,
        dir: relativeCaseDir(root, cse),
        source: cse.caseSource,
        score: 0,
        pass_rate: 0,
        runs: [
          {
            score: 0,
            turns: 0,
            cost_usd: 0,
            judge_cost_usd: 0,
            graders: [],
            trace_path: '',
            error,
          },
        ],
      },
    })
  }

  const planCase = (cse: ResolvedCase): Plan | null => {
    const runs = params.runs ?? cse.runs
    const mock = mockByCase.get(cse)
    const servers = mock === undefined || mock instanceof Error ? [] : mock
    if (mock instanceof Error) {
      const message = stripAnsi(mock.message)
      onLine(`  ${cse.name}: ${message}`)
      failPlan(cse, message)
      return null
    }
    if (servers.length > 0)
      onLine(`  ${cse.name}: mocked: ${summarizeMocks(servers)}`)
    const granted = isEvalArtifactPublishGranted(cse, params)
    const tools = grantEvalAllowedTools(
      cse.execution.allowed_tools,
      params.allowTools,
      {
        artifactPublishGranted: granted,
        mockedTools: mockedToolNames(servers),
      },
    )
    if (tools.denied.length > 0) {
      onLine(
        `  ${cse.name}: not granted (missing --allow-tools grant, or a malformed entry): ${tools.denied.join(', ')}`,
      )
    }
    if (
      (tools.denied.some(
        rule =>
          (rule.split('(')[0] ?? rule) === 'Artifact' || rule === 'Artifact',
      ) ||
        params.allowTools.some(
          rule => (rule.split('(')[0] ?? rule) === 'Artifact',
        )) &&
      !granted
    ) {
      onLine(
        `  ${cse.name}: the Artifact tool is not available inside eval runs; --allow-tools cannot enable it`,
      )
    }
    if (cse.execution.artifact_publish === true && !granted) {
      onLine(
        `  ${cse.name}: requests artifact publishing; not granted (operator opt-in required) — running without it`,
      )
    }
    const flags = seedEvalGrowthbookOverrides(cse, params)
    const grant = { granted, seededFlags: flags.seeded }
    if (Object.keys(flags.declared).length > 0) {
      if (!granted) {
        onLine(
          `  ${cse.name}: growthbook_overrides not applied — they seed only a run granted artifact publishing`,
        )
      } else {
        if (Object.keys(flags.seeded).length > 0) {
          onLine(
            `  ${cse.name}: seeding growthbook_overrides ${JSON.stringify(flags.seeded)}`,
          )
        }
        if (flags.dropped.length > 0) {
          onLine(
            `  ${cse.name}: growthbook_overrides dropped (operator allowlist required — CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES): ${JSON.stringify(flags.dropped)}`,
          )
        }
      }
    }
    const allowed = tools.allowed
    const arms = ablationArms(cse, ablation, params.ablation === 'auto').map(
      arm => ({
        arm,
        allowed,
      }),
    )
    return {
      case_: cse,
      runs,
      grant,
      arms,
      mockServers: servers,
      mockNotes: notesByCase.get(cse) ?? [],
      results: new Map(arms.map(a => [a.arm, Array.from({ length: runs })])),
      landed: 0,
      finalized: false,
    }
  }

  const finalize = (plan: Plan) => {
    if (plan.finalized) return
    plan.finalized = true
    const withRuns = (plan.results.get('with') ?? []).filter(
      (r): r is RunReport => r !== undefined,
    )
    const withoutRuns = (plan.results.get('without') ?? []).filter(
      (r): r is RunReport => r !== undefined,
    )
    if (withRuns.length === 0 && partialReason) return
    const withScore = averageScores(withRuns)
    const withoutScore =
      withoutRuns.length > 0 ? averageScores(withoutRuns) : undefined
    const skipped =
      withRuns.some(r => r.skipped_paid_graders) ||
      withoutRuns.some(r => r.skipped_paid_graders)
    const cse = plan.case_
    reports.set(cse, {
      case_: cse,
      report: {
        name: cse.name,
        dir: relativeCaseDir(root, cse),
        source: cse.caseSource,
        score: withScore.score,
        pass_rate: withScore.passRate,
        runs: withRuns,
        ...(withoutScore && withoutRuns.length > 0
          ? {
              pass_rate_without: withoutScore.passRate,
              runs_without: withoutRuns,
              ...(!skipped
                ? {
                    score_without: withoutScore.score,
                    delta: withScore.score - withoutScore.score,
                  }
                : {}),
            }
          : {}),
      },
    })
    const n = withRuns.length + withoutRuns.length
    const cost =
      withRuns.reduce((sum, r) => sum + r.cost_usd, 0) +
      withoutRuns.reduce((sum, r) => sum + r.cost_usd, 0)
    const mark = withScore.score >= params.threshold ? '✓' : '✗'
    if (withoutScore && !skipped) {
      const delta = withScore.score - withoutScore.score
      const sign = delta > 0 ? '+' : ''
      onLine(
        `${mark} ${cse.name}  with ${withScore.score.toFixed(2)}  without ${withoutScore.score.toFixed(2)}  Δ ${sign}${delta.toFixed(2)}  (${n} ${plural(n, 'run')})  $${cost.toFixed(2)}`,
      )
    } else if (withoutScore) {
      onLine(
        `${mark} ${cse.name}  with ${withScore.score.toFixed(2)}  Δ — (cost ceiling: arms graded under different rules)  (${n} ${plural(n, 'run')})  $${cost.toFixed(2)}`,
      )
    } else {
      onLine(
        `${mark} ${cse.name}  score ${withScore.score.toFixed(2)}  (${withRuns.length} ${plural(withRuns.length, 'run')})  $${cost.toFixed(2)}`,
      )
    }
  }

  if (ablation === 'with-without') {
    const total = cases.reduce(
      (sum, cse) =>
        sum +
        (params.runs ?? cse.runs) *
          ablationArms(cse, ablation, params.ablation === 'auto').length,
      0,
    )
    onLine(
      `Ablation: 2 arms × ${cases.length} ${plural(cases.length, 'case')} (${total} ${plural(total, 'run')})`,
    )
  }
  if (concurrency > 1) {
    onLine(
      `Concurrency: up to ${concurrency} runs in flight (all children share your rate limit; progress lines interleave, results keep case order)`,
    )
  }

  const jobs: Array<{ plan: Plan; arm: Plan['arms'][number]; index: number }> =
    []
  for (const cse of cases) {
    if (params.signal.aborted) {
      partialReason ??= 'interrupted'
      break
    }
    let plan: Plan | null
    try {
      plan = planCase(cse)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      failPlan(
        cse,
        `case could not be planned (${message}) — see the debug log`,
      )
      harnessFailures++
      continue
    }
    if (plan === null) continue
    plans.push(plan)
    for (const arm of plan.arms) {
      for (let index = 0; index < plan.runs; index++) {
        jobs.push({ plan, arm, index })
      }
    }
  }

  let cursor = 0
  let authBackstopArmed = true
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]
      if (!job) break
      if (params.signal.aborted) partialReason ??= 'interrupted'
      else if (
        params.maxCostUsd !== undefined &&
        spent.value >= params.maxCostUsd &&
        partialReason === undefined
      ) {
        partialReason = 'cost_ceiling'
        onLine(
          `⚠ cost ceiling $${params.maxCostUsd} hit; skipping remaining cases`,
        )
      }
      if (partialReason) continue
      const { plan, arm, index } = job
      const report = await runOne(
        plan.case_,
        index,
        plan.runs,
        arm.allowed,
        params,
        spent,
        plan.arms.length > 1 ? arm.arm : undefined,
        plan.mockServers,
        plan.mockNotes,
        agentRelay,
        plan.grant,
        tokenGate,
      ).catch((error): RunReport => {
        harnessFailures++
        onLine(
          `  ${plan.case_.name} run ${index + 1}/${plan.runs}${plan.arms.length > 1 ? ` [${arm.arm}]` : ''}: score 0.00  $0.00  error: run could not start: ${error instanceof Error ? error.message : String(error)}`,
        )
        return {
          score: 0,
          turns: 0,
          cost_usd: 0,
          judge_cost_usd: 0,
          graders: [],
          trace_path: '',
          error: `run could not start (${error instanceof Error ? error.message : 'unknown error'}) — see the debug log`,
        } satisfies RunReport
      })
      // gold eg: spent += spawn+judge after ng (report.cost_usd)
      spent.value += report.cost_usd
      const armLabel = plan.arms.length > 1 ? ` [${arm.arm}]` : ''
      const err = report.error
        ? `  error: ${report.error.replace(/\s*\n\s*/g, ' ').slice(0, 200)}`
        : ''
      onLine(
        `  ${plan.case_.name} run ${index + 1}/${plan.runs}${armLabel}: score ${report.score.toFixed(2)}  $${report.cost_usd.toFixed(2)}${err}`,
      )
      for (const grader of report.graders) {
        const extra = grader.with_only
          ? ' [with-only, not scored]'
          : ` (weight ${grader.weight})`
        onLine(
          `    ${grader.passed ? '✓' : '✗'} ${grader.name}${extra}: ${grader.explanation}`,
        )
      }
      // gold eg: first auth_rejected===true stops remaining jobs
      const armed = authBackstopArmed
      if (report.auth_rejected !== undefined) authBackstopArmed = false
      if (
        armed &&
        report.auth_rejected === true &&
        partialReason === undefined
      ) {
        partialReason = 'auth_failed'
        onLine(
          '⚠ a run could not authenticate — every remaining run would fail the same way, so the suite stops here. Fix the credential above and re-run.',
        )
      }
      const slot = plan.results.get(arm.arm)
      if (slot) slot[index] = report
      plan.landed++
      if (plan.landed === plan.arms.length * plan.runs) finalize(plan)
    }
  })
  await Promise.all(workers)
  for (const plan of plans) finalize(plan)
  if (params.signal.aborted) partialReason ??= 'interrupted'

  const ordered = cases.flatMap(cse => {
    const entry = reports.get(cse)
    return entry ? [entry] : []
  })
  const report = buildAggregateReport(
    ordered,
    started,
    partialReason,
    evalVersion(),
    plugins,
    concurrency,
  )
  const allPassed = report.cases.every(cse => cse.score >= params.threshold)
  if (harnessFailures > 0) {
    onNotice(
      `⚠ ${harnessFailures} ${plural(harnessFailures, 'run')} could not be started by the harness (see the errors above and the debug log); the suite exits non-zero regardless of scores`,
    )
  }
  const exitCode = partialReason
    ? 2
    : allPassed && errors.length === 0 && harnessFailures === 0
      ? 0
      : 1
  await agentRelay?.close()
  return {
    report,
    exitCode,
    errors,
    root,
    suite,
    resolvedCases: ordered.map(entry => entry.case_),
    ablation,
    harnessFailures,
  }
}
