/**
 * densable credentialsStoreFor (X / nxb @209466008).
 * Official: v() && storageV5 !== undefined → wrap secure storage.
 * Credential bytes stay on .credentials.json / keychain — V5 only gates.
 */

import { getSecureStorage } from '../secureStorage/index.js'
import type { SecureStorage } from '../secureStorage/types.js'
import { isHoverRestOn } from './hoverRestPin.js'

export const CREDENTIALS_STORE_HANDLE = Symbol(
  'secureStorage.CredentialsStoreHandle',
)

export type CredentialsStoreHandle = SecureStorage & {
  [CREDENTIALS_STORE_HANDLE]: 'CredentialsStoreHandle'
}

/**
 * densable G / tryCreateCredentialsStore.
 */
export function tryCreateCredentialsStore(
  backend: SecureStorage = getSecureStorage(),
): CredentialsStoreHandle {
  return {
    ...backend,
    [CREDENTIALS_STORE_HANDLE]: 'CredentialsStoreHandle',
  }
}

/**
 * densable X / credentialsStoreFor.
 */
export function credentialsStoreFor(
  storageV5: unknown,
  backend: SecureStorage = getSecureStorage(),
): CredentialsStoreHandle | undefined {
  return isHoverRestOn() && storageV5 !== undefined
    ? tryCreateCredentialsStore(backend)
    : undefined
}

/**
 * densable ce / sessionServicesFor.
 */
export function sessionServicesFor(storageV5: unknown): {
  storageV5: unknown
  credentials: CredentialsStoreHandle | undefined
} {
  return {
    storageV5,
    credentials: credentialsStoreFor(storageV5),
  }
}

let lastCredentials: CredentialsStoreHandle | undefined

export function pinCredentialsStore(
  store: CredentialsStoreHandle | undefined,
): void {
  lastCredentials = store
}

export function getPinnedCredentials(): CredentialsStoreHandle | undefined {
  return lastCredentials
}

export function resetPinnedCredentialsForTests(): void {
  lastCredentials = undefined
}
