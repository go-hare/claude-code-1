/**
 * Last auto-update result persistence and formatting.
 * Aligns with official 2.1.328 `gRt` / `f1o` / `E(lastUpdateResult)`.
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import stripAnsi from 'strip-ansi'
import { z } from 'zod/v4'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'
import { jsonParse, jsonStringify } from './slowOperations.js'

export type UpdateResultPath = 'npm-global' | 'npm-local' | 'native'

export type LastUpdateResult = {
  timestamp: string
  path: UpdateResultPath
  outcome: 'success' | 'failed'
  status: string
  version_from: string
  version_to: string | null
  error_code: string | null
}

const lastUpdateResultSchema = z.object({
  timestamp: z.string(),
  path: z.enum(['npm-global', 'npm-local', 'native']),
  outcome: z.enum(['success', 'failed']),
  status: z.string(),
  version_from: z.string(),
  version_to: z.string().nullable(),
  error_code: z.string().nullable(),
})

export function getLastUpdateResultPath(): string {
  return join(getClaudeConfigHomeDir(), '.last-update-result.json')
}

/**
 * Atomically persist the most recent update result (temp file + rename).
 * Best-effort: failures are logged and never thrown.
 */
export function saveLastUpdateResult(result: LastUpdateResult): void {
  const targetPath = getLastUpdateResultPath()
  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`
  try {
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(tempPath, jsonStringify(result), { encoding: 'utf8' })
    renameSync(tempPath, targetPath)
  } catch (err) {
    try {
      unlinkSync(tempPath)
    } catch {
      // Ignore cleanup failure
    }
    logForDebugging(`Failed to record update result: ${err}`, {
      level: 'error',
    })
  }
}

/**
 * Read and Zod-validate the persisted last update result.
 * Returns null if absent, unreadable, or invalid.
 */
export function getLastUpdateResult(): LastUpdateResult | null {
  const targetPath = getLastUpdateResultPath()
  let raw: string
  try {
    raw = readFileSync(targetPath, { encoding: 'utf8' })
  } catch (err) {
    if (!isENOENT(err)) {
      logForDebugging(`Failed to read update result: ${err}`, {
        level: 'error',
      })
    }
    return null
  }
  try {
    const parsed = lastUpdateResultSchema.safeParse(jsonParse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function sanitizeDisplayText(value: string): string {
  return stripAnsi(value).replaceAll('`', '')
}

/**
 * Format the last update result for `claude doctor` display.
 * Matches official 2.1.328 `E(t.lastUpdateResult)`.
 */
export function formatLastUpdateResult(
  result: LastUpdateResult | null | undefined,
): string {
  if (!result) {
    return 'none recorded'
  }
  const date = sanitizeDisplayText(result.timestamp.slice(0, 10))
  switch (result.outcome) {
    case 'success':
      return result.version_to
        ? `success → ${sanitizeDisplayText(result.version_to)} (${date})`
        : `success (${date})`
    case 'failed':
      return `failed (${sanitizeDisplayText(result.status)}) — ${date}`
  }
}
