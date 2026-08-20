import { basename } from 'path'
import { containsVulnerableUncPath } from '../../../utils/shell/readOnlyCommandValidation.js'
import {
  GFt,
  hasNotebookPreviewWithheldMarker,
} from '../NotebookEditPermissionRequest/notebookPermissionPreview.js'

/** densable B7S Edit withhold copy (em dash). */
export const PROPOSED_EDIT_TOO_LARGE_MESSAGE =
  'Proposed edit is too large to show — cannot be reviewed, so approval is one-time only (deny unless expected).'

/** densable B7S Write withhold copy when proposed content cannot be shown. */
export const PROPOSED_CONTENT_TOO_LARGE_MESSAGE =
  'Proposed content is too large to show — cannot be reviewed, so approval is one-time only (deny unless expected).'

/** densable `sRe` / length>GFt — text too large (or truncated) to review. */
export function isTextTooLargeToPreview(text: string): boolean {
  return text.length > GFt || hasNotebookPreviewWithheldMarker(text)
}

/** densable Qh/_u network-path gate for file permission preview. */
export function isFilePermissionNetworkPath(filePath: string): boolean {
  return containsVulnerableUncPath(filePath, true)
}

export function existingFileTooLargeOverwriteMessage(filePath: string): string {
  return `Existing file is too large to preview — approving will overwrite ${basename(filePath)}.`
}

export function networkPathWriteWithholdMessage(filePath: string): string {
  return `File is on a network path that cannot be previewed — approving will write to ${basename(filePath)}.`
}

export type FilePermissionPreviewWithholdResult =
  | { contentWithheld: false; message?: undefined }
  | { contentWithheld: true; message: string }

/**
 * densable B7S Edit (`gN`) branch — oversized old/new → one-time-only.
 */
export function evaluateEditContentWithhold(
  oldString: string,
  newString: string,
): FilePermissionPreviewWithholdResult {
  if (
    isTextTooLargeToPreview(oldString) ||
    isTextTooLargeToPreview(newString)
  ) {
    return {
      contentWithheld: true,
      message: PROPOSED_EDIT_TOO_LARGE_MESSAGE,
    }
  }
  return { contentWithheld: false }
}

/**
 * densable B7S Write (`RL`) local branch (`remoteWorkspace=false`).
 * Does not invent remote-workspace fetch; network / size / sRe only.
 */
export function evaluateWriteContentWithhold(input: {
  content: string
  filePath: string
  fileExists: boolean
  oldContent: string
}): FilePermissionPreviewWithholdResult {
  const { content, filePath, fileExists, oldContent } = input
  const proposedTooLarge = isTextTooLargeToPreview(content)
  if (proposedTooLarge) {
    return {
      contentWithheld: true,
      message: PROPOSED_CONTENT_TOO_LARGE_MESSAGE,
    }
  }

  // SEA: network path → `u` with network copy (c stays false; no local read).
  if (isFilePermissionNetworkPath(filePath)) {
    return {
      contentWithheld: true,
      message: networkPathWriteWithholdMessage(filePath),
    }
  }

  // SEA: existing too-large / sRe(old) → `u` + Existing overwrite copy.
  if (fileExists && isTextTooLargeToPreview(oldContent)) {
    return {
      contentWithheld: true,
      message: existingFileTooLargeOverwriteMessage(filePath),
    }
  }

  // SEA: `m = f || u || (c && sRe(l))` — marker-only on existing covered above.
  return { contentWithheld: false }
}
