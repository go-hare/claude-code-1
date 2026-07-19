import { describe, expect, test } from 'bun:test'
import {
  HISTORY_SEARCH_SCOPES,
  isHistorySearchScope,
  nextHistorySearchScope,
} from '../history.js'

describe('HISTORY_SEARCH_SCOPES (densable vmo)', () => {
  test('order is session → project → everywhere', () => {
    expect(HISTORY_SEARCH_SCOPES).toEqual(['session', 'project', 'everywhere'])
  })
})

describe('nextHistorySearchScope (densable cycleScope)', () => {
  test('cycles session → project → everywhere → session', () => {
    expect(nextHistorySearchScope('session')).toBe('project')
    expect(nextHistorySearchScope('project')).toBe('everywhere')
    expect(nextHistorySearchScope('everywhere')).toBe('session')
  })
})

describe('isHistorySearchScope', () => {
  test('accepts known scopes', () => {
    expect(isHistorySearchScope('session')).toBe(true)
    expect(isHistorySearchScope('project')).toBe(true)
    expect(isHistorySearchScope('everywhere')).toBe(true)
  })
  test('rejects unknown', () => {
    expect(isHistorySearchScope('global')).toBe(false)
    expect(isHistorySearchScope('')).toBe(false)
  })
})
