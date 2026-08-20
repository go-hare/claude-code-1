import { parseCellId } from '../../../utils/notebook.js'
import { getFsImplementation } from '../../../utils/fsOperations.js'
import { containsVulnerableUncPath } from '../../../utils/shell/readOnlyCommandValidation.js'
import type { NotebookCell, NotebookContent } from '../../../types/notebook.js'

/** densable `MG` — 100MiB notebook read cap via readFileBytes(path, MG+1). */
export const MG = 104857600

/** densable `GFt` — source length cap for permission preview. */
export const GFt = 200000

/** densable truncation marker after sanitize (`fpt=/… [+\d+ graphemes]/`). */
const NOTEBOOK_PREVIEW_WITHHELD_MARKER = /… \[\+\d+ graphemes\]/

export const NOTEBOOK_PREVIEW_FAILURE_REASONS = {
  remoteNotFound: 'the notebook was not found in the remote workspace',
  remoteFetchFailed: 'the remote notebook could not be fetched',
  networkPath: 'the notebook is on a network path',
  couldNotRead: 'the notebook could not be read',
  tooLarge: 'the notebook is too large to preview',
  cellContentsTooLarge: 'the current cell contents cannot be shown in full',
  unparsable: 'the notebook could not be parsed for preview',
  cellMissing: 'the target cell was not found in the notebook',
} as const

export type NotebookPreviewFailureReason =
  (typeof NOTEBOOK_PREVIEW_FAILURE_REASONS)[keyof typeof NOTEBOOK_PREVIEW_FAILURE_REASONS]

const PROPOSED_TOO_LARGE_MESSAGE =
  'Proposed cell content is too large to show — cannot be reviewed, so approval is one-time only (deny unless expected).'

export type LookupNotebookCellSourceResult =
  | { kind: 'found'; source: string }
  | { kind: 'unparsable' }
  | { kind: 'cell-missing' }

export type NotebookPermissionPreviewInput = {
  notebook_path: string
  cell_id?: string
  new_source?: string
  cell_type?: string
  edit_mode?: 'replace' | 'insert' | 'delete' | string
  /** Local UI path passes false; remote gateway is not invented. */
  remoteWorkspace?: boolean
  /** When remoteWorkspace: string=fetched text, null=not found, undefined=fetch failed. */
  remoteOldContent?: string | null
}

export type NotebookPermissionPreviewResult =
  | {
      kind: 'no-changes'
      contentWithheld: true
      message: string
      oldCellSource?: undefined
    }
  | {
      kind: 'notebook-edit-diff'
      contentWithheld: false
      message?: undefined
      oldCellSource?: string
    }

/**
 * densable `sRe` — withheld marker after sanitize. Length > GFt remains the
 * primary gate; this catches truncated payloads that still fit under GFt.
 */
export function hasNotebookPreviewWithheldMarker(text: string): boolean {
  return NOTEBOOK_PREVIEW_WITHHELD_MARKER.test(text)
}

function isNotebookShape(value: unknown): value is NotebookContent {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const cells = (value as { cells?: unknown }).cells
  return Array.isArray(cells)
}

/** densable `CAa` — parse notebook JSON and resolve cell source by id/index. */
export function lookupNotebookCellSource(
  notebookText: string,
  cellId: string | undefined,
): LookupNotebookCellSourceResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(notebookText) as unknown
  } catch {
    return { kind: 'unparsable' }
  }
  if (!isNotebookShape(parsed)) {
    return { kind: 'unparsable' }
  }
  if (!cellId) {
    return { kind: 'cell-missing' }
  }

  const byId = parsed.cells.find((cell: NotebookCell) => cell.id === cellId)
  const index = byId === undefined ? parseCellId(cellId) : undefined
  const cell = byId ?? (index !== undefined ? parsed.cells[index] : undefined)
  if (!cell) {
    return { kind: 'cell-missing' }
  }

  const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source
  return { kind: 'found', source: typeof source === 'string' ? source : '' }
}

function isProposedTooLarge(newSource: string | undefined): boolean {
  const text = newSource ?? ''
  return text.length > GFt || hasNotebookPreviewWithheldMarker(text)
}

function isSourceTooLargeToShow(source: string): boolean {
  return source.length > GFt || hasNotebookPreviewWithheldMarker(source)
}

function currentContentsWithheldMessage(
  reason: string,
  editMode: string | undefined,
): string {
  const action = editMode === 'delete' ? 'deletion' : 'edit'
  return `Current cell contents cannot be shown (${reason}) — the ${action} cannot be reviewed, so approval is one-time only (deny unless expected).`
}

/** densable Qh/_u equivalent for notebook preview network-path gate. */
export function isNotebookNetworkPath(notebookPath: string): boolean {
  return containsVulnerableUncPath(notebookPath, true)
}

function reasonFromLookup(
  lookup: LookupNotebookCellSourceResult,
): NotebookPreviewFailureReason {
  return lookup.kind === 'unparsable'
    ? NOTEBOOK_PREVIEW_FAILURE_REASONS.unparsable
    : NOTEBOOK_PREVIEW_FAILURE_REASONS.cellMissing
}

/**
 * densable B7S notebook branch — build permission preview + contentWithheld.
 * Does not invent a remote workspace gateway; remote* args are optional API.
 */
export async function buildNotebookPermissionPreview(
  input: NotebookPermissionPreviewInput,
): Promise<NotebookPermissionPreviewResult> {
  const editMode = input.edit_mode ?? 'replace'
  const proposedTooLarge = isProposedTooLarge(input.new_source)
  const needsCurrentCell = editMode !== 'insert'

  let oldCellSource: string | undefined
  let failureReason: string | undefined

  if (needsCurrentCell) {
    if (input.remoteWorkspace) {
      if (typeof input.remoteOldContent === 'string') {
        const lookup = lookupNotebookCellSource(
          input.remoteOldContent,
          input.cell_id,
        )
        if (lookup.kind === 'found') {
          if (isSourceTooLargeToShow(lookup.source)) {
            failureReason =
              NOTEBOOK_PREVIEW_FAILURE_REASONS.cellContentsTooLarge
          } else {
            oldCellSource = lookup.source
          }
        } else {
          failureReason = reasonFromLookup(lookup)
        }
      } else if (input.remoteOldContent === null) {
        failureReason = NOTEBOOK_PREVIEW_FAILURE_REASONS.remoteNotFound
      } else {
        failureReason = NOTEBOOK_PREVIEW_FAILURE_REASONS.remoteFetchFailed
      }
    } else if (isNotebookNetworkPath(input.notebook_path)) {
      failureReason = NOTEBOOK_PREVIEW_FAILURE_REASONS.networkPath
    } else {
      try {
        const fs = getFsImplementation()
        const stats = await fs.stat(input.notebook_path)
        if (!stats.isFile()) {
          failureReason = NOTEBOOK_PREVIEW_FAILURE_REASONS.couldNotRead
        } else {
          const bytes = await fs.readFileBytes(input.notebook_path, MG + 1)
          if (bytes.length > MG) {
            failureReason = NOTEBOOK_PREVIEW_FAILURE_REASONS.tooLarge
          } else {
            const lookup = lookupNotebookCellSource(
              bytes.toString('utf-8'),
              input.cell_id,
            )
            if (lookup.kind === 'found') {
              if (isSourceTooLargeToShow(lookup.source)) {
                failureReason =
                  NOTEBOOK_PREVIEW_FAILURE_REASONS.cellContentsTooLarge
              } else {
                oldCellSource = lookup.source
              }
            } else {
              failureReason = reasonFromLookup(lookup)
            }
          }
        }
      } catch {
        failureReason = NOTEBOOK_PREVIEW_FAILURE_REASONS.couldNotRead
      }
    }
  }

  const contentWithheld = proposedTooLarge || failureReason !== undefined
  if (proposedTooLarge) {
    return {
      kind: 'no-changes',
      contentWithheld: true,
      message: PROPOSED_TOO_LARGE_MESSAGE,
    }
  }
  if (failureReason !== undefined) {
    return {
      kind: 'no-changes',
      contentWithheld: true,
      message: currentContentsWithheldMessage(failureReason, editMode),
    }
  }

  return {
    kind: 'notebook-edit-diff',
    contentWithheld: false,
    oldCellSource,
  }
}
