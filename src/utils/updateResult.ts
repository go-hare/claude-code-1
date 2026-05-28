/**
 * Persists the result of the last update attempt so /doctor can display it.
 */

import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { getClaudeConfigHomeDir } from './envUtils.js'

export type LastUpdateResult = {
  timestamp: string
  success: boolean
  fromVersion?: string
  toVersion?: string
  error?: string
}

function getUpdateResultPath(): string {
  return join(getClaudeConfigHomeDir(), '.last-update-result.json')
}

export async function saveLastUpdateResult(
  result: LastUpdateResult,
): Promise<void> {
  try {
    await writeFile(getUpdateResultPath(), JSON.stringify(result))
  } catch {
    // Best-effort — don't crash if we can't write
  }
}

export async function loadLastUpdateResult(): Promise<LastUpdateResult | null> {
  try {
    const raw = await readFile(getUpdateResultPath(), 'utf-8')
    return JSON.parse(raw) as LastUpdateResult
  } catch {
    return null
  }
}
