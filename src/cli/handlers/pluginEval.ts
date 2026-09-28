/**
 * densable pluginEvalHandler / pluginEvalInitHandler (CLI subset).
 *
 * densable `$R` subset: yPt gate, git ≥2.31 (`Li`), `Cc` target resolve,
 * `--eval-dir` (`fr`), `_d` case scan, then empty-case refuse
 * (`No eval cases found${gt} under ${b}.`). Child spawn / graders / HTML
 * report are not invented. Kill-switch: `tengu_sharded_snowflake`.
 */

import { mkdir, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  initializeGrowthBook,
} from '../../services/analytics/growthbook.js'
import { withTimeout } from '../../utils/sleep.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import {
  BARE_CRITERIA,
  BARE_PROMPT,
  CASE_NAME_RE,
  MAX_CONCURRENCY,
} from '../../utils/plugins/pluginEval/constants.js'
import {
  discoverEvalCaseDirs,
  emptyCaseFilterText,
} from '../../utils/plugins/pluginEval/discoverCases.js'
import {
  evalDirDisplay,
  resolveEvalDir,
} from '../../utils/plugins/pluginEval/evalDir.js'
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
  report?: string
  publishReport?: boolean
  publish?: boolean
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

/**
 * densable $R: git ≥2.31, resolve target, `--eval-dir`, then `mc` scan.
 * Full graders / child spawn / HTML report are not invented — empty-case
 * refuse is after scan (`No eval cases found${gt} under ${b}.`).
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
        `Error: ${resolved.pluginId} has a recorded install path that is not owned by you, is writable by other users, is a symlink, or could not be fully examined (see --debug); reinstall it, or pass ./<dir> to evaluate a directory.\n`,
      )
      process.exit(1)
      return
    }
    root = resolve(resolved.root)
    if (resolved.kind === 'plugin') pluginId = resolved.pluginId
  }

  const evalDir = await resolveEvalDir({
    flag: options.evalDir,
    pluginRoot: pluginId ? root : null,
  })
  if (!evalDir.ok) {
    process.stderr.write(`Error: ${evalDir.error}\n`)
    logEvent('cli_plugin_eval', {
      outcome:
        'eval_dir_refused' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exit(1)
    return
  }
  if (evalDir.warning) {
    process.stderr.write(`Warning: ${evalDir.warning}\n`)
  }

  let { caseDirs } = await discoverEvalCaseDirs(root, evalDir.value.segments)
  if (options.case) {
    const needle = options.case
    caseDirs = caseDirs.filter(
      dir => dir.includes(needle) || dir.split(sep).at(-1)?.includes(needle),
    )
  }
  const under = join(root, ...evalDir.value.segments)
  if (caseDirs.length === 0) {
    const gt = emptyCaseFilterText(options.case, options.tag)
    process.stderr.write(`No eval cases found${gt} under ${under}.\n`)
    if (!options.json) {
      if (gt) {
        process.stderr.write(
          `Run without ${options.case && options.tag?.length ? 'the filters' : gt.trim()} to see all cases.\n`,
        )
      } else {
        process.stderr.write(
          `Cases are expected in a ${evalDirDisplay(evalDir.value)}/ directory under ${root}, each case a directory containing case.yaml or prompt.md.\n`,
        )
        if (!pluginId) {
          const suffix =
            evalDir.value.source === 'flag'
              ? ` --eval-dir ${evalDirDisplay(evalDir.value)}`
              : ''
          process.stderr.write(
            `Run \`claude plugin eval init${suffix}\` for a guided interview, or \`claude plugin eval init --bare <name>${suffix}\` to scaffold a blank case.\n`,
          )
        }
      }
    }
    logEvent('cli_plugin_eval', {
      outcome:
        'no_cases' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exit(1)
    return
  }

  // densable `mc({rootPath, evalDirSegments, …})` would run these cases.
  // Graders / child spawn / HTML report are not invented (invent-ban).
  process.stderr.write(`Error: mc\n`)
  logEvent('cli_plugin_eval', {
    outcome:
      'exception' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  process.exit(1)
}

export type PluginEvalInitOptions = {
  bare?: boolean
  forceInteractive?: boolean
  evalDir?: string
}

/**
 * densable NR `--bare` path: write prompt.md + graders/criteria.md.
 * Interview / TTY authoring is not landed in this subset.
 */
export async function pluginEvalInitHandler(
  name: string | undefined,
  options: PluginEvalInitOptions = {},
): Promise<void> {
  if (!options.bare || name === undefined) {
    if (options.bare && name === undefined) {
      process.stderr.write(
        'A case name is required for --bare. Run without --bare for the interview, which writes one case per input.\n',
      )
      process.exit(1)
      return
    }
    process.stderr.write(
      'The authoring interview requires an interactive terminal (TTY). Run `claude plugin eval init` in a terminal, or drop --interactive and pass a case name (e.g. `claude plugin eval init my-case`) to write a blank template instead.\n',
    )
    process.exit(1)
    return
  }
  if (!CASE_NAME_RE.test(name) || name.includes('..') || name.includes('/')) {
    process.stderr.write(
      `Error: case name ${JSON.stringify(name)} is invalid — use letters, digits, '.', '_', '-' only (no '/', no '..')\n`,
    )
    process.exit(1)
    return
  }
  const evalDir = options.evalDir ?? 'evals'
  const cwd = process.cwd()
  const caseDir = join(cwd, evalDir, name)
  const promptPath = join(caseDir, 'prompt.md')
  const criteriaPath = join(caseDir, 'graders', 'criteria.md')
  await mkdir(join(caseDir, 'graders'), { recursive: true })
  await writeFile(promptPath, BARE_PROMPT, { encoding: 'utf-8', flag: 'wx' })
  await writeFile(criteriaPath, BARE_CRITERIA, {
    encoding: 'utf-8',
    flag: 'wx',
  })
  process.stdout.write(
    `Created ${join(evalDir, name, 'prompt.md')} and ${join(evalDir, name, 'graders', 'criteria.md')}\n`,
  )
  process.exit(0)
}
