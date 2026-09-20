/**
 * densable `_465` `hs` / `eYn` write-tree WIP + `en` / `ji` / `or` / `ir` / `sr`
 * / `Ne` / `qi` / `rn` / `Qi` / `nn`.
 * Gold: gold-forged-hs-wide.txt / gold-forged-Ne.txt / gold-forged-nn.txt
 */

import { randomBytes } from 'crypto'
import { lstat, mkdtemp, open, readdir, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { uniq } from '../array.js'
import { getErrnoCode } from '../errors.js'
import { logForDebugging } from '../debug.js'
import { getPlatform } from '../platform.js'
import { isSeedCredentialPath } from './seedCredentialPath.js'
import type { SeedGitLayout } from './seedGitLayout.js'
import {
  classifySeedListing,
  seedPathIsWindows83Alias,
  seedPathListingOk,
  type SeedPathRow,
} from './seedPathClassify.js'
import { seedAncestorHopState } from './seedPathHop.js'
import { classifySeedLeaveOut } from './seedWipLeaveOut.js'
import { seedWorkingUnchanged } from './seedWipLeaveOut.js'
import {
  inspectSeedWipWith,
  parseDiffTreeZ,
  type SeedDiffRow,
  type SeedGitRun,
  type SeedInspectResult,
} from './seedWipInspect.js'
import { seedPoolMap } from './seedWipPool.js'
import {
  seedStageCopiesUnchanged,
  stageSeedWipCopies,
  type SeedStageEntry,
} from './seedWipStage.js'

const POOL = 8
const MN_HS_MAX = 67_108_864
const DEFAULT_STAGE_BYTES = 536_870_912
const ATTR_MAX = 65_536
const LS_TREE_CHUNK = 16_384
const SKIP_WORKTREE_EXIT = 129
const STALE_INDEX_MS = 600_000
const SYMLINK_MODE = '120000'
const ATTR_NAMES = ['filter', 'working-tree-encoding', 'ident'] as const
const STASH_AUTHOR = {
  GIT_AUTHOR_NAME: 'git stash',
  GIT_AUTHOR_EMAIL: 'git@stash',
  GIT_COMMITTER_NAME: 'git stash',
  GIT_COMMITTER_EMAIL: 'git@stash',
} as const
const LITERAL_PATHSPECS = {
  GIT_LITERAL_PATHSPECS: '1',
  GIT_GLOB_PATHSPECS: '0',
  GIT_NOGLOB_PATHSPECS: '0',
  GIT_ICASE_PATHSPECS: '0',
} as const
const SCRATCH_INDEX = /^ccr-seed-([0-9]+)-[0-9a-f]{12}\.index(?:\.lock)?$/
const ATTR_LINE = /(^|\s)[-!]?(?:filter|working-tree-encoding|ident)(=|\s|$)/

export type SeedWipBuildResult =
  | SeedInspectResult
  | { kind: 'refused'; refused: SeedPathRow[]; decidedOn: 'listing' | 'tree' }
  | { kind: 'none'; leftOut: SeedPathRow[] }
  | { kind: 'created'; commit: string; leftOut: SeedPathRow[] }

function fail(step: string, detail: string): SeedWipBuildResult {
  return { kind: 'failed', step, detail }
}

type AttrSnapshot =
  | { kind: 'none'; bytes: Buffer | null }
  | { kind: 'touches'; bytes: Buffer }
  | { kind: 'unreadable'; bytes: null }

/** densable `Ne` */
async function readInfoAttributes(commonDir: string): Promise<AttrSnapshot> {
  const path = join(commonDir, 'info', 'attributes')
  try {
    if (getPlatform() === 'windows' && !(await lstat(path)).isFile()) {
      return { kind: 'unreadable', bytes: null }
    }
    const handle = await open(path, 'r')
    try {
      const st = await handle.stat()
      if (!st.isFile() || st.size > ATTR_MAX) {
        return { kind: 'unreadable', bytes: null }
      }
      if (st.size === 0) return { kind: 'none', bytes: Buffer.alloc(0) }
      const buf = Buffer.alloc(st.size)
      const { bytesRead } = await handle.read(buf, 0, st.size, 0)
      if (bytesRead !== st.size) return { kind: 'unreadable', bytes: null }
      const touches = buf
        .toString('utf8')
        .split('\n')
        .some(line => !line.trimStart().startsWith('#') && ATTR_LINE.test(line))
      return { kind: touches ? 'touches' : 'none', bytes: buf }
    } finally {
      await handle.close()
    }
  } catch (err) {
    const code = getErrnoCode(err)
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { kind: 'none', bytes: null }
      : { kind: 'unreadable', bytes: null }
  }
}

/** densable `rn` */
function infoAttributesUnchanged(
  prev: AttrSnapshot,
  next: AttrSnapshot,
): boolean {
  return (
    next.kind === 'none' &&
    (prev.bytes === null
      ? next.bytes === null
      : next.bytes !== null && prev.bytes.equals(next.bytes))
  )
}

/** densable `qi` */
async function checkForcedAttrs(
  run: SeedGitRun,
  paths: string[],
): Promise<string[] | null> {
  if (paths.length === 0) return []
  const result = await run(
    ['check-attr', '-z', '--stdin', ...ATTR_NAMES],
    undefined,
    paths.map(path => `${path}\0`).join(''),
  )
  if (result.code !== 0) return null
  const parts = result.stdout.split('\0')
  return uniq(
    Array.from({ length: Math.floor(parts.length / 3) }, (_, i) => i).flatMap(
      i =>
        parts[3 * i + 2] !== 'unspecified' && parts[3 * i + 2] !== 'unset'
          ? [parts[3 * i]!]
          : [],
    ),
  )
}

/** densable `Qi` hash-object for symlink stage entries. */
async function hashSeedSymlinks(
  run: SeedGitRun,
  indexFile: string,
  entries: SeedStageEntry[],
): Promise<SeedWipBuildResult | null> {
  const links = entries.filter(
    (row): row is Extract<SeedStageEntry, { kind: 'symlink' }> =>
      row.kind === 'symlink',
  )
  const lines: string[] = []
  for (const row of links) {
    const target = row.target.toString('utf8')
    if (!Buffer.from(target, 'utf8').equals(row.target)) {
      return fail(
        'path-encoding',
        `${row.path}: link target is not valid UTF-8`,
      )
    }
    const hashed = await run(
      ['hash-object', '-w', '--stdin'],
      undefined,
      target,
    )
    if (hashed.code !== 0) return fail('hash-object', hashed.stderr)
    lines.push(`${SYMLINK_MODE} ${hashed.stdout.trim()}\t${row.path}`)
  }
  if (lines.length === 0) return null
  const updated = await run(
    ['update-index', '-z', '--index-info'],
    { GIT_INDEX_FILE: indexFile },
    lines.map(line => `${line}\0`).join(''),
  )
  return updated.code === 0 ? null : fail('update-index', updated.stderr)
}

/** densable `nn` */
async function diffTreeLeaveOut(
  run: SeedGitRun,
  baseTree: string,
  built: string,
  leaveOut: (path: string) => boolean,
): Promise<SeedPathRow[] | null> {
  const result = await run([
    'diff-tree',
    '-r',
    '-z',
    '--no-renames',
    baseTree,
    built,
  ])
  const rows = result.code === 0 ? parseDiffTreeZ(result.stdout) : null
  if (rows === null) return null
  const kept = rows.filter(
    row =>
      row.status !== 'D' &&
      (!seedPathListingOk(row.path) ||
        seedPathIsWindows83Alias(row.path) ||
        leaveOut(row.path)),
  )
  const statusByPath = new Map(kept.map(row => [row.path, row.status]))
  return uniq(kept.map(row => row.path))
    .sort()
    .map(path => ({
      path,
      why: !seedPathListingOk(path)
        ? ('forged' as const)
        : seedPathIsWindows83Alias(path)
          ? ('alias' as const)
          : statusByPath.get(path) === 'A'
            ? ('added' as const)
            : ('changed' as const),
    }))
}

/** densable `ji` */
function chunkPaths(paths: string[]): string[][] {
  return paths.reduce<{ slices: string[][]; bytes: number }>(
    (acc, path) => {
      const n = Buffer.byteLength(path) + 1
      const last = acc.slices.at(-1)
      if (
        last !== undefined &&
        last.length > 0 &&
        acc.bytes + n <= LS_TREE_CHUNK
      ) {
        last.push(path)
        return { slices: acc.slices, bytes: acc.bytes + n }
      }
      acc.slices.push([path])
      return { slices: acc.slices, bytes: n }
    },
    { slices: [], bytes: 0 },
  ).slices
}

/** densable `en` */
async function restoreIndexPaths(
  run: SeedGitRun,
  indexFile: string,
  baseTree: string,
  paths: string[],
): Promise<{ code: number; stderr: string }> {
  const restored = new Map<string, string>()
  for (const group of chunkPaths(paths)) {
    const listed = await run(
      ['ls-tree', '-z', '--full-tree', baseTree, '--', ...group],
      LITERAL_PATHSPECS,
    )
    if (listed.code !== 0) {
      return { ...listed, stderr: `git ls-tree: ${listed.stderr}` }
    }
    for (const entry of listed.stdout.split('\0')) {
      if (entry === '') continue
      const tab = entry.indexOf('\t')
      const [mode, type, oid] = entry.slice(0, tab).split(' ')
      if (type !== 'tree') restored.set(entry.slice(tab + 1), `${mode} ${oid}`)
    }
  }
  const zero = `0 ${'0'.repeat(baseTree.length)}`
  return run(
    ['update-index', '-z', '--index-info'],
    { GIT_INDEX_FILE: indexFile },
    paths.map(path => `${restored.get(path) ?? zero}\t${path}\0`).join(''),
  )
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return getErrnoCode(err) === 'EPERM'
  }
}

/** densable `ir` — drop stale scratch indexes. */
async function sweepScratchIndexes(gitDir: string): Promise<void> {
  try {
    await Promise.all(
      (await readdir(gitDir)).map(async name => {
        const pid = SCRATCH_INDEX.exec(name)?.[1]
        if (pid === undefined) return
        const path = join(gitDir, name)
        if (
          Date.now() - (await stat(path)).mtimeMs > STALE_INDEX_MS &&
          !pidAlive(Number(pid))
        ) {
          await rm(path, { force: true })
        }
      }),
    )
  } catch {
    /* official swallows */
  }
}

/** densable `sr` — drop hop-clear directories from the stage list. */
async function keepNonDirectoryPaths(
  workTree: string,
  paths: string[],
): Promise<string[]> {
  const mapper = seedPoolMap(POOL, async (path: string) => {
    if ((await seedAncestorHopState(workTree, path)) !== 'clear') return [path]
    try {
      return (await lstat(join(workTree, path))).isDirectory() ? [] : [path]
    } catch {
      return [path]
    }
  })
  return (await Promise.all(paths.map(mapper))).flat()
}

/** densable `or` */
async function describeSeedBase(
  run: SeedGitRun,
  base: string,
): Promise<string> {
  const [branch, subject] = await Promise.all([
    run(['symbolic-ref', '-q', '--short', 'HEAD']),
    run(['rev-list', '--max-count=1', '--format=%h %s', base]),
  ])
  const name = branch.code === 0 ? branch.stdout.trim() : '(no branch)'
  const line =
    subject.code === 0 ? (subject.stdout.trim().split('\n').at(-1) ?? '') : ''
  return `${name}: ${line}`
}

export type SeedWipBuildOpts = {
  signal?: AbortSignal
  leaveOutUncommittedCredentialFiles?: boolean
  alsoLeaveOut?: (path: string) => boolean
  maxStagedBytes?: number
}

/** densable `hs` / `eYn` */
export async function buildSeedWipCommit(
  _cwd: string,
  layout: SeedGitLayout,
  opts: SeedWipBuildOpts = {},
): Promise<SeedWipBuildResult> {
  const run: SeedGitRun = (args, env, input) => layout.run(args, env, input)
  const leaveOut = (path: string) =>
    isSeedCredentialPath(path) || (opts.alsoLeaveOut?.(path) ?? false)
  const inspected = await inspectSeedWipWith(run)
  if (inspected.kind !== 'inspected') return inspected
  const { gitDir, workTree } = layout
  const { base, baseTree, iTree } = inspected.inspection
  const listing = classifySeedListing(inspected.inspection)
  if (listing.length > 0) {
    return { kind: 'refused', refused: listing, decidedOn: 'listing' }
  }
  let leftOut = opts.leaveOutUncommittedCredentialFiles
    ? await classifySeedLeaveOut(
        workTree,
        inspected.inspection,
        leaveOut,
        path => opts.alsoLeaveOut?.(path) ?? false,
      )
    : []
  const leftOutPaths = new Set(leftOut.map(row => row.path))
  const stagedPaths = new Set(inspected.inspection.staged.map(row => row.path))
  const started = Date.now()
  const unchanged = seedPoolMap(POOL, (row: SeedDiffRow) =>
    opts.signal?.aborted === true ||
    leftOutPaths.has(row.path) ||
    stagedPaths.has(row.path)
      ? Promise.resolve(false)
      : seedWorkingUnchanged(workTree, row, MN_HS_MAX, opts.signal),
  )
  const flags = await Promise.all(inspected.inspection.working.map(unchanged))
  const dirty = inspected.inspection.working.filter((_, i) => !flags[i])
  const skipped = inspected.inspection.working.length - dirty.length
  if (skipped > 0) {
    logForDebugging(
      `[wipStash] ${skipped} of ${inspected.inspection.working.length} stat-dirty tracked files were unchanged (${Date.now() - started}ms)`,
    )
  }
  if (dirty.length === 0 && iTree === baseTree) {
    return { kind: 'none', leftOut }
  }
  await sweepScratchIndexes(gitDir)
  const indexFile = join(
    layout.adminDir ?? gitDir,
    `ccr-seed-${process.pid}-${randomBytes(6).toString('hex')}.index`,
  )
  let stageRoot: string | null = null
  try {
    const read = await run([
      'read-tree',
      '--no-recurse-submodules',
      `--index-output=${indexFile}`,
      '-m',
      iTree,
    ])
    if (read.code !== 0) return fail('read-tree', read.stderr)
    let indexTree = iTree
    if (leftOutPaths.size > 0) {
      const restored = await restoreIndexPaths(run, indexFile, baseTree, [
        ...leftOutPaths,
      ])
      if (restored.code !== 0) return fail('update-index', restored.stderr)
      const written = await run(['write-tree'], { GIT_INDEX_FILE: indexFile })
      if (written.code !== 0) {
        return fail('write-tree', written.stderr || written.stdout)
      }
      indexTree = written.stdout.trim()
    }
    const deletedCreds = opts.leaveOutUncommittedCredentialFiles
      ? dirty
          .filter(
            row =>
              row.status === 'D' &&
              !leftOutPaths.has(row.path) &&
              leaveOut(row.path),
          )
          .map(row => row.path)
      : []
    const includePath = (path: string) =>
      !leftOutPaths.has(path) &&
      (!opts.leaveOutUncommittedCredentialFiles || !leaveOut(path))
    const toStage = (
      await keepNonDirectoryPaths(workTree, uniq(dirty.map(row => row.path)))
    ).filter(includePath)
    if (toStage.length > 0) {
      // densable `an` (`N as uZb`) — scratch parent when adminDir is unset.
      const tmpBase = layout.adminDir ?? tmpdir()
      stageRoot = await mkdtemp(join(tmpBase, 'claude-seed-stage-'))
      const staged = await stageSeedWipCopies(
        workTree,
        stageRoot,
        toStage,
        opts.maxStagedBytes ?? DEFAULT_STAGE_BYTES,
      )
      if ('refused' in staged) return fail('stage', staged.refused)
      const changed = staged.entries.find(row => row.kind === 'changed')
      if (changed !== undefined) {
        return fail('stage', `${changed.path} changed while it was being read`)
      }
      const stagedLayout = layout.withWorkTree(stageRoot)
      const stagedRun: SeedGitRun = (args, env, input) =>
        stagedLayout.run(args, env, input)
      const filePaths = staged.entries.flatMap(row =>
        row.kind === 'file' ? [row.path] : [],
      )
      const attrs = await readInfoAttributes(layout.commonDir)
      if (attrs.kind !== 'none') {
        return fail(
          'check-attr',
          attrs.kind === 'touches'
            ? '.git/info/attributes sets or unsets filter attributes'
            : '.git/info/attributes could not be read as a plain file',
        )
      }
      const forced = await checkForcedAttrs(stagedRun, filePaths)
      if (forced === null) {
        return fail('check-attr', 'could not read the attributes in force')
      }
      const attrsAgain = await readInfoAttributes(layout.commonDir)
      if (!infoAttributesUnchanged(attrs, attrsAgain)) {
        return fail(
          'check-attr',
          '.git/info/attributes changed while the attributes were read',
        )
      }
      const stageSet = new Set(toStage)
      const filtered: SeedPathRow[] = [
        ...staged.entries.flatMap(row =>
          row.kind === 'hardlinked' && stageSet.has(row.path)
            ? [{ path: row.path, why: 'hardlinked' as const }]
            : [],
        ),
        ...forced.map(path => ({ path, why: 'filtered' as const })),
      ]
      const skip = new Set(filtered.map(row => row.path))
      leftOut.push(...filtered)
      const hashed = await hashSeedSymlinks(
        run,
        indexFile,
        staged.entries.filter(row => !skip.has(row.path)),
      )
      if (hashed !== null) return hashed
      const updatePaths = staged.entries.flatMap(row =>
        (row.kind === 'file' || row.kind === 'absent') && !skip.has(row.path)
          ? [row.path]
          : [],
      )
      if (updatePaths.length > 0) {
        const update = (flags: string[]) =>
          stagedRun(
            [
              '-c',
              'core.bigFileThreshold=512m',
              'update-index',
              ...flags,
              '-z',
              '--add',
              '--remove',
              '--stdin',
            ],
            { GIT_INDEX_FILE: indexFile },
            updatePaths.map(path => `${path}\0`).join(''),
          )
        const first = await update(['--ignore-skip-worktree-entries'])
        const second =
          first.exitCode === SKIP_WORKTREE_EXIT ? await update([]) : first
        if (second.code !== 0) return fail('update-index', second.stderr)
        if (!(await seedStageCopiesUnchanged(stageRoot, staged.copies))) {
          return fail('stage', 'the staged copies changed while git read them')
        }
        if (
          !infoAttributesUnchanged(
            attrs,
            await readInfoAttributes(layout.commonDir),
          )
        ) {
          return fail(
            'check-attr',
            '.git/info/attributes changed while the changes were hashed',
          )
        }
      }
    }
    if (deletedCreds.length > 0) {
      const removed = await run(
        ['update-index', '-z', '--index-info'],
        { GIT_INDEX_FILE: indexFile },
        deletedCreds
          .map(path => `0 ${'0'.repeat(baseTree.length)}\t${path}\0`)
          .join(''),
      )
      if (removed.code !== 0) return fail('update-index', removed.stderr)
    }
    const written = await run(['write-tree'], { GIT_INDEX_FILE: indexFile })
    if (written.code !== 0) {
      return fail('write-tree', written.stderr || written.stdout)
    }
    let built = written.stdout.trim()
    if (opts.leaveOutUncommittedCredentialFiles) {
      const leftover = await diffTreeLeaveOut(run, baseTree, built, leaveOut)
      if (leftover === null) {
        return fail('diff-tree', 'could not compare the built tree with HEAD')
      }
      const creds = leftover.filter(
        row => row.why !== 'forged' && row.why !== 'alias',
      )
      if (creds.length > 0) {
        const restored = await restoreIndexPaths(
          run,
          indexFile,
          baseTree,
          creds.map(row => row.path),
        )
        if (restored.code !== 0) return fail('update-index', restored.stderr)
        const rewritten = await run(['write-tree'], {
          GIT_INDEX_FILE: indexFile,
        })
        if (rewritten.code !== 0) {
          return fail('write-tree', rewritten.stderr || rewritten.stdout)
        }
        built = rewritten.stdout.trim()
        leftOut.push(...creds)
      }
      const compared = await Promise.all(
        uniq([built, indexTree]).map(tree =>
          diffTreeLeaveOut(run, baseTree, tree, leaveOut),
        ),
      )
      if (compared.some(row => row === null)) {
        return fail('diff-tree', 'could not compare the built tree with HEAD')
      }
      const refused = [
        ...new Map(
          compared.flatMap(row => row ?? []).map(row => [row.path, row]),
        ).values(),
      ]
      if (refused.length > 0) {
        return { kind: 'refused', refused, decidedOn: 'tree' }
      }
    }
    if (built === baseTree && indexTree === baseTree) {
      return { kind: 'none', leftOut }
    }
    const label = await describeSeedBase(run, base)
    const indexCommit = await run(
      ['commit-tree', indexTree, '-p', base, '-m', `index on ${label}`],
      STASH_AUTHOR,
    )
    if (indexCommit.code !== 0) return fail('commit-tree', indexCommit.stderr)
    const wip = await run(
      [
        'commit-tree',
        built,
        '-p',
        base,
        '-p',
        indexCommit.stdout.trim(),
        '-m',
        `WIP on ${label}`,
      ],
      STASH_AUTHOR,
    )
    if (wip.code !== 0) return fail('commit-tree', wip.stderr)
    return { kind: 'created', commit: wip.stdout.trim(), leftOut }
  } catch (err) {
    return fail('scratch-index', String(err))
  } finally {
    await Promise.all(
      [
        indexFile,
        `${indexFile}.lock`,
        ...(stageRoot === null ? [] : [stageRoot]),
      ].map(path => rm(path, { recursive: true, force: true }).catch(() => {})),
    )
  }
}
