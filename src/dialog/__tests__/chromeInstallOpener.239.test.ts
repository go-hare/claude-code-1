/**
 * densable 2.1.239 t(zOo)/t(jOo) production opener (KBA / Mby / ejA / Lby).
 *
 * Process-global mock.module — restore afterAll (resumeReturn.239 pattern).
 * Renderer assertions that lock "no openInChrome in Host" stay in
 * chromeInstallRenderer.239.test.ts.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  getIsInteractive,
  getIsRemoteMode,
  getSessionBypassPermissionsMode,
  setIsInteractive,
  setIsRemoteMode,
  setSessionBypassPermissionsMode,
} from '../../bootstrap/state.js'
import {
  CHROME_INSTALL_SETUP_KIND,
  CHROME_INSTALL_UPSELL_KIND,
} from '../specs/jsuKinds.js'
import { createDialogMailbox } from '../dialogMailbox.js'
import { createDialogStore } from '../dialogStore.js'
import { createRequestDialog } from '../requestDialog.js'
import { BASE_CHROME_PROMPT } from '../../utils/claudeInChrome/prompt.js'
import { CHROME_EXTENSION_URL } from '../../utils/claudeInChrome/setupPortable.js'
import { CHROME_EXTENSION_RECONNECT_URL } from '../../utils/claudeInChrome/setup.js'
import {
  resetChromeInstallSessionState,
  setClaudeInChromeWiredThisSession,
  hasClaudeInChromeInstallUpsellLatch,
} from '../../utils/claudeInChrome/sessionState.js'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../skills/bundledSkills.js'

import * as realConfig from 'src/utils/config.js'
import * as realAnalytics from 'src/services/analytics/index.js'
import * as realGrowthbook from 'src/services/analytics/growthbook.js'
import * as realSetup from 'src/utils/claudeInChrome/setup.js'
import * as realCommon from 'src/utils/claudeInChrome/common.js'
import * as realMcpConfig from 'src/services/mcp/config.js'
import * as realMcpClient from 'src/services/mcp/client.js'
import * as realTeammate from 'src/utils/teammate.js'

const configSnap = snapshotModuleExports(realConfig)
const analyticsSnap = snapshotModuleExports(realAnalytics)
const growthbookSnap = snapshotModuleExports(realGrowthbook)
const setupSnap = snapshotModuleExports(realSetup)
const commonSnap = snapshotModuleExports(realCommon)
const mcpConfigSnap = snapshotModuleExports(realMcpConfig)
const mcpClientSnap = snapshotModuleExports(realMcpClient)
const teammateSnap = snapshotModuleExports(realTeammate)

const SERVER = 'claude-in-chrome'

const configState = {
  chromeInstallUpsellDismissed: false as boolean | undefined,
  claudeInChromeDefaultEnabled: undefined as boolean | undefined,
  hasCompletedClaudeInChromeOnboarding: undefined as boolean | undefined,
  cachedChromeExtensionInstalled: undefined as boolean | undefined,
}

const events: Array<[string, Record<string, unknown>]> = []
const openedUrls: string[] = []
const setupCalls: Array<{ skipReconnectAutoOpen?: boolean }> = []

let gbChromeUpsell = true
let mcpDenied = false
let extensionInstalled = false
let extensionEvidence = false
let baseEligible = true
let detectedBrowser: 'chrome' | null = 'chrome'
let agentId: string | undefined
let probeBrowsersJson = '[{"id":1}]'

const stdioConfig = {
  type: 'stdio' as const,
  command: 'mock-chrome-mcp',
  args: [] as string[],
  scope: 'dynamic' as const,
}

const configMock = {
  ...configSnap,
  getGlobalConfig: () => ({
    ...configSnap.getGlobalConfig(),
    ...configState,
  }),
  saveGlobalConfig: (
    updater:
      | Record<string, unknown>
      | ((c: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    const base = { ...configSnap.getGlobalConfig(), ...configState }
    const next = typeof updater === 'function' ? updater(base) : updater
    if ('chromeInstallUpsellDismissed' in next) {
      configState.chromeInstallUpsellDismissed =
        next.chromeInstallUpsellDismissed as boolean | undefined
    }
    if ('claudeInChromeDefaultEnabled' in next) {
      configState.claudeInChromeDefaultEnabled =
        next.claudeInChromeDefaultEnabled as boolean | undefined
    }
    if ('hasCompletedClaudeInChromeOnboarding' in next) {
      configState.hasCompletedClaudeInChromeOnboarding =
        next.hasCompletedClaudeInChromeOnboarding as boolean | undefined
    }
    if ('cachedChromeExtensionInstalled' in next) {
      configState.cachedChromeExtensionInstalled =
        next.cachedChromeExtensionInstalled as boolean | undefined
    }
  },
}

mock.module('src/utils/config.js', () => configMock)
mock.module('src/utils/config.ts', () => configMock)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: (name: string, props: Record<string, unknown> = {}) => {
    events.push([name, props])
  },
}))
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) =>
    key === 'tengu_chrome_install_upsell' ? gbChromeUpsell : fallback,
}))
mock.module('src/utils/claudeInChrome/setup.js', () => ({
  ...setupSnap,
  isChromeExtensionInstalled: async () => extensionInstalled,
  hasChromeExtensionEvidence: () => extensionEvidence,
  hasBaseChromeAutoEnableEligibility: () => baseEligible,
  getClaudeInChromeStdioConfig: () => stdioConfig,
  setupClaudeInChrome: (opts?: { skipReconnectAutoOpen?: boolean }) => {
    setupCalls.push({ skipReconnectAutoOpen: opts?.skipReconnectAutoOpen })
    setClaudeInChromeWiredThisSession(true)
    return {
      mcpConfig: { [SERVER]: stdioConfig },
      allowedTools: [`mcp__${SERVER}__navigate`],
      systemPrompt: '',
    }
  },
}))
mock.module('src/utils/claudeInChrome/setup.ts', () => ({
  ...setupSnap,
  isChromeExtensionInstalled: async () => extensionInstalled,
  hasChromeExtensionEvidence: () => extensionEvidence,
  hasBaseChromeAutoEnableEligibility: () => baseEligible,
  getClaudeInChromeStdioConfig: () => stdioConfig,
  setupClaudeInChrome: (opts?: { skipReconnectAutoOpen?: boolean }) => {
    setupCalls.push({ skipReconnectAutoOpen: opts?.skipReconnectAutoOpen })
    setClaudeInChromeWiredThisSession(true)
    return {
      mcpConfig: { [SERVER]: stdioConfig },
      allowedTools: [`mcp__${SERVER}__navigate`],
      systemPrompt: '',
    }
  },
}))
mock.module('src/utils/claudeInChrome/common.js', () => ({
  ...commonSnap,
  openInChrome: async (url: string) => {
    openedUrls.push(url)
    if (url === CHROME_EXTENSION_URL) extensionInstalled = true
    return true
  },
  detectAvailableBrowser: async () => detectedBrowser,
}))
mock.module('src/utils/claudeInChrome/common.ts', () => ({
  ...commonSnap,
  openInChrome: async (url: string) => {
    openedUrls.push(url)
    if (url === CHROME_EXTENSION_URL) extensionInstalled = true
    return true
  },
  detectAvailableBrowser: async () => detectedBrowser,
}))
mock.module('src/services/mcp/config.js', () => ({
  ...mcpConfigSnap,
  isMcpServerDenied: () => mcpDenied,
}))
mock.module('src/services/mcp/config.ts', () => ({
  ...mcpConfigSnap,
  isMcpServerDenied: () => mcpDenied,
}))
mock.module('src/services/mcp/client.js', () => ({
  ...mcpClientSnap,
  reconnectMcpServerImpl: async (name: string, config: typeof stdioConfig) => ({
    client: {
      name,
      type: 'connected' as const,
      client: {
        callTool: async () => ({
          content: [{ type: 'text', text: probeBrowsersJson }],
        }),
      },
      capabilities: {},
      config,
      cleanup: async () => {},
    },
    tools: [{ name: `mcp__${name}__navigate` }],
    commands: [],
  }),
  clearServerCache: async () => {},
}))
mock.module('src/services/mcp/client.ts', () => ({
  ...mcpClientSnap,
  reconnectMcpServerImpl: async (name: string, config: typeof stdioConfig) => ({
    client: {
      name,
      type: 'connected' as const,
      client: {
        callTool: async () => ({
          content: [{ type: 'text', text: probeBrowsersJson }],
        }),
      },
      capabilities: {},
      config,
      cleanup: async () => {},
    },
    tools: [{ name: `mcp__${name}__navigate` }],
    commands: [],
  }),
  clearServerCache: async () => {},
}))
mock.module('src/utils/teammate.js', () => ({
  ...teammateSnap,
  getAgentId: () => agentId,
}))
mock.module('src/utils/teammate.ts', () => ({
  ...teammateSnap,
  getAgentId: () => agentId,
}))

const {
  CHROME_UPSELL_DECLINED_STEERING,
  CHROME_SETUP_SKIPPED_STEERING,
  CHROME_SETUP_ABORTED_STEERING,
  CHROME_MCP_DEAD_STEERING,
  chromeNotSetupSteering,
  isClaudeInChromeInstallUpsellEligible,
  resolveClaudeInChromeSkillPrompt,
} =
  require('../../utils/claudeInChrome/installUpsell.js') as typeof import('../../utils/claudeInChrome/installUpsell.js')

const { registerClaudeInChromeSkill } =
  require('../../skills/bundled/claudeInChrome.js') as typeof import('../../skills/bundled/claudeInChrome.js')

type DialogStore = ReturnType<typeof createDialogStore>

function wireMailbox(store: DialogStore) {
  const mailbox = createDialogMailbox()
  const owned = new Set<string>()
  mailbox.subscribe(entry => {
    owned.add(entry.id)
    store.open(entry)
  })
  mailbox.onUpdate(({ id, payload }) => {
    if (owned.has(id)) store.update(id, payload)
  })
  mailbox.onCancel(id => {
    store.dismiss(id)
  })
  store.onClosed(event => {
    if (!owned.delete(event.id)) return
    mailbox.reply(
      event.type === 'answered'
        ? { id: event.id, result: event.result }
        : { id: event.id, cancelled: true },
    )
  })
  return createRequestDialog(mailbox)
}

async function waitForTop(store: DialogStore, kind: string, timeoutMs = 2000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const top = store.getState().open.at(-1)
    if (top?.kind === kind) return top
    await Bun.sleep(0)
  }
  throw new Error(`timed out waiting for ${kind}`)
}

async function waitForSetupPhase(
  store: DialogStore,
  phase: string,
  timeoutMs = 3000,
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const top = store.getState().open.at(-1)
    if (top?.kind === CHROME_INSTALL_SETUP_KIND) {
      const payload = top.payload as { phase?: string }
      if (payload.phase === phase) return top
    }
    await Bun.sleep(5)
  }
  throw new Error(`timed out waiting for setup phase=${phase}`)
}

function makeCtx(
  requestDialog?: ReturnType<typeof createRequestDialog>,
  extra: {
    aborted?: boolean
    isSkillPreload?: boolean
    agentId?: string
    tools?: Array<{ name: string }>
    mcpClients?: Array<{ name: string; type: string }>
    mode?: string
    isBypassPermissionsModeAvailable?: boolean
  } = {},
): ToolUseContext {
  const abortController = new AbortController()
  if (extra.aborted) abortController.abort()
  let appState = {
    toolPermissionContext: {
      mode: extra.mode ?? 'default',
      isBypassPermissionsModeAvailable:
        extra.isBypassPermissionsModeAvailable ?? false,
    },
    mcp: {
      clients: extra.mcpClients ?? [],
      tools: extra.tools ?? [],
      commands: [] as unknown[],
      resources: {},
    },
  }
  return {
    abortController,
    requestDialog,
    agentId: extra.agentId,
    options: {
      isSkillPreload: extra.isSkillPreload,
      tools: extra.tools ?? [],
      mcpClients: extra.mcpClients ?? [],
    },
    getAppState: () => appState,
    setAppState: (fn: (prev: typeof appState) => typeof appState) => {
      appState = fn(appState)
    },
    onChangeDynamicMcpConfig: () => {},
  } as unknown as ToolUseContext
}

const prevInteractive = getIsInteractive()
const prevRemote = getIsRemoteMode()
const prevBypass = getSessionBypassPermissionsMode()
const prevSessionKind = process.env.CLAUDE_CODE_SESSION_KIND
const prevSafeMode = process.env.CLAUDE_CODE_SAFE_MODE

beforeEach(() => {
  resetChromeInstallSessionState()
  configState.chromeInstallUpsellDismissed = false
  configState.claudeInChromeDefaultEnabled = undefined
  configState.hasCompletedClaudeInChromeOnboarding = undefined
  configState.cachedChromeExtensionInstalled = undefined
  events.length = 0
  openedUrls.length = 0
  setupCalls.length = 0
  gbChromeUpsell = true
  mcpDenied = false
  extensionInstalled = false
  extensionEvidence = false
  baseEligible = true
  detectedBrowser = 'chrome'
  agentId = undefined
  probeBrowsersJson = '[{"id":1}]'
  setIsInteractive(true)
  setIsRemoteMode(false)
  setSessionBypassPermissionsMode(false)
  delete process.env.CLAUDE_CODE_SESSION_KIND
  delete process.env.CLAUDE_CODE_SAFE_MODE
  clearBundledSkills()
})

afterEach(() => {
  clearBundledSkills()
  resetChromeInstallSessionState()
})

afterAll(() => {
  setIsInteractive(prevInteractive)
  setIsRemoteMode(prevRemote)
  setSessionBypassPermissionsMode(prevBypass)
  if (prevSessionKind === undefined) {
    delete process.env.CLAUDE_CODE_SESSION_KIND
  } else {
    process.env.CLAUDE_CODE_SESSION_KIND = prevSessionKind
  }
  if (prevSafeMode === undefined) {
    delete process.env.CLAUDE_CODE_SAFE_MODE
  } else {
    process.env.CLAUDE_CODE_SAFE_MODE = prevSafeMode
  }
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.ts', () => ({ ...configSnap }))
  mock.module('src/services/analytics/index.js', () => ({
    ...analyticsSnap,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/utils/claudeInChrome/setup.js', () => ({ ...setupSnap }))
  mock.module('src/utils/claudeInChrome/setup.ts', () => ({ ...setupSnap }))
  mock.module('src/utils/claudeInChrome/common.js', () => ({
    ...commonSnap,
  }))
  mock.module('src/utils/claudeInChrome/common.ts', () => ({
    ...commonSnap,
  }))
  mock.module('src/services/mcp/config.js', () => ({ ...mcpConfigSnap }))
  mock.module('src/services/mcp/config.ts', () => ({ ...mcpConfigSnap }))
  mock.module('src/services/mcp/client.js', () => ({ ...mcpClientSnap }))
  mock.module('src/services/mcp/client.ts', () => ({ ...mcpClientSnap }))
  mock.module('src/utils/teammate.js', () => ({ ...teammateSnap }))
  mock.module('src/utils/teammate.ts', () => ({ ...teammateSnap }))
})

describe('Lby isClaudeInChromeInstallUpsellEligible', () => {
  test('true when GB + gates pass', () => {
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(true)
  })

  test('false when wired / latch / dismissed / GB / evidence / denied', () => {
    setClaudeInChromeWiredThisSession(true)
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    resetChromeInstallSessionState()

    getChromeLatch()
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    resetChromeInstallSessionState()

    configState.chromeInstallUpsellDismissed = true
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    configState.chromeInstallUpsellDismissed = false

    gbChromeUpsell = false
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    gbChromeUpsell = true

    extensionEvidence = true
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    extensionEvidence = false

    mcpDenied = true
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    mcpDenied = false

    baseEligible = false
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    baseEligible = true

    setIsInteractive(false)
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    setIsInteractive(true)

    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    delete process.env.CLAUDE_CODE_SESSION_KIND

    agentId = 'agent-1'
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    agentId = undefined

    setSessionBypassPermissionsMode(true)
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
    setSessionBypassPermissionsMode(false)
  })
})

function getChromeLatch(): void {
  const { getChromeInstallSessionState } =
    require('../../utils/claudeInChrome/sessionState.js') as typeof import('../../utils/claudeInChrome/sessionState.js')
  getChromeInstallSessionState().installUpsellResolution =
    Promise.resolve('latched')
}

describe('KBA t(zOo) answers', () => {
  test('not_now declines without dismissed latch', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = resolveClaudeInChromeSkillPrompt(makeCtx(requestDialog))
    const top = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(top.id, 'not_now')
    expect(await pending).toBe(CHROME_UPSELL_DECLINED_STEERING)
    expect(configState.chromeInstallUpsellDismissed).toBe(false)
    // densable be("chrome_install_upsell", "declined") → tengu_feature_sad
    expect(
      events.some(
        e =>
          e[0] === 'tengu_feature_sad' &&
          e[1]?.feature_name === 'chrome_install_upsell' &&
          e[1]?.error_code === 'declined',
      ),
    ).toBe(true)
    expect(openedUrls).toEqual([])
  })

  test('dont_ask_again persists chromeInstallUpsellDismissed', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = resolveClaudeInChromeSkillPrompt(makeCtx(requestDialog))
    const top = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(top.id, 'dont_ask_again')
    expect(await pending).toBe(CHROME_UPSELL_DECLINED_STEERING)
    expect(configState.chromeInstallUpsellDismissed).toBe(true)
    expect(
      events.some(
        e =>
          e[0] === 'tengu_feature_sad' && e[1]?.error_code === 'dont_ask_again',
      ),
    ).toBe(true)
    expect(isClaudeInChromeInstallUpsellEligible()).toBe(false)
  })

  test('cancelled (no abort) declines', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = resolveClaudeInChromeSkillPrompt(makeCtx(requestDialog))
    const top = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(top.id, 'cancelled')
    expect(await pending).toBe(CHROME_UPSELL_DECLINED_STEERING)
    expect(configState.chromeInstallUpsellDismissed).toBe(false)
    expect(
      events.some(
        e => e[0] === 'tengu_feature_sad' && e[1]?.error_code === 'cancelled',
      ),
    ).toBe(true)
  })
})

describe('Mby t(jOo) wait-loop', () => {
  test('keep_waiting reopens; continue+connected writes three fields', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = resolveClaudeInChromeSkillPrompt(makeCtx(requestDialog))
    const upsell = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(upsell.id, 'install')
    const first = await waitForTop(store, CHROME_INSTALL_SETUP_KIND)
    store.answer(first.id, 'keep_waiting')
    const connected = await waitForSetupPhase(store, 'connected')
    store.answer(connected.id, 'continue')
    const text = await pending
    expect(text.startsWith('Claude in Chrome setup completed:')).toBe(true)
    expect(text).toContain(BASE_CHROME_PROMPT)
    expect(openedUrls[0]).toBe(CHROME_EXTENSION_URL)
    expect(openedUrls).not.toContain(CHROME_EXTENSION_RECONNECT_URL)
    expect(setupCalls).toEqual([{ skipReconnectAutoOpen: true }])
    expect(configState.claudeInChromeDefaultEnabled).toBe(true)
    expect(configState.hasCompletedClaudeInChromeOnboarding).toBe(true)
    expect(configState.cachedChromeExtensionInstalled).toBe(true)
    // densable Ee("chrome_install_upsell", {install_page_opened}) — the only
    // ok outcome of the funnel.
    expect(
      events.some(
        e => e[0] === 'tengu_feature_ok' && e[1]?.install_page_opened,
      ),
    ).toBe(true)
  })

  test('skip while waiting returns skipped steering', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = resolveClaudeInChromeSkillPrompt(makeCtx(requestDialog))
    const upsell = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(upsell.id, 'install')
    const setup = await waitForTop(store, CHROME_INSTALL_SETUP_KIND)
    store.answer(setup.id, 'skip')
    expect(await pending).toBe(CHROME_SETUP_SKIPPED_STEERING)
  })

  test('abort during setup returns aborted copy and clears latch', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const ctx = makeCtx(requestDialog)
    const pending = resolveClaudeInChromeSkillPrompt(ctx)
    const upsell = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(upsell.id, 'install')
    await waitForTop(store, CHROME_INSTALL_SETUP_KIND)
    ctx.abortController.abort()
    expect(await pending).toBe(CHROME_SETUP_ABORTED_STEERING)
    expect(hasClaudeInChromeInstallUpsellLatch()).toBe(false)
  })
})

describe('ejA skill Fby wiring', () => {
  test('isEnabled is Bmn() || Lby(); Task suffix has no extra blank line', async () => {
    registerClaudeInChromeSkill()
    const skill = getBundledSkills().find(s => s.name === 'claude-in-chrome')
    expect(skill).toBeDefined()
    expect(skill?.type).toBe('prompt')
    if (skill?.type !== 'prompt') throw new Error('expected prompt skill')
    expect(skill.allowedTools).toEqual([])
    expect(skill.isEnabled?.()).toBe(true)

    gbChromeUpsell = false
    expect(skill.isEnabled?.()).toBe(false)
    setClaudeInChromeWiredThisSession(true)
    expect(skill.isEnabled?.()).toBe(true)

    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const ctx = makeCtx(requestDialog)
    resetChromeInstallSessionState()
    gbChromeUpsell = true
    const pending = skill.getPromptForCommand('click login', ctx)
    const upsell = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(upsell.id, 'not_now')
    const blocks = await pending
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'text',
      text: `${CHROME_UPSELL_DECLINED_STEERING}\n## Task\nclick login`,
    })
  })

  test('wired + disabled chrome client (no tools) returns JBA', async () => {
    setClaudeInChromeWiredThisSession(true)
    const text = await resolveClaudeInChromeSkillPrompt(
      makeCtx(undefined, {
        tools: [],
        mcpClients: [{ name: SERVER, type: 'disabled' }],
      }),
    )
    expect(text).toBe(CHROME_MCP_DEAD_STEERING)
  })

  test('preload / abort skip the dialog', async () => {
    expect(
      await resolveClaudeInChromeSkillPrompt(
        makeCtx(undefined, { isSkillPreload: true }),
      ),
    ).toBe(chromeNotSetupSteering())
    expect(
      await resolveClaudeInChromeSkillPrompt(
        makeCtx(undefined, { aborted: true }),
      ),
    ).toBe(chromeNotSetupSteering())
  })
})
