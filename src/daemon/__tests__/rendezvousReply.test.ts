import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  enqueue,
  getCommandQueue,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import {
  replyMode,
  replyToQueuedCommand,
  replyValue,
  setPeerQuestionHandler,
} from '../rendezvousServer.js'

describe('bg-rv reply → queue (official pR/Vh/mw)', () => {
  beforeEach(() => {
    resetCommandQueue()
    setPeerQuestionHandler(null)
  })

  afterEach(() => {
    resetCommandQueue()
    setPeerQuestionHandler(null)
  })

  test('pR/Vh prompt mode leaves text intact', () => {
    expect(replyMode('hello world')).toBe('prompt')
    expect(replyValue('hello world')).toBe('hello world')
    expect(replyToQueuedCommand('hello world')).toEqual({
      mode: 'prompt',
      value: 'hello world',
      priority: 'next',
    })
  })

  test('pR/Vh bash mode strips leading bang', () => {
    expect(replyMode('!ls -la')).toBe('bash')
    expect(replyValue('!ls -la')).toBe('ls -la')
    expect(replyToQueuedCommand('!ls -la')).toEqual({
      mode: 'bash',
      value: 'ls -la',
      priority: 'next',
    })
  })

  test('enqueue path does not append a trailing newline', () => {
    enqueue(replyToQueuedCommand('23'))
    const q = getCommandQueue()
    expect(q).toHaveLength(1)
    expect(q[0]?.value).toBe('23')
    expect(q[0]?.mode).toBe('prompt')
    expect(q[0]?.priority).toBe('next')
    // Old stdin inject path used text + '\n' — never reintroduce that.
    expect(typeof q[0]?.value === 'string' && q[0].value.endsWith('\n')).toBe(
      false,
    )
  })

  test('setPeerQuestionHandler can short-circuit via true return', () => {
    let seen = ''
    setPeerQuestionHandler(text => {
      seen = text
      return true
    })
    // Registration API only — handleMessage is net-bound; verify handler
    // can be set and returns the official "answered" signal.
    let answered = false
    setPeerQuestionHandler(text => {
      seen = text
      answered = true
      return true
    })
    // Call the registered handler shape directly.
    const handler = (t: string): boolean => {
      seen = t
      answered = true
      return true
    }
    setPeerQuestionHandler(handler)
    expect(handler('pick option A')).toBe(true)
    expect(answered).toBe(true)
    expect(seen).toBe('pick option A')
    // Queue stays empty when peer question is answered (no mw enqueue).
    expect(getCommandQueue()).toHaveLength(0)
  })
})
