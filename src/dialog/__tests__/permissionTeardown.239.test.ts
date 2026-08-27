/**
 * Regression: claim winners must clear mailbox dialog; Host onDone must not
 * settle allow (FilePermission reject calls onDone before onReject).
 */
import { describe, expect, test } from 'bun:test'
import {
  clearIdeDiffRacerCloseTab,
  hasIdeDiffRacer,
  setIdeDiffRacerCloseTab,
  subscribeIdeDiffRacers,
} from '../ideDiffRacerRegistry.js'
import {
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
} from '../index.js'
import {
  permissionFileSpec,
  permissionPromptDialogId,
} from '../specs/permissionKinds.js'

function wireMailbox(store: ReturnType<typeof createDialogStore>) {
  const mailbox = createDialogMailbox()
  mailbox.subscribe(entry => store.open(entry))
  mailbox.onCancel(id => store.dismiss(id))
  store.onClosed(event => {
    mailbox.reply(
      event.type === 'answered'
        ? { id: event.id, result: event.result }
        : { id: event.id, cancelled: true },
    )
  })
  return { mailbox, requestDialog: createRequestDialog(mailbox) }
}

describe('permission dialog hang / teardown regressions', () => {
  test('dismissAndTeardown abort clears mailbox dialog from store', async () => {
    const store = createDialogStore()
    const { requestDialog } = wireMailbox(store)
    const ac = new AbortController()
    const pending = requestDialog(
      permissionFileSpec,
      {
        requestId: 'tu-hang',
        toolName: 'Edit',
        permissionResult: { behavior: 'ask' },
        filePath: 'a.ts',
        operationType: 'edit',
      },
      { signal: ac.signal },
    )
    await Bun.sleep(0)
    expect(store.getState().open.some(d => d.kind === 'permission_file')).toBe(
      true,
    )
    // densable onWin O(): abort dialog signal
    ac.abort()
    expect(await pending).toEqual({ behavior: 'cancelled' })
    expect(store.getState().open).toEqual([])
  })

  test('dequeue tip mirror id must not dismiss doo dialog-N by requestId', () => {
    const store = createDialogStore()
    store.open({
      id: 'dialog-1',
      kind: 'permission_file',
      payload: { requestId: 'tu-1', toolName: 'Edit' },
    })
    store.open({
      id: permissionPromptDialogId('tu-1'),
      kind: 'permission_prompt',
      payload: { requestId: 'tu-1', toolName: 'Bash' },
    })
    // tip dequeue semantics: mirror only
    const id = permissionPromptDialogId('tu-1')
    if (store.getState().open.some(d => d.id === id)) {
      store.dismiss(id)
    }
    expect(store.getState().open.map(d => d.id)).toEqual(['dialog-1'])
  })

  test('ide diff racer registry notifies subscribers on clear', () => {
    let ticks = 0
    const unsub = subscribeIdeDiffRacers(() => {
      ticks += 1
    })
    setIdeDiffRacerCloseTab('tu-ide', () => {})
    expect(hasIdeDiffRacer('tu-ide')).toBe(true)
    expect(ticks).toBeGreaterThanOrEqual(1)
    const before = ticks
    clearIdeDiffRacerCloseTab('tu-ide')
    expect(hasIdeDiffRacer('tu-ide')).toBe(false)
    expect(ticks).toBeGreaterThan(before)
    unsub()
  })

  test('store.answer bypasses Host c_y debounce for missing-confirm cancel', () => {
    const store = createDialogStore()
    store.open({
      id: 'dialog-1',
      kind: 'permission_file',
      payload: { requestId: 'tu-miss', toolName: 'Edit' },
      swappedAt: Date.now(),
    })
    // Immediate answer must clear even inside debounce window (Host uses
    // store.answer for missing confirm — not the debounced wrapper).
    store.answer('dialog-1', { behavior: 'cancelled' })
    expect(store.getState().open).toEqual([])
  })
})
