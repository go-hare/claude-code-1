import React, { createContext, useContext, useMemo } from 'react';
import { type CredentialsStoreHandle, sessionServicesFor } from '../utils/storageV5/credentialsStore.js';

/**
 * densable `z` / `jdb` Provider value. Official default is `Object.freeze({})`.
 * `We()` ≢ `getPinnedStorageV5` / `getPinnedCredentials`.
 */
export type SessionServices = {
  storageV5?: unknown;
  credentials?: CredentialsStoreHandle;
};

const emptySessionServices: SessionServices = Object.freeze({});

const SessionServicesContext = createContext<SessionServices>(emptySessionServices);

const cachedCredentialsByStorage = new WeakMap<object, CredentialsStoreHandle>();

type SessionServicesProviderProps = SessionServices & {
  children: React.ReactNode;
};

/** densable `z` / `jdb`. */
export function SessionServicesProvider({
  storageV5,
  credentials,
  children,
}: SessionServicesProviderProps): React.ReactNode {
  const value = useMemo(
    () => (storageV5 === undefined && credentials === undefined ? emptySessionServices : { storageV5, credentials }),
    [storageV5, credentials],
  );
  return <SessionServicesContext.Provider value={value}>{children}</SessionServicesContext.Provider>;
}

/** densable `We` / `b` / `kdb`. */
export function useSessionServices(): SessionServices {
  return useContext(SessionServicesContext);
}

function getStableSessionServices(storageV5: unknown): SessionServices {
  const resolved = sessionServicesFor(storageV5);
  if (resolved.credentials !== undefined && typeof storageV5 === 'object' && storageV5 !== null) {
    const cached = cachedCredentialsByStorage.get(storageV5);
    if (cached !== undefined) {
      return { storageV5: resolved.storageV5, credentials: cached };
    }
    cachedCredentialsByStorage.set(storageV5, resolved.credentials);
  }
  return resolved;
}

/**
 * densable `Us` tail: `if (hr === undefined) return children; else
 * Provider({...ce(hr), children})`.
 */
export function wrapWithSessionServices(children: React.ReactNode, storageV5: unknown): React.ReactNode {
  if (storageV5 === undefined) return children;
  return <SessionServicesProvider {...getStableSessionServices(storageV5)}>{children}</SessionServicesProvider>;
}
