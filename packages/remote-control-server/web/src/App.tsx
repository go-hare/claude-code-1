import { useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { IdentityPanel } from './components/IdentityPanel';
import { TokenManagerDialog } from './components/TokenManagerDialog';
import { ThemeProvider } from './lib/theme';
import { getUuid, setUuid, apiBind, setActiveApiToken } from './api/client';
import { ACPDirectView } from './components/ACPDirectView';
import { useTokens } from './hooks/useTokens';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const SessionDetail = lazy(() => import('./pages/SessionDetail').then(m => ({ default: m.SessionDetail })));

export interface RouteHandlers {
  getUuid: () => string;
  setUuid: (uuid: string) => void;
  syncDefaultUuid: () => void;
  apiBind: (sid: string) => Promise<void>;
  setAcpDirect: (val: { url: string; token: string } | null) => void;
  setCurrentSessionId: (sid: string | null) => void;
  setSessionMeta: (meta: { title?: string; isAcp: boolean } | null) => void;
  setBindingSession: (binding: boolean) => void;
}

export function createRouteController(
  handlers: RouteHandlers,
  refs: {
    bindSeqRef: { current: number };
    initialRouteParsedRef: { current: boolean };
  },
) {
  const parseRoute = () => {
    // Ensure valid UUID exists
    handlers.getUuid();

    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    // Check for UUID import from QR scan (?uuid=xxx)
    const importUuid = params.get('uuid');
    if (importUuid) {
      handlers.setUuid(importUuid);
      handlers.syncDefaultUuid();
      const url = new URL(window.location.href);
      url.searchParams.delete('uuid');
      window.history.replaceState(null, '', url);
    }

    // Check for ACP direct connection (?acp=1)
    const acpParam = params.get('acp');
    if (acpParam === '1') {
      let stored: string | null = null;
      try {
        stored = sessionStorage.getItem('acp_connection');
      } catch {
        // ignore storage errors
      }
      if (stored) {
        try {
          const acpData = JSON.parse(stored);
          if (acpData.url && acpData.token) {
            handlers.setAcpDirect({ url: acpData.url, token: acpData.token });
            handlers.setCurrentSessionId(null);
            handlers.setSessionMeta(null);
            handlers.setBindingSession(false);
            try {
              sessionStorage.removeItem('acp_connection');
            } catch {
              // ignore storage errors
            }
            const url = new URL(window.location.href);
            url.searchParams.delete('acp');
            window.history.replaceState(null, '', url);
            return;
          }
        } catch {
          try {
            sessionStorage.removeItem('acp_connection');
          } catch {
            // ignore storage errors
          }
        }
      }
    }

    // Clear stale ACP direct view when navigating away (e.g. browser back/popstate)
    handlers.setAcpDirect(null);

    // Check for CLI session bind (?sid=xxx) — await bind BEFORE mounting SessionDetail
    const sid = params.get('sid');
    if (sid) {
      const url = new URL(window.location.href);
      url.searchParams.delete('sid');
      window.history.replaceState(null, '', `/code/${sid}`);
      const seq = ++refs.bindSeqRef.current;
      handlers.setBindingSession(true);
      handlers.setCurrentSessionId(null);
      handlers.setSessionMeta(null);
      handlers
        .apiBind(sid)
        .catch((err: unknown) => {
          console.warn('Failed to bind session:', err);
        })
        .finally(() => {
          if (refs.bindSeqRef.current !== seq) return;
          handlers.setBindingSession(false);
          handlers.setCurrentSessionId(sid);
        });
      return;
    }

    // Cancel any in-flight ?sid= bind if user navigated elsewhere
    refs.bindSeqRef.current += 1;
    handlers.setBindingSession(false);

    // Path-based routing: /code/session_xxx → session detail
    const match = path.match(/^\/code\/([^/]+)/);
    if (match && match[1]) {
      handlers.setCurrentSessionId(match[1]);
      handlers.setSessionMeta(null);
    } else {
      handlers.setCurrentSessionId(null);
      handlers.setSessionMeta(null);
    }
  };

  const attachRouteEffect = () => {
    // Only consume initial URL query parameters (?uuid= / ?acp=1 / ?sid=) once so
    // React StrictMode double-effect invocation never wipes acpDirect or cancels apiBind.
    if (!refs.initialRouteParsedRef.current) {
      refs.initialRouteParsedRef.current = true;
      parseRoute();
    }
    window.addEventListener('popstate', parseRoute);
    return () => window.removeEventListener('popstate', parseRoute);
  };

  return { parseRoute, attachRouteEffect };
}

export default function App() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionMeta, setSessionMeta] = useState<{ title?: string; isAcp: boolean } | null>(null);
  const [bindingSession, setBindingSession] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [acpDirect, setAcpDirect] = useState<{ url: string; token: string } | null>(null);
  const [uuidVersion, setUuidVersion] = useState(0);
  const bindSeqRef = useRef(0);
  const initialRouteParsedRef = useRef(false);

  const {
    tokens,
    activeTokenId,
    activeLabel,
    activeTokenValue,
    setActiveTokenId,
    addToken,
    removeToken,
    updateToken,
    syncDefaultUuid,
  } = useTokens();

  // Sync active token to API client before child effects run
  useLayoutEffect(() => {
    setActiveApiToken(activeTokenValue);
  }, [activeTokenValue]);

  const handleSetActiveToken = useCallback(
    (id: string) => {
      setActiveTokenId(id);
    },
    [setActiveTokenId],
  );

  const handleUuidImported = useCallback(() => {
    setActiveApiToken(activeTokenValue);
    syncDefaultUuid();
    setUuidVersion(v => v + 1);
  }, [activeTokenValue, syncDefaultUuid]);

  useEffect(() => {
    const controller = createRouteController(
      {
        getUuid,
        setUuid,
        syncDefaultUuid,
        apiBind,
        setAcpDirect,
        setCurrentSessionId,
        setSessionMeta,
        setBindingSession,
      },
      { bindSeqRef, initialRouteParsedRef },
    );
    return controller.attachRouteEffect();
  }, [syncDefaultUuid]);

  const navigateToSession = useCallback((sessionId: string) => {
    bindSeqRef.current += 1;
    setBindingSession(false);
    setAcpDirect(null);
    setSessionMeta(null);
    window.history.pushState(null, '', `/code/${sessionId}`);
    setCurrentSessionId(sessionId);
  }, []);

  const navigateToDashboard = useCallback(() => {
    bindSeqRef.current += 1;
    setBindingSession(false);
    window.history.pushState(null, '', '/code/');
    setCurrentSessionId(null);
    setSessionMeta(null);
    setAcpDirect(null);
  }, []);

  const isAcpSession = Boolean(acpDirect) || Boolean(sessionMeta?.isAcp);
  const navbarSessionTitle = acpDirect ? 'ACP' : currentSessionId ? sessionMeta?.title || currentSessionId : undefined;

  return (
    <ThemeProvider defaultTheme="system">
      <div className="flex h-screen flex-col bg-surface-0 text-text-primary">
        <Navbar
          onIdentityClick={() => setIdentityOpen(true)}
          onTokenClick={() => setTokenDialogOpen(true)}
          activeTokenLabel={currentSessionId ? undefined : activeLabel}
          sessionTitle={navbarSessionTitle}
          isAcp={isAcpSession}
          onBack={currentSessionId || acpDirect ? navigateToDashboard : undefined}
        />

        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-text-muted">Loading...</div>}>
          {acpDirect ? (
            <ACPDirectView url={acpDirect.url} token={acpDirect.token} onBack={navigateToDashboard} />
          ) : bindingSession ? (
            <div className="flex flex-1 items-center justify-center text-text-muted">Binding session...</div>
          ) : currentSessionId ? (
            <SessionDetail
              key={`${currentSessionId}-${uuidVersion}`}
              sessionId={currentSessionId}
              onBack={navigateToDashboard}
              onSessionMetaChange={setSessionMeta}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <Dashboard key={uuidVersion} onNavigateSession={navigateToSession} />
            </div>
          )}
        </Suspense>

        <IdentityPanel open={identityOpen} onClose={() => setIdentityOpen(false)} onUuidImported={handleUuidImported} />

        <TokenManagerDialog
          open={tokenDialogOpen}
          onClose={() => setTokenDialogOpen(false)}
          tokens={tokens}
          activeTokenId={activeTokenId}
          onSetActive={handleSetActiveToken}
          onAdd={addToken}
          onRemove={removeToken}
          onUpdate={updateToken}
        />
      </div>
    </ThemeProvider>
  );
}
