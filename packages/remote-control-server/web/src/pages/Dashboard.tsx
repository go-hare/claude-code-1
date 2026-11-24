import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetchAllSessions, apiFetchEnvironments } from '../api/client';
import type { Session, Environment } from '../types';
import { EnvironmentList } from '../components/EnvironmentList';
import { SessionList } from '../components/SessionList';
import { NewSessionDialog } from '../components/NewSessionDialog';

interface DashboardProps {
  onNavigateSession: (sessionId: string) => void;
}

export function Dashboard({ onNavigateSession }: DashboardProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const mountedRef = useRef(true);

  const loadDashboard = useCallback(async () => {
    const [sessResult, envsResult] = await Promise.allSettled([apiFetchAllSessions(), apiFetchEnvironments()]);
    if (!mountedRef.current) return;

    const errors: string[] = [];
    if (sessResult.status === 'fulfilled') {
      setSessions(sessResult.value || []);
    } else {
      const msg = sessResult.reason instanceof Error ? sessResult.reason.message : 'Failed to load sessions';
      errors.push(msg);
    }

    if (envsResult.status === 'fulfilled') {
      setEnvironments(envsResult.value || []);
    } else {
      const msg = envsResult.reason instanceof Error ? envsResult.reason.message : 'Failed to load environments';
      errors.push(msg);
    }

    setLoadError(errors.length > 0 ? errors.join('; ') : null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadDashboard();
    const interval = setInterval(loadDashboard, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [loadDashboard]);

  const handleSessionCreated = (session: Session) => {
    setDialogOpen(false);
    onNavigateSession(session.id);
  };

  const handleSelectEnvironment = useCallback((_env: Environment) => {
    // ACP agents require WebSocket connection and cannot be navigated to directly
    // Bridge environments: no direct navigation (sessions are listed below)
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onNavigateSession(sessionId);
    },
    [onNavigateSession],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="sr-only">Dashboard</h1>
      {loadError && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="ml-4 rounded-md border border-status-error/30 px-2.5 py-1 text-xs font-medium hover:bg-status-error/15 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      {/* Environments */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-lg font-semibold text-text-primary">Environments</h2>
        <EnvironmentList environments={environments} onSelectEnvironment={handleSelectEnvironment} />
      </section>

      {/* Sessions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-text-primary">Sessions</h2>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-light transition-colors"
          >
            + New Session
          </button>
        </div>
        <SessionList sessions={sessions} onSelect={handleSelectSession} />
      </section>

      <NewSessionDialog
        open={dialogOpen}
        environments={environments}
        onClose={() => setDialogOpen(false)}
        onCreated={handleSessionCreated}
      />
    </div>
  );
}
