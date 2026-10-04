/**
 * densable `Yi`/`wc`/`or` — identity-preserving cwd file walk for eval
 * file evidence. Fail closed when the tree is replaced, linked, unreadable,
 * too deep, or too large.
 */
import { lstat, readdir, realpath } from 'fs/promises'
import { join } from 'path'
import { PluginEvalPathError } from './pathVet.js'

/** densable `og`. */
export const EVAL_CWD_WALK_MAX_DEPTH = 32
/** densable `ig`. */
export const EVAL_CWD_WALK_BUDGET = 200_000

export const EVAL_CWD_REPLACED =
  'the run directory (or a directory inside it) is no longer the one the harness listed, or cannot be listed — moved, removed, replaced by a link, made unreadable, or too deep or too large to walk — so its file evidence cannot be trusted'

function replaced(): PluginEvalPathError {
  return new PluginEvalPathError(
    EVAL_CWD_REPLACED,
    'eval run directory replaced',
  )
}

async function walkEvalCwd(
  root: string,
  rel: string,
  files: Set<string>,
  depth: number,
  budget: { count: number },
): Promise<void> {
  if (depth > EVAL_CWD_WALK_MAX_DEPTH) throw replaced()
  const dir = rel ? join(root, rel) : root
  const st = await lstat(dir, { bigint: true }).catch(() => null)
  if (
    st === null ||
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    (await realpath(dir).catch(() => null)) !== dir
  ) {
    throw replaced()
  }
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    throw replaced()
  }
  const again = await lstat(dir, { bigint: true }).catch(() => null)
  if (again === null || again.ino !== st.ino || again.dev !== st.dev) {
    throw replaced()
  }
  budget.count += entries.length
  if (budget.count > EVAL_CWD_WALK_BUDGET) throw replaced()
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory())
      await walkEvalCwd(root, child, files, depth + 1, budget)
    else files.add(child.replaceAll('\\', '/'))
  }
}

/** densable `Yi`. */
export async function snapshotEvalCwd(dir: string): Promise<Set<string>> {
  const files = new Set<string>()
  const st = await lstat(dir).catch(() => null)
  if (
    st === null ||
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    (await realpath(dir).catch(() => null)) !== dir
  ) {
    throw replaced()
  }
  await walkEvalCwd(dir, '', files, 0, { count: 0 })
  return files
}
