import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import { WORKFLOW_RUNS_DIR } from '../constants.js'

/**
 * densable 2.1.216 Fle — local copy so workflow-engine stays zero-core-deps
 * (no `src/` imports). Same error name/message shape as core SymlinkWriteRefusedError.
 */
export class SymlinkWriteRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SymlinkWriteRefusedError'
  }
}

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const O_DIRECTORY = fsConstants.O_DIRECTORY ?? 0
const O_RDONLY = fsConstants.O_RDONLY

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    return typeof c === 'string' ? c : undefined
  }
  return undefined
}

/**
 * densable YNn subset — open each path segment under `base` with
 * O_RDONLY|O_DIRECTORY|O_NOFOLLOW. ENOENT ends early (caller mkdir).
 * ELOOP/ENOTDIR → SymlinkWriteRefusedError.
 *
 * Kept local (not imported from core `symlinkWriteGuard`) so this package
 * remains free of `src/` deps.
 */
export async function assertDirChainReal(
  base: string,
  dir: string,
): Promise<void> {
  const rel = relative(base, dir)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `assertDirChainReal: dir must be strictly inside base (rel: ${rel})`,
    )
  }
  let cur = base
  const segments = rel.split(sep).filter(s => s.length > 0)
  for (const seg of segments) {
    cur = join(cur, seg)
    try {
      const fh = await open(cur, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      await fh.close()
    } catch (err) {
      const code = errnoCode(err)
      if (code === 'ELOOP' || code === 'ENOTDIR') {
        throw new SymlinkWriteRefusedError(
          `Refusing to write under symlinked or non-directory path: ${cur}`,
        )
      }
      if (code === 'ENOENT') return
      throw err
    }
  }
}

/**
 * Persist an inline workflow script to the run directory so the caller can
 * iterate via `scriptPath` + `resumeFromRunId` without resending the full script
 * (the round-trip the Workflow tool playbook promises for the inline entry path).
 *
 * Mirrors engine/journal.ts: writes directly via node:fs/promises (no port) to
 * `<cwd>/<WORKFLOW_RUNS_DIR>/<runId>/script.js` — the same directory as
 * journal.jsonl, so journalStore.truncate(runId) cleans it up alongside the journal.
 *
 * densable 2.1.216 adjacency: refuse if any existing segment under
 * `.claude/workflow-runs` is a symlink (YNn). Leaf symlink refused via lstat.
 * Parent dir opened with O_NOFOLLOW before write. (Full M6/nWr/L1a live in
 * core `src/utils/symlinkWriteGuard.ts` — this is the zero-deps subset for
 * workflow-runs inline scripts only.)
 */
export async function persistInlineScript(
  script: string,
  runId: string,
  cwd: string,
): Promise<string> {
  // YNn(cwd, cwd/.claude/workflow-runs) — ENOENT on missing segments is OK
  await assertDirChainReal(cwd, join(cwd, WORKFLOW_RUNS_DIR))

  const dir = join(cwd, WORKFLOW_RUNS_DIR, runId)
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, 'script.js')

  // Parent must not be a symlink (post-mkdir TOCTOU densable-same as L1a wx path)
  try {
    const fh = await open(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    await fh.close()
  } catch (err) {
    const code = errnoCode(err)
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      throw new SymlinkWriteRefusedError(
        `Refusing to write into symlinked directory: ${dir}`,
      )
    }
    throw err
  }

  // Leaf must not already be a symlink
  try {
    const st = await lstat(filePath)
    if (st.isSymbolicLink()) {
      throw new SymlinkWriteRefusedError(
        `Refusing to write through symlink: ${filePath}. Resolve the symlink and pass the real target path explicitly.`,
      )
    }
  } catch (err) {
    if (errnoCode(err) !== 'ENOENT') throw err
  }

  await writeFile(filePath, script, 'utf-8')
  return filePath
}
