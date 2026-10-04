/**
 * densable `ht`/`mf`/`pf`/`df`/`ko` — eval permission-path spelling and
 * case-authored file vetting.
 */
import { lstat, readdir, realpath, stat } from 'fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'path'
import { getErrnoCode } from '../../errors.js'
import { permissionRuleValueFromString } from '../../permissions/permissionRuleParser.js'
import { getAllBaseTools } from '../../../tools.js'
import { OFFICIAL_ARTIFACT_TOOL_NAME } from '../../artifactUrl.js'
import { isEnvTruthy } from '../../envUtils.js'
import { NEVER_IN_EVAL } from './constants.js'
import { PluginEvalPathError, vetPluginEvalPath } from './pathVet.js'
import type { CaseDefinition, ResolvedCase } from './types.js'

/** densable `mc` operator fields consumed by gold `Ji` / `lg`. */
export type EvalArtifactGrantParams = {
  artifactPublish?: boolean
  allowFlagOverrides?: string[]
}

const READ_FAMILY = new Set(['Read', 'Glob', 'Grep', 'LSP'])
const WRITE_FAMILY = new Set(['Write', 'Edit', 'NotebookEdit'])

/** densable `ht` @212235383 — `//` prefix so cliArg patterns root at FS `/`. */
export function toEvalPermissionPath(path: string): string {
  const n = process.platform === 'win32' ? path.replaceAll('\\', '/') : path
  const drive = /^([A-Za-z]):\//.exec(n)
  if (drive) {
    const letter = drive[1] ?? ''
    return `//${letter.toLowerCase()}/${n.slice(drive[0].length)}`
  }
  return `/${n.startsWith('/') ? n : `/${n}`}`
}

export function evalToolPathRule(
  tool: string,
  path: string,
  glob = true,
): string {
  return `${tool}(${toEvalPermissionPath(path)}${glob ? '/**' : ''})`
}

function uniqueRules(rules: string[]): string[] {
  return [...new Set(rules)]
}

function isRelativeRuleContent(content: string): boolean {
  return (
    !content.startsWith('/') &&
    !content.startsWith('~') &&
    !content.startsWith('\\') &&
    !/^[A-Za-z]:/.test(content) &&
    !content.split(/[/\\]/).includes('..')
  )
}

/** densable `pf` @212211488 */
export function rewriteRelativeEvalFileRules(
  rules: string[],
  cwd: string,
): string[] {
  return rules.map(raw => {
    const parsed = permissionRuleValueFromString(raw)
    if (parsed.ruleContent === undefined) return raw
    if (
      !READ_FAMILY.has(parsed.toolName) &&
      !WRITE_FAMILY.has(parsed.toolName)
    ) {
      return raw
    }
    if (!isRelativeRuleContent(parsed.ruleContent)) return raw
    const trimmed = parsed.ruleContent.replace(/^\.\/+/, '')
    const single = !trimmed.replace(/\/+$/, '').includes('/')
    const prefix = single ? '**/' : ''
    return `${parsed.toolName}(${toEvalPermissionPath(cwd)}/${prefix}${trimmed})`
  })
}

/** densable `mf` @212211902 */
export function expandWholeToolReadGrants(
  rules: string[],
  dirs: string[],
  files: string[] = [],
): string[] {
  let hit = false
  const kept: string[] = []
  for (const raw of rules) {
    const parsed = permissionRuleValueFromString(raw)
    if (parsed.ruleContent === undefined && READ_FAMILY.has(parsed.toolName)) {
      hit = true
      continue
    }
    kept.push(raw)
  }
  if (!hit) return kept
  const dirRules = dirs.flatMap(dir =>
    ['Read', 'Glob', 'Grep'].map(tool => evalToolPathRule(tool, dir)),
  )
  const fileRules = files.map(file => evalToolPathRule('Read', file, false))
  return uniqueRules([...kept, ...dirRules, ...fileRules])
}

/** densable `df` @212211178 */
export function expandWholeToolWriteGrants(
  rules: string[],
  dirs: string[],
): string[] {
  const dropped = new Set<string>()
  const kept: string[] = []
  for (const raw of rules) {
    const parsed = permissionRuleValueFromString(raw)
    if (parsed.ruleContent === undefined && WRITE_FAMILY.has(parsed.toolName)) {
      dropped.add(parsed.toolName)
      continue
    }
    kept.push(raw)
  }
  if (dropped.size === 0) return kept
  const tools = uniqueRules(['Write', ...dropped])
  const dirRules = dirs.flatMap(dir =>
    tools.map(tool => evalToolPathRule(tool, dir)),
  )
  return uniqueRules([...kept, ...dirRules])
}

/** densable `Re` @212102108 — strict child (equal is not inside). */
export function isStrictlyInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * densable `Ii`/`Ro` @212241613 — Ny then refuse `..` / absolute escape, then realpath.
 */
export async function resolveInsideEvalRoot(
  root: string,
  rel: string,
  surface: string,
  rootLabel: string,
): Promise<string> {
  await vetPluginEvalPath(root, rel, surface)
  const resolved = resolve(root, rel)
  const rootReal = await realpath(root).catch(() => resolve(root))
  const viaRoot = resolve(rootReal, rel)
  if (viaRoot !== rootReal && !isStrictlyInside(rootReal, viaRoot)) {
    throw new PluginEvalPathError(
      `${surface}: path "${rel}" escapes the ${rootLabel} (\`..\` or an absolute path) — it must name something inside it`,
      'case-authored path escapes its root',
    )
  }
  try {
    return await realpath(resolved)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw Object.assign(
        new PluginEvalPathError(
          `${surface}: path "${rel}" does not exist`,
          'case-authored path does not exist',
        ),
        { code },
      )
    }
    throw Object.assign(
      new PluginEvalPathError(
        `${surface}: path "${rel}" is unreadable (${code ?? 'unknown error'})`,
        'case-authored path unreadable',
      ),
      { code },
    )
  }
}

/** densable `ko` @212241073 */
export async function resolveEvalCaseAuthoredFile(
  case_: ResolvedCase,
  rel: string,
  kind: string,
): Promise<string> {
  const surface = `case "${case_.name}"`
  const real = await resolveInsideEvalRoot(
    case_.caseDir,
    rel,
    surface,
    'case directory',
  )
  const anchors = await Promise.all(
    [case_.caseDir, ...case_.pluginDirsUnderTest].map(dir =>
      realpath(dir).catch(() => dir),
    ),
  )
  const st = await stat(real).catch(() => null)
  if (
    !anchors.some(anchor => isStrictlyInside(anchor, real)) ||
    st === null ||
    !st.isFile() ||
    st.nlink > 1
  ) {
    throw new PluginEvalPathError(
      `${surface}: ${kind} "${rel}" resolves (through a link) outside the case directory and the plugin under test, or is not a plain single-link file`,
      'eval case file escapes suite via link',
    )
  }
  return real
}

/** densable `sn` @212235226 — original spellings union realpath. */
export async function unionEvalPathSpellings(
  paths: string[],
): Promise<string[]> {
  const reals = await Promise.all(
    paths.map(path => realpath(path).catch(() => path)),
  )
  return uniqueRules([...paths, ...reals])
}

function isInsideOrEqual(root: string, path: string): boolean {
  return path === root || isStrictlyInside(root, path)
}

/**
 * densable `wl` @212210050 — Ro from caseDir; realpath must land in case/plugin.
 */
export async function resolveEvalAddDirs(
  case_: ResolvedCase,
): Promise<string[]> {
  const surface = `case "${case_.name}"`
  const resolved = await Promise.all(
    case_.context.add_dirs.map(rel =>
      resolveInsideEvalRoot(case_.caseDir, rel, surface, 'case directory'),
    ),
  )
  const anchors = await Promise.all(
    [case_.caseDir, ...case_.pluginDirsUnderTest].map(dir =>
      realpath(dir).catch(() => dir),
    ),
  )
  for (const [index, real] of resolved.entries()) {
    if (!anchors.some(anchor => isInsideOrEqual(anchor, real))) {
      throw new PluginEvalPathError(
        `${surface}: add_dirs entry "${case_.context.add_dirs[index]}" resolves (through a link) outside the case directory and the plugin under test — it may only grant reads inside them`,
        'add_dirs resolves outside case/plugin',
      )
    }
  }
  return resolved
}

/** densable `_f` @212232047 */
export const EVAL_CWD_GIT_META_NAMES = [
  '.git',
  'HEAD',
  'objects',
  'refs',
  'commondir',
] as const

/** densable `sf` `_f.flatMap` Write(cwd/A) + Write(cwd/A/**). */
export function evalCwdGitMetaWriteDenies(cwd: string): string[] {
  return EVAL_CWD_GIT_META_NAMES.flatMap(name => {
    const path = resolve(cwd, name)
    return [
      `Write(${toEvalPermissionPath(path)})`,
      evalToolPathRule('Write', path),
    ]
  })
}

/**
 * densable `sf` consumes `bl` `{readRoots, readFiles, denies, denyPaths}`.
 * Gold `kt` Write-denyPaths; gold `Fe` Read(tree)+Read(tree/**) in `denies`.
 */
export type EvalReadScope = {
  readRoots: string[]
  readFiles: string[]
  denies: string[]
  denyPaths: string[]
}

/** densable `Cn` @212241073 — eval-tree screen budget. */
const EVAL_BL_BUDGET = 20_000
/** densable `J` depth cap inside `bl`. */
const EVAL_BL_DEPTH = 12

type EvalFenceDirent = {
  name: string
  isDirectory(): boolean
  isSymbolicLink(): boolean
  isFile(): boolean
}

/**
 * densable `h` @212241073 — Ny then realpath; ENOENT keeps the spelling.
 */
export async function resolveEvalFencePath(
  path: string,
  surface: string,
): Promise<string> {
  await vetPluginEvalPath(dirname(path), basename(path), surface)
  try {
    return await realpath(path)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') return path
    throw new PluginEvalPathError(
      `${surface}: a plugin, case or add_dirs path could not be resolved (${code ?? 'unexpected error'}) — make it readable or remove it`,
      'eval path unresolvable',
    )
  }
}

/**
 * densable `j` + `W` — list a plugin/eval dir; FFFD names refuse; unlistable throws.
 */
export async function listEvalFenceDir(
  dir: string,
  allowMissing: boolean,
  surface: string,
  root: string,
): Promise<EvalFenceDirent[]> {
  let entries: EvalFenceDirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    const code = getErrnoCode(error)
    if (allowMissing && code === 'ENOENT') return []
    throw new PluginEvalPathError(
      `${surface}: cannot list "${relative(root, dir) || '.'}" under a plugin or eval directory — make it readable or remove it`,
      'eval directory unlistable',
    )
  }
  for (const entry of entries) {
    if (entry.name.includes('�')) {
      throw new PluginEvalPathError(
        `${surface}: "${entry.name}" under a plugin or eval directory is not a valid UTF-8 name (or imitates one that is not) — rename or remove it`,
        'eval tree has undecodable name',
      )
    }
  }
  return entries
}

function endsWithEvalDirSegments(path: string, segments: string[]): boolean {
  const parts = path.split(sep)
  if (parts.length < segments.length) return false
  const fold = (s: string) => s.toLowerCase()
  return segments.every(
    (seg, i) =>
      fold(parts[parts.length - segments.length + i] ?? '') === fold(seg),
  )
}

async function screenEvalTree(root: string, surface: string): Promise<void> {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let seen = 0
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === undefined) break
    const entries = await listEvalFenceDir(
      cur.dir,
      cur.dir === root,
      surface,
      root,
    )
    for (const entry of entries) {
      const child = join(cur.dir, entry.name)
      if (++seen > EVAL_BL_BUDGET || cur.depth >= EVAL_BL_DEPTH) return
      let kind: 'dir' | 'file' | 'other' = 'other'
      try {
        const st = await lstat(child)
        if (st.isSymbolicLink()) continue
        if (st.isDirectory()) kind = 'dir'
        else if (st.isFile()) {
          kind = 'file'
          if (st.nlink > 1) {
            throw new PluginEvalPathError(
              `${surface}: "${entry.name}" under the eval directory has more than one hard link — case definitions must not be reachable by another name`,
              'eval case file hard-linked',
            )
          }
        }
      } catch (error) {
        if (error instanceof PluginEvalPathError) throw error
        continue
      }
      if (kind === 'dir') stack.push({ dir: child, depth: cur.depth + 1 })
    }
  }
}

/**
 * densable `bl` consumed by `sf` — plugin dirs as readRoots; evalDir + caseDir
 * as Write-denyPaths and Read denies. Screens UTF-8 names, unlistable dirs,
 * and hard-linked case files.
 */
export async function resolveEvalReadScope(
  case_: ResolvedCase,
): Promise<EvalReadScope> {
  const surface = `case "${case_.name}"`
  const pluginReals = await Promise.all(
    case_.pluginDirsUnderTest.map(dir => resolveEvalFencePath(dir, surface)),
  )
  const caseReal = await resolveEvalFencePath(case_.caseDir, surface)
  const evalSegs =
    case_.evalDirSegments.length > 0 ? case_.evalDirSegments : ['evals']
  const evalTrees = pluginReals.map(plugin => resolve(plugin, ...evalSegs))
  for (const tree of evalTrees) {
    await screenEvalTree(tree, surface)
  }
  await screenEvalTree(caseReal, surface)
  const denyPaths = await unionEvalPathSpellings([
    ...evalTrees,
    case_.caseDir,
    caseReal,
  ])
  const denies = uniqueRules(
    denyPaths.flatMap(path => [
      evalToolPathRule('Read', path, false),
      evalToolPathRule('Read', path),
    ]),
  )
  const readRoots = pluginReals.filter(
    plugin => !endsWithEvalDirSegments(plugin, evalSegs),
  )
  return {
    readRoots,
    readFiles: [],
    denies,
    denyPaths: denyPaths.map(path => normalize(path)),
  }
}

export const EVAL_PROC_READ_DENY = 'Read(//proc/**)'

/** densable `bo` @212210446 — extra-deny ungranted shells. */
const EVAL_SHELL_TOOLS = ['Bash', 'PowerShell'] as const

/**
 * densable `ml` ∪ `Eo` ∪ `cf` — uf keep-set (always available in eval).
 * `Eo` = Read/Glob/Grep/LSP; `cf` = WaitForMcpServers/RefreshMcpTools/ToolSearch.
 */
const EVAL_UF_KEEP = new Set([
  'Read',
  'Glob',
  'Grep',
  'NotebookRead',
  'Skill',
  'AskUserQuestion',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskStop',
  'Agent',
  'TodoWrite',
  'LSP',
  'WaitForMcpServers',
  'RefreshMcpTools',
  'ToolSearch',
])

const EVAL_WRITE_FAMILY = new Set(['Write', 'Edit', 'NotebookEdit'])

function toolInKeep(
  tool: { name: string; underlyingV1ToolName?: string },
  keep: Set<string>,
): boolean {
  if (keep.has(tool.name)) return true
  if (
    tool.underlyingV1ToolName !== undefined &&
    keep.has(tool.underlyingV1ToolName)
  ) {
    return true
  }
  return false
}

/**
 * densable `uf` @212210490 — leftover builtins not in keep ∪ granted.
 * `ske` skips EndConversation. Catalog is `Jw()` = getAllBaseTools().
 */
export function leftoverEvalBuiltinDenies(allowedRules: string[]): string[] {
  const granted = new Set(
    allowedRules.map(raw => permissionRuleValueFromString(raw).toolName),
  )
  const keep = new Set([...EVAL_UF_KEEP, ...granted])
  if ([...EVAL_WRITE_FAMILY].some(name => keep.has(name))) {
    for (const name of EVAL_WRITE_FAMILY) keep.add(name)
  }
  return getAllBaseTools()
    .filter(
      tool =>
        !tool.mcpInfo &&
        tool.name !== 'EndConversation' &&
        !toolInKeep(tool, keep),
    )
    .map(tool => tool.name)
}

/**
 * densable `Ai` @212210446 — `sf` `R.push(...Ai(r))`.
 * Ungranted Bash/PowerShell + always Monitor/EnterWorktree/ExitWorktree
 * + uf leftover builtins.
 */
export function extraEvalToolDenies(allowedRules: string[]): string[] {
  const granted = new Set(
    allowedRules.map(raw => permissionRuleValueFromString(raw).toolName),
  )
  const out: string[] = []
  for (const name of EVAL_SHELL_TOOLS) {
    if (!granted.has(name)) out.push(name)
  }
  out.push(...NEVER_IN_EVAL)
  out.push(...leftoverEvalBuiltinDenies(allowedRules))
  return uniqueRules(out)
}

/**
 * densable `ml` — case.yaml may auto-allow these without `--allow-tools`.
 * Bash/Write/Edit are not in this set.
 */
export const EVAL_TR_CASE_KEEP = new Set([
  'Read',
  'Glob',
  'Grep',
  'NotebookRead',
  'Skill',
  'AskUserQuestion',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskStop',
  'Agent',
  'TodoWrite',
])

function evalToolName(rule: string): string {
  return permissionRuleValueFromString(rule).toolName
}

function isMalformedEvalToolRule(rule: string): boolean {
  const name = evalToolName(rule) || rule.split('(')[0] || rule
  return !name || NEVER_IN_EVAL.has(name) || /[*?]/.test(name)
}

function operatorCoversCaseTool(granted: string[], caseRule: string): boolean {
  const want = permissionRuleValueFromString(caseRule)
  return granted.some(rule => {
    const have = permissionRuleValueFromString(rule)
    if (have.toolName !== want.toolName) return false
    return (
      have.ruleContent === undefined ||
      want.ruleContent === undefined ||
      have.ruleContent === want.ruleContent
    )
  })
}

/**
 * densable `tr(case.allowed_tools, operator, {artifact, mocked})`.
 * Operator/mocked/opt-in Artifact are grants. Case listings in `ml` are
 * auto-allowed. Everything else (Bash/Write/…) is denied unless already granted.
 */
export function grantEvalAllowedTools(
  caseTools: string[],
  operatorTools: string[],
  opts: {
    artifactPublishGranted?: boolean
    mockedTools?: string[]
  } = {},
): { allowed: string[]; denied: string[] } {
  const allowed: string[] = []
  const denied: string[] = []
  for (const rule of operatorTools) {
    if (
      isMalformedEvalToolRule(rule) ||
      NEVER_IN_EVAL.has(evalToolName(rule))
    ) {
      denied.push(rule)
    } else {
      allowed.push(rule)
    }
  }
  if (opts.artifactPublishGranted) allowed.push(OFFICIAL_ARTIFACT_TOOL_NAME)
  for (const mocked of opts.mockedTools ?? []) allowed.push(mocked)
  const granted = [...allowed]
  for (const rule of caseTools) {
    if (isMalformedEvalToolRule(rule)) {
      denied.push(rule)
      continue
    }
    const name = evalToolName(rule)
    if (EVAL_TR_CASE_KEEP.has(name)) {
      allowed.push(rule)
      continue
    }
    if (!operatorCoversCaseTool(granted, rule)) denied.push(rule)
  }
  return { allowed: uniqueRules(allowed), denied: uniqueRules(denied) }
}

/**
 * densable `Ji(case, suite)` — case `artifact_publish` is not a grant.
 * Operator `artifactPublish` param, else `CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH`.
 */
export function isEvalArtifactPublishGranted(
  cse: CaseDefinition,
  params: EvalArtifactGrantParams = {},
): boolean {
  const operator =
    params.artifactPublish ??
    isEnvTruthy(process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH)
  return operator && cse.execution.artifact_publish === true
}

/**
 * densable `lg(case, suite)` — seed only allowlisted growthbook keys.
 * Allowlist is `allowFlagOverrides`, else comma-split
 * `CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES`.
 */
export function seedEvalGrowthbookOverrides(
  cse: CaseDefinition,
  params: EvalArtifactGrantParams = {},
): {
  declared: Record<string, unknown>
  seeded: Record<string, unknown>
  dropped: string[]
} {
  const declared = cse.execution.growthbook_overrides ?? {}
  const allowlist = new Set(
    params.allowFlagOverrides ??
      (process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES ?? '')
        .split(',')
        .map(key => key.trim())
        .filter(key => key.length > 0),
  )
  const seeded: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(declared)) {
    if (allowlist.has(key)) seeded[key] = value
    else dropped.push(key)
  }
  return { declared, seeded, dropped }
}
