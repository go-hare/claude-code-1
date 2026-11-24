import { useState, useEffect, useRef, useCallback } from 'react';
import { ACPClient, DisconnectRequestedError } from '../acp/client';
import type { ConnectionState } from '../acp/types';
import { ACPMain } from '../../components/ACPMain';

interface ACPDirectViewProps {
  url: string;
  token: string;
  onBack: () => void;
}

export function ACPDirectView({ url, token, onBack }: ACPDirectViewProps) {
  const [client, setClient] = useState<ACPClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const clientRef = useRef<ACPClient | null>(null);

  useEffect(() => {
    const acpClient = new ACPClient({ proxyUrl: url, token });

    acpClient.setConnectionStateHandler((state, err) => {
      setConnectionState(state);
      if (err) {
        setError(err);
      } else if (state === 'connected' || state === 'connecting') {
        setError(null);
      }
    });

    clientRef.current = acpClient;
    setClient(acpClient);
    setConnectionState('connecting');
    setError(null);

    acpClient.connect().catch(e => {
      if (e instanceof DisconnectRequestedError) return;
      setError((e as Error).message);
      setConnectionState('error');
    });

    return () => {
      acpClient.disconnect();
      clientRef.current = null;
      setClient(null);
      setConnectionState('disconnected');
    };
  }, [url, token, retryCount]);

  const handleRetry = useCallback(() => {
    setRetryCount(c => c + 1);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {connectionState === 'connecting' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-2 border-brand border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-text-muted text-sm">Connecting to ACP agent...</p>
          </div>
        </div>
      )}

      {(connectionState === 'error' || connectionState === 'disconnected') && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-md space-y-3">
            <p className="font-medium text-text-primary">
              {connectionState === 'error' ? 'Connection Failed' : 'Disconnected from ACP Agent'}
            </p>
            {error && <p className="text-status-error text-sm">{error}</p>}
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-light transition-colors"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onBack}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2 transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {client && connectionState === 'connected' && <ACPMain client={client} />}
    </div>
  );
}
