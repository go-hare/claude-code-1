/**
 * densable `$R` — plugin eval CLI. After flag checks + target/`fr`/`Oc`/`Zi`,
 * calls densable `mc` (`runPluginEvalSuite`). Empty-case refuse is AFTER mc
 * returns cases.length===0 (`No eval cases found${gt} under ${b}.`).
 * Kill-switch: `tengu_sharded_snowflake` (yPt).
 */

import { spawnSync } from 'child_process'
import { mkdir, stat, writeFile } from 'fs/promises'
import { join, relative, resolve, sep } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  initializeGrowthBook,
} from '../../services/analytics/growthbook.js'
import { env } from '../../utils/env.js'
import { isPathTrusted } from '../../utils/config.js'
import { getAnthropicApiKey } from '../../utils/auth.js'
import { isChildSession } from '../../utils/sessionRoleEnv.js'
import { withTimeout } from '../../utils/sleep.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import {
  BARE_CRITERIA,
  BARE_PROMPT,
  CASE_NAME_RE,
  DEFAULT_EVAL_DIR,
  MAX_CONCURRENCY,
  OWNERSHIP_REFUSE,
} from '../../utils/plugins/pluginEval/constants.js'
import { emptyCaseFilterText } from '../../utils/plugins/pluginEval/discoverCases.js'
import {
  evalDirDisplay,
  evalDirFlagSuffix,
  evalDirSourceLabel,
  resolveEvalDir,
} from '../../utils/plugins/pluginEval/evalDir.js'
import {
  formatHumanSummary,
  logSuiteAnalytics,
  maybeWriteHtmlReport,
  validateEvalResult,
  writeJsonResult,
} from '../../utils/plugins/pluginEval/report.js'
import { resolveEvalNoScaffold } from '../../utils/plugins/pluginEval/evalScaffold.js'
import { runPluginEvalSuite } from '../../utils/plugins/pluginEval/runSuite.js'
import {
  evalDirOverlapArgs,
  screenEvalTarget,
  vetEvalDir,
} from '../../utils/plugins/pluginEval/target.js'
import { isPluginOrSkillFolder } from '../../utils/plugins/pluginEval/loadCases.js'
import {
  childSessionInterviewText,
  evalInterviewPrompt,
  EVAL_INTERVIEW_USER,
} from '../../utils/plugins/pluginEval/interviewPrompt.js'
import {
  decidePluginTrust,
  isInteractiveEvalPrompt,
} from '../../utils/plugins/pluginEval/trust.js'
import type {
  PluginEvalHandlerOptions,
  PluginEvalInitOptions,
} from '../../utils/plugins/pluginEval/types.js'
import {
  assertPluginEvalGitVersion,
  PluginEvalGitError,
} from '../../utils/plugins/pluginEvalGit.js'

/** densable yPt — generally available unless the snowflake kill-switch is on. */
export function isPluginEvalAvailable(): boolean {
  return !getFeatureValue_CACHED_MAY_BE_STALE('tengu_sharded_snowflake', false)
}

export async function ensurePluginEvalAvailable(): Promise<void> {
  try {
    await withTimeout(
      initializeGrowthBook(),
      3000,
      'feature settings fetch timed out',
    )
  } catch {
    // densable: timeout is swallowed; yPt still runs on cached/local gates
  }
  if (!isPluginEvalAvailable()) {
    console.error('`plugin eval` is currently unavailable')
    process.exit(1)
  }
}

type ResolvedEvalTarget =
  | { kind: 'path'; root: string }
  | { kind: 'plugin'; root: string; pluginId: string }
  | { kind: 'ambiguous'; matches: string[] }
  | { kind: 'refused'; pluginId: string }

/**
 * densable `Cc` — plugin name / plugin@marketplace → install path, else path.
 */
async function resolveEvalTarget(target: string): Promise<ResolvedEvalTarget> {
  if (target.includes(sep) || target.includes('/')) {
    return { kind: 'path', root: target }
  }
  const parsed = parsePluginIdentifier(target)
  if (!parsed.marketplace && target.includes('@')) {
    return { kind: 'path', root: target }
  }
  const installed = loadInstalledPluginsV2()
  if (parsed.marketplace) {
    const entries = installed.plugins[target]
    if (!entries || entries.length === 0) {
      return { kind: 'path', root: target }
    }
    const first = entries.find(e => e.installPath) ?? entries[0]
    if (!first?.installPath) {
      return { kind: 'refused', pluginId: target }
    }
    return { kind: 'plugin', root: first.installPath, pluginId: target }
  }
  const loaded = await loadAllPlugins()
  const byName = loaded.enabled
    .concat(loaded.disabled)
    .find(p => p.name === parsed.name)
  const keys = [
    ...Object.keys(installed.plugins).filter(
      k => parsePluginIdentifier(k).name === parsed.name,
    ),
    ...(byName ? [byName.source] : []),
  ]
  const unique = [...new Set(keys)]
  if (unique.length === 0) return { kind: 'path', root: target }
  if (unique.length > 1) return { kind: 'ambiguous', matches: unique }
  if (byName) {
    return { kind: 'plugin', root: byName.path, pluginId: byName.source }
  }
  return resolveEvalTarget(unique[0]!)
}

function stderrLine(message: string): void {
  process.stderr.write(`${message}\n`)
}

async function authPreflight(): Promise<
  { ok: true; warning?: string } | { ok: false; message: string }
> {
  try {
    const key = getAnthropicApiKey()
    if (key) return { ok: true }
    return {
      ok: false,
      message: 'no Anthropic API key or login credential is available',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * densable $R: git ≥2.31, resolve target, `--eval-dir`, then `mc`.
 * Empty-case refuse is after mc (`No eval cases found${gt} under ${b}.`).
 */
export async function pluginEvalHandler(
  target: string | undefined,
  options: PluginEvalHandlerOptions,
): Promise<void> {
  try {
    await assertPluginEvalGitVersion()
  } catch (error) {
    const message =
      error instanceof PluginEvalGitError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)
    process.stderr.write(`Error: ${message}\n`)
    process.exit(1)
    return
  }
  if (options.runs !== undefined) {
    const runs = Number(options.runs)
    if (!Number.isInteger(runs) || runs < 1) {
      process.stderr.write('Error: --runs must be a positive integer\n')
      process.exit(1)
      return
    }
  }
  if (options.threshold !== undefined) {
    const threshold = Number(options.threshold)
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      process.stderr.write('Error: --threshold must be between 0 and 1\n')
      process.exit(1)
      return
    }
  }
  if (
    options.mocks !== undefined &&
    options.mocks !== 'record' &&
    options.mocks !== 'off'
  ) {
    process.stderr.write('Error: --mocks must be record or off\n')
    process.exit(1)
    return
  }
  const mocks = options.mocks === 'off' ? 'off' : 'record'
  if (typeof options.json === 'string' && !options.json.endsWith('.json')) {
    process.stderr.write(
      options.json === ''
        ? 'Error: --json requires a non-empty file path\n'
        : `Error: --json output path must end in .json (got '${options.json}'). If that is your eval target, put it before --json.\n`,
    )
    process.exit(1)
    return
  }
  if (options.report === '') {
    process.stderr.write('Error: --report requires a non-empty file path\n')
    process.exit(1)
    return
  }
  if (options.publish === false && options.publishReport) {
    process.stderr.write(
      'Error: --no-publish and --publish-report are contradictory — pass at most one.\n',
    )
    process.exit(1)
    return
  }
  if (options.maxCostUsd !== undefined) {
    const maxCost = Number(options.maxCostUsd)
    if (!Number.isFinite(maxCost) || maxCost < 0) {
      process.stderr.write(
        'Error: --max-cost-usd must be a non-negative number\n',
      )
      process.exit(1)
      return
    }
  }
  const concurrency =
    options.concurrency === undefined ? 1 : Number(options.concurrency)
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENCY ||
    !/^\d+$/.test(options.concurrency ?? '1')
  ) {
    process.stderr.write(
      `Error: --concurrency must be a whole number from 1 to ${MAX_CONCURRENCY}\n`,
    )
    process.exit(1)
    return
  }

  let root = resolve(target ?? '.')
  let pluginId: string | undefined
  if (target) {
    const resolved = await resolveEvalTarget(target)
    if (resolved.kind === 'ambiguous') {
      process.stderr.write(
        `Error: plugin name "${target}" is ambiguous — matches ${resolved.matches.join(', ')}. Specify the full plugin@marketplace identifier.\n`,
      )
      process.exit(1)
      return
    }
    if (resolved.kind === 'refused') {
      process.stderr.write(
        `Error: ${resolved.pluginId} has a recorded install path that ${OWNERSHIP_REFUSE}; reinstall it, or pass ./<dir> to evaluate a directory.\n`,
      )
      process.exit(1)
      return
    }
    root = resolve(resolved.root)
    if (resolved.kind === 'plugin') pluginId = resolved.pluginId
  }

  const trust = {}
  let screened
  try {
    screened = await screenEvalTarget(root, pluginId, trust)
  } catch (error) {
    stderrLine(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    )
    logEvent('cli_plugin_eval', {
      outcome:
        'exception' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exit(1)
    return
  }
  const {
    targetDir,
    pluginRoot,
    untrustedManifestDir,
    targetResolved,
    enclosingVerdict,
    targetIsCaseFile,
  } = screened
  const unresolved = !targetResolved && pluginId === undefined
  const trustDecision = await decidePluginTrust({
    pluginDir: pluginRoot ?? targetDir,
    installedPluginId: pluginId,
    trustPluginFlag: options.trustPlugin === true,
    canPrompt:
      !unresolved && isInteractiveEvalPrompt(options.json) && !env.isCI,
  })
  if (!trustDecision.trusted) {
    if (unresolved) {
      stderrLine(
        `Error: ${targetDir} could not be found or read - nothing to evaluate (nothing was loaded or run).`,
      )
      logEvent('cli_plugin_eval', {
        outcome:
          'target_unresolved' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      process.exit(1)
      return
    }
    stderrLine(trustDecision.message)
    logEvent('cli_plugin_eval', {
      outcome: (trustDecision.reason === 'declined'
        ? 'untrusted_declined'
        : 'untrusted_no_prompt') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exit(1)
    return
  }

  const verdict =
    targetResolved &&
    pluginRoot === null &&
    untrustedManifestDir === null &&
    !pluginId &&
    enclosingVerdict !== null
      ? enclosingVerdict
      : { adopted: null, refused: null, namedOnly: null }
  const otherManifestDir =
    pluginRoot === null
      ? (untrustedManifestDir ??
        (targetIsCaseFile ? null : verdict.adopted) ??
        verdict.refused ??
        (targetIsCaseFile ? verdict.namedOnly : null))
      : null
  const overlap = evalDirOverlapArgs({
    scopeDir: targetDir,
    scopeIsNamedDirectory: !targetIsCaseFile,
    trustedRoot: pluginRoot,
    otherManifestDir,
    adoptedAbove: verdict.adopted,
  })
  let evalDir = await resolveEvalDir({
    flag: options.evalDir,
    pluginRoot: overlap.pluginRoot,
  })
  if (!evalDir.ok) {
    stderrLine(`Error: ${evalDir.error}`)
    logEvent('cli_plugin_eval', {
      outcome:
        'eval_dir_refused' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exit(1)
    return
  }
  if (evalDir.warning) stderrLine(`Warning: ${evalDir.warning}`)
  try {
    evalDir = {
      ...evalDir,
      value: await vetEvalDir(pluginRoot ?? targetDir, evalDir.value),
    }
  } catch (error) {
    stderrLine(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    )
    logEvent('cli_plugin_eval', {
      outcome:
        'eval_dir_unvettable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exit(1)
    return
  }

  const noScaffold = resolveEvalNoScaffold(options)
  if (!noScaffold) {
    process.stderr.write(
      `Note: --scaffold runs each case's scaffold_script as you. Only use it on case files you (or your org) authored.\n`,
    )
  }

  const abort = new AbortController()
  let interruptedBy: 'SIGINT' | 'SIGTERM' | null = null
  const onInt = () => {
    interruptedBy ??= 'SIGINT'
    if (!abort.signal.aborted) {
      process.stderr.write('\nInterrupted — finishing up…\n')
      abort.abort()
    }
  }
  const onTerm = () => {
    interruptedBy ??= 'SIGTERM'
    if (!abort.signal.aborted) {
      process.stderr.write('\nTerminated — finishing up…\n')
      abort.abort()
    }
  }
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)

  try {
    const {
      report,
      exitCode,
      errors,
      root: suiteRoot,
      resolvedCases,
      authPreflightFailed,
      gitPreflightFailed,
      harnessFailures,
      ablation,
      suite,
    } = await runPluginEvalSuite({
      rootPath: root,
      evalDirSegments: evalDir.value.segments,
      frameRoot: pluginRoot,
      adoptionDecided: pluginId !== undefined || targetResolved,
      trust,
      targetScreened: true,
      consentDecided: pluginId !== undefined || targetResolved,
      caseGlob: options.case,
      tags: options.tag,
      runs: options.runs !== undefined ? Number(options.runs) : undefined,
      concurrency,
      model: options.model,
      judgeModel: options.judgeModel,
      maxCostUsd:
        options.maxCostUsd !== undefined
          ? Number(options.maxCostUsd)
          : undefined,
      threshold:
        options.threshold !== undefined ? Number(options.threshold) : 1,
      allowTools: options.allowTools ?? [],
      noScaffold,
      keepTemp: options.keepTemp ?? false,
      mocks,
      allowRealServers: options.allowRealServers === true,
      keepFailedRuns: !options.json,
      verbose: options.verbose ?? false,
      ablation:
        (options.ablation as 'none' | 'with-without' | undefined) ??
        (pluginId ? 'with-without' : 'auto'),
      onLine: line => {
        if (!options.json) process.stderr.write(`${line}\n`)
      },
      onNotice: line => process.stderr.write(`${line}\n`),
      signal: abort.signal,
      authPreflight,
    })
    const validated = await validateEvalResult({
      aggregate: report,
      resolvedCases,
      root: suiteRoot,
      ablation,
      pluginId,
      modelOverride: options.model,
      judgeModel: options.judgeModel,
      caseFilter: options.case,
      tagFilters: options.tag,
      threshold:
        options.threshold !== undefined ? Number(options.threshold) : 1,
    })
    if (
      report.cases.length === 0 &&
      errors.length === 0 &&
      !report.partial &&
      !abort.signal.aborted
    ) {
      const gt = emptyCaseFilterText(options.case, options.tag)
      stderrLine(`No eval cases found${gt} under ${targetDir}.`)
      if (!options.json) {
        if (gt) {
          process.stderr.write(
            `Run without ${options.case && options.tag?.length ? 'the filters' : gt.trim()} to see all cases.\n`,
          )
        } else {
          process.stderr.write(
            `Cases are expected in a ${evalDirDisplay(evalDir.value)}/ directory under ${pluginRoot ?? targetDir} (${evalDirSourceLabel(evalDir.value)}), each case a directory containing case.yaml or prompt.md.\n`,
          )
          if (!pluginId) {
            process.stderr.write(
              `Run \`claude plugin eval init${evalDirFlagSuffix(evalDir.value)}\` for a guided interview, or \`claude plugin eval init --bare <name>${evalDirFlagSuffix(evalDir.value)}\` to scaffold a blank case.\n`,
            )
          }
        }
      } else if (
        (await writeJsonResult(options.json, validated)) &&
        typeof options.json === 'string'
      ) {
        process.stderr.write(`Wrote ${options.json}\n`)
      }
      await maybeWriteHtmlReport({
        options,
        abortSignal: abort.signal,
        result: validated.result,
        defaultReportDir: null,
      })
      if (abort.signal.aborted) {
        logEvent('cli_plugin_eval', {
          outcome: (interruptedBy === 'SIGTERM'
            ? 'terminated'
            : 'interrupted') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        process.exit(interruptedBy === 'SIGTERM' ? 143 : 130)
        return
      }
      logEvent('cli_plugin_eval', {
        outcome:
          'no_cases' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      process.exit(1)
      return
    }

    const resultsBase = pluginId ? process.cwd() : (suite ?? suiteRoot)
    const stamp = report.started_at.replace(/[:.]/g, '-')
    const resultsDir =
      options.outputDir ??
      join(
        resultsBase,
        ...(suite === null ? evalDir.value.segments : []),
        'results',
        stamp,
      )
    const jsonBody = `${JSON.stringify(validated.result, null, 2)}\n`
    let wroteDefault = true
    if (report.cases.length > 0 || errors.length === 0) {
      try {
        await mkdir(resultsDir, { recursive: true })
        await writeFile(join(resultsDir, 'aggregate-result.json'), jsonBody)
      } catch (error) {
        wroteDefault = false
        stderrLine(
          `warning: could not write results: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    let jsonFailed = false
    if (options.json) {
      for (const err of errors)
        process.stderr.write(`✗ ${err.file}: ${err.error}\n`)
      if (errors.length > 0 && !authPreflightFailed && !gitPreflightFailed) {
        process.stderr.write(`${errors.length} case file(s) failed to load\n`)
      }
      const wrote = await writeJsonResult(options.json, validated, jsonBody)
      if (wrote && typeof options.json === 'string')
        process.stderr.write(`Wrote ${options.json}\n`)
      else if (!wrote && exitCode === 0) jsonFailed = true
    } else if (!authPreflightFailed && !gitPreflightFailed) {
      process.stderr.write(`\n${formatHumanSummary(report)}\n`)
      if (errors.length > 0) {
        process.stdout.write(
          `\n${errors.length} case file(s) failed to load — see above.\n`,
        )
      }
      if (
        report.cases.some(
          cse =>
            cse.score <
              (options.threshold !== undefined
                ? Number(options.threshold)
                : 1) || cse.runs.some(run => run.error),
        ) &&
        !options.keepTemp
      ) {
        process.stdout.write(
          `\nRe-run with --keep-temp to preserve each run's sandbox (workspace + trace.jsonl) for debugging.\n`,
        )
      }
    }
    await maybeWriteHtmlReport({
      options,
      abortSignal: abort.signal,
      result: validated.result,
      defaultReportDir:
        report.cases.length > 0 && wroteDefault ? resultsDir : null,
    })
    if (abort.signal.aborted) {
      logEvent('cli_plugin_eval', {
        outcome: (interruptedBy === 'SIGTERM'
          ? 'terminated'
          : 'interrupted') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      process.exit(interruptedBy === 'SIGTERM' ? 143 : 130)
      return
    }
    if (jsonFailed) {
      process.exit(1)
      return
    }
    await logSuiteAnalytics(
      report,
      errors,
      exitCode,
      options.threshold !== undefined ? Number(options.threshold) : 1,
      trustDecision.source,
      authPreflightFailed === true,
      harnessFailures,
      gitPreflightFailed === true,
    )
    process.exit(exitCode)
  } catch (error) {
    logEvent('cli_plugin_eval', {
      outcome:
        'exception' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    stderrLine(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  } finally {
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
  }
}

function invalidCaseNameMessage(name: string): string {
  if (!CASE_NAME_RE.test(name) || name.includes('..') || name.includes('/')) {
    return "use letters, digits, '.', '_', '-' only (no '/', no '..')"
  }
  return ''
}

async function spawnEvalInterview(
  pluginDir: string,
  suggestedName: string | undefined,
  evalDir: { dir: string; source: 'flag' | 'manifest' | 'default' },
): Promise<number> {
  const prompt = evalInterviewPrompt(pluginDir, suggestedName, evalDir.dir)
  const script = process.argv[1]
  const args = [
    ...(script ? [script] : []),
    '--append-system-prompt',
    prompt,
    '--strict-mcp-config',
    '--',
    EVAL_INTERVIEW_USER,
  ]
  try {
    process.stdin.setRawMode?.(false)
  } catch {
    // not a TTY
  }
  process.env.CLAUDE_CODE_EVAL_INTERVIEW_SESSION = '1'
  const child = spawnSync(process.execPath, args, {
    cwd: pluginDir,
    stdio: 'inherit',
    env: process.env,
  })
  if (child.error) {
    process.stderr.write(
      `Failed to start interview session: ${child.error.message}\n`,
    )
    return 1
  }
  if (child.status === 0) return 0
  if (child.status === null && child.signal) {
    return child.signal === 'SIGINT' ? 130 : 128
  }
  return child.status ?? 1
}

/**
 * densable `NR`: TTY interview (`Eg`), child-session delegate (`Xs`),
 * or `--bare` / no-TTY blank template.
 */
export async function pluginEvalInitHandler(
  name: string | undefined,
  options: PluginEvalInitOptions = {},
): Promise<void> {
  const tty = process.stdin.isTTY === true && process.stdout.isTTY === true
  const child = isChildSession()
  const wantInterview = !options.bare && (options.forceInteractive || tty)
  if (wantInterview && !tty && !child) {
    process.stderr.write(
      name
        ? `The authoring interview requires an interactive terminal (TTY). Run \`claude plugin eval init\` in a terminal, or drop --interactive to write a blank template for \`${name}\` instead.\n`
        : 'The authoring interview requires an interactive terminal (TTY). Run `claude plugin eval init` in a terminal, or drop --interactive and pass a case name (e.g. `claude plugin eval init my-case`) to write a blank template instead.\n',
    )
    process.exit(1)
    return
  }
  if (name !== undefined) {
    const why = invalidCaseNameMessage(name)
    if (why) {
      process.stderr.write(
        `Error: case name ${JSON.stringify(name)} is invalid — ${why}\n`,
      )
      process.exit(1)
      return
    }
  }
  const kind = child
    ? 'delegate'
    : wantInterview
      ? 'interview'
      : name
        ? 'bare'
        : null
  if (kind === null) {
    process.stderr.write(
      options.bare
        ? 'A case name is required for --bare. Run without --bare for the interview, which writes one case per input.\n'
        : process.env.CLAUDE_CODE_CHILD_SESSION
          ? 'A case name is required here: this looks like a command run by a Claude Code session, but that could not be confirmed (its session marker may be inherited), so the interview was not handed to the session and there is no terminal to hold one. Pass a name to write a blank template, or run `claude plugin eval init` yourself in a terminal for the interview.\n'
          : 'A case name is required when no TTY is available (the interview needs an interactive terminal). Pass a name to write a blank template.\n',
    )
    process.exit(1)
    return
  }
  const cwd = process.cwd()
  const evalDir = await resolveEvalDir({
    flag: options.evalDir,
    pluginRoot: cwd,
  })
  if (!evalDir.ok) {
    process.stderr.write(`Error: ${evalDir.error}\n`)
    process.exit(1)
    return
  }
  if (evalDir.warning) process.stderr.write(`Warning: ${evalDir.warning}\n`)
  if (evalDir.value.componentOverlap !== undefined) {
    process.stderr.write(
      `Error: not scaffolding — ${evalDir.value.componentOverlap}; ${evalDir.value.componentOverlapRecourse ?? 'pass --eval-dir to use another directory'}\n`,
    )
    process.exit(1)
    return
  }
  const isPlugin = await isPluginOrSkillFolder(cwd)
  if (
    !isPlugin &&
    options.evalDir === undefined &&
    !(await stat(join(cwd, DEFAULT_EVAL_DIR)).then(
      s => s.isDirectory(),
      () => false,
    ))
  ) {
    process.stderr.write(
      `Error: ${cwd} is not a plugin or skill folder — run \`claude plugin eval init\` from the plugin's root folder, or pass --eval-dir to scaffold here on purpose.\n`,
    )
    process.exit(1)
    return
  }
  if (kind === 'delegate') {
    process.stdout.write(
      `${childSessionInterviewText(
        cwd,
        name,
        evalDir.value.dir,
        evalDirFlagSuffix(evalDir.value),
        isPathTrusted(cwd),
      )}\n`,
    )
    process.exit(0)
    return
  }
  if (kind === 'interview') {
    const trust = await decidePluginTrust({
      pluginDir: cwd,
      trustPluginFlag: false,
      canPrompt: true,
    })
    if (!trust.trusted) {
      process.stderr.write(`${trust.message}\n`)
      process.exit(1)
      return
    }
    process.exit(await spawnEvalInterview(cwd, name, evalDir.value))
    return
  }
  if (!options.bare && !tty) {
    process.stderr.write(
      'No TTY available — writing a blank template. Re-run in a terminal for the authoring interview.\n',
    )
  }
  const caseName = name!
  const caseDir = join(cwd, evalDir.value.dir, caseName)
  const promptPath = join(caseDir, 'prompt.md')
  const criteriaPath = join(caseDir, 'graders', 'criteria.md')
  try {
    await mkdir(join(caseDir, 'graders'), { recursive: true })
    await writeFile(promptPath, BARE_PROMPT, { encoding: 'utf-8', flag: 'wx' })
    await writeFile(criteriaPath, BARE_CRITERIA, {
      encoding: 'utf-8',
      flag: 'wx',
    })
    process.stdout.write(
      `Created ${relative(cwd, promptPath)} and ${relative(cwd, criteriaPath)}\n`,
    )
    process.exit(0)
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }
}
