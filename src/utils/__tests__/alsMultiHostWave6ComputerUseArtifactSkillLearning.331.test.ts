import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  handleToolCall,
  resetMouseButtonHeld,
} from '../../../packages/@ant/computer-use-mcp/src/toolCalls.js'
import type {
  ComputerExecutor,
  ComputerUseHostAdapter,
  ComputerUseOverrides,
} from '@ant/computer-use-mcp'

import {
  getArtifactLiveArmDeps,
  isArtifactLiveArmDepsInstalled,
  resetArtifactLiveArmDepsForTests,
  setArtifactLiveArmDeps,
} from '../../services/artifactAutoReact/arm.js'
import {
  assetRxl,
  setAssetRxlDepsForTests,
} from '../../services/artifactAutoReact/assetRxl.js'
import {
  installArtifactAutoReactProduct,
  isArtifactAutoReactProductInstalled,
  resetArtifactAutoReactProductForTests,
} from '../../services/artifactAutoReact/bootstrap.js'
import {
  DL,
  setFrameDlDepsForTests,
} from '../../services/artifactAutoReact/frameDl.js'
import {
  getArtifactFrameRelayHost,
  resetArtifactFrameRelayHostForTests,
  setArtifactFrameRelayHost,
} from '../../services/artifactAutoReact/frameRelay.js'
import { registerAutoReactAvailability } from '../../services/artifactAutoReact/gates.js'
import {
  claimLedgerOwnership,
  scheduleLedgerDebounce,
} from '../../services/artifactAutoReact/ledger.js'
import {
  artifactLiveEditVf,
  getArtifactLiveEditVf,
  resetArtifactLiveEditVfForTests,
  setArtifactLiveEditVf,
} from '../../services/artifactAutoReact/liveEditPermissions.js'
import {
  getNztHost,
  resetNztRunnerForTests,
  setNztHost,
  setNztRunner,
  Ttn,
} from '../../services/artifactAutoReact/nzt.js'
import { monitorSocketRegistry } from '../../services/artifactAutoReact/oF.js'
import {
  _U,
  B7n,
  D1n,
  getConsentStateForTests,
  Hzr,
  NPe,
  OCo,
  Ozr,
  qBe,
  R7e,
  resetConsentStateForTests,
} from '../../services/artifactAutoReact/readPerm/consent.js'
import {
  GHt,
  provenanceState,
  resetProvenanceStateForTests,
  setProvenanceDepsForTests,
  Sh,
  Ue,
} from '../../services/artifactAutoReact/readPerm/provenance.js'
import {
  isArtifactUserOnlyConsentGateOn,
  isClassifierDecidingMode,
  isPlanModeBypassElevated,
  setConsentSurfaceDepsForTests,
} from '../../services/artifactAutoReact/readPerm/surfaces.js'
import {
  getArtifactRoomHost,
  resetArtifactRoomHostForTests,
  sendArtifactRoomEvent,
  setArtifactRoomHost,
} from '../../services/artifactAutoReact/restApis.js'
import {
  getArtifactScanDeps,
  resetArtifactScanDepsForTests,
  scheduleCommentScan,
  setArtifactScanDeps,
} from '../../services/artifactAutoReact/scan.js'
import { un } from '../../services/artifactAutoReact/store.js'
import {
  callWatchUrlTool,
  resetWatchUrlDepsForTests,
  setWatchUrlDeps,
} from '../../services/artifactAutoReact/watchUrl.js'

import {
  getSkillLearningConfig,
  resetSkillLearningConfig,
  setSkillLearningConfigForTest,
} from '../../services/skillLearning/config.js'
import { createInstinct } from '../../services/skillLearning/instinctParser.js'
import {
  loadInstincts,
  saveInstinct,
  upsertInstinct,
} from '../../services/skillLearning/instinctStore.js'
import { resetCircuitBreaker } from '../../services/skillLearning/llmObserverBackend.js'
import {
  analyzeWithActiveBackend,
  getActiveObserverBackend,
  listObserverBackends,
  registerObserverBackend,
  resetObserverBackendsForTest,
  setActiveObserverBackend,
} from '../../services/skillLearning/observerBackend.js'
import { resolveProjectContext } from '../../services/skillLearning/projectContext.js'
import {
  checkPromotion,
  resetPromotionBookkeeping,
} from '../../services/skillLearning/promotion.js'
import {
  getRuntimeTurn,
  initSkillLearning,
  resetRuntimeObserverForTest,
} from '../../services/skillLearning/runtimeObserver.js'
import '../../services/skillLearning/sessionObserver.js'
import {
  hasToolHookObservationsForTurn,
  recordToolStart,
  resetToolHookBookkeeping,
  resetToolHookDepsCache,
} from '../../services/skillLearning/toolEventObserver.js'

import {
  isTrackedClaudeInChromeTabId,
  trackClaudeInChromeTabId,
} from '../claudeInChrome/common.js'
import {
  clearChromeUploadAttachmentDigestsForTests,
  getChromeUploadAttachmentDigest,
  registerChromeUploadAttachmentDigest,
} from '../claudeInChrome/fileUpload.js'
import { shouldAutoEnableClaudeInChrome } from '../claudeInChrome/setup.js'

import {
  isLockHeldLocally,
  releaseComputerUseLock,
  tryAcquireComputerUseLock,
} from '../computerUse/computerUseLock.js'
import { releasePump, retainPump } from '../computerUse/drainRunLoop.js'
import {
  notifyExpectedEscape,
  unregisterEscHotkey,
} from '../computerUse/escHotkey.js'
import { createCrossPlatformExecutor } from '../computerUse/executorCrossPlatform.js'
import { getChicagoCoordinateMode } from '../computerUse/gates.js'
import {
  getComputerUseHostAdapter,
  isComputerUseSystemKeyCombosGranted,
  setComputerUseSystemKeyCombosReader,
} from '../computerUse/hostAdapter.js'
import {
  assertSafeKeyChord,
  getActiveHeldKeys,
  trackHeldChord,
} from '../computerUse/keyChordSafety.js'
import { loadPlatform } from '../computerUse/platforms/index.js'
import {
  bindFile,
  getBoundAppType,
  getBoundHwnd,
  unbindWindow,
} from '../computerUse/platforms/win32.js'
import { requireComputerUseSwift } from '../computerUse/swiftLoader.js'
import { stopBridge } from '../computerUse/win32/bridgeClient.js'
import {
  hideIndicator,
  updateIndicator,
} from '../computerUse/win32/inputIndicator.js'
import { isVirtualCursorActive } from '../computerUse/win32/virtualCursor.js'
import { clearEditChildCache } from '../computerUse/win32/windowMessage.js'
import { buildSessionContext } from '../computerUse/wrapper.js'
import {
  getActiveSessionFromAls,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'

const tick = (ms = 5) => new Promise<void>(r => setTimeout(r, ms))

describe('Wave 6 Agent 5: ALS multi-host isolation (ArtifactAutoReact, SkillLearning, ClaudeInChrome, ComputerUse)', () => {
  let tempRoot: string

  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'als-wave6-a5-'))
  })

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Group 1: ArtifactAutoReact
  // -------------------------------------------------------------------------
  describe('ArtifactAutoReact multi-host isolation', () => {
    test('arm, scan, watchUrl, liveEditPermissions, frameRelay, restApis, nzt, oF, bootstrap isolate concurrent hosts', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'ar-host-a' }, async () => {
          setArtifactLiveArmDeps({ localArmWithoutSocket: true })
          setArtifactScanDeps({ getPermissionMode: () => 'plan' })
          setWatchUrlDeps({
            callTool: async name => ({ isError: false, text: `A:${name}` }),
          })
          setArtifactLiveEditVf(artifactLiveEditVf)
          setArtifactFrameRelayHost({
            fetchArtifactMount: async () => ({
              ok: true,
              status: 200,
              bytes: Buffer.from('A'),
              contentType: 'text/plain',
            }),
          })
          setArtifactRoomHost({
            sendRoomEvent: () => ({ ok: true, peers: 11 }),
          })
          setNztRunner(async function* (tu) {
            yield {
              message: {
                type: 'user',
                message: {
                  content: [{ type: 'tool_result', tool_use_id: tu.id }],
                },
                toolUseResult: { replied: true, comment_id: 'cmt-A' },
              },
            }
          })
          setNztHost({
            getToolUseContext: () => null,
            canUseTool: async (_t, input) => ({
              behavior: 'allow',
              updatedInput: input,
            }),
          })
          let closedA = false
          monitorSocketRegistry.set('task-shared-id', {
            close: () => {
              closedA = true
            },
          })

          await tick(15)

          const ttnRes = await Ttn({
            url: 'https://claude.ai/code/artifact/slug-a',
            slug: 'slug-a',
            threadId: 'th-a',
            text: 'hi',
            signal: new AbortController().signal,
          })
          const watchRes = await callWatchUrlTool('watch_url', {})
          const roomRes = sendArtifactRoomEvent('slug-a', 'ping', {})
          monitorSocketRegistry.get('task-shared-id')?.close()

          const snapshot = {
            armInstalled: isArtifactLiveArmDepsInstalled(),
            armLocal: getArtifactLiveArmDeps().localArmWithoutSocket,
            scanMode: getArtifactScanDeps().getPermissionMode?.(),
            watchText: watchRes?.text,
            hasVf: getArtifactLiveEditVf() === artifactLiveEditVf,
            hasRelay: getArtifactFrameRelayHost() !== null,
            roomPeers: roomRes.ok ? roomRes.peers : -1,
            hasNztHost: getNztHost() !== null,
            ttnComment: ttnRes.kind === 'posted' ? ttnRes.commentId : null,
            closedA,
          }

          resetArtifactLiveArmDepsForTests()
          resetArtifactScanDepsForTests()
          resetWatchUrlDepsForTests()
          resetArtifactLiveEditVfForTests()
          resetArtifactFrameRelayHostForTests()
          resetArtifactRoomHostForTests()
          resetNztRunnerForTests()
          monitorSocketRegistry.clear()
          return snapshot
        }),
        runWithNewHostSession({ id: 'ar-host-b' }, async () => {
          await tick(5)
          // Host B has NOT installed any deps yet
          const initiallyClean = {
            armInstalled: isArtifactLiveArmDepsInstalled(),
            scanMode: getArtifactScanDeps().getPermissionMode?.(),
            watchRes: await callWatchUrlTool('watch_url', {}),
            hasVf: getArtifactLiveEditVf() !== null,
            hasRelay: getArtifactFrameRelayHost() !== null,
            hasRoom: getArtifactRoomHost() !== null,
            hasNztHost: getNztHost() !== null,
            hasSocket:
              monitorSocketRegistry.get('task-shared-id') !== undefined,
          }

          setArtifactRoomHost({
            sendRoomEvent: () => ({ ok: true, peers: 22 }),
          })
          setNztRunner(async function* (tu) {
            yield {
              message: {
                type: 'user',
                message: {
                  content: [{ type: 'tool_result', tool_use_id: tu.id }],
                },
                toolUseResult: { replied: true, comment_id: 'cmt-B' },
              },
            }
          })
          await tick(10)
          const roomRes = sendArtifactRoomEvent('slug-b', 'ping', {})
          const ttnRes = await Ttn({
            url: 'https://claude.ai/code/artifact/slug-b',
            slug: 'slug-b',
            threadId: 'th-b',
            text: 'hi',
            signal: new AbortController().signal,
          })

          resetArtifactRoomHostForTests()
          resetNztRunnerForTests()
          return {
            initiallyClean,
            roomPeers: roomRes.ok ? roomRes.peers : -1,
            ttnComment: ttnRes.kind === 'posted' ? ttnRes.commentId : null,
          }
        }),
      ])

      expect(resA).toEqual({
        armInstalled: true,
        armLocal: true,
        scanMode: 'plan',
        watchText: 'A:watch_url',
        hasVf: true,
        hasRelay: true,
        roomPeers: 11,
        hasNztHost: true,
        ttnComment: 'cmt-A',
        closedA: true,
      })
      expect(resB.initiallyClean).toEqual({
        armInstalled: false,
        scanMode: undefined,
        watchRes: null,
        hasVf: false,
        hasRelay: false,
        hasRoom: false,
        hasNztHost: false,
        hasSocket: false,
      })
      expect(resB.roomPeers).toBe(22)
      expect(resB.ttnComment).toBe('cmt-B')
    })

    test('bootstrap installArtifactAutoReactProduct is isolated per host', async () => {
      const [installedA, installedB] = await Promise.all([
        runWithNewHostSession({ id: 'boot-a' }, async () => {
          installArtifactAutoReactProduct({ frameRelayHost: null })
          await tick(15)
          const installed = isArtifactAutoReactProductInstalled()
          const vfPresent = getArtifactLiveEditVf() !== null
          resetArtifactAutoReactProductForTests()
          return { installed, vfPresent }
        }),
        runWithNewHostSession({ id: 'boot-b' }, async () => {
          await tick(5)
          return {
            installed: isArtifactAutoReactProductInstalled(),
            vfPresent: getArtifactLiveEditVf() !== null,
          }
        }),
      ])

      expect(installedA).toEqual({ installed: true, vfPresent: true })
      expect(installedB).toEqual({ installed: false, vfPresent: false })
    })

    test('frameDl and assetRxl depsOverride isolate concurrent hosts', async () => {
      const [outA, outB] = await Promise.all([
        runWithNewHostSession({ id: 'dl-a' }, async () => {
          setAssetRxlDepsForTests({
            oauthBearer: () => 'tok-a',
            claudeAiOrigin: () => 'https://host-a.example',
            isRelayOpen: () => false,
            fetch: Object.assign(
              async (url: string | URL | Request) =>
                new Response(
                  JSON.stringify({ origin: String(url), host: 'A' }),
                  {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  },
                ),
              { preconnect: () => {} },
            ) as typeof fetch,
          })
          await tick(10)
          const dlRes = await DL.get('/api/frame/test-a')
          const rxlRes = await assetRxl({
            verb: 'list',
            route: '/api/frame/blob/slug-a/agent-list',
            body: {},
            contentType: 'application/json',
          })
          setAssetRxlDepsForTests(null)
          return { dlRes, rxlRes }
        }),
        runWithNewHostSession({ id: 'dl-b' }, async () => {
          setFrameDlDepsForTests({
            oauthBearer: () => 'tok-b',
            claudeAiOrigin: () => 'https://host-b.example',
            isRelayOpen: () => false,
            fetch: Object.assign(
              async (url: string | URL | Request) =>
                new Response(
                  JSON.stringify({ origin: String(url), host: 'B' }),
                  {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  },
                ),
              { preconnect: () => {} },
            ) as typeof fetch,
          })
          await tick(10)
          const dlRes = await DL.get('/api/frame/test-b')
          setFrameDlDepsForTests(null)
          return { dlRes }
        }),
      ])

      expect(outA.dlRes.ok).toBe(true)
      if (outA.dlRes.ok) {
        expect((outA.dlRes.data as { host: string }).host).toBe('A')
      }
      expect(outA.rxlRes.replied).toBe(true)
      if (outA.rxlRes.replied) {
        expect((outA.rxlRes.data as { host: string }).host).toBe('A')
      }
      expect(outB.dlRes.ok).toBe(true)
      if (outB.dlRes.ok) {
        expect((outB.dlRes.data as { host: string }).host).toBe('B')
      }
    })

    test('readPerm consent, provenance, and surfaces isolate concurrent root sessions and share withProject forks', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'rp-a' }, async sessionA => {
          Ozr('foreign_read', 'slug-x', true)
          Hzr('slug-x')
          NPe({ toolUseId: 'tu-1' }, ['slug-x'], true)
          OCo({ toolUseId: 'tu-1' })
          GHt('slug-x', 'first_party_type', Date.now())
          Ue('prod', 'disabled')
          setProvenanceDepsForTests({
            fetch: Object.assign(
              async () => new Response('ok', { status: 200 }),
              { preconnect: () => {} },
            ) as typeof fetch,
          })
          setConsentSurfaceDepsForTests({
            isInteractive: () => true,
            isAutoModeActive: () => true,
            featureValue: <T>(_name: string, _fallback: T) => true as T,
          })

          await tick(10)

          // Fork of sessionA shares RootSessionSlot state
          const fork = sessionA.withProject({ cwd: '/tmp/fork-a' })
          const forkSeesConsent = runWithSession(fork, () => ({
            hasConsent: _U('foreign_read', 'slug-x'),
            hasPerson: R7e('foreign_read', 'slug-x'),
            hasOutside: B7n('slug-x'),
            named: qBe({ toolUseId: 'tu-1' }, 'slug-x'),
            scopeChanged: D1n({ toolUseId: 'tu-1' }),
            tier: Sh('slug-x'),
            sandboxSize: provenanceState().sandboxEgress.size,
          }))

          const surfacesA = {
            elevated: isPlanModeBypassElevated('plan', true),
            classifier: isClassifierDecidingMode('plan', false),
            userOnlyGate: isArtifactUserOnlyConsentGateOn(),
          }

          resetConsentStateForTests()
          resetProvenanceStateForTests()
          setConsentSurfaceDepsForTests(null)
          return { forkSeesConsent, surfacesA }
        }),
        runWithNewHostSession({ id: 'rp-b' }, async () => {
          setConsentSurfaceDepsForTests({
            isInteractive: () => false,
            isAutoModeActive: () => false,
            featureValue: <T>(_name: string, _fallback: T) => false as T,
          })
          await tick(10)

          const res = {
            hasConsent: _U('foreign_read', 'slug-x'),
            hasPerson: R7e('foreign_read', 'slug-x'),
            hasOutside: B7n('slug-x'),
            named: qBe({ toolUseId: 'tu-1' }, 'slug-x'),
            ledgerSize: getConsentStateForTests().askClassConsent.size,
            tier: Sh('slug-x'),
            sandboxSize: provenanceState().sandboxEgress.size,
            elevated: isPlanModeBypassElevated('plan', true),
            classifier: isClassifierDecidingMode('plan', false),
            userOnlyGate: isArtifactUserOnlyConsentGateOn(),
          }

          setConsentSurfaceDepsForTests(null)
          return res
        }),
      ])

      expect(resA.forkSeesConsent).toEqual({
        hasConsent: true,
        hasPerson: true,
        hasOutside: true,
        named: true,
        scopeChanged: false,
        tier: 'first_party_type',
        sandboxSize: 1,
      })
      expect(resA.surfacesA).toEqual({
        elevated: true,
        classifier: true,
        userOnlyGate: true,
      })
      expect(resB).toEqual({
        hasConsent: false,
        hasPerson: false,
        hasOutside: false,
        named: false,
        ledgerSize: 0,
        tier: undefined,
        sandboxSize: 0,
        elevated: false,
        classifier: false,
        userOnlyGate: false,
      })
    })

    test('ledger debounce timer re-enters captured ALS session', async () => {
      let observedSessionId: string | undefined
      await runWithNewHostSession({ id: 'ledger-timer-session' }, async () => {
        const ar = un().autoReact
        const prevDebounce = ar.ledgerDebounceMsOverride
        const prevStorage = ar.ledgerStorageV5
        try {
          ar.ledgerDebounceMsOverride = 10
          claimLedgerOwnership({
            appendEntry: async () => {
              observedSessionId = getActiveSessionFromAls()?.id
            },
          })
          ar.ledgerSupersedable = true
          scheduleLedgerDebounce()
          await tick(40)
        } finally {
          ar.ledgerDebounceMsOverride = prevDebounce
          ar.ledgerStorageV5 = prevStorage
          if (ar.ledgerTimer !== undefined) {
            clearTimeout(ar.ledgerTimer)
            ar.ledgerTimer = undefined
          }
        }
      })

      expect(observedSessionId).toBe('ledger-timer-session')
    })

    test('scan scheduleCommentScan timer callback re-enters captured ALS session', async () => {
      let observedSessionId: string | undefined
      await runWithNewHostSession({ id: 'scan-timer-session' }, async () => {
        const store = un()
        const prevOptIn = store.autoReact.optIn
        const prevCoalesce = store.autoReact.coalesceMsOverride
        try {
          registerAutoReactAvailability(() => true)
          store.autoReact.optIn = true
          store.autoReact.enabledMemo = true
          store.autoReact.coalesceMsOverride = 10
          scheduleCommentScan({
            slug: 'scan-timer-slug',
            url: 'https://claude.ai/code/artifact/scan-timer-slug',
            seed: true,
            getTitle: () => {
              observedSessionId = getActiveSessionFromAls()?.id
              return 'Timer Title'
            },
          })
          await tick(45)
        } finally {
          registerAutoReactAvailability(() => false)
          store.autoReact.optIn = prevOptIn
          store.autoReact.enabledMemo = null
          store.autoReact.coalesceMsOverride = prevCoalesce
          store.wakes.wakes.delete('scan-timer-slug')
          store.autoReact.artifacts.delete('scan-timer-slug')
        }
      })

      expect(observedSessionId).toBe('scan-timer-session')
    })
  })

  // -------------------------------------------------------------------------
  // Group 2: SkillLearning
  // -------------------------------------------------------------------------
  describe('SkillLearning multi-host isolation', () => {
    test('config, observerBackend (with boot-default layering), llmObserverBackend, runtimeObserver, toolEventObserver isolate concurrent hosts', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'sl-a' }, async () => {
          // Fresh host inherits boot-registered backends from sessionObserver.ts
          const inheritedBackends = listObserverBackends()

          setSkillLearningConfigForTest({
            minConfidence: 0.91,
            llm: { maxCallsPerSession: 42 },
          })
          registerObserverBackend({
            name: 'custom-host-a',
            analyze: () => [
              {
                trigger: 'trigger-a',
                action: 'action-a',
                confidence: 0.9,
                domain: 'workflow',
                source: 'session-observation',
                scope: 'project',
                evidence: ['ev-a'],
              },
            ],
          })
          setActiveObserverBackend('custom-host-a')
          resetCircuitBreaker()
          resetRuntimeObserverForTest()
          initSkillLearning()
          resetToolHookBookkeeping()
          resetToolHookDepsCache()

          const projDirA = join(tempRoot, 'proj-a')
          await recordToolStart(
            {
              sessionId: 'sess-shared',
              turn: 7,
              projectId: 'p-a',
              projectName: 'p-a',
              cwd: projDirA,
            },
            'Read',
            { file: 'a.ts' },
          )

          await tick(15)

          const cfg = getSkillLearningConfig()
          const activeName = getActiveObserverBackend().name
          const analyzed = await analyzeWithActiveBackend([])
          const hasTurn7 = hasToolHookObservationsForTurn('sess-shared', 7)
          const turn = getRuntimeTurn()

          resetSkillLearningConfig()
          resetToolHookBookkeeping()
          return {
            inheritedHasHeuristic: inheritedBackends.includes('heuristic'),
            inheritedHasLlm: inheritedBackends.includes('llm'),
            minConfidence: cfg.minConfidence,
            maxCalls: cfg.llm.maxCallsPerSession,
            activeName,
            analyzedTrigger: analyzed[0]?.trigger,
            hasTurn7,
            turn,
          }
        }),
        runWithNewHostSession({ id: 'sl-b' }, async () => {
          await tick(5)
          const cfgBefore = getSkillLearningConfig()
          const backends = listObserverBackends()
          const activeBefore = getActiveObserverBackend().name
          const hasTurn7Before = hasToolHookObservationsForTurn(
            'sess-shared',
            7,
          )

          setActiveObserverBackend('llm')
          await tick(10)
          const activeAfter = getActiveObserverBackend().name

          // Resetting inside Host B must NOT wipe boot defaults for future hosts
          resetObserverBackendsForTest()
          const afterReset = listObserverBackends()

          return {
            minConfidence: cfgBefore.minConfidence,
            hasHostABackend: backends.includes('custom-host-a'),
            hasHeuristic: backends.includes('heuristic'),
            activeBefore,
            activeAfter,
            hasTurn7Before,
            afterResetCount: afterReset.length,
          }
        }),
      ])

      expect(resA).toEqual({
        inheritedHasHeuristic: true,
        inheritedHasLlm: true,
        minConfidence: 0.91,
        maxCalls: 42,
        activeName: 'custom-host-a',
        analyzedTrigger: 'trigger-a',
        hasTurn7: true,
        turn: 0,
      })
      expect(resB).toEqual({
        minConfidence: 0.75,
        hasHostABackend: false,
        hasHeuristic: true,
        activeBefore: 'heuristic',
        activeAfter: 'llm',
        hasTurn7Before: false,
        afterResetCount: 0,
      })

      // A third fresh host STILL inherits boot defaults after Host B called resetObserverBackendsForTest()
      const thirdHostBackends = runWithNewHostSession({ id: 'sl-c' }, () =>
        listObserverBackends(),
      )
      expect(thirdHostBackends).toContain('heuristic')
      expect(thirdHostBackends).toContain('llm')
    })

    test('instinctStore upsertQueue, projectContext cache, and promotion sessionPromotedIds isolate concurrent hosts', async () => {
      const rootA = join(tempRoot, 'sl-root-a')
      const rootB = join(tempRoot, 'sl-root-b')

      // Seed promotable instincts in two projects under rootA
      for (const pid of ['p1', 'p2']) {
        const inst = createInstinct({
          trigger: 'always run precheck',
          action: 'run bun run precheck before commit',
          confidence: 0.9,
          domain: 'workflow',
          source: 'session-observation',
          scope: 'project',
          projectId: pid,
          projectName: pid,
          evidence: ['e1'],
        })
        await saveInstinct(inst, {
          rootDir: rootA,
          scope: 'project',
          project: {
            projectId: pid,
            projectName: pid,
            scope: 'project',
            source: 'git_root',
            cwd: rootA,
            storageDir: join(rootA, 'projects', pid),
          },
        })
      }

      const [promoA, promoB] = await Promise.all([
        runWithNewHostSession({ id: 'sl-promo-a' }, async () => {
          resetPromotionBookkeeping()
          const first = await checkPromotion({ rootDir: rootA })
          const second = await checkPromotion({ rootDir: rootA })
          const upserted = await upsertInstinct(
            createInstinct({
              trigger: 'host a upsert',
              action: 'upsert in rootA',
              confidence: 0.85,
              domain: 'testing',
              source: 'session-observation',
              scope: 'global',
              evidence: ['a'],
            }),
            { rootDir: rootA, scope: 'global' },
          )
          const loaded = await loadInstincts({
            rootDir: rootA,
            scope: 'global',
          })
          const ctx = resolveProjectContext(tempRoot)
          return {
            firstLen: first.length,
            secondLen: second.length,
            upsertedId: upserted.id,
            loadedCount: loaded.length,
            ctxScope: ctx.scope,
          }
        }),
        runWithNewHostSession({ id: 'sl-promo-b' }, async () => {
          await tick(10)
          resetPromotionBookkeeping()
          // Host B has its own sessionPromotedIds so promoting from rootA still runs once in Host B
          const firstInB = await checkPromotion({ rootDir: rootA })
          const upserted = await upsertInstinct(
            createInstinct({
              trigger: 'host b upsert',
              action: 'upsert in rootB',
              confidence: 0.85,
              domain: 'testing',
              source: 'session-observation',
              scope: 'global',
              evidence: ['b'],
            }),
            { rootDir: rootB, scope: 'global' },
          )
          const ctx = resolveProjectContext(tempRoot)
          return {
            firstInBLen: firstInB.length,
            upsertedId: upserted.id,
            ctxScope: ctx.scope,
          }
        }),
      ])

      expect(promoA.firstLen).toBe(1)
      expect(promoA.secondLen).toBe(0)
      expect(promoA.loadedCount).toBeGreaterThanOrEqual(1)
      expect(promoB.firstInBLen).toBe(1)
      expect(promoA.upsertedId).not.toBe(promoB.upsertedId)
    })
  })

  // -------------------------------------------------------------------------
  // Group 3: ClaudeInChrome
  // -------------------------------------------------------------------------
  describe('ClaudeInChrome multi-host isolation', () => {
    test('trackedTabIds, attachmentDigests, and shouldAutoEnableClaudeInChrome isolate concurrent hosts', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession(
          { id: 'cic-a', isInteractive: true },
          async () => {
            trackClaudeInChromeTabId(101)
            registerChromeUploadAttachmentDigest('/tmp/doc.pdf', 'deadbeef')
            const autoA = shouldAutoEnableClaudeInChrome()
            await tick(15)
            const out = {
              has101: isTrackedClaudeInChromeTabId(101),
              has202: isTrackedClaudeInChromeTabId(202),
              digest: getChromeUploadAttachmentDigest('/tmp/doc.pdf'),
              autoType: typeof autoA,
            }
            clearChromeUploadAttachmentDigestsForTests()
            return out
          },
        ),
        runWithNewHostSession(
          { id: 'cic-b', isInteractive: false },
          async () => {
            await tick(5)
            trackClaudeInChromeTabId(202)
            registerChromeUploadAttachmentDigest('/tmp/doc.pdf', 'cafebabe')
            const autoB = shouldAutoEnableClaudeInChrome()
            await tick(10)
            const out = {
              has101: isTrackedClaudeInChromeTabId(101),
              has202: isTrackedClaudeInChromeTabId(202),
              digest: getChromeUploadAttachmentDigest('/tmp/doc.pdf'),
              autoB,
            }
            clearChromeUploadAttachmentDigestsForTests()
            return out
          },
        ),
      ])

      expect(resA).toEqual({
        has101: true,
        has202: false,
        digest: 'deadbeef',
        autoType: 'boolean',
      })
      expect(resB).toEqual({
        has101: false,
        has202: true,
        digest: 'cafebabe',
        autoB: false,
      })
    })
  })

  // -------------------------------------------------------------------------
  // Group 4: ComputerUse + @ant/computer-use-mcp
  // -------------------------------------------------------------------------
  describe('ComputerUse & @ant/computer-use-mcp multi-host isolation', () => {
    test('keyChordSafety, hostAdapter, gates, win32 bindings, and computerUseLock isolate concurrent hosts', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'cu-a' }, async () => {
          const release = trackHeldChord(['control'])
          setComputerUseSystemKeyCombosReader(() => true)
          bindFile('/tmp/report-a.docx', 'word')
          const modeA = getChicagoCoordinateMode()
          const adapterA1 = getComputerUseHostAdapter()
          const adapterA2 = getComputerUseHostAdapter()

          await tick(15)

          let spaceBlockedInA = false
          try {
            assertSafeKeyChord(['space'], 'Key chord', { platform: 'darwin' })
          } catch {
            spaceBlockedInA = true
          }
          const heldInA = getActiveHeldKeys()
          const grantedInA = isComputerUseSystemKeyCombosGranted()
          const appTypeA = getBoundAppType()
          const hwndA = getBoundHwnd()
          const cursorA = isVirtualCursorActive()
          clearEditChildCache()

          release()
          unbindWindow()
          setComputerUseSystemKeyCombosReader(undefined)
          return {
            sameAdapter: adapterA1 === adapterA2,
            adapterRef: adapterA1,
            modeA,
            spaceBlockedInA,
            heldInA,
            grantedInA,
            appTypeA,
            hwndA,
            cursorA,
          }
        }),
        runWithNewHostSession({ id: 'cu-b' }, async () => {
          await tick(5)
          const adapterB = getComputerUseHostAdapter()
          const heldInB = getActiveHeldKeys()
          const grantedInB = isComputerUseSystemKeyCombosGranted()
          const appTypeB = getBoundAppType()
          // Holding Control in Host A must NOT reject Space in Host B!
          const spaceAllowedInB = assertSafeKeyChord(['space'], 'Key chord', {
            platform: 'darwin',
          })

          // Test cross-platform executor with injected platform stub
          const pressed: string[] = []
          const exec = createCrossPlatformExecutor({
            getMouseAnimationEnabled: () => false,
            getHideBeforeActionEnabled: () => false,
            platformOverride: {
              input: {
                moveMouse: async () => {},
                click: async () => {},
                typeText: async () => {},
                key: async k => {
                  pressed.push(k)
                },
                keys: async parts => {
                  pressed.push(...parts)
                },
                scroll: async () => {},
                mouseLocation: async () => ({ x: 0, y: 0 }),
              },
              screenshot: {
                captureScreen: async () => ({
                  base64: '',
                  width: 100,
                  height: 100,
                }),
                captureRegion: async () => ({
                  base64: '',
                  width: 100,
                  height: 100,
                }),
              },
              display: {
                getSize: () => ({
                  width: 100,
                  height: 100,
                  scaleFactor: 1,
                  displayId: 0,
                }),
                listAll: () => [
                  { width: 100, height: 100, scaleFactor: 1, displayId: 0 },
                ],
              },
              apps: {
                listRunning: () => [],
                listInstalled: async () => [],
                open: async () => {},
                getFrontmostApp: () => null,
                findWindowByTitle: () => null,
              },
            },
          })
          await exec.key('a')

          return {
            adapterRef: adapterB,
            heldInB,
            grantedInB,
            appTypeB,
            spaceAllowedInB,
            pressed,
          }
        }),
      ])

      expect(resA.sameAdapter).toBe(true)
      expect(resA.adapterRef).not.toBe(resB.adapterRef)
      expect(resA.spaceBlockedInA).toBe(true)
      expect(resA.heldInA).toEqual(['control'])
      expect(resA.grantedInA).toBe(true)
      expect(resA.appTypeA).toBe('word')
      expect(resA.hwndA).toBeNull()
      expect(resA.cursorA).toBe(false)

      expect(resB.heldInB).toEqual([])
      expect(resB.grantedInB).toBe(false)
      expect(resB.appTypeB).toBeNull()
      expect(resB.spaceAllowedInB).toEqual(['space'])
      expect(resB.pressed).toEqual(['a'])
    })

    test('computerUseLock isLockHeldLocally is isolated per host', async () => {
      const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
      const lockDir = join(tempRoot, 'cu-lock')
      process.env.CLAUDE_CONFIG_DIR = lockDir
      try {
        const [hostAState, hostBState] = await Promise.all([
          runWithNewHostSession({ id: 'lock-host-a' }, async () => {
            const acq = await tryAcquireComputerUseLock()
            const heldDuringA = isLockHeldLocally()
            await tick(20)
            const released = await releaseComputerUseLock()
            const heldAfterA = isLockHeldLocally()
            return { acq, heldDuringA, released, heldAfterA }
          }),
          runWithNewHostSession({ id: 'lock-host-b' }, async () => {
            await tick(8)
            // Host B never acquired locally, so isLockHeldLocally() is false
            return { heldInB: isLockHeldLocally() }
          }),
        ])

        expect(hostAState.acq).toEqual({ kind: 'acquired', fresh: true })
        expect(hostAState.heldDuringA).toBe(true)
        expect(hostAState.released).toBe(true)
        expect(hostAState.heldAfterA).toBe(false)
        expect(hostBState.heldInB).toBe(false)
      } finally {
        if (prevConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR
        } else {
          process.env.CLAUDE_CONFIG_DIR = prevConfigDir
        }
      }
    })

    test('@ant/computer-use-mcp toolCalls isolates mouseButtonHeld / mouseMoved per host', async () => {
      const makeAdapter = (): ComputerUseHostAdapter => {
        const executor: ComputerExecutor = {
          capabilities: {
            screenshotFiltering: 'none',
            platform: 'darwin',
            hostBundleId: 'com.test.host',
          },
          prepareForAction: async () => [],
          previewHideSet: async () => [],
          getDisplaySize: async () => ({
            width: 1000,
            height: 800,
            scaleFactor: 1,
            displayId: 0,
            originX: 0,
            originY: 0,
          }),
          listDisplays: async () => [
            {
              width: 1000,
              height: 800,
              scaleFactor: 1,
              displayId: 0,
              originX: 0,
              originY: 0,
            },
          ],
          findWindowDisplays: async () => [],
          resolvePrepareCapture: async () => ({
            base64: '',
            width: 1000,
            height: 800,
            displayWidth: 1000,
            displayHeight: 800,
            originX: 0,
            originY: 0,
            hidden: [],
            displayId: 0,
          }),
          screenshot: async () => ({
            base64: '',
            width: 1000,
            height: 800,
            displayWidth: 1000,
            displayHeight: 800,
            originX: 0,
            originY: 0,
          }),
          zoom: async () => ({ base64: '', width: 100, height: 100 }),
          key: async () => {},
          holdKey: async () => {},
          type: async () => {},
          readClipboard: async () => '',
          writeClipboard: async () => {},
          moveMouse: async () => {},
          click: async () => {},
          mouseDown: async () => {},
          mouseUp: async () => {},
          getCursorPosition: async () => ({ x: 50, y: 50 }),
          drag: async () => {},
          scroll: async () => {},
          getFrontmostApp: async () => ({
            bundleId: 'com.test.app',
            displayName: 'TestApp',
          }),
          appUnderPoint: async () => ({
            bundleId: 'com.test.app',
            displayName: 'TestApp',
          }),
          listInstalledApps: async () => [],
          getAppIcon: async () => undefined,
          listRunningApps: async () => [],
          openApp: async () => {},
        }
        return {
          serverName: 'computer-use',
          logger: {
            silly: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
          executor,
          ensureOsPermissions: async () => ({ granted: true }),
          isDisabled: () => false,
          getSubGates: () => ({
            pixelValidation: false,
            clipboardPasteMultiline: true,
            mouseAnimation: false,
            hideBeforeAction: false,
            autoTargetDisplay: false,
            clipboardGuard: false,
          }),
          getAutoUnhideEnabled: () => false,
          cropRawPatch: () => null,
        }
      }

      const overrides: ComputerUseOverrides = {
        allowedApps: [
          {
            bundleId: 'com.test.app',
            displayName: 'TestApp',
            tier: 'full',
            grantedAt: Date.now(),
          },
        ],
        grantFlags: {
          clipboardRead: false,
          clipboardWrite: false,
          systemKeyCombos: false,
        },
        userDeniedBundleIds: [],
        coordinateMode: 'pixels',
      }

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'cu-mcp-a' }, async () => {
          const adapter = makeAdapter()
          resetMouseButtonHeld()
          const down1 = await handleToolCall(
            adapter,
            'left_mouse_down',
            {},
            overrides,
          )
          await tick(15)
          // Second down in SAME host must fail with state_conflict
          const down2 = await handleToolCall(
            adapter,
            'left_mouse_down',
            {},
            overrides,
          )
          const up = await handleToolCall(
            adapter,
            'left_mouse_up',
            {},
            overrides,
          )
          return {
            down1Error: Boolean(down1.isError),
            down2ErrorKind: down2.telemetry?.error_kind,
            upError: Boolean(up.isError),
          }
        }),
        runWithNewHostSession({ id: 'cu-mcp-b' }, async () => {
          await tick(5)
          const adapter = makeAdapter()
          // Host A is currently holding the mouse button — Host B must STILL succeed!
          const downB = await handleToolCall(
            adapter,
            'left_mouse_down',
            {},
            overrides,
          )
          const upB = await handleToolCall(
            adapter,
            'left_mouse_up',
            {},
            overrides,
          )
          return {
            downBError: Boolean(downB.isError),
            upBError: Boolean(upB.isError),
          }
        }),
      ])

      expect(resA).toEqual({
        down1Error: false,
        down2ErrorKind: 'state_conflict',
        upError: false,
      })
      expect(resB).toEqual({
        downBError: false,
        upBError: false,
      })
    })

    test('drainRunLoop, escHotkey, swiftLoader, platforms/index, win32 bridge/indicator, and wrapper isolate hosts', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'cu-extra-a' }, async () => {
          const swiftA1 = requireComputerUseSwift()
          const swiftA2 = requireComputerUseSwift()
          const platA1 = loadPlatform()
          const platA2 = loadPlatform()
          const ctxA = buildSessionContext()

          retainPump()
          notifyExpectedEscape()
          unregisterEscHotkey()
          stopBridge()
          updateIndicator('host-a')
          hideIndicator()

          await tick(10)
          releasePump()
          return {
            sameSwift: swiftA1 === swiftA2,
            swiftRef: swiftA1,
            samePlat: platA1 === platA2,
            hasCheckLock: typeof ctxA.checkCuLock === 'function',
          }
        }),
        runWithNewHostSession({ id: 'cu-extra-b' }, async () => {
          await tick(5)
          const swiftB = requireComputerUseSwift()
          const platB = loadPlatform()
          const ctxB = buildSessionContext()
          // Process-global CFRunLoop pump refcount nests safely across hosts
          retainPump()
          releasePump()
          unregisterEscHotkey()
          stopBridge()
          hideIndicator()
          return {
            swiftRef: swiftB,
            hasInput: typeof platB.input.click === 'function',
            hasAcquireLock: typeof ctxB.acquireCuLock === 'function',
          }
        }),
      ])

      expect(resA.sameSwift).toBe(true)
      expect(resA.samePlat).toBe(true)
      expect(resA.hasCheckLock).toBe(true)
      expect(resA.swiftRef).not.toBe(resB.swiftRef)
      expect(resB.hasInput).toBe(true)
      expect(resB.hasAcquireLock).toBe(true)
    })
  })
})
