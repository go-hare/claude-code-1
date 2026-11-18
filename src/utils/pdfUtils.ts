import { getMainLoopModel } from './model/model.js'

// Document extensions that are handled specially
export const DOCUMENT_EXTENSIONS = new Set(['pdf'])

/**
 * Parse a page range string into firstPage/lastPage numbers.
 * Supported formats:
 * - "5" → { firstPage: 5, lastPage: 5 }
 * - "1-10" → { firstPage: 1, lastPage: 10 }
 * - "3-" → { firstPage: 3, lastPage: Infinity }
 *
 * Returns null on invalid input (non-numeric, zero, inverted range).
 * Pages are 1-indexed.
 */
export function parsePDFPageRange(
  pages: string,
): { firstPage: number; lastPage: number } | null {
  const match = /^(\d{1,9})(?:\s*(-)\s*(\d{1,9})?)?$/.exec(pages.trim())
  if (!match) {
    return null
  }
  const [, firstStr, dash, lastStr] = match
  const firstPage = Number(firstStr)
  const lastPage = lastStr ? Number(lastStr) : dash ? Infinity : firstPage
  if (firstPage < 1 || lastPage < firstPage) {
    return null
  }
  return { firstPage, lastPage }
}

/**
 * Check if PDF reading is supported with the current model.
 * PDF document blocks work on all providers (1P, Vertex, Bedrock, Foundry).
 * Haiku 3 is the only remaining model that predates PDF support; users on
 * it fall back to the page-extraction path (poppler-utils). Substring match
 * covers all provider ID formats (Bedrock prefixes, Vertex @-dates).
 */
export function isPDFSupported(): boolean {
  return !getMainLoopModel().toLowerCase().includes('claude-3-haiku')
}

/**
 * Check if a file extension is a PDF document.
 * @param ext File extension (with or without leading dot)
 */
export function isPDFExtension(ext: string): boolean {
  const normalized = ext.startsWith('.') ? ext.slice(1) : ext
  return DOCUMENT_EXTENSIONS.has(normalized.toLowerCase())
}
