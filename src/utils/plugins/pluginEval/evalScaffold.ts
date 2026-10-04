/**
 * densable `rg` / `xl` / `fc` / `Fa` (reduced) — scaffold bash, file-create
 * grader preflight, kept-temp rm recipe, home/tmp seal.
 * densable `rg` spreads `la("plugin")` cgroup extras.
 */
import { spawn } from 'child_process'
import { chmod, lstat, mkdir, rename } from 'fs/promises'
import { join } from 'path'
import { permissionRuleValueFromString } from '../../permissions/permissionRuleParser.js'
import { OFFICIAL_ARTIFACT_TOOL_NAME } from '../../artifactUrl.js'
import { NEVER_IN_EVAL } from './constants.js'
import { extraEvalToolDenies } from './evalFence.js'
import { evalSpawnCgroupExtras } from './evalCgroup.js'
import type { EvalSandbox, Grader, ResolvedCase } from './types.js'
import { PluginEvalPathError } from './pathVet.js'

/** densable `sm` create-file tools (MCP Us omitted — no live Us host). */
const FILE_CREATE_TOOLS = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
  'Bash',
  'PowerShell',
])

const SCAFFOLD_TIMEOUT_MS = 120_000

/**
 * densable `$R` `n.noScaffold === !1` from Commander `--scaffold` /
 * `--no-scaffold`. The pair stores `scaffold`; `noScaffold` is the
 * programmatic suite param.
 */
export function resolveEvalNoScaffold(options: {
  scaffold?: boolean
  noScaffold?: boolean
}): boolean {
  if (options.scaffold === true) return false
  if (options.scaffold === false) return true
  return options.noScaffold ?? true
}

export type FileCreateAdvice = { grader: string; text: string }

/** densable `cm`. */
export function graderChecksCreatedFile(
  grader: Grader,
  scaffolded: boolean,
): boolean {
  switch (grader.type) {
    case 'file_exists':
      return grader.exists
    case 'regex':
      if (
        typeof grader.target === 'object' &&
        grader.target.source === 'file'
      ) {
        return !scaffolded
      }
      return (
        grader.target === 'files' &&
        grader.match !== 'not_contains' &&
        !(
          grader.match.startsWith('count:') &&
          Number(grader.match.slice(6)) === 0
        )
      )
    case 'llm':
      return (
        typeof grader.focus === 'object' &&
        grader.focus.source === 'file' &&
        !scaffolded
      )
    default:
      return false
  }
}

function ruleCreatesFiles(rule: string, mockedTools: Set<string>): boolean {
  if (mockedTools.has(rule)) return false
  const name = permissionRuleValueFromString(rule).toolName
  if (mockedTools.has(name)) return false
  return FILE_CREATE_TOOLS.has(name)
}

/** densable `xl` tool_used / tool_order needed names. */
function neededTraceTools(grader: Grader): string[] {
  switch (grader.type) {
    case 'tool_used':
      return (grader.min ?? 1) >= 1 ? [grader.tool] : []
    case 'tool_order':
      return [grader.before.tool, grader.after.tool]
    default:
      return []
  }
}

function withheldToolHint(tool: string): string {
  if (NEVER_IN_EVAL.has(tool)) {
    return `${tool} is never available inside an eval run — drop the grader, or invert it (max: 0) if absence is the point`
  }
  if (tool === OFFICIAL_ARTIFACT_TOOL_NAME) {
    return `${tool} comes only with the artifact-publishing opt-in this run does not have (not --allow-tools) — opt the case in, or drop the grader`
  }
  return `add ${tool} to the case's allowed_tools and grant it with --allow-tools ${tool}`
}

/**
 * densable `xl` — file-create arm + tool_used/tool_order leftover-deny arm.
 */
export function adviseFileCreateGraders(
  cse: ResolvedCase,
  operatorAllowed: string[],
  opts: {
    scaffolded: boolean
    artifactPublishGranted: boolean
    mockedTools: string[]
  },
): FileCreateAdvice[] {
  const mocked = new Set(opts.mockedTools)
  const allowed = [
    ...new Set([...cse.execution.allowed_tools, ...operatorAllowed]),
  ]
  const out: FileCreateAdvice[] = []
  const needs = cse.graders.filter(grader =>
    graderChecksCreatedFile(grader, opts.scaffolded),
  )
  if (
    needs.length > 0 &&
    !opts.artifactPublishGranted &&
    !allowed.some(rule => ruleCreatesFiles(rule, mocked))
  ) {
    for (const grader of needs) {
      out.push({
        grader: grader.name,
        text: `grader "${grader.name}" cannot pass with the granted tools: it checks a file the run creates, but no tool the run may use can create one (a plugin hook still could; a skill's own allowed-tools does not count inside a run) — add Write (or Edit / Bash) to the case's allowed_tools and grant it with --allow-tools`,
      })
    }
  }
  // gold `h = tr(case.allowed_tools, operator, {artifact, mocked}).allowed`
  // then `Ai(h)`. Case listing Bash/Write is not a grant — tr puts
  // non-ml case tools in denied unless operator/mocked/opt-in already
  // added them. extraEvalToolDenies on operator+mocked+opt-in Artifact.
  const grantedForLeftover = [
    ...operatorAllowed,
    ...opts.mockedTools,
    ...(opts.artifactPublishGranted ? [OFFICIAL_ARTIFACT_TOOL_NAME] : []),
  ]
  const leftover = new Set(extraEvalToolDenies(grantedForLeftover))
  // gold yn withheld unless artifactPublishGranted
  if (!opts.artifactPublishGranted) leftover.add(OFFICIAL_ARTIFACT_TOOL_NAME)
  for (const grader of cse.graders) {
    for (const tool of new Set(neededTraceTools(grader))) {
      if (!leftover.has(tool)) continue
      out.push({
        grader: grader.name,
        text: `grader "${grader.name}" cannot pass with the granted tools: it needs a ${tool} call in the trace, but ${tool} is not granted, so the run withholds it from the model and no call (not even a refused one) can occur — ${withheldToolHint(tool)}`,
      })
    }
  }
  return out
}

/** densable `qr` subset for a single path. */
export function quoteEvalShellPath(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`
}

/** densable `fc`. */
export function keptSandboxRmRecipe(root: string): string {
  if (process.platform === 'win32') {
    return `Remove-Item -Recurse -Force -LiteralPath '${root.replaceAll("'", "''")}'`
  }
  const q = quoteEvalShellPath(root)
  return `chmod -R u+rwX ${q} && rm -rf ${q}`
}

/** densable `Ua`. */
export function keptSandboxSealedNotice(
  sandbox: EvalSandbox,
  sealed: string,
): string {
  const root = quoteEvalShellPath(sandbox.root)
  const sealedQ = quoteEvalShellPath(sealed)
  return `home/ and tmp/ in it were written by the plugin under test and are sealed in ${sealedQ} (mode 000; the kept directory is read-only) — open them with \`chmod 700 ${root} ${sealedQ}\` to inspect, and do not run git (or anything that loads configuration from its working directory) anywhere inside the kept directory`
}

export const KEPT_SANDBOX_UNSEALED = (root: string, error: string): string =>
  `could NOT seal what the plugin under test wrote (${error}) — everything in it except out/ and config/ may be agent-written, wherever it now sits (modes were closed as far as possible); read out/ if you need it, do not run git or anything that loads configuration from a working directory anywhere inside, and remove it (\`${keptSandboxRmRecipe(root)}\`)`

/**
 * densable `Fa` reduced: rename home/tmp into sealed/, chmod 0100+0500.
 * Full gold O_NOFOLLOW fd identity is not invented beyond lstat.
 */
export async function sealKeptEvalSandbox(
  sandbox: EvalSandbox,
): Promise<string> {
  if (process.platform === 'win32') {
    throw new PluginEvalPathError(
      'directory modes do not restrict access on Windows',
      'eval kept-sandbox seal unavailable on windows',
    )
  }
  if (process.getuid?.() === 0) {
    throw new PluginEvalPathError(
      'the harness is running as root, which a directory mode does not bind',
      'eval kept-sandbox seal ineffective for root',
    )
  }
  const homeSt = await lstat(sandbox.home)
  const tmpSt = await lstat(sandbox.tmpDir)
  if (
    !homeSt.isDirectory() ||
    homeSt.isSymbolicLink() ||
    !tmpSt.isDirectory() ||
    tmpSt.isSymbolicLink()
  ) {
    throw new Error('home/ or tmp/ is not a real directory')
  }
  const sealed = join(sandbox.root, 'sealed')
  await mkdir(sealed, { mode: 0o700 })
  await rename(sandbox.home, join(sealed, 'home'))
  await rename(sandbox.tmpDir, join(sealed, 'tmp'))
  await chmod(sealed, 0o100)
  await chmod(sandbox.root, 0o500)
  return sealed
}

/** densable `rg` — bash [script], 120s, `...la("plugin")`. */
export async function runEvalScaffold(
  script: string,
  sandbox: EvalSandbox,
  signal: AbortSignal,
): Promise<{ code: number; stderr: string }> {
  return await new Promise(resolve => {
    const child = spawn('bash', [script], {
      cwd: sandbox.cwd,
      windowsHide: true,
      ...evalSpawnCgroupExtras('plugin'),
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: sandbox.home,
        USERPROFILE: sandbox.home,
        TMPDIR: sandbox.tmpDir,
        TMP: sandbox.tmpDir,
        TEMP: sandbox.tmpDir,
        TERM: 'dumb',
        GIT_CONFIG_NOSYSTEM: '1',
        USER_TYPE: 'external',
        NODE_ENV: 'production',
      },
    })
    let stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), SCAFFOLD_TIMEOUT_MS)
    const onAbort = () => child.kill('SIGKILL')
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 16_384) stderr += chunk
    })
    const finish = (code: number, err: string) => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      resolve({ code, stderr: err })
    }
    child.on('error', error => finish(127, String(error)))
    child.on('close', code => finish(code ?? 127, stderr))
  })
}
