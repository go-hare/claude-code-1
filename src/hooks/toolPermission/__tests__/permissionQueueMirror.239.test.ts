/**
 * densable NMs tip bridge: remote/pipe/teammate push via enqueue must open
 * permission_prompt:* on DialogStore (not tip PermissionRequest overlay).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { ToolUseConfirm } from '../../../components/permissions/PermissionRequest.js'
import { createDialogStore } from '../../../dialog/dialogStore.js'
import {
  clearPermissionConfirms,
  getPermissionConfirm,
} from '../../../dialog/permissionConfirmRegistry.js'
import { permissionPromptDialogId } from '../../../dialog/specs/permissionKinds.js'
import {
  clearPermissionConfirmQueue,
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

function makeConfirm(toolUseID: string): ToolUseConfirm {
  return {
    assistantMessage: { type: 'assistant', message: { content: [] } } as never,
    tool: { name: 'Bash' } as never,
    description: 'run ls',
    input: { command: 'ls' },
    toolUseContext: {} as never,
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
})
