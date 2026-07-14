/**
 * Official 2.1.x: SessionStart reloadSkills + sessionTitle; UPS suppressOriginalPrompt.
 * Pure classification mirrors (no process-global mock.module).
 */
import { describe, expect, test } from 'bun:test'

type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'

function shouldCacheSessionTitle(
  source: SessionStartSource,
  title: string | undefined,
): boolean {
  if (!title?.trim()) return false
  return source === 'startup' || source === 'resume'
}

function blockMessage(
  blockingMessage: string,
  originalPrompt: string,
  suppressOriginalPrompt: boolean,
): string {
  return suppressOriginalPrompt
    ? blockingMessage
    : `${blockingMessage}\n\nOriginal prompt: ${originalPrompt}`
}

function shouldReloadSkills(flags: boolean[]): boolean {
  return flags.some(Boolean)
}

describe('SessionStart sessionTitle cache gate', () => {
  test('startup and resume cache non-empty titles', () => {
    expect(shouldCacheSessionTitle('startup', 'My session')).toBe(true)
    expect(shouldCacheSessionTitle('resume', 'My session')).toBe(true)
  })

  test('clear/compact do not cache', () => {
    expect(shouldCacheSessionTitle('clear', 'My session')).toBe(false)
    expect(shouldCacheSessionTitle('compact', 'My session')).toBe(false)
  })

  test('empty title never caches', () => {
    expect(shouldCacheSessionTitle('startup', '')).toBe(false)
    expect(shouldCacheSessionTitle('startup', '   ')).toBe(false)
    expect(shouldCacheSessionTitle('startup', undefined)).toBe(false)
  })
})

describe('SessionStart reloadSkills aggregation', () => {
  test('any true reloads', () => {
    expect(shouldReloadSkills([false, true, false])).toBe(true)
    expect(shouldReloadSkills([false, false])).toBe(false)
  })
})

describe('UserPromptSubmit suppressOriginalPrompt', () => {
  test('default includes original prompt', () => {
    expect(blockMessage('blocked', 'hello world', false)).toBe(
      'blocked\n\nOriginal prompt: hello world',
    )
  })

  test('suppress omits original prompt', () => {
    expect(blockMessage('blocked', 'hello world', true)).toBe('blocked')
  })
})
