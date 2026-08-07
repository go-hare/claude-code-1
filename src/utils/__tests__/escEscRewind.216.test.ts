/**
 * densable 2.1.216 #12 — Esc-Esc at idle prompt opens rewind picker even when
 * background task-notifications sit in the command queue.
 *
 * densable gold (xja / Opu / x4):
 *   Mkg = Set(["task-notification"])
 *   Nkg(mode) = !Mkg.has(mode)
 *   x4(cmd) = Nkg(mode) && !isMeta && pue(origin)
 *   Opu() = queue.some(x4)
 *   chat:cancel isActive G includes q=y.some(x4) — NOT full queue length
 *   PromptInput empty Esc: if(!FW()){if(queue.some(x4)) pop; return}; if(msgs&&!input&&!loading) doublePress→selector
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearCommandQueue,
  enqueue,
  enqueuePendingNotification,
  getCommandQueueLength,
  hasCommandsInQueue,
  hasEditableCommandsInQueue,
  isQueuedCommandEditable,
  resetCommandQueue,
} from '../messageQueueManager.js'

beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
})

describe('esc-esc idle+bg rewind (2.1.216 #12 densable Opu/x4)', () => {
  test('task-notification alone is not editable (x4 false)', () => {
    enqueuePendingNotification({
      value: 'Background agent "x" finished',
      mode: 'task-notification',
    } as any)
    expect(getCommandQueueLength()).toBe(1)
    expect(hasCommandsInQueue()).toBe(true)
    expect(hasEditableCommandsInQueue()).toBe(false)
    expect(
      isQueuedCommandEditable({
        value: 'Background agent "x" finished',
        mode: 'task-notification',
      } as any),
    ).toBe(false)
  })

  test('human prompt in queue is editable (x4 true)', () => {
    enqueue({ value: 'hello', mode: 'prompt' } as any)
    expect(hasEditableCommandsInQueue()).toBe(true)
    expect(
      isQueuedCommandEditable({ value: 'hello', mode: 'prompt' } as any),
    ).toBe(true)
  })

  test('mixed queue: only notifications → Opu false (Esc free for rewind)', () => {
    enqueuePendingNotification({
      value: 'task A done',
      mode: 'task-notification',
    } as any)
    enqueuePendingNotification({
      value: 'task B done',
      mode: 'task-notification',
    } as any)
    expect(hasCommandsInQueue()).toBe(true)
    expect(hasEditableCommandsInQueue()).toBe(false)
  })

  test('mixed queue: notification + human prompt → Opu true', () => {
    enqueuePendingNotification({
      value: 'task A done',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'user typed this', mode: 'prompt' } as any)
    expect(hasEditableCommandsInQueue()).toBe(true)
  })

  test('meta prompt is not editable (densable !isMeta)', () => {
    enqueue({
      value: 'Continue where you left off',
      mode: 'prompt',
      isMeta: true,
    } as any)
    expect(hasEditableCommandsInQueue()).toBe(false)
  })

  test('source wires densable Opu filter (not raw queue length)', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const cancelSrc = readFileSync(
      join(import.meta.dir, '../../hooks/useCancelRequest.ts'),
      'utf8',
    )
    expect(cancelSrc).toContain('isQueuedCommandEditable')
    expect(cancelSrc).toContain('hasEditableCommandsInQueue')
    // Must not reintroduce full-queue isActive for Esc
    expect(cancelSrc).not.toMatch(
      /hasQueuedCommands\s*=\s*queuedCommandsLength\s*>\s*0/,
    )
    expect(cancelSrc).toContain('hasEditableQueuedCommands')

    const mqSrc = readFileSync(
      join(import.meta.dir, '../messageQueueManager.ts'),
      'utf8',
    )
    expect(mqSrc).toContain('hasEditableCommandsInQueue')
    expect(mqSrc).toContain('isQueuedCommandEditable')
  })

  test('PromptInput empty Esc path still gates on isQueuedCommandEditable', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../../components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(src).toContain('isQueuedCommandEditable')
    expect(src).toContain('doublePressEscFromEmpty')
    expect(src).toContain('onShowMessageSelector')
    expect(src).toMatch(/messages\.length > 0 && !input && !isLoading/)
  })
})
