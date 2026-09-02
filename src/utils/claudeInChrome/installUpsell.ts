/**
 * densable 2.1.239 chrome install opener — `yau` / `KBA` / `Mby` / `ejA`.
 *
 * Gold: `t(zOo, {}, {signal})` upsell then streaming `t(jOo, y(), {signal})`
 * wait-loop. Host renderers are Kmy/znu; this file is the production opener.
 * Specs imported from jsuKinds (not dialog/index — that pulls DialogHost).
 */
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logEvent } from '../../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isMcpServerDenied } from '../../services/mcp/config.js'
import { getMcpPrefix } from '../../services/mcp/mcpStringUtils.js'
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from '../../services/mcp/types.js'
import type { ToolUseContext, Tool } from '../../Tool.js'
import {
  chromeInstallSetupSpec,
  chromeInstallUpsellSpec,
} from '../../dialog/specs/jsuKinds.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Command } from '../../types/command.js'
import {
  getIsInteractive,
  getIsRemoteMode,
  getSessionBypassPermissionsMode,
  getTeleportedSessionInfo,
} from '../../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { getPlatform } from '../platform.js'
import { isSafeModeEnabled } from '../safeMode.js'
import { sleep } from '../sleep.js'
import { getAgentId } from '../teammate.js'
import {
  CLAUDE_IN_CHROME_MCP_SERVER_NAME,
  detectAvailableBrowser,
  openInChrome,
} from './common.js'
import { BASE_CHROME_PROMPT } from './prompt.js'
import {
  CHROME_EXTENSION_RECONNECT_URL,
  getClaudeInChromeStdioConfig,
  hasBaseChromeAutoEnableEligibility,
  hasChromeExtensionEvidence,
  isChromeExtensionInstalled,
  setupClaudeInChrome,
} from './setup.js'
import { CHROME_EXTENSION_URL } from './setupPortable.js'
import {
  clearClaudeInChromeWiredThisSession,
  getChromeInstallSessionState,
  hasClaudeInChromeInstallUpsellLatch,
  isClaudeInChromeWiredThisSession,
} from './sessionState.js'

const SERVER = CLAUDE_IN_CHROME_MCP_SERVER_NAME
const MCP_PREFIX = getMcpPrefix(SERVER)

/** densable `Pby` / `LBA` / `NBA` / `$BA` / `FBA` / `UBA` / `BBA`. */
const INSTALL_POLL_MS = 2000
const INSTALL_POLL_FAST_UNTIL_MS = 30_000
const INSTALL_POLL_SLOW_MS = 5000
const RECONNECT_NUDGE_MS = 15_000
const STALL_AFTER_MS = 45_000
const PROBE_TIMEOUT_MS = 5000
const PROBE_ERROR_LIMIT = 5

const DEAD_CHROME_MCP_TYPES = new Set(['failed', 'disabled', 'needs-auth'])

type SetupPhase =
  | 'waiting_install'
  | 'connecting'
  | 'stalled'
  | 'connected'
  | 'failed'

type ChromeRequestDialog = NonNullable<ToolUseContext['requestDialog']>

type MountedChromeMcp = {
  client: MCPServerConnection
  tools: readonly Tool[]
  commands: readonly Command[]
  resources?: ServerResource[]
}

/** densable `DXt` — lazy because gold interpolates `c0e`. */
export function chromeNotSetupSteering(): string {
  return `Browser tools are not available in this session: the Claude in Chrome extension is not set up. The user can install or connect it from ${CHROME_EXTENSION_URL} and manage browser tools with /chrome. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. Do not attempt mcp__claude-in-chrome__* tool calls.`
}

/** densable `gau`. */
export const CHROME_UPSELL_DECLINED_STEERING =
  'The user declined to install the Claude in Chrome extension for now. Do not suggest it again this session. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. They can revisit with /chrome.'

/** densable `YBA`. */
export const CHROME_POLICY_DENIED_STEERING =
  "Browser automation is not available: this organization's managed settings do not permit the Claude in Chrome MCP server. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. Do not suggest installing the extension."

/** densable `WBA`. */
export const CHROME_SETUP_SKIPPED_STEERING =
  'The user started installing the Claude in Chrome extension but chose to continue without browser tools. Do not suggest the extension again this session. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. If they finish installing later, /chrome completes the connection, and the next Claude Code session detects the extension automatically.'

/** densable `GBA`. */
export const CHROME_SETUP_CONNECT_FAILED_STEERING =
  'The Claude in Chrome extension was installed, but the browser connection could not be established in this session. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. The user can finish the connection with /chrome (Reconnect extension), and the next Claude Code session will detect the extension automatically.'

/** densable `zMs` — em dash `—`. */
export const CHROME_SETUP_ABORTED_STEERING =
  'Claude in Chrome setup did not complete because the turn was interrupted — the user did not choose to continue without browser tools. Continue without browser tools for now (WebFetch and WebSearch cover read-only web content). If the user finishes installing, /chrome completes the connection, and the next Claude Code session detects the extension automatically.'

/** densable `VBA`. */
export const CHROME_SETUP_INTERNAL_ERROR_STEERING =
  'Claude in Chrome setup ended early due to an internal error; the extension may or may not be installed. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. The user can finish setup with /chrome, and the next Claude Code session detects the extension automatically.'

/** densable `Dby`. */
export const CHROME_POLICY_DENIED_MID_WAIT_STEERING =
  "Browser automation is not available: this organization's managed settings do not permit the Claude in Chrome MCP server (the policy loaded while setup was in progress). Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. Do not suggest the extension again."

/** densable `qBA`. */
export const CHROME_BYPASS_MODE_LATE_STEERING =
  'Browser tools were not enabled: the session switched to a mode that auto-allows tool calls without prompts (bypass permissions) while setup was in progress, and Claude in Chrome is not wired into that configuration. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. Once the session leaves that mode, /chrome completes the connection.'

/** densable already-installed-not-enabled copy inside `KBA`. */
export const CHROME_INSTALLED_NOT_ENABLED_STEERING =
  'The Claude in Chrome extension is installed, but browser tools are not enabled for this session. Tell the user Claude Code can work in their Chrome browser once browser tools are on: they can run /chrome to manage them, or restart Claude Code to get a one-time prompt to enable them. Do not attempt mcp__claude-in-chrome__* tool calls this session.'

/** densable `XBA` — em dash `—`. */
export const CHROME_AGENT_CONTEXT_STEERING =
  'Claude in Chrome browser tools are enabled for this session, but they are not part of this agent context (its tool set was fixed before the browser connection completed, or its agent type does not include them). Do not attempt mcp__claude-in-chrome__* tool calls here — complete the task with the tools this context does have, or report back so the main conversation can drive the browser.'

/** densable `JBA`. */
export const CHROME_MCP_DEAD_STEERING =
  'Claude in Chrome is enabled for this session, but the browser connection is not working (it failed or was disabled), so mcp__claude-in-chrome__* tools are not available. Do not attempt them. Continue the task without browser tools (WebFetch and WebSearch cover read-only web content), or ask the user to perform browser steps manually. The user can retry the connection with /chrome (Reconnect extension).'

const CHROME_UPSELL_FEATURE = 'chrome_install_upsell'

type ChromeUpsellExtra = { install_page_opened?: boolean }

/** densable `Ee(...)` — connected + mounted is the only ok outcome. */
function chromeUpsellOk(extra: ChromeUpsellExtra = {}): void {
  logEvent('tengu_feature_ok', {
    ...extra,
    feature_name:
      CHROME_UPSELL_FEATURE as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable `be(...)` — user/policy declined the upsell, nothing broke. */
function chromeUpsellSad(reason: string, extra: ChromeUpsellExtra = {}): void {
  logEvent('tengu_feature_sad', {
    ...extra,
    feature_name:
      CHROME_UPSELL_FEATURE as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable `pe(...)` — the upsell itself failed. */
function chromeUpsellBad(reason: string, extra: ChromeUpsellExtra = {}): void {
  logEvent('tengu_feature_bad', {
    ...extra,
    feature_name:
      CHROME_UPSELL_FEATURE as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable `L0n` — `S2t(Ux, kTr())`. Do not call `setupClaudeInChrome`. */
function isChromeMcpDenied(): boolean {
  return isMcpServerDenied(SERVER, getClaudeInChromeStdioConfig())
}

/** densable `jMs`. */
function isBypassOrPlanBypass(ctx: ToolUseContext): boolean {
  const { mode, prePlanMode } = ctx.getAppState().toolPermissionContext
  return (
    mode === 'bypassPermissions' ||
    (mode === 'plan' && prePlanMode === 'bypassPermissions')
  )
}

/** densable `QBA` / `ZBA`. */
function isChromeMcpDead(clients: MCPServerConnection[] | undefined): boolean {
  const chrome = clients?.filter(c => c.name === SERVER) ?? []
  return (
    chrome.length > 0 && chrome.every(c => DEAD_CHROME_MCP_TYPES.has(c.type))
  )
}

/** densable `Lby`. `p4` is gold-constant false — skip. */
export function isClaudeInChromeInstallUpsellEligible(): boolean {
  if (isClaudeInChromeWiredThisSession()) return false
  if (hasClaudeInChromeInstallUpsellLatch()) return false
  return (
    hasBaseChromeAutoEnableEligibility() &&
    getIsInteractive() &&
    process.env.CLAUDE_CODE_SESSION_KIND !== 'bg' &&
    getAgentId() === undefined &&
    !isSafeModeEnabled() &&
    !getSessionBypassPermissionsMode() &&
    getPlatform() !== 'wsl' &&
    !getIsRemoteMode() &&
    getTeleportedSessionInfo()?.isTeleported !== true &&
    !hasChromeExtensionEvidence() &&
    getGlobalConfig().chromeInstallUpsellDismissed !== true &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_chrome_install_upsell', false) &&
    !isChromeMcpDenied()
  )
}

/** densable `IL`. */
function isChromeMcpTool(
  tool: { name: string; mcpInfo?: { serverName?: string } },
  serverName: string,
  prefix: string,
): boolean {
  if (tool.mcpInfo?.serverName !== undefined) {
    return tool.mcpInfo.serverName === serverName
  }
  return tool.name.startsWith(prefix)
}

/** densable `u2`. */
function isChromeMcpCommand(
  command: { name: string },
  serverName: string,
): boolean {
  const normalized = normalizeNameForMCP(serverName)
  const n = command.name
  return n.startsWith(`mcp__${normalized}__`) || n.startsWith(`${normalized}:`)
}

/**
 * densable `p8r` — merge mounted chrome MCP into AppState.
 * Tip `AppState.mcp` has no `resourceTemplates`; do not invent the field.
 */
function mergeChromeMcpIntoAppState(
  state: AppState,
  serverName: string,
  mounted: MountedChromeMcp,
): AppState {
  const prefix = getMcpPrefix(serverName)
  const clients = state.mcp.clients as MCPServerConnection[]
  const present = clients.some(c => c.name === serverName)
  const nextClients = present
    ? clients.map(c => (c.name === serverName ? mounted.client : c))
    : [...clients, mounted.client]
  const nextTools = [
    ...(state.mcp.tools as Tool[]).filter(
      t => !isChromeMcpTool(t, serverName, prefix),
    ),
    ...mounted.tools,
  ]
  const nextCommands = [
    ...(state.mcp.commands as Command[]).filter(
      c => !isChromeMcpCommand(c, serverName),
    ),
    ...mounted.commands,
  ]
  const nextResources = mounted.resources
    ? { ...state.mcp.resources, [serverName]: mounted.resources }
    : state.mcp.resources
  return {
    ...state,
    mcp: {
      ...state.mcp,
      clients: nextClients,
      tools: nextTools,
      commands: nextCommands,
      resources: nextResources,
    },
  } as AppState
}

/** densable `Iby`. */
function mountChromeMcp(ctx: ToolUseContext, mounted: MountedChromeMcp): void {
  ctx.onChangeDynamicMcpConfig?.(prev => ({
    ...(prev ?? {}),
    [SERVER]: mounted.client.config,
  }))
  ctx.setAppState(prev => mergeChromeMcpIntoAppState(prev, SERVER, mounted))
}

/** densable `zBA`. */
function completeChromeInstall(
  ctx: ToolUseContext,
  mounted: MountedChromeMcp,
  installPageOpened: boolean,
): string {
  mountChromeMcp(ctx, mounted)
  saveGlobalConfig(current =>
    current.claudeInChromeDefaultEnabled === true &&
    current.hasCompletedClaudeInChromeOnboarding === true &&
    current.cachedChromeExtensionInstalled === true
      ? current
      : {
          ...current,
          claudeInChromeDefaultEnabled: true,
          hasCompletedClaudeInChromeOnboarding: true,
          cachedChromeExtensionInstalled: true,
        },
  )
  chromeUpsellOk({
    install_page_opened: installPageOpened,
  })
  return `Claude in Chrome setup completed: the extension is installed and connected, and the mcp__claude-in-chrome__* browser tools are now available in this session. Continue the user's task using them.\n${BASE_CHROME_PROMPT}`
}

/** densable `jBA` / `Jrt` — `callTool` on the connected SDK client. */
async function probeConnectedBrowsers(
  server: ConnectedMCPServer,
  signal: AbortSignal,
): Promise<'connected' | 'not_connected' | 'error'> {
  try {
    const raced = await Promise.race([
      server.client.callTool({
        name: 'list_connected_browsers',
        arguments: {},
      }),
      sleep(PROBE_TIMEOUT_MS, signal).then(() => undefined),
    ])
    if (!raced) return 'not_connected'
    const first = Array.isArray(raced.content) ? raced.content[0] : undefined
    const text =
      first &&
      typeof first === 'object' &&
      'text' in first &&
      typeof (first as { text?: unknown }).text === 'string'
        ? (first as { text: string }).text
        : undefined
    if (!text) return 'not_connected'
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return 'not_connected'
    }
    return Array.isArray(parsed) && parsed.length > 0
      ? 'connected'
      : 'not_connected'
  } catch {
    return 'error'
  }
}

function createPhaseEmitter(): {
  subscribe: (fn: () => void) => () => void
  emit: () => void
} {
  const listeners = new Set<() => void>()
  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    emit() {
      for (const listener of listeners) listener()
    },
  }
}

/**
 * densable `Mby` — open install page, poll extension, reconnect MCP,
 * stream `{phase, installPageOpened}` into `t(jOo, y(), {signal})`.
 */
async function runChromeInstallSetup(
  ctx: ToolUseContext,
  requestDialog: ChromeRequestDialog,
): Promise<string> {
  const outer = ctx.abortController.signal
  const installPageOpened = await openInChrome(CHROME_EXTENSION_URL).catch(
    err => {
      logForDebugging(
        `[Claude in Chrome] Install setup failed to open install page: ${err}`,
        { level: 'error' },
      )
      return false
    },
  )
  const inner = new AbortController()
  const onOuterAbort = () => inner.abort()
  if (outer.aborted) inner.abort()
  else outer.addEventListener('abort', onOuterAbort, { once: true })

  let phase: SetupPhase = 'waiting_install'
  const emitter = createPhaseEmitter()
  function setPhase(next: SetupPhase): void {
    if (phase === next) return
    phase = next
    emitter.emit()
  }

  let mountedNative = false
  let succeeded = false
  let failReason = 'setup_connect_failed'
  let mounted: MountedChromeMcp | undefined
  let orphan: { config: ScopedMcpServerConfig } | undefined

  const driver = runSetupDriver().catch(err => {
    logForDebugging(`[Claude in Chrome] Install setup driver failed: ${err}`, {
      level: 'error',
    })
    failReason = 'setup_driver_error'
    setPhase('failed')
  })

  async function runSetupDriver(): Promise<void> {
    const started = Date.now()
    while (!inner.signal.aborted) {
      if (await isChromeExtensionInstalled().catch(() => false)) break
      await sleep(
        Date.now() - started >= INSTALL_POLL_FAST_UNTIL_MS
          ? INSTALL_POLL_SLOW_MS
          : INSTALL_POLL_MS,
        inner.signal,
      )
    }
    if (inner.signal.aborted) return
    setPhase('connecting')
    saveGlobalConfig(current =>
      current.cachedChromeExtensionInstalled === true
        ? current
        : { ...current, cachedChromeExtensionInstalled: true },
    )
    if (isChromeMcpDenied()) {
      logForDebugging(
        '[Claude in Chrome] Install setup stopped: managed policy denied the chrome MCP server during the install wait',
      )
      failReason = 'policy_denied_mid_wait'
      setPhase('failed')
      return
    }
    mountedNative = true
    const { mcpConfig } = setupClaudeInChrome({
      skipReconnectAutoOpen: true,
    })
    const config = mcpConfig[SERVER]
    if (!config) {
      failReason = 'setup_no_config'
      setPhase('failed')
      return
    }
    const { reconnectMcpServerImpl } = await import(
      '../../services/mcp/client.js'
    )
    let recon: MountedChromeMcp
    try {
      recon = await reconnectMcpServerImpl(SERVER, config)
    } catch (err) {
      logForDebugging(
        `[Claude in Chrome] Install setup MCP connect failed: ${err}`,
        { level: 'error' },
      )
      failReason = 'setup_reconnect_error'
      setPhase('failed')
      return
    }
    if (recon.client.type === 'connected') orphan = { config }
    if (recon.client.type !== 'connected' || inner.signal.aborted) {
      if (!inner.signal.aborted) {
        failReason = 'setup_client_not_connected'
        setPhase('failed')
      }
      return
    }
    const probeStarted = Date.now()
    let nudged = false
    let errors = 0
    while (!inner.signal.aborted) {
      const probe = await probeConnectedBrowsers(recon.client, inner.signal)
      if (probe === 'connected') {
        mounted = recon
        setPhase('connected')
        return
      }
      if (probe === 'error') {
        errors++
        if (errors >= PROBE_ERROR_LIMIT) {
          failReason = 'setup_probe_errors'
          setPhase('failed')
          return
        }
      } else {
        errors = 0
      }
      const elapsed = Date.now() - probeStarted
      if (!nudged && elapsed >= RECONNECT_NUDGE_MS) {
        nudged = true
        void openInChrome(CHROME_EXTENSION_RECONNECT_URL).catch(err => {
          logForDebugging(
            `[Claude in Chrome] Install setup reconnect nudge failed: ${err}`,
          )
        })
      }
      if (phase === 'connecting' && elapsed >= STALL_AFTER_MS) {
        setPhase('stalled')
      }
      await sleep(INSTALL_POLL_MS, inner.signal)
    }
  }

  function snapshot(): {
    phase: SetupPhase
    installPageOpened: boolean
  } {
    return { phase, installPageOpened }
  }

  function waitForPhaseOrAbort(): Promise<void> {
    return new Promise(resolve => {
      const unsub = emitter.subscribe(() => {
        unsub()
        inner.signal.removeEventListener('abort', onAbort)
        resolve()
      })
      const onAbort = () => {
        unsub()
        resolve()
      }
      inner.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  async function* payloadStream(): AsyncGenerator<{
    phase: SetupPhase
    installPageOpened: boolean
  }> {
    let current = snapshot()
    yield current
    while (!inner.signal.aborted) {
      if (snapshot().phase !== current.phase) {
        current = snapshot()
        yield current
        continue
      }
      await waitForPhaseOrAbort()
      if (inner.signal.aborted) return
    }
  }

  try {
    while (true) {
      // Gold recreates generator `y()` on every `keep_waiting`.
      const answer = await requestDialog(
        chromeInstallSetupSpec,
        payloadStream(),
        {
          signal: outer,
        },
      )
      if (answer === 'keep_waiting') continue
      const { phase: now } = snapshot()
      if (answer === 'continue' && now === 'connected' && mounted) {
        if (isChromeMcpDenied()) {
          chromeUpsellSad('policy_denied_late', {
            install_page_opened: installPageOpened,
          })
          return CHROME_POLICY_DENIED_MID_WAIT_STEERING
        }
        if (isBypassOrPlanBypass(ctx)) {
          chromeUpsellSad('bypass_mode_late', {
            install_page_opened: installPageOpened,
          })
          return CHROME_BYPASS_MODE_LATE_STEERING
        }
        const text = completeChromeInstall(ctx, mounted, installPageOpened)
        succeeded = true
        orphan = undefined
        return text
      }
      if (now === 'failed') {
        if (failReason === 'policy_denied_mid_wait') {
          chromeUpsellSad(failReason, {
            install_page_opened: installPageOpened,
          })
          return CHROME_POLICY_DENIED_MID_WAIT_STEERING
        }
        chromeUpsellBad(failReason, {
          install_page_opened: installPageOpened,
        })
        return CHROME_SETUP_CONNECT_FAILED_STEERING
      }
      if (answer === 'cancelled' && outer.aborted) {
        chromeUpsellSad('setup_aborted', {
          install_page_opened: installPageOpened,
        })
        return CHROME_SETUP_ABORTED_STEERING
      }
      chromeUpsellSad(
        now === 'waiting_install'
          ? 'setup_skipped_waiting_install'
          : now === 'connected'
            ? 'setup_skipped_after_connect'
            : 'setup_skipped_connecting',
        { install_page_opened: installPageOpened },
      )
      return CHROME_SETUP_SKIPPED_STEERING
    }
  } catch (err) {
    if (outer.aborted) {
      chromeUpsellSad('setup_aborted', {
        install_page_opened: installPageOpened,
      })
      return CHROME_SETUP_ABORTED_STEERING
    }
    logForDebugging(`[Claude in Chrome] Install setup dialog failed: ${err}`, {
      level: 'error',
    })
    chromeUpsellBad('setup_dialog_error', {
      install_page_opened: installPageOpened,
    })
    return CHROME_SETUP_INTERNAL_ERROR_STEERING
  } finally {
    outer.removeEventListener('abort', onOuterAbort)
    inner.abort()
    if (!succeeded) {
      if (mountedNative) clearClaudeInChromeWiredThisSession()
      void driver.then(() => {
        if (!orphan) return
        const { config } = orphan
        orphan = undefined
        void import('../../services/mcp/client.js')
          .then(mod => mod.clearServerCache(SERVER, config))
          .catch(err => {
            logForDebugging(
              `[Claude in Chrome] Install setup orphan cleanup failed: ${err}`,
              { level: 'error' },
            )
          })
      })
    }
  }
}

/** densable `KBA`. */
async function runInstallUpsellDialog(
  ctx: ToolUseContext,
  requestDialog: ChromeRequestDialog,
): Promise<string> {
  if (isChromeMcpDenied()) {
    logForDebugging(
      '[Claude in Chrome] Skipping install upsell: blocked by managed deniedMcpServers policy',
    )
    chromeUpsellSad('policy_denied')
    return CHROME_POLICY_DENIED_STEERING
  }
  if (await isChromeExtensionInstalled().catch(() => false)) {
    saveGlobalConfig(current =>
      current.cachedChromeExtensionInstalled === true
        ? current
        : { ...current, cachedChromeExtensionInstalled: true },
    )
    return CHROME_INSTALLED_NOT_ENABLED_STEERING
  }
  if (ctx.abortController.signal.aborted) {
    getChromeInstallSessionState().installUpsellResolution = undefined
    return chromeNotSetupSteering()
  }
  if (isBypassOrPlanBypass(ctx)) {
    logForDebugging(
      '[Claude in Chrome] Skipping install upsell: session auto-allows tool calls with no prompt (bypass or plan+bypass)',
    )
    const session = getChromeInstallSessionState()
    if (!session.installUpsellBypassSuppressionCounted) {
      session.installUpsellBypassSuppressionCounted = true
      chromeUpsellSad('suppressed_bypass_mode')
    }
    session.installUpsellResolution = undefined
    return chromeNotSetupSteering()
  }
  if ((await detectAvailableBrowser()) === null) {
    logForDebugging(
      '[Claude in Chrome] Skipping install upsell: no Chromium-family browser detected',
    )
    chromeUpsellSad('no_browser_detected')
    return chromeNotSetupSteering()
  }
  switch (
    await requestDialog(
      chromeInstallUpsellSpec,
      {},
      {
        signal: ctx.abortController.signal,
      },
    )
  ) {
    case 'install': {
      const text = await runChromeInstallSetup(ctx, requestDialog)
      if (text === CHROME_SETUP_ABORTED_STEERING) {
        getChromeInstallSessionState().installUpsellResolution = undefined
      }
      return text
    }
    case 'dont_ask_again':
      chromeUpsellSad('dont_ask_again')
      saveGlobalConfig(current =>
        current.chromeInstallUpsellDismissed === true
          ? current
          : { ...current, chromeInstallUpsellDismissed: true },
      )
      return CHROME_UPSELL_DECLINED_STEERING
    case 'not_now':
      chromeUpsellSad('declined')
      return CHROME_UPSELL_DECLINED_STEERING
    case 'cancelled':
      if (ctx.abortController.signal.aborted) {
        getChromeInstallSessionState().installUpsellResolution = undefined
        return chromeNotSetupSteering()
      }
      chromeUpsellSad('cancelled')
      return CHROME_UPSELL_DECLINED_STEERING
  }
  return CHROME_UPSELL_DECLINED_STEERING
}

/** densable `yau`. */
async function resolveInstallUpsell(ctx: ToolUseContext): Promise<string> {
  if (
    ctx.options?.isSkillPreload ||
    ctx.agentId !== undefined ||
    ctx.abortController.signal.aborted
  ) {
    return chromeNotSetupSteering()
  }
  const session = getChromeInstallSessionState()
  if (session.installUpsellResolution) {
    return session.installUpsellResolution
  }
  const requestDialog = ctx.requestDialog
  if (!requestDialog) {
    session.installUpsellResolution = Promise.resolve(chromeNotSetupSteering())
    return session.installUpsellResolution
  }
  session.installUpsellResolution = runInstallUpsellDialog(
    ctx,
    requestDialog,
  ).catch(err => {
    if (ctx.abortController.signal.aborted) {
      session.installUpsellResolution = undefined
      return chromeNotSetupSteering()
    }
    logForDebugging(`[Claude in Chrome] Install upsell failed: ${err}`, {
      level: 'error',
    })
    chromeUpsellBad('upsell_error')
    return chromeNotSetupSteering()
  })
  return session.installUpsellResolution
}

/** densable `ejA`. */
export async function resolveClaudeInChromeSkillPrompt(
  ctx: ToolUseContext,
): Promise<string> {
  const wired = isClaudeInChromeWiredThisSession()
  const hasChromeTools =
    ctx.options?.tools?.some(t => t.name?.startsWith(MCP_PREFIX)) ?? false
  if (!wired) return resolveInstallUpsell(ctx)
  if (hasChromeTools) return BASE_CHROME_PROMPT
  if (ctx.agentId !== undefined || ctx.options?.isSkillPreload) {
    return CHROME_AGENT_CONTEXT_STEERING
  }
  if (isChromeMcpDead(ctx.options?.mcpClients)) {
    logForDebugging(
      '[Claude in Chrome] Skill invoked while the chrome MCP client is in a dead state; steering away from browser tools',
    )
    return CHROME_MCP_DEAD_STEERING
  }
  if (hasClaudeInChromeInstallUpsellLatch()) {
    return resolveInstallUpsell(ctx)
  }
  return BASE_CHROME_PROMPT
}
