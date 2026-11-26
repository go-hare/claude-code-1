import { describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCwdState,
  getOriginalCwd,
  setCwdState,
  switchSession,
} from '../../bootstrap/state.js'
import type { SessionId } from '../../types/ids.js'
import {
  describeScopedCallLookMismatch,
  exitScopedCwd,
  getCwd,
  getCwdOverride,
  getScopedCallCwd,
  getScopedCallPhysicalCwd,
  hasScopedCwd,
  inspectCwdLook,
  inspectCwdLookSync,
  matchesScopedCallPhysicalCwd,
  pinScopedCallCwd,
  preserveRootCwdAcrossAsync,
  pwd,
  runWithCwd,
  runWithCwdOverride,
  setCwd,
  stripWalkedPhysicalPrefix,
  unpinScopedCallCwd,
  WALKED_PHYSICAL_PREFIX,
  withScopedCallCwd,
} from '../cwd.js'
import {
  getScratchpadDir,
  getScratchpadDirCacheForHost,
  resetScratchpadDirCache,
} from '../permissions/filesystem.js'
import {
  getBootstrapSessionHost,
  runWithNewHostSession,
} from '../sessionHost.js'
import {
  clearPluginSettingsBase,
  clearSettingsCache,
  getCachedParsedFile,
  getCachedSettingsForSource,
  getPluginSettingsBase,
  getSessionSettingsCache,
  getSettingsOwner,
  getSettingsOwnerForHost,
  resetSettingsCache,
  setCachedParsedFile,
  setCachedSettingsForSource,
  setPluginSettingsBase,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'

const tick = (ms = 2): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

describe('2.1.331 AsyncLocalStorage per-call/per-host CWD & host-scoped caches', () => {
  describe('cwdAls (runWithCwd, withScopedCallCwd, staysPut, setCwd, preserveRootCwdAcrossAsync, exitScopedCwd)', () => {
    test('falls back to getCwdState outside cwdAls and mutates session cwd on unscoped setCwd', () => {
      const initialCwd = getCwdState()
      try {
        expect(hasScopedCwd()).toBe(false)
        expect(getCwdOverride()).toBeUndefined()
        expect(getScopedCallCwd()).toBeUndefined()
        expect(getCwd()).toBe(initialCwd)

        const target = initialCwd === '/tmp' ? '/var/tmp' : '/tmp'
        setCwd(target)
        expect(getCwdState()).toBe(target)
        expect(getCwd()).toBe(target)
        expect(pwd()).toBe(target)
      } finally {
        setCwdState(initialCwd)
      }
    })

    test('isolates concurrent interleaved async runWithCwd + setCwd across tasks without touching global cwd', async () => {
      const globalBefore = getCwdState()
      const taskCount = 8

      const results = await Promise.all(
        Array.from({ length: taskCount }, (_, idx) =>
          runWithCwd(`/virtual/host-${idx}/initial`, async () => {
            const seen: string[] = []
            expect(hasScopedCwd()).toBe(true)
            seen.push(getCwd())
            await tick((idx % 3) + 1)
            expect(getCwd()).toBe(`/virtual/host-${idx}/initial`)
            expect(getCwdOverride()).toBe(`/virtual/host-${idx}/initial`)

            setCwd(`/virtual/host-${idx}/step-1`)
            seen.push(getCwd())
            await tick(((idx + 1) % 3) + 1)
            expect(getCwd()).toBe(`/virtual/host-${idx}/step-1`)

            setCwd(`/virtual/host-${idx}/step-2`)
            seen.push(getCwd())
            await tick(1)
            expect(getCwd()).toBe(`/virtual/host-${idx}/step-2`)
            return seen
          }),
        ),
      )

      for (let idx = 0; idx < taskCount; idx++) {
        expect(results[idx]).toEqual([
          `/virtual/host-${idx}/initial`,
          `/virtual/host-${idx}/step-1`,
          `/virtual/host-${idx}/step-2`,
        ])
      }
      expect(getCwdState()).toBe(globalBefore)
      expect(getCwd()).toBe(globalBefore)
      expect(hasScopedCwd()).toBe(false)
    })

    test('normalizes NFD paths to NFC in runWithCwd, runWithCwdOverride, and setCwd', () => {
      const nfdStart = '/virtual/cafe\u0301-start'
      const nfcStart = nfdStart.normalize('NFC')
      const nfdNext = '/virtual/re\u0301sume\u0301-next'
      const nfcNext = nfdNext.normalize('NFC')

      runWithCwdOverride(nfdStart, () => {
        expect(getCwd()).toBe(nfcStart)
        setCwd(nfdNext)
        expect(getCwd()).toBe(nfcNext)
      })
    })

    test('isolates concurrent sibling withScopedCallCwd frames when one call invokes setCwd', async () => {
      const globalBefore = getCwdState()

      await runWithCwd('/virtual/shared-root', async () => {
        let releaseCallB!: () => void
        const callBGate = new Promise<void>(resolve => {
          releaseCallB = resolve
        })
        let markCallBEntered!: () => void
        const callBEntered = new Promise<void>(resolve => {
          markCallBEntered = resolve
        })

        const callA = withScopedCallCwd(async () => {
          await callBEntered
          expect(getCwd()).toBe('/virtual/shared-root')
          expect(getScopedCallCwd()).toBe('/virtual/shared-root')
          setCwd('/virtual/call-a-moved')
          expect(getCwd()).toBe('/virtual/call-a-moved')
          expect(getScopedCallCwd()).toBe('/virtual/call-a-moved')
          await tick(3)
          releaseCallB()
          return getCwd()
        })

        const callB = withScopedCallCwd(async () => {
          expect(getCwd()).toBe('/virtual/shared-root')
          markCallBEntered()
          await callBGate
          // Sibling call A mutated its own frame and the outer root,
          // but call B's own scoped call frame stays isolated at '/virtual/shared-root'.
          expect(getCwd()).toBe('/virtual/shared-root')
          expect(getScopedCallCwd()).toBe('/virtual/shared-root')
          return getCwd()
        })

        const [resA, resB] = await Promise.all([callA, callB])
        expect(resA).toBe('/virtual/call-a-moved')
        expect(resB).toBe(
          '/virtual/call-root-check'.replace('call-root-check', 'shared-root'),
        )
        // After both calls finish, the enclosing runWithCwd root frame reflects call A's setCwd
        expect(getCwd()).toBe('/virtual/call-a-moved')
        expect(getScopedCallCwd()).toBeUndefined()
      })

      expect(getCwdState()).toBe(globalBefore)
    })

    test('honors pinScopedCallCwd (staysPut) + movedInside for nested calls + unpinScopedCallCwd', async () => {
      await runWithCwd('/virtual/pin-start', async () => {
        await withScopedCallCwd(async () => {
          expect(getCwd()).toBe('/virtual/pin-start')
          pinScopedCallCwd()

          // While pinned, setCwd keeps this call's own getCwd() at '/virtual/pin-start',
          // records movedInside for nested withScopedCallCwd, and updates the outer root frame.
          setCwd('/virtual/moved-while-pinned')
          expect(getCwd()).toBe('/virtual/pin-start')
          expect(getScopedCallCwd()).toBe('/virtual/pin-start')

          const nestedObserved = await withScopedCallCwd(async () => {
            const atEntry = getCwd()
            await tick(2)
            return atEntry
          })
          expect(nestedObserved).toBe('/virtual/moved-while-pinned')

          // Still pinned in outer call
          expect(getCwd()).toBe('/virtual/pin-start')

          // Unpinning allows subsequent setCwd in the same call to update immediately
          unpinScopedCallCwd()
          setCwd('/virtual/moved-after-unpin')
          expect(getCwd()).toBe('/virtual/moved-after-unpin')

          const nestedAfterUnpin = await withScopedCallCwd(async () => getCwd())
          expect(nestedAfterUnpin).toBe('/virtual/moved-after-unpin')
        })

        // After withScopedCallCwd finishes, outer runWithCwd has the latest cwd
        expect(getCwd()).toBe('/virtual/moved-after-unpin')
      })

      // Also verify pinned call whose last setCwd stayed pinned still updates outer root
      await runWithCwd('/virtual/pin-only-start', async () => {
        const duringPinnedCall = await withScopedCallCwd(async () => {
          pinScopedCallCwd()
          setCwd('/virtual/pin-only-final')
          await tick(2)
          return getCwd()
        })
        expect(duringPinnedCall).toBe('/virtual/pin-only-start')
        expect(getCwd()).toBe('/virtual/pin-only-final')
      })
    })

    test('marks callFrame.isOver = true in finally (including on rejection) so detached continuations unwrap to outer', async () => {
      let detachedCheckAfterResolve!: () => Promise<string>
      let detachedCheckAfterReject!: () => Promise<{
        cwd: string
        callCwd: string | undefined
      }>

      await runWithCwd('/virtual/outer-host', async () => {
        await withScopedCallCwd(async () => {
          pinScopedCallCwd()
          setCwd('/virtual/outer-host-updated')
          expect(getCwd()).toBe('/virtual/outer-host')
          detachedCheckAfterResolve = async () => {
            await tick(2)
            return getCwd()
          }
        })

        // Now that withScopedCallCwd finished (isOver = true), the detached callback
        // skips the completed call frame and sees the updated outer root cwd!
        expect(await detachedCheckAfterResolve()).toBe(
          '/virtual/outer-host-updated',
        )

        await expect(
          withScopedCallCwd(async () => {
            pinScopedCallCwd()
            setCwd('/virtual/after-throw')
            detachedCheckAfterReject = async () => {
              await tick(1)
              return { cwd: getCwd(), callCwd: getScopedCallCwd() }
            }
            throw new Error('simulated call failure')
          }),
        ).rejects.toThrow('simulated call failure')

        expect(await detachedCheckAfterReject()).toEqual({
          cwd: '/virtual/after-throw',
          callCwd: undefined,
        })
      })
    })

    test('preserveRootCwdAcrossAsync strips call frames while keeping root runWithCwd, and exits when no root scope exists', async () => {
      const globalCwd = getCwdState()

      // Case 1: Inside runWithCwd + withScopedCallCwd -> preserves root frame, drops call frame
      await runWithCwd('/virtual/root-preserved', async () => {
        await withScopedCallCwd(async () => {
          pinScopedCallCwd()
          setCwd('/virtual/root-mutated')
          expect(getCwd()).toBe('/virtual/root-preserved')
          expect(getScopedCallCwd()).toBe('/virtual/root-preserved')

          const preserved = await preserveRootCwdAcrossAsync(async () => {
            await tick(2)
            return {
              hasRoot: hasScopedCwd(),
              callCwd: getScopedCallCwd(),
              cwd: getCwd(),
            }
          })

          expect(preserved).toEqual({
            hasRoot: true,
            callCwd: undefined,
            cwd: '/virtual/root-mutated',
          })
        })
      })

      // Case 2: Inside withScopedCallCwd WITHOUT runWithCwd -> hasScopedCwd is false, preserveRootCwdAcrossAsync exits ALS
      await withScopedCallCwd(async () => {
        expect(hasScopedCwd()).toBe(false)
        expect(getScopedCallCwd()).toBe(globalCwd)

        const exited = preserveRootCwdAcrossAsync(() => ({
          hasRoot: hasScopedCwd(),
          callCwd: getScopedCallCwd(),
          cwd: getCwd(),
        }))

        expect(exited).toEqual({
          hasRoot: false,
          callCwd: undefined,
          cwd: globalCwd,
        })
      })
    })

    test('exitScopedCwd temporarily exits cwdAls to read global/host session cwd and restores scope afterwards', () => {
      const globalCwd = getCwdState()

      runWithCwd('/virtual/scoped-only', () => {
        expect(hasScopedCwd()).toBe(true)
        expect(getCwd()).toBe('/virtual/scoped-only')

        const insideExit = exitScopedCwd(() => ({
          hasScoped: hasScopedCwd(),
          override: getCwdOverride(),
          cwd: getCwd(),
        }))

        expect(insideExit).toEqual({
          hasScoped: false,
          override: undefined,
          cwd: globalCwd,
        })

        expect(hasScopedCwd()).toBe(true)
        expect(getCwd()).toBe('/virtual/scoped-only')
      })
    })

    test('captures physical cwd look, handles diskless mode, and classifies look mismatches', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'als-cwd-look-'))
      const canonicalTempDir = realpathSync(tempDir).normalize('NFC')
      try {
        const syncLook = inspectCwdLookSync(tempDir)
        const asyncLook = await inspectCwdLook(tempDir)
        expect(syncLook).toEqual({ physical: canonicalTempDir })
        expect(asyncLook).toEqual({ physical: canonicalTempDir })

        const missingLook = inspectCwdLookSync(
          join(tempDir, 'definitely-does-not-exist'),
        )
        expect(missingLook).toEqual({ physical: null })

        await runWithCwd(tempDir, async () => {
          await withScopedCallCwd(async () => {
            expect(getScopedCallPhysicalCwd()).toBe(canonicalTempDir)
            expect(matchesScopedCallPhysicalCwd(canonicalTempDir)).toBe(true)
            expect(matchesScopedCallPhysicalCwd('/other/dir')).toBe(false)
            expect(matchesScopedCallPhysicalCwd(false)).toBe(false)
            expect(describeScopedCallLookMismatch({ physical: null })).toEqual({
              atHold: false,
              found: 'deleted',
            })
            expect(
              describeScopedCallLookMismatch({ physical: undefined }),
            ).toEqual({
              atHold: false,
              found: 'unexaminable',
            })
            expect(
              describeScopedCallLookMismatch({ physical: '/somewhere/else' }),
            ).toEqual({
              atHold: false,
              found: 'led_elsewhere',
            })
          })
        })

        // Diskless host skips filesystem probing in inspectCwdLookSync / inspectCwdLook
        await runWithNewHostSession(
          { cwd: tempDir, diskless: true },
          async () => {
            expect(inspectCwdLookSync(tempDir)).toEqual({
              physical: undefined,
            })
            expect(await inspectCwdLook(tempDir)).toEqual({
              physical: undefined,
            })
          },
        )

        expect(
          stripWalkedPhysicalPrefix(
            `${WALKED_PHYSICAL_PREFIX}16777220:999:/real/path:with:colon`,
          ),
        ).toBe('/real/path:with:colon')
        expect(stripWalkedPhysicalPrefix('/plain/path')).toBe('/plain/path')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('per-host settingsCache isolation via WeakMap<SessionHost, SettingsOwner>', () => {
    test('isolates cached settings, parsed files, plugin base, and invalidations across concurrent hosts', async () => {
      resetSettingsCache()
      setSessionSettingsCache({
        settings: { model: 'default-host-model' },
        errors: [],
      })

      try {
        let hostARef: object | undefined
        let hostBRef: object | undefined
        let hostAInvalidations = 0
        let hostBInvalidations = 0

        const [hostAResult, hostBResult] = await Promise.all([
          runWithNewHostSession(
            { id: 'host-a-session', cwd: '/virtual/host-a' },
            async () => {
              hostARef = getBootstrapSessionHost()
              const unsub = getSettingsOwner().onInvalidate(() => {
                hostAInvalidations++
              })
              try {
                expect(getSessionSettingsCache()).toBeNull()
                setSessionSettingsCache({
                  settings: { model: 'claude-opus-host-a' },
                  errors: [],
                })
                setCachedSettingsForSource('userSettings', {
                  alwaysThinkingEnabled: true,
                })
                setCachedParsedFile('/virtual/host-a/settings.json', {
                  settings: { cleanupPeriodDays: 14 },
                  errors: [],
                })
                setPluginSettingsBase({ hostTag: 'A' })

                await tick(6)

                // Even after Host B runs clearSettingsCache / resetSettingsCache concurrently,
                // Host A's caches remain completely intact!
                return {
                  mergedModel: getSessionSettingsCache()?.settings.model,
                  userSource: getCachedSettingsForSource('userSettings'),
                  parsedFile: getCachedParsedFile(
                    '/virtual/host-a/settings.json',
                  ),
                  otherHostParsedFile: getCachedParsedFile(
                    '/virtual/host-b/settings.json',
                  ),
                  pluginBase: getPluginSettingsBase(),
                  epoch: getSettingsOwner().epoch,
                }
              } finally {
                unsub()
              }
            },
          ),
          runWithNewHostSession(
            { id: 'host-b-session', cwd: '/virtual/host-b' },
            async () => {
              hostBRef = getBootstrapSessionHost()
              const unsub = getSettingsOwner().onInvalidate(() => {
                hostBInvalidations++
              })
              try {
                await tick(1)
                expect(getSessionSettingsCache()).toBeNull()
                setSessionSettingsCache({
                  settings: { model: 'claude-sonnet-host-b' },
                  errors: [],
                })
                setCachedSettingsForSource('userSettings', {
                  alwaysThinkingEnabled: false,
                })
                setCachedParsedFile('/virtual/host-b/settings.json', {
                  settings: { cleanupPeriodDays: 30 },
                  errors: [],
                })
                setPluginSettingsBase({ hostTag: 'B' })

                await tick(2)
                clearSettingsCache()
                clearPluginSettingsBase()
                await tick(1)

                return {
                  mergedAfterClear: getSessionSettingsCache(),
                  userSourceAfterClear:
                    getCachedSettingsForSource('userSettings'),
                  parsedAfterClear: getCachedParsedFile(
                    '/virtual/host-b/settings.json',
                  ),
                  pluginBaseAfterClear: getPluginSettingsBase(),
                  epoch: getSettingsOwner().epoch,
                }
              } finally {
                unsub()
              }
            },
          ),
        ])

        expect(hostARef).toBeDefined()
        expect(hostBRef).toBeDefined()
        expect(hostARef).not.toBe(hostBRef)
        expect(getSettingsOwnerForHost(hostARef!)).not.toBe(
          getSettingsOwnerForHost(hostBRef!),
        )

        expect(hostAResult).toEqual({
          mergedModel: 'claude-opus-host-a',
          userSource: { alwaysThinkingEnabled: true },
          parsedFile: {
            settings: { cleanupPeriodDays: 14 },
            errors: [],
          },
          otherHostParsedFile: undefined,
          pluginBase: { hostTag: 'A' },
          epoch: 0,
        })
        expect(hostAInvalidations).toBe(0)

        expect(hostBResult).toEqual({
          mergedAfterClear: null,
          userSourceAfterClear: undefined,
          parsedAfterClear: undefined,
          pluginBaseAfterClear: undefined,
          epoch: 1,
        })
        expect(hostBInvalidations).toBe(1)

        // Default process host settings cache is also untouched by either isolated host
        expect(getSessionSettingsCache()?.settings.model).toBe(
          'default-host-model',
        )
      } finally {
        resetSettingsCache()
        clearPluginSettingsBase()
      }
    })
  })

  describe('per-host filesystem scratchpadDirBySessionId isolation', () => {
    test('isolates getScratchpadDir and resetScratchpadDirCache across concurrent hosts', async () => {
      const defaultHost = getBootstrapSessionHost()
      const defaultOrigCwd = getOriginalCwd()
      resetScratchpadDirCache()
      const defaultDir = getScratchpadDir('default-host-session')
      expect(getScratchpadDirCacheForHost(defaultHost).size).toBe(1)

      let hostA!: object
      let hostB!: object

      const [resA, resB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'shared-session-id',
            originalCwd: '/tmp/als-scratch-proj-a',
            cwd: '/tmp/als-scratch-proj-a',
          },
          async () => {
            hostA = getBootstrapSessionHost()
            const dirA1 = getScratchpadDir()
            await tick(6)
            // Host B called resetScratchpadDirCache() and switchSession() while we waited;
            // Host A's WeakMap entry must still retain dirA1!
            const cacheSizeAfterHostBReset =
              getScratchpadDirCacheForHost(hostA).size
            const dirA2 = getScratchpadDir()
            return { dirA1, dirA2, cacheSizeAfterHostBReset }
          },
        ),
        runWithNewHostSession(
          {
            id: 'shared-session-id',
            originalCwd: '/tmp/als-scratch-proj-b',
            cwd: '/tmp/als-scratch-proj-b',
          },
          async () => {
            hostB = getBootstrapSessionHost()
            await tick(1)
            const dirB1 = getScratchpadDir()
            expect(getScratchpadDirCacheForHost(hostB).size).toBe(1)

            await tick(1)
            // Clearing / switching session on Host B only clears Host B's scratchpad map
            resetScratchpadDirCache()
            expect(getScratchpadDirCacheForHost(hostB).size).toBe(0)

            switchSession('host-b-switched-session' as SessionId)
            expect(getScratchpadDirCacheForHost(hostB).size).toBe(0)
            const dirB2 = getScratchpadDir()
            return { dirB1, dirB2 }
          },
        ),
      ])

      expect(hostA).not.toBe(hostB)
      expect(resA.dirA1).toBe(resA.dirA2)
      expect(resA.cacheSizeAfterHostBReset).toBe(1)
      expect(resA.dirA1).not.toBe(resB.dirB1)
      expect(resB.dirB2).toContain('host-b-switched-session')

      // Default host's scratchpad cache was also never wiped by Host B's resetScratchpadDirCache / switchSession
      expect(getScratchpadDirCacheForHost(defaultHost).size).toBe(1)
      expect(getScratchpadDir('default-host-session')).toBe(defaultDir)
      expect(getOriginalCwd()).toBe(defaultOrigCwd)
      resetScratchpadDirCache()
    })
  })
})
