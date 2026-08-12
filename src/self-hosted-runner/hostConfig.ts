/**
 * densable 2.1.224 host config snapshot (Q2h / Z2h) + MCP entry filter (ejv).
 * Recovered from SEA `/tmp/shr-extract-224/host-*.js`.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** densable `jUi` — 64 MiB host config snapshot cap */
export const HOST_CONFIG_MAX_BYTES = 67_108_864

/** densable `Qqv` — top-level names excluded from host config walk */
export const HOST_CONFIG_SKIP_NAMES = new Set([
  '.claude.json',
  '.claude.json.backup',
  '.credentials.json',
  'projects',
  'sessions',
  'todos',
  'shell-snapshots',
  'statsig',
  'file-history',
  'history.jsonl',
  'ide',
  'logs',
  'backups',
  '.session_ingress_token',
])

/** densable `Zqv` — allowed mcpServers type values */
export const MCP_SERVER_TYPES = new Set([
  'stdio',
  'sse',
  'http',
  'streamable-http',
  'ws',
  'sdk',
  'claudeai-proxy',
])

export type HostConfigFile = {
  buf: Buffer
  mode: number
}

export type HostConfigSnapshot = {
  sourceDir: string
  files: Map<string, HostConfigFile>
  mcpServers?: Record<string, unknown>
}

/**
 * densable top-level name filter from Q2h:
 * skip Qqv + `.claude(-…).json(.backup)?` + `.config.json*` + `.claude*.json.*`
 */
export function shouldIncludeHostConfigTopName(name: string): boolean {
  if (HOST_CONFIG_SKIP_NAMES.has(name)) return false
  if (/^\.claude(-[a-z-]+)?\.json(\.backup)?$/.test(name)) return false
  if (/^\.config\.json(\.|$)/.test(name)) return false
  if (/^\.claude(-[a-z-]+)?\.json\./.test(name)) return false
  return true
}

/**
 * densable `ejv` — return reason string if mcpServers entry is invalid; else undefined.
 */
export function mcpServerEntryProblem(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return `a non-object value (${entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry})`
  }
  const e = entry as Record<string, unknown>
  const t = e.type
  if (t === undefined) {
    if ('url' in e && !('command' in e)) {
      return 'a "url" but no "type" (add "type": "http", "sse", or "ws")'
    }
    return undefined
  }
  if (typeof t !== 'string') return `a non-string type (${typeof t})`
  if (!MCP_SERVER_TYPES.has(t)) return `unsupported type "${t}"`
  return undefined
}

/**
 * densable `Z2h` — recursive walk into `files` map with size accounting.
 */
export async function walkHostConfigDir(
  rootDir: string,
  rel: string,
  files: Map<string, HostConfigFile>,
  bytes: { bytes: number },
  topFilter?: (name: string) => boolean,
): Promise<void> {
  const entries = await readdir(join(rootDir, rel), { withFileTypes: true })
  for (const ent of entries) {
    if (rel === '' && topFilter && !topFilter(ent.name)) continue
    const a = rel === '' ? ent.name : join(rel, ent.name)
    if (ent.isDirectory()) {
      await walkHostConfigDir(rootDir, a, files, bytes)
    } else if (ent.isFile()) {
      const full = join(rootDir, a)
      const st = await stat(full)
      bytes.bytes += st.size
      if (bytes.bytes > HOST_CONFIG_MAX_BYTES) {
        throw new Error(
          `host config exceeds ${HOST_CONFIG_MAX_BYTES} bytes at ${a} — reduce ~/.claude size or set SELF_HOSTED_RUNNER_HOST_CONFIG_DIR to a slimmer dir`,
        )
      }
      const buf = await readFile(full)
      bytes.bytes += buf.length - st.size
      if (bytes.bytes > HOST_CONFIG_MAX_BYTES) {
        throw new Error(
          `host config exceeds ${HOST_CONFIG_MAX_BYTES} bytes at ${a} — reduce ~/.claude size or set SELF_HOSTED_RUNNER_HOST_CONFIG_DIR to a slimmer dir`,
        )
      }
      files.set(a, { buf, mode: st.mode & 0o777 })
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  )
}

/**
 * densable `Q2h` — snapshot host ~/.claude (or SELF_HOSTED_RUNNER_HOST_CONFIG_DIR).
 * Returns undefined when empty / only invalid mcpServers.
 */
export async function snapshotHostConfig(
  onStatus: (msg: string) => void,
): Promise<HostConfigSnapshot | undefined> {
  const sourceDir =
    process.env.SELF_HOSTED_RUNNER_HOST_CONFIG_DIR ||
    process.env.CLAUDE_CONFIG_DIR ||
    join(homedir(), '.claude')
  const files = new Map<string, HostConfigFile>()
  const bytes = { bytes: 0 }
  try {
    await walkHostConfigDir(
      sourceDir,
      '',
      files,
      bytes,
      shouldIncludeHostConfigTopName,
    )
  } catch (err) {
    if (!isNotFound(err)) {
      onStatus(
        `[runner:startup] host config snapshot from ${sourceDir} failed (sessions will start with empty config): ${err}`,
      )
      return undefined
    }
  }

  let mcpServers: Record<string, unknown> | undefined
  try {
    // densable tries several config filenames; keep a practical subset
    const candidates = [
      '.config.json',
      '.claude.json',
      join(sourceDir, '.config.json'),
    ]
    let raw: string | undefined
    for (const c of candidates) {
      const path = c.startsWith('/') || c.includes('/') ? c : join(sourceDir, c)
      try {
        raw = await readFile(path, 'utf8')
        break
      } catch (err) {
        if (!isNotFound(err)) throw err
      }
    }
    if (raw) {
      const parsed = JSON.parse(raw) as { mcpServers?: unknown }
      if (
        parsed.mcpServers !== null &&
        typeof parsed.mcpServers === 'object' &&
        !Array.isArray(parsed.mcpServers) &&
        Object.keys(parsed.mcpServers as object).length > 0
      ) {
        mcpServers = { ...(parsed.mcpServers as Record<string, unknown>) }
      }
    }
  } catch {
    /* ignore parse errors — densable continues without mcpServers */
  }

  if (mcpServers) {
    for (const [name, entry] of Object.entries(mcpServers)) {
      const problem = mcpServerEntryProblem(entry)
      if (problem !== undefined) {
        onStatus(
          `[runner:warn] host mcpServers entry "${name}" has ${problem} — ignoring (the Claude child would drop it silently)`,
        )
        delete mcpServers[name]
      }
    }
    if (Object.keys(mcpServers).length === 0) mcpServers = undefined
  }

  if (files.size === 0 && !mcpServers) return undefined
  onStatus(
    `[runner:startup] host config snapshot: ${files.size} file(s), ${(bytes.bytes / 1024).toFixed(1)} KiB from ${sourceDir}${
      mcpServers ? `, ${Object.keys(mcpServers).length} mcpServer(s)` : ''
    }`,
  )
  return { sourceDir, files, mcpServers }
}
