import { createFallbackStorage } from './fallbackStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import { plainTextStorage } from './plainTextStorage.js'
import type { SecureStorage } from './types.js'
export {
  McpCredentialStoreUnavailableError,
  SECURE_STORAGE_READ_FAILED,
  type ReadAsyncStrictOptions,
  type SecureStorage,
  type SecureStorageData,
  type SecureStorageReadFailed,
  type SecureStorageUpdateResult,
} from './types.js'

/**
 * Get the appropriate secure storage implementation for the current platform
 */
export function getSecureStorage(): SecureStorage {
  if (process.platform === 'darwin') {
    return createFallbackStorage(macOsKeychainStorage, plainTextStorage)
  }

  // TODO: add libsecret support for Linux

  return plainTextStorage
}
