import { describe, expect, test } from 'bun:test'
import { toAgentId } from '../../types/ids.js'
import { validateUuid, createAgentId } from '../uuid'

describe('validateUuid', () => {
  test('validates correct UUID', () => {
    const result = validateUuid('550e8400-e29b-41d4-a716-446655440000')
    expect(result).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  test('validates uppercase UUID', () => {
    const result = validateUuid('550E8400-E29B-41D4-A716-446655440000')
    expect(result).toBe('550E8400-E29B-41D4-A716-446655440000')
  })

  test('returns null for non-string', () => {
    expect(validateUuid(123)).toBeNull()
    expect(validateUuid(null)).toBeNull()
    expect(validateUuid(undefined)).toBeNull()
  })

  test('returns null for invalid UUID format', () => {
    expect(validateUuid('not-a-uuid')).toBeNull()
    expect(validateUuid('550e8400-e29b-41d4-a716')).toBeNull()
    expect(validateUuid('550e8400e29b41d4a716446655440000')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(validateUuid('')).toBeNull()
  })

  test('returns null for UUID with invalid chars', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716-44665544000g')).toBeNull()
  })

  test('returns null for UUID with leading/trailing whitespace', () => {
    expect(validateUuid(' 550e8400-e29b-41d4-a716-446655440000')).toBeNull()
    expect(validateUuid('550e8400-e29b-41d4-a716-446655440000 ')).toBeNull()
  })
})

describe('createAgentId', () => {
  test('generates id without label in correct format', () => {
    const id = createAgentId()
    expect(id).toMatch(/^a[0-9a-f]{16}$/)
  })

  test('generates id with label in correct format', () => {
    const id = createAgentId('compact')
    expect(id).toMatch(/^acompact-[0-9a-f]{16}$/)
  })

  test('densable Lg keeps hyphens in an already-ok label', () => {
    const id = createAgentId('fix-the-flaky')
    expect(id).toMatch(/^afix-the-flaky-[0-9a-f]{16}$/)
  })

  test('densable Lg strips non-word except hyphen, slices 63', () => {
    const id = createAgentId('hello world!!!')
    expect(id).toMatch(/^ahelloworld-[0-9a-f]{16}$/)
    const long = createAgentId('a'.repeat(80))
    expect(long).toMatch(new RegExp(`^a${'a'.repeat(63)}-[0-9a-f]{16}$`))
  })

  test('empty label is unlabeled', () => {
    expect(createAgentId('')).toMatch(/^a[0-9a-f]{16}$/)
  })
})

describe('toAgentId (densable OA)', () => {
  test('accepts unlabeled and hyphen-label ids', () => {
    expect(toAgentId(createAgentId())).not.toBeNull()
    expect(toAgentId(createAgentId('fix-the-flaky'))).not.toBeNull()
  })

  test('rejects dots and teammate names', () => {
    expect(toAgentId(`afoo.bar-${'0'.repeat(16)}`)).toBeNull()
    expect(toAgentId('researcher')).toBeNull()
  })
})
