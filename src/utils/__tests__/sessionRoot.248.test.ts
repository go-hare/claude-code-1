/**
 * densable 2.1.248 leftover Session is official S from yGt/en/un/n().
 * Leftover class names. Not class Yt/jt/Ie/Fe/Oe/re/ge/Ke.
 *
 * Gold (SEA official-248/package/claude.exe, 226708128):
 * - yGt @178531733
 * - en @178531824 sha=379ff8dd5d0d4188
 * - un @178548313 sha=a9fa0bdb5650afc5
 * - n() @178548576 sha=28afd97c41d8c52c
 * - sn @178548001
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  claimBackgroundHousekeeping,
  claimStagingReap,
  dropHostGateSubscription,
  ensureConnectedClient,
  getFableCreditsRequired,
  getInferenceProfileBackingModelCached,
  getIsScrollDraining,
  getMidConvCachePromotionRejected,
  getSelectorGate,
  getSelectorGateEverOn,
  getServedModelsForRequestedModel,
  getSessionId,
  getStrictMcpConfig,
  getThinkingTypeOverride,
  getTotalCostUSD,
  isEffortUnsupported,
  isOauthTokenFromBgSnapshot,
  isPerTurnEffortOkEmitted,
  isStrictPrefixLockStoodDown,
  markEffortUnsupported,
  markMidConvCachePromotionRejected,
  markPerTurnEffortOkEmitted,
  markStrictPrefixLockStoodDown,
  recordServedModels,
  registerEnsureConnectedClient,
  replaceHostGateSubscription,
  resetFdCredentialState,
  resetRequestLatches,
  setFableCreditsRequired,
  setInferenceProfileBackingModel,
  setOauthTokenFromBgSnapshot,
  setSelectorGate,
  setStrictMcpConfig,
  setThinkingTypeOverride,
  stampAuthenticatedAccount,
  getAuthenticatedAccount,
  getAuthenticatedAccountEpoch,
} from '../../bootstrap/state.js'
import {
  clearGatewayAuth,
  getGatewayAuth,
  getGatewayRefreshInFlight,
  setGatewayAuth,
  setGatewayRefreshInFlight,
} from '../gatewayEnv.js'
import {
  createSessionHost,
  getBootstrapSession,
  getBootstrapSessionHost,
  resetSessionHostForTests,
} from '../sessionHost.js'
import { createRootSession } from '../sessionRoot.js'
import { DEFAULT_SURFACE_CAPS } from '../sessionSlots.js'

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

const OFFICIAL_CLASS_NAMES = [
  'class Yt',
  'class jt',
  'class Ie',
  'class Fe',
  'class Oe',
  'class re',
  'class ge',
  'class Ke',
] as const

beforeEach(() => {
  resetSessionHostForTests()
})

afterEach(() => {
  resetSessionHostForTests()
})

describe('densable 2.1.248 leftover Session is official n()', () => {
  test('sessionRoot locks official yGt/en/un/n and leftover names', () => {
    const root = src('../sessionRoot.ts')
    expect(root).toContain('Official yGt @178531733')
    expect(root).toContain('Official en @178531824 sha=379ff8dd5d0d4188')
    expect(root).toContain('Official un @178548313 sha=a9fa0bdb5650afc5')
    expect(root).toContain('Official n() @178548576')
    expect(root).toContain('function n(){return C()?.session??v}')
    expect(root).toContain('export function bindSession(')
    expect(root).toContain('export function createRootSession(')
    expect(root).toContain('export function createBootstrapSession(')
    expect(root).toContain('export function getBootstrapSession(')
    expect(root).toContain(
      'A withProject fork cannot re-identify the session — update the root session instead',
    )
    expect(root).toContain("kind: 'fork'")
    for (const name of OFFICIAL_CLASS_NAMES) {
      expect(root).not.toContain(name)
    }
  })

  test('sessionSlots leftover names, not official minified class names', () => {
    const slots = src('../sessionSlots.ts')
    expect(slots).toContain('export class CostLedger')
    expect(slots).toContain('export class SessionFlags')
    expect(slots).toContain('export class InvokedSkills')
    expect(slots).toContain('export class ModelStringsCache')
    expect(slots).toContain('export class Diagnostics')
    expect(slots).toContain('export class BackgroundHousekeeping')
    expect(slots).toContain('Official re @178514241')
    expect(slots).toContain('Official ge @178521439')
    expect(slots).toContain('Official He @178540219')
    for (const name of OFFICIAL_CLASS_NAMES) {
      expect(slots).not.toContain(name)
    }
  })

  test('sn mints official host bags including TelemetryHandles', () => {
    const host = src('../sessionHost.ts')
    expect(host).toContain('Official sn @178548001')
    expect(host).toContain(
      'backgroundHousekeeping: new BackgroundHousekeeping()',
    )
    expect(host).toContain('launchOptions: new LaunchOptions()')
    expect(host).toContain('settingsSource: new SettingsSource()')
    expect(host).toContain('extensionsConfig: new ExtensionsConfig()')
    expect(host).toContain('modelStringsCache: new ModelStringsCache()')
    expect(host).toContain('diagnostics: new Diagnostics()')
    expect(host).toContain('telemetryHandles: new TelemetryHandles()')
    expect(host).toContain('credentialSlots: new CredentialSlots()')
    expect(host).toContain('mcpProcessWiring: new McpProcessWiring()')
    expect(host).toContain('requestLatches: new RequestLatches()')
    expect(host).toContain('accountCreditLatches: new AccountCreditLatches()')
    expect(host).toContain('proactivity: new Proactivity()')
    for (const name of OFFICIAL_CLASS_NAMES) {
      expect(host).not.toContain(name)
    }
  })

  test('n() session.host is k.host; leftover getters read the bags', () => {
    const session = getBootstrapSession()
    expect(session.host).toBe(getBootstrapSessionHost())
    expect(getSessionId()).toBe(session.id as ReturnType<typeof getSessionId>)
    expect(getTotalCostUSD()).toBe(session.costLedger.totalCostUSD())
    expect(session.costLedger).toBe(session.root.costLedger)
    expect(session.host.launchOptions).toBe(
      getBootstrapSessionHost().launchOptions,
    )
  })

  test('withProject fork shares host and sibling bags', () => {
    const root = getBootstrapSession()
    const fork = root.withProject({ cwd: root.project.cwd })
    expect(fork.host).toBe(root.host)
    expect(fork.costLedger).toBe(root.costLedger)
    expect(fork.sessionFlags).toBe(root.sessionFlags)
    expect(fork.invokedSkills).toBe(root.invokedSkills)
    expect(fork.requestJournal).toBe(root.requestJournal)
    expect(fork.id).toBe(root.id)
    expect(fork.root).toBe(root.root)
  })

  test('withProject fork cannot re-identify', () => {
    const fork = getBootstrapSession().withProject({})
    expect(() => fork.update({ id: 'other' })).toThrow(
      'A withProject fork cannot re-identify the session — update the root session instead',
    )
  })

  test('diagnostics + DEFAULT_SURFACE_CAPS go through host bags', () => {
    const slots = src('../sessionSlots.ts')
    expect(slots).toContain('Official He @178540219')
    expect(slots).toContain('export class Diagnostics')
    expect(slots).toContain(
      'recordSlowOperation(_e?: unknown, _t?: unknown): void',
    )
    expect(slots).toContain('Official Yt @178525553')
    expect(slots).toContain('export const DEFAULT_SURFACE_CAPS')
    expect(slots).toContain("renderTarget: 'ink'")
    expect(slots).toContain("transcriptSource: 'local-jsonl'")
    expect(slots).toContain('#s: SurfaceCaps = DEFAULT_SURFACE_CAPS')
    expect(slots).toContain('this.#s = DEFAULT_SURFACE_CAPS')
    expect(slots).not.toContain('class Yt')
    expect(slots).not.toContain('#s: Record<string, unknown> = {}')

    const bag = getBootstrapSession().surfaceCapabilities
    expect(bag.caps()).toBe(DEFAULT_SURFACE_CAPS)
    expect(bag.caps()).toEqual({
      renderTarget: 'ink',
      workspace: 'local',
      canDrive: true,
      transcriptSource: 'local-jsonl',
      remote: null,
    })
    bag.markRemote(true)
    expect(bag.caps().workspace).toBe('remote')
    expect(bag.caps()).not.toBe(DEFAULT_SURFACE_CAPS)
    bag.reset()
    expect(bag.caps()).toBe(DEFAULT_SURFACE_CAPS)

    const diag = getBootstrapSessionHost().diagnostics
    expect(diag.errorLog()).toEqual([])
    expect(diag.slowOperations()).toEqual([])
    diag.recordError({ error: 'x', timestamp: 't' })
    expect(diag.errorLog()).toHaveLength(1)
    diag.recordSlowOperation('op', 1)
    expect(diag.slowOperations()).toEqual([])
    diag.reset()
    expect(diag.errorLog()).toEqual([])
  })

  test('createRootSession mints a distinct host from bootstrap n()', () => {
    const minted = createRootSession({
      host: createSessionHost(),
      id: 'minted-id',
      project: {
        originalCwd: '/tmp/a',
        projectRoot: '/tmp/a',
        cwd: '/tmp/a',
      },
    })
    expect(minted.id).toBe('minted-id')
    expect(minted.host).not.toBe(getBootstrapSessionHost())
    expect(minted.project.originalCwd).toBe('/tmp/a')
  })

  test('Se scroll and leftover getIsScrollDraining go through n().userPresence', () => {
    const slots = src('../sessionSlots.ts')
    expect(slots).toContain('Official Zt @178527118')
    expect(slots).toContain('scrollDraining()')
    expect(slots).toContain('markScrollActivity()')
    expect(slots).toContain('waitForScrollIdle()')
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'function mde(){return n().userPresence.scrollDraining()}',
    )
    expect(state).toContain(
      'async function JYe(){return n().userPresence.waitForScrollIdle()}',
    )
    const presence = getBootstrapSession().userPresence
    expect(presence.scrollDraining()).toBe(false)
    presence.markScrollActivity()
    expect(presence.scrollDraining()).toBe(true)
    expect(getIsScrollDraining()).toBe(true)
  })

  test('leftover Ue/We/Ge wrappers and Be/mGt go through k.host', () => {
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'function TL(){return n().host.mcpProcessWiring.strictConfig()}',
    )
    expect(state).toContain(
      'function Awn(e){n().host.mcpProcessWiring.replaceStrictConfig(e)}',
    )
    expect(state).toContain(
      'function tEn(){return n().host.accountCreditLatches.fableCreditsRequired()}',
    )
    expect(state).toContain(
      'function bEr(){return n().host.proactivity.selectorGate()}',
    )
    expect(state).toContain('n().host.telemetryHandles.installMeter')
    const host = src('../sessionHost.ts')
    expect(host).toContain('telemetryHandles: new TelemetryHandles()')
    const cache = src('../settings/settingsCache.ts')
    expect(cache).toContain('Official mGt')
    expect(cache).toContain('Official fGt @178505059')
    expect(cache).toContain('invalidateAll @178505706')
    expect(cache).toContain('Official D() @178167129')
    expect(cache).toContain('export class SettingsOwner')
    expect(cache).toContain('invalidateAll')
    expect(cache).toContain('primedFiles = new Set')
    expect(cache).toContain('folderListings = new Map')
    expect(cache).toContain('walkedFolders = new Map')
    expect(cache).toContain('policyWalks = 0')
    expect(cache).toContain('retained = new Map')
    expect(cache).toContain('retainedListings = new Map')
    expect(cache).toContain('changed = createSignal()')
    expect(cache).toContain('invalidated = createSignal()')
    expect(cache).toContain('settingsPrimerGate')
    expect(cache).not.toContain('class fGt')
    expect(cache).not.toContain('class Yt')
    const slots = src('../sessionSlots.ts')
    expect(slots).toContain('Official Be @178540857 sha=08a0c2551f39cfac')
    expect(slots).toContain('Official on() @178540750')
    expect(slots).toContain('attribute indicating which model made the change')
    expect(slots).toContain('createHostOtelBag')
    expect(slots).toContain('rateTokens: null')
    expect(slots).toContain('reportedDropReasons: new Set()')
    expect(slots).toContain('Official Yt @178525553')
    expect(slots).toContain('#s: SurfaceCaps = DEFAULT_SURFACE_CAPS')
    expect(slots).not.toContain('#s: Record<string, unknown> = {}')
    expect(slots).not.toContain('class Be')
    expect(slots).not.toContain('new Yt')
    expect(slots).not.toContain('#s = new Yt')
    expect(slots).not.toContain('class Yt')
    const th = getBootstrapSessionHost().telemetryHandles
    expect(th.hostOtel().rateTokens).toBeNull()
    expect(th.hostOtel().featureOkLogged).toBe(false)
    expect(th.isWindowOpen()).toBe(true)
    expect(th.bufferPendingEvent({ n: 1 })).toBe(true)
    th.closeWindow('test')
    expect(th.isWindowOpen()).toBe(false)
    expect(th.windowCloseCause()).toBe('test')
    th.reset()
    expect(th.isWindowOpen()).toBe(true)
    expect(getStrictMcpConfig()).toBe(false)
    setStrictMcpConfig(true)
    expect(getBootstrapSessionHost().mcpProcessWiring.strictConfig()).toBe(true)
    setStrictMcpConfig(false)
    setFableCreditsRequired(true)
    expect(getFableCreditsRequired()).toBe(true)
    setFableCreditsRequired(false)
    setSelectorGate(true)
    expect(getSelectorGate()).toBe(true)
    expect(getSelectorGateEverOn()).toBe(true)
    setSelectorGate(false)

    expect(state).toContain(
      'function w7e(e){n().host.mcpProcessWiring.registerEnsureConnectedClient(e)}',
    )
    expect(state).toContain(
      'function vx(){return n().host.mcpProcessWiring.ensureConnectedClient()}',
    )
    expect(state).toContain(
      'function kEr(e){n().host.proactivity.replaceHostGateSubscription(e)}',
    )
    expect(state).toContain('dropHostGateSubscription()')
    const dial = (): string => 'dialed'
    registerEnsureConnectedClient(dial)
    expect(ensureConnectedClient()).toBe(dial)
    expect(
      getBootstrapSessionHost().mcpProcessWiring.ensureConnectedClient(),
    ).toBe(dial)
    let dropped = false
    replaceHostGateSubscription(() => {
      dropped = true
    })
    dropHostGateSubscription()
    expect(dropped).toBe(true)
  })

  test('leftover o_/XFe and Gri/cTn go through k.host bags', () => {
    const gw = src('../gatewayEnv.ts')
    expect(gw).toContain('n().host.credentialSlots.gatewayAuth()')
    expect(gw).toContain(
      'getBootstrapSessionHost().credentialSlots.replaceGatewayAuth',
    )
    expect(gw).not.toContain('let gatewayAuth:')
    expect(gw).toContain('credentialSlots.gatewayRefreshInFlight()')
    expect(gw).not.toContain('let gatewayRefreshInFlight:')
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'n().host.requestLatches.midConvCachePromotionRejected()',
    )
    expect(state).toContain('markMidConvCachePromotionRejected()')
    expect(state).toContain('resetRequestLatches()')
    expect(state).not.toContain('clearMidConvCachePromotionRejected()')
    expect(state).not.toContain('setMidConvCachePromotionRejected')
    const session = {
      url: 'https://gw.example',
      jwt: 'tok',
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    }
    setGatewayAuth(session)
    expect(getGatewayAuth()).toBe(session)
    expect(getBootstrapSessionHost().credentialSlots.gatewayAuth()).toBe(
      session,
    )
    clearGatewayAuth()
    expect(getGatewayAuth()).toBeNull()
    expect(getMidConvCachePromotionRejected()).toBe(false)
    markMidConvCachePromotionRejected()
    expect(
      getBootstrapSessionHost().requestLatches.midConvCachePromotionRejected(),
    ).toBe(true)
    expect(getMidConvCachePromotionRejected()).toBe(true)
    resetRequestLatches()
    expect(
      getBootstrapSessionHost().requestLatches.midConvCachePromotionRejected(),
    ).toBe(false)

    const inflight = Promise.resolve({
      status: 'refreshed' as const,
      session,
    })
    setGatewayRefreshInFlight(inflight)
    expect(getGatewayRefreshInFlight()).toBe(inflight)
    expect(
      getBootstrapSessionHost().credentialSlots.gatewayRefreshInFlight(),
    ).toBe(inflight)
    setGatewayRefreshInFlight(null)
  })

  test('leftover _e/qe/Ne credential request and housekeeping wrappers', () => {
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain('oauthTokenFromBgSnapshot()')
    expect(state).toContain('resetFdCredentialState()')
    expect(state).toContain('stampAuthenticatedAccount')
    expect(state).toContain('thinkingTypeOverrides()')
    expect(state).toContain('recordServedModels')
    expect(state).toContain('markEffortUnsupported')
    expect(state).toContain('markStrictPrefixLockStoodDown')
    expect(state).toContain('markPerTurnEffortOkEmitted')
    expect(state).toContain('recordInferenceProfileBackingModel')
    expect(state).toContain('backgroundHousekeeping.claim()')
    expect(state).toContain('claimStagingReap()')

    expect(isOauthTokenFromBgSnapshot()).toBe(false)
    setOauthTokenFromBgSnapshot(true)
    expect(isOauthTokenFromBgSnapshot()).toBe(true)
    resetFdCredentialState()
    expect(isOauthTokenFromBgSnapshot()).toBe(false)

    stampAuthenticatedAccount({
      accountUuid: 'a',
      emailAddress: 'e@x',
      organizationUuid: 'o',
    })
    expect(getAuthenticatedAccount()).toEqual({
      accountUuid: 'a',
      emailAddress: 'e@x',
      organizationUuid: 'o',
    })
    const epoch = getAuthenticatedAccountEpoch()
    stampAuthenticatedAccount({
      accountUuid: 'a',
      emailAddress: 'e@x',
      organizationUuid: 'o',
    })
    expect(getAuthenticatedAccountEpoch()).toBe(epoch)

    setThinkingTypeOverride('m1', 'enabled')
    expect(getThinkingTypeOverride('m1')).toBe('enabled')
    recordServedModels('req', ['served'])
    expect(getServedModelsForRequestedModel('req')).toEqual(['served'])
    expect(isEffortUnsupported('m2')).toBe(false)
    markEffortUnsupported('m2')
    expect(isEffortUnsupported('m2')).toBe(true)
    expect(isStrictPrefixLockStoodDown()).toBe(false)
    markStrictPrefixLockStoodDown()
    expect(isStrictPrefixLockStoodDown()).toBe(true)
    expect(isPerTurnEffortOkEmitted()).toBe(false)
    markPerTurnEffortOkEmitted()
    expect(isPerTurnEffortOkEmitted()).toBe(true)
    setInferenceProfileBackingModel('arn', 'backing')
    expect(getInferenceProfileBackingModelCached('arn')).toBe('backing')

    expect(claimBackgroundHousekeeping()).toBe(true)
    expect(claimBackgroundHousekeeping()).toBe(false)
    expect(claimStagingReap()).toBe(true)
    expect(claimStagingReap()).toBe(false)
  })

  test('un() id is official avt()??Iq()', () => {
    const root = src('../sessionRoot.ts')
    expect(root).toContain('Official avt @178495998')
    expect(root).toContain('Official i7 @178495421')
    expect(root).toContain('CLAUDE_CODE_REMOTE_SESSION_ID')
    const prev = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'remote-align'
    resetSessionHostForTests()
    const first = getBootstrapSession().id
    resetSessionHostForTests()
    const second = getBootstrapSession().id
    expect(first).toBe(second)
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    if (prev === undefined) delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    else process.env.CLAUDE_CODE_REMOTE_SESSION_ID = prev
    resetSessionHostForTests()
  })
})
