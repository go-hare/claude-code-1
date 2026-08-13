import figures from 'figures'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import { callIdeRpc } from '../services/mcp/client.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { ClaudeError } from '../utils/errors.js'
import { normalizePathForComparison, pathsEqual } from '../utils/file.js'
import { getConnectedIdeClient } from '../utils/ide.js'
import { every } from '../utils/set.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

class DiagnosticsTrackingError extends ClaudeError {}

/** densable QUd */
const MAX_DIAGNOSTICS_SUMMARY_CHARS = 4000

/**
 * densable sQ_ — strip leading `/` before Windows drive-letter URIs
 * (`/C:/…` or `\C:\…`) so path comparison matches IDE-normalized paths.
 */
const LEADING_SEP_DRIVE_LETTER = /^[\\/][A-Za-z]:[\\/]/

/** densable fvd — lowercase severity → LSP-style label. */
const DIAGNOSTIC_SEVERITY_BY_LOWER: Record<string, DiagnosticSeverity> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  information: 'Info',
  hint: 'Hint',
}

/**
 * densable Gjo — stable fingerprint for Set-based diagnostic equality.
 * Avoids O(n²) some/every scans when a file has thousands of diagnostics
 * (2.1.229 #15 multi-second UI stall).
 */
export function diagnosticFingerprint(d: Diagnostic): string {
  const t = d.range
  // Normalize code to string so number|string from LSP transports fingerprint equal.
  const code = d.code === undefined || d.code === null ? d.code : String(d.code)
  return jsonStringify([
    d.message,
    d.severity,
    d.source,
    code,
    t?.start?.line,
    t?.start?.character,
    t?.end?.line,
    t?.end?.character,
  ])
}

/**
 * densable OOo / pvd — dedupe drop logs for the same replayed payload.
 * WeakSet for object payloads (incl. the files array when counting drops);
 * Set for non-array kind tags ("missing" | "non-array").
 */
const sanitizedDiagnosticObjectPayloads = new WeakSet<object>()
const nonArrayDiagnosticsPayloadKinds = new Set<string>()

export type DiagnosticSeverity = 'Error' | 'Warning' | 'Info' | 'Hint'

export interface Diagnostic {
  message: string
  /** Optional after densable sanitize — unmapped/missing severity is omitted. */
  severity?: DiagnosticSeverity
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  source?: string
  code?: string
}

export interface DiagnosticFile {
  uri: string
  diagnostics: Diagnostic[]
}

/**
 * densable Ruy — map free-form severity strings to DiagnosticSeverity.
 * Non-strings / unknown labels → undefined (field omitted on sanitized diag).
 */
export function mapDiagnosticSeverity(
  value: unknown,
): DiagnosticSeverity | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.toLowerCase()
  return Object.hasOwn(DIAGNOSTIC_SEVERITY_BY_LOWER, key)
    ? DIAGNOSTIC_SEVERITY_BY_LOWER[key]
    : undefined
}

/** Test helper — reset densable OOo/pvd drop-log latches. */
export function clearDiagnosticSanitizeLatchesForTests(): void {
  nonArrayDiagnosticsPayloadKinds.clear()
  // WeakSet cannot be cleared; tests that need re-log should use fresh objects.
}

export class DiagnosticTrackingService {
  private static instance: DiagnosticTrackingService | undefined
  private baseline: Map<string, Diagnostic[]> = new Map()

  private initialized = false
  private mcpClient: MCPServerConnection | undefined

  // Track when files were last processed/fetched
  private lastProcessedTimestamps: Map<string, number> = new Map()

  // Track which files have received right file diagnostics and if they've changed
  // Map<normalizedPath, lastClaudeFsRightDiagnostics>
  private rightFileDiagnosticsState: Map<string, Diagnostic[]> = new Map()

  static getInstance(): DiagnosticTrackingService {
    if (!DiagnosticTrackingService.instance) {
      DiagnosticTrackingService.instance = new DiagnosticTrackingService()
    }
    return DiagnosticTrackingService.instance
  }

  initialize(mcpClient: MCPServerConnection) {
    if (this.initialized) {
      return
    }

    // TODO: Do not cache the connected mcpClient since it can change.
    this.mcpClient = mcpClient
    this.initialized = true
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    this.baseline.clear()
    this.rightFileDiagnosticsState.clear()
    this.lastProcessedTimestamps.clear()
  }

  /**
   * Reset tracking state while keeping the service initialized.
   * This clears all tracked files and diagnostics.
   */
  reset() {
    this.baseline.clear()
    this.rightFileDiagnosticsState.clear()
    this.lastProcessedTimestamps.clear()
  }

  private normalizeFileUri(fileUri: string): string {
    // densable iQ_ — strip protocol prefixes
    const protocolPrefixes = [
      'file://',
      '_claude_fs_right:',
      '_claude_fs_left:',
    ]

    let normalized = fileUri
    let strippedPrefix = false
    for (const prefix of protocolPrefixes) {
      if (fileUri.startsWith(prefix)) {
        normalized = fileUri.slice(prefix.length)
        strippedPrefix = true
        break
      }
    }

    // densable sQ_ — after protocol strip, drop leading sep before drive letter
    if (strippedPrefix && LEADING_SEP_DRIVE_LETTER.test(normalized)) {
      normalized = normalized.slice(1)
    }

    // Use shared utility for platform-aware path normalization
    // (handles Windows case-insensitivity and path separators)
    return normalizePathForComparison(normalized)
  }

  /**
   * Ensure a file is opened in the IDE before processing.
   * This is important for language services like diagnostics to work properly.
   */
  async ensureFileOpened(fileUri: string): Promise<void> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return
    }

    try {
      // Call the openFile tool to ensure the file is loaded
      await callIdeRpc(
        'openFile',
        {
          filePath: fileUri,
          preview: false,
          startText: '',
          endText: '',
          selectToEndOfLine: false,
          makeFrontmost: false,
        },
        this.mcpClient,
      )
    } catch (error) {
      logError(error as Error)
    }
  }

  /**
   * Capture baseline diagnostics for a specific file before editing.
   * This is called before editing a file to ensure we have a baseline to compare against.
   */
  async beforeFileEdited(filePath: string): Promise<void> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return
    }

    const timestamp = Date.now()

    try {
      const result = await callIdeRpc(
        'getDiagnostics',
        { uri: `file://${filePath}` },
        this.mcpClient,
      )
      const diagnosticFile = this.parseDiagnosticResult(result)[0]
      if (diagnosticFile) {
        // Compare normalized paths (handles protocol prefixes and Windows case-insensitivity)
        if (
          !pathsEqual(
            this.normalizeFileUri(filePath),
            this.normalizeFileUri(diagnosticFile.uri),
          )
        ) {
          logError(
            new DiagnosticsTrackingError(
              `Diagnostics file path mismatch: expected ${filePath}, got ${diagnosticFile.uri})`,
            ),
          )
          return
        }

        // Store with normalized path key for consistent lookups on Windows
        const normalizedPath = this.normalizeFileUri(filePath)
        this.baseline.set(normalizedPath, diagnosticFile.diagnostics)
        this.lastProcessedTimestamps.set(normalizedPath, timestamp)
      } else {
        // No diagnostic file returned, store an empty baseline
        const normalizedPath = this.normalizeFileUri(filePath)
        this.baseline.set(normalizedPath, [])
        this.lastProcessedTimestamps.set(normalizedPath, timestamp)
      }
    } catch (_error) {
      // Fail silently if IDE doesn't support diagnostics
    }
  }

  /**
   * Get new diagnostics from file://, _claude_fs_right, and _claude_fs_ URIs that aren't in the baseline.
   * Only processes diagnostics for files that have been edited.
   */
  async getNewDiagnostics(): Promise<DiagnosticFile[]> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return []
    }

    // densable: skip IDE round-trip when no edited-file baselines
    if (this.baseline.size === 0) {
      return []
    }

    // Check if we have any files with diagnostic changes
    let allDiagnosticFiles: DiagnosticFile[] = []
    try {
      const result = await callIdeRpc(
        'getDiagnostics',
        {}, // Empty params fetches all diagnostics
        this.mcpClient,
      )
      allDiagnosticFiles = this.parseDiagnosticResult(result)
    } catch (_error) {
      // If fetching all diagnostics fails, return empty
      return []
    }

    // densable single-pass: file:// rows + _claude_fs_right map, baseline only
    const diagnosticsForFileUrisWithBaselines: Array<{
      file: DiagnosticFile
      normalizedPath: string
    }> = []
    const diagnosticsForClaudeFsRightUrisWithBaselinesMap = new Map<
      string,
      DiagnosticFile
    >()
    for (const file of allDiagnosticFiles) {
      const isFileUri = file.uri.startsWith('file://')
      if (!isFileUri && !file.uri.startsWith('_claude_fs_right:')) continue
      const normalizedPath = this.normalizeFileUri(file.uri)
      if (!this.baseline.has(normalizedPath)) continue
      if (isFileUri) {
        diagnosticsForFileUrisWithBaselines.push({ file, normalizedPath })
      } else {
        diagnosticsForClaudeFsRightUrisWithBaselinesMap.set(
          normalizedPath,
          file,
        )
      }
    }

    const newDiagnosticFiles: DiagnosticFile[] = []

    // Process file:// protocol diagnostics
    for (const {
      file,
      normalizedPath,
    } of diagnosticsForFileUrisWithBaselines) {
      const baselineDiagnostics = this.baseline.get(normalizedPath) || []

      // Get the _claude_fs_right file if it exists
      const claudeFsRightFile =
        diagnosticsForClaudeFsRightUrisWithBaselinesMap.get(normalizedPath)

      // Determine which file to use based on the state of right file diagnostics
      let fileToUse = file

      if (claudeFsRightFile) {
        const previousRightDiagnostics =
          this.rightFileDiagnosticsState.get(normalizedPath)

        // Use _claude_fs_right if:
        // 1. We've never gotten right file diagnostics for this file (previousRightDiagnostics === undefined)
        // 2. OR the right file diagnostics have just changed
        if (
          !previousRightDiagnostics ||
          !this.areDiagnosticArraysEqual(
            previousRightDiagnostics,
            claudeFsRightFile.diagnostics,
          )
        ) {
          fileToUse = claudeFsRightFile
        }

        // Update our tracking of right file diagnostics
        this.rightFileDiagnosticsState.set(
          normalizedPath,
          claudeFsRightFile.diagnostics,
        )
      }

      // densable Gjo Set membership — O(n) not O(n²)
      const baselineFingerprints = new Set(
        baselineDiagnostics.map(diagnosticFingerprint),
      )
      const newDiagnostics = fileToUse.diagnostics.filter(
        d => !baselineFingerprints.has(diagnosticFingerprint(d)),
      )

      if (newDiagnostics.length > 0) {
        newDiagnosticFiles.push({
          uri: file.uri,
          diagnostics: newDiagnostics,
        })
      }

      // Update baseline with current diagnostics
      this.baseline.set(normalizedPath, fileToUse.diagnostics)
    }

    return newDiagnosticFiles
  }

  private parseDiagnosticResult(result: unknown): DiagnosticFile[] {
    if (Array.isArray(result)) {
      const textBlock = result.find(block => block.type === 'text')
      if (textBlock && 'text' in textBlock) {
        const parsed = jsonParse(textBlock.text)
        return parsed
      }
    }
    return []
  }

  /**
   * densable areDiagnosticArraysEqual via Gjo fingerprints + V2o set subset.
   * Set membership is O(n); previous some/every was O(n²) and stalled the UI
   * on files with thousands of IDE diagnostics (2.1.229 #15).
   */
  private areDiagnosticArraysEqual(a: Diagnostic[], b: Diagnostic[]): boolean {
    if (a.length !== b.length) return false
    const setA = new Set(a.map(diagnosticFingerprint))
    const setB = new Set(b.map(diagnosticFingerprint))
    return setA.size === setB.size && every(setA, setB)
  }

  /**
   * Handle the start of a new query. This method:
   * - Initializes the diagnostic tracker if not already initialized
   * - Resets the tracker if already initialized (for new query loops)
   * - Automatically finds the IDE client from the provided clients list
   *
   * @param clients Array of MCP clients that may include an IDE client
   * @param shouldQuery Whether a query is actually being made (not just a command)
   */
  async handleQueryStart(clients: MCPServerConnection[]): Promise<void> {
    // Only proceed if we should query and have clients
    if (!this.initialized) {
      // Find the connected IDE client
      const connectedIdeClient = getConnectedIdeClient(clients)

      if (connectedIdeClient) {
        this.initialize(connectedIdeClient)
      }
    } else {
      // Reset diagnostic tracking for new query loops
      this.reset()
    }
  }

  /**
   * densable 2.1.223 #14 — `sanitizeDiagnosticFiles` 1:1.
   *
   * Resume/history may hold malformed diagnostics attachments (null entries,
   * missing uri/diagnostics, non-number range.start, non-array payload).
   * Sanitize before format so we never TypeError on destructure / .map.
   *
   * Gold drop strings:
   * - `Dropped a ${missing|non-array} diagnostics files payload from a replayed attachment`
   * - `Dropped N malformed file(s) and M malformed diagnostic(s) from a replayed diagnostics attachment`
   */
  static sanitizeDiagnosticFiles(files: unknown): DiagnosticFile[] {
    if (!Array.isArray(files)) {
      const kind = files === undefined ? 'missing' : 'non-array'
      const isObjectPayload = typeof files === 'object' && files !== null
      if (
        !(isObjectPayload
          ? sanitizedDiagnosticObjectPayloads.has(files)
          : nonArrayDiagnosticsPayloadKinds.has(kind))
      ) {
        if (isObjectPayload) {
          sanitizedDiagnosticObjectPayloads.add(files)
        } else {
          nonArrayDiagnosticsPayloadKinds.add(kind)
        }
        logForDebugging(
          `Dropped a ${kind} diagnostics files payload from a replayed attachment`,
          { level: 'error' },
        )
      }
      return []
    }

    const out: DiagnosticFile[] = []
    let droppedFiles = 0
    let droppedDiagnostics = 0

    for (const file of files) {
      if (
        typeof file !== 'object' ||
        file === null ||
        typeof (file as { uri?: unknown }).uri !== 'string' ||
        !Array.isArray((file as { diagnostics?: unknown }).diagnostics)
      ) {
        droppedFiles += 1
        continue
      }

      const uri = (file as { uri: string }).uri
      const rawDiags = (file as { diagnostics: unknown[] }).diagnostics
      const diagnostics = rawDiags.flatMap((d): Diagnostic[] => {
        if (typeof d !== 'object' || d === null) return []
        const raw = d as {
          message?: unknown
          severity?: unknown
          range?: {
            start?: { line?: unknown; character?: unknown }
            end?: { line?: unknown; character?: unknown }
          }
          source?: unknown
          code?: unknown
        }
        const message = raw.message
        const start = raw.range?.start
        if (
          typeof message !== 'string' ||
          typeof start?.line !== 'number' ||
          typeof start?.character !== 'number'
        ) {
          return []
        }
        const severity = mapDiagnosticSeverity(raw.severity)
        const end = raw.range?.end
        const endLine = end?.line
        const endCharacter = end?.character
        const rangeEnd =
          typeof endLine === 'number' && typeof endCharacter === 'number'
            ? { line: endLine, character: endCharacter }
            : { line: start.line, character: start.character }

        const cleaned: Diagnostic = {
          message,
          ...(severity !== undefined ? { severity } : {}),
          range: {
            start: { line: start.line, character: start.character },
            end: rangeEnd,
          },
          ...(typeof raw.code === 'string' ? { code: raw.code } : {}),
          ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
        }
        return [cleaned]
      })

      droppedDiagnostics += rawDiags.length - diagnostics.length
      if (diagnostics.length === 0) {
        droppedFiles += 1
        continue
      }
      out.push({ uri, diagnostics })
    }

    if (
      (droppedFiles > 0 || droppedDiagnostics > 0) &&
      !sanitizedDiagnosticObjectPayloads.has(files)
    ) {
      sanitizedDiagnosticObjectPayloads.add(files)
      logForDebugging(
        `Dropped ${droppedFiles} malformed file(s) and ${droppedDiagnostics} malformed diagnostic(s) from a replayed diagnostics attachment`,
        { level: 'error' },
      )
    }

    return out
  }

  /**
   * Format diagnostics into a human-readable summary string.
   * This is useful for displaying diagnostics in messages or logs.
   *
   * @param files Array of diagnostic files to format
   * @returns Formatted string representation of the diagnostics
   */
  static formatDiagnosticsSummary(files: DiagnosticFile[]): string {
    const truncationMarker = '…[truncated]'
    const result = files
      .map(file => {
        const filename = file.uri.split('/').pop() || file.uri
        const diagnostics = file.diagnostics
          .map(d => {
            const severitySymbol = DiagnosticTrackingService.getSeveritySymbol(
              d.severity,
            )

            return `  ${severitySymbol} [Line ${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}${d.code ? ` [${d.code}]` : ''}${d.source ? ` (${d.source})` : ''}`
          })
          .join('\n')

        return `${filename}:\n${diagnostics}`
      })
      .join('\n\n')

    if (result.length > MAX_DIAGNOSTICS_SUMMARY_CHARS) {
      return (
        result.slice(
          0,
          MAX_DIAGNOSTICS_SUMMARY_CHARS - truncationMarker.length,
        ) + truncationMarker
      )
    }
    return result
  }

  /**
   * densable getSeveritySymbol — non-string / unknown → bullet.
   */
  static getSeveritySymbol(
    severity: DiagnosticSeverity | string | undefined,
  ): string {
    if (typeof severity !== 'string') return figures.bullet
    const symbols: Record<DiagnosticSeverity, string> = {
      Error: figures.cross,
      Warning: figures.warning,
      Info: figures.info,
      Hint: figures.star,
    }
    return Object.hasOwn(symbols, severity)
      ? symbols[severity as DiagnosticSeverity]
      : figures.bullet
  }
}

export const diagnosticTracker = DiagnosticTrackingService.getInstance()
