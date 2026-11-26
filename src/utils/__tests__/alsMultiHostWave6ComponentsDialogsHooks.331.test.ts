/**
 * Official Claude Code 2.1.331 single-process multi-host `HostSlot` / `RootSessionSlot`
 * & `AsyncLocalStorage` isolation tests covering Wave 6 Category B
 * (UI Components, Screens, Dialogs, and React Hooks).
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import * as React from 'react'
import { wrappedRender as render } from '@anthropic/ink'
import axios from 'axios'
import stripAnsi from 'strip-ansi'
import { resetStateForTests } from '../../bootstrap/state.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import {
  isWithinSigcontGraceWindow,
  noteProcessResumed,
  resetProcessResumedForTests,
} from '../../components/CustomSelect/use-select-input.js'
import {
  clearFeedbackDraft,
  getFeedbackDraft,
  setFeedbackDraft,
} from '../../components/Feedback.js'
import { GuestPassesNotice } from '../../components/LogoV2/GuestPassesUpsell.js'
import {
  _clearHighlightCacheForTest,
  wrapHighlightWithCacheAndBudget,
} from '../../components/Markdown.js'
import { getDisplayOnlyMcpTool } from '../../components/messages/displayOnlyMcpTool.js'
import {
  getLastPromptSubmitTime,
  isWithinPermissionKeyGuard,
  recordPromptSubmitTime,
  resetPromptSubmitTimeForTests,
} from '../../components/permissions/submitGuard.js'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import {
  chooseDockRoom,
  chooseInlineRoom,
  clearPluginClientFocusedId,
  getBandCollapsed,
  getDockRoomColumns,
  getInlineRoomRows,
  getOpenListRows,
  getPluginClientFocusedId,
  getSettledBudget,
  isEngineConfirmationAsk,
  registerEngineConfirmQuestion,
  setBandCollapsed,
  setOpenListRows,
  setPluginClientFocusedId,
  setSettledBudget,
  subscribeBandCollapsed,
  subscribeDockRoom,
  subscribeOpenListRows,
  subscribePluginClientFocus,
  subscribeSettledBudget,
} from '../../components/PluginRasterPanes.js'
import {
  AgentsFooterHint,
  resetAgentsHintExpiredForTest,
  setAgentsHintExpiredForTest,
} from '../../components/PromptInput/PromptInputFooterLeftSide.js'
import { useShowFastIconHint } from '../../components/PromptInput/useShowFastIconHint.js'
import {
  getAlwaysDeliverInSessionState,
  resetConfigRowSeenFlagsForTesting,
  setAlwaysDeliverInSessionState,
} from '../../components/Settings/Config.js'
import {
  fetchGatewaySpendReading,
  getCachedGatewaySpendReading,
} from '../../components/Settings/Usage.js'
import {
  registerSlashCommandLinkHandler,
  SlashCommandLink,
} from '../../components/Spinner.js'
import {
  dismissToastItem,
  dropToast,
  expireToasts,
  getToasts,
  holdToastItem,
  pauseToasts,
  pushToast,
  subscribeToasts,
} from '../../components/toastStore.js'
import {
  AutoDefaultNudgeDialog,
  consumePendingAutoDefaultNudgeDraft,
} from '../../dialog/dialogs/AutoDefaultNudgeDialog.js'
import { createDialogMailbox } from '../../dialog/dialogMailbox.js'
import { createDialogStore } from '../../dialog/dialogStore.js'
import { DialogStoreProvider } from '../../dialog/DialogStoreContext.js'
import {
  clearIdeDiffRacerCloseTab,
  getIdeDiffRacerCloseTab,
  hasIdeDiffRacer,
  setIdeDiffRacerCloseTab,
  subscribeIdeDiffRacers,
} from '../../dialog/ideDiffRacerRegistry.js'
import {
  clearPermissionConfirms,
  getPermissionConfirm,
  registerPermissionConfirm,
  unregisterPermissionConfirm,
} from '../../dialog/permissionConfirmRegistry.js'
import {
  popQueuedCommandsOnPermissionDeny,
  setPermissionDenyQueuePop,
} from '../../dialog/permissionDenyQueuePop.js'
import {
  isSessionExiting,
  markSessionExiting,
  resetSessionExitingForTest,
  useDialogMailboxBridge,
} from '../../dialog/useDialogMailboxBridge.js'
import {
  clearFileSuggestionCaches,
  generateFileSuggestions,
  onIndexBuildComplete,
} from '../../hooks/fileSuggestions.js'
import {
  addSlaveClient,
  getAllSlaveClients,
  getSlaveClient,
  getSlaveClientRegistryVersion,
  removeSlaveClient,
  resetSlaveClientsForTesting,
  subscribePipeEntries,
  subscribeToSlaveClientRegistry,
} from '../../hooks/useMasterMonitor.js'
import {
  subscribeImageReadStart,
  usePasteHandler,
} from '../../hooks/usePasteHandler.js'
import {
  clearAllPendingCallbacks,
  hasPermissionCallback,
  hasSandboxPermissionCallback,
  processMailboxPermissionResponse,
  processSandboxPermissionResponse,
  registerPermissionCallback,
  registerSandboxPermissionCallback,
} from '../../hooks/useSwarmPermissionPoller.js'
import { useTasksV2 } from '../../hooks/useTasksV2.js'
import {
  relaunchAgentsView,
  resetFleetDispatchAutoRelaunchClockForTests,
} from '../../screens/fleetView/fleetDispatchDefaults.js'
import { getIdleCompactionRunner } from '../../screens/repl/idleCompaction.js'
import * as promptCacheTracker from '../../commands/cost/promptCacheTracker.js'
import { AppStateProvider } from '../../state/AppState.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { CliHighlight } from '../cliHighlight.js'
import * as cliRelaunchMod from '../cliRelaunch.js'
import * as configMod from '../config.js'
import * as gatewayEnvMod from '../gatewayEnv.js'
import * as imagePasteMod from '../imagePaste.js'
import type { PipeClient, PipeMessage } from '../pipeTransport.js'
import { createSessionHost } from '../sessionHost.js'
import {
  createRootSession,
  getActiveSessionFromAls,
  getBootstrapSession,
  runWithNewHostSession,
  runWithSession,
} from '../sessionRoot.js'
import * as tasksMod from '../tasks.js'

;(
  globalThis as unknown as {
    MACRO?: { VERSION: string; BUILD_TIME: string; FEEDBACK_CHANNEL: string }
  }
).MACRO ??= {
  VERSION: '2.1.331-test',
  BUILD_TIME: '2026-01-01T00:00:00Z',
  FEEDBACK_CHANNEL: 'test',
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI CSI cursor-forward replacement
const CSI_CURSOR_FORWARD_RE = /\x1b\[(\d*)C/g

function cleanAnsiOutput(raw: string): string {
  // Ink emits CSI <n> C for spaces when diffing; turn horizontal cursor moves back into spaces.
  return stripAnsi(
    raw.replace(CSI_CURSOR_FORWARD_RE, (_, n: string) =>
      ' '.repeat(n ? Number(n) : 1),
    ),
  )
}

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
    columns: 100,
    rows: 30,
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

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
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
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup error
    }
  }
  resetStateForTests()
})

describe('Wave 6 multi-host ALS isolation — Components, Screens, Dialogs & Hooks', () => {
  test('toastStore: isolates toast stack, pause/hold/dismiss, subscriber ALS context, and expiry timers across hosts; shares across withProject forks', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'toast-host-a' }, async () => {
        const initialSnap = getToasts()
        expect(getToasts()).toBe(initialSnap)

        const seenSessionIds: Array<string | undefined> = []
        const unsub = subscribeToasts(() => {
          seenSessionIds.push(getActiveSessionFromAls()?.id)
        })

        pushToast('t1', 'hello from A', 'plugA', 40)
        const afterPush = getToasts()
        expect(afterPush).toHaveLength(1)
        expect(afterPush[0]?.text).toBe('hello from A')
        expect(getToasts()).toBe(afterPush)

        // Fork shares root session toast store
        const fork = getBootstrapSession().withProject({ cwd: '/tmp/fork-a' })
        const forkCount = runWithSession(fork, () => getToasts().length)
        expect(forkCount).toBe(1)

        holdToastItem('t1', true)
        expect(getToasts()[0]?.heldAt).toBeDefined()
        holdToastItem('t1', false)
        expect(getToasts()[0]?.heldAt).toBeUndefined()

        // Let the expiry timer fire asynchronously
        await new Promise(resolve => setTimeout(resolve, 75))
        // Either entered leaving or already removed — and subscriber saw Host A's session!
        expect(seenSessionIds.every(id => id === 'toast-host-a')).toBe(true)
        expect(seenSessionIds.length).toBeGreaterThanOrEqual(3)

        pauseToasts(true)
        pushToast('t2', 'paused toast A', 'plugA', 1000)
        pauseToasts(false)
        dismissToastItem('t2')
        dropToast('t1')
        unsub()
        return { remaining: getToasts().length, seenSessionIds }
      }),
      runWithNewHostSession({ id: 'toast-host-b' }, async () => {
        expect(getToasts()).toHaveLength(0)
        pushToast('tb', 'hello from B', 'plugB', 10_000)
        await new Promise(resolve => setTimeout(resolve, 60))
        // Host A's expiry/dismissal/drop must never touch Host B
        const list = getToasts()
        expect(list).toHaveLength(1)
        expect(list[0]?.id).toBe('tb')
        expect(list[0]?.text).toBe('hello from B')
        expireToasts(Date.now() + 20_000)
        expect(getToasts()[0]?.phase).toBe('leaving')
        dropToast('tb')
        return { remaining: getToasts().length }
      }),
    ])

    expect(resA.remaining).toBe(0)
    expect(resB.remaining).toBe(0)
    expect(getToasts()).toHaveLength(0)
  })

  test('submitGuard & use-select-input SIGCONT grace: isolated across concurrent hosts', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'guard-a' }, async () => {
        resetPromptSubmitTimeForTests()
        resetProcessResumedForTests()
        recordPromptSubmitTime(10_000)
        noteProcessResumed(20_000)
        await new Promise(resolve => setTimeout(resolve, 15))
        return {
          submitTime: getLastPromptSubmitTime(),
          submitGuarded: isWithinPermissionKeyGuard(0, 10_100),
          sigcontGuarded: isWithinSigcontGraceWindow(20_050),
          guardViaSigcont: isWithinPermissionKeyGuard(0, 20_050),
        }
      }),
      runWithNewHostSession({ id: 'guard-b' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return {
          submitTime: getLastPromptSubmitTime(),
          submitGuarded: isWithinPermissionKeyGuard(0, 10_100),
          sigcontGuarded: isWithinSigcontGraceWindow(20_050),
          guardViaSigcont: isWithinPermissionKeyGuard(0, 20_050),
        }
      }),
    ])

    expect(resA).toEqual({
      submitTime: 10_000,
      submitGuarded: true,
      sigcontGuarded: true,
      guardViaSigcont: true,
    })
    expect(resB).toEqual({
      submitTime: 0,
      submitGuarded: false,
      sigcontGuarded: false,
      guardViaSigcont: false,
    })
  })

  test('displayOnlyMcpTool: isolates stub cache per SessionHost', () => {
    const stubA1 = runWithNewHostSession({ id: 'mcp-host-a' }, () =>
      getDisplayOnlyMcpTool('mcp__srv__tool', { force: true }),
    )
    const stubB = runWithNewHostSession({ id: 'mcp-host-b' }, () =>
      getDisplayOnlyMcpTool('mcp__srv__tool', { force: true }),
    )
    expect(stubA1).toBeDefined()
    expect(stubB).toBeDefined()
    expect(stubA1).not.toBe(stubB)

    // Same host returns cached instance
    const hostC = createSessionHost()
    const sC1 = createRootSession({
      host: hostC,
      id: 'mcp-c1',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sC2 = createRootSession({
      host: hostC,
      id: 'mcp-c2',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const fromC1 = runWithSession(sC1, () =>
      getDisplayOnlyMcpTool('mcp__srv__shared', { force: true }),
    )
    const fromC2 = runWithSession(sC2, () =>
      getDisplayOnlyMcpTool('mcp__srv__shared', { force: true }),
    )
    expect(fromC1).toBe(fromC2)
  })

  test('dialog registries: ideDiffRacerRegistry, permissionConfirmRegistry, permissionDenyQueuePop, and useDialogMailboxBridge exiting flag are isolated per root session', async () => {
    const fakeConfirm = (id: string): ToolUseConfirm =>
      ({ toolUseID: id }) as unknown as ToolUseConfirm

    const host = createSessionHost()
    const sess1 = createRootSession({
      host,
      id: 'dlg-s1',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sess2 = createRootSession({
      host,
      id: 'dlg-s2',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const [r1, r2] = await Promise.all([
      runWithSession(sess1, async () => {
        const events: Array<string | undefined> = []
        const unsub = subscribeIdeDiffRacers(() => {
          events.push(getActiveSessionFromAls()?.id)
        })
        const close1 = () => {}
        setIdeDiffRacerCloseTab('tu-shared', close1)
        registerPermissionConfirm(fakeConfirm('tu-shared'))
        let popped = 0
        setPermissionDenyQueuePop(() => {
          popped++
        })
        markSessionExiting()

        await new Promise(resolve => setTimeout(resolve, 20))

        popQueuedCommandsOnPermissionDeny()
        const gotClose = getIdeDiffRacerCloseTab('tu-shared')
        const gotConfirm = getPermissionConfirm('tu-shared')
        const exiting = isSessionExiting()

        // Fork shares root session's registries
        const fork = getBootstrapSession().withProject({ cwd: '/tmp/dlg-fork' })
        const forkHas = runWithSession(fork, () => ({
          racer: hasIdeDiffRacer('tu-shared'),
          confirm: getPermissionConfirm('tu-shared') === gotConfirm,
          exiting: isSessionExiting(),
        }))

        clearIdeDiffRacerCloseTab('tu-shared')
        unregisterPermissionConfirm('tu-shared')
        setPermissionDenyQueuePop(null)
        resetSessionExitingForTest()
        unsub()
        return {
          sameClose: gotClose === close1,
          hasConfirm: gotConfirm?.toolUseID === 'tu-shared',
          popped,
          exiting,
          forkHas,
          events,
        }
      }),
      runWithSession(sess2, async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        const sawRacer = hasIdeDiffRacer('tu-shared')
        const sawConfirm = getPermissionConfirm('tu-shared')
        const sawExiting = isSessionExiting()
        let popped2 = 0
        setPermissionDenyQueuePop(() => {
          popped2 += 10
        })
        popQueuedCommandsOnPermissionDeny()
        clearPermissionConfirms()
        setPermissionDenyQueuePop(null)
        return {
          sawRacer,
          sawConfirm,
          sawExiting,
          popped2,
        }
      }),
    ])

    expect(r1.sameClose).toBe(true)
    expect(r1.hasConfirm).toBe(true)
    expect(r1.popped).toBe(1)
    expect(r1.exiting).toBe(true)
    expect(r1.forkHas).toEqual({ racer: true, confirm: true, exiting: true })
    expect(r1.events).toEqual(['dlg-s1', 'dlg-s1'])

    expect(r2).toEqual({
      sawRacer: false,
      sawConfirm: undefined,
      sawExiting: false,
      popped2: 10,
    })
  })

  test('useDialogMailboxBridge: markSessionExiting in Session A does not suppress unmount cancellation in Session B', async () => {
    const repliesA: unknown[] = []
    const repliesB: unknown[] = []
    const mailboxA = createDialogMailbox()
    const mailboxB = createDialogMailbox()
    const storeA = createDialogStore()
    const storeB = createDialogStore()

    function BridgeProbe({
      mailbox,
    }: {
      mailbox: ReturnType<typeof createDialogMailbox>
    }) {
      useDialogMailboxBridge(mailbox)
      return null
    }

    const ttyA = makeTtyPair()
    const ttyB = makeTtyPair()

    let reqIdB = ''
    const instA = await runWithNewHostSession({ id: 'bridge-a' }, async () => {
      markSessionExiting()
      const inst = await render(
        withChild(
          DialogStoreProvider,
          { store: storeA },
          React.createElement(BridgeProbe, { mailbox: mailboxA }),
        ),
        { stdin: ttyA.stdin, stdout: ttyA.stdout, exitOnCtrlC: false },
      )
      void mailboxA
        .request({ kind: 'auto_default_nudge', payload: {} })
        .replied.then(r => repliesA.push(r))
      return inst
    })

    const instB = await runWithNewHostSession({ id: 'bridge-b' }, async () => {
      const inst = await render(
        withChild(
          DialogStoreProvider,
          { store: storeB },
          React.createElement(BridgeProbe, { mailbox: mailboxB }),
        ),
        { stdin: ttyB.stdin, stdout: ttyB.stdout, exitOnCtrlC: false },
      )
      const reqB = mailboxB.request({ kind: 'auto_default_nudge', payload: {} })
      reqIdB = reqB.id
      void reqB.replied.then(r => repliesB.push(r))
      return inst
    })

    await new Promise(resolve => setTimeout(resolve, 20))
    instA.unmount()
    instB.unmount()
    await new Promise(resolve => setTimeout(resolve, 20))

    // Session A had markSessionExiting() -> unmount must NOT cancel its pending request
    expect(repliesA).toHaveLength(0)
    // Session B did NOT mark exiting -> unmount MUST cancel its pending request
    expect(repliesB).toEqual([{ id: reqIdB, cancelled: true }])
  })

  test('AutoDefaultNudgeDialog: stray typing draft is isolated per session', async () => {
    const ttyA = makeTtyPair()
    const ttyB = makeTtyPair()

    const host = createSessionHost()
    const sessA = createRootSession({
      host,
      id: 'nudge-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host,
      id: 'nudge-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    let answeredA: string | undefined
    const instA = await runWithSession(sessA, async () => {
      return render(
        withChild(
          AppStateProvider,
          { initialState: getDefaultAppState() },
          withChild(
            KeybindingSetup,
            {},
            React.createElement(AutoDefaultNudgeDialog, {
              currentMode: 'default',
              onAnswer: res => {
                answeredA = res
              },
            }),
          ),
        ),
        { stdin: ttyA.stdin, stdout: ttyA.stdout, exitOnCtrlC: false },
      )
    })
    activeUnmounts.push(() => instA.unmount())

    const instB = await runWithSession(sessB, async () => {
      return render(
        withChild(
          AppStateProvider,
          { initialState: getDefaultAppState() },
          withChild(
            KeybindingSetup,
            {},
            React.createElement(AutoDefaultNudgeDialog, {
              currentMode: 'default',
              onAnswer: () => {},
            }),
          ),
        ),
        { stdin: ttyB.stdin, stdout: ttyB.stdout, exitOnCtrlC: false },
      )
    })
    activeUnmounts.push(() => instB.unmount())

    // Wait past CONFIRM_SELECT_ARM_MS (500ms) so Select is armed
    await new Promise(resolve => setTimeout(resolve, 580))

    // Type stray text and select 'declined' via Down+Enter OUTSIDE runWithSession
    // (simulating real Ink stdin data events firing outside ALS)
    for (const ch of 'abc') {
      ttyA.stdin.write(ch)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    await new Promise(resolve => setTimeout(resolve, 30))
    ttyA.stdin.write('\x1b[B')
    await new Promise(resolve => setTimeout(resolve, 30))
    ttyA.stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, 60))

    expect(answeredA).toBe('declined')
    // Session B sees empty draft; Session A consumes 'abc'
    const draftB = runWithSession(sessB, () =>
      consumePendingAutoDefaultNudgeDraft(),
    )
    const draftA = runWithSession(sessA, () =>
      consumePendingAutoDefaultNudgeDraft(),
    )
    expect(draftB).toBe('')
    expect(draftA).toBe('abc')
  })

  test('PluginRasterPanes: isolates client focus, bandCollapsed, settledBudget, openListRows, dock/inline room, and engine confirm ids per session', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'pane-a' }, async () => {
        const events: string[] = []
        const u1 = subscribePluginClientFocus(() =>
          events.push(`focus:${getActiveSessionFromAls()?.id}`),
        )
        const u2 = subscribeBandCollapsed(() =>
          events.push(`band:${getActiveSessionFromAls()?.id}`),
        )
        const u3 = subscribeSettledBudget(() =>
          events.push(`budget:${getActiveSessionFromAls()?.id}`),
        )
        const u4 = subscribeOpenListRows(() =>
          events.push(`rows:${getActiveSessionFromAls()?.id}`),
        )
        const u5 = subscribeDockRoom(() =>
          events.push(`room:${getActiveSessionFromAls()?.id}`),
        )

        setPluginClientFocusedId('client-a')
        setBandCollapsed(true)
        setSettledBudget(14)
        setOpenListRows(5)
        chooseDockRoom(42)
        chooseInlineRoom(9)
        const unregConfirm = registerEngineConfirmQuestion('req-engine-a')

        await new Promise(resolve => setTimeout(resolve, 20))

        const snap = {
          focused: getPluginClientFocusedId(),
          collapsed: getBandCollapsed(),
          budget: getSettledBudget(),
          rows: getOpenListRows(),
          dock: getDockRoomColumns(),
          inline: getInlineRoomRows(),
          isEngineConfirm: isEngineConfirmationAsk('req-engine-a'),
          events: [...events],
        }

        clearPluginClientFocusedId('client-a')
        unregConfirm()
        u1()
        u2()
        u3()
        u4()
        u5()
        return snap
      }),
      runWithNewHostSession({ id: 'pane-b' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return {
          focused: getPluginClientFocusedId(),
          collapsed: getBandCollapsed(),
          budget: getSettledBudget(),
          rows: getOpenListRows(),
          dock: getDockRoomColumns(),
          inline: getInlineRoomRows(),
          isEngineConfirm: isEngineConfirmationAsk('req-engine-a'),
        }
      }),
    ])

    expect(resA.focused).toBe('client-a')
    expect(resA.collapsed).toBe(true)
    expect(resA.budget).toBe(14)
    expect(resA.rows).toBe(5)
    expect(resA.dock).toBe(42)
    expect(resA.inline).toBe(9)
    expect(resA.isEngineConfirm).toBe(true)
    expect(resA.events).toEqual([
      'focus:pane-a',
      'band:pane-a',
      'budget:pane-a',
      'rows:pane-a',
      'room:pane-a',
      'room:pane-a',
    ])

    expect(resB.focused).toBeNull()
    expect(resB.collapsed).toBe(false)
    expect(resB.budget).toBeUndefined()
    expect(resB.rows).toBe(0)
    expect(resB.isEngineConfirm).toBe(false)
  })

  test('PromptInputFooterLeftSide: agentsHintExpiredState isolated per session', async () => {
    const ttyA = makeTtyPair()
    const ttyB = makeTtyPair()
    let outA = ''
    let outB = ''
    ttyA.stdout.on('data', c => {
      outA += String(c)
    })
    ttyB.stdout.on('data', c => {
      outB += String(c)
    })

    await runWithNewHostSession({ id: 'footer-a' }, async () => {
      resetAgentsHintExpiredForTest()
      setAgentsHintExpiredForTest(true)
      const inst = await render(
        withChild(
          AppStateProvider,
          { initialState: getDefaultAppState() },
          React.createElement(AgentsFooterHint, {}),
        ),
        { stdin: ttyA.stdin, stdout: ttyA.stdout, exitOnCtrlC: false },
      )
      activeUnmounts.push(() => inst.unmount())
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    await runWithNewHostSession({ id: 'footer-b' }, async () => {
      resetAgentsHintExpiredForTest()
      const inst = await render(
        withChild(
          AppStateProvider,
          { initialState: getDefaultAppState() },
          React.createElement(AgentsFooterHint, {}),
        ),
        { stdin: ttyB.stdin, stdout: ttyB.stdout, exitOnCtrlC: false },
      )
      activeUnmounts.push(() => inst.unmount())
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    // Session A expired its hint; Session B still renders "for agents"
    expect(cleanAnsiOutput(outA)).not.toContain('for agents')
    expect(cleanAnsiOutput(outB)).toContain('for agents')
  })

  test('useShowFastIconHint: one-shot latch is isolated per root session', async () => {
    const seenA: boolean[] = []
    const seenA2: boolean[] = []
    const seenB: boolean[] = []

    function Probe({ out }: { out: boolean[] }) {
      const showing = useShowFastIconHint(true)
      out.push(showing)
      return null
    }

    const host = createSessionHost()
    const sessA = createRootSession({
      host,
      id: 'fast-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host,
      id: 'fast-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const t1 = makeTtyPair()
    const instA1 = await runWithSession(sessA, () =>
      render(React.createElement(Probe, { out: seenA }), {
        stdin: t1.stdin,
        stdout: t1.stdout,
        exitOnCtrlC: false,
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    instA1.unmount()

    // Remount inside the SAME session A -> latch prevents showing again
    const t2 = makeTtyPair()
    const instA2 = await runWithSession(sessA, () =>
      render(React.createElement(Probe, { out: seenA2 }), {
        stdin: t2.stdin,
        stdout: t2.stdout,
        exitOnCtrlC: false,
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    instA2.unmount()

    // Mount in Session B -> fresh latch, MUST show!
    const t3 = makeTtyPair()
    const instB = await runWithSession(sessB, () =>
      render(React.createElement(Probe, { out: seenB }), {
        stdin: t3.stdin,
        stdout: t3.stdout,
        exitOnCtrlC: false,
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    instB.unmount()

    expect(seenA).toContain(true)
    expect(seenA2).not.toContain(true)
    expect(seenB).toContain(true)
  })

  test('GuestPassesNotice: countedThisSession latch is isolated per root session', async () => {
    const incrementsBySession: Array<string | undefined> = []
    activeSpies.push(
      spyOn(configMod, 'saveGlobalConfig').mockImplementation(updater => {
        incrementsBySession.push(getActiveSessionFromAls()?.id)
        const base = {} as ReturnType<typeof configMod.getGlobalConfig>
        updater(base)
        return true
      }),
    )

    const host = createSessionHost()
    const sessA = createRootSession({
      host,
      id: 'passes-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host,
      id: 'passes-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const tA1 = makeTtyPair()
    const iA1 = await runWithSession(sessA, () =>
      render(React.createElement(GuestPassesNotice), {
        stdin: tA1.stdin,
        stdout: tA1.stdout,
        exitOnCtrlC: false,
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    iA1.unmount()

    // Second mount in sessA must NOT double-increment
    const tA2 = makeTtyPair()
    const iA2 = await runWithSession(sessA, () =>
      render(React.createElement(GuestPassesNotice), {
        stdin: tA2.stdin,
        stdout: tA2.stdout,
        exitOnCtrlC: false,
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    iA2.unmount()

    // First mount in sessB MUST increment once
    const tB = makeTtyPair()
    const iB = await runWithSession(sessB, () =>
      render(React.createElement(GuestPassesNotice), {
        stdin: tB.stdin,
        stdout: tB.stdout,
        exitOnCtrlC: false,
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    iB.unmount()

    expect(incrementsBySession).toEqual(['passes-a', 'passes-b'])
  })

  test('Feedback, Config, Spinner: per-session drafts, alwaysDeliver state, and slashLink handler are isolated', async () => {
    const host = createSessionHost()
    const sessA = createRootSession({
      host,
      id: 'ui-s-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host,
      id: 'ui-s-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const [resA, resB] = await Promise.all([
      runWithSession(sessA, async () => {
        setFeedbackDraft('shared-key', 'draft from A')
        setAlwaysDeliverInSessionState({ scope: 'mine', madeIn: 'prompting' })
        const ran: string[] = []
        registerSlashCommandLinkHandler(cmd => ran.push(cmd))

        await new Promise(resolve => setTimeout(resolve, 15))
        const draft = getFeedbackDraft('shared-key')
        const deliver = getAlwaysDeliverInSessionState()

        clearFeedbackDraft('shared-key')
        resetConfigRowSeenFlagsForTesting()
        registerSlashCommandLinkHandler(null)
        return { draft, deliver, ran }
      }),
      runWithSession(sessB, async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        const draft = getFeedbackDraft('shared-key')
        const deliver = getAlwaysDeliverInSessionState()
        // Render SlashCommandLink in sessB with no handler registered — must render non-clickable plain Text
        const tty = makeTtyPair()
        let out = ''
        tty.stdout.on('data', c => {
          out += String(c)
        })
        const inst = await render(
          React.createElement(SlashCommandLink, {
            command: 'config',
            args: 'foo=bar',
          }),
          { stdin: tty.stdin, stdout: tty.stdout, exitOnCtrlC: false },
        )
        await new Promise(resolve => setTimeout(resolve, 15))
        inst.unmount()
        return { draft, deliver, out }
      }),
    ])

    expect(resA.draft).toBe('draft from A')
    expect(resA.deliver).toEqual({ scope: 'mine', madeIn: 'prompting' })
    expect(resB.draft).toBe('')
    expect(resB.deliver).toBeUndefined()
    expect(cleanAnsiOutput(resB.out)).toContain('/config foo=bar')
  })

  test('Markdown highlightCache: isolated per SessionHost', () => {
    let callsA = 0
    let callsB = 0
    const hlA: CliHighlight = {
      supportsLanguage: () => true,
      highlight(code) {
        callsA++
        return `A:${code}`
      },
    }
    const hlB: CliHighlight = {
      supportsLanguage: () => true,
      highlight(code) {
        callsB++
        return `B:${code}`
      },
    }

    const hostA = createSessionHost()
    const hostB = createSessionHost()
    const sessA = createRootSession({
      host: hostA,
      id: 'md-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host: hostB,
      id: 'md-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const outA1 = runWithSession(sessA, () =>
      wrapHighlightWithCacheAndBudget(hlA, 'dark')!.highlight('const n = 1', {
        language: 'ts',
      }),
    )
    const outB1 = runWithSession(sessB, () =>
      wrapHighlightWithCacheAndBudget(hlB, 'dark')!.highlight('const n = 1', {
        language: 'ts',
      }),
    )
    // Clear Host B's cache — Host A's cache must stay warm
    runWithSession(sessB, () => _clearHighlightCacheForTest())

    const outA2 = runWithSession(sessA, () =>
      wrapHighlightWithCacheAndBudget(hlA, 'dark')!.highlight('const n = 1', {
        language: 'ts',
      }),
    )
    const outB2 = runWithSession(sessB, () =>
      wrapHighlightWithCacheAndBudget(hlB, 'dark')!.highlight('const n = 1', {
        language: 'ts',
      }),
    )

    expect(outA1).toBe('A:const n = 1')
    expect(outA2).toBe('A:const n = 1')
    expect(callsA).toBe(1)
    expect(outB1).toBe('B:const n = 1')
    expect(outB2).toBe('B:const n = 1')
    expect(callsB).toBe(2)
  })

  test('Usage gatewaySpend cache & in-flight dedup: isolated per SessionHost', async () => {
    const authByHost = new Map<string, { url: string; jwt: string }>([
      ['usage-a', { url: 'https://gw.example', jwt: 'same-jwt' }],
      ['usage-b', { url: 'https://gw.example', jwt: 'same-jwt' }],
    ])
    activeSpies.push(
      spyOn(gatewayEnvMod, 'getGatewayAuth').mockImplementation(() => {
        const id = getActiveSessionFromAls()?.id
        const auth = id ? authByHost.get(id) : undefined
        return auth
          ? ({
              url: auth.url,
              jwt: auth.jwt,
              token: auth.jwt,
              source: 'env',
            } as unknown as ReturnType<typeof gatewayEnvMod.getGatewayAuth>)
          : null
      }),
    )
    let reqCount = 0
    activeSpies.push(
      spyOn(axios, 'get').mockImplementation((async () => {
        const currentCount = ++reqCount
        const sid = getActiveSessionFromAls()?.id
        await new Promise(resolve => setTimeout(resolve, 15))
        return {
          status: 200,
          data: {
            extra_usage: {
              currency: 'USD',
              monthly_limit: 100,
              used_credits: sid === 'usage-a' ? 11 : 77,
              utilization: currentCount,
            },
          },
        }
      }) as typeof axios.get),
    )

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'usage-a' }, async () => {
        const reading = await fetchGatewaySpendReading()
        return {
          reading,
          cached: getCachedGatewaySpendReading(),
        }
      }),
      runWithNewHostSession({ id: 'usage-b' }, async () => {
        const reading = await fetchGatewaySpendReading()
        return {
          reading,
          cached: getCachedGatewaySpendReading(),
        }
      }),
    ])

    expect(reqCount).toBe(2)
    expect(resA.reading?.limit).toBe(100)
    expect(
      resA.reading && resA.reading.limit !== null && resA.reading.used,
    ).toBe(11)
    expect(resA.cached).toEqual(resA.reading)
    expect(
      resB.reading && resB.reading.limit !== null && resB.reading.used,
    ).toBe(77)
    expect(resB.cached).toEqual(resB.reading)
  })

  test('fileSuggestions: isolates index, caches, and onIndexBuildComplete listeners across concurrent hosts with distinct cwds', async () => {
    const dirA = makeTempDir('fsug-a-')
    const dirB = makeTempDir('fsug-b-')
    mkdirSync(join(dirA, 'alpha'), { recursive: true })
    mkdirSync(join(dirB, 'beta'), { recursive: true })
    writeFileSync(join(dirA, 'alpha', 'onlyA.ts'), 'export const a = 1\n')
    writeFileSync(join(dirB, 'beta', 'onlyB.ts'), 'export const b = 2\n')

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        { id: 'fsug-host-a', cwd: dirA, projectRoot: dirA, originalCwd: dirA },
        async () => {
          clearFileSuggestionCaches()
          const completedSessions: Array<string | undefined> = []
          const unsub = onIndexBuildComplete(() => {
            completedSessions.push(getActiveSessionFromAls()?.id)
          })
          const top = await generateFileSuggestions('', true)
          await new Promise(resolve => setTimeout(resolve, 150))
          const found = await generateFileSuggestions('onlyA', false)
          const missB = await generateFileSuggestions('onlyB', false)
          unsub()
          clearFileSuggestionCaches()
          return {
            top: top.map(s => s.displayText),
            found: found.map(s => s.displayText),
            missB: missB.map(s => s.displayText),
            completedSessions,
          }
        },
      ),
      runWithNewHostSession(
        { id: 'fsug-host-b', cwd: dirB, projectRoot: dirB, originalCwd: dirB },
        async () => {
          clearFileSuggestionCaches()
          const completedSessions: Array<string | undefined> = []
          const unsub = onIndexBuildComplete(() => {
            completedSessions.push(getActiveSessionFromAls()?.id)
          })
          const top = await generateFileSuggestions('', true)
          await new Promise(resolve => setTimeout(resolve, 150))
          const found = await generateFileSuggestions('onlyB', false)
          const missA = await generateFileSuggestions('onlyA', false)
          unsub()
          clearFileSuggestionCaches()
          return {
            top: top.map(s => s.displayText),
            found: found.map(s => s.displayText),
            missA: missA.map(s => s.displayText),
            completedSessions,
          }
        },
      ),
    ])

    expect(resA.top).toContain('alpha/')
    expect(resA.top).not.toContain('beta/')
    expect(resA.missB).toEqual([])
    expect(resA.completedSessions.every(id => id === 'fsug-host-a')).toBe(true)

    expect(resB.top).toContain('beta/')
    expect(resB.top).not.toContain('alpha/')
    expect(resB.missA).toEqual([])
    expect(resB.completedSessions.every(id => id === 'fsug-host-b')).toBe(true)
  })

  test('useMasterMonitor: isolates slave client registry, versions, and pipe entry listeners with ALS capture across sessions', async () => {
    const makeFakePipeClient = (): PipeClient & EventEmitter => {
      const ee = new EventEmitter()
      return Object.assign(ee, {
        connected: true,
        send: () => {},
      }) as unknown as PipeClient & EventEmitter
    }

    const clientA = makeFakePipeClient()
    const clientB = makeFakePipeClient()

    const host = createSessionHost()
    const sessA = createRootSession({
      host,
      id: 'mon-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host,
      id: 'mon-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const entriesA: Array<{ slave: string; content: string; sid?: string }> = []
    const entriesB: Array<{ slave: string; content: string; sid?: string }> = []
    let regChangesA = 0
    let regChangesB = 0

    const unsubRegA = runWithSession(sessA, () =>
      subscribeToSlaveClientRegistry(() => {
        regChangesA++
      }),
    )
    const unsubPipeA = runWithSession(sessA, () =>
      subscribePipeEntries((slave, entry) => {
        entriesA.push({
          slave,
          content: entry.content,
          sid: getActiveSessionFromAls()?.id,
        })
      }),
    )
    const unsubRegB = runWithSession(sessB, () =>
      subscribeToSlaveClientRegistry(() => {
        regChangesB++
      }),
    )
    const unsubPipeB = runWithSession(sessB, () =>
      subscribePipeEntries((slave, entry) => {
        entriesB.push({
          slave,
          content: entry.content,
          sid: getActiveSessionFromAls()?.id,
        })
      }),
    )

    runWithSession(sessA, () => addSlaveClient('worker-1', clientA))
    runWithSession(sessB, () => addSlaveClient('worker-2', clientB))

    expect(runWithSession(sessA, () => getSlaveClient('worker-1'))).toBe(
      clientA,
    )
    expect(
      runWithSession(sessA, () => getSlaveClient('worker-2')),
    ).toBeUndefined()
    expect(runWithSession(sessA, () => getAllSlaveClients().size)).toBe(1)
    expect(runWithSession(sessA, () => getSlaveClientRegistryVersion())).toBe(1)

    expect(runWithSession(sessB, () => getSlaveClient('worker-2'))).toBe(
      clientB,
    )
    expect(
      runWithSession(sessB, () => getSlaveClient('worker-1')),
    ).toBeUndefined()
    expect(runWithSession(sessB, () => getSlaveClientRegistryVersion())).toBe(1)

    // Emit message OUTSIDE any ALS context — handler must restore owning session!
    clientA.emit('message', {
      type: 'stream',
      data: 'msg-for-A',
    } as PipeMessage)
    clientB.emit('message', {
      type: 'stream',
      data: 'msg-for-B',
    } as PipeMessage)

    expect(entriesA).toEqual([
      { slave: 'worker-1', content: 'msg-for-A', sid: 'mon-a' },
    ])
    expect(entriesB).toEqual([
      { slave: 'worker-2', content: 'msg-for-B', sid: 'mon-b' },
    ])
    expect(regChangesA).toBe(1)
    expect(regChangesB).toBe(1)

    runWithSession(sessA, () => removeSlaveClient('worker-1'))
    runWithSession(sessB, () => resetSlaveClientsForTesting())
    unsubRegA()
    unsubPipeA()
    unsubRegB()
    unsubPipeB()
  })

  test('usePasteHandler: subscribeImageReadStart listeners are isolated per session', async () => {
    activeSpies.push(
      spyOn(imagePasteMod, 'getImageFromClipboard').mockResolvedValue(null),
    )

    const host = createSessionHost()
    const sessA = createRootSession({
      host,
      id: 'paste-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host,
      id: 'paste-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const hitsA: Array<string | undefined> = []
    const hitsB: Array<string | undefined> = []
    const unsubA = runWithSession(sessA, () =>
      subscribeImageReadStart(() => hitsA.push(getActiveSessionFromAls()?.id)),
    )
    const unsubB = runWithSession(sessB, () =>
      subscribeImageReadStart(() => hitsB.push(getActiveSessionFromAls()?.id)),
    )

    let triggerPasteA!: (event: {
      text: string
      preventDefault: () => void
    }) => void
    function PasteProbe() {
      const { handlePaste } = usePasteHandler({
        handleKeyDown: () => {},
        onImagePaste: () => {},
      })
      triggerPasteA = handlePaste
      return null
    }

    const tty = makeTtyPair()
    const inst = await runWithSession(sessA, () =>
      render(React.createElement(PasteProbe), {
        stdin: tty.stdin,
        stdout: tty.stdout,
        exitOnCtrlC: false,
      }),
    )
    activeUnmounts.push(() => inst.unmount())
    await new Promise(resolve => setTimeout(resolve, 15))

    runWithSession(sessA, () => {
      triggerPasteA({ text: '', preventDefault: () => {} })
    })

    expect(hitsA).toEqual(['paste-a'])
    expect(hitsB).toEqual([])
    unsubA()
    unsubB()
  })

  test('useSwarmPermissionPoller: isolates permission and sandbox callback registries per session', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'swarm-perm-a' }, async () => {
        let allowed = false
        let sandboxAllowed: boolean | null = null
        registerPermissionCallback({
          requestId: 'req-same',
          toolUseId: 'tu-a',
          onAllow: () => {
            allowed = true
          },
          onReject: () => {},
        })
        registerSandboxPermissionCallback({
          requestId: 'sb-same',
          host: 'example.com',
          resolve: v => {
            sandboxAllowed = v
          },
        })
        await new Promise(resolve => setTimeout(resolve, 15))
        const processedPerm = processMailboxPermissionResponse({
          requestId: 'req-same',
          decision: 'approved',
        })
        const processedSandbox = processSandboxPermissionResponse({
          requestId: 'sb-same',
          host: 'example.com',
          allow: true,
        })
        return {
          allowed,
          sandboxAllowed: sandboxAllowed as boolean | null,
          processedPerm,
          processedSandbox,
          remainingPerm: hasPermissionCallback('req-same'),
          remainingSandbox: hasSandboxPermissionCallback('sb-same'),
        }
      }),
      runWithNewHostSession({ id: 'swarm-perm-b' }, async () => {
        let rejected: string | undefined
        registerPermissionCallback({
          requestId: 'req-same',
          toolUseId: 'tu-b',
          onAllow: () => {},
          onReject: fb => {
            rejected = fb
          },
        })
        await new Promise(resolve => setTimeout(resolve, 10))
        // Session A's approval must NOT consume Session B's callback
        expect(hasPermissionCallback('req-same')).toBe(true)
        expect(hasSandboxPermissionCallback('sb-same')).toBe(false)
        processMailboxPermissionResponse({
          requestId: 'req-same',
          decision: 'rejected',
          feedback: 'denied in B',
        })
        clearAllPendingCallbacks()
        return { rejected }
      }),
    ])

    expect(resA).toEqual({
      allowed: true,
      sandboxAllowed: true,
      processedPerm: true,
      processedSandbox: true,
      remainingPerm: false,
      remainingSandbox: false,
    })
    expect(resB).toEqual({ rejected: 'denied in B' })
  })

  test('useTasksV2: isolates singleton TasksV2Store per root session', async () => {
    activeSpies.push(
      spyOn(tasksMod, 'isTodoV2Enabled').mockReturnValue(true),
      spyOn(tasksMod, 'getTaskListId').mockImplementation(
        () => getActiveSessionFromAls()?.id ?? 'default',
      ),
      spyOn(tasksMod, 'listTasks').mockImplementation(async listId => [
        {
          id: `task-${listId}`,
          subject: `Work for ${listId}`,
          description: '',
          status: 'in_progress',
          blocks: [],
          blockedBy: [],
        },
      ]),
    )

    const snapsA: Array<string[] | undefined> = []
    const snapsB: Array<string[] | undefined> = []

    function TasksProbe({ out }: { out: Array<string[] | undefined> }) {
      const tasks = useTasksV2()
      out.push(tasks?.map(t => t.id))
      return null
    }

    const ttyA = makeTtyPair()
    const ttyB = makeTtyPair()

    const instA = await runWithNewHostSession({ id: 'tasks-a' }, () =>
      render(
        withChild(
          AppStateProvider,
          { initialState: getDefaultAppState() },
          React.createElement(TasksProbe, { out: snapsA }),
        ),
        { stdin: ttyA.stdin, stdout: ttyA.stdout, exitOnCtrlC: false },
      ),
    )
    activeUnmounts.push(() => instA.unmount())

    const instB = await runWithNewHostSession({ id: 'tasks-b' }, () =>
      render(
        withChild(
          AppStateProvider,
          { initialState: getDefaultAppState() },
          React.createElement(TasksProbe, { out: snapsB }),
        ),
        { stdin: ttyB.stdin, stdout: ttyB.stdout, exitOnCtrlC: false },
      ),
    )
    activeUnmounts.push(() => instB.unmount())

    await new Promise(resolve => setTimeout(resolve, 60))

    expect(snapsA.at(-1)).toEqual(['task-tasks-a'])
    expect(snapsB.at(-1)).toEqual(['task-tasks-b'])
  })

  test('fleetDispatchDefaults: auto-relaunch throttle clock is isolated per root session', async () => {
    const spawnsBySession: Array<string | undefined> = []
    activeSpies.push(
      spyOn(cliRelaunchMod, 'spawnCliRelaunch').mockImplementation(() => {
        spawnsBySession.push(getActiveSessionFromAls()?.id)
        return { ok: false, error: 'simulated-stop' }
      }),
      spyOn(process.stdout, 'write').mockImplementation(() => true),
    )

    await runWithNewHostSession({ id: 'fleet-a' }, async () => {
      resetFleetDispatchAutoRelaunchClockForTests()
      await relaunchAgentsView({ mode: 'auto' })
      // Second immediate call in SAME session is throttled
      await relaunchAgentsView({ mode: 'auto' })
    })

    await runWithNewHostSession({ id: 'fleet-b' }, async () => {
      // Session B must NOT be throttled by Session A's relaunch
      await relaunchAgentsView({ mode: 'auto' })
    })

    expect(spawnsBySession).toEqual(['fleet-a', 'fleet-b'])
  })

  test('idleCompaction: isolates shared runner per root session, shares across withProject forks, and preserves ALS context when timer fires', async () => {
    const now = Date.now()
    activeSpies.push(
      spyOn(promptCacheTracker, 'summarizePromptCache').mockReturnValue({
        warm: true,
        lastRequest: { ttl: '1h', at: now - 10 },
        lastActivityAt: now - 10,
        expiresAt: now + 30,
      } as unknown as ReturnType<
        typeof promptCacheTracker.summarizePromptCache
      >),
    )

    const host = createSessionHost()
    const sessA = createRootSession({
      host,
      id: 'idle-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    const sessB = createRootSession({
      host,
      id: 'idle-b',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })

    const runnerA = runWithSession(sessA, () => getIdleCompactionRunner())
    const runnerB = runWithSession(sessB, () => getIdleCompactionRunner())
    expect(runnerA).not.toBe(runnerB)

    // Fork shares root session's runner
    const forkA = sessA.withProject({ cwd: '/tmp/idle-fork-a' })
    expect(runWithSession(forkA, () => getIdleCompactionRunner())).toBe(runnerA)

    let firedInSessionId: string | undefined
    runWithSession(sessA, () => {
      runnerA.host = {
        compact: async () => {
          firedInSessionId = getActiveSessionFromAls()?.id
          return { tokensBefore: 250_000, tokensAfter: 50_000 }
        },
      }
      runnerA.arm(now - 5, () => ({ prefix: 'ok' }), {
        isInteractive: true,
        getContextTokens: () => 250_000,
      })
    })

    // Wait for timer (~26ms) to fire outside any ALS context
    await new Promise(resolve => setTimeout(resolve, 90))

    expect(runnerA.record.timer).toBe('fired')
    expect(runnerB.record).toEqual({ timer: 'not_tried' })
    if (firedInSessionId !== undefined) {
      expect(firedInSessionId).toBe('idle-a')
    }
    runnerA.clear()
    runnerB.clear()
  })
})
