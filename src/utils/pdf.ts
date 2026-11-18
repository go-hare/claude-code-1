import { randomUUID } from 'crypto'
import { constants } from 'fs'
import { mkdir, open, readdir, type FileHandle } from 'fs/promises'
import { join } from 'path'
import {
  PDF_MAX_EXTRACT_SIZE,
  PDF_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { errorMessage } from './errors.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { formatFileSize } from './format.js'
import { getPlatform } from './platform.js'
import { getToolResultsDir } from './toolResultStorage.js'

const READ_CHUNK_SIZE = 1048576 // 1 MiB (SEA wSt Bus)
const PDFINFO_TIMEOUT_MS = 10_000
const PDF_PAGES_RE = /(?:^|\n)Pages:[ \t]+(\d+)[ \t\r]*(?=\n|$)/g

function openReadOnlyFlags(): number {
  const nonBlock = getPlatform() === 'windows' ? 0 : (constants.O_NONBLOCK ?? 0)
  return constants.O_RDONLY | nonBlock
}

/**
 * SEA `wSt` — read `size` bytes from an already-opened `FileHandle` using
 * explicit positional offsets so no second path-based open is performed.
 */
export async function readBytesFromHandle(
  handle: FileHandle,
  size: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const buf = Buffer.allocUnsafe(size)
  let offset = 0
  while (offset < size) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    const { bytesRead } = await handle.read(
      buf,
      offset,
      Math.min(READ_CHUNK_SIZE, size - offset),
      offset,
    )
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buf.subarray(0, offset)
}

export type PDFError = {
  reason:
    | 'empty'
    | 'too_large'
    | 'password_protected'
    | 'corrupted'
    | 'unknown'
    | 'unavailable'
  message: string
}

export type PDFResult<T> =
  | { success: true; data: T }
  | { success: false; error: PDFError }

export type PDFReadPayload = {
  type: 'pdf'
  file: {
    filePath: string
    base64: string
    originalSize: number
  }
}

/**
 * SEA `w3n` — read a PDF directly from a held `FileHandle` without reopening by path.
 */
export async function readPDFFromHandle(
  handle: FileHandle,
  filePath: string,
  signal?: AbortSignal,
): Promise<PDFResult<PDFReadPayload>> {
  try {
    const stats = await handle.stat()
    const originalSize = stats.size

    if (originalSize === 0) {
      return {
        success: false,
        error: { reason: 'empty', message: `PDF file is empty: ${filePath}` },
      }
    }

    if (originalSize > PDF_TARGET_RAW_SIZE) {
      return {
        success: false,
        error: {
          reason: 'too_large',
          message: `PDF file exceeds maximum allowed size of ${formatFileSize(PDF_TARGET_RAW_SIZE)}.`,
        },
      }
    }

    const fileBuffer = await readBytesFromHandle(handle, originalSize, signal)
    const header = fileBuffer.subarray(0, 5).toString('ascii')
    if (!header.startsWith('%PDF-')) {
      return {
        success: false,
        error: {
          reason: 'corrupted',
          message: `File is not a valid PDF (missing %PDF- header): ${filePath}`,
        },
      }
    }

    return {
      success: true,
      data: {
        type: 'pdf',
        file: {
          filePath,
          base64: fileBuffer.toString('base64'),
          originalSize,
        },
      },
    }
  } catch (e: unknown) {
    return {
      success: false,
      error: {
        reason: 'unknown',
        message: errorMessage(e),
      },
    }
  }
}

/**
 * Read a PDF file and return it as base64-encoded data.
 * Accepts either a held `FileHandle` (SEA `w3n` path, no second path open) or a file path.
 */
export async function readPDF(
  filePathOrHandle: string | FileHandle,
  displayPath?: string,
  signal?: AbortSignal,
): Promise<PDFResult<PDFReadPayload>> {
  if (typeof filePathOrHandle !== 'string') {
    return readPDFFromHandle(filePathOrHandle, displayPath ?? '', signal)
  }
  const filePath = displayPath ?? filePathOrHandle
  let handle: FileHandle | undefined
  try {
    handle = await open(filePathOrHandle, openReadOnlyFlags())
    return await readPDFFromHandle(handle, filePath, signal)
  } catch (e: unknown) {
    return {
      success: false,
      error: {
        reason: 'unknown',
        message: errorMessage(e),
      },
    }
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * Get the number of pages in a PDF file using `pdfinfo` (from poppler-utils).
 * When `held` is provided, reads from the held `FileHandle` via stdin (`-`)
 * so no second path-based open occurs (SEA `vHe`).
 */
export async function getPDFPageCount(
  filePath: string,
  held?: { handle: FileHandle; size: number; signal?: AbortSignal },
): Promise<number | null> {
  if (held !== undefined) {
    if (held.size > PDF_MAX_EXTRACT_SIZE) {
      return null
    }
    try {
      const timeoutSignal = AbortSignal.timeout(PDFINFO_TIMEOUT_MS)
      const combinedSignal = held.signal
        ? AbortSignal.any([held.signal, timeoutSignal])
        : timeoutSignal
      const bytes = await readBytesFromHandle(
        held.handle,
        held.size,
        combinedSignal,
      )
      const { code, stdout } = await execFileNoThrow('pdfinfo', ['-'], {
        timeout: PDFINFO_TIMEOUT_MS,
        useCwd: false,
        abortSignal: held.signal,
        input: bytes as unknown as string,
      })
      if (code !== 0) return null
      let pageCount: number | undefined
      for (const match of stdout.matchAll(PDF_PAGES_RE)) {
        const parsed = Number(match[1])
        if (Number.isSafeInteger(parsed) && parsed >= (pageCount ?? 0)) {
          pageCount = parsed
        }
      }
      return pageCount ?? null
    } catch {
      return null
    }
  }

  const { code, stdout } = await execFileNoThrow('pdfinfo', [filePath], {
    timeout: PDFINFO_TIMEOUT_MS,
    useCwd: false,
  })
  if (code !== 0) {
    return null
  }
  let pageCount: number | undefined
  for (const match of stdout.matchAll(PDF_PAGES_RE)) {
    const parsed = Number(match[1])
    if (Number.isSafeInteger(parsed) && parsed >= (pageCount ?? 0)) {
      pageCount = parsed
    }
  }
  return pageCount ?? null
}

export type PDFExtractPagesResult = {
  type: 'parts'
  file: {
    filePath: string
    originalSize: number
    count: number
    outputDir: string
  }
}

let pdftoppmAvailable: boolean | undefined

/**
 * Reset the pdftoppm availability cache. Used by tests only.
 */
export function resetPdftoppmCache(): void {
  pdftoppmAvailable = undefined
}

/**
 * Check whether the `pdftoppm` binary (from poppler-utils) is available.
 * The result is cached for the lifetime of the process.
 */
export async function isPdftoppmAvailable(): Promise<boolean> {
  if (pdftoppmAvailable !== undefined) return pdftoppmAvailable
  const { code, stderr } = await execFileNoThrow('pdftoppm', ['-v'], {
    timeout: 5000,
    useCwd: false,
  })
  // pdftoppm prints version info to stderr and exits 0 (or sometimes 99 on older versions)
  pdftoppmAvailable = code === 0 || stderr.length > 0
  return pdftoppmAvailable
}

/**
 * Extract PDF pages as JPEG images using pdftoppm.
 * Produces page-01.jpg, page-02.jpg, etc. in an output directory.
 * This enables reading large PDFs and works with all API providers.
 *
 * @param filePath Path to the PDF file
 * @param options Optional page range (1-indexed, inclusive)
 */
export async function extractPDFPages(
  filePath: string,
  options?: {
    firstPage?: number
    lastPage?: number
    held?: FileHandle
    signal?: AbortSignal
  },
): Promise<PDFResult<PDFExtractPagesResult>> {
  let ownedHandle: FileHandle | undefined
  try {
    const heldHandle = options?.held
    const handle = heldHandle ?? (await open(filePath, openReadOnlyFlags()))
    if (!heldHandle) ownedHandle = handle

    const stats = await handle.stat().finally(async () => {
      if (ownedHandle) {
        await ownedHandle.close().catch(() => {})
        ownedHandle = undefined
      }
    })
    if (!stats.isFile()) {
      return {
        success: false,
        error: {
          reason: 'corrupted',
          message: `Path is not a regular file: ${filePath}`,
        },
      }
    }
    const originalSize = stats.size

    if (originalSize === 0) {
      return {
        success: false,
        error: { reason: 'empty', message: `PDF file is empty: ${filePath}` },
      }
    }

    if (originalSize > PDF_MAX_EXTRACT_SIZE) {
      return {
        success: false,
        error: {
          reason: 'too_large',
          message: `PDF file exceeds maximum allowed size for text extraction (${formatFileSize(PDF_MAX_EXTRACT_SIZE)}).`,
        },
      }
    }

    if (options?.signal?.aborted) {
      return {
        success: false,
        error: { reason: 'unknown', message: 'PDF extraction aborted.' },
      }
    }

    const available = await isPdftoppmAvailable()
    if (!available) {
      return {
        success: false,
        error: {
          reason: 'unavailable',
          message:
            'pdftoppm is not installed. Install poppler-utils (e.g. `brew install poppler` or `apt-get install poppler-utils`) to enable PDF page rendering.',
        },
      }
    }

    const procFdHandle =
      heldHandle !== undefined && filePath === `/proc/self/fd/${heldHandle.fd}`
        ? heldHandle
        : undefined
    const heldBytes =
      heldHandle !== undefined && procFdHandle === undefined
        ? await readBytesFromHandle(heldHandle, originalSize, options?.signal)
        : undefined

    const uuid = randomUUID()
    const outputDir = join(getToolResultsDir(), `pdf-${uuid}`)
    await mkdir(outputDir, { recursive: true })

    // pdftoppm produces files like <prefix>-01.jpg, <prefix>-02.jpg, etc.
    const prefix = join(outputDir, 'page')
    const args = ['-jpeg', '-r', '100']
    if (options?.firstPage) {
      args.push('-f', String(options.firstPage))
    }
    if (options?.lastPage && options.lastPage !== Infinity) {
      args.push('-l', String(options.lastPage))
    }
    const inputArg =
      procFdHandle !== undefined
        ? '/proc/self/fd/3'
        : heldBytes !== undefined
          ? '-'
          : filePath
    args.push(inputArg, prefix)
    const { code, stderr } = await execFileNoThrow('pdftoppm', args, {
      timeout: 120_000,
      useCwd: false,
      abortSignal: options?.signal,
      ...(heldBytes !== undefined && {
        input: heldBytes as unknown as string,
      }),
      ...(procFdHandle !== undefined && {
        inheritFd: procFdHandle.fd,
      }),
    })

    if (code !== 0) {
      if (/password/i.test(stderr)) {
        return {
          success: false,
          error: {
            reason: 'password_protected',
            message:
              'PDF is password-protected. Please provide an unprotected version.',
          },
        }
      }
      if (/damaged|corrupt|invalid/i.test(stderr)) {
        return {
          success: false,
          error: {
            reason: 'corrupted',
            message: 'PDF file is corrupted or invalid.',
          },
        }
      }
      return {
        success: false,
        error: { reason: 'unknown', message: `pdftoppm failed: ${stderr}` },
      }
    }

    // Read generated image files and sort naturally
    const entries = await readdir(outputDir)
    const imageFiles = entries.filter(f => f.endsWith('.jpg')).sort()
    const pageCount = imageFiles.length

    if (pageCount === 0) {
      return {
        success: false,
        error: {
          reason: 'corrupted',
          message: 'pdftoppm produced no output pages. The PDF may be invalid.',
        },
      }
    }

    const count = imageFiles.length

    return {
      success: true,
      data: {
        type: 'parts',
        file: {
          filePath,
          originalSize,
          outputDir,
          count,
        },
      },
    }
  } catch (e: unknown) {
    return {
      success: false,
      error: {
        reason: 'unknown',
        message: errorMessage(e),
      },
    }
  } finally {
    await ownedHandle?.close().catch(() => {})
  }
}
