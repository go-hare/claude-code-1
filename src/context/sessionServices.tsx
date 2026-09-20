import React, { createContext, useContext } from 'react';
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

type SessionServicesProviderProps = SessionServices & {
  children: React.ReactNode;
};

/** densable `z` / `jdb`. */
export function SessionServicesProvider({
  storageV5,
  credentials,
  children,
}: SessionServicesProviderProps): React.ReactNode {
  const value =
    storageV5 === undefined && credentials === undefined ? emptySessionServices : { storageV5, credentials };
  return <SessionServicesContext.Provider value={value}>{children}</SessionServicesContext.Provider>;
}

/** densable `We` / `b` / `kdb`. */
export function useSessionServices(): SessionServices {
  return useContext(SessionServicesContext);
}

/**
 * densable `Us` tail: `if (hr === undefined) return children; else
 * Provider({...ce(hr), children})`.
 */
export function wrapWithSessionServices(children: React.ReactNode, storageV5: unknown): React.ReactNode {
  if (storageV5 === undefined) return children;
  return <SessionServicesProvider {...sessionServicesFor(storageV5)}>{children}</SessionServicesProvider>;
}
