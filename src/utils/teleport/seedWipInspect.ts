/**
 * densable `_465` `Xi` + `ze` — inspect staged/working for eYn listing.
 * Gold: gold-forged-Xi.txt / gold-forged-mod-tail.txt `Li`/`ze`
 */

import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { gitExe } from '../git.js'

const DIFF_TREE_META =
  /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([A-Z])[0-9]*$/

export type SeedDiffRow = {
  path: string
  oldMode: string
  newMode: string
  oldId: string
  newId: string
  status: string
}

export type SeedInspection = {
  base: string
  baseTree: string
  iTree: string
  staged: SeedDiffRow[]
  working: SeedDiffRow[]
}

export type SeedInspectResult =
  | { kind: 'inspected'; inspection: SeedInspection }
  | { kind: 'none'; leftOut: [] }
  | { kind: 'failed'; step: string; detail: string }

export type SeedGitRun = (
  args: string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
) => Promise<{
  code: number
  exitCode?: number
  stdout: string
  stderr: string
}>

/** densable `ze` */
export function parseDiffTreeZ(stdout: string): SeedDiffRow[] | null {
  const parts = stdout.split('\0')
  if (parts.pop() !== '' || parts.length % 2 !== 0) return null
  const rows = Array.from({ length: parts.length / 2 }, (_, i) => {
    const meta = DIFF_TREE_META.exec(parts[2 * i] ?? '')
    const path = parts[2 * i + 1]
    if (!meta || path === undefined) return null
    return {
      path,
      oldMode: meta[1]!,
      newMode: meta[2]!,
      oldId: meta[3]!,
      newId: meta[4]!,
      status: meta[5]!,
    }
  })
  return rows.every(r => r !== null) ? rows : null
}

function fail(step: string, detail: string): SeedInspectResult {
  return { kind: 'failed', step, detail }
}

/** densable `Xi` */
export async function inspectSeedWipWith(
  run: SeedGitRun,
): Promise<SeedInspectResult> {
  const head = await run(['rev-parse', '-q', '--verify', 'HEAD'])
  if (head.code !== 0) {
    return (head.exitCode ?? head.code) === 1
      ? { kind: 'none', leftOut: [] }
      : fail('rev-parse', head.stderr)
  }
  const base = head.stdout.trim()
  const [tree, written] = await Promise.all([
    run(['rev-parse', '-q', '--verify', `${base}^{commit}^{tree}`]),
    run(['write-tree']),
  ])
  if (tree.code !== 0) {
    return fail('rev-parse', tree.stderr || 'HEAD is not a commit')
  }
  if (written.code !== 0) {
    return fail('write-tree', written.stderr || written.stdout)
  }
  const baseTree = tree.stdout.trim()
  const iTree = written.stdout.trim()
  const [diffTree, diffIndex] = await Promise.all([
    run([
      'diff-tree',
      '-r',
      '-z',
      '--no-renames',
      '--ignore-submodules=dirty',
      baseTree,
      iTree,
    ]),
    run([
      '--no-optional-locks',
      'diff-index',
      '-z',
      '--no-renames',
      '--ignore-submodules=dirty',
      base,
      '--',
    ]),
  ])
  const staged = diffTree.code === 0 ? parseDiffTreeZ(diffTree.stdout) : null
  if (staged === null) return fail('diff-tree', diffTree.stderr)
  const working = diffIndex.code === 0 ? parseDiffTreeZ(diffIndex.stdout) : null
  if (working === null) return fail('diff-index', diffIndex.stderr)
  if (working.some(row => row.path.includes('\uFFFD'))) {
    return fail('path-encoding', 'a changed path is not valid UTF-8')
  }
  return {
    kind: 'inspected',
    inspection: { base, baseTree, iTree, staged, working },
  }
}

/** densable `Xi` over a plain checkout (no hardened layout). */
export async function inspectSeedWip(
  gitRoot: string,
  signal?: AbortSignal,
): Promise<SeedInspectResult> {
  return inspectSeedWipWith(async (args, env, input) => {
    const result = await execFileNoThrowWithCwd(gitExe(), args, {
      cwd: gitRoot,
      abortSignal: signal,
      preserveOutputOnError: false,
      stripFinalNewline: false,
      env,
      input,
    })
    return { ...result, exitCode: result.code }
  })
}
