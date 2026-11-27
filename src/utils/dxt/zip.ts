import { isAbsolute, normalize } from 'path'
import { logForDebugging } from '../debug.js'
import { isENOENT } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { containsPathTraversal } from '../path.js'

const LIMITS = {
  MAX_FILE_SIZE: 512 * 1024 * 1024, // 512MB per file
  MAX_TOTAL_SIZE: 1024 * 1024 * 1024, // 1024MB total uncompressed
  MAX_FILE_COUNT: 100000, // Maximum number of files
  MAX_COMPRESSION_RATIO: 50, // Anything above 50:1 is suspicious
  MIN_COMPRESSION_RATIO: 0.5, // Below 0.5:1 might indicate already compressed malicious content
}

/**
 * State tracker for zip file validation during extraction
 */
type ZipValidationState = {
  fileCount: number
  totalUncompressedSize: number
  compressedSize: number
  errors: string[]
}

/**
 * File metadata from fflate filter
 */
type ZipFileMetadata = {
  name: string
  originalSize?: number
}

/**
 * Result of validating a single file in a zip archive
 */
type FileValidationResult = {
  isValid: boolean
  error?: string
}

/**
 * Validates a file path to prevent path traversal, NUL-byte injection,
 * Windows drive-relative paths, and NTFS Alternate Data Stream (ADS) attacks.
 */
export function isPathSafe(filePath: string): boolean {
  if (!filePath || filePath.includes('\0')) {
    return false
  }

  // Reject Windows drive-relative/drive-absolute paths (e.g. `C:foo`, `C:\foo`)
  // and NTFS Alternate Data Streams (`file.txt:stream`, `file.txt::$DATA`).
  if (/^[A-Za-z]:/.test(filePath) || filePath.includes(':')) {
    return false
  }

  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    return false
  }

  if (containsPathTraversal(filePath)) {
    return false
  }

  // Normalize the path to resolve any '.' segments
  const normalized = normalize(filePath)

  // Check for absolute paths (we only want relative paths in archives)
  if (isAbsolute(normalized)) {
    return false
  }

  return true
}

/**
 * Validates a single file during zip extraction
 */
export function validateZipFile(
  file: ZipFileMetadata,
  state: ZipValidationState,
): FileValidationResult {
  state.fileCount++

  let error: string | undefined

  // Check file count
  if (state.fileCount > LIMITS.MAX_FILE_COUNT) {
    error = `Archive contains too many files: ${state.fileCount} (max: ${LIMITS.MAX_FILE_COUNT})`
  }

  // Validate path safety
  if (!isPathSafe(file.name)) {
    error = `Unsafe file path detected: "${file.name}". Path traversal or absolute paths are not allowed.`
  }

  // Check individual file size
  const fileSize = file.originalSize || 0
  if (fileSize > LIMITS.MAX_FILE_SIZE) {
    error = `File "${file.name}" is too large: ${Math.round(fileSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_FILE_SIZE / 1024 / 1024)}MB)`
  }

  // Track total uncompressed size
  state.totalUncompressedSize += fileSize

  // Check total size
  if (state.totalUncompressedSize > LIMITS.MAX_TOTAL_SIZE) {
    error = `Archive total size is too large: ${Math.round(state.totalUncompressedSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_TOTAL_SIZE / 1024 / 1024)}MB)`
  }

  // Check compression ratio for zip bomb detection
  const currentRatio =
    state.compressedSize > 0
      ? state.totalUncompressedSize / state.compressedSize
      : state.totalUncompressedSize > 0
        ? Number.POSITIVE_INFINITY
        : 0
  if (currentRatio > LIMITS.MAX_COMPRESSION_RATIO) {
    error = `Suspicious compression ratio detected: ${currentRatio.toFixed(1)}:1 (max: ${LIMITS.MAX_COMPRESSION_RATIO}:1). This may be a zip bomb.`
  }

  return error ? { isValid: false, error } : { isValid: true }
}

const STREAM_PUSH_CHUNK_BYTES = 16 * 1024

/**
 * Pre-validate the ZIP Central Directory before streaming inflation:
 * - Rejects non-ZIP / truncated buffers missing EOCD (`0x06054b50`).
 * - Catches overlapping/shared-payload CD bombs (including spoofed `originalSize: 0`
 *   STORED entries referencing the same local header offset).
 * - Enforces `MAX_FILE_COUNT`, `isPathSafe`, `MAX_FILE_SIZE`, `MAX_TOTAL_SIZE`,
 *   and `MAX_COMPRESSION_RATIO` against Central Directory metadata.
 */
function validateCentralDirectoryBeforeStream(zipData: Buffer): void {
  if (zipData.length < 22) {
    throw new Error('Invalid zip data: archive too small')
  }
  const minEocd = Math.max(0, zipData.length - 22 - 0xffff)
  let eocd = -1
  for (let i = zipData.length - 22; i >= minEocd; i--) {
    if (zipData.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) {
    throw new Error('Invalid zip data: missing End of Central Directory')
  }

  const totalEntries = zipData.readUInt16LE(eocd + 10)
  const cdSize = zipData.readUInt32LE(eocd + 12)
  const cdOffset = zipData.readUInt32LE(eocd + 16)
  // ZIP64 sentinel values are validated during streaming decompression below.
  if (
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    return
  }
  if (cdOffset + cdSize > eocd) {
    throw new Error('Invalid zip data: central directory out of bounds')
  }

  const compressedArchiveSize = zipData.length
  const seenOffsets = new Set<number>()
  let count = 0
  let totalDeclaredSize = 0
  let pos = cdOffset
  const end = cdOffset + cdSize

  while (pos + 46 <= end && count < totalEntries) {
    if (zipData.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('Invalid zip data: corrupt central directory header')
    }
    const method = zipData.readUInt16LE(pos + 10)
    const entryCompressedSize = zipData.readUInt32LE(pos + 20)
    const entryUncompressedSize = zipData.readUInt32LE(pos + 24)
    const nameLen = zipData.readUInt16LE(pos + 28)
    const extraLen = zipData.readUInt16LE(pos + 30)
    const commentLen = zipData.readUInt16LE(pos + 32)
    const localHeaderOffset = zipData.readUInt32LE(pos + 42)

    if (pos + 46 + nameLen > end) {
      throw new Error('Invalid zip data: truncated central directory entry')
    }
    const name = zipData.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')
    count++

    if (count > LIMITS.MAX_FILE_COUNT) {
      throw new Error(
        `Archive contains too many files: ${count} (max: ${LIMITS.MAX_FILE_COUNT})`,
      )
    }
    if (!isPathSafe(name)) {
      throw new Error(
        `Unsafe file path detected: "${name}". Path traversal or absolute paths are not allowed.`,
      )
    }

    // For STORED entries (method === 0), actual extracted bytes equal compressedSize
    // even when uncompressedSize is spoofed to 0.
    const effectiveEntrySize =
      method === 0
        ? Math.max(entryUncompressedSize, entryCompressedSize)
        : entryUncompressedSize

    if (effectiveEntrySize > LIMITS.MAX_FILE_SIZE) {
      throw new Error(
        `File "${name}" is too large: ${Math.round(effectiveEntrySize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_FILE_SIZE / 1024 / 1024)}MB)`,
      )
    }
    totalDeclaredSize += effectiveEntrySize
    if (totalDeclaredSize > LIMITS.MAX_TOTAL_SIZE) {
      throw new Error(
        `Archive total size is too large: ${Math.round(totalDeclaredSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_TOTAL_SIZE / 1024 / 1024)}MB)`,
      )
    }
    const ratio =
      compressedArchiveSize > 0
        ? totalDeclaredSize / compressedArchiveSize
        : totalDeclaredSize > 0
          ? Number.POSITIVE_INFINITY
          : 0
    if (ratio > LIMITS.MAX_COMPRESSION_RATIO) {
      throw new Error(
        `Suspicious compression ratio detected: ${ratio.toFixed(1)}:1 (max: ${LIMITS.MAX_COMPRESSION_RATIO}:1). This may be a zip bomb.`,
      )
    }

    // Reject overlapping/shared local-header offset zip bombs.
    if (seenOffsets.has(localHeaderOffset)) {
      throw new Error(
        `Suspicious compression ratio detected: overlapping zip entries reference duplicate offset ${localHeaderOffset}. This may be a zip bomb.`,
      )
    }
    seenOffsets.add(localHeaderOffset)

    pos += 46 + nameLen + extraLen + commentLen
  }
}

/**
 * Unzips data from a Buffer and returns its contents as a record of file paths to Uint8Array data.
 * Uses streaming `fflate.Unzip` + `UnzipPassThrough` + `UnzipInflate` so zip bombs
 * (including archives with spoofed `originalSize: 0` headers) are aborted incrementally
 * inside `file.ondata` BEFORE memory is exhausted, while avoiding worker threads in Bun.
 *
 * fflate is lazy-imported to avoid its ~196KB of top-level lookup tables (revfd
 * Int32Array(32769), rev Uint16Array(32768), etc.) being allocated at startup
 * when this module is reached via the plugin loader chain.
 */
export async function unzipFile(
  zipData: Buffer,
): Promise<Record<string, Uint8Array>> {
  validateCentralDirectoryBeforeStream(zipData)

  const { Unzip, UnzipInflate, UnzipPassThrough } = await import('fflate')
  const compressedSize = zipData.length

  const headerState: ZipValidationState = {
    fileCount: 0,
    totalUncompressedSize: 0,
    compressedSize,
    errors: [],
  }

  const result: Record<string, Uint8Array> = {}
  let actualFileCount = 0
  let actualTotalSize = 0
  let streamError: Error | undefined

  const failStream = (err: Error, terminate?: () => void): void => {
    if (!streamError) {
      streamError = err
    }
    try {
      terminate?.()
    } catch {
      // ignore termination error
    }
  }

  const unzipper = new Unzip(file => {
    if (streamError) return

    // Validate header metadata & path safety BEFORE starting decompression.
    const validationResult = validateZipFile(
      { name: file.name, originalSize: file.originalSize },
      headerState,
    )
    if (!validationResult.isValid) {
      failStream(new Error(validationResult.error!))
      return
    }

    if (file.compression !== 0 && file.compression !== 8) {
      failStream(
        new Error(
          `Unsupported zip compression method ${file.compression} for "${file.name}"`,
        ),
      )
      return
    }

    actualFileCount++
    if (actualFileCount > LIMITS.MAX_FILE_COUNT) {
      failStream(
        new Error(
          `Archive contains too many files: ${actualFileCount} (max: ${LIMITS.MAX_FILE_COUNT})`,
        ),
      )
      return
    }

    const chunks: Uint8Array[] = []
    let actualFileSize = 0

    file.ondata = (err, data, final) => {
      if (streamError) {
        chunks.length = 0
        return
      }
      if (err) {
        chunks.length = 0
        failStream(err instanceof Error ? err : new Error(String(err)), () =>
          file.terminate(),
        )
        return
      }

      if (data && data.byteLength > 0) {
        actualFileSize += data.byteLength
        if (actualFileSize > LIMITS.MAX_FILE_SIZE) {
          chunks.length = 0
          failStream(
            new Error(
              `File "${file.name}" is too large: ${Math.round(actualFileSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_FILE_SIZE / 1024 / 1024)}MB)`,
            ),
            () => file.terminate(),
          )
          return
        }

        actualTotalSize += data.byteLength
        if (actualTotalSize > LIMITS.MAX_TOTAL_SIZE) {
          chunks.length = 0
          failStream(
            new Error(
              `Archive total size is too large: ${Math.round(actualTotalSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_TOTAL_SIZE / 1024 / 1024)}MB)`,
            ),
            () => file.terminate(),
          )
          return
        }

        const actualRatio =
          compressedSize > 0
            ? actualTotalSize / compressedSize
            : actualTotalSize > 0
              ? Number.POSITIVE_INFINITY
              : 0
        if (actualRatio > LIMITS.MAX_COMPRESSION_RATIO) {
          chunks.length = 0
          failStream(
            new Error(
              `Suspicious compression ratio detected: ${actualRatio.toFixed(1)}:1 (max: ${LIMITS.MAX_COMPRESSION_RATIO}:1). This may be a zip bomb.`,
            ),
            () => file.terminate(),
          )
          return
        }

        chunks.push(data)
      }

      if (final) {
        if (chunks.length === 0) {
          result[file.name] = new Uint8Array(0)
        } else if (chunks.length === 1) {
          result[file.name] = chunks[0]!
        } else {
          const combined = new Uint8Array(actualFileSize)
          let offset = 0
          for (const chunk of chunks) {
            combined.set(chunk, offset)
            offset += chunk.byteLength
          }
          result[file.name] = combined
        }
        chunks.length = 0
      }
    }

    file.start()
  })

  unzipper.register(UnzipPassThrough)
  unzipper.register(UnzipInflate)

  const bytes = new Uint8Array(
    zipData.buffer,
    zipData.byteOffset,
    zipData.byteLength,
  )
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += STREAM_PUSH_CHUNK_BYTES
  ) {
    if (streamError) break
    const end = Math.min(offset + STREAM_PUSH_CHUNK_BYTES, bytes.byteLength)
    const isFinal = end >= bytes.byteLength
    unzipper.push(bytes.subarray(offset, end), isFinal)
  }

  if (streamError) {
    throw streamError
  }

  logForDebugging(
    `Zip extraction completed: ${actualFileCount} files, ${Math.round(actualTotalSize / 1024)}KB uncompressed`,
  )

  return result
}

/**
 * Parse Unix file modes from a zip's central directory.
 *
 * fflate's `unzipSync` returns only `Record<string, Uint8Array>` — it does not
 * surface the external file attributes stored in the central directory. This
 * means executable bits are lost during extraction (everything becomes 0644).
 * The git-clone path preserves +x natively, but the GCS/zip path needs this
 * helper to keep parity.
 *
 * Returns `name → mode` for entries created on a Unix host (`versionMadeBy`
 * high byte === 3). Entries from other hosts, or with no mode bits set, are
 * omitted. Callers should treat a missing key as "use default mode".
 *
 * Format per PKZIP APPNOTE.TXT §4.3.12 (central directory) and §4.3.16 (EOCD).
 * ZIP64 is not handled — returns `{}` on archives >4GB or >65535 entries,
 * which is fine for marketplace zips (~3.5MB) and MCPB bundles.
 */
export function parseZipModes(data: Uint8Array): Record<string, number> {
  // Buffer view for readUInt* methods — shares memory, no copy.
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const modes: Record<string, number> = {}

  // 1. Find the End of Central Directory record (sig 0x06054b50). It lives in
  //    the trailing 22 + 65535 bytes (fixed EOCD size + max comment length).
  //    Scan backwards — the EOCD is typically the last 22 bytes.
  const minEocd = Math.max(0, buf.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return modes // malformed — let fflate's error surface elsewhere

  const entryCount = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16) // central directory start offset

  // 2. Walk central directory entries (sig 0x02014b50). Each entry has a
  //    46-byte fixed header followed by variable-length name/extra/comment.
  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break
    const versionMadeBy = buf.readUInt16LE(off + 4)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const externalAttr = buf.readUInt32LE(off + 38)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)

    // versionMadeBy high byte = host OS. 3 = Unix. For Unix zips, the high
    // 16 bits of externalAttr hold st_mode (file type + permission bits).
    if (versionMadeBy >> 8 === 3) {
      const mode = (externalAttr >>> 16) & 0xffff
      if (mode) modes[name] = mode
    }

    off += 46 + nameLen + extraLen + commentLen
  }

  return modes
}

/**
 * Reads a zip file from disk asynchronously and unzips it.
 * Returns its contents as a record of file paths to Uint8Array data.
 */
export async function readAndUnzipFile(
  filePath: string,
): Promise<Record<string, Uint8Array>> {
  const fs = getFsImplementation()

  try {
    const zipData = await fs.readFileBytes(filePath)
    // await is required here: without it, rejections from the now-async
    // unzipFile() escape the try/catch and bypass the error wrapping below.
    return await unzipFile(zipData)
  } catch (error) {
    if (isENOENT(error)) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read or unzip file: ${errorMessage}`)
  }
}
