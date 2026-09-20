/**
 * Git bundle creation + upload for CCR seed-bundle seeding.
 *
 * Flow:
 *   1. git stash create → bHe R4n `refs/seed/<ts>-<hex>/stash`
 *   2. git bundle create via Hu (heads/tags + seed stash)
 *   3. Upload to /v1/files
 *   4. Cleanup this-run R4n refs
 *   5. Caller sets seed_bundle_file_id on SessionContext
 */

import { randomBytes } from 'crypto'
import { stat, unlink } from 'fs/promises'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { type FilesApiConfig, uploadFile } from '../../services/api/filesApi.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { findGitRoot } from '../git.js'
import { generateTempFilePath } from '../tempfile.js'
import {
  clipSeedGitError,
  sanitizeSeedDisplay,
  truncateSeedDisplay,
} from './seedDisplay.js'
import { formatSeedAdminFail, makeSeedAdminDir } from './seedGitAdmin.js'
import {
  refuseSeedHomeRoot,
  SEED_HOME_ROOT_ERROR,
  type SeedHomeRootAnchors,
} from './seedGitHomeRoot.js'
import {
  formatSeedSteerRefuse,
  refuseSeedSteerEnv,
  SEED_STEER_KEYS,
} from './seedGitSteer.js'
import { runSeedGit, type SeedHardenedLayout } from './seedGitHardened.js'
import {
  bindSeedAdminDir,
  probeSeedGitLayout,
  type SeedGitLayout,
} from './seedGitLayout.js'
import {
  formatSeedListingRefuse,
  shouldRunSeedListingGate,
} from './seedPathClassify.js'
import { buildSeedWipCommit } from './seedWipWriteTree.js'
import {
  bundleHeadsRefuse,
  classifySeedShallow,
  configListsPartialClone,
  formatSeedRelabelFail,
  gitSupportsPartialCloneBundle,
  makePrivateBundleFile,
  readSeedBundleFile,
  relabelSeedBundle,
  reviewBundleHeads,
  SEED_PARTIAL_CLONE_OLD_GIT,
  SEED_SHALLOW_NOTE,
  SEED_STAMP_DRIFT_ERROR,
  seedBundleTmpDir,
  seedLayoutStampOk,
  washSeedStderr,
} from './seedGitBundleUxo.js'

/** densable TCt `yCt` — `cYn` / admin fail share 300. */
const SEED_YCT = 300

/**
 * densable `cYn` @215272670 — log raw `slice(0,200)`; user text
 * `bp($l(Bc(e.trim())), yCt)`.
 */
export function seedTempRefFail(stderr: string): {
  error: string
  failReason: 'git_error'
} {
  logForDebugging(
    `[gitBundle] could not update a temporary seed ref: ${stderr.slice(0, 200)}`,
  )
  const shown = truncateSeedDisplay(
    sanitizeSeedDisplay(washSeedStderr(stderr.trim())),
    SEED_YCT,
  )
  return {
    error: `Could not write the temporary ref this upload uses under .git/refs/seed (${shown}). If another git process is running here, let it finish; otherwise remove any stale refs/seed entries or .lock files in the git directory, then retry.`,
    failReason: 'git_error',
  }
}

/** densable `TXo` — `outcome: seed_ref_held`. Local has no `J()` host. */
function seedTempRefHeld(stderr: string): BundleUploadResult {
  const n = seedTempRefFail(stderr)
  logEvent('tengu_ccr_bundle_upload', {
    outcome:
      'seed_ref_held' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return { success: false, ...n }
}

// Tunable via tengu_ccr_bundle_max_bytes.
const DEFAULT_BUNDLE_MAX_BYTES = 100 * 1024 * 1024

/** densable TCt `nQ` / `rQ` / `mCt`. */
const SEED_STASH_REF = 'refs/seed/stash'
const SEED_ROOT_REF = 'refs/seed/root'
const SEED_REF_PREFIX = 'refs/seed/'
/** densable `G3o` + `W3o=7200000` for `A4n`. */
const SEED_NAMED_REF = /^refs\/seed\/(\d+)-[0-9a-f]{16}\/(?:stash|root)$/
const SEED_NAMED_AGE_MS = 7200000

type SeedNamedRefs = { stash: string; root: string }

/** densable `R4n` — `F3o` is `crypto.randomBytes`. */
function makeSeedNamedRefs(now = Date.now()): SeedNamedRefs {
  const stamp = `${now}-${randomBytes(8).toString('hex')}`
  return {
    stash: `${SEED_REF_PREFIX}${stamp}/stash`,
    root: `${SEED_REF_PREFIX}${stamp}/root`,
  }
}

/** densable TCt `Hu` opts — `{hardened:i,layout:h,...i&&{signal:f}}`. */
type SeedHuOpts = {
  hardened: boolean
  layout?: SeedHardenedLayout
  signal?: AbortSignal
  input?: string
}

/**
 * densable TCt `Hu` = `_583` `V`/`IJb` (`runSeedGit`).
 * `i===true` is the hardened arm (`runSeedGitHardened`).
 * `i===false` is official `!hardened`: Fe-only, cwd=`e`, no `$r`/`Mr`.
 */
function runTCtHu(gitRoot: string, args: string[], opts: SeedHuOpts) {
  return runSeedGit(gitRoot, args, {
    hardened: opts.hardened,
    layout: opts.layout,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  })
}

/** densable `bHe` @215272211 — `Hu(...,["update-ref","--no-deref",...])`. */
function runTCtBhe(gitRoot: string, args: string[], opts: SeedHuOpts) {
  return runTCtHu(gitRoot, ['update-ref', '--no-deref', ...args], opts)
}

/**
 * densable TCt mid-sweep after X4n bind @215262838.
 * `Hu` `for-each-ref refs/seed/` + `A4n` @215232065 + `bHe` `-d` @215263301.
 * `JS`/`eo` before `-d`. `Cn` dedupe skipped — extra `-d` is harmless.
 * List fail still `-d` `nQ`+`rQ`.
 */
async function sweepStaleSeedRefs(
  gitRoot: string,
  opts: SeedHuOpts,
  thisRun: string[],
): Promise<'aborted' | 'stamp' | undefined> {
  const listed = await runTCtHu(
    gitRoot,
    ['for-each-ref', '--format=%(refname)', 'refs/seed/'],
    opts,
  )
  if (opts.hardened && opts.signal?.aborted === true) return 'aborted'
  if (listed.code !== 0) {
    logForDebugging(
      `[gitBundle] could not list refs/seed/ (${listed.code}), so private refs a killed build left are not swept this run (the two fixed names still are): ${listed.stderr.slice(0, 200)}`,
    )
  }
  const now = Date.now()
  const extra =
    listed.code === 0
      ? listed.stdout
          .split('\n')
          .filter(name => name !== '')
          .filter(name => {
            if (name === SEED_STASH_REF || name === SEED_ROOT_REF) return true
            const match = SEED_NAMED_REF.exec(name)
            return (
              match !== null &&
              Math.abs(now - Number(match[1])) > SEED_NAMED_AGE_MS
            )
          })
      : []
  if (
    opts.layout !== undefined &&
    !(await seedLayoutStampOk(opts.layout, [...thisRun, ...extra]))
  ) {
    return 'stamp'
  }
  for (const ref of [SEED_STASH_REF, SEED_ROOT_REF, ...extra]) {
    const swept = await runTCtBhe(gitRoot, ['-d', ref], opts)
    if (opts.hardened && opts.signal?.aborted === true) return 'aborted'
    if (swept.code !== 0) {
      logForDebugging(
        `[gitBundle] could not sweep a stale seed ref: ${swept.stderr.slice(0, 200)}`,
      )
    }
  }
}

type BundleScope = 'all' | 'head' | 'squashed'

export type BundleUploadResult =
  | {
      success: true
      fileId: string
      bundleSizeBytes: number
      scope: BundleScope
      hasWip: boolean
    }
  | {
      success: false
      error: string
      failReason?: BundleFailReason
      layoutKind?: string
    }

// densable Jes/x1g failReason set (2.1.212): empty_repo | too_large | git_error |
// no_changes | stash_failed. No 'skipped' — SKIP_REPO_UPLOAD is schema-only.
type BundleFailReason =
  | 'git_error'
  | 'too_large'
  | 'empty_repo'
  | 'no_changes'
  | 'stash_failed'
  | 'uncommitted_credentials'
  | 'git_dir_tampered'
  | 'refused'
  | 'unsupported_layout'

type BundleCreateResult =
  | { ok: true; size: number; scope: BundleScope; path: string }
  | { ok: false; error: string; failReason: BundleFailReason }

/** densable JCu / `oYn` — count-objects via Hu. */
async function countPackStats(
  gitRoot: string,
  opts: SeedHuOpts,
): Promise<{ sizeBytes: number | null; inPackCount: number | null }> {
  const r = await runTCtHu(gitRoot, ['count-objects', '-v'], opts)
  if (r.code !== 0) return { sizeBytes: null, inPackCount: null }
  const n = r.stdout.match(/^size-pack:\s*(\d+)/m)
  const o = r.stdout.match(/^in-pack:\s*(\d+)/m)
  return {
    sizeBytes: n ? Number(n[1]) * 1024 : null,
    inPackCount: o ? Number(o[1]) : null,
  }
}

// densable x1g: Bundle --all → HEAD → squashed-root. HEAD drops side
// branches/tags but keeps full current-branch history. Squashed-root is a
// single commit of HEAD's tree (or the stash tree if WIP exists). When
// baseRef is set (ultrareview merge-base), densable parents the seed commit
// on a commit-tree of baseRef^{tree} so the container can diff against it;
// identical trees → no_changes.
// densable also pre-skips tiers via JCu size-pack:
//   a = forceScope==="squashed"  (ultrareview no_merge_base empty-tree)
//   l = a || size > max → skip --all
//   u = a || size > 3*max → skip HEAD
//   d = (size > 3*max) && (size > 100*max || inPack > 5e6) → too_large before squash
// forceScope only skips --all/HEAD; size gates still decide skipSquash.
async function listShownSeedRefs(
  gitRoot: string,
  layout: SeedHardenedLayout,
  refs: string[],
  signal?: AbortSignal,
): Promise<Map<string, string> | null> {
  if (!(await seedLayoutStampOk(layout, refs))) return null
  const shownOpts: SeedHuOpts = { hardened: true, layout, signal }
  const [listed, head] = await Promise.all([
    runTCtHu(
      gitRoot,
      [
        'for-each-ref',
        '--format=%(objectname) %(refname)',
        'refs/heads/',
        'refs/tags/',
      ],
      shownOpts,
    ),
    runTCtHu(gitRoot, ['rev-parse', '-q', '--verify', 'HEAD'], shownOpts),
  ])
  if (
    listed.code !== 0 ||
    (head.code !== 0 && head.exitCode !== 1) ||
    !(await seedLayoutStampOk(layout, refs))
  ) {
    return null
  }
  const headPair: Array<[string, string]> =
    head.code === 0 ? [['HEAD', head.stdout.trim()]] : []
  return new Map([
    ...listed.stdout.split('\n').flatMap(row => {
      const [oid, name] = row.split(' ')
      return oid === undefined || name === undefined
        ? []
        : ([[name, oid]] as Array<[string, string]>)
    }),
    ...headPair,
  ])
}

/** densable `hXo` — `null` is stamp drift; `undefined` is no HEAD tree. */
async function resolveHardenedHeadTree(
  gitRoot: string,
  layout: SeedHardenedLayout | undefined,
  refs: string[],
  signal?: AbortSignal,
): Promise<string | null | undefined> {
  if (layout === undefined || !(await seedLayoutStampOk(layout, refs))) {
    return null
  }
  const parsed = await runTCtHu(
    gitRoot,
    ['rev-parse', '-q', '--verify', 'HEAD^{tree}'],
    { hardened: true, layout, signal },
  )
  if (!(await seedLayoutStampOk(layout, refs))) return null
  const oid = parsed.stdout.trim()
  return parsed.code === 0 && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(oid)
    ? oid
    : undefined
}

async function _bundleWithFallback(
  gitRoot: string,
  bundlePath: string,
  relabelledPath: string,
  maxBytes: number,
  hasStash: boolean,
  stashCommit: string,
  huOpts: SeedHuOpts,
  seedRefs: SeedNamedRefs,
  headResolves: boolean,
  skipAllRefs: boolean,
  partialClone: boolean,
  baseRef?: string,
  forceScope?: BundleScope | true,
): Promise<BundleCreateResult> {
  // densable uXo: extra `a` is this-run stash; `--` ends rev-list.
  const extra = hasStash ? [seedRefs.stash] : []
  const seedThisRun = [seedRefs.stash, seedRefs.root]
  const stampFail = (): BundleCreateResult => ({
    ok: false,
    error: SEED_STAMP_DRIFT_ERROR,
    failReason: 'git_dir_tampered',
  })
  const mkBundle = (tier: string[]) =>
    runTCtHu(
      gitRoot,
      ['bundle', 'create', bundlePath, ...tier, ...extra, '--'],
      huOpts,
    )

  const finishTier = async (
    scope: BundleScope,
    size: number,
    tier: string[],
    labels: Map<string, string> | null,
    expected: Record<string, string>,
    shown: Map<string, string> | undefined,
  ): Promise<BundleCreateResult | null> => {
    if (size > maxBytes) {
      logForDebugging(
        `[gitBundle] ${scope} bundle is ${(size / 1024 / 1024).toFixed(1)}MB (> ${(maxBytes / 1024 / 1024).toFixed(0)}MB), retrying next tier`,
      )
      return null
    }
    if (
      huOpts.layout !== undefined &&
      !(await seedLayoutStampOk(huOpts.layout, seedThisRun))
    ) {
      return stampFail()
    }
    let path = bundlePath
    let outSize = size
    if (labels !== null) {
      const copied = await relabelSeedBundle(
        bundlePath,
        relabelledPath,
        labels,
        huOpts.signal,
      )
      if (!copied.ok) {
        return {
          ok: false,
          error: formatSeedRelabelFail(copied.error),
          failReason: 'git_error',
        }
      }
      const heads = await runTCtHu(
        gitRoot,
        ['bundle', 'list-heads', relabelledPath],
        huOpts,
      )
      if (heads.code !== 0) {
        return {
          ok: false,
          error: formatSeedRelabelFail(
            `git bundle list-heads exited ${heads.code}: ${clipSeedGitError(heads.stderr, huOpts.hardened)}`,
          ),
          failReason: 'git_error',
        }
      }
      path = relabelledPath
      outSize = copied.sizeBytes
    }
    if (huOpts.hardened) {
      const listed = await runTCtHu(gitRoot, ['bundle', 'list-heads', path], {
        hardened: true,
        layout: huOpts.layout,
        signal: huOpts.signal,
      })
      let check = reviewBundleHeads(
        listed,
        [
          ...tier,
          ...(hasStash && scope !== 'squashed' ? [SEED_STASH_REF] : []),
        ],
        expected,
        shown,
      )
      if (
        shown !== undefined &&
        check.unlisted === undefined &&
        check.missing.length === 0 &&
        check.foreign.length === 0
      ) {
        const oids = listed.stdout.split('\n').flatMap(row => {
          const oid = row.split(' ')[0]
          return oid === undefined || oid === '' ? [] : [oid]
        })
        const held = await runTCtHu(gitRoot, ['cat-file', '--batch-check'], {
          hardened: true,
          layout: huOpts.layout,
          signal: huOpts.signal,
          input: oids.map(oid => `${oid}\n`).join(''),
        })
        check = reviewBundleHeads(
          listed,
          [
            ...tier,
            ...(hasStash && scope !== 'squashed' ? [SEED_STASH_REF] : []),
          ],
          expected,
          shown,
          held,
        )
      }
      const refused = bundleHeadsRefuse(check, huOpts.hardened)
      if (refused !== null) return refused
    }
    if (
      huOpts.layout !== undefined &&
      !(await seedLayoutStampOk(huOpts.layout, seedThisRun))
    ) {
      return stampFail()
    }
    return { ok: true, size: outSize, scope, path }
  }

  const { sizeBytes: packBytes, inPackCount } = await countPackStats(
    gitRoot,
    huOpts,
  )
  const forcedSquash = forceScope === 'squashed'
  const sizeSkipAll = packBytes !== null && packBytes > maxBytes
  const sizeSkipHead = packBytes !== null && packBytes > 3 * maxBytes
  const skipAll = forcedSquash || skipAllRefs || sizeSkipAll
  const skipHead = forcedSquash || sizeSkipHead
  // densable `d` uses size-based `c` only — forceScope does not auto too_large
  const skipSquash =
    sizeSkipHead &&
    ((packBytes !== null && packBytes > 100 * maxBytes) ||
      (inPackCount !== null && inPackCount > 5_000_000))
  if (forcedSquash) {
    logForDebugging(
      '[gitBundle] forceScope=squashed — skipping --all and HEAD tiers',
    )
  } else if (skipAll) {
    logForDebugging(
      `[gitBundle] size-pack ${((packBytes ?? 0) / 1024 / 1024).toFixed(0)}MB > ${(maxBytes / 1024 / 1024).toFixed(0)}MB cap; skipping --all${skipHead ? ' and HEAD' : ''}${skipSquash ? ' and squashed' : ''}`,
    )
  }

  const stashLabels = hasStash
    ? new Map([[seedRefs.stash, SEED_STASH_REF]])
    : null
  const stashExpected: Record<string, string> =
    stashCommit === '' ? {} : { [SEED_STASH_REF]: stashCommit }

  if (!skipAll) {
    const allTier = [
      '--glob=refs/heads/*',
      '--glob=refs/tags/*',
      ...(headResolves ? (['HEAD'] as const) : []),
    ]
    if (huOpts.layout !== undefined) {
      const shown = await listShownSeedRefs(
        gitRoot,
        huOpts.layout,
        seedThisRun,
        huOpts.signal,
      )
      if (shown === null) return stampFail()
      const allResult = await mkBundle(allTier)
      if (
        huOpts.layout !== undefined &&
        !(await seedLayoutStampOk(huOpts.layout, seedThisRun))
      ) {
        return stampFail()
      }
      if (allResult.code !== 0) {
        return {
          ok: false,
          error: `git bundle create --all failed (${allResult.code}): ${clipSeedGitError(allResult.stderr, huOpts.hardened)}`,
          failReason: 'git_error',
        }
      }
      const { size: allSize } = await stat(bundlePath)
      const finished = await finishTier(
        'all',
        allSize,
        allTier,
        stashLabels,
        stashExpected,
        shown,
      )
      if (finished !== null) return finished
    } else {
      const allResult = await mkBundle(allTier)
      if (allResult.code !== 0) {
        return {
          ok: false,
          error: `git bundle create --all failed (${allResult.code}): ${clipSeedGitError(allResult.stderr, huOpts.hardened)}`,
          failReason: 'git_error',
        }
      }
      const { size: allSize } = await stat(bundlePath)
      const finished = await finishTier(
        'all',
        allSize,
        allTier,
        stashLabels,
        stashExpected,
        undefined,
      )
      if (finished !== null) return finished
    }
  }

  if (!skipHead) {
    const shown =
      huOpts.layout === undefined
        ? undefined
        : await listShownSeedRefs(
            gitRoot,
            huOpts.layout,
            seedThisRun,
            huOpts.signal,
          )
    // `shown` is only null when layout is set and the listing failed, so the
    // plain null check matches the --all branch above and narrows for finishTier.
    if (shown === null) return stampFail()
    const headResult = await mkBundle(['HEAD'])
    if (
      huOpts.layout !== undefined &&
      !(await seedLayoutStampOk(huOpts.layout, seedThisRun))
    ) {
      return stampFail()
    }
    if (headResult.code !== 0) {
      return {
        ok: false,
        error: `git bundle create HEAD failed (${headResult.code}): ${clipSeedGitError(headResult.stderr, huOpts.hardened)}`,
        failReason: 'git_error',
      }
    }
    const { size: headSize } = await stat(bundlePath)
    const finished = await finishTier(
      'head',
      headSize,
      ['HEAD'],
      stashLabels,
      stashExpected,
      shown,
    )
    if (finished !== null) return finished
  }

  if (skipSquash) {
    return {
      ok: false,
      error:
        'Repo is too large to bundle. Please setup GitHub on https://claude.ai/code',
      failReason: 'too_large',
    }
  }

  // Last resort: squash to a single commit. Uses the stash tree when WIP
  // exists (bakes uncommitted changes in — can't bundle the stash ref
  // separately since its parents would drag history back). densable x1g:
  // optional baseRef parent via seed-base commit-tree.
  let squashedTree: string | undefined
  if (huOpts.hardened && !hasStash) {
    const tree = await resolveHardenedHeadTree(
      gitRoot,
      huOpts.layout,
      seedThisRun,
      huOpts.signal,
    )
    if (tree === null) return stampFail()
    if (tree === undefined) {
      return {
        ok: false,
        error: 'git rev-parse HEAD^{tree} failed: HEAD names no commit',
        failReason: 'git_error',
      }
    }
    squashedTree = tree
  }
  const treeRef = hasStash
    ? `${stashCommit !== '' ? stashCommit : seedRefs.stash}^{tree}`
    : (squashedTree ?? 'HEAD^{tree}')
  const parentArgs: string[] = []
  if (baseRef) {
    const [headTree, baseTree] = await Promise.all(
      [treeRef, `${baseRef}^{tree}`].map(ref =>
        runTCtHu(gitRoot, ['rev-parse', ref], huOpts),
      ),
    )
    if (
      headTree.code === 0 &&
      baseTree.code === 0 &&
      headTree.stdout.trim() === baseTree.stdout.trim()
    ) {
      return {
        ok: false,
        error:
          "It doesn't look like you have any new commits or changes to review. Stage or commit them first?",
        failReason: 'no_changes',
      }
    }
    const baseCommit = await runTCtHu(
      gitRoot,
      ['commit-tree', `${baseRef}^{tree}`, '-m', 'seed-base'],
      huOpts,
    )
    if (baseCommit.code === 0) {
      parentArgs.push('-p', baseCommit.stdout.trim())
    } else {
      logForDebugging(
        `[gitBundle] baseRef commit-tree failed (${baseCommit.code}), squashing without parent: ${clipSeedGitError(baseCommit.stderr, huOpts.hardened)}`,
      )
    }
  }
  const commitTree = await runTCtHu(
    gitRoot,
    ['commit-tree', treeRef, ...parentArgs, '-m', 'seed'],
    huOpts,
  )
  if (commitTree.code !== 0) {
    return {
      ok: false,
      error: `git commit-tree failed (${commitTree.code}): ${clipSeedGitError(commitTree.stderr, huOpts.hardened)}`,
      failReason: 'git_error',
    }
  }
  const squashedSha = commitTree.stdout.trim()
  if (
    huOpts.layout !== undefined &&
    !(await seedLayoutStampOk(huOpts.layout, seedThisRun))
  ) {
    return stampFail()
  }
  await runTCtBhe(gitRoot, [seedRefs.root, squashedSha], huOpts)
  const squashResult = await mkBundle([seedRefs.root])
  if (
    huOpts.layout !== undefined &&
    !(await seedLayoutStampOk(huOpts.layout, seedThisRun))
  ) {
    return stampFail()
  }
  if (squashResult.code !== 0) {
    return {
      ok: false,
      error: partialClone
        ? `This partial clone does not hold every file of its working tree locally (a sparse checkout, or blobs never downloaded), so it cannot be uploaded without fetching from its remote, which the upload does not do. Start the cloud session from the repository's GitHub source instead. (git: ${clipSeedGitError(squashResult.stderr, huOpts.hardened)})`
        : `git bundle create ${seedRefs.root} failed (${squashResult.code}): ${clipSeedGitError(squashResult.stderr, huOpts.hardened)}`,
      failReason: 'git_error',
    }
  }
  const { size: squashSize } = await stat(bundlePath)
  const finished = await finishTier(
    'squashed',
    squashSize,
    [SEED_ROOT_REF],
    new Map([[seedRefs.root, SEED_ROOT_REF]]),
    { [SEED_ROOT_REF]: squashedSha },
    new Map(),
  )
  if (finished !== null) return finished

  return {
    ok: false,
    error:
      'Repo is too large to bundle. Please setup GitHub on https://claude.ai/code',
    failReason: 'too_large',
  }
}

// Bundle the repo and upload to Files API; return file_id for
// seed_bundle_file_id. --all → HEAD → squashed-root fallback chain.
// Tracked WIP via stash create → refs/seed/stash (or baked into the
// squashed tree); untracked not captured.
// densable Jes opts: { cwd, signal, baseRef, forceScope } — baseRef is
// ultrareview merge-base / EMPTY_TREE_SHA; forceScope:"squashed" for
// no_merge_base empty-tree fallback (skip --all/HEAD tiers).
export async function createAndUploadGitBundle(
  config: FilesApiConfig,
  opts?: {
    cwd?: string
    signal?: AbortSignal
    baseRef?: string
    forceScope?: BundleScope
    /** densable TCt `hardenForDeviceSessions` — forces eYn listing gate. */
    hardenForDeviceSessions?: boolean
    /** densable TCt `rootAnchors` for `J4n`. */
    rootAnchors?: SeedHomeRootAnchors
  },
): Promise<BundleUploadResult> {
  // CLAUDE_CODE_SKIP_REPO_UPLOAD is densable-only (2.1.207 schema export, no
  // product consumer). Do not short-circuit upload here.

  const workdir = opts?.cwd ?? getCwd()
  const gitRoot = findGitRoot(workdir)
  if (!gitRoot) {
    return { success: false, error: 'Not in a git repository' }
  }

  const homeRoot = refuseSeedHomeRoot(gitRoot, opts?.rootAnchors)
  if (homeRoot !== null) {
    logEvent('tengu_ccr_bundle_upload', {
      outcome:
        'refused_home_root' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      root_kind:
        homeRoot as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      success: false,
      error: SEED_HOME_ROOT_ERROR[homeRoot],
      failReason: 'git_dir_tampered',
    }
  }

  // densable TCt `c=R4n()`, `u=[c.stash,c.root]` — before K4n / sweep.
  const seedRefs = makeSeedNamedRefs()
  const seedThisRun = [seedRefs.stash, seedRefs.root]

  // densable TCt: `i` then `g=K4n`, `h=g?.layout`, `P=h?eYn:tYn`.
  // `await using T` — X4n lives until this function returns.
  const harden = shouldRunSeedListingGate(opts?.hardenForDeviceSessions)
  const budget = harden ? AbortSignal.timeout(180000) : undefined
  const signal =
    budget === undefined
      ? opts?.signal
      : opts?.signal === undefined
        ? budget
        : AbortSignal.any([opts.signal, budget])
  const abortedUpload = (): BundleUploadResult => {
    if (opts?.signal?.aborted === true || budget?.aborted !== true) {
      return { success: false, error: 'Bundle cancelled' }
    }
    return {
      success: false,
      error:
        'Preparing the upload took too long and was stopped (a file in this checkout that git reads, such as a .gitattributes, may be a pipe or otherwise blocking). Check the checkout, then retry.',
    }
  }
  const stampDriftUpload = (): BundleUploadResult => {
    logForDebugging(`[gitBundle] ${SEED_STAMP_DRIFT_ERROR}`)
    logEvent('tengu_ccr_bundle_upload', {
      outcome:
        'git_dir_tampered' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      tampered_on:
        'mid_build' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      success: false,
      error: SEED_STAMP_DRIFT_ERROR,
      failReason: 'git_dir_tampered',
    }
  }
  let wipStashSha = ''
  let admin: Awaited<ReturnType<typeof makeSeedAdminDir>> | undefined
  let seedLayout: SeedGitLayout | undefined
  let partialClone = false
  try {
    if (harden) {
      const layout = await probeSeedGitLayout(gitRoot, signal, {
        linkedTrees: opts?.hardenForDeviceSessions === true,
      })
      if (signal?.aborted) return abortedUpload()
      if (layout.kind === 'tampered') {
        logForDebugging(
          `[gitBundle] Refusing to bundle: misplaced ${layout.misplaced}`,
        )
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'git_dir_tampered' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          tampered_on:
            layout.misplaced as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          success: false,
          error:
            'Could not read where git keeps this checkout (git rev-parse did not name its git directory), so nothing was uploaded. Check `git status` here, then retry.',
          failReason: 'git_dir_tampered',
        }
      }
      if (layout.kind === 'failed') {
        const gitMissing = layout.why === 'git_not_found'
        logForDebugging(
          `[gitBundle] could not read the checkout's git layout: ${layout.detail.slice(0, 200)}`,
        )
        logEvent('tengu_ccr_bundle_upload', {
          outcome: (gitMissing
            ? 'git_not_on_path'
            : 'wip_unreadable') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          success: false,
          error: gitMissing
            ? 'git was not found on the PATH this process was started with, so nothing was uploaded. Install git, or put its directory on PATH, then retry.'
            : 'Could not read where git keeps this checkout (git rev-parse did not name its git directory), so nothing was uploaded. Check `git status` here, then retry.',
          failReason: 'git_error',
        }
      }
      // densable TCt `h=g?.layout`; `JS(h,u)` then `wXo`/`vXo` before pXo.
      let gated = layout.layout
      seedLayout = gated
      if (!(await seedLayoutStampOk(gated, seedThisRun))) {
        return stampDriftUpload()
      }
      const listedConfig = await runTCtHu(gitRoot, ['config', '-z', '--list'], {
        hardened: true,
        layout: gated,
        signal,
      })
      if (harden && signal?.aborted) return abortedUpload()
      partialClone =
        listedConfig.code !== 0 || configListsPartialClone(listedConfig.stdout)
      if (partialClone) {
        const version = await runTCtHu(gitRoot, ['version'], {
          hardened: true,
          layout: gated,
          signal,
        })
        if (harden && signal?.aborted) return abortedUpload()
        if (!gitSupportsPartialCloneBundle(version.stdout)) {
          logEvent('tengu_ccr_bundle_upload', {
            outcome:
              'partial_clone_old_git' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          if (opts?.hardenForDeviceSessions === true) {
            return {
              success: false,
              error: SEED_PARTIAL_CLONE_OLD_GIT,
              failReason: 'refused',
            }
          }
          return {
            success: false,
            error: SEED_PARTIAL_CLONE_OLD_GIT,
            failReason: 'unsupported_layout',
            layoutKind: 'partial_clone_old_git',
          }
        }
        logForDebugging(
          '[gitBundle] partial clone — bundling a snapshot of the working tree, without history',
        )
      }
      if (opts?.hardenForDeviceSessions === true) {
        const steered = refuseSeedSteerEnv(seedLayout)
        if (steered !== null) {
          logEvent('tengu_ccr_bundle_upload', {
            outcome:
              'admin_dir_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            steering:
              steered.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            steered_by: (steered.kind === 'unreadable'
              ? undefined
              : SEED_STEER_KEYS.find(
                  key => key === steered.name.toUpperCase(),
                )) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return {
            success: false,
            error: formatSeedSteerRefuse(steered),
            failReason: 'refused',
          }
        }
      }
      admin =
        opts?.hardenForDeviceSessions === true
          ? await makeSeedAdminDir(gitRoot, gated, gated.run, signal)
          : undefined
      if (admin?.kind === 'failed') {
        if (signal?.aborted) return abortedUpload()
        logForDebugging(
          `[gitBundle] could not set up the private git dir: ${admin.detail.slice(0, 200)}`,
        )
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'admin_dir_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          success: false,
          error: formatSeedAdminFail(admin.detail, admin.reason),
          failReason: 'refused',
        }
      }
      if (admin?.kind === 'made') {
        gated = bindSeedAdminDir(gitRoot, gated, admin.path, signal)
        seedLayout = gated
      }
    }

    // densable TCt after X4n bind @215262838 — Hu/A4n/bHe even when i===false.
    const huOpts: SeedHuOpts = {
      hardened: harden,
      layout: seedLayout,
      ...(harden ? { signal } : {}),
    }
    const swept = await sweepStaleSeedRefs(gitRoot, huOpts, seedThisRun)
    if (swept === 'aborted') return abortedUpload()
    if (swept === 'stamp') return stampDriftUpload()

    // densable TCt after sweep @215263481 — Hu HEAD + refs/heads|tags.
    const headResolves =
      (
        await runTCtHu(
          gitRoot,
          ['rev-parse', '--verify', '--quiet', 'HEAD'],
          huOpts,
        )
      ).code === 0
    if (harden && signal?.aborted) return abortedUpload()
    const listedRefs = await runTCtHu(
      gitRoot,
      ['for-each-ref', '--count=1', 'refs/heads/', 'refs/tags/'],
      huOpts,
    )
    if (harden && signal?.aborted) return abortedUpload()
    if (
      listedRefs.code === 0 &&
      listedRefs.stdout.trim() === '' &&
      !headResolves
    ) {
      logEvent('tengu_ccr_bundle_upload', {
        outcome:
          'empty_repo' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        success: false,
        error:
          'Repository has no local branch, tag, or checkout to seed from yet',
        failReason: 'empty_repo',
      }
    }

    if (seedLayout !== undefined) {
      const built = await buildSeedWipCommit(gitRoot, seedLayout, {
        signal,
        leaveOutUncommittedCredentialFiles: true,
        maxStagedBytes: 2 * DEFAULT_BUNDLE_MAX_BYTES,
      })
      if (built.kind === 'refused') {
        const error = formatSeedListingRefuse(built.refused)
        logForDebugging(
          `[gitBundle] Refusing to stash: ${built.refused.length} forged path(s), or credential-named path(s) that reached a built tree`,
        )
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'uncommitted_credentials' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          credential_paths: built.refused.length,
          refused_on:
            built.decidedOn as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return { success: false, error, failReason: 'uncommitted_credentials' }
      }
      if (built.kind === 'failed' && built.step === 'path-encoding') {
        const error =
          'A changed file in this checkout has a name — or a changed symbolic link a target — that is not valid UTF-8, which this upload cannot carry yet. Commit or rename it, then retry.'
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'wip_path_encoding' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return { success: false, error, failReason: 'stash_failed' }
      }
      if (built.kind === 'failed') {
        logForDebugging(
          `[gitBundle] could not capture uncommitted changes (git ${built.step}): ${built.detail.slice(0, 200)}`,
        )
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'stash_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          wip_step:
            built.step as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          success: false,
          error: `Could not capture uncommitted changes (git ${built.step}: ${built.detail}). Run \`git add .\` or commit, then retry.`,
          failReason: 'stash_failed',
        }
      }
      if (built.kind === 'created') {
        wipStashSha = built.commit
        logForDebugging(`[gitBundle] Captured WIP as stash ${wipStashSha}`)
        if (!(await seedLayoutStampOk(seedLayout, seedThisRun))) {
          return stampDriftUpload()
        }
        const pointed = await runTCtBhe(
          gitRoot,
          [seedRefs.stash, wipStashSha],
          huOpts,
        )
        if (harden && signal?.aborted) return abortedUpload()
        if (pointed.code !== 0) {
          return signal?.aborted === true
            ? abortedUpload()
            : seedTempRefHeld(pointed.stderr)
        }
      }
    }

    // densable tYn / `ys` — Hu stash create `{hardened:!1,signal}`.
    if (!harden) {
      const stashResult = await runTCtHu(gitRoot, ['stash', 'create'], {
        hardened: false,
        signal,
      })
      if (stashResult.code === 0) {
        wipStashSha = stashResult.stdout.trim()
      } else if (stashResult.stderr.trim() === '') {
        logForDebugging(
          `[gitBundle] git stash create exited ${stashResult.code} with no output — treating as no uncommitted changes`,
        )
      } else if (headResolves) {
        const detail = stashResult.stderr.trim().slice(0, 200)
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'stash_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          success: false,
          error: `Could not capture uncommitted changes (git stash create: ${detail || 'unknown error'}). Run \`git add .\` or commit, then retry.`,
          failReason: 'stash_failed',
        }
      }
      if (wipStashSha !== '') {
        logForDebugging(`[gitBundle] Captured WIP as stash ${wipStashSha}`)
        const pointed = await runTCtBhe(
          gitRoot,
          [seedRefs.stash, wipStashSha],
          huOpts,
        )
        if (pointed.code !== 0) {
          return signal?.aborted === true
            ? abortedUpload()
            : seedTempRefHeld(pointed.stderr)
        }
      }
    }
    const hasWip = wipStashSha !== ''

    // densable TCt: `F=i?"":H4n`; `i` → T4n("claude-seed", Z4n()).
    let privateBundle:
      | Awaited<ReturnType<typeof makePrivateBundleFile>>
      | undefined
    let bundlePath = harden ? '' : generateTempFilePath('ccr-seed', '.bundle')

    // git leaves a partial file on nonzero exit (e.g. empty-repo 128).
    try {
      if (harden) {
        try {
          privateBundle = await makePrivateBundleFile(
            'claude-seed',
            seedBundleTmpDir(),
          )
        } catch (err) {
          logForDebugging(
            `[gitBundle] no private bundle directory: ${err instanceof Error ? err.message : String(err)}`,
          )
          logEvent('tengu_ccr_bundle_upload', {
            outcome:
              'git_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return {
            success: false,
            error: 'Could not create a private directory for the bundle.',
            failReason: 'git_error',
          }
        }
        bundlePath = privateBundle.path
      }
      const relabelledPath = `${bundlePath}.relabelled`
      const maxBytes =
        getFeatureValue_CACHED_MAY_BE_STALE<number | null>(
          'tengu_ccr_bundle_max_bytes',
          null,
        ) ?? DEFAULT_BUNDLE_MAX_BYTES

      const shallow = await classifySeedShallow(gitRoot, args =>
        runTCtHu(gitRoot, args, {
          hardened: seedLayout !== undefined,
          layout: seedLayout,
          signal,
        }),
      )
      if (shallow !== 'not_shallow') {
        logForDebugging(
          `[gitBundle] shallow repository: ${SEED_SHALLOW_NOTE[shallow]}`,
        )
      }
      if (shallow === 'unborn_cut') {
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'empty_repo' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          success: false,
          error: SEED_SHALLOW_NOTE.unborn_cut,
          failReason: 'empty_repo',
        }
      }

      const bundle = await _bundleWithFallback(
        gitRoot,
        bundlePath,
        relabelledPath,
        maxBytes,
        hasWip,
        wipStashSha,
        huOpts,
        seedRefs,
        headResolves,
        shallow === 'complete' || shallow === 'cut',
        partialClone,
        opts?.baseRef,
        partialClone || (shallow === 'cut' ? 'squashed' : opts?.forceScope),
      )

      if (!bundle.ok) {
        const failedBundle = bundle as {
          ok: false
          error: string
          failReason: BundleFailReason
        }
        logForDebugging(`[gitBundle] ${failedBundle.error}`)
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            failedBundle.failReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          max_bytes: maxBytes,
        })
        return {
          success: false,
          error: failedBundle.error,
          failReason: failedBundle.failReason,
        }
      }

      let uploadContent: Buffer | undefined
      if (harden) {
        const readBack = await readSeedBundleFile(bundle.path, maxBytes)
        if (readBack.kind !== 'read') {
          const detail =
            readBack.kind === 'too_large'
              ? `bundle grew to ${readBack.sizeBytes} bytes`
              : readBack.detail
          logForDebugging(
            `[gitBundle] bundle unreadable after create: ${detail}`,
          )
          logEvent('tengu_ccr_bundle_upload', {
            outcome:
              'git_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            max_bytes: maxBytes,
          })
          return {
            success: false,
            error: `The bundle could not be read back for upload (${clipSeedGitError(detail, true)}).`,
            failReason: 'git_error',
          }
        }
        uploadContent = readBack.content
      }

      // Fixed relativePath so CCR can locate it.
      const upload = await uploadFile(
        bundle.path,
        '_source_seed.bundle',
        config,
        {
          signal,
          ...(uploadContent !== undefined ? { content: uploadContent } : {}),
        },
      )

      if (!upload.success) {
        logEvent('tengu_ccr_bundle_upload', {
          outcome:
            'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          success: false,
          error: (upload as { success: false; error: string }).error,
        }
      }

      logForDebugging(
        `[gitBundle] Uploaded ${upload.size} bytes as file_id ${upload.fileId}`,
      )
      logEvent('tengu_ccr_bundle_upload', {
        outcome:
          'success' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        size_bytes: upload.size,
        scope:
          bundle.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        has_wip: hasWip,
      })
      return {
        success: true,
        fileId: upload.fileId,
        bundleSizeBytes: upload.size,
        scope: bundle.scope,
        hasWip,
      }
    } finally {
      if (bundlePath !== '') {
        try {
          await unlink(bundlePath)
        } catch {
          logForDebugging(
            `[gitBundle] Could not delete ${bundlePath} (non-fatal)`,
          )
        }
        await unlink(`${bundlePath}.lock`).catch(() => {})
        await unlink(`${bundlePath}.relabelled`).catch(() => {})
      }
      await privateBundle?.dispose()
      if (
        seedLayout === undefined ||
        (await seedLayoutStampOk(seedLayout, seedThisRun))
      ) {
        for (const ref of seedThisRun) {
          const cleared = await runTCtBhe(gitRoot, ['-d', ref], {
            hardened: harden,
            layout: seedLayout,
          })
          if (cleared.code !== 0) {
            logForDebugging(
              `[gitBundle] could not sweep a stale seed ref: ${cleared.stderr.slice(0, 200)}`,
            )
          }
        }
      }
    }
  } finally {
    if (admin?.kind === 'made') await admin.dispose()
  }
}
