/**
 * densable 2.1.212 process-level launch state used by keepParent `/fork`:
 *
 *   kei / Iei  — forkReplayLaunchConfig {appendSystemPrompt, agent, agents}
 *   Hei / xei  — forkRestrictedLaunchConfig boolean (Ajs at launch)
 *   gXe / rti  — replConfigArgv (settings/plugin/add-dir/mcp/… flags)
 *
 * Kept out of bootstrap/state.ts (leaf module; no import cycle risk).
 */

export type ForkReplayLaunchConfig = {
  /** Raw CLI `--append-system-prompt` string (not file/chrome mutations). */
  appendSystemPrompt?: string
  /** Raw CLI `--agent` value. */
  agent?: string
  /** Raw CLI `--agents` JSON string. */
  agents?: string
}

let forkReplayLaunchConfig: ForkReplayLaunchConfig = {}
/** densable `Dt.forkRestrictedLaunchConfig` — sticky from launch Ajs. */
let forkRestrictedLaunchConfig = false
/** densable `Dt.replConfigArgv` — flat argv flags replayed into keepParent child. */
let replConfigArgv: string[] = []

/** densable `Iei(e)` — store launch config for later keepParent forks. */
export function setForkReplayLaunchConfig(
  config: ForkReplayLaunchConfig,
): void {
  forkReplayLaunchConfig = { ...config }
}

/** densable `kei()` — read launch config for D$t keepParent argv merge. */
export function getForkReplayLaunchConfig(): ForkReplayLaunchConfig {
  // Defensive copy — callers must not mutate process-global sticky state.
  return { ...forkReplayLaunchConfig }
}

/** densable `xei(e)` — sticky restricted-launch bit from Ajs at startup. */
export function setForkRestrictedLaunchConfig(restricted: boolean): void {
  forkRestrictedLaunchConfig = restricted
}

/** densable `Hei()` — nZ_ reads this (plus Pl/lf) for restricted launch. */
export function getForkRestrictedLaunchConfig(): boolean {
  return forkRestrictedLaunchConfig
}

/** densable `rti(e)` — store REPL config argv for gXe() merge into D$t. */
export function setReplConfigArgv(argv: readonly string[]): void {
  replConfigArgv = [...argv]
}

/** densable `gXe()` — flat argv slice for keepParent child spawn. */
export function getReplConfigArgv(): readonly string[] {
  // Defensive copy — callers must not mutate process-global sticky state.
  return [...replConfigArgv]
}

/** Test helper — clear between cases. */
export function resetForkReplayLaunchConfig(): void {
  forkReplayLaunchConfig = {}
  forkRestrictedLaunchConfig = false
  replConfigArgv = []
}

/**
 * densable `Ajs(options)` — true when launch flags make a keepParent copy
 * less restricted than the parent (nZ_ refuses).
 *
 * densable:
 *   Pl()||lf()||[systemPrompt, systemPromptFile, appendSystemPromptFile,
 *     permissionPromptTool, settingSources, managedSettings].some(defined)
 *     || (tools??[]).some(t !== "default")
 *
 * Pl/lf (safe/bare) are checked separately by `isForkRestrictedLaunch` /
 * callers; this pure helper covers the options-object half.
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
