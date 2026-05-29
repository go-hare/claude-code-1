/**
 * Dispatch Watcher — watches a directory for dispatch request files.
 *
 * Upstream equivalent: `SG_` (startDispatchWatcher) / `hG_` (ingestDispatchFile).
 *
 * FleetView writes dispatch JSON files to ~/.claude/daemon/bg/dispatch/.
 * The daemon watches this directory and picks up new dispatches.
 * Files are deleted after ingestion.
 */

import { watch, type FSWatcher } from 'fs'
import { readdir, readFile, unlink, mkdir, rename } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import type { DispatchRequest } from './bgManager.js'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getDispatchDir(): string {
  return join(getClaudeConfigHomeDir(), 'daemon', 'bg', 'dispatch')
}

function getRejectedDir(): string {
  return join(getDispatchDir(), 'rejected')
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

export async function startDispatchWatcher(
  onDispatch: (dispatch: DispatchRequest) => void,
  log: (msg: string) => void,
): Promise<{ close: () => void }> {
  const dir = getDispatchDir()
  await mkdir(dir, { recursive: true })

  let watcher: FSWatcher | null = null

  try {
    watcher = watch(dir, async (_event, filename) => {
      if (!filename) return
      if (!filename.endsWith('.json')) return
      if (filename.endsWith('.tmp')) return
      if (filename === 'rejected') return

      // Small delay to ensure file write is complete (Windows)
      await new Promise(r => setTimeout(r, 50))
      await ingestFile(join(dir, filename), onDispatch, log)
    })

    watcher.on('error', err => {
      log(`[dispatch-watcher] error: ${err.message}`)
    })
  } catch (err) {
    log(
      `[dispatch-watcher] fs.watch failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Drain any existing files on startup
  await drainDir(dir, onDispatch, log)

  return {
    close() {
      watcher?.close()
      watcher = null
    },
  }
}

// ---------------------------------------------------------------------------
// File Ingestion
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 262_144 // 256KB
const MAX_STALE_MS = 86_400_000 // 24h

async function ingestFile(
  filePath: string,
  onDispatch: (dispatch: DispatchRequest) => void,
  log: (msg: string) => void,
): Promise<void> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch {
    // File may have been deleted already (race) — ignore
    return
  }

  if (raw.length > MAX_FILE_SIZE) {
    log(`[dispatch-watcher] oversized file: ${filePath}`)
    await rejectFile(filePath, 'oversized')
    return
  }

  let dispatch: DispatchRequest
  try {
    dispatch = jsonParse(raw) as DispatchRequest
  } catch {
    log(`[dispatch-watcher] invalid JSON: ${filePath}`)
    await rejectFile(filePath, 'bad_json')
    return
  }

  // Validate required fields
  if (!dispatch.short || !dispatch.sessionId || !dispatch.intent) {
    log(`[dispatch-watcher] missing fields: ${filePath}`)
    await rejectFile(filePath, 'schema')
    return
  }

  // Check staleness
  if (Date.now() - dispatch.createdAt > MAX_STALE_MS) {
    log(`[dispatch-watcher] stale dispatch: ${dispatch.short}`)
    await rejectFile(filePath, 'stale')
    return
  }

  // Dispatch and delete
  onDispatch(dispatch)
  await unlink(filePath).catch(() => {})
}

async function rejectFile(filePath: string, reason: string): Promise<void> {
  const rejectedDir = getRejectedDir()
  await mkdir(rejectedDir, { recursive: true }).catch(() => {})
  const basename = filePath.split(/[/\\]/).pop() ?? 'unknown'
  await rename(filePath, join(rejectedDir, basename)).catch(() =>
    unlink(filePath).catch(() => {}),
  )
}

async function drainDir(
  dir: string,
  onDispatch: (dispatch: DispatchRequest) => void,
  log: (msg: string) => void,
): Promise<void> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    if (file.endsWith('.tmp')) continue
    await ingestFile(join(dir, file), onDispatch, log)
  }
}

// ---------------------------------------------------------------------------
// Dispatch File Writer (used by FleetView / CLI to submit dispatches)
// ---------------------------------------------------------------------------

/**
 * Write a dispatch request file to the dispatch directory.
 * Uses atomic rename to prevent partial reads.
 */
export async function writeDispatchFile(
  dispatch: DispatchRequest,
): Promise<void> {
  const dir = getDispatchDir()
  await mkdir(dir, { recursive: true })

  const tmpFile = join(dir, `${dispatch.short}.tmp`)
  const finalFile = join(dir, `${dispatch.short}.json`)

  const { writeFile } = await import('fs/promises')
  await writeFile(tmpFile, jsonStringify(dispatch), 'utf-8')
  await rename(tmpFile, finalFile)
}
