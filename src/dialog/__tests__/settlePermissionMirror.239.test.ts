/**
 * Host answer on permission_prompt:* must settle enqueue confirms.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import { createDialogStore } from '../dialogStore.js'
import {
  clearPermissionConfirms,
  getPermissionConfirm,
  registerPermissionConfirm,
} from '../permissionConfirmRegistry.js'
import {
  popQueuedCommandsOnPermissionDeny,
  setPermissionDenyQueuePop,
} from '../permissionDenyQueuePop.js'
import { permissionPromptDialogId } from '../specs/permissionKinds.js'
import { settlePermissionMirror } from '../settlePermissionMirror.js'
import {
  registerLeaderToolUseConfirmQueue,
  unregisterLeaderToolUseConfirmQueue,
} from '../../utils/swarm/leaderPermissionBridge.js'

function makeConfirm(
  toolUseID: string,
  hooks: {
    onAllow?: ToolUseConfirm['onAllow']
    onReject?: ToolUseConfirm['onReject']
    onAbort?: ToolUseConfirm['onAbort']
  },
): ToolUseConfirm {
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
    onAbort: hooks.onAbort ?? (() => {}),
    onAllow: hooks.onAllow ?? (() => {}),
    onReject: hooks.onReject ?? (() => {}),
    async recheckPermission() {},
  }
}

afterEach(() => {
  clearPermissionConfirms()
  setPermissionDenyQueuePop(null)
  unregisterLeaderToolUseConfirmQueue()
})

describe('settlePermissionMirror', () => {
  test('allow calls onAllow with updatedInput and persist updates', () => {
    const allowed: unknown[] = []
    registerPermissionConfirm(
      makeConfirm('tu-allow', {
        onAllow(input, updates, feedback) {
          allowed.push({ input, updates, feedback })
        },
      }),
    )
    const settled = settlePermissionMirror({
      id: permissionPromptDialogId('tu-allow'),
      type: 'answered',
      result: {
        behavior: 'allow',
        updatedInput: { command: 'pwd' },
        permissionUpdates: [{ type: 'addRules' }],
        feedback: 'ok',
      },
    })
    expect(settled).toBe(true)
    expect(allowed).toEqual([
      {
        input: { command: 'pwd' },
        updates: [{ type: 'addRules' }],
        feedback: 'ok',
      },
    ])
    expect(getPermissionConfirm('tu-allow')).toBeUndefined()
  })

  test('deny calls onReject and does not pop queued commands', () => {
    const rejected: unknown[] = []
    let popped = 0
    setPermissionDenyQueuePop(() => {
      popped += 1
    })
    registerPermissionConfirm(
      makeConfirm('tu-deny', {
        onReject(feedback) {
          rejected.push(feedback)
        },
      }),
    )
    const settled = settlePermissionMirror({
      id: permissionPromptDialogId('tu-deny'),
      type: 'answered',
      result: { behavior: 'deny', feedback: 'nope' },
    })
    expect(settled).toBe(true)
    expect(rejected).toEqual(['nope'])
    expect(popped).toBe(0)
    expect(getPermissionConfirm('tu-deny')).toBeUndefined()
  })

  test('cancelled calls onAbort and does not pop queued commands', () => {
    let aborted = 0
    let popped = 0
    setPermissionDenyQueuePop(() => {
      popped += 1
    })
    registerPermissionConfirm(
      makeConfirm('tu-esc', {
        onAbort() {
          aborted += 1
        },
      }),
    )
    expect(
      settlePermissionMirror({
        id: permissionPromptDialogId('tu-esc'),
        type: 'answered',
        result: { behavior: 'cancelled' },
      }),
    ).toBe(true)
    expect(aborted).toBe(1)
    expect(popped).toBe(0)
  })

  test('mailbox dialog-N ids are ignored', () => {
    registerPermissionConfirm(makeConfirm('doo-1', {}))
    expect(
      settlePermissionMirror({
        id: 'dialog-9',
        type: 'answered',
        result: { behavior: 'allow' },
      }),
    ).toBe(false)
    expect(getPermissionConfirm('doo-1')?.toolUseID).toBe('doo-1')
  })

  test('store.answer on a live store settles via onClosed', () => {
    const allowed: unknown[] = []
    const store = createDialogStore()
    store.onClosed(event => {
      settlePermissionMirror(event)
    })
    registerPermissionConfirm(
      makeConfirm('tu-store', {
        onAllow(input) {
          allowed.push(input)
        },
      }),
    )
    const id = permissionPromptDialogId('tu-store')
    store.open({
      id,
      kind: 'permission_prompt',
      payload: { requestId: 'tu-store' },
    })
    store.answer(id, { behavior: 'allow', updatedInput: { x: 1 } })
    expect(allowed).toEqual([{ x: 1 }])
  })

  test('settle does not dequeue tip queue (densable Host / doo W pattern)', () => {
    let queue: ToolUseConfirm[] = [makeConfirm('tu-q', {})]
    registerLeaderToolUseConfirmQueue(updater => {
      queue = updater(queue)
    })
    registerPermissionConfirm(makeConfirm('tu-q', { onAllow() {} }))
    expect(
      settlePermissionMirror({
        id: permissionPromptDialogId('tu-q'),
        type: 'answered',
        result: { behavior: 'allow' },
      }),
    ).toBe(true)
    // Opener callbacks own dequeue — settle only fires onAllow.
    expect(queue.map(q => q.toolUseID)).toEqual(['tu-q'])
  })
})

describe('permissionDenyQueuePop', () => {
  test('unset popper is a no-op', () => {
    expect(() => popQueuedCommandsOnPermissionDeny()).not.toThrow()
  })
})

describe('wiring (source locks)', () => {
  test('REPL installs mirror sink and deny popper', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain('usePermissionMirrorSink()')
    expect(src).toContain(
      'setPermissionDenyQueuePop(handleQueuedCommandOnCancel)',
    )
  })

  test('pipe enqueue strips requestDialog so mirror opens', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../hooks/usePipePermissionForward.ts'),
      'utf8',
    )
    expect(src).toContain('requestDialog: undefined')
    expect(src).toContain('enqueuePermissionConfirm')
  })

  test('leader/inbox openers dequeue in onAllow (densable doo W pattern)', () => {
    const runner = readFileSync(
      join(import.meta.dir, '../../utils/swarm/inProcessRunner.ts'),
      'utf8',
    )
    const inbox = readFileSync(
      join(import.meta.dir, '../../hooks/useInboxPoller.ts'),
      'utf8',
    )
    // onAllow body must dequeue (not only abort/recheck paths)
    expect(runner).toMatch(
      /async onAllow\([\s\S]*?removeLeaderToolUseConfirm\(toolUseID\)/,
    )
    expect(runner).toMatch(
      /onReject\([\s\S]*?removeLeaderToolUseConfirm\(toolUseID\)/,
    )
    expect(inbox).toContain('removeLeaderToolUseConfirm(parsed.tool_use_id)')
    const settle = readFileSync(
      join(import.meta.dir, '../settlePermissionMirror.ts'),
      'utf8',
    )
    expect(settle).not.toContain('removeLeaderToolUseConfirm')
  })
})
