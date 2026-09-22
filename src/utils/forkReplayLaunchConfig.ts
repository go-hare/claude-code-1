/**
 * densable 2.1.212 process-level launch state used by keepParent `/fork`:
 *
 *   kei / Iei  — forkReplayLaunchConfig {appendSystemPrompt, agent, agents}
 *   GC / Cwn   — forkRestrictedLaunchConfig boolean (Cwn(Win(C)) at launch)
 *   gXe / rti  — replConfigArgv (settings/plugin/add-dir/mcp/… flags)
 *
 * 2.1.248 leftover bits on official Ie (do not invent Yt):
 *   Cwn/GC → `Ie.#w`  (NOT #1 Yk / restrictedSession)
 *   AL/Rwn → `Ie.#L`
 *   gXe/rti → `Ie.#g`
 * Hei/xei are gone (SEA hits=0).
 *
 * Kept out of bootstrap/state.ts (leaf module; no import cycle risk).
 */

import { getBootstrapSessionHost } from './sessionHost.js'

export type ForkReplayLaunchConfig = {
  /** Raw CLI `--append-system-prompt` string (not file/chrome mutations). */
  appendSystemPrompt?: string
  /** Raw CLI `--agent` value. */
  agent?: string
  /** Raw CLI `--agents` JSON string. */
  agents?: string
}
/**
 * densable `Dt.settingsEffortAtStartup` / M_s — settings-derived effort at
 * launch (O_s). Used by nMr/kXs so /tui only carries `--effort` when it
 * differs from this baseline or CLI `--effort` was present.
 */
let settingsEffortAtStartup: string | undefined

/**
 * official Rwn @178553301
 * `function Rwn(e){n().host.launchOptions.replaceForkReplayLaunchConfig(e)}`
 * export alias `Rwn as setForkReplayLaunchConfig`
 */
export function setForkReplayLaunchConfig(
  config: ForkReplayLaunchConfig,
): void {
  getBootstrapSessionHost().launchOptions.replaceForkReplayLaunchConfig({
    ...config,
  })
}

/**
 * official AL @178553301
 * `function AL(){return n().host.launchOptions.forkReplayLaunchConfig()}`
 * export alias `AL as getForkReplayLaunchConfig`
 */
export function getForkReplayLaunchConfig(): ForkReplayLaunchConfig {
  // Defensive copy — callers must not mutate process-global sticky state.
  return {
    ...getBootstrapSessionHost().launchOptions.forkReplayLaunchConfig(),
  }
}

/**
 * official Cwn @178553330 sha=c836daccafc6bb62
 * `function Cwn(e){n().host.launchOptions.replaceForkRestrictedLaunchConfig(e)}`
 * export alias `Cwn as setForkRestrictedLaunchConfig` @192785069
 */
export function setForkRestrictedLaunchConfig(restricted: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceForkRestrictedLaunchConfig(
    restricted,
  )
}

/**
 * official GC @178553257 sha=c75e51a6d6ddf107
 * `function GC(){return n().host.launchOptions.forkRestrictedLaunchConfig()}`
 * export alias `GC as getForkRestrictedLaunchConfig` @192776753
 */
export function getForkRestrictedLaunchConfig(): boolean {
  return getBootstrapSessionHost().launchOptions.forkRestrictedLaunchConfig()
}

/** densable `rti(e)` — official `Ie.replaceReplConfigArgv` / `#g`. */
export function setReplConfigArgv(argv: readonly string[]): void {
  getBootstrapSessionHost().launchOptions.replaceReplConfigArgv([...argv])
}

/** densable `gXe()` — official `Ie.replConfigArgv()` / `#g`. */
export function getReplConfigArgv(): readonly string[] {
  return [...getBootstrapSessionHost().launchOptions.replConfigArgv()]
}

/** densable `O_s(e)` — store settings effort baseline for nMr/kXs. */
export function setSettingsEffortAtStartup(effort: string | undefined): void {
  settingsEffortAtStartup =
    typeof effort === 'string' && effort !== '' ? effort : undefined
}

/** densable `M_s()` — settings effort at startup for /tui effort carry. */
export function getSettingsEffortAtStartup(): string | undefined {
  return settingsEffortAtStartup
}

/** Test helper — clear leftover fork-replay slots (not full Ie.reset). */
export function resetForkReplayLaunchConfig(): void {
  const opts = getBootstrapSessionHost().launchOptions
  opts.replaceForkReplayLaunchConfig({})
  opts.replaceForkRestrictedLaunchConfig(false)
  opts.replaceReplConfigArgv([])
  settingsEffortAtStartup = undefined
}

/**
 * official Win @182967044 — true when launch options make a keepParent copy
 * less restricted than the parent (nZ_ refuses). Cwn(Win(C)) writes #w.
 *
 *   [systemPrompt, systemPromptFile, appendSystemPromptFile,
 *     permissionPromptTool, settingSources, managedSettings].some(defined)
 *     || (tools??[]).some(t !== "default")
 *
 * Pl/lf (safe/bare) are checked separately by `isForkRestrictedLaunch` /
 * callers; this pure helper covers the options-object half (not Yk/#l).
 */
export function isForkRestrictedLaunchOptions(opts: {
  systemPrompt?: unknown
  systemPromptFile?: unknown
  appendSystemPromptFile?: unknown
  permissionPromptTool?: unknown
  settingSources?: unknown
  managedSettings?: unknown
  tools?: unknown
}): boolean {
  if (
    opts.systemPrompt !== undefined ||
    opts.systemPromptFile !== undefined ||
    opts.appendSystemPromptFile !== undefined ||
    opts.permissionPromptTool !== undefined ||
    opts.settingSources !== undefined ||
    opts.managedSettings !== undefined
  ) {
    return true
  }
  const tools = opts.tools
  if (Array.isArray(tools)) {
    return tools.some(t => t !== 'default')
  }
  if (typeof tools === 'string' && tools !== '' && tools !== 'default') {
    return true
  }
  return false
}

/**
 * densable `Q4t(J4t({...}))` + extras into `rti([...])` shape.
 * Flat argv flags the keepParent child should inherit from launch.
 */
export function buildReplConfigArgv(opts: {
  settings?: string
  pluginDir?: string | string[]
  pluginDirNoMcp?: string | string[]
  addDir?: string | string[]
  mcpConfig?: string | string[]
  strictMcpConfig?: boolean
  fallbackModel?: string
  allowDangerouslySkipPermissions?: boolean
  disableSlashCommands?: boolean
  channels?: string | string[]
}): string[] {
  const asList = (v: string | string[] | undefined): string[] => {
    if (v === undefined || v === null) return []
    if (Array.isArray(v))
      return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
    return typeof v === 'string' && v.length > 0 ? [v] : []
  }

  const out: string[] = []
  if (typeof opts.settings === 'string' && opts.settings !== '') {
    out.push('--settings', opts.settings)
  }
  for (const d of asList(opts.pluginDir)) {
    out.push('--plugin-dir', d)
  }
  for (const d of asList(opts.pluginDirNoMcp)) {
    out.push('--plugin-dir-no-mcp', d)
  }
  for (const d of asList(opts.addDir)) {
    out.push('--add-dir', d)
  }
  for (const c of asList(opts.mcpConfig)) {
    out.push('--mcp-config', c)
  }
  if (opts.strictMcpConfig) {
    out.push('--strict-mcp-config')
  }
  if (typeof opts.fallbackModel === 'string' && opts.fallbackModel !== '') {
    out.push('--fallback-model', opts.fallbackModel)
  }
  if (opts.allowDangerouslySkipPermissions) {
    out.push('--allow-dangerously-skip-permissions')
  }
  if (opts.disableSlashCommands) {
    out.push('--disable-slash-commands')
  }
  for (const ch of asList(opts.channels)) {
    out.push('--channels', ch)
  }
  return out
}

/**
 * densable D$t keepParent merge of kei() into CLI argv pieces.
 *
 * Returns agent/agents flags and the joined `--append-system-prompt` value
 * (kei append + optional isolation text, joined with two spaces — densable
 * `D.join(\`  \`)`).
 */
export function mergeForkReplayIntoChildArgs(opts: {
  replay?: ForkReplayLaunchConfig
  /** Isolation append when keepParent relocates out of a worktree. */
  isolationAppend?: string
}): {
  agent?: string
  agents?: string
  appendSystemPrompt?: string
} {
  const replay = opts.replay ?? getForkReplayLaunchConfig()
  const parts: string[] = []
  if (replay.appendSystemPrompt) {
    parts.push(replay.appendSystemPrompt)
  }
  if (opts.isolationAppend) {
    parts.push(opts.isolationAppend)
  }
  return {
    agent: replay.agent,
    agents: replay.agents,
    appendSystemPrompt: parts.length > 0 ? parts.join('  ') : undefined,
  }
}
