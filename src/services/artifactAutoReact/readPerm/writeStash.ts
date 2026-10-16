/**
 * densable He write lane / w5 / DLe / Lp (2.1.289) — the check-time
 * write-permission stash and the pinned read_file / read_asset save.
 * Gold: class He `stash`/`consume`/`holds`, `GGe`, `w5` PartialKeptError,
 * `DLe` rename-into-place, `Lp` (file) and the read_asset write block
 * (`FI` → `joe` → `y_` → `$d` wx → `recheckBeforeWrite` → `DLe`).
 */
import { writeFile, rename as renameFs, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getErrnoCode } from '../../../utils/errors.js'
import {
  type ApprovedWrite,
  openApprovedWrite,
  SymlinkResolutionChangedError,
} from '../../../utils/fileToolApprovedOpen.js'
import { getBootstrapSession } from '../../../utils/sessionRoot.js'
import { WRITE_STASH_EXPIRED } from '../../../utils/sessionSlots.js'
import {
  ensureArtifactScratchpad,
  isInArtifactScratchpad,
  tempSiblingPath,
} from '../outDirPaths.js'

/** densable GGe — consume() miss after the entry was evicted. */
export const ARTIFACT_WRITE_STASH_EVICTED = WRITE_STASH_EXPIRED

/**
 * densable `n.session.writePermissionStash` (He, write lane). Same session
 * store FileWrite/FileEdit stash into; keys are `${toolUseId}\0${dest}`.
 */
export const artifactWritePermissionStash = {
  /** densable He.stash — a repeat stash for the same key keeps the intersection. */
  stash(
    toolUseId: string | undefined,
    dest: string,
    spellings: readonly string[],
  ): void {
    getBootstrapSession().writePermissionStash.stash(toolUseId, dest, [
      ...spellings,
    ])
  },
  /** densable He.consume — takes `dest` and drops every entry of `toolUseId`. */
  consume(
    toolUseId: string | undefined,
    dest: string,
  ): string[] | typeof ARTIFACT_WRITE_STASH_EVICTED | undefined {
    return getBootstrapSession().writePermissionStash.consume(toolUseId, dest)
  },
  /** densable He.holds */
  holds(toolUseId: string | undefined, dest: string): boolean {
    return (
      toolUseId !== undefined &&
      getBootstrapSession().writePermissionStash.pathsByToolUse.has(
        `${toolUseId}\0${dest}`,
      )
    )
  },
}

/** densable AA — rename errors that retry once after unlinking the target. */
const RENAME_RETRY_AFTER_UNLINK = new Set(['EXDEV', 'EPERM', 'EEXIST', 'EBUSY'])

/** densable w5 */
export class PartialKeptError extends Error {
  constructor(
    readonly partial: string,
    readonly renameError: unknown,
    readonly removedEarlier: boolean,
  ) {
    super('the staged file could not be moved into place')
    this.name = 'PartialKeptError'
  }
}

export type RenameFn = (from: string, to: string) => Promise<void>

/**
 * densable DLe — rename `staged` onto `dest`; on AA errors unlink `dest` and
 * retry once. A failed retry keeps the staged bytes (PartialKeptError).
 */
export async function renameIntoPlace(
  staged: string,
  dest: string,
  renameFn: RenameFn = renameFs,
): Promise<void> {
  let removedEarlier = true
  try {
    await renameFn(staged, dest)
    return
  } catch (first) {
    const code = getErrnoCode(first)
    if (code === undefined || !RENAME_RETRY_AFTER_UNLINK.has(code)) throw first
    await unlink(dest).catch((e: unknown) => {
      if (getErrnoCode(e) !== 'ENOENT') throw first
      removedEarlier = false
    })
  }
  try {
    await renameFn(staged, dest)
  } catch (second) {
    throw new PartialKeptError(staged, second, removedEarlier)
  }
}

export type PinnedSaveKind = 'file' | 'asset'

export type PinnedSaveOutcome = 'write_kept' | 'write_moved' | 'write_error'

/** densable `Pe(message, code)` raised by Lp / the read_asset write block. */
export class ArtifactSaveWriteError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly outcome: PinnedSaveOutcome,
  ) {
    super(message)
    this.name = 'ArtifactSaveWriteError'
  }
}

function keptMessage(
  kind: PinnedSaveKind,
  dest: string,
  err: PartialKeptError,
): string {
  const noun = kind === 'file' ? 'file' : 'asset'
  const why = getErrnoCode(err.renameError) ?? 'unexpected error'
  return err.removedEarlier
    ? `the earlier copy at ${basename(dest)} was removed but the fetched ${noun} could not be moved into its place (${why}) \u2014 the bytes are kept at ${err.partial}; move or delete that file`
    : `the fetched ${noun} could not be moved to ${basename(dest)} (${why}) \u2014 the bytes are kept at ${err.partial}; move or delete that file`
}

function movedMessage(kind: PinnedSaveKind): string {
  return kind === 'file'
    ? 'out_dir no longer resolves where it did when the save was approved \u2014 the file was fetched but not saved; retry so it is checked again'
    : 'the destination folder no longer resolves where it did when the save was approved \u2014 the asset was fetched but not saved; retry so it is checked again'
}

export type PinnedSaveOpts = {
  kind: PinnedSaveKind
  /** y_ target: the read_file dest, or the read_asset stem (no extension). */
  pinPath: string
  /** Final path; read_asset appends the content-type extension to the stem. */
  dest: string
  bytes: Uint8Array
  /** Approved spellings of `pinPath` (stash consume / m4). */
  spellings: readonly string[]
  /** densable DLe `r` */
  renameFn?: RenameFn
}

/**
 * densable Lp (read_file) / read_asset write block — pin the approved
 * destination, stage `${target}.tmp.<hex>` with wx, recheck the pin, then
 * DLe it into place. Errors surface as ArtifactSaveWriteError with gold's
 * message and code.
 */
export async function writeThroughApprovedPin(
  opts: PinnedSaveOpts,
): Promise<void> {
  const { kind, pinPath, dest, bytes, spellings, renameFn } = opts
  const lane = kind === 'file' ? 'file_read' : 'asset_read'
  let staged = tempSiblingPath(dest)
  let stagedOwned = false
  let pin: ApprovedWrite | undefined
  try {
    if (isInArtifactScratchpad(pinPath)) await ensureArtifactScratchpad()
    pin = await openApprovedWrite(pinPath, new Set(spellings), {
      createParents: true,
    })
    const target =
      pinPath === dest ? pin.ioPath : join(dirname(pin.ioPath), basename(dest))
    staged = tempSiblingPath(target)
    await writeFile(staged, bytes, { flag: 'wx' }).catch((e: unknown) => {
      stagedOwned = getErrnoCode(e) !== 'EEXIST'
      throw e
    })
    stagedOwned = true
    await pin.recheckBeforeWrite()
    await renameIntoPlace(staged, target, renameFn).catch((e: unknown) => {
      if (e instanceof PartialKeptError) {
        throw new PartialKeptError(
          join(dirname(dest), basename(e.partial)),
          e.renameError,
          e.removedEarlier,
        )
      }
      throw e
    })
  } catch (err) {
    if (err instanceof PartialKeptError) {
      throw new ArtifactSaveWriteError(
        keptMessage(kind, dest, err),
        `${lane}_write_kept`,
        'write_kept',
      )
    }
    if (stagedOwned) await unlink(staged).catch(() => {})
    if (err instanceof SymlinkResolutionChangedError) {
      throw new ArtifactSaveWriteError(
        movedMessage(kind),
        `${lane}_write_moved`,
        'write_moved',
      )
    }
    throw new ArtifactSaveWriteError(
      `the ${kind} was fetched but could not be saved (${getErrnoCode(err) ?? 'unexpected error'})`,
      `${lane}_write_error`,
      'write_error',
    )
  } finally {
    await pin?.close()
  }
}
