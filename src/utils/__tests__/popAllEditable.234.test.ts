/**
 * densable 2.1.234 #19 — popAllEditable restores bash mode for queued `!`.
 *
 * SEA ve/NMt:
 * - NMt(e,t)=lJ(e)&&(t||e.mode!=="bash") — bash only pops when input empty
 * - mode = every selected cmd bash ? "bash" : "prompt"
 * - when restoring as prompt, bash entries stay in the queue
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clampQueueEditIndex,
  enqueue,
  getCommandQueue,
  popAllEditable,
  popEditableAt,
  queueEditIndexAfterHistoryDown,
  queueEditIndexAfterHistoryUp,
  resetCommandQueue,
} from '../messageQueueManager.js'

beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
})

describe('popAllEditable densable 2.1.234 #19', () => {
  test('empty input + queued bash → restores bash mode and text', () => {
    enqueue({ value: 'ls -la', mode: 'bash' } as any)
    const result = popAllEditable('', 0)
    expect(result).toBeDefined()
    expect(result!.mode).toBe('bash')
    expect(result!.text).toBe('ls -la')
    expect(getCommandQueue()).toHaveLength(0)
  })

  test('non-empty input does not pop bash (NMt)', () => {
    enqueue({ value: 'ls -la', mode: 'bash' } as any)
    const result = popAllEditable('draft', 5)
    expect(result).toBeUndefined()
    expect(getCommandQueue()).toHaveLength(1)
    expect(getCommandQueue()[0]!.mode).toBe('bash')
  })

  test('mixed bash+prompt with empty input → prompt mode, bash stays queued', () => {
    enqueue({ value: 'echo hi', mode: 'bash' } as any)
    enqueue({ value: 'hello', mode: 'prompt' } as any)
    const result = popAllEditable('', 0)
    expect(result).toBeDefined()
    expect(result!.mode).toBe('prompt')
    expect(result!.text).toBe('hello')
    const left = getCommandQueue()
    expect(left).toHaveLength(1)
    expect(left[0]!.mode).toBe('bash')
    expect(left[0]!.value).toBe('echo hi')
  })

  test('all prompt editable → prompt mode', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    enqueue({ value: 'b', mode: 'prompt' } as any)
    const result = popAllEditable('', 0)
    expect(result!.mode).toBe('prompt')
    expect(result!.text).toBe('a\nb')
    expect(getCommandQueue()).toHaveLength(0)
  })

  test('non-empty input can still pop prompt commands', () => {
    enqueue({ value: 'queued', mode: 'prompt' } as any)
    const result = popAllEditable('draft', 5)
    expect(result).toBeDefined()
    expect(result!.mode).toBe('prompt')
    expect(result!.text).toBe('queued\ndraft')
  })
})

describe('popEditableAt densable 2.1.234 #20 Ne', () => {
  test('indexes into filter(lJ), skips non-editable', () => {
    enqueue({ value: 'note', mode: 'task-notification' } as any)
    enqueue({ value: 'first', mode: 'prompt' } as any)
    enqueue({ value: 'second', mode: 'prompt' } as any)
    const result = popEditableAt(1, '', 0)
    expect(result).toBeDefined()
    expect(result!.text).toBe('second')
    expect(result!.mode).toBe('prompt')
    const left = getCommandQueue()
    expect(left).toHaveLength(2)
    expect(left[0]!.mode).toBe('task-notification')
    expect(left[1]!.value).toBe('first')
  })

  test('NMt: bash only pops when input empty', () => {
    enqueue({ value: 'ls -la', mode: 'bash' } as any)
    expect(popEditableAt(0, 'draft', 5)).toBeUndefined()
    expect(getCommandQueue()).toHaveLength(1)
    const result = popEditableAt(0, '', 0)
    expect(result).toBeDefined()
    expect(result!.mode).toBe('bash')
    expect(result!.text).toBe('ls -la')
    expect(getCommandQueue()).toHaveLength(0)
  })

  test('joins selected text with live draft and cursor', () => {
    enqueue({ value: 'queued', mode: 'prompt' } as any)
    const result = popEditableAt(0, 'draft', 5)
    expect(result!.text).toBe('queued\ndraft')
    expect(result!.cursorOffset).toBe('queued'.length + 1 + 5)
    expect(result!.mode).toBe('prompt')
  })

  test('stale index returns undefined and leaves queue', () => {
    enqueue({ value: 'only', mode: 'prompt' } as any)
    expect(popEditableAt(3, '', 0)).toBeUndefined()
    expect(getCommandQueue()).toHaveLength(1)
  })

  test('pops only the indexed entry (popOne leftover)', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    enqueue({ value: 'b', mode: 'prompt' } as any)
    enqueue({ value: 'c', mode: 'prompt' } as any)
    const result = popEditableAt(1, '', 0)
    expect(result!.text).toBe('b')
    expect(getCommandQueue().map(cmd => cmd.value)).toEqual(['a', 'c'])
  })
})

describe('queueEditIndexAfterHistoryUp densable 2.1.234 #20 LI', () => {
  test('null + editables → last editable, no history', () => {
    expect(queueEditIndexAfterHistoryUp(null, 3)).toEqual({
      queueEditIndex: 2,
      historyUp: false,
    })
  })

  test('decrements while above 0', () => {
    expect(queueEditIndexAfterHistoryUp(2, 3)).toEqual({
      queueEditIndex: 1,
      historyUp: false,
    })
  })

  test('0 clears then history-up', () => {
    expect(queueEditIndexAfterHistoryUp(0, 3)).toEqual({
      queueEditIndex: null,
      historyUp: true,
    })
  })

  test('null + empty queue → history-up', () => {
    expect(queueEditIndexAfterHistoryUp(null, 0)).toEqual({
      queueEditIndex: null,
      historyUp: true,
    })
  })
})

describe('queueEditIndexAfterHistoryDown densable 2.1.234 #20 na', () => {
  test('null is not consumed (footer/history owns ↓)', () => {
    expect(queueEditIndexAfterHistoryDown(null, 3)).toEqual({
      queueEditIndex: null,
      consumed: false,
    })
  })

  test('increments until last editable', () => {
    expect(queueEditIndexAfterHistoryDown(0, 3)).toEqual({
      queueEditIndex: 1,
      consumed: true,
    })
  })

  test('last editable clears and consumes', () => {
    expect(queueEditIndexAfterHistoryDown(2, 3)).toEqual({
      queueEditIndex: null,
      consumed: true,
    })
  })
})

describe('clampQueueEditIndex densable 2.1.234 #20', () => {
  test('null stays null', () => {
    expect(clampQueueEditIndex(null, 2)).toBeNull()
  })

  test('empty editables clear', () => {
    expect(clampQueueEditIndex(1, 0)).toBeNull()
  })

  test('overflow clamps to last', () => {
    expect(clampQueueEditIndex(5, 3)).toBe(2)
  })

  test('in-range stays', () => {
    expect(clampQueueEditIndex(1, 3)).toBe(1)
  })
})
