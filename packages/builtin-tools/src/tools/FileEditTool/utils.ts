import { type StructuredPatchHunk, structuredPatch } from 'diff'
import { logError } from 'src/utils/log.js'
import {
  expandPath,
  isNtObjectNamespacePath,
  isUncOrNtObjectPath,
  isWslUncPath,
} from 'src/utils/path.js'
import { countCharInString } from 'src/utils/stringUtils.js'
import {
  DIFF_TIMEOUT_MS,
  getPatchForDisplay,
  getPatchFromContents,
} from 'src/utils/diff.js'
import { errorMessage, isENOENT } from 'src/utils/errors.js'
import {
  addLineNumbers,
  convertLeadingTabsToSpaces,
  readFileSyncCached,
} from 'src/utils/file.js'
import type { EditInput, FileEdit } from './types.js'

/**
 * Strips trailing whitespace from each line in a string while preserving line endings
 * @param str The string to process
 * @returns The string with trailing whitespace removed from each line
 */
export function stripTrailingWhitespace(str: string): string {
  // Handle different line endings: CRLF, LF, CR
  // Use a regex that matches line endings and captures them
  const lines = str.split(/(\r\n|\n|\r)/)

  let result = ''
  for (let i = 0; i < lines.length; i++) {
    const part = lines[i]
    if (part !== undefined) {
      if (i % 2 === 0) {
        // Even indices are line content
        result += part.replace(/\s+$/, '')
      } else {
        // Odd indices are line endings
        result += part
      }
    }
  }

  return result
}

/**
 * Finds the exact string in the file content.
 *
 * @param fileContent The file content to search in
 * @param searchString The string to search for
 * @returns The search string if found, or null if not found
 */
export function findActualString(
  fileContent: string,
  searchString: string,
): string | null {
  if (fileContent.includes(searchString)) {
    return searchString
  }
  return null
}

/**
 * Transform edits to ensure replace_all always has a boolean value
 * @param edits Array of edits with optional replace_all
 * @returns Array of edits with replace_all guaranteed to be boolean
 */
export function applyEditToFile(
  originalContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false,
): string {
  const f = replaceAll
    ? (content: string, search: string, replace: string) =>
        content.replaceAll(search, () => replace)
    : (content: string, search: string, replace: string) =>
        content.replace(search, () => replace)

  if (newString !== '') {
    return f(originalContent, oldString, newString)
  }

  const stripTrailingNewline =
    !oldString.endsWith('\n') && originalContent.includes(oldString + '\n')

  return stripTrailingNewline
    ? f(originalContent, oldString + '\n', newString)
    : f(originalContent, oldString, newString)
}

/**
 * Applies an edit to a file and returns the patch and updated file.
 * Does not write the file to disk.
 */
export function getPatchForEdit({
  filePath,
  fileContents,
  oldString,
  newString,
  replaceAll = false,
}: {
  filePath: string
  fileContents: string
  oldString: string
  newString: string
  replaceAll?: boolean
}): { patch: StructuredPatchHunk[]; updatedFile: string } {
  return getPatchForEdits({
    filePath,
    fileContents,
    edits: [
      { old_string: oldString, new_string: newString, replace_all: replaceAll },
    ],
  })
}

/**
 * Applies a list of edits to a file and returns the patch and updated file.
 * Does not write the file to disk.
 *
 * NOTE: The returned patch is to be used for display purposes only - it has spaces instead of tabs
 */
function splitLinesKeepNewline(text: string): string[] {
  const lines: string[] = []
  let pos = 0
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos)
    const end = nl === -1 ? text.length : nl + 1
    lines.push(text.slice(pos, end))
    pos = end
  }
  return lines
}

type DiffScript = {
  kinds: number[] // 0 = equal, 1 = insert, 2 = delete
  counts: number[]
}

function pushDiffOp(script: DiffScript, kind: number, count: number): void {
  const last = script.kinds.length - 1
  if (kind !== 0 && script.kinds[last] === kind) {
    script.counts[last] = (script.counts[last] ?? 0) + count
  } else {
    script.kinds.push(kind)
    script.counts.push(count)
  }
}

function myersSearch(
  a: Int32Array,
  b: Int32Array,
  deadline: number,
  maxSearchSteps: number,
): Uint8Array | undefined {
  const n = a.length
  const m = b.length
  const maxD = n + m
  const offset = maxD + 1
  const v = new Int32Array(2 * maxD + 3).fill(-2)
  let x = -1
  while (x + 1 < n && x + 1 < m && a[x + 1] === b[x + 1]) x++
  if (x + 1 >= n && x + 1 >= m) return new Uint8Array(0)
  v[offset] = x
  let trace = new Uint8Array(4096)
  let bitPos = 0
  const layerOffsets = [0]
  const layerKMin = [0]
  let kMinBound = -maxD
  let kMaxBound = maxD
  for (let d = 1; d <= maxD; d++) {
    const kStart = Math.max(kMinBound, -d)
    const kEnd = Math.min(kMaxBound, d)
    const count = kEnd >= kStart ? ((kEnd - kStart) >> 1) + 1 : 0
    if (Date.now() > deadline || bitPos + count > maxSearchSteps) {
      return undefined
    }
    layerOffsets.push(bitPos)
    layerKMin.push(kStart)
    if (bitPos + count > trace.length * 8) {
      const next = new Uint8Array(
        Math.max(trace.length * 2, ((bitPos + count) >> 3) + 1),
      )
      next.set(trace)
      trace = next
    }
    for (let k = kStart; k <= kEnd && k <= kMaxBound; k += 2) {
      const bitIdx = bitPos++
      const idx = k + offset
      const down = v[idx - 1]!
      const right = v[idx + 1]!
      if (down !== -2) v[idx - 1] = -2
      const canRight = right !== -2 && right - k >= 0 && right - k < m
      const canDown = down !== -2 && down + 1 < n
      if (!canRight && !canDown) {
        v[idx] = -2
        continue
      }
      if (!canDown || (canRight && down < right)) {
        x = right
        trace[bitIdx >> 3]! |= 1 << (bitIdx & 7)
      } else {
        x = down + 1
      }
      let y = x - k
      while (y + 1 < m && x + 1 < n && a[x + 1] === b[y + 1]) {
        y++
        x++
      }
      if (x + 1 >= n && y + 1 >= m) {
        const edits = new Uint8Array(d)
        let curK = k
        for (let step = d; step > 0; step--) {
          const bIdx = layerOffsets[step]! + ((curK - layerKMin[step]!) >> 1)
          const isInsert = (trace[bIdx >> 3]! >> (bIdx & 7)) & 1
          edits[step - 1] = isInsert
          curK += isInsert ? 1 : -1
        }
        return edits
      }
      v[idx] = x
      if (x + 1 >= n) kMaxBound = Math.min(kMaxBound, k - 1)
      if (y + 1 >= m) kMinBound = Math.max(kMinBound, k + 1)
    }
  }
  return undefined
}

function buildScriptFromEdits(
  a: Int32Array,
  b: Int32Array,
  edits: Uint8Array,
): DiffScript {
  const script: DiffScript = { kinds: [], counts: [] }
  let ai = 0
  let bi = 0
  const flushEqual = () => {
    let eq = 0
    while (ai < a.length && bi < b.length && a[ai] === b[bi]) {
      ai++
      bi++
      eq++
    }
    if (eq > 0) pushDiffOp(script, 0, eq)
  }
  flushEqual()
  for (const isInsert of edits) {
    if (isInsert) {
      bi++
      pushDiffOp(script, 1, 1)
    } else {
      ai++
      pushDiffOp(script, 2, 1)
    }
    flushEqual()
  }
  return script
}

function tryDisjointDiff(
  a: Int32Array,
  b: Int32Array,
  vocabSize: number,
  maxSearchSteps: number,
): DiffScript | 'search' | undefined {
  const minLen = Math.min(a.length, b.length)
  let suffix = 0
  while (
    suffix < minLen &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }
  const aMid = a.length - suffix
  const bMid = b.length - suffix
  const seen = new Uint8Array(vocabSize)
  for (const id of b) seen[id] = 1
  for (let i = 0; i < aMid; i++) {
    if (seen[a[i]!]) return 'search'
  }
  seen.fill(0)
  for (const id of a) seen[id] = 1
  for (let i = 0; i < bMid; i++) {
    if (seen[b[i]!]) return 'search'
  }
  if (aMid * bMid > maxSearchSteps) return undefined
  const script: DiffScript = { kinds: [], counts: [] }
  if (aMid > 0) pushDiffOp(script, 2, aMid)
  if (bMid > 0) pushDiffOp(script, 1, bMid)
  if (suffix > 0) pushDiffOp(script, 0, suffix)
  return script
}

function scriptToHunks(
  script: DiffScript,
  oldLines: string[],
  newLines: string[],
  context: number,
): StructuredPatchHunk[] {
  const hunks: StructuredPatchHunk[] = []
  let oldStart = 0
  let newStart = 0
  let hunkLines: string[] = []
  let oldCursor = 1
  let newCursor = 1
  const totalOps = script.kinds.length + 1
  for (let idx = 0; idx < totalOps; idx++) {
    const kind = script.kinds[idx] ?? 0
    const count = script.counts[idx] ?? 0
    if (kind !== 0) {
      if (!oldStart) {
        oldStart = oldCursor
        newStart = newCursor
        if (idx > 0 && context > 0) {
          const lead = Math.min(context, script.counts[idx - 1]!)
          for (let j = newCursor - 1 - lead; j < newCursor - 1; j++) {
            hunkLines.push(' ' + newLines[j]!)
          }
          oldStart -= lead
          newStart -= lead
        }
      }
      if (kind === 1) {
        for (let j = newCursor - 1; j < newCursor - 1 + count; j++) {
          hunkLines.push('+' + newLines[j]!)
        }
        newCursor += count
      } else {
        for (let j = oldCursor - 1; j < oldCursor - 1 + count; j++) {
          hunkLines.push('-' + oldLines[j]!)
        }
        oldCursor += count
      }
      continue
    }
    if (oldStart) {
      const mergeNext = count <= context * 2 && idx < totalOps - 2
      const trail = mergeNext ? count : Math.min(count, context)
      for (let j = newCursor - 1; j < newCursor - 1 + trail; j++) {
        hunkLines.push(' ' + newLines[j]!)
      }
      if (!mergeNext) {
        hunks.push({
          oldStart,
          oldLines: oldCursor - oldStart + trail,
          newStart,
          newLines: newCursor - newStart + trail,
          lines: hunkLines,
        })
        oldStart = 0
        newStart = 0
        hunkLines = []
      }
    }
    oldCursor += count
    newCursor += count
  }
  for (const hunk of hunks) {
    const stripped: string[] = []
    for (const line of hunk.lines) {
      if (line.endsWith('\n')) {
        stripped.push(line.slice(0, -1))
      } else {
        stripped.push(line, '\\ No newline at end of file')
      }
    }
    hunk.lines = stripped
  }
  return hunks
}

/**
 * SEA `Se` (@286984800): fast line-interned Myers diff with common prefix/suffix
 * trimming and disjoint-block shortcut so thousands-of-lines Write/Edit calls
 * complete in milliseconds instead of hitting the 5s `diff.structuredPatch` timeout.
 */
export function computeFastStructuredPatch(
  oldContent: string,
  newContent: string,
  {
    context = 3,
    timeout = DIFF_TIMEOUT_MS,
    maxSearchSteps = 268435456,
  }: { context?: number; timeout?: number; maxSearchSteps?: number } = {},
): StructuredPatchHunk[] | undefined {
  const deadline = Date.now() + timeout
  const oldLines = splitLinesKeepNewline(oldContent)
  const newLines = splitLinesKeepNewline(newContent)
  const minLen = Math.min(oldLines.length, newLines.length)
  let prefix = 0
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (
    suffix < minLen - prefix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix++
  }
  const lineIds = new Map<string, number>()
  const internSlice = (lines: string[], end: number): Int32Array => {
    const out = new Int32Array(lines.length - prefix)
    for (let i = prefix; i < end; i++) {
      const line = lines[i]!
      let id = lineIds.get(line)
      if (id === undefined) {
        id = lineIds.size
        lineIds.set(line, id)
      }
      out[i - prefix] = id
    }
    return out
  }
  const a = internSlice(oldLines, oldLines.length)
  const b = internSlice(newLines, newLines.length - suffix)
  b.set(a.subarray(a.length - suffix), b.length - suffix)

  let script = tryDisjointDiff(a, b, lineIds.size, maxSearchSteps)
  if (script === 'search') {
    const edits = myersSearch(a, b, deadline, maxSearchSteps)
    script = edits ? buildScriptFromEdits(a, b, edits) : undefined
  }
  if (script === undefined) return undefined
  if (prefix > 0) {
    script.kinds.unshift(0)
    script.counts.unshift(prefix)
  }
  return scriptToHunks(script, oldLines, newLines, context)
}

export function getFastPatchFromContents({
  oldContent,
  newContent,
  singleHunk = false,
  convertTabs = true,
}: {
  oldContent: string
  newContent: string
  singleHunk?: boolean
  convertTabs?: boolean
}): StructuredPatchHunk[] {
  const hunks = computeFastStructuredPatch(oldContent, newContent, {
    context: singleHunk ? 100_000 : 3,
    timeout: DIFF_TIMEOUT_MS,
  })
  if (!hunks) return []
  if (!convertTabs) return hunks
  return hunks.map(hunk => ({
    ...hunk,
    lines: hunk.lines.map(
      line => line.slice(0, 1) + convertLeadingTabsToSpaces(line.slice(1)),
    ),
  }))
}

export function getPatchForEdits({
  filePath,
  fileContents,
  edits,
}: {
  filePath: string
  fileContents: string
  edits: FileEdit[]
}): { patch: StructuredPatchHunk[]; updatedFile: string } {
  let updatedFile = fileContents
  const appliedNewStrings: string[] = []

  // Special case for empty files.
  if (
    !fileContents &&
    edits.length === 1 &&
    edits[0] &&
    edits[0].old_string === '' &&
    edits[0].new_string === ''
  ) {
    const patch = getPatchForDisplay({
      filePath,
      fileContents,
      edits: [
        {
          old_string: fileContents,
          new_string: updatedFile,
          replace_all: false,
        },
      ],
    })
    return { patch, updatedFile: '' }
  }

  // Apply each edit and check if it actually changes the file
  for (const edit of edits) {
    // Strip trailing newlines from old_string before checking
    const oldStringToCheck = edit.old_string.replace(/\n+$/, '')

    // Check if old_string is a substring of any previously applied new_string
    for (const previousNewString of appliedNewStrings) {
      if (
        oldStringToCheck !== '' &&
        previousNewString.includes(oldStringToCheck)
      ) {
        throw new Error(
          'Cannot edit file: old_string is a substring of a new_string from a previous edit.',
        )
      }
    }

    const previousContent = updatedFile
    updatedFile =
      edit.old_string === ''
        ? edit.new_string
        : applyEditToFile(
            updatedFile,
            edit.old_string,
            edit.new_string,
            edit.replace_all,
          )

    // If this edit didn't change anything, throw an error
    if (updatedFile === previousContent) {
      throw new Error('String not found in file. Failed to apply edit.')
    }

    // Track the new string that was applied
    appliedNewStrings.push(edit.new_string)
  }

  if (updatedFile === fileContents) {
    throw new Error(
      'Original and edited file match exactly. Failed to apply edit.',
    )
  }

  // We already have before/after content, so call getPatchFromContents directly.
  // Previously this went through getPatchForDisplay with edits=[{old:fileContents,new:updatedFile}],
  // which transforms fileContents twice (once as preparedFileContents, again as escapedOldString
  // inside the reduce) and runs a no-op full-content .replace(). This saves ~20% on large files.
  const patch = getFastPatchFromContents({
    oldContent: fileContents,
    newContent: updatedFile,
    convertTabs: true,
  })

  return { patch, updatedFile }
}

// Cap on edited_text_file attachment snippets. Format-on-save of a large file
// previously injected the entire file per turn (observed max 16.1KB, ~14K
// tokens/session). 8KB preserves meaningful context while bounding worst case.
const DIFF_SNIPPET_MAX_BYTES = 8192

/**
 * Used for attachments, to show snippets when files change.
 *
 * TODO: Unify this with the other snippet logic.
 */
export function getSnippetForTwoFileDiff(
  fileAContents: string,
  fileBContents: string,
): string {
  const patch = structuredPatch(
    'file.txt',
    'file.txt',
    fileAContents,
    fileBContents,
    undefined,
    undefined,
    {
      context: 8,
      timeout: DIFF_TIMEOUT_MS,
    },
  )

  if (!patch) {
    return ''
  }

  const full = patch.hunks
    .map(_ => ({
      startLine: _.oldStart,
      content: _.lines
        // Filter out deleted lines AND diff metadata lines
        .filter(_ => !_.startsWith('-') && !_.startsWith('\\'))
        .map(_ => _.slice(1))
        .join('\n'),
    }))
    .map(addLineNumbers)
    .join('\n...\n')

  if (full.length <= DIFF_SNIPPET_MAX_BYTES) {
    return full
  }

  // Truncate at the last line boundary that fits within the cap.
  // Marker format matches BashTool/utils.ts.
  const cutoff = full.lastIndexOf('\n', DIFF_SNIPPET_MAX_BYTES)
  const kept =
    cutoff > 0 ? full.slice(0, cutoff) : full.slice(0, DIFF_SNIPPET_MAX_BYTES)
  const remaining = countCharInString(full, '\n', kept.length) + 1
  return `${kept}\n\n... [${remaining} lines truncated] ...`
}

const CONTEXT_LINES = 4

/**
 * Gets a snippet from a file showing the context around a patch with line numbers.
 * @param originalFile The original file content before applying the patch
 * @param patch The diff hunks to use for determining snippet location
 * @param newFile The file content after applying the patch
 * @returns The snippet text with line numbers and the starting line number
 */
export function getSnippetForPatch(
  patch: StructuredPatchHunk[],
  newFile: string,
): { formattedSnippet: string; startLine: number } {
  if (patch.length === 0) {
    // No changes, return empty snippet
    return { formattedSnippet: '', startLine: 1 }
  }

  // Find the first and last changed lines across all hunks
  let minLine = Infinity
  let maxLine = -Infinity

  for (const hunk of patch) {
    if (hunk.oldStart < minLine) {
      minLine = hunk.oldStart
    }
    // For the end line, we need to consider the new lines count since we're showing the new file
    const hunkEnd = hunk.oldStart + (hunk.newLines || 0) - 1
    if (hunkEnd > maxLine) {
      maxLine = hunkEnd
    }
  }

  // Calculate the range with context
  const startLine = Math.max(1, minLine - CONTEXT_LINES)
  const endLine = maxLine + CONTEXT_LINES

  // Split the new file into lines and get the snippet
  const fileLines = newFile.split(/\r?\n/)
  const snippetLines = fileLines.slice(startLine - 1, endLine)
  const snippet = snippetLines.join('\n')

  // Add line numbers
  const formattedSnippet = addLineNumbers({
    content: snippet,
    startLine,
  })

  return { formattedSnippet, startLine }
}

export function getEditsForPatch(patch: StructuredPatchHunk[]): FileEdit[] {
  return patch.map(hunk => {
    // Extract the changes from this hunk
    const contextLines: string[] = []
    const oldLines: string[] = []
    const newLines: string[] = []

    // Parse each line and categorize it
    for (const line of hunk.lines) {
      if (line.startsWith(' ')) {
        // Context line - appears in both versions
        contextLines.push(line.slice(1))
        oldLines.push(line.slice(1))
        newLines.push(line.slice(1))
      } else if (line.startsWith('-')) {
        // Deleted line - only in old version
        oldLines.push(line.slice(1))
      } else if (line.startsWith('+')) {
        // Added line - only in new version
        newLines.push(line.slice(1))
      }
    }

    return {
      old_string: oldLines.join('\n'),
      new_string: newLines.join('\n'),
      replace_all: false,
    }
  })
}

/**
 * Contains replacements to de-sanitize strings from Claude
 * Since Claude can't see any of these strings (sanitized in the API)
 * It'll output the sanitized versions in the edit response
 */
const DESANITIZATIONS: Record<string, string> = {
  '<fnr>': '<function_results>',
  '<n>': '<name>',
  '</n>': '</name>',
  '<o>': '<output>',
  '</o>': '</output>',
  '<e>': '<error>',
  '</e>': '</error>',
  '<s>': '<system>',
  '</s>': '</system>',
  '<r>': '<result>',
  '</r>': '</result>',
  '< META_START >': '<META_START>',
  '< META_END >': '<META_END>',
  '< EOT >': '<EOT>',
  '< META >': '<META>',
  '< SOS >': '<SOS>',
  '\n\nH:': '\n\nHuman:',
  '\n\nA:': '\n\nAssistant:',
}

/**
 * Normalizes a match string by applying specific replacements
 * This helps handle when exact matches fail due to formatting differences
 * @returns The normalized string and which replacements were applied
 */
function desanitizeMatchString(matchString: string): {
  result: string
  appliedReplacements: Array<{ from: string; to: string }>
} {
  let result = matchString
  const appliedReplacements: Array<{ from: string; to: string }> = []

  for (const [from, to] of Object.entries(DESANITIZATIONS)) {
    const beforeReplace = result
    result = result.replaceAll(from, to)

    if (beforeReplace !== result) {
      appliedReplacements.push({ from, to })
    }
  }

  return { result, appliedReplacements }
}

/**
 * Normalize the input for the FileEditTool
 * If the string to replace is not found in the file, try with a normalized version
 * Returns the normalized input if successful, or the original input if not
 */
export function normalizeFileEditInput({
  file_path,
  edits,
}: {
  file_path: string
  edits: EditInput[]
}): {
  file_path: string
  edits: EditInput[]
} {
  if (edits.length === 0) {
    return { file_path, edits }
  }

  // Markdown uses two trailing spaces as a hard line break — stripping would
  // silently change semantics. Skip stripTrailingWhitespace for .md/.mdx.
  const isMarkdown = /\.(md|mdx)$/i.test(file_path)

  try {
    const fullPath = expandPath(file_path)

    // densable edit_guard: (su(e)||su(n))&&!(db(e)||db(n))||Jw(e)||Jw(n)||bu
    // (`bu` stub false). WSL UNC must remain allowed — do NOT OR s7t's su||Jw.
    const isUnsafeNetwork =
      ((isUncOrNtObjectPath(file_path) || isUncOrNtObjectPath(fullPath)) &&
        !(isWslUncPath(file_path) || isWslUncPath(fullPath))) ||
      isNtObjectNamespacePath(file_path) ||
      isNtObjectNamespacePath(fullPath)
    if (isUnsafeNetwork) {
      return { file_path, edits }
    }

    // Use cached file read to avoid redundant I/O operations.
    // If the file doesn't exist, readFileSyncCached throws ENOENT which the
    // catch below handles by returning the original input (no TOCTOU pre-check).
    const fileContent = readFileSyncCached(fullPath)

    return {
      file_path,
      edits: edits.map(({ old_string, new_string, replace_all }) => {
        const normalizedNewString = isMarkdown
          ? new_string
          : stripTrailingWhitespace(new_string)

        // If exact string match works, keep it as is
        if (fileContent.includes(old_string)) {
          return {
            old_string,
            new_string: normalizedNewString,
            replace_all,
          }
        }

        // Try de-sanitize string if exact match fails
        const { result: desanitizedOldString, appliedReplacements } =
          desanitizeMatchString(old_string)

        if (fileContent.includes(desanitizedOldString)) {
          // Apply the same exact replacements to new_string
          let desanitizedNewString = normalizedNewString
          for (const { from, to } of appliedReplacements) {
            desanitizedNewString = desanitizedNewString.replaceAll(from, to)
          }

          return {
            old_string: desanitizedOldString,
            new_string: desanitizedNewString,
            replace_all,
          }
        }

        return {
          old_string,
          new_string: normalizedNewString,
          replace_all,
        }
      }),
    }
  } catch (error) {
    // If there's any error reading the file, just return original input.
    // ENOENT is expected when the file doesn't exist yet (e.g., new file).
    if (!isENOENT(error)) {
      logError(error)
    }
  }

  return { file_path, edits }
}

/**
 * Compare two sets of edits to determine if they are equivalent
 * by applying both sets to the original content and comparing results.
 * This handles cases where edits might be different but produce the same outcome.
 */
export function areFileEditsEquivalent(
  edits1: FileEdit[],
  edits2: FileEdit[],
  originalContent: string,
): boolean {
  // Fast path: check if edits are literally identical
  if (
    edits1.length === edits2.length &&
    edits1.every((edit1, index) => {
      const edit2 = edits2[index]
      return (
        edit2 !== undefined &&
        edit1.old_string === edit2.old_string &&
        edit1.new_string === edit2.new_string &&
        edit1.replace_all === edit2.replace_all
      )
    })
  ) {
    return true
  }

  // Try applying both sets of edits
  let result1: { patch: StructuredPatchHunk[]; updatedFile: string } | null =
    null
  let error1: string | null = null
  let result2: { patch: StructuredPatchHunk[]; updatedFile: string } | null =
    null
  let error2: string | null = null

  try {
    result1 = getPatchForEdits({
      filePath: 'temp',
      fileContents: originalContent,
      edits: edits1,
    })
  } catch (e) {
    error1 = errorMessage(e)
  }

  try {
    result2 = getPatchForEdits({
      filePath: 'temp',
      fileContents: originalContent,
      edits: edits2,
    })
  } catch (e) {
    error2 = errorMessage(e)
  }

  // If both threw errors, they're equal only if the errors are the same
  if (error1 !== null && error2 !== null) {
    // Normalize error messages for comparison
    return error1 === error2
  }

  // If one threw an error and the other didn't, they're not equal
  if (error1 !== null || error2 !== null) {
    return false
  }

  // Both succeeded - compare the results
  return result1!.updatedFile === result2!.updatedFile
}

/**
 * Unified function to check if two file edit inputs are equivalent.
 * Handles file edits (FileEditTool).
 */
export function areFileEditsInputsEquivalent(
  input1: {
    file_path: string
    edits: FileEdit[]
  },
  input2: {
    file_path: string
    edits: FileEdit[]
  },
): boolean {
  // Fast path: different files
  if (input1.file_path !== input2.file_path) {
    return false
  }

  // Fast path: literal equality
  if (
    input1.edits.length === input2.edits.length &&
    input1.edits.every((edit1, index) => {
      const edit2 = input2.edits[index]
      return (
        edit2 !== undefined &&
        edit1.old_string === edit2.old_string &&
        edit1.new_string === edit2.new_string &&
        edit1.replace_all === edit2.replace_all
      )
    })
  ) {
    return true
  }

  // Semantic comparison (requires file read). If the file doesn't exist,
  // compare against empty content (no TOCTOU pre-check).
  let fileContent = ''
  try {
    fileContent = readFileSyncCached(input1.file_path)
  } catch (error) {
    if (!isENOENT(error)) {
      throw error
    }
  }

  return areFileEditsEquivalent(input1.edits, input2.edits, fileContent)
}
