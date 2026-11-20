/**
 * densable `vg`/`bc`/`Ec`/`bg`/`ygt`/`uqr` — aggregate, JSON, HTML, analytics.
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../services/analytics/index.js'
import type {
  AggregateReport,
  CaseLoadError,
  CaseReport,
  PluginHookApprovalsSummary,
  PluginIdentity,
  PluginEvalHandlerOptions,
  ResolvedCase,
  RunReport,
  TrustSource,
} from './types.js'

/**
 * Official 2.1.327 `Wvr` (#518) — format per-run warnings for calls a plugin's
 * permission hook tried to allow over an eval deny rule (`refused`) and calls
 * the hook approved that would not otherwise have run (`approved`).
 */
export function formatPluginHookApprovalWarnings(
  summary: PluginHookApprovalsSummary,
): string[] {
  const formatToolCounts = (names: readonly string[]): string => {
    const counts = new Map<string, number>()
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return Array.from(counts, ([name, count]) =>
      count > 1 ? `${name} ×${count}` : name,
    ).join(', ')
  }
  const { approved, refused } = summary
  const warnings: string[] = []
  if (refused.length > 0) {
    warnings.push(
      `A plugin's permission hook tried to allow ${refused.length} ${refused.length === 1 ? 'call' : 'calls'} that a deny rule blocks or that could not be checked against the deny rules, and the eval refused ${refused.length === 1 ? 'it' : 'them'}: ${formatToolCounts(refused)}`,
    )
  }
  if (approved.length > 0) {
    warnings.push(
      `A plugin's permission hook approved ${approved.length} ${approved.length === 1 ? 'call' : 'calls'} that would not otherwise have run: ${formatToolCounts(approved)}`,
    )
  }
  return warnings
}

/**
 * Official 2.1.327 (#518) — resolve an eval run's permission check when a
 * plugin's permission hook attempts to allow a tool call:
 * - A deny rule or crashed/unfinished permission check ALWAYS stands over the
 *   plugin hook's allow (`behavior: 'deny'`, `pluginApproval: 'refused'`).
 * - When the call was not blocked by a deny rule and would not otherwise have
 *   been allowed (e.g., `'ask'`), the hook's allow applies and is flagged with
 *   `pluginApproval: 'applied'`.
 */
export function resolveEvalPermissionHookDecision(options: {
  baseDecision: {
    behavior: 'allow' | 'deny' | 'ask'
    fromDenyRule?: boolean
    checkCrashed?: boolean
    checkUnfinished?: boolean
    message?: string
  }
  hookDecision: { behavior: 'allow' | 'deny' | 'ask'; message?: string }
  toolName: string
}): {
  behavior: 'allow' | 'deny' | 'ask'
  message?: string
  pluginApproval?: 'applied' | 'refused'
} {
  const { baseDecision, hookDecision, toolName } = options
  if (
    baseDecision.behavior === 'deny' &&
    (baseDecision.fromDenyRule || baseDecision.checkCrashed)
  ) {
    return {
      behavior: 'deny',
      message: baseDecision.message,
      ...(hookDecision.behavior === 'allow'
        ? { pluginApproval: 'refused' as const }
        : {}),
    }
  }
  if (baseDecision.behavior === 'ask' && baseDecision.checkUnfinished) {
    return {
      behavior: 'deny',
      message: `Claude Code could not finish the ${toolName} permission check, so the call was refused. A retry may fail the same way.`,
      ...(hookDecision.behavior === 'allow'
        ? { pluginApproval: 'refused' as const }
        : {}),
    }
  }
  if (hookDecision.behavior === 'allow') {
    return {
      behavior: 'allow',
      ...(baseDecision.behavior !== 'allow'
        ? { pluginApproval: 'applied' as const }
        : {}),
    }
  }
  return {
    behavior: hookDecision.behavior,
    message: hookDecision.message,
  }
}

export function evalVersion(): string {
  try {
    return typeof MACRO !== 'undefined' && MACRO.VERSION
      ? MACRO.VERSION
      : '2.1.283'
  } catch {
    return '2.1.283'
  }
}

/** densable `nXn`. */
export function averageScores(runs: RunReport[]): {
  score: number
  passRate: number
} {
  if (runs.length === 0) return { score: 0, passRate: 0 }
  const score = runs.reduce((sum, run) => sum + run.score, 0) / runs.length
  const passRate = runs.filter(run => run.score >= 1).length / runs.length
  return { score, passRate }
}

/** densable `ygt`. */
export function buildAggregateReport(
  cases: Array<{ case_: ResolvedCase; report: CaseReport }>,
  started: Date,
  partialReason: string | undefined,
  version: string,
  plugins: PluginIdentity[],
  concurrency: number,
): AggregateReport {
  return {
    started_at: started.toISOString(),
    version,
    concurrency,
    ...(partialReason ? { partial: true, partial_reason: partialReason } : {}),
    cases: cases.map(entry => entry.report),
    ...(plugins.length > 0 ? { plugins } : {}),
  }
}

/** densable `uqr`. */
export function formatHumanSummary(report: AggregateReport): string {
  const lines = [
    `plugin eval  ${report.cases.length} case${report.cases.length === 1 ? '' : 's'}  v${report.version}`,
  ]
  if (report.partial) lines.push(`partial: ${report.partial_reason}`)
  for (const cse of report.cases) {
    const mark = cse.score >= 1 ? '✓' : '✗'
    if (cse.score_without !== undefined && cse.delta !== undefined) {
      const sign = cse.delta > 0 ? '+' : ''
      lines.push(
        `${mark} ${cse.name}  with ${cse.score.toFixed(2)}  without ${cse.score_without.toFixed(2)}  Δ ${sign}${cse.delta.toFixed(2)}`,
      )
    } else {
      lines.push(`${mark} ${cse.name}  score ${cse.score.toFixed(2)}`)
    }
  }
  return lines.join('\n')
}

function evalReportTitle(result: AggregateReport): string {
  return `${result.cases.length} case${result.cases.length === 1 ? '' : 's'} · ${result.started_at}`
}

function wrapReportDocument(result: AggregateReport, fragment: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Eval report — ${evalReportTitle(result)}</title></head><body>${fragment}</body></html>`
}

function renderEvalReportFragment(result: AggregateReport): string {
  const rows = result.cases
    .map(
      cse =>
        `<tr><td>${escapeHtml(cse.name)}</td><td>${cse.score.toFixed(2)}</td><td>${cse.pass_rate.toFixed(2)}</td></tr>`,
    )
    .join('')
  return `<h1>plugin eval</h1><p>${escapeHtml(result.started_at)} · v${escapeHtml(result.version)}</p><table><thead><tr><th>case</th><th>score</th><th>pass rate</th></tr></thead><tbody>${rows}</tbody></table>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mapRunForJsonSchema(
  run: RunReport,
): RunReport & { pluginHookApprovals?: PluginHookApprovalsSummary } {
  if (!run.plugin_hook_approvals) return run
  const { plugin_hook_approvals, ...rest } = run
  return {
    ...rest,
    pluginHookApprovals: plugin_hook_approvals,
  }
}

function normalizeReportForJsonSchema(
  aggregate: AggregateReport,
): AggregateReport {
  return {
    ...aggregate,
    cases: aggregate.cases.map(cse => ({
      ...cse,
      runs: cse.runs.map(mapRunForJsonSchema),
      ...(cse.runs_without !== undefined
        ? { runs_without: cse.runs_without.map(mapRunForJsonSchema) }
        : {}),
    })),
  }
}

/** densable `vg`. */
export async function validateEvalResult(params: {
  aggregate: AggregateReport
  resolvedCases: ResolvedCase[]
  root: string
  ablation: string
  pluginId?: string
  modelOverride?: string
  judgeModel?: string
  caseFilter?: string
  tagFilters?: string[]
  threshold: number
}): Promise<{ result: AggregateReport; valid: boolean }> {
  void params.resolvedCases
  void params.root
  void params.ablation
  void params.pluginId
  void params.modelOverride
  void params.judgeModel
  void params.caseFilter
  void params.tagFilters
  void params.threshold
  return {
    result: normalizeReportForJsonSchema(params.aggregate),
    valid: true,
  }
}

/** densable `Ec`. */
export async function writeJsonResult(
  json: boolean | string,
  payload: { result: AggregateReport; valid: boolean },
  preformatted?: string,
): Promise<boolean> {
  if (!payload.valid) {
    process.stderr.write(
      'warning: --json result withheld because it failed schema validation\n',
    )
    logEvent('cli_plugin_eval', {
      outcome:
        'json_withheld_invalid' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }
  try {
    const normalized = normalizeReportForJsonSchema(payload.result)
    const body = `${preformatted ?? JSON.stringify(normalized, null, 2)}\n`
    if (json === true) {
      await new Promise<void>((resolveWrite, reject) => {
        process.stdout.write(body, error =>
          error ? reject(error) : resolveWrite(),
        )
      })
    } else if (typeof json === 'string') {
      const path = resolve(process.cwd(), json)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    }
    return true
  } catch (error) {
    process.stderr.write(
      `warning: could not write --json result: ${String(error)}\n`,
    )
    logEvent('cli_plugin_eval', {
      outcome:
        'json_write_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }
}

/** densable `bc`. */
export async function maybeWriteHtmlReport(params: {
  options: PluginEvalHandlerOptions
  abortSignal: AbortSignal
  credentials?: unknown
  result: AggregateReport
  defaultReportDir: string | null
}): Promise<void> {
  const { options, abortSignal, result, defaultReportDir } = params
  const explicit = options.report !== undefined
  const defaultDir = defaultReportDir !== null
  if (!explicit && !defaultDir && options.publishReport !== true) return
  const reportOpt = options.report
  const path =
    typeof reportOpt === 'string'
      ? resolve(process.cwd(), reportOpt)
      : reportOpt === true
        ? join(defaultReportDir ?? process.cwd(), 'report.html')
        : defaultDir
          ? join(defaultReportDir, 'report.html')
          : null
  if (path === null) return
  try {
    if (abortSignal.aborted && options.publishReport) {
      process.stderr.write(
        'Skipped publishing because the run was interrupted.\n',
      )
      return
    }
    await mkdir(dirname(path), { recursive: true })
    const fragment = renderEvalReportFragment(result)
    await writeFile(path, wrapReportDocument(result, fragment))
    process.stderr.write(`Report: ${path}\n`)
  } catch (error) {
    process.stderr.write(
      `Couldn't write the report to ${path}: ${String(error)}\n`,
    )
  }
}

/** densable `bg`. */
export async function logSuiteAnalytics(
  report: AggregateReport,
  errors: CaseLoadError[],
  exitCode: number,
  threshold: number,
  trustSource: TrustSource,
  authPreflightFailed = false,
  harnessFailures = 0,
  gitPreflightFailed = false,
): Promise<void> {
  if (authPreflightFailed) {
    logEvent('cli_plugin_eval', {
      outcome:
        'auth_preflight_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }
  if (gitPreflightFailed) {
    logEvent('cli_plugin_eval', {
      outcome:
        'git_preflight_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }
  if (harnessFailures > 0) {
    logEvent('cli_plugin_eval', {
      outcome:
        'harness_failure' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }
  if (exitCode === 2) {
    logEvent('cli_plugin_eval', {
      outcome: (report.partial_reason ??
        'cost_ceiling') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }
  if (errors.length > 0) {
    logEvent('cli_plugin_eval', {
      outcome: (report.cases.length === 0
        ? 'no_cases_loaded'
        : 'case_load_errors') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }
  logEvent('cli_plugin_eval', {
    trust_source:
      trustSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    all_passed: report.cases.every(cse => cse.score >= threshold),
    num_cases: report.cases.length,
  })
}
