/**
 * densable `_d` subset: walk evalDir for directories that contain
 * case.yaml or prompt.md. Gold's full walker (symlink climb, ownership
 * vet, mocks reserved) is not invented here — this is the scan `mc`
 * uses before empty-case refuse.
 *
 * densable `ma`/`fd`/`pd`: `--case` glob + `--tag` match case identity
 * (name + tags from case.yaml or prompt.md frontmatter). Invalid tags
 * skip the filter (gold `We === undefined`).
 */

import { lstat, readdir, readFile, realpath } from 'fs/promises'
import { basename, join, relative, resolve, sep } from 'path'
import { parseYaml } from '../../yaml.js'
import {
  CASE_FILE_NAMES,
  EVAL_WALK_BUDGET,
  EVAL_WALK_MAX_DEPTH,
  SKIP_DIR_NAMES,
} from './constants.js'
import { PluginEvalPathError, vetPluginEvalPath } from './pathVet.js'

/** densable `Mv` / `FRONTMATTER_REGEX` — prompt.md identity keys only. */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/
/** densable `ys` — top-level case identity keys copied from prompt.md frontmatter. */
const TOP_KEYS = new Set([
  'schema_version',
  'name',
  'description',
  'tags',
  'plugins',
  'runs',
  'expected_outcome',
])

function isCaseFile(name: string): boolean {
  return (CASE_FILE_NAMES as readonly string[]).includes(name)
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

async function entryKind(
  dir: string,
  name: string,
  isDirectory: boolean,
  isSymbolicLink: boolean,
): Promise<'dir' | 'symlink' | 'other' | 'unknown'> {
  if (isSymbolicLink) return 'symlink'
  if (isDirectory) return 'dir'
  try {
    const st = await lstat(join(dir, name))
    if (st.isSymbolicLink()) return 'symlink'
    if (st.isDirectory()) return 'dir'
    return 'other'
  } catch {
    return 'unknown'
  }
}

/**
 * densable `_d` / `ba`: depth `aa=16`, budget `pa=1e5`, mocks/ reserved,
 * symlink climb refuses self/parent/target-under-test.
 */
export async function discoverEvalCaseDirs(
  root: string,
  evalDirSegments: string[],
): Promise<{
  caseDirs: string[]
  skipped: Array<{ file: string; error: string }>
}> {
  const skipped: Array<{ file: string; error: string }> = []
  const found = new Set<string>()
  const start = join(root, ...evalDirSegments)
  const foundReal = new Set<string>()
  const reported = new Set<string>()
  const onRoute = new Set<string>()
  let remaining = EVAL_WALK_BUDGET
  let budgetReported = false
  let rootReal = start
  try {
    rootReal = await realpath(start)
  } catch {
    // keep start
  }

  const report = (key: string, file: string, error: string) => {
    if (reported.has(key)) return
    reported.add(key)
    skipped.push({ file, error })
  }

  async function walk(
    dir: string,
    real: string,
    depth: number,
    inSuite: boolean,
  ): Promise<void> {
    if (depth > EVAL_WALK_MAX_DEPTH) {
      report(
        `suite:${real}`,
        dir,
        `nested more than ${EVAL_WALK_MAX_DEPTH} directories below the target by this route — not scanned from here (move the suite higher, or target it directly)`,
      )
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      const code = errnoCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      report(
        real,
        dir,
        `cannot be read (${code ?? 'unknown error'}) — not scanned`,
      )
      return
    }
    if (inSuite && entries.some(e => !e.isDirectory() && isCaseFile(e.name))) {
      if (foundReal.has(real)) return
      foundReal.add(real)
      found.add(dir)
      return
    }
    const routeKey = `${inSuite ? 'suite' : 'tree'}:${real}`
    onRoute.add(routeKey)
    try {
      for (const entry of entries) {
        const child = join(dir, entry.name)
        if (entry.name.startsWith('.')) continue
        if (SKIP_DIR_NAMES.has(entry.name)) {
          if (entry.name === 'mocks' && inSuite && entry.isDirectory()) {
            report(
              child,
              child,
              'mocks/ is reserved for mock responders — cases placed there (or in a case group by that name) are not run, and their files would be read as mock responders; rename the directory',
            )
          }
          continue
        }
        const kind = await entryKind(
          dir,
          entry.name,
          entry.isDirectory(),
          entry.isSymbolicLink(),
        )
        if (kind === 'unknown') {
          report(
            `${real}${sep}${entry.name}`,
            child,
            `${entry.name} could not be examined (its type is unknown and it cannot be stat'ed) — not scanned`,
          )
          continue
        }
        let nextKind = kind
        let nextReal = real
        if (kind === 'symlink') {
          try {
            try {
              await vetPluginEvalPath(dir, entry.name, 'plugin eval')
            } catch (error) {
              report(
                `${real}${sep}${entry.name}`,
                child,
                error instanceof PluginEvalPathError
                  ? error.message
                  : error instanceof Error
                    ? error.message
                    : String(error),
              )
              continue
            }
            const target = await realpath(child)
            const st = await lstat(target).catch(() => null)
            if (st === null || !st.isDirectory()) continue
            nextKind = 'dir'
            nextReal = target
            if (nextReal === real || relative(nextReal, real) === '') {
              report(
                child,
                child,
                `${entry.name} is a symbolic link to its own directory or one above it — not followed`,
              )
              continue
            }
            if (
              nextReal === rootReal ||
              relative(rootReal, nextReal) === '' ||
              !relative(nextReal, rootReal).startsWith('..')
            ) {
              if (nextReal === rootReal || rootReal.startsWith(nextReal + sep)) {
                report(
                  child,
                  child,
                  `${entry.name} is a symbolic link to the directory under test or one above it — not followed`,
                )
                continue
              }
            }
            if (onRoute.has(`suite:${nextReal}`) || onRoute.has(`tree:${nextReal}`)) {
              continue
            }
          } catch {
            report(
              child,
              child,
              `${entry.name} is a symbolic link whose target cannot be read — skipped`,
            )
            continue
          }
        }
        if (nextKind !== 'dir') continue
        if (remaining <= 0) {
          if (!budgetReported) {
            budgetReported = true
            skipped.push({
              file: child,
              error: `the tree under the target has more than ${EVAL_WALK_BUDGET} directories to walk (links can inflate it) — the rest was not scanned`,
            })
          }
          continue
        }
        remaining--
        await walk(child, nextReal === real ? resolve(child) : nextReal, depth + 1, inSuite)
      }
    } finally {
      onRoute.delete(routeKey)
    }
  }

  await walk(start, rootReal, 0, true)
  return { caseDirs: [...found].sort(), skipped }
}

export function emptyCaseFilterText(
  caseGlob?: string,
  tags?: string[],
): string {
  const parts = [
    ...(caseGlob ? [`--case "${caseGlob}"`] : []),
    ...(tags ? tags.map(t => `--tag "${t}"`) : []),
  ]
  return parts.length > 0 ? ` matching ${parts.join(' ')}` : ''
}

/** densable `pd` — glob on case name (`*` / `?`, rest escaped). */
export function caseNameGlobMatches(glob: string, name: string): boolean {
  return new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  ).test(name)
}

/**
 * densable `fd`. Returns false to drop the case (`continue` in `ma`).
 * `--tag` is OR across the requested tags.
 */
export function matchesCaseFilter(
  identity: { name: string; tags: string[] },
  filter: { caseGlob?: string; tags?: string[] },
): boolean {
  if (filter.caseGlob && !caseNameGlobMatches(filter.caseGlob, identity.name)) {
    return false
  }
  if (filter.tags && filter.tags.length > 0) {
    if (!filter.tags.some(tag => identity.tags.includes(tag))) return false
  }
  return true
}

async function readUtf8IfPresent(path: string): Promise<string | null> {
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

function asYamlObject(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function parseCaseYamlObject(
  text: string | null,
): Record<string, unknown> | null | undefined {
  if (text === null || text.trim() === '') return null
  try {
    const parsed = parseYaml(text)
    if (parsed === null || parsed === undefined) return null
    // Gold `hd` throws on non-object YAML — `ma` records an error and
    // does not apply `fd`. Keep the dir (unfilterable).
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function parsePromptTopKeys(
  text: string | null,
): Record<string, unknown> | null | undefined {
  if (text === null) return null
  const match = text.match(FRONTMATTER_REGEX)
  if (!match) return null
  try {
    const fm = parseYaml(match[1] ?? '')
    if (fm === null || fm === undefined) return {}
    const obj = asYamlObject(fm)
    if (obj === null) return undefined
    const top: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (TOP_KEYS.has(key)) top[key] = value
    }
    return top
  } catch {
    return undefined
  }
}

/**
 * densable `ma` identity used by `fd`:
 * - missing definition → `{ name: basename, tags: [] }`
 * - `tags` omitted → `[]`
 * - `tags` present but not `string[]` → skip filter (`undefined`)
 * - empty/missing `name` on yaml-only → skip filter
 * - prose present with no yaml → default `name: basename` (gold `ks`)
 */
export async function peekCaseFilterIdentity(
  dir: string,
): Promise<{ name: string; tags: string[] } | undefined> {
  let yaml: Record<string, unknown> | null | undefined
  let proseTop: Record<string, unknown> | null | undefined
  let promptText: string | null
  try {
    const [yamlText, prompt] = await Promise.all([
      readUtf8IfPresent(join(dir, 'case.yaml')),
      readUtf8IfPresent(join(dir, 'prompt.md')),
    ])
    promptText = prompt
    yaml = parseCaseYamlObject(yamlText)
    proseTop = parsePromptTopKeys(prompt)
  } catch {
    return undefined
  }
  if (yaml === undefined || proseTop === undefined) return undefined

  const hasProse = promptText !== null
  const pe =
    yaml === null && !hasProse
      ? null
      : {
          ...(yaml ?? (hasProse ? { name: basename(dir) } : {})),
          ...(proseTop ?? {}),
        }

  const name =
    pe === null
      ? basename(dir)
      : typeof pe.name === 'string' && pe.name.length > 0
        ? pe.name
        : undefined
  const tags =
    pe === null || pe.tags === undefined
      ? []
      : Array.isArray(pe.tags) && pe.tags.every(t => typeof t === 'string')
        ? pe.tags
        : undefined
  if (name === undefined || tags === undefined) return undefined
  return { name, tags }
}

/** densable `ma` `fd` loop: drop dirs that fail `--case` / `--tag`. */
export async function filterEvalCaseDirs(
  caseDirs: string[],
  filter: { caseGlob?: string; tags?: string[] },
): Promise<string[]> {
  if (!filter.caseGlob && !(filter.tags && filter.tags.length > 0)) {
    return caseDirs
  }
  const kept: string[] = []
  for (const dir of caseDirs) {
    const identity = await peekCaseFilterIdentity(dir)
    if (identity === undefined || matchesCaseFilter(identity, filter)) {
      kept.push(dir)
    }
  }
  return kept
}
