/**
 * densable `_d` subset: walk evalDir for directories that contain
 * case.yaml or prompt.md. Gold's full walker (symlink climb, ownership
 * vet, mocks reserved) is not invented here — this is the scan `mc`
 * uses before empty-case refuse.
 */

import { readdir } from 'fs/promises'
import { join } from 'path'
import { CASE_FILE_NAMES, SKIP_DIR_NAMES } from './constants.js'

const MAX_DEPTH = 8

function isCaseFile(name: string): boolean {
  return (CASE_FILE_NAMES as readonly string[]).includes(name)
}

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

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      skipped.push({
        file: dir,
        error: `nested more than ${MAX_DEPTH} directories below the target — not scanned from here`,
      })
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : undefined
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      skipped.push({
        file: dir,
        error: `cannot be read (${code ?? 'unknown error'}) — not scanned`,
      })
      return
    }
    if (entries.some(e => !e.isDirectory() && isCaseFile(e.name))) {
      found.add(dir)
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) {
        continue
      }
      await walk(join(dir, entry.name), depth + 1)
    }
  }

  await walk(start, 0)
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
