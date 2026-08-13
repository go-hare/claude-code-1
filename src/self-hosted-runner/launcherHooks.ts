/**
 * densable 2.1.229 #2 — CCR server-supplied Claude Code hooks for SHR
 * (gjw / yjw / Pyg / a7i / hjw / mjw / myg).
 *
 * Remote session config `launcher_hooks` materializes to:
 *   CLAUDE_CONFIG_DIR/hooks/.ccr-launcher/<filename>
 *   CLAUDE_CONFIG_DIR/launcher-settings.json  { hooks: … }
 * Child spawn gets `--settings <launcher-settings.json>`.
 */
import { lstat, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { getErrnoCode } from '../utils/errors.js'
import { withTimeoutMs } from './rootRunner.js'
import { SEED_FS_OP_TIMEOUT_MS } from './sessionSeed.js'

/** densable `myg` — max script UTF-8 bytes */
export const LAUNCHER_HOOK_SCRIPT_MAX_BYTES = 131_072

/** densable `mjw` */
export const LAUNCHER_HOOK_FILENAME_RE =
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}\.(py|sh)$/

/** densable `hjw` — allowed Claude Code hook events */
export const LAUNCHER_HOOK_EVENTS = new Set([
  'Stop',
  'SubagentStop',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'Notification',
])

export type LauncherHookEntry = {
  event: string
  filename: string
  script: string
}

export type MaterializeLauncherHooksResult = {
  settingsPath: string
}

function isNotFound(err: unknown): boolean {
  const code = getErrnoCode(err)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * densable `a7i` — compact value for validation error strings (≤200 bytes).
 */
export function summarizeLauncherHookValue(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= 200) return text
  return `${text.slice(0, 200)}… (+${bytes - 200} bytes)`
}

/**
 * densable `gjw` — validate launcher_hooks array; return error string or undefined.
 */
export function validateLauncherHooks(hooks: unknown): string | undefined {
  if (!Array.isArray(hooks)) {
    return `launcher_hooks: not an array (got ${summarizeLauncherHookValue(hooks)})`
  }
  const seen = new Set<string>()
  for (const [i, entry] of hooks.entries()) {
    if (entry === null || typeof entry !== 'object') {
      return `launcher_hooks[${i}]: not an object (got ${summarizeLauncherHookValue(entry)})`
    }
    const row = entry as Record<string, unknown>
    if (typeof row.event !== 'string' || !LAUNCHER_HOOK_EVENTS.has(row.event)) {
      return `launcher_hooks[${i}]: unknown event ${summarizeLauncherHookValue(row.event)}`
    }
    if (
      typeof row.filename !== 'string' ||
      !LAUNCHER_HOOK_FILENAME_RE.test(row.filename)
    ) {
      return `launcher_hooks[${i}]: invalid filename ${summarizeLauncherHookValue(row.filename)}`
    }
    const lower = row.filename.toLowerCase()
    if (seen.has(lower)) {
      return `launcher_hooks[${i}]: duplicate filename ${JSON.stringify(row.filename)} (case-insensitive)`
    }
    seen.add(lower)
    const size =
      typeof row.script === 'string' ? Buffer.byteLength(row.script, 'utf8') : 0
    if (size === 0 || size > LAUNCHER_HOOK_SCRIPT_MAX_BYTES) {
      return `launcher_hooks[${i}] ${JSON.stringify(row.filename)}: script size ${size} out of range (1..${LAUNCHER_HOOK_SCRIPT_MAX_BYTES})`
    }
  }
  return undefined
}

/**
 * densable `Pyg` — hooks dir must be absent or a plain directory (not a file/symlink).
 * Returns false when configDir/hooks exists and is not a plain directory.
 */
export async function assertHooksDirIsPlainDirectory(
  configDir: string,
  onStatus: (msg: string) => void,
  fsTimeoutMs: number = SEED_FS_OP_TIMEOUT_MS,
): Promise<boolean> {
  const hooksDir = join(configDir, 'hooks')
  const st = await withTimeoutMs(
    lstat(hooksDir).catch((err: unknown) => {
      if (isNotFound(err)) return undefined
      return Promise.reject(err)
    }),
    fsTimeoutMs,
    `lstat ${hooksDir}`,
  )
  if (st !== undefined && !st.isDirectory()) {
    onStatus(
      `[runner:session] ${hooksDir} exists and is not a plain directory — not following`,
    )
    return false
  }
  return true
}

/**
 * densable host-seed path filter for CCR launcher hooks dir.
 * True when rel is `hooks/.ccr-launcher` or under it (case-insensitive).
 */
export function isCcrLauncherHostSeedPath(rel: string): boolean {
  const lower = rel.toLowerCase()
  const prefix = `hooks${sep}.ccr-launcher`
  return lower === prefix || lower.startsWith(prefix + sep)
}

/**
 * densable `yjw` — materialize validated launcher_hooks into configDir.
 * Fail-soft: validation / non-plain hooks dir → log + return undefined (session continues).
 */
export async function materializeLauncherHooks(
  configDir: string,
  hooks: unknown,
  cleanupPaths: string[],
  onDebug: (msg: string) => void,
  onStatus: (msg: string) => void,
  fsTimeoutMs: number = SEED_FS_OP_TIMEOUT_MS,
): Promise<MaterializeLauncherHooksResult | undefined> {
  const validationError = validateLauncherHooks(hooks)
  if (validationError !== undefined) {
    onStatus(
      `[runner:session] launcher_hooks validation failed — dropping (CCR deploy regression, session continues without CCR-supplied hooks): ${validationError}`,
    )
    return undefined
  }
  const entries = hooks as LauncherHookEntry[]
  if (
    !(await assertHooksDirIsPlainDirectory(configDir, onStatus, fsTimeoutMs))
  ) {
    return undefined
  }

  const launcherDir = join(configDir, 'hooks', '.ccr-launcher')
  await withTimeoutMs(
    rm(launcherDir, { recursive: true, force: true }),
    fsTimeoutMs,
    `rm ${launcherDir}`,
  )
  await withTimeoutMs(
    mkdir(launcherDir, { recursive: true, mode: 0o700 }),
    fsTimeoutMs,
    `mkdir ${launcherDir}`,
  )

  const hooksMap: Record<
    string,
    Array<{
      matcher: string
      hooks: Array<{ type: 'command'; command: string; args: string[] }>
    }>
  > = {}

  for (const entry of entries) {
    const scriptPath = join(launcherDir, entry.filename)
    cleanupPaths.push(scriptPath)
    await withTimeoutMs(
      unlink(scriptPath).catch(() => {}),
      fsTimeoutMs,
      `unlink ${scriptPath}`,
    )
    await withTimeoutMs(
      writeFile(scriptPath, entry.script, { flag: 'wx', mode: 0o700 }),
      fsTimeoutMs,
      `writeFile ${scriptPath}`,
    )
    const list = (hooksMap[entry.event] ??= [])
    list.push({
      matcher: '',
      hooks: [{ type: 'command', command: scriptPath, args: [] }],
    })
  }

  const settingsPath = join(configDir, 'launcher-settings.json')
  cleanupPaths.push(settingsPath)
  await withTimeoutMs(
    unlink(settingsPath).catch(() => {}),
    fsTimeoutMs,
    `unlink ${settingsPath}`,
  )
  await withTimeoutMs(
    writeFile(settingsPath, JSON.stringify({ hooks: hooksMap }, null, 2), {
      flag: 'wx',
      mode: 0o600,
    }),
    fsTimeoutMs,
    `writeFile ${settingsPath}`,
  )
  onDebug(
    `[runner:session] Wrote ${entries.length} launcher hook(s) + ${settingsPath}`,
  )
  return { settingsPath }
}
