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
  PluginIdentity,
  PluginEvalHandlerOptions,
  ResolvedCase,
  RunReport,
  TrustSource,
} from './types.js'

export function evalVersion(): string {
  try {
    return typeof MACRO !== 'undefined' && MACRO.VERSION ? MACRO.VERSION : '2.1.283'
  } catch {
    return '2.1.283'
  }
}

/** densable `nXn`. */
export function averageScores(runs: RunReport[]): { score: number; passRate: number } {
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
  return { result: params.aggregate, valid: true }
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
      outcome: 'json_withheld_invalid' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }
  try {
    const body = `${preformatted ?? JSON.stringify(payload.result, null, 2)}\n`
    if (json === true) {
      await new Promise<void>((resolveWrite, reject) => {
        process.stdout.write(body, error => (error ? reject(error) : resolveWrite()))
      })
    } else if (typeof json === 'string') {
      const path = resolve(process.cwd(), json)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    }
    return true
  } catch (error) {
    process.stderr.write(`warning: could not write --json result: ${String(error)}\n`)
    logEvent('cli_plugin_eval', {
      outcome: 'json_write_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
      process.stderr.write('Skipped publishing because the run was interrupted.\n')
      return
    }
    await mkdir(dirname(path), { recursive: true })
    const fragment = renderEvalReportFragment(result)
    await writeFile(path, wrapReportDocument(result, fragment))
    process.stderr.write(`Report: ${path}\n`)
  } catch (error) {
    process.stderr.write(`Couldn't write the report to ${path}: ${String(error)}\n`)
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
      outcome: 'auth_preflight_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }
  if (gitPreflightFailed) {
    logEvent('cli_plugin_eval', {
      outcome: 'git_preflight_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }
  if (harnessFailures > 0) {
    logEvent('cli_plugin_eval', {
      outcome: 'harness_failure' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
    trust_source: trustSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    all_passed: report.cases.every(cse => cse.score >= threshold),
    num_cases: report.cases.length,
  })
}
