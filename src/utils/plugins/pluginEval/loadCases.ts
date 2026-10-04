/**
 * densable `ma` + `hd`/`Es`/`ks` — load case.yaml and/or prompt.md+graders.
 * Gold `--tag` filter is `fd()`: tags.some(r => e.tags.includes(r)).
 */

import { readdir, readFile, realpath, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { parseFrontmatter } from '../../frontmatterParser.js'
import { parseYaml } from '../../yaml.js'
import { CASE_FILE_NAMES, DEFAULT_EVAL_DIR } from './constants.js'
import { discoverEvalCaseDirs } from './discoverCases.js'
import {
  EXECUTION_KEYS,
  TOP_KEYS,
  mergeProseOntoYaml,
  parseCaseDefinition,
} from './schema.js'
import type {
  CaseLoadError,
  CaseSource,
  Grader,
  PluginEvalTrustState,
  ResolvedCase,
} from './types.js'

const BODY_BY_TYPE: Record<string, 'criteria' | 'pattern'> = {
  llm: 'criteria',
  baseline: 'criteria',
  regex: 'pattern',
}

function isCaseFileName(name: string): boolean {
  return (CASE_FILE_NAMES as readonly string[]).includes(name)
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  )
}

/** densable `fd` — case name glob + tag intersection. */
export function caseMatchesFilter(
  candidate: { name: string; tags: string[] },
  filter: { caseGlob?: string; tags?: string[] },
): boolean {
  if (filter.caseGlob && !globToRegExp(filter.caseGlob).test(candidate.name)) {
    return false
  }
  if (filter.tags && filter.tags.length > 0) {
    if (!filter.tags.some(tag => candidate.tags.includes(tag))) return false
  }
  return true
}

function graderFromFrontmatter(
  name: string,
  fm: Record<string, unknown>,
  body: string,
): Grader {
  const grader = { name, ...fm } as Grader
  const field =
    typeof fm.type === 'string' ? BODY_BY_TYPE[fm.type] : undefined
  if (field && (grader as Record<string, unknown>)[field] === undefined && body) {
    ;(grader as Record<string, unknown>)[field] = body
  }
  return grader
}

async function listGraderFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => join(dir, e.name))
      .sort()
  } catch {
    return []
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

/** densable `hd`. */
export async function loadCaseYaml(
  file: string,
): Promise<Record<string, unknown> | null> {
  const text = await readText(file)
  if (text === null) return null
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new Error(`YAML parse failed: ${String(error)}`)
  }
  if (parsed === null || parsed === undefined) return null
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('case.yaml must be a YAML object')
  }
  return parsed as Record<string, unknown>
}

/** densable `Es`. */
export async function loadProseCase(caseDir: string): Promise<{
  top: Record<string, unknown>
  execution: Record<string, unknown>
  graders: Grader[]
  prompt?: string
} | null> {
  const promptPath = join(caseDir, 'prompt.md')
  const gradersDir = join(caseDir, 'graders')
  const [promptText, graderFiles] = await Promise.all([
    readText(promptPath),
    listGraderFiles(gradersDir),
  ])
  if (promptText === null && graderFiles.length === 0) return null
  const out: {
    top: Record<string, unknown>
    execution: Record<string, unknown>
    graders: Grader[]
    prompt?: string
  } = { top: {}, execution: {}, graders: [] }
  if (promptText !== null) {
    const { frontmatter, content } = parseFrontmatter(promptText, promptPath)
    const body = content.trim()
    if (body.length > 0) out.prompt = body
    for (const [key, value] of Object.entries(frontmatter)) {
      if (TOP_KEYS.has(key)) out.top[key] = value
      else if (EXECUTION_KEYS.has(key)) out.execution[key] = value
      else {
        throw new Error(
          `${relative(caseDir, promptPath)}: unknown frontmatter key "${key}" (expected one of: ${[...TOP_KEYS, ...EXECUTION_KEYS].join(', ')})`,
        )
      }
    }
  }
  for (const file of graderFiles) {
    const text = await readText(file)
    if (text === null) {
      throw new Error(
        `${basename(file)} vanished from ${basename(dirname(file))}/ while being read; try again`,
      )
    }
    const { frontmatter, content } = parseFrontmatter(text, file)
    if (Object.keys(frontmatter).length === 0) continue
    if (typeof frontmatter.type !== 'string') {
      throw new Error(
        `${relative(caseDir, file)}: frontmatter must include "type:" (regex | tool_order | tool_used | file_exists | llm | baseline)`,
      )
    }
    out.graders.push(
      graderFromFrontmatter(basename(file, '.md'), frontmatter, content.trim()),
    )
  }
  if (
    out.prompt === undefined &&
    out.graders.length === 0 &&
    Object.keys(out.top).length === 0 &&
    Object.keys(out.execution).length === 0
  ) {
    return null
  }
  return out
}

/** densable `jn`/`pi` subset — plugin.json, .claude-plugin/plugin.json, or SKILL.md. */
export async function isPluginOrSkillFolder(dir: string): Promise<boolean> {
  for (const candidate of [
    join(dir, '.claude-plugin', 'plugin.json'),
    join(dir, 'plugin.json'),
    join(dir, 'SKILL.md'),
  ]) {
    try {
      await stat(candidate)
      return true
    } catch {
      // try next
    }
  }
  return false
}

async function nearestPluginDir(
  start: string,
  stop: string,
): Promise<string | null> {
  let dir = start
  for (let i = 0; i < 32; i++) {
    try {
      await stat(join(dir, 'plugin.json'))
      return dir
    } catch {
      // continue
    }
    try {
      await stat(join(dir, '.claude-plugin', 'plugin.json'))
      return dir
    } catch {
      // continue
    }
    if (dir === stop) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function resolvePluginDirs(
  definition: { name: string; plugins?: string[] },
  caseDir: string,
  root: string,
  frameRoot: string | null,
): Promise<string[]> {
  if (definition.plugins && definition.plugins.length > 0) {
    const dirs: string[] = []
    for (const entry of definition.plugins) {
      const abs = isAbsolute(entry) ? entry : resolve(caseDir, entry)
      let real: string
      try {
        real = await realpath(abs)
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined
        throw new Error(
          code === 'ENOENT' || code === 'ENOTDIR'
            ? `case ${JSON.stringify(definition.name)}: plugins entry ${JSON.stringify(entry)} does not exist`
            : `case ${JSON.stringify(definition.name)}: plugins entry ${JSON.stringify(entry)} is unreadable (${code ?? 'unknown error'})`,
        )
      }
      const framed = frameRoot !== null && (real === frameRoot || isInside(real, frameRoot))
      if (!isInside(real, root) && !framed) {
        throw new Error(
          `case ${JSON.stringify(definition.name)}: plugins entry ${JSON.stringify(entry)} resolves to ${real}, outside the containment root ${root} (the enclosing plugin for a target inside one you control, else the directory you ran 'claude plugin eval' against). Only plugins under it can be loaded from case.yaml.`,
        )
      }
      dirs.push(real)
    }
    return dirs
  }
  const nearest = await nearestPluginDir(caseDir, root)
  if (nearest) return [nearest]
  if (frameRoot !== null) return [frameRoot]
  return []
}

export type LoadCasesResult = {
  cases: ResolvedCase[]
  errors: CaseLoadError[]
  root: string
  suite: string | null
}

/** densable `ma`. */
export async function loadEvalCases(
  rootPath: string,
  filter: { caseGlob?: string; tags?: string[] } = {},
  options: {
    evalDirSegments?: string[]
    frameRoot?: string | null
    adoptionDecided?: boolean
    trust?: PluginEvalTrustState
    targetScreened?: boolean
    consentDecided?: boolean
  } = {},
): Promise<LoadCasesResult> {
  const cwd = process.cwd()
  const resolvedRoot = resolve(cwd, rootPath)
  const evalDirSegments = options.evalDirSegments ?? [DEFAULT_EVAL_DIR]
  const frameRoot = options.frameRoot ?? null
  const { caseDirs, skipped } = await discoverEvalCaseDirs(
    resolvedRoot,
    evalDirSegments,
  )
  const errors: CaseLoadError[] = [...skipped]
  const cases: ResolvedCase[] = []
  const root = frameRoot && isInside(resolvedRoot, frameRoot) ? frameRoot : resolvedRoot

  for (const caseDir of caseDirs) {
    const yamlPath = join(caseDir, 'case.yaml')
    try {
      const [yaml, prose] = await Promise.all([
        loadCaseYaml(yamlPath),
        loadProseCase(caseDir),
      ])
      const merged = prose ? mergeProseOntoYaml(yaml, prose, caseDir) : yaml
      const source: CaseSource =
        prose && yaml ? 'mixed' : prose ? 'prose' : 'case_yaml'
      const name =
        merged === null
          ? basename(caseDir)
          : typeof merged.name === 'string' && merged.name.length > 0
            ? merged.name
            : undefined
      const tags =
        merged === null || merged.tags === undefined
          ? []
          : Array.isArray(merged.tags) &&
              merged.tags.every(t => typeof t === 'string')
            ? merged.tags
            : undefined
      if (name !== undefined && tags !== undefined && !caseMatchesFilter({ name, tags }, filter)) {
        continue
      }
      if (merged === null) {
        errors.push({
          file: caseDir,
          error:
            'no case definition: case.yaml and prompt.md are empty or missing here (write the user prompt to test in prompt.md, or define the case in case.yaml)',
        })
        continue
      }
      const parsed = parseCaseDefinition(merged)
      if (!parsed.ok) {
        errors.push({ file: yaml !== null ? yamlPath : caseDir, error: parsed.error })
        continue
      }
      const pluginDirs = await resolvePluginDirs(parsed.case, caseDir, root, frameRoot)
      cases.push({
        ...parsed.case,
        caseFile: yamlPath,
        caseDir,
        caseSource: source,
        pluginDirs,
        pluginDirsUnderTest: pluginDirs,
        evalDirSegments,
      })
    } catch (error) {
      errors.push({
        file: caseDir,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  void options.adoptionDecided
  void options.trust
  void options.targetScreened
  void options.consentDecided
  void sep
  return { cases, errors, root, suite: null }
}
