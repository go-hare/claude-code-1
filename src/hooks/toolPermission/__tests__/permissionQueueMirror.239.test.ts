/**
 * densable NMs tip bridge: remote/pipe/teammate push via enqueue must open
 * permission_prompt:* on DialogStore (not tip PermissionRequest overlay).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ToolUseConfirm } from '../../../components/permissions/PermissionRequest.js'
import { createDialogStore } from '../../../dialog/dialogStore.js'
import {
  clearPermissionConfirms,
  getPermissionConfirm,
} from '../../../dialog/permissionConfirmRegistry.js'
import { permissionPromptDialogId } from '../../../dialog/specs/permissionKinds.js'
import {
  clearPermissionConfirmQueue,
  createPermissionQueueOps,
  dequeuePermissionConfirm,
  enqueuePermissionConfirm,
} from '../PermissionContext.js'
import {
  pushLeaderToolUseConfirm,
  registerLeaderToolUseConfirmQueue,
  removeLeaderToolUseConfirm,
  unregisterLeaderToolUseConfirmQueue,
} from '../../../utils/swarm/leaderPermissionBridge.js'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))

function makeConfirm(
  toolUseID: string,
  toolUseContext: ToolUseConfirm['toolUseContext'] = {} as never,
): ToolUseConfirm {
  return {
    assistantMessage: { type: 'assistant', message: { content: [] } } as never,
    tool: { name: 'Bash' } as never,
    description: 'run ls',
    input: { command: 'ls' },
    toolUseContext,
    toolUseID,
    permissionResult: { behavior: 'ask', message: 'ask' },
    permissionPromptStartTimeMs: Date.now(),
    onUserInteraction() {},
    onAbort() {},
    onAllow() {},
    onReject() {},
    async recheckPermission() {},
  }
}

afterEach(() => {
  clearPermissionConfirms()
  unregisterLeaderToolUseConfirmQueue()
})

describe('permission queue DialogStore mirror (densable NMs)', () => {
  test('enqueuePermissionConfirm registers + opens permission_prompt mirror', async () => {
    const store = createDialogStore()
    let queue: ToolUseConfirm[] = []
    const setQueue = (
      updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
    ) => {
      queue = updater(queue)
    }

    enqueuePermissionConfirm(setQueue as never, store, makeConfirm('tu-mirror'))

    expect(queue.map(q => q.toolUseID)).toEqual(['tu-mirror'])
    expect(getPermissionConfirm('tu-mirror')?.toolUseID).toBe('tu-mirror')

    await Bun.sleep(50)
    const id = permissionPromptDialogId('tu-mirror')
    expect(store.getState().open.some(d => d.id === id)).toBe(true)
  })

  test('dequeuePermissionConfirm removes queue item + dismisses mirror', async () => {
    const store = createDialogStore()
    let queue: ToolUseConfirm[] = []
    const setQueue = (
      updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
    ) => {
      queue = updater(queue)
    }

    enqueuePermissionConfirm(setQueue as never, store, makeConfirm('tu-rm'))
    await Bun.sleep(50)
    expect(store.getState().open.length).toBeGreaterThan(0)

    dequeuePermissionConfirm(setQueue as never, store, 'tu-rm')
    expect(queue).toEqual([])
    expect(getPermissionConfirm('tu-rm')).toBeUndefined()
    expect(store.getState().open).toEqual([])
  })

  test('useCancelRequest aborts Host doo before clearing the queue', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../useCancelRequest.ts'),
      'utf8',
    )
    const abort = src.indexOf(
      'if (abortSignal !== undefined && !abortSignal.aborted)',
    )
    const onCancel = src.indexOf('onCancel()', abort)
    const clear = src.indexOf('clearPermissionConfirmQueue', abort)
    expect(abort).toBeGreaterThan(-1)
    expect(onCancel).toBeGreaterThan(abort)
    expect(clear).toBeGreaterThan(onCancel)
  })

  test('clearPermissionConfirmQueue wipes mirrors but not doo dialog-N', async () => {
    const store = createDialogStore()
    let queue: ToolUseConfirm[] = []
    const setQueue = (
      updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
    ) => {
      queue = updater(queue)
    }

    store.open({
      id: 'dialog-9',
      kind: 'permission_file',
      payload: { requestId: 'doo-1' },
    })
    enqueuePermissionConfirm(setQueue as never, store, makeConfirm('tu-clr'))
    await Bun.sleep(50)

    clearPermissionConfirmQueue(setQueue, store)
    expect(queue).toEqual([])
    expect(getPermissionConfirm('tu-clr')).toBeUndefined()
    expect(store.getState().open.map(d => d.id)).toEqual(['dialog-9'])
  })

  test('queue update patches Host classifierState on the mirror payload', async () => {
    const store = createDialogStore()
    let queue: ToolUseConfirm[] = []
    const setQueue = (
      updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
    ) => {
      queue = updater(queue)
    }
    const ops = createPermissionQueueOps(setQueue as never, store)
    const confirm = makeConfirm('tu-clf')
    ops.push({
      ...confirm,
      classifierCheckInProgress: true,
    })
    await Bun.sleep(50)
    const id = permissionPromptDialogId('tu-clf')
    const opened = store.getState().open.find(d => d.id === id)
    expect(opened).toBeDefined()
    store.update(id, {
      ...(opened?.payload as object),
      classifierState: 'checking',
    })
    ops.update('tu-clf', {
      classifierCheckInProgress: false,
      classifierAutoApproved: true,
    })
    const payload = store.getState().open.find(d => d.id === id)?.payload as {
      classifierState?: string
    }
    expect(payload.classifierState).toBe('approved')
    expect(queue[0]?.classifierAutoApproved).toBe(true)
  })

  test('leader bridge push/remove mirrors via registered dialogStore', async () => {
    const store = createDialogStore()
    let queue: ToolUseConfirm[] = []
    registerLeaderToolUseConfirmQueue(updater => {
      queue = updater(queue)
    }, store)

    expect(pushLeaderToolUseConfirm(makeConfirm('tu-leader'))).toBe(true)
    expect(queue.map(q => q.toolUseID)).toEqual(['tu-leader'])
    await Bun.sleep(50)
    expect(
      store
        .getState()
        .open.some(d => d.id === permissionPromptDialogId('tu-leader')),
    ).toBe(true)

    removeLeaderToolUseConfirm('tu-leader')
    expect(queue).toEqual([])
    expect(store.getState().open).toEqual([])
  })

  test('requestDialog on confirm skips mirror (doo owns the open)', async () => {
    const store = createDialogStore()
    let queue: ToolUseConfirm[] = []
    const setQueue = (
      updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
    ) => {
      queue = updater(queue)
    }
    enqueuePermissionConfirm(
      setQueue as never,
      store,
      makeConfirm('tu-doo', {
        requestDialog: async () => ({ behavior: 'cancelled' }),
      } as never),
    )
    await Bun.sleep(50)
    expect(queue.map(q => q.toolUseID)).toEqual(['tu-doo'])
    expect(store.getState().open).toEqual([])
  })
})
