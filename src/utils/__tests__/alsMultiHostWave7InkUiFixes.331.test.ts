/**
 * Wave 7 Fixer 1 — Live Regression Tests for Strict Adversarial Review A findings:
 * - P0-2: `Ns()` dynamic host registry across `createRoot` / `unmount` / `renderSync` / `wrappedRender`
 * - P1-1: `systemTheme` strict host-scoped `subscribeSystemTheme` vs explicit `registerSystemThemeMirror`
 * - P1-2: `nonBlockingStdout` process-scoped physical stream slot with refcounted out-of-order restore
 * - P2-1: `ThemeProvider` unmount outside ALS preserves default host & sibling host overrides
 * - P2-2: `PluginRasterPanes` `usePluginHoverScope` captures session store for enter/leave/unmount outside ALS
 * - P2-3: `useSwarmPermissionPoller` re-enters captured ALS session on mount & interval polls
 * - P2-4: `use-select-input` prunes dead `WeakRef`s from `liveSigcontHostStates`
 * - P2-5: `renderOptions` keeps `/dev/tty` stdin override process-scoped while preserving per-host screen-reader flag
 * - P2-6: `PromptInputFooterLeftSide` & `AgentView` no longer contain stale `let` literal comments
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import * as React from 'react'
import {
  createRoot,
  instances,
  Ns,
  registerSystemThemeMirror,
  renderSync,
  Text,
  wrappedRender,
} from '@anthropic/ink'
import {
  resetEverMountedForTests,
  resetInkSessionHostForTests,
} from '../../../packages/@ant/ink/src/core/instances.js'
import {
  _setProbeFdOverrideForTests,
  bindNonBlockingStdoutRemoteFlag,
  installNonBlockingStdout,
  isNonBlockingStdoutInstalled,
  resetNonBlockingStdoutRemoteFlagForTests,
  shouldInstallNonBlockingStdout,
} from '../../../packages/@ant/ink/src/core/nonBlockingStdout.js'
import {
  getSystemThemeName as getInkSystemThemeName,
  resetSystemThemeForTests as resetInkSystemThemeForTests,
  setCachedSystemTheme as setInkCachedSystemTheme,
  subscribeSystemTheme as subscribeInkSystemTheme,
} from '../../../packages/@ant/ink/src/theme/systemTheme.js'
import {
  setThemeConfigCallbacks,
  ThemeProvider,
} from '../../../packages/@ant/ink/src/theme/ThemeProvider.js'
import {
  getTheme as getInkTheme,
  setCustomThemeOverrides as setInkCustomThemeOverrides,
} from '../../../packages/@ant/ink/src/theme/theme-types.js'
import {
  _getLiveSigcontHostStateCountForTests,
  noteProcessResumed,
} from '../../components/CustomSelect/use-select-input.js'
import { usePluginHoverScope } from '../../components/PluginRasterPanes.js'
import {
  clearAllPendingCallbacks,
  hasPermissionCallback,
  registerPermissionCallback,
  useSwarmPermissionPoller,
} from '../../hooks/useSwarmPermissionPoller.js'
import { getBaseRenderOptions } from '../renderOptions.js'
import { resetScreenReaderModeCache } from '../screenReaderGate.js'
import {
  getActiveSessionFromAls,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import * as permissionSyncMod from '../swarm/permissionSync.js'
import {
  getSystemThemeName as getSrcSystemThemeName,
  setCachedSystemTheme as setSrcCachedSystemTheme,
} from '../systemTheme.js'
import * as teammateMod from '../teammate.js'

const ROOT = join(import.meta.dir, '../../..')
const tick = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms))

function withChild<P extends { children: React.ReactNode }>(
  Comp: React.ComponentType<P>,
  props: Omit<P, 'children'>,
  child: React.ReactNode,
): React.ReactElement {
  return React.createElement(
    Comp as React.ComponentType<Omit<P, 'children'>>,
    props,
    child,
  )
}

function makeTtyPair(): {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
} {
  const stdout = Object.assign(new PassThrough(), {
    columns: 80,
    rows: 24,
    isTTY: true,
  })
  stdout.resume()
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return stdin
    },
    ref() {
      return stdin
    },
    unref() {
      return stdin
    },
  })
  return {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  }
}

const activeUnmounts: Array<() => void> = []
const activeSpies: Array<{ mockRestore: () => void }> = []

afterEach(() => {
  while (activeUnmounts.length > 0) {
    activeUnmounts.pop()?.()
  }
  while (activeSpies.length > 0) {
    activeSpies.pop()?.mockRestore()
  }
  _setProbeFdOverrideForTests(undefined)
  resetNonBlockingStdoutRemoteFlagForTests()
  resetInkSystemThemeForTests()
  setInkCustomThemeOverrides(undefined)
  setThemeConfigCallbacks({
    loadTheme: () => 'dark',
    saveTheme: () => {},
  })
  resetScreenReaderModeCache()
  resetEverMountedForTests()
  resetInkSessionHostForTests()
})

describe('Wave 7 Fixer 1 — Ink Ns(), SystemTheme, NonBlockingStdout, React UI & Hooks fixes', () => {
  test('P0-2: createRoot, unmount, renderSync & wrappedRender isolate per-host Ns() maps without polluting default instances', async () => {
    const sharedTtyA = makeTtyPair()
    const sharedStdout = sharedTtyA.stdout
    const ttyB = makeTtyPair()

    const { rootA, sessionA } = await runWithNewHostSession(
      { id: 'w7-p02-a' },
      async session => {
        const root = await createRoot({
          stdout: sharedStdout,
          stdin: sharedTtyA.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        root.render(React.createElement(Text, null, 'Host A'))
        return { rootA: root, sessionA: session }
      },
    )
    activeUnmounts.push(() => rootA.unmount())

    const { rootB, sessionB } = await runWithNewHostSession(
      { id: 'w7-p02-b' },
      async session => {
        // Same physical stdout stream key in Host B must NOT collide with Host A!
        const root = await createRoot({
          stdout: sharedStdout,
          stdin: ttyB.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        root.render(React.createElement(Text, null, 'Host B'))
        return { rootB: root, sessionB: session }
      },
    )
    activeUnmounts.push(() => rootB.unmount())

    const inkA = runWithSession(sessionA, () => Ns().get(sharedStdout))
    const inkB = runWithSession(sessionB, () => Ns().get(sharedStdout))

    expect(inkA).toBeDefined()
    expect(inkB).toBeDefined()
    expect(inkA).not.toBe(inkB)
    // Default boot-pinned `instances` must NOT have been polluted by Host A or B
    expect(instances.get(sharedStdout)).toBeUndefined()

    // Unmount Host A OUTSIDE ALS -> cleans ONLY Host A's Ns() entry!
    rootA.unmount()
    expect(
      runWithSession(sessionA, () => Ns().get(sharedStdout)),
    ).toBeUndefined()
    expect(runWithSession(sessionB, () => Ns().get(sharedStdout))).toBe(inkB)

    // Unmount Host B OUTSIDE ALS -> cleans Host B's Ns() entry!
    rootB.unmount()
    expect(
      runWithSession(sessionB, () => Ns().get(sharedStdout)),
    ).toBeUndefined()

    // renderSync + cleanup across Host A & Host B with the same stdout stream
    const syncTty1 = makeTtyPair()
    const syncTty2 = makeTtyPair()
    const syncStdout = syncTty1.stdout

    const { instA, sA } = runWithNewHostSession(
      { id: 'w7-p02-sync-a' },
      session => {
        const inst = renderSync(React.createElement(Text, null, 'Sync A'), {
          stdout: syncStdout,
          stdin: syncTty1.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        return { instA: inst, sA: session }
      },
    )
    activeUnmounts.push(() => instA.unmount())

    const { instB, sB } = runWithNewHostSession(
      { id: 'w7-p02-sync-b' },
      session => {
        const inst = renderSync(React.createElement(Text, null, 'Sync B'), {
          stdout: syncStdout,
          stdin: syncTty2.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        return { instB: inst, sB: session }
      },
    )
    activeUnmounts.push(() => instB.unmount())

    const syncInkA = runWithSession(sA, () => Ns().get(syncStdout))
    const syncInkB = runWithSession(sB, () => Ns().get(syncStdout))
    expect(syncInkA).toBeDefined()
    expect(syncInkB).toBeDefined()
    expect(syncInkA).not.toBe(syncInkB)
    expect(instances.get(syncStdout)).toBeUndefined()

    // cleanup() outside ALS deletes ONLY Host A's Ns() entry
    instA.cleanup()
    expect(runWithSession(sA, () => Ns().get(syncStdout))).toBeUndefined()
    expect(runWithSession(sB, () => Ns().get(syncStdout))).toBe(syncInkB)
    instA.unmount()
    instB.unmount()
    expect(runWithSession(sB, () => Ns().get(syncStdout))).toBeUndefined()

    // wrappedRender pendingStandaloneRender blocks only the claiming host
    let releaseStandalone!: () => void
    const standaloneGate = new Promise<void>(resolve => {
      releaseStandalone = resolve
    })
    const gateTtyA = makeTtyPair()
    const gateTtyB = makeTtyPair()
    let hostARendered = false

    const hostAPromise = runWithNewHostSession(
      { id: 'w7-p02-gate-a' },
      async () => {
        Ns().claimForStandaloneRender(standaloneGate)
        const inst = await wrappedRender(
          React.createElement(Text, null, 'After gate A'),
          {
            stdout: gateTtyA.stdout,
            stdin: gateTtyA.stdin,
            exitOnCtrlC: false,
            patchConsole: false,
          },
        )
        hostARendered = true
        activeUnmounts.push(() => inst.unmount())
      },
    )

    // Host B must mount immediately even while Host A has a pending standalone render
    const instGateB = await runWithNewHostSession(
      { id: 'w7-p02-gate-b' },
      async () => {
        return wrappedRender(React.createElement(Text, null, 'Immediate B'), {
          stdout: gateTtyB.stdout,
          stdin: gateTtyB.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
      },
    )
    activeUnmounts.push(() => instGateB.unmount())
    expect(hostARendered).toBe(false)

    releaseStandalone()
    await hostAPromise
    expect(hostARendered).toBe(true)
  })

  test('P1-1: subscribeSystemTheme is strictly host-scoped while registerSystemThemeMirror mirrors all hosts in active ALS', async () => {
    const defaultEvents: string[] = []
    const mirrorEvents: Array<{
      sessionId: string | undefined
      theme: string
    }> = []

    const unsubDefault = subscribeInkSystemTheme(theme => {
      defaultEvents.push(theme)
    })
    const unsubMirror = registerSystemThemeMirror(theme => {
      mirrorEvents.push({
        sessionId: getActiveSessionFromAls()?.id,
        theme,
      })
      setSrcCachedSystemTheme(theme)
    })

    try {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'w7-sys-a' }, async () => {
          const local: string[] = []
          const unsub = subscribeInkSystemTheme(t => local.push(t))
          setInkCachedSystemTheme('light')
          await tick(10)
          unsub()
          return {
            ink: getInkSystemThemeName(),
            src: getSrcSystemThemeName(),
            local,
          }
        }),
        runWithNewHostSession({ id: 'w7-sys-b' }, async () => {
          const local: string[] = []
          const unsub = subscribeInkSystemTheme(t => local.push(t))
          setInkCachedSystemTheme('dark')
          await tick(10)
          setInkCachedSystemTheme('light')
          unsub()
          return {
            ink: getInkSystemThemeName(),
            src: getSrcSystemThemeName(),
            local,
          }
        }),
      ])

      // Default host subscriber (e.g. default-host <ThemeProvider>) NEVER fired!
      expect(defaultEvents).toEqual([])
      expect(getInkSystemThemeName()).toBe('dark')

      // Isolated hosts received only their own updates
      expect(resA).toEqual({ ink: 'light', src: 'light', local: ['light'] })
      expect(resB).toEqual({
        ink: 'light',
        src: 'light',
        local: ['dark', 'light'],
      })

      // Explicit mirror observed every host update in that host's ALS context
      expect(mirrorEvents).toContainEqual({
        sessionId: 'w7-sys-a',
        theme: 'light',
      })
      expect(mirrorEvents).toContainEqual({
        sessionId: 'w7-sys-b',
        theme: 'dark',
      })
      expect(mirrorEvents).toContainEqual({
        sessionId: 'w7-sys-b',
        theme: 'light',
      })

      // Default host update fires default subscriber + mirror (with undefined ALS)
      setInkCachedSystemTheme('light')
      expect(defaultEvents).toEqual(['light'])
      expect(mirrorEvents.at(-1)).toEqual({
        sessionId: undefined,
        theme: 'light',
      })

      // Verify init.ts wires registerSystemThemeMirror (not subscribeSystemTheme)
      const initSrc = readFileSync(
        join(ROOT, 'src/entrypoints/init.ts'),
        'utf8',
      )
      expect(initSrc).toContain(
        'registerSystemThemeMirror(setCachedSystemTheme)',
      )
      expect(initSrc).not.toContain(
        'subscribeSystemTheme(setCachedSystemTheme)',
      )
    } finally {
      unsubMirror()
      unsubDefault()
    }
  })

  test('P1-2: nonBlockingStdout shares one physical wrap across hosts and out-of-order Host A/B restore restores exact origWrite', () => {
    const origWrite = process.stdout.write
    let probeCount = 0
    _setProbeFdOverrideForTests(() => {
      probeCount++
      return { fd: openSync('/dev/null', 'w') }
    })

    const handleA = runWithNewHostSession({ id: 'w7-nbs-a' }, () =>
      installNonBlockingStdout(() => {}),
    )
    expect(handleA).not.toBeNull()
    expect(probeCount).toBe(1)
    expect(isNonBlockingStdoutInstalled()).toBe(true)
    expect(process.stdout.write).not.toBe(origWrite)
    const wrappedWrite = process.stdout.write

    // Host B reuses the physical slot on process.stdout (no second probe, no double-wrap)
    const handleB = runWithNewHostSession({ id: 'w7-nbs-b' }, () =>
      installNonBlockingStdout(() => {}),
    )
    expect(handleB).not.toBeNull()
    expect(probeCount).toBe(1)
    expect(process.stdout.write).toBe(wrappedWrite)
    expect(handleA!.isActive()).toBe(true)
    expect(handleB!.isActive()).toBe(true)

    // Out-of-order restore: Host A restores FIRST -> physical wrap remains active for Host B!
    handleA!.restore()
    expect(handleA!.isActive()).toBe(false)
    expect(handleB!.isActive()).toBe(true)
    expect(isNonBlockingStdoutInstalled()).toBe(true)
    expect(process.stdout.write).toBe(wrappedWrite)

    // Duplicate restore on Host A must be a no-op and must not steal Host B's refcount
    handleA!.restore()
    expect(handleB!.isActive()).toBe(true)
    expect(isNonBlockingStdoutInstalled()).toBe(true)
    expect(process.stdout.write).toBe(wrappedWrite)

    // Host B restores LAST -> exact original `origWrite` reference is restored!
    handleB!.restore()
    expect(handleB!.isActive()).toBe(false)
    expect(isNonBlockingStdoutInstalled()).toBe(false)
    expect(process.stdout.write).toBe(origWrite)

    // Verify per-host flagOverride isolation remains intact
    const prevEnv = process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
    delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
    try {
      const flagA = runWithNewHostSession({ id: 'w7-nbs-flag-a' }, () => {
        bindNonBlockingStdoutRemoteFlag(() => true)
        return shouldInstallNonBlockingStdout()
      })
      const flagB = runWithNewHostSession({ id: 'w7-nbs-flag-b' }, () => {
        bindNonBlockingStdoutRemoteFlag(() => false)
        return shouldInstallNonBlockingStdout()
      })
      expect(flagA).toBe(true)
      expect(flagB).toBe(false)
    } finally {
      if (prevEnv === undefined) {
        delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
      } else {
        process.env.CLAUDE_CODE_NONBLOCKING_STDOUT = prevEnv
      }
    }
  })

  test('P2-1: ThemeProvider unmount outside ALS (including React state unmount without root.unmount) clears only mountedHost overrides', async () => {
    // Set custom overrides on default host (outside ALS)
    setInkCustomThemeOverrides({ claude: 'rgb(11,22,33)' })
    expect(getInkTheme('dark').claude).toBe('rgb(11,22,33)')

    let toggleShowProvider: ((next: boolean) => void) | undefined
    function ToggleHost(): React.ReactElement {
      const [show, setShow] = React.useState(true)
      toggleShowProvider = setShow
      return show
        ? withChild(
            ThemeProvider,
            { initialState: 'custom:host-a' },
            React.createElement(Text, null, 'Themed A'),
          )
        : React.createElement(Text, null, 'Unmounted A')
    }

    const ttyA = makeTtyPair()
    const { rootA, sessionA } = await runWithNewHostSession(
      { id: 'w7-tp-a' },
      async session => {
        setThemeConfigCallbacks({
          loadTheme: () => 'custom:host-a',
          saveTheme: () => {},
          resolveCustomTheme: () => ({
            base: 'dark',
            overrides: { claude: 'rgb(99,88,77)' },
          }),
        })
        const root = await createRoot({
          stdout: ttyA.stdout,
          stdin: ttyA.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        root.render(React.createElement(ToggleHost))
        await tick(20)
        return { rootA: root, sessionA: session }
      },
    )
    activeUnmounts.push(() => rootA.unmount())

    // Host A has its own override; default host is untouched
    expect(runWithSession(sessionA, () => getInkTheme('dark').claude)).toBe(
      'rgb(99,88,77)',
    )
    expect(getInkTheme('dark').claude).toBe('rgb(11,22,33)')

    // Also create Host B with its own override
    const { sessionB } = runWithNewHostSession({ id: 'w7-tp-b' }, session => {
      setInkCustomThemeOverrides({ claude: 'rgb(44,55,66)' })
      return { sessionB: session }
    })

    // Unmount ONLY <ThemeProvider> via React state update OUTSIDE ALS (without rootA.unmount!)
    expect(toggleShowProvider).toBeDefined()
    toggleShowProvider!(false)
    await tick(30)

    // Host A's overrides were cleared back to base darkTheme claude color
    expect(runWithSession(sessionA, () => getInkTheme('dark').claude)).toBe(
      'rgb(215,119,87)',
    )
    // Default host and Host B overrides MUST remain intact!
    expect(getInkTheme('dark').claude).toBe('rgb(11,22,33)')
    expect(runWithSession(sessionB, () => getInkTheme('dark').claude)).toBe(
      'rgb(44,55,66)',
    )
  })

  test('P2-2: PluginRasterPanes usePluginHoverScope updates mounted session store on enter/leave/unmount outside ALS', async () => {
    type ScopeHandle = ReturnType<typeof usePluginHoverScope>
    const handles: Record<string, ScopeHandle> = {}

    function HoverProbe({ id }: { id: string }): React.ReactElement {
      const scope = usePluginHoverScope('demo-plugin', { scope: 'card-1' })
      handles[id] = scope
      return React.createElement(Text, null, `${id}:${scope.isHot}`)
    }

    const ttyA1 = makeTtyPair()
    const ttyA2 = makeTtyPair()
    const ttyB1 = makeTtyPair()

    const { rootA1, rootA2 } = await runWithNewHostSession(
      { id: 'w7-hover-a' },
      async () => {
        const r1 = await createRoot({
          stdout: ttyA1.stdout,
          stdin: ttyA1.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        r1.render(React.createElement(HoverProbe, { id: 'a1' }))
        const r2 = await createRoot({
          stdout: ttyA2.stdout,
          stdin: ttyA2.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        r2.render(React.createElement(HoverProbe, { id: 'a2' }))
        await tick(20)
        return { rootA1: r1, rootA2: r2 }
      },
    )
    activeUnmounts.push(() => rootA1.unmount())
    activeUnmounts.push(() => rootA2.unmount())

    const rootB1 = await runWithNewHostSession(
      { id: 'w7-hover-b' },
      async () => {
        const r = await createRoot({
          stdout: ttyB1.stdout,
          stdin: ttyB1.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        r.render(React.createElement(HoverProbe, { id: 'b1' }))
        await tick(20)
        return r
      },
    )
    activeUnmounts.push(() => rootB1.unmount())

    expect(handles.a1?.isHot).toBe(false)
    expect(handles.a2?.isHot).toBe(false)
    expect(handles.b1?.isHot).toBe(false)

    // Trigger mouse enter OUTSIDE ALS (simulating real Ink mouse events)
    handles.a1!.onMouseEnter()
    await tick(20)

    expect(handles.a1?.isHot).toBe(true)
    expect(handles.a2?.isHot).toBe(true)
    expect(handles.b1?.isHot).toBe(false)

    // Unmount a1 OUTSIDE ALS while hovered -> must decrement Session A's store so a2 turns cold!
    rootA1.unmount()
    await tick(20)

    expect(handles.a2?.isHot).toBe(false)
    expect(handles.b1?.isHot).toBe(false)
  })

  test('P2-3: useSwarmPermissionPoller re-enters captured ALS session during poll without touching other sessions', async () => {
    const observedPollSessions: Array<string | undefined> = []
    const observedAllowSessions: Array<string | undefined> = []
    let allowCountA = 0
    let allowCountB = 0

    activeSpies.push(
      spyOn(permissionSyncMod, 'isSwarmWorker').mockImplementation(() => true),
      spyOn(teammateMod, 'getAgentName').mockImplementation(() => 'worker-1'),
      spyOn(teammateMod, 'getTeamName').mockImplementation(() => 'team-w7'),
      spyOn(permissionSyncMod, 'pollForResponse').mockImplementation(
        async requestId => {
          observedPollSessions.push(getActiveSessionFromAls()?.id)
          if (requestId === 'req-shared' || requestId === 'req-interval') {
            return {
              requestId,
              decision: 'approved',
              timestamp: new Date().toISOString(),
            }
          }
          return null
        },
      ),
      spyOn(permissionSyncMod, 'removeWorkerResponse').mockImplementation(
        async () => {},
      ),
    )

    function PollerProbe(): React.ReactElement | null {
      useSwarmPermissionPoller()
      return null
    }

    const ttyA = makeTtyPair()
    const { rootA, sessionA } = await runWithNewHostSession(
      { id: 'w7-swarm-a' },
      async session => {
        clearAllPendingCallbacks()
        registerPermissionCallback({
          requestId: 'req-shared',
          toolUseId: 'tu-a',
          onAllow: () => {
            allowCountA++
            observedAllowSessions.push(getActiveSessionFromAls()?.id)
          },
          onReject: () => {},
        })
        const root = await createRoot({
          stdout: ttyA.stdout,
          stdin: ttyA.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        root.render(React.createElement(PollerProbe))
        return { rootA: root, sessionA: session }
      },
    )
    activeUnmounts.push(() => rootA.unmount())

    // Register a same-id callback in Session B (no poller mounted in B)
    const sessionB = runWithNewHostSession({ id: 'w7-swarm-b' }, session => {
      clearAllPendingCallbacks()
      registerPermissionCallback({
        requestId: 'req-shared',
        toolUseId: 'tu-b',
        onAllow: () => {
          allowCountB++
        },
        onReject: () => {},
      })
      return session
    })

    // Wait for initial mount poll + async response handling
    await tick(60)

    expect(allowCountA).toBe(1)
    expect(allowCountB).toBe(0)
    expect(observedPollSessions.length).toBeGreaterThanOrEqual(1)
    expect(observedPollSessions.every(id => id === 'w7-swarm-a')).toBe(true)
    expect(observedAllowSessions).toEqual(['w7-swarm-a'])
    expect(
      runWithSession(sessionA, () => hasPermissionCallback('req-shared')),
    ).toBe(false)
    expect(
      runWithSession(sessionB, () => hasPermissionCallback('req-shared')),
    ).toBe(true)

    // Also verify a subsequent useInterval tick (500ms) re-enters sessionA outside ALS!
    let intervalAllowCountA = 0
    runWithSession(sessionA, () => {
      registerPermissionCallback({
        requestId: 'req-interval',
        toolUseId: 'tu-a-interval',
        onAllow: () => {
          intervalAllowCountA++
          observedAllowSessions.push(getActiveSessionFromAls()?.id)
        },
        onReject: () => {},
      })
    })
    await tick(620)
    expect(intervalAllowCountA).toBe(1)
    expect(observedAllowSessions).toEqual(['w7-swarm-a', 'w7-swarm-a'])
    expect(observedPollSessions.every(id => id === 'w7-swarm-a')).toBe(true)

    runWithSession(sessionB, () => clearAllPendingCallbacks())
  })

  test('P2-4: use-select-input prunes dead WeakRef shells from liveSigcontHostStates', async () => {
    function allocateEphemeralHosts(count: number): void {
      for (let i = 0; i < count; i++) {
        runWithNewHostSession({ id: `w7-sigcont-ephemeral-${i}` }, () => {
          noteProcessResumed(1000 + i)
        })
      }
    }

    allocateEphemeralHosts(100)
    // Allow GC + FinalizationRegistry callbacks + threshold-64 insertion sweep
    Bun.gc(true)
    await tick(20)
    Bun.gc(true)
    await tick(20)
    allocateEphemeralHosts(2)
    Bun.gc(true)
    await tick(20)

    // Without pruning, count would be >= 102; with pruning it drops well below threshold
    expect(_getLiveSigcontHostStateCountForTests()).toBeLessThan(65)
  })

  test('P2-5: renderOptions shares process-scoped stdin override across hosts while isolating screen-reader flag', () => {
    const prevSr = process.env.CLAUDE_AX_SCREEN_READER
    try {
      const optsA = runWithNewHostSession({ id: 'w7-render-opts-a' }, () => {
        process.env.CLAUDE_AX_SCREEN_READER = '1'
        resetScreenReaderModeCache()
        return getBaseRenderOptions(false)
      })
      const optsB = runWithNewHostSession({ id: 'w7-render-opts-b' }, () => {
        process.env.CLAUDE_AX_SCREEN_READER = '0'
        resetScreenReaderModeCache()
        return getBaseRenderOptions(false)
      })
      expect(optsA.isScreenReaderEnabled).toBe(true)
      expect(optsB.isScreenReaderEnabled).toBe(false)
      // Process-scoped /dev/tty override never allocates distinct ReadStreams per host
      expect(optsA.stdin).toBe(optsB.stdin)

      const src = readFileSync(join(ROOT, 'src/utils/renderOptions.ts'), 'utf8')
      expect(src).not.toContain('new HostSlot')
    } finally {
      if (prevSr === undefined) delete process.env.CLAUDE_AX_SCREEN_READER
      else process.env.CLAUDE_AX_SCREEN_READER = prevSr
    }
  })

  test('P2-6: PromptInputFooterLeftSide and AgentView have no fake legacy let-literal comments', () => {
    const footerSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputFooterLeftSide.tsx'),
      'utf8',
    )
    const agentViewSrc = readFileSync(
      join(ROOT, 'src/screens/AgentView.tsx'),
      'utf8',
    )
    expect(footerSrc).not.toContain('let voiceFooterHintCounted = false')
    expect(footerSrc).toContain('voiceFooterHintCounted: false')
    expect(agentViewSrc).not.toContain(
      'let restartOfferedJobId: string | null = null;',
    )
    expect(agentViewSrc).toContain('restartOfferedJobId: null')
  })
})
