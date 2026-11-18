import { describe, expect, test } from 'bun:test'
import { createFallbackStorage } from '../fallbackStorage.js'
import type { SecureStorage, SecureStorageData } from '../types.js'

describe('v2.1.290 #120: fallbackStorage transient & fallbackWritten', () => {
  test('skips fallback when primary returns transient: true (e.g. locked keychain)', () => {
    let secondaryUpdated = false
    const primary: SecureStorage = {
      name: 'keychain',
      read: () => ({ old: true }),
      readAsync: async () => ({ old: true }),
      update: () => ({ success: false, transient: true, keychainLocked: true }),
      delete: () => false,
    }
    const secondary: SecureStorage = {
      name: 'plaintext',
      read: () => null,
      readAsync: async () => null,
      update: () => {
        secondaryUpdated = true
        return { success: true }
      },
      delete: () => true,
    }
    const storage = createFallbackStorage(primary, secondary)
    const res = storage.update({ fresh: true } as SecureStorageData)
    expect(res).toEqual({
      success: false,
      transient: true,
      keychainLocked: true,
    })
    expect(secondaryUpdated).toBe(false)
  })

  test('returns transient:true + fallbackWritten:true when primary had data, fallback wrote, and primary.delete() failed', () => {
    let invalidated = false
    const primary: SecureStorage = {
      name: 'keychain',
      read: () => ({ old: true }),
      readAsync: async () => ({ old: true }),
      update: () => ({ success: false, exitCode: 1 }),
      delete: () => false,
      invalidateCache: () => {
        invalidated = true
      },
    }
    const secondary: SecureStorage = {
      name: 'plaintext',
      read: () => null,
      readAsync: async () => null,
      update: () => ({ success: true, warning: 'plaintext warning' }),
      delete: () => true,
    }
    const storage = createFallbackStorage(primary, secondary)
    const res = storage.update({ fresh: true } as SecureStorageData)
    expect(res).toEqual({
      success: false,
      transient: true,
      fallbackWritten: true,
    })
    expect(invalidated).toBe(false)
  })

  test('returns success:true + invalidates primary cache when primary.delete() succeeds after fallback write', () => {
    let invalidated = false
    const primary: SecureStorage = {
      name: 'keychain',
      read: () => ({ old: true }),
      readAsync: async () => ({ old: true }),
      update: () => ({ success: false, exitCode: 1 }),
      delete: () => true,
      invalidateCache: () => {
        invalidated = true
      },
    }
    const secondary: SecureStorage = {
      name: 'plaintext',
      read: () => null,
      readAsync: async () => null,
      update: () => ({ success: true, warning: 'plaintext warning' }),
      delete: () => true,
    }
    const storage = createFallbackStorage(primary, secondary)
    const res = storage.update({ fresh: true } as SecureStorageData)
    expect(res).toEqual({ success: true, warning: 'plaintext warning' })
    expect(invalidated).toBe(true)
  })
})
