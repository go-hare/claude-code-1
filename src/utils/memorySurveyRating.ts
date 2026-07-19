/**
 * densable memory surveyRating write-back (s0f / Tjb / bjb / mjb / fjb / _jb / yjb).
 *
 * On memory-survey response (bad/fine/good → 1/2/3), resolve cited memory
 * filenames under the auto-memory dir and patch frontmatter:
 *
 *   metadata:
 *     surveyRating:
 *       count: N
 *       mean: X
 *       total: Y
 *
 * Team / hidden / non-memory paths are refused. Failures are best-effort
 * (log + skip); the survey UI never blocks on write-back.
 */

import { readdir, realpath, readFile, stat, utimes, writeFile } from 'fs/promises'
import { basename, isAbsolute, join, normalize, relative, sep } from 'path'
import { getAutoMemPath } from '../memdir/paths.js'
import { getTeamMemPath } from '../memdir/teamMemPaths.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { parseFrontmatter } from './frontmatterParser.js'
import { lock } from './lockfile.js'

/** densable n0f */
export const SURVEY_RATING_KEY = 'surveyRating'
/** densable pjb — max cited filenames considered per response */
const MAX_CITED_FILES = 16
/** densable hjb — max files listed when resolving bare basenames */
const MAX_MEMORY_LIST = 10_000
/** densable gjb — skip files larger than 256 KiB */
const MAX_FILE_BYTES = 262_144
/** densable o0f — stricter frontmatter open block (CRLF-aware) */
const FRONTMATTER_BLOCK_RE =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/
/** densable L7i reserved first path segments under auto-mem */
const RESERVED_MEMORY_ROOTS = new Set([
  'team',
  'logs',
  'sessions',
  'proposals',
])

export type SurveyRatingStats = {
  count: number
  mean: number
  total: number
}

/** densable wjb */
export const MEMORY_SURVEY_RESPONSE_SCORE: Record<string, number> = {
  bad: 1,
  fine: 2,
  good: 3,
}

/** densable fjb */
export function parseSurveyRatingStats(
  raw: unknown,
): SurveyRatingStats | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { count, mean, total } = raw as {
    count?: unknown
    mean?: unknown
    total?: unknown
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return null
  }
  if (typeof mean !== 'number' || !Number.isFinite(mean)) return null
  const resolvedTotal =
    typeof total === 'number' &&
    Number.isInteger(total) &&
    total >= count &&
    total <= 3 * count
      ? total
      : Math.min(3 * count, Math.max(count, Math.round(mean * count)))
  return { count, mean, total: resolvedTotal }
}

/** densable mjb */
export function accumulateSurveyRating(
  existing: unknown,
  score: number,
): SurveyRatingStats {
  const prev = parseSurveyRatingStats(existing)
  if (prev === null) {
    return { count: 1, mean: score, total: score }
  }
  const count = prev.count + 1
  const total = prev.total + score
  return {
    count,
    mean: Math.round((total / count) * 100) / 100,
    total,
  }
}

/** densable JQn + Bwe: reject hidden segments + reserved roots. */
export function isForbiddenMemoryRelativePath(relPosix: string): boolean {
  const parts = relPosix.split('/')
  if (parts.length === 0) return true
  if (parts.some(p => p.startsWith('.'))) return true
  const root = (parts[0] ?? '')
    .normalize('NFC')
    .replace(/[. ]+$/, '')
    .toLowerCase()
  return RESERVED_MEMORY_ROOTS.has(root)
}

/** densable i0f: path escapes auto-mem root or hits reserved/hidden. */
export function isUnsafeMemoryTarget(
  autoMemRootWithSep: string,
  absolutePath: string,
): boolean {
  const rel = relative(autoMemRootWithSep, absolutePath)
  if (rel === '' || rel.startsWith('..')) return true
  return isForbiddenMemoryRelativePath(rel.split(sep).join('/'))
}

function isUnderAutoMem(absolutePath: string, autoMemRoot: string): boolean {
  const root = normalize(autoMemRoot)
  const path = normalize(absolutePath)
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * densable DGo — stable JSON-ish fingerprint for frontmatter subset compare.
 * Not full YAML; used only to verify write-back only touched surveyRating.
 */
export function stableJsonFingerprint(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonFingerprint).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableJsonFingerprint(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

type MemoryFileIndex = { files: string[]; truncated: boolean }

/** densable yjb: list relative .md paths under auto-mem (skip reserved/hidden). */
export async function listAutoMemoryMarkdownFiles(
  autoMemRoot: string,
): Promise<MemoryFileIndex> {
  const files: string[] = []
  const stack: string[] = ['']
  while (stack.length > 0) {
    const rel = stack.pop()!
    let entries
    try {
      entries = await readdir(join(autoMemRoot, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      const posixRel = childRel.split(sep).join('/')
      if (isForbiddenMemoryRelativePath(posixRel)) continue
      if (entry.isDirectory()) {
        stack.push(childRel)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (files.length >= MAX_MEMORY_LIST) {
          return { files, truncated: true }
        }
        files.push(posixRel)
      }
    }
  }
  return { files, truncated: false }
}

/**
 * densable _jb: resolve a cited filename to an absolute path under auto-mem.
 * Absolute paths and path-containing names must land inside auto-mem; bare
 * basenames resolve only when exactly one match exists in the index.
 */
export async function resolveCitedMemoryPath(
  cited: string,
  autoMemRoot: string,
  getIndex: () => Promise<MemoryFileIndex>,
): Promise<string | null> {
  if (!cited.endsWith('.md')) return null
  const isSafe = (abs: string): boolean =>
    isUnderAutoMem(abs, autoMemRoot) &&
    !isUnderAutoMem(abs, getTeamMemPath()) &&
    !isUnsafeMemoryTarget(
      autoMemRoot.endsWith(sep) ? autoMemRoot : autoMemRoot + sep,
      abs,
    )

  if (isAbsolute(cited)) {
    const abs = normalize(cited)
    return isSafe(abs) ? abs : null
  }
  if (cited.includes('/') || cited.includes(sep)) {
    const abs = normalize(join(autoMemRoot, cited))
    return isSafe(abs) ? abs : null
  }
  const index = await getIndex()
  if (index.truncated) return null
  const matches = index.files.filter(f => basename(f) === cited)
  if (matches.length !== 1) return null
  const abs = normalize(join(autoMemRoot, matches[0]!))
  return isSafe(abs) ? abs : null
}

/**
 * densable bjb: rewrite surveyRating block inside the opening frontmatter.
 * Returns null when the frontmatter is ambiguous (duplicate keys, etc.).
 */
export function patchSurveyRatingFrontmatter(
  fileText: string,
  frontmatterMatch: string,
  stats: SurveyRatingStats,
): string | null {
  const nl = frontmatterMatch.includes('\r\n') ? '\r\n' : '\n'
  const fmLen = frontmatterMatch.length
  const lines = fileText.slice(0, fmLen).split('\n')
  const ratingLineRe = /^(\s*)surveyRating:/
  const ratingLines: number[] = []
  for (let i = 1; i < lines.length - 1; i++) {
    if (ratingLineRe.test(lines[i]!)) ratingLines.push(i)
  }
  if (ratingLines.length > 1) return null

  const formatBlock = (indent: string): string =>
    `${indent}surveyRating:${nl}${indent}  count: ${stats.count}${nl}${indent}  mean: ${stats.mean}${nl}${indent}  total: ${stats.total}`

  if (ratingLines.length === 1) {
    const idx = ratingLines[0]!
    const indentMatch = lines[idx]!.match(ratingLineRe)
    const indent = indentMatch?.[1] ?? '  '
    let end = idx + 1
    while (end < lines.length - 1) {
      const line = lines[end]!.replace(/\r$/, '')
      if (/^\s*(#|$)/.test(line)) {
        let peek = end + 1
        while (
          peek < lines.length - 1 &&
          /^\s*(#|$)/.test(lines[peek]!.replace(/\r$/, ''))
        ) {
          peek++
        }
        if (
          peek < lines.length - 1 &&
          /\S/.test(lines[peek]!) &&
          (lines[peek]!.match(/^(\s*)/)?.[1]?.length ?? 0) > indent.length
        ) {
          end = peek
          continue
        }
        break
      }
      if ((line.match(/^(\s*)/)?.[1]?.length ?? 0) > indent.length) {
        end++
        continue
      }
      break
    }
    return (
      [...lines.slice(0, idx), formatBlock(indent), ...lines.slice(end)].join(
        '\n',
      ) + fileText.slice(fmLen)
    )
  }

  // Insert under existing metadata: block, or create metadata: + surveyRating.
  const metaInline = lines.findIndex(
    (line, i) => i > 0 && /^metadata:/.test(line.replace(/\r$/, '')),
  )
  const metaEmpty = lines.findIndex(
    (line, i) => i > 0 && /^metadata:\s*$/.test(line.replace(/\r$/, '')),
  )
  if (metaInline !== -1 && metaEmpty === -1) {
    // densable: `metadata: {…}` single-line form — refuse rather than corrupt
    return null
  }
  if (metaEmpty !== -1) {
    let child = metaEmpty + 1
    while (
      child < lines.length - 1 &&
      /^\s*(#|$)/.test(lines[child]!.replace(/\r$/, ''))
    ) {
      child++
    }
    const childIndentMatch = lines[child]?.match(/^(\s+)\S/)
    const indent = childIndentMatch?.[1] ?? '  '
    return (
      [
        ...lines.slice(0, metaEmpty + 1),
        formatBlock(indent),
        ...lines.slice(metaEmpty + 1),
      ].join('\n') + fileText.slice(fmLen)
    )
  }

  // No metadata key — insert before closing ---
  let closeIdx = lines.length - 1
  while (closeIdx > 0 && lines[closeIdx]!.trim() !== '---') closeIdx--
  if (closeIdx === 0) return null
  return (
    [
      ...lines.slice(0, closeIdx),
      `metadata:${nl}${formatBlock('  ')}`,
      ...lines.slice(closeIdx),
    ].join('\n') + fileText.slice(fmLen)
  )
}

function frontmatterMetadata(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const meta = frontmatter.metadata
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    return meta as Record<string, unknown>
  }
  return {}
}

/**
 * densable Tjb: lock + validate + patch surveyRating on one memory file.
 * Returns true when the file was written.
 */
export async function writeSurveyRatingToMemoryFile(
  originalPath: string,
  realPath: string,
  score: number,
): Promise<boolean> {
  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(originalPath, { retries: 0, realpath: false })
  } catch {
    // If lock fails, still try best-effort single-writer path
  }
  try {
    const autoMem = getAutoMemPath()
    const teamMem = getTeamMemPath()
    let resolvedReal: string
    try {
      resolvedReal = await realpath(realPath)
    } catch {
      return false
    }
    // densable: refuse symlink escapes (realpath must equal the target we write)
    if (resolvedReal !== realPath) return false
    if (!isUnderAutoMem(realPath, autoMem)) return false
    if (isUnderAutoMem(realPath, teamMem)) return false
    if (
      isUnsafeMemoryTarget(
        autoMem.endsWith(sep) ? autoMem : autoMem + sep,
        realPath,
      )
    ) {
      return false
    }

    let mtime: Date
    let atime: Date
    let content: string
    try {
      const st = await stat(realPath)
      if (st.size > MAX_FILE_BYTES) return false
      mtime = st.mtime
      atime = st.atime
      content = await readFile(realPath, 'utf8')
    } catch {
      return false
    }

    const looseMatch = content.match(/^---\s*\n([\s\S]*?)---\s*\n?/)
    const strictMatch = content.match(FRONTMATTER_BLOCK_RE)
    if (
      looseMatch === null ||
      strictMatch === null ||
      looseMatch[1]!.trim() !== strictMatch[1]!.trim()
    ) {
      return false
    }

    const parsed = parseFrontmatter(content, realPath)
    if (Object.keys(parsed.frontmatter).length === 0) return false

    const fm = parsed.frontmatter as Record<string, unknown>
    const metadata = frontmatterMetadata(fm)
    const nextStats = accumulateSurveyRating(metadata[SURVEY_RATING_KEY], score)
    const patched = patchSurveyRatingFrontmatter(
      content,
      strictMatch[0],
      nextStats,
    )
    if (patched === null) return false

    // densable safety: only surveyRating metadata may change; body identical.
    const before = parseFrontmatter(content, realPath)
    const after = parseFrontmatter(patched, realPath)
    const beforeFm = before.frontmatter as Record<string, unknown>
    const afterFm = after.frontmatter as Record<string, unknown>
    const beforeMeta = frontmatterMetadata(beforeFm)
    const afterMeta = frontmatterMetadata(afterFm)
    const expectedMetaFp = stableJsonFingerprint({
      ...beforeMeta,
      [SURVEY_RATING_KEY]: {
        count: nextStats.count,
        mean: nextStats.mean,
        total: nextStats.total,
      },
    })
    if (
      stableJsonFingerprint({
        name: afterFm.name,
        description: afterFm.description,
        metadata: afterMeta,
      }) !==
        stableJsonFingerprint({
          name: beforeFm.name,
          description: beforeFm.description,
          metadata: {
            ...beforeMeta,
            [SURVEY_RATING_KEY]: {
              count: nextStats.count,
              mean: nextStats.mean,
              total: nextStats.total,
            },
          },
        }) ||
      stableJsonFingerprint(afterMeta) !== expectedMetaFp ||
      after.content !== before.content
    ) {
      return false
    }

    // densable: post-frontmatter bytes (including opening delimiter end) unchanged
    const patchedStrict = patched.match(FRONTMATTER_BLOCK_RE)
    if (
      patchedStrict === null ||
      patched.slice(patchedStrict[0].length) !==
        content.slice(strictMatch[0].length)
    ) {
      return false
    }

    const endings = content.includes('\r\n') ? 'CRLF' : 'LF'
    let toWrite = patched
    if (endings === 'CRLF') {
      toWrite = patched.replaceAll('\r\n', '\n').split('\n').join('\r\n')
    }
    await writeFile(realPath, toWrite, 'utf8')
    try {
      await utimes(realPath, atime, mtime)
    } catch {
      // best-effort mtime restore
    }
    return true
  } finally {
    if (release) {
      try {
        await release()
      } catch {
        // ignore unlock errors
      }
    }
  }
}

/**
 * densable s0f: resolve cited memory filenames and write surveyRating.
 * Fire-and-forget from the survey onSelect path.
 */
export async function writeMemorySurveyRatings(
  filenames: readonly string[],
  score: number,
): Promise<void> {
  try {
    if (!Number.isInteger(score) || score < 1 || score > 3) return
    const autoMem = getAutoMemPath()
    let index: MemoryFileIndex | null = null
    const getIndex = async (): Promise<MemoryFileIndex> => {
      index ??= await listAutoMemoryMarkdownFiles(autoMem)
      return index
    }
    const unique = new Map<string, string>()
    for (const raw of filenames.slice(0, MAX_CITED_FILES)) {
      const resolved = await resolveCitedMemoryPath(
        raw.trim(),
        autoMem,
        getIndex,
      )
      if (resolved === null) continue
      const real = await realpath(resolved).catch(() => null)
      if (real !== null && !unique.has(real)) {
        unique.set(real, resolved)
      }
    }
    const results = await Promise.allSettled(
      [...unique].map(async ([real, original]) => {
        const ok = await writeSurveyRatingToMemoryFile(original, real, score)
        return ok
      }),
    )
    const written = results.filter(
      r => r.status === 'fulfilled' && r.value === true,
    ).length
    logEvent('tengu_memory_rating_writeback', {
      cited_count: String(
        filenames.length,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      resolved_count: String(
        unique.size,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      written_count: String(
        written,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } catch (err) {
    logForDebugging(
      `memorySurveyRating: write-back failed: ${String(err)}`,
      { level: 'warn' },
    )
  }
}
