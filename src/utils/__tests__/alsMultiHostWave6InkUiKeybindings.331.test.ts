/**
 * Wave 6 — Ink, Theme, Keybindings, Terminal & Render UI Isolation Tests
 * (official Claude Code 2.1.331 single-process multi-host AsyncLocalStorage parity).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { marked } from 'marked'
import { tmpdir } from 'os'
import { join } from 'path'
import React from 'react'
import {
  _resetSigcontResumeGraceForTesting,
  getLastResumedAt,
  isInSigcontResumeGrace,
  noteResumed,
} from '../../../packages/@ant/ink/src/components/InputNowContext.js'
import { applyTextStyles } from '../../../packages/@ant/ink/src/core/colorize.js'
import {
  Dispatcher,
  setDispatcherLogError,
} from '../../../packages/@ant/ink/src/core/events/dispatcher.js'
import { TerminalEvent } from '../../../packages/@ant/ink/src/core/events/terminal-event.js'
import {
  bindInkSessionHost,
  InkHostSlot,
  InkSessionSlot,
  inkSession,
  Ns,
  resetEverMountedForTests,
  resetInkSessionHostForTests,
} from '../../../packages/@ant/ink/src/core/instances.js'
import {
  _resetJediTermInputForTesting,
  clearJediTermArrowFlood,
  consumeJediTermArrowBurstCount,
  isJediTermArrowFloodActive,
  isJediTermBugConfirmed,
  noteJediTermArrowFlood,
} from '../../../packages/@ant/ink/src/core/jediTermInput.js'
import {
  lineWidth,
  resetLineWidthCache,
} from '../../../packages/@ant/ink/src/core/line-width-cache.js'
import {
  resetTreeDepthWarningsForTests,
  warnTreeDepthExceeded,
} from '../../../packages/@ant/ink/src/core/maxTreeDepth.js'
import {
  bindNonBlockingStdoutRemoteFlag,
  resetNonBlockingStdoutRemoteFlagForTests,
  shouldInstallNonBlockingStdout,
} from '../../../packages/@ant/ink/src/core/nonBlockingStdout.js'
import { sliceAnsi } from '../../../packages/@ant/ink/src/core/output.js'
import {
  getLastYogaMs,
  recordYogaMs,
  resetProfileCounters,
} from '../../../packages/@ant/ink/src/core/reconciler.js'
import { leftoverGsRewriteRawAnsiBg } from '../../../packages/@ant/ink/src/core/render-node-to-output.js'
import { renderToScreen } from '../../../packages/@ant/ink/src/core/render-to-screen.js'
import {
  announceForScreenReader,
  clearScreenReaderAnnouncements,
  drainScreenReaderAnnouncements,
  isScreenReaderHoldActive,
  peekScreenReaderAnnouncements,
  startScreenReaderHold,
  takeScreenReaderHoldRequest,
} from '../../../packages/@ant/ink/src/core/screenReaderAnnounce.js'
import {
  endScreenReaderStartupQuiet,
  getScreenReaderStartupQuietRemainingMs,
  markScreenReaderStartupQuietStart,
  resetScreenReaderStartupQuietForTests,
} from '../../../packages/@ant/ink/src/core/screenReaderStartupQuiet.js'
import {
  setTerminalEmojiWidthCalibrator,
  stringWidth,
} from '../../../packages/@ant/ink/src/core/stringWidth.js'
import {
  getTerminalFocused,
  getTerminalFocusGainedAt,
  getTerminalFocusState,
  resetTerminalFocusState,
  setTerminalFocused,
  subscribeTerminalFocus,
} from '../../../packages/@ant/ink/src/core/terminal-focus-state.js'
import {
  _getLinuxCopyTool,
  _resetLinuxCopyCache,
  _setLinuxCopyToolForTesting,
  attacherCaps,
  setClipboardAttacherCapsGetter,
} from '../../../packages/@ant/ink/src/core/termio/osc.js'
import {
  getLastKill,
  pushToKillRing,
  recordYank,
  resetKillAccumulation,
  yankPop,
} from '../../../packages/@ant/ink/src/core/utils/Cursor.js'
import {
  _resetXtermAtlasForTesting,
  getAtlasKeyStats,
  getAtlasResetStats,
  isAtlasResetEnabled,
  isAtlasResetSuppressed,
  isAtlasTrackingEnabled,
  recordAtlasReset,
  setAtlasResetEnabled,
  setAtlasResetSuppressed,
  setAtlasTrackingEnabled,
  trackAtlasKey,
} from '../../../packages/@ant/ink/src/core/xtermAtlas.js'
import Yoga, {
  getYogaCounters,
} from '../../../packages/@ant/ink/src/core/yoga-layout/index.js'
import { Text } from '../../../packages/@ant/ink/src/index.js'
import {
  setSpinnerReducedMotionGetter,
  Spinner,
} from '../../../packages/@ant/ink/src/theme/Spinner.js'
import {
  getSystemThemeName as getInkSystemThemeName,
  registerSystemThemeMirror as registerInkSystemThemeMirror,
  resetSystemThemeForTests as resetInkSystemThemeForTests,
  setCachedSystemTheme as setInkCachedSystemTheme,
  subscribeSystemTheme as subscribeInkSystemTheme,
} from '../../../packages/@ant/ink/src/theme/systemTheme.js'
import {
  setThemeConfigCallbacks,
  ThemeProvider,
  useThemeSetting,
} from '../../../packages/@ant/ink/src/theme/ThemeProvider.js'
import {
  getTheme as getInkTheme,
  setCustomThemeOverrides as setInkCustomThemeOverrides,
} from '../../../packages/@ant/ink/src/theme/theme-types.js'
import {
  enqueueNotificationsOutsideReact,
  type NotificationsBucket,
} from '../../context/notifications.js'
import {
  disposeKeybindingWatcher,
  getCachedKeybindingWarnings,
  loadKeybindingsSyncWithWarnings,
  subscribeToKeybindingChanges,
} from '../../keybindings/loadUserBindings.js'
import {
  cycleMode,
  getCurrentMode,
  getCurrentModeSlug,
  listModes,
  setCurrentMode,
} from '../../modes/store.js'
import type { AppState } from '../../state/AppState.js'
import {
  createInitialPersistentState,
  getOrCreateVimSharedState,
  resetSessionYankRegisterForTests,
} from '../../vim/types.js'
import {
  _resetRecordingStateForTesting,
  getRecordFilePath,
} from '../asciicast.js'
import {
  findCustomTheme,
  getCachedCustomThemes,
  resolveCustomThemeSetting,
  setCachedPluginThemes,
} from '../customThemes.js'
import {
  consumeEarlyInput,
  hasEarlyInput,
  seedEarlyInput,
} from '../earlyInput.js'
import {
  getSessionBriefTranscript,
  setSessionBriefTranscript,
} from '../focusView.js'
import {
  _resetForTesting as _resetFullscreenForTesting,
  _setWindowsPlatformForTesting,
  armFullscreenBootCanary,
  consumeTuiAsked,
  getCrashAutoOff,
  getFullscreenBootCanaryStatus,
  getTuiTrialMode,
  isWindowsOverSSH,
  latchTuiFromEnv,
  noteFullscreenBootFirstFrame,
  setCrashAutoOff,
} from '../fullscreen.js'
import {
  _resetFullscreenUpsellImpressionForTesting,
  recordFullscreenUpsellImpression,
} from '../fullscreenUpsellGate.js'
import {
  _resetStartupUpdateSummaryForTesting,
  getStartupUpdateSummary,
} from '../logoV2Utils.js'
import { applyMarkdown, configureMarked } from '../markdown.js'
import {
  getRenderVersion,
  invalidateAllRenders,
  invalidateRender,
  resetRenderVersionsForTests,
  subscribeRenderInvalidation,
} from '../render/invalidateAllRenders.js'
import { getBaseRenderOptions } from '../renderOptions.js'
import {
  getScreenReaderActivationSource,
  isScreenReaderModeEnabled,
  resetScreenReaderModeCache,
} from '../screenReaderGate.js'
import {
  getActiveSessionFromAls,
  hasActiveSessionAls,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import {
  getSystemThemeName as getSrcSystemThemeName,
  setCachedSystemTheme as setSrcCachedSystemTheme,
} from '../systemTheme.js'
import { getTerminalPanel, getTerminalPanelSocket } from '../terminalPanel.js'
import {
  getTheme as getSrcTheme,
  setCustomThemeOverrides as setSrcCustomThemeOverrides,
} from '../theme.js'

const tick = (ms = 5) => new Promise<void>(resolve => setTimeout(resolve, ms))

afterEach(() => {
  resetInkSessionHostForTests()
  setTerminalEmojiWidthCalibrator(undefined)
  resetLineWidthCache()
  _resetSigcontResumeGraceForTesting()
  _resetJediTermInputForTesting()
  resetTreeDepthWarningsForTests()
  resetNonBlockingStdoutRemoteFlagForTests()
  resetProfileCounters()
  clearScreenReaderAnnouncements()
  resetScreenReaderStartupQuietForTests()
  resetTerminalFocusState()
  _resetLinuxCopyCache()
  _resetXtermAtlasForTesting()
  resetInkSystemThemeForTests()
  setInkCustomThemeOverrides(undefined)
  setSrcCustomThemeOverrides(undefined)
  resetSessionYankRegisterForTests()
  _resetRecordingStateForTesting()
  _resetFullscreenForTesting()
  _resetFullscreenUpsellImpressionForTesting()
  _resetStartupUpdateSummaryForTesting()
  resetRenderVersionsForTests()
  resetScreenReaderModeCache()
})

describe('Wave 6 — Ink host/session slots & standalone parity', () => {
  test('InkHostSlot and InkSessionSlot isolate concurrent hosts and share withProject forks', async () => {
    const hostSlot = new InkHostSlot(() => ({ tag: 'init' }))
    const sessionSlot = new InkSessionSlot(() => ({ count: 0 }))

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'w6-host-a' }, async rootSession => {
        expect(hostSlot.peek()).toBeUndefined()
        expect(sessionSlot.peek()).toBeUndefined()
        hostSlot.of().tag = 'A'
        sessionSlot.of().count = 10
        await tick(10)

        const fork = rootSession.withProject({ cwd: '/tmp/w6-fork-a' })
        const forkObserved = runWithSession(fork, () => {
          expect(inkSession()).toBe(rootSession)
          sessionSlot.of().count += 5
          return {
            tag: hostSlot.of().tag,
            count: sessionSlot.of().count,
            directForkCount: sessionSlot.of(fork).count,
          }
        })

        expect(hostSlot.delete()).toBe(true)
        expect(hostSlot.peek()).toBeUndefined()
        return {
          forkObserved,
          rootCount: sessionSlot.of().count,
        }
      }),
      runWithNewHostSession({ id: 'w6-host-b' }, async () => {
        hostSlot.of().tag = 'B'
        sessionSlot.of().count = 99
        await tick(15)
        return {
          tag: hostSlot.of().tag,
          count: sessionSlot.of().count,
        }
      }),
    ])

    expect(resA.forkObserved).toEqual({
      tag: 'A',
      count: 15,
      directForkCount: 15,
    })
    expect(resA.rootCount).toBe(15)
    expect(resB).toEqual({ tag: 'B', count: 99 })
  })

  test('Ns() everMounted and map contents are isolated across concurrent hosts', async () => {
    const fakeStdout = { fd: 1 } as unknown as NodeJS.WriteStream
    const fakeInk = {
      hasUnmounted: false,
      holdsRawMode: false,
    } as never

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'w6-ns-a' }, async () => {
        expect(Ns().everMounted).toBe(false)
        Ns().set(fakeStdout, fakeInk)
        await tick(10)
        const snap = {
          everMounted: Ns().everMounted,
          has: Ns().has(fakeStdout),
        }
        Ns().delete(fakeStdout)
        return snap
      }),
      runWithNewHostSession({ id: 'w6-ns-b' }, async () => {
        await tick(5)
        return {
          everMounted: Ns().everMounted,
          has: Ns().has(fakeStdout),
        }
      }),
    ])

    expect(resA).toEqual({ everMounted: true, has: true })
    expect(resB).toEqual({ everMounted: false, has: false })
    resetEverMountedForTests()
  })

  test('bindInkSessionHost works standalone with InkHostSlot and InkSessionSlot', () => {
    const h1 = {}
    const h2 = {}
    const hSlot = new InkHostSlot(() => ({ n: 0 }))
    const sSlot = new InkSessionSlot(() => ({ s: '' }))

    bindInkSessionHost(() => h1)
    hSlot.of().n = 1
    sSlot.of().s = 'one'

    bindInkSessionHost(() => h2)
    expect(hSlot.peek()).toBeUndefined()
    expect(sSlot.peek()).toBeUndefined()
    hSlot.of().n = 2
    sSlot.of().s = 'two'

    bindInkSessionHost(() => h1)
    expect(hSlot.of().n).toBe(1)
    expect(sSlot.of().s).toBe('one')
  })
})

describe('Wave 6 — Ink terminal, input, screen-reader, atlas, width & render isolation', () => {
  test('InputNowContext SIGCONT resume grace is isolated per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-sigcont-a' }, async () => {
        const now = Date.now()
        noteResumed(now)
        await tick(10)
        return {
          resumedAt: getLastResumedAt(),
          inGrace: isInSigcontResumeGrace(() => now + 50),
        }
      }),
      runWithNewHostSession({ id: 'w6-sigcont-b' }, async () => {
        await tick(5)
        return {
          resumedAt: getLastResumedAt(),
          inGrace: isInSigcontResumeGrace(),
        }
      }),
    ])

    expect(a.resumedAt).toBeDefined()
    expect(a.inGrace).toBe(true)
    expect(b).toEqual({ resumedAt: undefined, inGrace: false })
  })

  test('jediTermInput flood/burst state is isolated per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-jedi-a' }, async () => {
        noteJediTermArrowFlood()
        noteJediTermArrowFlood()
        await tick(10)
        const confirmed = isJediTermBugConfirmed({})
        const active = isJediTermArrowFloodActive()
        const count = consumeJediTermArrowBurstCount()
        clearJediTermArrowFlood()
        return { confirmed, active, count }
      }),
      runWithNewHostSession({ id: 'w6-jedi-b' }, async () => {
        await tick(5)
        return {
          confirmed: isJediTermBugConfirmed({}),
          active: isJediTermArrowFloodActive(),
          count: consumeJediTermArrowBurstCount(),
        }
      }),
    ])

    expect(a).toEqual({ confirmed: true, active: true, count: 2 })
    expect(b).toEqual({ confirmed: false, active: false, count: 0 })
  })

  test('Cursor kill ring is isolated across hosts and shared across withProject forks', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-kill-a' }, async rootSession => {
        pushToKillRing('alpha')
        resetKillAccumulation()
        pushToKillRing('beta')
        await tick(10)
        const fork = rootSession.withProject({ cwd: '/tmp/w6-kill-fork' })
        return runWithSession(fork, () => {
          recordYank(0, 4)
          return {
            last: getLastKill(),
            popped: yankPop()?.text,
          }
        })
      }),
      runWithNewHostSession({ id: 'w6-kill-b' }, async () => {
        pushToKillRing('gamma')
        await tick(15)
        return {
          last: getLastKill(),
          popped: yankPop(),
        }
      }),
    ])

    expect(a).toEqual({ last: 'beta', popped: 'alpha' })
    expect(b).toEqual({ last: 'gamma', popped: null })
  })

  test('screenReaderAnnounce and screenReaderStartupQuiet are isolated per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-sr-a' }, async () => {
        announceForScreenReader('hello from A', true)
        startScreenReaderHold(10_000)
        markScreenReaderStartupQuietStart(1000)
        await tick(10)
        return {
          peek: [...peekScreenReaderAnnouncements()],
          drained: drainScreenReaderAnnouncements(),
          holdReq: takeScreenReaderHoldRequest(),
          holdActive: isScreenReaderHoldActive(5000),
          quietRem: getScreenReaderStartupQuietRemainingMs(1500, {}),
        }
      }),
      runWithNewHostSession({ id: 'w6-sr-b' }, async () => {
        markScreenReaderStartupQuietStart(1000)
        endScreenReaderStartupQuiet()
        await tick(15)
        return {
          peek: [...peekScreenReaderAnnouncements()],
          drained: drainScreenReaderAnnouncements(),
          holdReq: takeScreenReaderHoldRequest(),
          holdActive: isScreenReaderHoldActive(5000),
          quietRem: getScreenReaderStartupQuietRemainingMs(1500, {}),
        }
      }),
    ])

    expect(a).toEqual({
      peek: ['hello from A'],
      drained: ['hello from A'],
      holdReq: true,
      holdActive: true,
      quietRem: 2500,
    })
    expect(b).toEqual({
      peek: [],
      drained: [],
      holdReq: false,
      holdActive: false,
      quietRem: 0,
    })
  })

  test('terminal-focus-state isolates focus, timestamps, and subscribers per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-focus-a' }, async () => {
        let fires = 0
        const unsub = subscribeTerminalFocus(() => {
          fires++
        })
        setTerminalFocused(true)
        await tick(10)
        const state = getTerminalFocusState()
        const focused = getTerminalFocused()
        const gainedAt = getTerminalFocusGainedAt()
        unsub()
        return { state, focused, gainedAt, fires }
      }),
      runWithNewHostSession({ id: 'w6-focus-b' }, async () => {
        let fires = 0
        const unsub = subscribeTerminalFocus(() => {
          fires++
        })
        await tick(5)
        setTerminalFocused(false)
        await tick(10)
        const state = getTerminalFocusState()
        const focused = getTerminalFocused()
        const gainedAt = getTerminalFocusGainedAt()
        unsub()
        return { state, focused, gainedAt, fires }
      }),
    ])

    expect(a.state).toBe('focused')
    expect(a.focused).toBe(true)
    expect(Number.isFinite(a.gainedAt)).toBe(true)
    expect(a.fires).toBe(1)

    expect(b.state).toBe('blurred')
    expect(b.focused).toBe(false)
    expect(b.gainedAt).toBe(Number.NEGATIVE_INFINITY)
    expect(b.fires).toBe(1)
  })

  test('xtermAtlas tracking, keys, flags, and reset stats are isolated per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-atlas-a' }, async () => {
        setAtlasTrackingEnabled(true)
        setAtlasResetEnabled(false)
        setAtlasResetSuppressed(true)
        trackAtlasKey(10, 1)
        trackAtlasKey(11, 2)
        recordAtlasReset('delta')
        await tick(10)
        return {
          tracking: isAtlasTrackingEnabled(),
          resetEnabled: isAtlasResetEnabled(),
          suppressed: isAtlasResetSuppressed(),
          keys: getAtlasKeyStats(),
          resets: getAtlasResetStats().count,
          reason: getAtlasResetStats().lastReason,
        }
      }),
      runWithNewHostSession({ id: 'w6-atlas-b' }, async () => {
        setAtlasTrackingEnabled(false)
        await tick(15)
        return {
          tracking: isAtlasTrackingEnabled(),
          resetEnabled: isAtlasResetEnabled(),
          suppressed: isAtlasResetSuppressed(),
          keys: getAtlasKeyStats(),
          resets: getAtlasResetStats().count,
          reason: getAtlasResetStats().lastReason,
        }
      }),
    ])

    expect(a).toEqual({
      tracking: true,
      resetEnabled: false,
      suppressed: true,
      keys: { atlasKeys: 2, saturated: false },
      resets: 1,
      reason: 'delta',
    })
    expect(b).toEqual({
      tracking: false,
      resetEnabled: true,
      suppressed: false,
      keys: { atlasKeys: 0, saturated: false },
      resets: 0,
      reason: 'none',
    })
  })

  test('stringWidth calibrator, lineWidth cache, and calibrated sliceAnsi isolate per host', async () => {
    const zwjEmoji = '👨‍👩‍👧‍👦'
    const sample = `${zwjEmoji}X`
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-width-a' }, async () => {
        setTerminalEmojiWidthCalibrator(() => 6)
        resetLineWidthCache()
        const w1 = stringWidth(sample)
        const lw1 = lineWidth(sample)
        const sliced = sliceAnsi(sample, 0, 6)
        await tick(10)
        // Re-check after Host B runs with a different calibrator
        return {
          w1,
          lw1,
          lw2: lineWidth(sample),
          sliced,
        }
      }),
      runWithNewHostSession({ id: 'w6-width-b' }, async () => {
        setTerminalEmojiWidthCalibrator(() => 2)
        resetLineWidthCache()
        await tick(5)
        const w1 = stringWidth(sample)
        const lw1 = lineWidth(sample)
        const sliced = sliceAnsi(sample, 0, 3)
        await tick(10)
        return { w1, lw1, sliced }
      }),
    ])

    expect(a.w1).toBe(7)
    expect(a.lw1).toBe(7)
    expect(a.lw2).toBe(7)
    expect(a.sliced).toBe(zwjEmoji)

    expect(b.w1).toBe(3)
    expect(b.lw1).toBe(3)
    expect(b.sliced).toBe(sample)
  })

  test('Dispatcher logError layers boot-default with per-host override and isolates currentUpdatePriority', async () => {
    const bootErrors: unknown[] = []
    setDispatcherLogError(err => bootErrors.push(err))

    const d = new Dispatcher()
    const makeThrowingTarget = (msg: string) => ({
      parentNode: undefined,
      _eventHandlers: {
        onKeyDown: () => {
          throw new Error(msg)
        },
      },
    })

    const [aErrors, bErrors] = await Promise.all([
      runWithNewHostSession({ id: 'w6-disp-a' }, async () => {
        const local: unknown[] = []
        setDispatcherLogError(err => local.push(err))
        d.currentUpdatePriority = 99
        await tick(10)
        d.dispatch(
          makeThrowingTarget('err-A') as never,
          new TerminalEvent('keydown', { bubbles: true }),
        )
        return { local, prio: d.currentUpdatePriority }
      }),
      runWithNewHostSession({ id: 'w6-disp-b' }, async () => {
        d.currentUpdatePriority = 42
        await tick(15)
        // Host B did not override logError -> inherits boot default!
        d.dispatch(
          makeThrowingTarget('err-B') as never,
          new TerminalEvent('keydown', { bubbles: true }),
        )
        return { prio: d.currentUpdatePriority }
      }),
    ])

    expect(aErrors.local).toHaveLength(1)
    expect((aErrors.local[0] as Error).message).toBe('err-A')
    expect(aErrors.prio).toBe(99)

    expect(bootErrors).toHaveLength(1)
    expect((bootErrors[0] as Error).message).toBe('err-B')
    expect(bErrors.prio).toBe(42)

    // Restore default console.error stub
    setDispatcherLogError(err => console.error(err))
  })

  test('nonBlockingStdout remote flag override layers boot-default with per-host override', async () => {
    const prevEnv = process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
    delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
    try {
      bindNonBlockingStdoutRemoteFlag(() => true)
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'w6-nbs-a' }, async () => {
          bindNonBlockingStdoutRemoteFlag(() => false)
          await tick(10)
          return shouldInstallNonBlockingStdout()
        }),
        runWithNewHostSession({ id: 'w6-nbs-b' }, async () => {
          await tick(15)
          return shouldInstallNonBlockingStdout()
        }),
      ])
      expect(a).toBe(false)
      expect(b).toBe(true)
    } finally {
      if (prevEnv === undefined)
        delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
      else process.env.CLAUDE_CODE_NONBLOCKING_STDOUT = prevEnv
    }
  })

  test('osc attacherCapsGetter and linuxCopy tool are isolated per host with boot-default inheritance', async () => {
    setClipboardAttacherCapsGetter(() => ({ mux: 'boot-mux' }))

    const [a, b, c] = await Promise.all([
      runWithNewHostSession({ id: 'w6-osc-a' }, async () => {
        setClipboardAttacherCapsGetter(() => ({ mux: 'tmux-A' }))
        _setLinuxCopyToolForTesting('wl-copy')
        await tick(10)
        return {
          mux: attacherCaps()?.mux,
          tool: _getLinuxCopyTool(),
        }
      }),
      runWithNewHostSession({ id: 'w6-osc-b' }, async () => {
        // Explicit null suppresses boot default only for Host B
        setClipboardAttacherCapsGetter(null)
        _setLinuxCopyToolForTesting('xclip')
        await tick(15)
        return {
          mux: attacherCaps()?.mux ?? null,
          tool: _getLinuxCopyTool(),
        }
      }),
      runWithNewHostSession({ id: 'w6-osc-c' }, async () => {
        await tick(15)
        // Host C inherits boot default!
        return {
          mux: attacherCaps()?.mux,
          tool: _getLinuxCopyTool(),
        }
      }),
    ])

    expect(a).toEqual({ mux: 'tmux-A', tool: 'wl-copy' })
    expect(b).toEqual({ mux: null, tool: 'xclip' })
    expect(c).toEqual({ mux: 'boot-mux', tool: undefined })
  })

  test('reconciler profile counters, maxTreeDepth, yoga counters, colorize, and renderToScreen isolate per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-render-a' }, async () => {
        recordYogaMs(12.5)
        warnTreeDepthExceeded('testWalk', 'ink-box')
        const node = Yoga.Node.create()
        node.setWidth(20)
        node.setHeight(2)
        node.calculateLayout(20)
        const rendered = renderToScreen(
          React.createElement(Text, null, 'HostA'),
          20,
        )
        const rendered2 = renderToScreen(
          React.createElement(Text, null, 'HostA2'),
          20,
        )
        const styled = applyTextStyles('hi', {
          color: 'ansi:white',
          faintInk: 'ansi:white',
        })
        const bgRewritten = leftoverGsRewriteRawAnsiBg('a\nb', 'rgb(1,2,3)')
        await tick(10)
        const counters = getYogaCounters()
        node.free()
        return {
          yogaMs: getLastYogaMs(),
          visited: counters.visited,
          charPool: rendered.screen.charPool,
          sameHostCharPool:
            rendered.screen.charPool === rendered2.screen.charPool,
          hyperlinkPool: rendered.screen.hyperlinkPool,
          styled,
          bgRewritten,
        }
      }),
      runWithNewHostSession({ id: 'w6-render-b' }, async () => {
        recordYogaMs(3.25)
        warnTreeDepthExceeded('testWalk', 'ink-box')
        const rendered = renderToScreen(
          React.createElement(Text, null, 'HostB'),
          20,
        )
        await tick(15)
        return {
          yogaMs: getLastYogaMs(),
          charPool: rendered.screen.charPool,
          hyperlinkPool: rendered.screen.hyperlinkPool,
        }
      }),
    ])

    expect(a.yogaMs).toBe(12.5)
    expect(b.yogaMs).toBe(3.25)
    expect(a.visited).toBeGreaterThan(0)
    expect(a.sameHostCharPool).toBe(true)
    expect(a.charPool).not.toBe(b.charPool)
    expect(a.hyperlinkPool).not.toBe(b.hyperlinkPool)
    expect(a.styled).toContain('hi')
    expect(a.bgRewritten).toContain('a')
  })
})

describe('Wave 6 — Theme, SystemTheme, Spinner & CustomThemes isolation', () => {
  test('Ink & src systemTheme isolate per host and explicit mirror syncs active host only without notifying default-host subscribers', async () => {
    const defaultHostObserved: string[] = []
    const unsubDefault = subscribeInkSystemTheme(theme => {
      defaultHostObserved.push(theme)
    })
    const unsubBridge = registerInkSystemThemeMirror(theme => {
      setSrcCachedSystemTheme(theme)
    })
    try {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'w6-sys-a' }, async () => {
          const observed: string[] = []
          const unsub = subscribeInkSystemTheme(t => observed.push(t))
          setInkCachedSystemTheme('light')
          await tick(10)
          unsub()
          return {
            ink: getInkSystemThemeName(),
            src: getSrcSystemThemeName(),
            observed,
          }
        }),
        runWithNewHostSession({ id: 'w6-sys-b' }, async () => {
          const observed: string[] = []
          const unsub = subscribeInkSystemTheme(t => observed.push(t))
          setInkCachedSystemTheme('dark')
          await tick(15)
          unsub()
          return {
            ink: getInkSystemThemeName(),
            src: getSrcSystemThemeName(),
            observed,
          }
        }),
      ])

      expect(a).toEqual({ ink: 'light', src: 'light', observed: ['light'] })
      expect(b).toEqual({ ink: 'dark', src: 'dark', observed: ['dark'] })
      expect(defaultHostObserved).toEqual([])
    } finally {
      unsubBridge()
      unsubDefault()
    }
  })

  test('ThemeProvider callbacks and Spinner reducedMotion layer boot-default with per-host overrides', async () => {
    setThemeConfigCallbacks({
      loadTheme: () => 'light',
      saveTheme: () => {},
    })
    setSpinnerReducedMotionGetter(() => false)

    function ThemeReader(): React.ReactElement {
      const setting = useThemeSetting()
      return React.createElement(Text, null, `theme:${setting}`)
    }

    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-tp-a' }, async () => {
        setThemeConfigCallbacks({
          loadTheme: () => 'dark-ansi',
          saveTheme: () => {},
        })
        setSpinnerReducedMotionGetter(() => true)
        await tick(10)
        const themeScreen = renderToScreen(
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(ThemeReader),
          ),
          40,
        )
        const spinnerScreen = renderToScreen(React.createElement(Spinner), 10)
        return {
          themeText: Array.from(
            { length: themeScreen.screen.width },
            (_, col) =>
              themeScreen.screen.charPool.get(
                themeScreen.screen.cells[col * 2]!,
              ),
          )
            .join('')
            .trim(),
          spinnerChar: spinnerScreen.screen.charPool.get(
            spinnerScreen.screen.cells[0]!,
          ),
        }
      }),
      runWithNewHostSession({ id: 'w6-tp-b' }, async () => {
        await tick(15)
        const themeScreen = renderToScreen(
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(ThemeReader),
          ),
          40,
        )
        const spinnerScreen = renderToScreen(React.createElement(Spinner), 10)
        return {
          themeText: Array.from(
            { length: themeScreen.screen.width },
            (_, col) =>
              themeScreen.screen.charPool.get(
                themeScreen.screen.cells[col * 2]!,
              ),
          )
            .join('')
            .trim(),
          spinnerChar: spinnerScreen.screen.charPool.get(
            spinnerScreen.screen.cells[0]!,
          ),
        }
      }),
    ])

    expect(a.themeText).toBe('theme:dark-ansi')
    expect(a.spinnerChar).toBe('●')
    expect(b.themeText).toBe('theme:light')
    expect(b.spinnerChar).not.toBe('●')

    // Restore boot defaults
    setThemeConfigCallbacks({
      loadTheme: () => 'dark',
      saveTheme: () => {},
    })
    setSpinnerReducedMotionGetter(() => false)
  })

  test('Ink & src customThemeOverrides and customThemes plugin cache are isolated per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-theme-a' }, async () => {
        setInkCustomThemeOverrides({ claude: 'rgb(1,2,3)' })
        setSrcCustomThemeOverrides({ claude: 'rgb(4,5,6)' })
        setCachedPluginThemes([
          {
            slug: 'pluginA:neon',
            name: 'Neon A',
            base: 'dark',
            overrides: { text: 'rgb(10,20,30)' },
            source: { plugin: 'pluginA' },
          },
        ])
        await tick(10)
        return {
          inkClaude: getInkTheme('dark').claude,
          srcClaude: getSrcTheme('dark').claude,
          themes: getCachedCustomThemes().map(t => t.slug),
          foundA: findCustomTheme('pluginA:neon')?.name,
          foundB: findCustomTheme('pluginB:solar')?.name,
          resolved: resolveCustomThemeSetting('custom:pluginA:neon'),
        }
      }),
      runWithNewHostSession({ id: 'w6-theme-b' }, async () => {
        setInkCustomThemeOverrides({ claude: 'rgb(9,8,7)' })
        setCachedPluginThemes([
          {
            slug: 'pluginB:solar',
            name: 'Solar B',
            base: 'light',
            overrides: { text: 'rgb(90,80,70)' },
            source: { plugin: 'pluginB' },
          },
        ])
        await tick(15)
        return {
          inkClaude: getInkTheme('dark').claude,
          srcClaude: getSrcTheme('dark').claude,
          themes: getCachedCustomThemes().map(t => t.slug),
          foundA: findCustomTheme('pluginA:neon')?.name,
          foundB: findCustomTheme('pluginB:solar')?.name,
          resolved: resolveCustomThemeSetting('custom:pluginB:solar'),
        }
      }),
    ])

    expect(a.inkClaude).toBe('rgb(1,2,3)')
    expect(a.srcClaude).toBe('rgb(4,5,6)')
    expect(a.themes).toEqual(['pluginA:neon'])
    expect(a.foundA).toBe('Neon A')
    expect(a.foundB).toBeUndefined()
    expect(a.resolved.overrides?.text).toBe('rgb(10,20,30)')

    expect(b.inkClaude).toBe('rgb(9,8,7)')
    expect(b.srcClaude).toBe('rgb(215,119,87)')
    expect(b.themes).toEqual(['pluginB:solar'])
    expect(b.foundA).toBeUndefined()
    expect(b.foundB).toBe('Solar B')
    expect(b.resolved.base).toBe('light')
  })
})

describe('Wave 6 — src UI, keybindings, vim, notifications, fullscreen, render & terminal isolation', () => {
  test('notifications timers isolate per root session, propagate ALS, and keep non-ALS false outside ALS', async () => {
    const makeStateHolder = () => {
      let bucket: NotificationsBucket = {
        current: null,
        queue: [],
        pinned: [],
      }
      const observedSessions: Array<string | undefined> = []
      const observedHasAls: boolean[] = []
      const setAppState = (updater: (prev: AppState) => AppState) => {
        observedSessions.push(getActiveSessionFromAls()?.id)
        observedHasAls.push(hasActiveSessionAls())
        const next = updater({ notifications: bucket } as unknown as AppState)
        bucket = next.notifications
      }
      return {
        getBucket: () => bucket,
        observedSessions,
        observedHasAls,
        setAppState,
      }
    }

    const holderA = makeStateHolder()
    const holderB = makeStateHolder()

    await Promise.all([
      runWithNewHostSession({ id: 'w6-notif-a' }, async () => {
        enqueueNotificationsOutsideReact(holderA.setAppState, [
          {
            key: 'notif-a',
            text: 'From A',
            priority: 'medium',
            timeoutMs: 25,
          },
        ])
        expect(holderA.getBucket().current?.key).toBe('notif-a')
        await tick(60)
      }),
      runWithNewHostSession({ id: 'w6-notif-b' }, async () => {
        enqueueNotificationsOutsideReact(holderB.setAppState, [
          {
            key: 'notif-b',
            text: 'From B',
            priority: 'medium',
            timeoutMs: 120,
          },
        ])
        // After Host A's 25ms timer fires, Host B's notification MUST still be active!
        await tick(45)
        expect(holderB.getBucket().current?.key).toBe('notif-b')
        await tick(110)
      }),
    ])

    expect(holderA.getBucket().current).toBeNull()
    expect(holderB.getBucket().current).toBeNull()
    expect(holderA.observedSessions.every(id => id === 'w6-notif-a')).toBe(true)
    expect(holderB.observedSessions.every(id => id === 'w6-notif-b')).toBe(true)

    // Non-ALS single-host CLI mode must keep hasActiveSessionAls() === false in timer callback!
    const holderNonAls = makeStateHolder()
    enqueueNotificationsOutsideReact(holderNonAls.setAppState, [
      {
        key: 'notif-non-als',
        text: 'Plain CLI',
        priority: 'medium',
        timeoutMs: 20,
      },
    ])
    await tick(50)
    expect(holderNonAls.getBucket().current).toBeNull()
    expect(holderNonAls.observedHasAls.every(v => v === false)).toBe(true)
  })

  test('loadUserBindings cache, warnings, and subscriber signals isolate per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-kb-a' }, async () => {
        const res = loadKeybindingsSyncWithWarnings()
        let count = 0
        const unsub = subscribeToKeybindingChanges(() => {
          count++
        })
        await tick(10)
        disposeKeybindingWatcher()
        unsub()
        return {
          bindingsLen: res.bindings.length,
          warningsLen: getCachedKeybindingWarnings().length,
          count,
        }
      }),
      runWithNewHostSession({ id: 'w6-kb-b' }, async () => {
        await tick(5)
        const res = loadKeybindingsSyncWithWarnings()
        let count = 0
        const unsub = subscribeToKeybindingChanges(() => {
          count++
        })
        await tick(10)
        unsub()
        return {
          bindingsLen: res.bindings.length,
          warningsLen: getCachedKeybindingWarnings().length,
          count,
        }
      }),
    ])

    expect(a.bindingsLen).toBeGreaterThan(0)
    expect(b.bindingsLen).toBeGreaterThan(0)
    expect(a.warningsLen).toBe(0)
    expect(b.warningsLen).toBe(0)
  })

  test('vim shared state isolates across hosts and shares across withProject forks', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'w6-vim-a' }, async rootSession => {
        const p = createInitialPersistentState()
        p.register = 'yanked-A'
        p.registerIsLinewise = true
        await tick(10)
        const fork = rootSession.withProject({ cwd: '/tmp/w6-vim-fork' })
        return runWithSession(fork, () => ({
          register: getOrCreateVimSharedState().register,
          linewise: getOrCreateVimSharedState().registerIsLinewise,
        }))
      }),
      runWithNewHostSession({ id: 'w6-vim-b' }, async () => {
        const p = createInitialPersistentState()
        p.register = 'yanked-B'
        await tick(15)
        return {
          register: getOrCreateVimSharedState().register,
          linewise: getOrCreateVimSharedState().registerIsLinewise,
        }
      }),
    ])

    expect(a).toEqual({ register: 'yanked-A', linewise: true })
    expect(b).toEqual({ register: 'yanked-B', linewise: false })
  })

  test('asciicast, earlyInput, focusView, invalidateAllRenders, screenReaderGate, renderOptions & terminalPanel isolate per host/session', async () => {
    const prevUserType = process.env.USER_TYPE
    const prevRec = process.env.CLAUDE_CODE_TERMINAL_RECORDING
    const prevSr = process.env.CLAUDE_AX_SCREEN_READER
    process.env.USER_TYPE = 'ant'
    process.env.CLAUDE_CODE_TERMINAL_RECORDING = '1'
    try {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'w6-ui-a' }, async rootSession => {
          const castPath = getRecordFilePath()
          seedEarlyInput('prompt-from-A')
          setSessionBriefTranscript(true)
          let invalidations = 0
          const unsub = subscribeRenderInvalidation(() => {
            invalidations++
          })
          invalidateAllRenders()
          invalidateRender('custom.a')

          process.env.CLAUDE_AX_SCREEN_READER = '1'
          resetScreenReaderModeCache()
          const srOn = isScreenReaderModeEnabled()
          const srSource = getScreenReaderActivationSource()
          const renderOpts = getBaseRenderOptions(true)

          const panelA = getTerminalPanel()
          const socketA = getTerminalPanelSocket()

          await tick(10)

          const fork = rootSession.withProject({ cwd: '/tmp/w6-ui-fork' })
          const forkCheck = runWithSession(fork, () => ({
            samePanel: getTerminalPanel() === panelA,
            sameBrief: getSessionBriefTranscript() === true,
            sameCast: getRecordFilePath() === castPath,
          }))

          unsub()
          return {
            castPath,
            hasEarly: hasEarlyInput(),
            consumedEarly: consumeEarlyInput(),
            brief: getSessionBriefTranscript(),
            uiVer: getRenderVersion('ui.render'),
            customVer: getRenderVersion('custom.a'),
            invalidations,
            srOn,
            srSource,
            renderOptsSr: renderOpts.isScreenReaderEnabled,
            panelA,
            socketA,
            forkCheck,
          }
        }),
        runWithNewHostSession({ id: 'w6-ui-b' }, async () => {
          const castPath = getRecordFilePath()
          seedEarlyInput('prompt-from-B')
          setSessionBriefTranscript(false)
          let invalidations = 0
          const unsub = subscribeRenderInvalidation(() => {
            invalidations++
          })

          await tick(15)
          process.env.CLAUDE_AX_SCREEN_READER = '0'
          resetScreenReaderModeCache()
          const srOn = isScreenReaderModeEnabled()
          const renderOpts = getBaseRenderOptions(false)
          const panelB = getTerminalPanel()
          const socketB = getTerminalPanelSocket()

          unsub()
          return {
            castPath,
            hasEarly: hasEarlyInput(),
            consumedEarly: consumeEarlyInput(),
            brief: getSessionBriefTranscript(),
            uiVer: getRenderVersion('ui.render'),
            customVer: getRenderVersion('custom.a'),
            invalidations,
            srOn,
            renderOptsSr: renderOpts.isScreenReaderEnabled,
            panelB,
            socketB,
          }
        }),
      ])

      expect(a.castPath).toContain('w6-ui-a')
      expect(b.castPath).toContain('w6-ui-b')
      expect(a.castPath).not.toBe(b.castPath)
      expect(a.hasEarly).toBe(true)
      expect(a.consumedEarly).toBe('prompt-from-A')
      expect(b.hasEarly).toBe(true)
      expect(b.consumedEarly).toBe('prompt-from-B')
      expect(a.brief).toBe(true)
      expect(b.brief).toBe(false)
      expect(a.uiVer).toBe(1)
      expect(a.customVer).toBe(1)
      expect(a.invalidations).toBe(2)
      expect(b.uiVer).toBe(0)
      expect(b.customVer).toBe(0)
      expect(b.invalidations).toBe(0)
      expect(a.srOn).toBe(true)
      expect(a.srSource).toBe('env')
      expect(a.renderOptsSr).toBe(true)
      expect(b.srOn).toBe(false)
      expect(b.renderOptsSr).toBe(false)
      expect(a.panelA).not.toBe(b.panelB)
      expect(a.socketA).toBe('claude-panel-w6-ui-a')
      expect(b.socketB).toBe('claude-panel-w6-ui-b')
      expect(a.forkCheck).toEqual({
        samePanel: true,
        sameBrief: true,
        sameCast: true,
      })
    } finally {
      if (prevUserType === undefined) delete process.env.USER_TYPE
      else process.env.USER_TYPE = prevUserType
      if (prevRec === undefined) {
        delete process.env.CLAUDE_CODE_TERMINAL_RECORDING
      } else {
        process.env.CLAUDE_CODE_TERMINAL_RECORDING = prevRec
      }
      if (prevSr === undefined) delete process.env.CLAUDE_AX_SCREEN_READER
      else process.env.CLAUDE_AX_SCREEN_READER = prevSr
    }
  })

  test('modes/store isolates currentModeSlug, customModes, and modeListeners per host', async () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const tempDir = mkdtempSync(join(tmpdir(), 'w6-modes-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    try {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'w6-mode-a' }, async () => {
          expect(listModes().length).toBeGreaterThan(1)
          setCurrentMode('sharp')
          await tick(10)
          return {
            slug: getCurrentModeSlug(),
            name: getCurrentMode().name,
          }
        }),
        runWithNewHostSession({ id: 'w6-mode-b' }, async () => {
          setCurrentMode('gentle')
          await tick(5)
          const cycled = cycleMode()
          await tick(10)
          return {
            slug: getCurrentModeSlug(),
            cycledSlug: cycled.slug,
          }
        }),
      ])

      expect(a).toEqual({ slug: 'sharp', name: 'Dr. Sharp' })
      expect(b).toEqual({ slug: 'sharp', cycledSlug: 'sharp' })

      // Verify independent mutations stay isolated after cycling
      const [a2, b2] = await Promise.all([
        runWithNewHostSession({ id: 'w6-mode-a2' }, async () => {
          setCurrentMode('workhorse')
          await tick(10)
          return getCurrentModeSlug()
        }),
        runWithNewHostSession({ id: 'w6-mode-b2' }, async () => {
          setCurrentMode('token-saver')
          await tick(15)
          return getCurrentModeSlug()
        }),
      ])
      expect(a2).toBe('workhorse')
      expect(b2).toBe('token-saver')
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('fullscreen flags, canary timer ALS propagation, upsell impression, logoV2Utils, and markdown strikethrough', async () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const tempDir = mkdtempSync(join(tmpdir(), 'w6-fs-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    const prevSsh = process.env.SSH_CONNECTION
    const prevNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER
    const prevDisableAlt = process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    const prevStrike = process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH
    const prevTermProgram = process.env.TERM_PROGRAM
    process.env.SSH_CONNECTION = '1.2.3.4 1234 5.6.7.8 22'
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN

    try {
      let healthyCallbackSessionId: string | undefined

      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'w6-fs-a' }, async () => {
          setCrashAutoOff(true)
          _setWindowsPlatformForTesting(true)
          process.env.CLAUDE_CODE_TUI_TRIAL = 'fullscreen'
          process.env.CLAUDE_CODE_TUI_ASKED = 'default'
          latchTuiFromEnv()
          const imp1 = recordFullscreenUpsellImpression({
            fullscreenUpsellSeenCount: 0,
          })
          const imp2 = recordFullscreenUpsellImpression({
            fullscreenUpsellSeenCount: 0,
          })
          const summary = getStartupUpdateSummary('2.1.331')
          await tick(10)
          return {
            crashAutoOff: getCrashAutoOff(),
            winSsh: isWindowsOverSSH(),
            trial: getTuiTrialMode(),
            asked: consumeTuiAsked(),
            imp1: imp1.fullscreenUpsellSeenCount,
            imp2: imp2.fullscreenUpsellSeenCount,
            summary,
          }
        }),
        runWithNewHostSession({ id: 'w6-fs-b' }, async () => {
          _setWindowsPlatformForTesting(false)
          const armed = await armFullscreenBootCanary({
            healthyAfterMs: 25,
            onHealthy: () => {
              healthyCallbackSessionId = getActiveSessionFromAls()?.id
            },
          })
          const statusWhileArmed = getFullscreenBootCanaryStatus()
          if (armed) {
            noteFullscreenBootFirstFrame()
            await tick(60)
          }
          const imp1 = recordFullscreenUpsellImpression({
            fullscreenUpsellSeenCount: 1,
          })
          return {
            crashAutoOff: getCrashAutoOff(),
            winSsh: isWindowsOverSSH(),
            trial: getTuiTrialMode(),
            armed,
            statusWhileArmed,
            statusAfter: getFullscreenBootCanaryStatus(),
            imp1: imp1.fullscreenUpsellSeenCount,
          }
        }),
      ])

      expect(a.crashAutoOff).toBe(true)
      expect(a.winSsh).toBe(true)
      expect(a.trial).toBe('fullscreen')
      expect(a.asked).toBe('default')
      expect(a.imp1).toBe(1)
      expect(a.imp2).toBe(0)

      expect(b.crashAutoOff).toBe(false)
      expect(b.winSsh).toBe(false)
      expect(b.trial).toBeUndefined()
      expect(b.imp1).toBe(2)
      if (b.armed) {
        expect(b.statusWhileArmed).toBe('armed')
        expect(b.statusAfter).toBe('settled')
        expect(healthyCallbackSessionId).toBe('w6-fs-b')
      }

      // Dynamic supportsStrikethrough in marked.use tokenizer after single configureMarked()
      configureMarked()
      process.env.TERM_PROGRAM = 'Apple_Terminal'
      process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH = '0'
      const tokensOff = marked.lexer('before ~~gone~~ after')
      const paraOff = tokensOff[0] as { tokens?: Array<{ type: string }> }
      expect(paraOff.tokens?.some(t => t.type === 'del')).toBe(false)
      expect(applyMarkdown('before ~~gone~~ after', 'dark')).toContain(
        '~~gone~~',
      )

      process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH = '1'
      const tokensOn = marked.lexer('before ~~gone~~ after')
      const paraOn = tokensOn[0] as { tokens?: Array<{ type: string }> }
      expect(paraOn.tokens?.some(t => t.type === 'del')).toBe(true)
    } finally {
      if (prevTermProgram === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = prevTermProgram
      if (prevSsh === undefined) delete process.env.SSH_CONNECTION
      else process.env.SSH_CONNECTION = prevSsh
      if (prevNoFlicker === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER
      else process.env.CLAUDE_CODE_NO_FLICKER = prevNoFlicker
      if (prevDisableAlt === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
      } else {
        process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = prevDisableAlt
      }
      if (prevStrike === undefined) {
        delete process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH
      } else {
        process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH = prevStrike
      }
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
