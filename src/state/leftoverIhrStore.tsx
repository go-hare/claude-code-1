import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box } from '@anthropic/ink';
import { getSessionId } from '../bootstrap/state.js';
import { leftoverZxt } from '../components/Spinner/leftoverZxt.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  leftoverHhr,
  leftoverIhrGet,
  leftoverIhrReleaseStore,
  leftoverIhrRequireStore,
  leftoverIhrRetainStore,
  leftoverIhrStartXe,
  leftoverIhrSubscribe,
  type LeftoverIhrSlice,
} from '../utils/collapseReadSearch.js';

const LeftoverIhrStoreContext = createContext(false);

type Props = { children: React.ReactNode };

/**
 * densable `GMn.Provider` — Ihr store is mounted by AppStateProvider.
 * Gold `Xae()` throws outside this provider.
 */
export function LeftoverIhrStoreProvider({ children }: Props): React.ReactNode {
  // Children read the store during this same render, before effects run.
  const retained = useRef(false);
  if (!retained.current) {
    retained.current = true;
    leftoverIhrRetainStore();
  }
  leftoverIhrStartXe();
  useEffect(() => {
    if (!retained.current) {
      retained.current = true;
      leftoverIhrRetainStore();
    }
    leftoverIhrStartXe();
    return () => {
      retained.current = false;
      leftoverIhrReleaseStore();
    };
  }, []);
  return <LeftoverIhrStoreContext.Provider value={true}>{children}</LeftoverIhrStoreContext.Provider>;
}

/** densable `Xae()`. */
export function useLeftoverIhrStore(): true {
  const mounted = useContext(LeftoverIhrStoreContext);
  if (!mounted) leftoverIhrRequireStore();
  leftoverIhrRequireStore();
  return true;
}

/** densable `Hhr(e)` via Xae — React `ke(GMn)` then module throw. */
export function leftoverIhrThinkingStartedAt(sessionId: string): number | null {
  leftoverIhrRequireStore();
  return leftoverHhr(sessionId);
}

/** densable `Ohr`. */
export function leftoverIhrSlice(sessionId: string): LeftoverIhrSlice {
  leftoverIhrRequireStore();
  return leftoverIhrGet(sessionId);
}

export { leftoverIhrSubscribe };

/** densable `dJ` / `Mhr(v)` — retry row when store retryStatus is set. */
export function LeftoverMhrRetryRow({ agentId }: { agentId?: string }): React.ReactNode {
  useLeftoverIhrStore();
  const session = agentId ?? getSessionId();
  const retry = useSyncExternalStore(
    leftoverIhrSubscribe,
    () => leftoverIhrGet(session).retryStatus,
    () => leftoverIhrGet(session).retryStatus,
  );
  const { columns } = useTerminalSize();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (retry == null) return;
    const timer = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [retry]);
  if (retry == null) return null;
  return (
    <Box flexDirection="row" marginTop={1} width="100%">
      {leftoverZxt({ status: retry, columns })}
    </Box>
  );
}
