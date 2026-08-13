/**
 * densable 2.1.224 session seed / fence / cwd helpers:
 *   njv host-config write, WJl session-ingress fence, G2h/oBh child cwd,
 *   F2h debug token write, D trust seed, mcp_config write, sG/Kw/f2t EKn.
 */
import { realpathSync } from 'node:fs'
import { mkdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import type { HostConfigSnapshot } from './hostConfig.js'
import {
  assertHooksDirIsPlainDirectory,
  isCcrLauncherHostSeedPath,
} from './launcherHooks.js'
import { withTimeoutMs } from './rootRunner.js'
import { assertNoSessionDirOverlap } from './sessionConfine.js'

/** densable `wKn` — default fs op timeout for session seed writes */
export const SESSION_SEED_FS_TIMEOUT_MS = 10_000
/** densable `X2h` — host seed write stuck timeout */
export const HOST_SEED_WRITE_TIMEOUT_MS = 60_000
/** densable `J2h` — fs op stuck timeout (HV wrapper) */
export const SEED_FS_OP_TIMEOUT_MS = 5_000
/** densable `ow_` — max byteLength of Kw path before Npr falls back to /tmp */
export const KW_PATH_BYTE_LIMIT = 44

/**
 * densable `Xqv` / runner `YMt`-lite — config file suffix for custom OAuth.
 * rBh uses Xqv(api_base_url) which only checks CLAUDE_CODE_CUSTOM_OAUTH_URL.
 */
export function claudeConfigFileSuffix(): string {
  if (process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL) return '-custom-oauth'
  return ''
}

/**
 * densable `Rne` + `Kw` — CLAUDE_CODE_TMPDIR|/tmp + `claude-{uid}`.
 */
export function densableKwTempDir(): string {
  const base = process.env.CLAUDE_CODE_TMPDIR || '/tmp'
  const uid = process.getuid?.() ?? 0
  return join(base, `claude-${uid}`)
}

/**
 * densable `sG` — realpath(Kw) (no trailing sep; densable memo adds sep for other callers).
 */
export function densableSgResolved(): string {
  const t = densableKwTempDir()
  try {
    return realpathSync(t)
  } catch {
    return t
  }
}

/**
 * densable `Npr` + `f2t` — short Kw, else `/tmp/claude-{uid}` fallback; realpath.
 */
export function densableF2tResolved(): string {
  const kw = densableKwTempDir()
  let npr = kw
  if (Buffer.byteLength(kw) > KW_PATH_BYTE_LIMIT) {
    npr = join('/tmp', `claude-${process.getuid?.() ?? 0}`)
  }
  try {
    return realpathSync(npr)
  } catch {
    return npr
  }
}

/**
 * densable post-confine EKn:
 * `EKn(ae, "config dir", sG().replace(/[/\\]$/,""), [Kw(), f2t().replace(...)])`
 * Refuse spawn when per-session CLAUDE_CONFIG_DIR overlaps global temp dirs.
 */
export function assertConfigDirOutsideGlobalTemp(configDir: string): void {
  const sg = densableSgResolved().replace(/[/\\]$/, '')
  const kw = densableKwTempDir()
  const f2t = densableF2tResolved().replace(/[/\\]$/, '')
  assertNoSessionDirOverlap(configDir, 'config dir', sg, [kw, f2t])
}

/**
 * densable rBh `D` block — seed `.claude${nr}.json` with projects trust map
 * (+ host mcpServers when present). Overwrites prior njv mcpServers-only write.
 */
export async function seedPersistedWorkspaceTrust(opts: {
  configDir: string
  /** densable Set([ht, ...qt, ...Le.canonicalRepoPath]) */
  trustPaths: string[]
  hostMcpServers?: Record<string, unknown>
  configSuffix?: string
  onDebug: (msg: string) => void
  fsTimeoutMs?: number
}): Promise<void> {
  const projects: Record<string, { hasTrustDialogAccepted: true }> = {}
  for (const ar of new Set(opts.trustPaths.filter(p => p.length > 0))) {
    const normalized = normalize(ar)
    let resolved: string | undefined
    try {
      resolved = await withTimeoutMs(
        realpath(ar).then(
          p => p,
          () => undefined as string | undefined,
        ),
        opts.fsTimeoutMs ?? SEED_FS_OP_TIMEOUT_MS,
        `realpath ${ar}`,
      )
    } catch {
      resolved = undefined
    }
    const variants = [
      normalized,
      normalized.normalize('NFC'),
      ...(resolved !== undefined
        ? [resolved, resolved.normalize('NFC')]
        : ([] as string[])),
    ]
    for (const path of variants) {
      projects[path] = { hasTrustDialogAccepted: true }
    }
  }
  const body = JSON.stringify({
    ...(opts.hostMcpServers ? { mcpServers: opts.hostMcpServers } : {}),
    projects,
  })
  const suffix = opts.configSuffix ?? claudeConfigFileSuffix()
  const outPath = join(opts.configDir, `.claude${suffix}.json`)
  await withTimeoutMs(
    writeFile(outPath, body, { mode: 0o600 }),
    opts.fsTimeoutMs ?? SEED_FS_OP_TIMEOUT_MS,
    `writeFile ${outPath}`,
  )
  opts.onDebug(
    `[runner:session] Seeded persisted trust for ${Object.keys(projects).length} path(s) in ${outPath}`,
  )
}

/**
 * densable rBh remote `mcp_config.content` (base64) → `mcp-config.json` (wx 0600).
 * Returns absolute path for `--mcp-config`.
 */
export async function writeRemoteMcpConfig(
  configDir: string,
  contentBase64: string,
  onDebug: (msg: string) => void,
  fsTimeoutMs: number = SEED_FS_OP_TIMEOUT_MS,
): Promise<string> {
  const text = Buffer.from(contentBase64, 'base64').toString('utf-8')
  const outPath = join(configDir, 'mcp-config.json')
  await withTimeoutMs(
    unlink(outPath).catch(() => {}),
    fsTimeoutMs,
    `unlink ${outPath}`,
  )
  await withTimeoutMs(
    writeFile(outPath, text, { flag: 'wx', mode: 0o600 }),
    fsTimeoutMs,
    `writeFile ${outPath}`,
  )
  onDebug(
    `[runner:session] Wrote MCP config to ${outPath} (${text.length} bytes)`,
  )
  return outPath
}

/**
 * densable `oBh` — resolve remote cwd under session root; null if escapes.
 */
export function resolveUnderSessionRoot(
  sessionRoot: string,
  cwd: string,
): string | null {
  const root = resolve(sessionRoot)
  const target = isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd)
  if (target === root) return target
  if (target.startsWith(root + sep)) return target
  return null
}

/**
 * densable `G2h` — pick child cwd + --add-dir list from prepared repos.
 */
export function resolveChildCwdAndAddDirs(
  sessionRoot: string,
  preparedPaths: string[],
  remoteCwd?: string | null,
): { childCwd: string; addDirs: string[] } {
  if (remoteCwd) {
    const n = resolveUnderSessionRoot(sessionRoot, remoteCwd)
    if (n !== null) {
      return { childCwd: n, addDirs: [...preparedPaths, sessionRoot] }
    }
  }
  if (preparedPaths.length === 1) {
    return {
      childCwd: preparedPaths[0]!,
      addDirs: [...preparedPaths, sessionRoot],
    }
  }
  if (preparedPaths.length > 1) {
    const allUnder = preparedPaths.every(p => p.startsWith(sessionRoot + sep))
    return {
      childCwd: allUnder ? sessionRoot : preparedPaths[0]!,
      addDirs: [...preparedPaths],
    }
  }
  return { childCwd: sessionRoot, addDirs: [] }
}

/**
 * densable `WJl` — write session-ingress token fence file (mkdir + write).
 * Returns false on failure (staged-file fetches degrade); never throws.
 */
export async function writeSessionIngressToken(
  path: string,
  token: string,
  onStatus: (msg: string) => void,
  onBackground?: (p: Promise<unknown>) => void,
  timeoutMs: number = SESSION_SEED_FS_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const mkdirP = mkdir(dirname(path), { recursive: true, mode: 0o700 })
    // densable CKn: if timeout, still let promise settle in background
    let settled = false
    mkdirP.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    try {
      await withTimeoutMs(
        mkdirP,
        timeoutMs,
        '[runner:session] mkdir for session-ingress token file',
      )
    } catch (err) {
      if (!settled)
        onBackground?.(
          mkdirP.then(
            () => {},
            () => {},
          ),
        )
      throw err
    }
    const writeP = writeFile(path, token, { mode: 0o600 })
    settled = false
    writeP.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    try {
      await withTimeoutMs(
        writeP,
        timeoutMs,
        '[runner:session] write session-ingress token file',
      )
    } catch (err) {
      if (!settled)
        onBackground?.(
          writeP.then(
            () => {},
            () => {},
          ),
        )
      throw err
    }
    return true
  } catch (err) {
    onStatus(
      `[runner:session] session-ingress token file write failed (staged-file fetches degraded): ${err}`,
    )
    return false
  }
}

/**
 * densable `njv` — seed host config snapshot files + optional mcpServers into
 * per-session CLAUDE_CONFIG_DIR. Best-effort (logs on failure, no throw).
 */
export async function seedHostConfigIntoSession(
  configDir: string,
  snapshot: HostConfigSnapshot | undefined,
  onDebug: (msg: string) => void,
  onStatus: (msg: string) => void,
  configSuffix: string = claudeConfigFileSuffix(),
): Promise<void> {
  if (!snapshot) return
  try {
    const seeded: string[] = []
    await withTimeoutMs(
      (async () => {
        // densable fjw/Pyg: skip host hooks/* when hooks is not a plain dir;
        // always skip hooks/.ccr-launcher (CCR materialize owns that tree)
        const hooksPlain = await assertHooksDirIsPlainDirectory(
          configDir,
          onStatus,
        )
        for (const [rel, { buf, mode }] of snapshot.files) {
          const lower = rel.toLowerCase()
          if (
            !hooksPlain &&
            (lower === 'hooks' || lower.startsWith(`hooks${sep}`))
          ) {
            continue
          }
          if (isCcrLauncherHostSeedPath(rel)) continue
          const full = join(configDir, rel)
          const sepIdx = rel.lastIndexOf(sep)
          if (sepIdx > 0) {
            await mkdir(join(configDir, rel.slice(0, sepIdx)), {
              recursive: true,
            })
          }
          await writeFile(full, buf, { mode })
          seeded.push(rel)
        }
        if (snapshot.mcpServers) {
          const body = JSON.stringify({ mcpServers: snapshot.mcpServers })
          await writeFile(
            join(configDir, `.claude${configSuffix}.json`),
            body,
            { mode: 0o600 },
          )
        }
      })(),
      HOST_SEED_WRITE_TIMEOUT_MS,
      `[runner:stuck] seed write → ${configDir}`,
    )
    if (seeded.length > 0 || snapshot.mcpServers) {
      const keys = [...seeded]
      if (snapshot.mcpServers) {
        keys.push(
          `.claude.json[mcpServers×${Object.keys(snapshot.mcpServers).length}]`,
        )
      }
      onDebug(
        `[runner:session] Seeded ${keys.join(', ')} from host config snapshot (${snapshot.sourceDir})`,
      )
    }
  } catch (err) {
    onStatus(
      `[runner:session] Seed write to ${configDir} failed (best-effort): ${err}`,
    )
  }
}

/**
 * densable `F2h` — best-effort write of debug JWT under debugTokenDir.
 */
export async function writeDebugTokenFile(
  dir: string,
  name: string,
  content: string,
  onStatus: (msg: string) => void,
): Promise<void> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(join(dir, name), content, { mode: 0o600 })
  } catch (err) {
    onStatus(
      `[runner:debug] failed to write ${name} to ${dir} (best-effort): ${err}`,
    )
  }
}

/**
 * densable `rjv` — write governed gitconfig seed content (mode 0600).
 */
export async function writeGovernedGitconfigSeed(
  path: string,
  content: string,
): Promise<void> {
  await writeFile(path, content, { mode: 0o600 })
}
