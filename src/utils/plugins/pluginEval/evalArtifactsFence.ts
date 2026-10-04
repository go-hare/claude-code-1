/**
 * densable `dc` @212339424 — refuse a run that planted `.eval-artifacts/`
 * in cwd (reserved for stub publishes). Empty 0-byte file is a placeholder.
 * densable `Ar`/`sg`/`Yi(stub-publishes)` — merge granted stub listings
 * into cwdDiff as `.eval-artifacts/${q}`. densable `nf`/`wp` fold is
 * `foldEvalStubPublishes`.
 */
import { join, relative, sep } from 'path'
import { lstat, readFile, readdir, rm, stat } from 'fs/promises'
import { logForDebugging } from '../../debug.js'
import { getErrnoCode } from '../../errors.js'
import { EVAL_ARTIFACTS_DIR } from './constants.js'
import {
  EVAL_STUB_ARTIFACT_URL_PREFIX,
  EVAL_STUB_SLUG_RE,
} from './evalPublishTrace.js'
import { PluginEvalPathError } from './pathVet.js'
import type { EvalSandbox } from './types.js'

/** densable `Ar`. */
export const EVAL_STUB_PUBLISHES = 'stub-publishes'

export function evalStubPublishDir(sandbox: EvalSandbox): string {
  return join(sandbox.outDir, EVAL_STUB_PUBLISHES)
}

const STUB_DIR_UNREADABLE = 'eval stub publish staging dir unreadable'
const STUB_DIR_REPLACED = 'eval run directory replaced'

export const PLANTED_EVAL_ARTIFACTS = `the run created ${EVAL_ARTIFACTS_DIR}/ in its working directory — that name is reserved for the run's artifact publishes, so its file evidence cannot be trusted`

export const PLANTED_EVAL_ARTIFACTS_SCAFFOLD = `the case's scaffold created ${EVAL_ARTIFACTS_DIR}/ in the run's working directory — that name is reserved for the run's artifact publishes; have the scaffold use another name`

export type EvalArtifactsPhase = 'run' | 'scaffold'

/**
 * densable `dc(cwd, snapshot, phase)`. Placeholder drop is run-only.
 */
export async function cwdPlantedEvalArtifacts(
  cwd: string,
  snapshot: Set<string>,
  phase: EvalArtifactsPhase = 'run',
): Promise<boolean> {
  const reserved = EVAL_ARTIFACTS_DIR.toLowerCase()
  const occupant = await stat(join(cwd, EVAL_ARTIFACTS_DIR)).then(
    st =>
      phase === 'run' && st.isFile() && st.size === 0
        ? 'placeholder'
        : 'present',
    error => {
      if (getErrnoCode(error) === 'ENOENT') return 'absent' as const
      logForDebugging(
        `eval: cannot examine the reserved publish name in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' },
      )
      throw new PluginEvalPathError(
        `the reserved ${EVAL_ARTIFACTS_DIR} name in the run's working directory could not be examined (${getErrnoCode(error) ?? 'unknown error'}), so its file evidence cannot be trusted`,
        'eval reserved publish name unreadable',
      )
    },
  )
  if (occupant === 'placeholder') snapshot.delete(EVAL_ARTIFACTS_DIR)
  for (const path of snapshot) {
    // gold `et(path, "/")` — first non-empty segment, not basename
    const first = path
      .toLowerCase()
      .replaceAll('\\', '/')
      .split('/')
      .find(part => part !== '')
    if (first === reserved) return true
  }
  return occupant === 'present'
}

/**
 * densable mc `if(r.granted){ Ee=Ar(b); Nr then Yi; me.add(jt/q) }`.
 * ENOENT skips. Other lstat errors / symlink / realpath drift throw.
 */
export async function addStubPublishListings(
  snapshot: Set<string>,
  stubDir: string,
): Promise<void> {
  const st = await lstat(stubDir).catch(error => {
    if (getErrnoCode(error) === 'ENOENT') return null
    logForDebugging(
      `eval: cannot examine ${stubDir}: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    throw new PluginEvalPathError(
      `the run's artifact-publish staging directory could not be examined (${getErrnoCode(error) ?? 'unknown error'}), so its file evidence cannot be trusted`,
      STUB_DIR_UNREADABLE,
    )
  })
  if (st === null) return
  // gold Yi: !isDirectory || isSymbolicLink || pc(e)!==e. Darwin /tmp is a
  // hop (/private/tmp); leaf symlink replacement is the TOCTOU we keep.
  if (!st.isDirectory() || st.isSymbolicLink()) {
    throw new PluginEvalPathError(
      'the run directory (or a directory inside it) is no longer the one the harness listed, or cannot be listed — moved, removed, replaced by a link, made unreadable, or too deep or too large to walk — so its file evidence cannot be trusted',
      STUB_DIR_REPLACED,
    )
  }
  let entries: Array<{
    name: string
    isFile: () => boolean
    parentPath?: string
  }>
  try {
    entries = await readdir(stubDir, { recursive: true, withFileTypes: true })
  } catch {
    throw new PluginEvalPathError(
      'the run directory (or a directory inside it) is no longer the one the harness listed, or cannot be listed — moved, removed, replaced by a link, made unreadable, or too deep or too large to walk — so its file evidence cannot be trusted',
      STUB_DIR_REPLACED,
    )
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const parent = 'parentPath' in entry ? String(entry.parentPath) : stubDir
    const rel = relative(stubDir, `${parent}${sep}${entry.name}`).replaceAll(
      '\\',
      '/',
    )
    snapshot.add(`${EVAL_ARTIFACTS_DIR}/${rel}`)
  }
}

export type FoldedStubPublish = {
  url: string
  slug: string
  env: 'stub'
  payloadDir: string
}

const STUB_DIR_MISSING = 'eval: stub publish staging dir missing'
const STUB_DIR_REPLACED_FOLD = 'eval: stub publish staging dir replaced'
const STUB_DIR_CHANGED = 'eval: stub publish staging dir changed'
const STUB_PAYLOAD_MISSING = 'eval: stub publish payload missing'
const STUB_MANIFEST_UNREADABLE = 'eval: stub publish manifest unreadable'
const STUB_MANIFEST_INVALID = 'eval: stub publish manifest invalid'

async function discardStubDir(stubDir: string): Promise<void> {
  await rm(stubDir, { recursive: true, force: true }).catch(() => {})
}

/**
 * densable `nf`/`wp` reduced — index corroborated slug dirs under stub-publishes.
 * ENOENT + empty set → []. ENOENT + nonempty throws. Non-dir/symlink discards
 * the staging dir then throws. Leftover entries are deleted. TOCTOU ino/dev.
 */
export async function foldEvalStubPublishes(
  sandbox: EvalSandbox,
  corroboratedSlugs: Set<string>,
): Promise<FoldedStubPublish[]> {
  const stubDir = evalStubPublishDir(sandbox)
  const first = await lstat(stubDir).catch(error => {
    if (getErrnoCode(error) === 'ENOENT') {
      if (corroboratedSlugs.size === 0) return null
      throw new PluginEvalPathError(
        `the run's artifact-publish staging directory is gone although the run published (${corroboratedSlugs.size} corroborated) — its publishes cannot be vouched for`,
        STUB_DIR_MISSING,
      )
    }
    logForDebugging(
      `eval: cannot examine ${stubDir}: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    throw new PluginEvalPathError(
      `the run's artifact-publish staging directory could not be examined (${getErrnoCode(error) ?? 'unknown error'})`,
      STUB_DIR_UNREADABLE,
    )
  })
  if (first === null) return []
  if (!first.isDirectory() || first.isSymbolicLink()) {
    await discardStubDir(stubDir)
    throw new PluginEvalPathError(
      "the run's artifact-publish staging directory was replaced by something that is not a directory, so its publishes (and their absence) cannot be trusted — discarded, and the run is an error",
      STUB_DIR_REPLACED_FOLD,
    )
  }
  let names: string[]
  try {
    names = await readdir(stubDir)
  } catch (error) {
    logForDebugging(
      `eval: cannot read stub publish dir ${stubDir}: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    throw new PluginEvalPathError(
      `the stub publish directory could not be read (${getErrnoCode(error) ?? 'unknown error'})`,
      'eval: stub publish dir unreadable',
    )
  }
  const after = await lstat(stubDir).catch(() => null)
  if (
    after === null ||
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.ino !== first.ino ||
    after.dev !== first.dev
  ) {
    throw new PluginEvalPathError(
      "the run's artifact-publish staging directory changed while it was being indexed",
      STUB_DIR_CHANGED,
    )
  }
  const matched = names.filter(
    name => EVAL_STUB_SLUG_RE.test(name) && corroboratedSlugs.has(name),
  )
  if (matched.length < corroboratedSlugs.size) {
    throw new PluginEvalPathError(
      `a corroborated artifact publish is missing from the staging directory (${corroboratedSlugs.size - matched.length} of ${corroboratedSlugs.size})`,
      STUB_PAYLOAD_MISSING,
    )
  }
  const leftover = names.filter(name => !matched.includes(name))
  for (const name of leftover) {
    await rm(join(stubDir, name), { recursive: true, force: true })
  }
  const out: Array<FoldedStubPublish & { at: number }> = []
  for (const slug of matched) {
    const payloadDir = join(stubDir, slug)
    const manifestPath = join(payloadDir, 'manifest.json')
    const payload = await lstat(payloadDir).catch(() => null)
    const manifest = await lstat(manifestPath).catch(() => null)
    if (
      payload === null ||
      !payload.isDirectory() ||
      payload.isSymbolicLink() ||
      manifest === null ||
      !manifest.isFile()
    ) {
      throw new PluginEvalPathError(
        "a corroborated artifact publish's payload is not a real directory holding a regular manifest (or is over 2097152 bytes)",
        STUB_MANIFEST_UNREADABLE,
      )
    }
    let raw: string
    try {
      raw = await readFile(manifestPath, 'utf8')
    } catch {
      throw new PluginEvalPathError(
        "a corroborated artifact publish's payload is not a real directory holding a regular manifest (or is over 2097152 bytes)",
        STUB_MANIFEST_UNREADABLE,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new PluginEvalPathError(
        "a corroborated artifact publish's manifest is corrupt, or does not name its own slug and stub URL",
        STUB_MANIFEST_INVALID,
      )
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new PluginEvalPathError(
        "a corroborated artifact publish's manifest is corrupt, or does not name its own slug and stub URL",
        STUB_MANIFEST_INVALID,
      )
    }
    const rec = parsed as Record<string, unknown>
    if (
      rec.slug !== slug ||
      rec.url !== `${EVAL_STUB_ARTIFACT_URL_PREFIX}${slug}`
    ) {
      throw new PluginEvalPathError(
        "a corroborated artifact publish's manifest is corrupt, or does not name its own slug and stub URL",
        STUB_MANIFEST_INVALID,
      )
    }
    const at = rec.publishedAtMs
    out.push({
      url: `${EVAL_STUB_ARTIFACT_URL_PREFIX}${slug}`,
      slug,
      env: 'stub',
      payloadDir,
      at: typeof at === 'number' ? at : 0,
    })
  }
  return out
    .sort((a, b) => a.at - b.at)
    .map(row => ({
      url: row.url,
      slug: row.slug,
      env: row.env,
      payloadDir: row.payloadDir,
    }))
}
