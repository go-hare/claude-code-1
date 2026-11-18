import {
  SECURE_STORAGE_READ_FAILED,
  type ReadAsyncStrictOptions,
  type SecureStorage,
  type SecureStorageData,
  type SecureStorageReadFailed,
  type SecureStorageUpdateResult,
} from './types.js'

/**
 * Creates a fallback storage that tries to use the primary storage first,
 * and if that fails, falls back to the secondary storage
 */
export function createFallbackStorage(
  primary: SecureStorage,
  secondary: SecureStorage,
): SecureStorage {
  return {
    name: `${primary.name}-with-${secondary.name}-fallback`,
    read(): SecureStorageData {
      const result = primary.read()
      if (result !== null && result !== undefined) {
        return result
      }
      return secondary.read() || {}
    },
    async readAsync(): Promise<SecureStorageData | null> {
      const result = await primary.readAsync()
      if (result !== null && result !== undefined) {
        return result
      }
      return (await secondary.readAsync()) || {}
    },
    async readAsyncStrict(
      key?: unknown,
      options?: ReadAsyncStrictOptions,
    ): Promise<SecureStorageData | null | SecureStorageReadFailed> {
      const primaryResult = await (primary.readAsyncStrict?.(
        undefined,
        options,
      ) ?? primary.readAsync())
      if (primaryResult === SECURE_STORAGE_READ_FAILED) {
        return SECURE_STORAGE_READ_FAILED
      }
      if (primaryResult !== null || options?.inaccessibleAs === 'failure') {
        return primaryResult
      }
      const secondaryResult = await (secondary.readAsyncStrict?.(
        key,
        options,
      ) ?? secondary.readAsync(key))
      return secondaryResult === SECURE_STORAGE_READ_FAILED
        ? secondaryResult
        : secondaryResult || {}
    },
    invalidateCache(): void {
      primary.invalidateCache?.()
      secondary.invalidateCache?.()
    },
    update(data: SecureStorageData): SecureStorageUpdateResult {
      // Capture state before update
      const primaryDataBefore = primary.read()

      const result = primary.update(data)

      if (result.success) {
        // Delete secondary when migrating to primary for the first time
        // This preserves credentials when sharing .claude between host and containers
        // See: https://github.com/anthropics/claude-code/issues/1414
        if (primaryDataBefore === null) {
          secondary.delete()
        }
        return result
      }

      if (result.transient) {
        return result
      }

      const fallbackResult = secondary.update(data)

      if (fallbackResult.success) {
        // Primary write failed but primary may still hold an *older* valid
        // entry. read() prefers primary whenever it returns non-null, so that
        // stale entry would shadow the fresh data we just wrote to secondary —
        // e.g. a refresh token the server has already rotated away, causing a
        // /login loop (#30337). If delete() fails, surface transient+fallbackWritten
        // so callers know the write landed in fallback while primary still holds
        // the older entry.
        if (primaryDataBefore !== null && !primary.delete()) {
          return {
            success: false,
            transient: true,
            fallbackWritten: true,
          }
        }
        primary.invalidateCache?.()
        return {
          success: true,
          warning: fallbackResult.warning,
        }
      }

      return { success: false }
    },
    delete(): boolean {
      const primarySuccess = primary.delete()
      const secondarySuccess = secondary.delete()

      return primarySuccess || secondarySuccess
    },
  }
}
