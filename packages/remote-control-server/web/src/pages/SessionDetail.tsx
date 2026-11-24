import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetchSession } from '../api/client';
import type { AutomationState, Session, SessionTaskItem } from '../types';
import { isClosedSessionStatus, isBusySessionStatus, formatTime } from '../lib/utils';
import { Info } from 'lucide-react';
import { RCSChatAdapter } from '../lib/rcs-chat-adapter';
import type { ThreadEntry, PendingPermission, ChatInputMessage } from '../lib/types';
import { StatusBadge } from '../components/Navbar';
import { TaskPanel } from '../components/TaskPanel';
import { PermissionPromptView, AskUserPanelView, PlanPanelView } from '../components/PermissionViews';

// Unified chat components
import { ChatView } from '../../components/chat/ChatView';
import { ChatInput } from '../../components/chat/ChatInput';
import { TooltipProvider } from '../../components/ui/tooltip';

// ACP chat components
import { ACPClient, DisconnectRequestedError } from '../acp/client';
import { createRelayClient } from '../acp/relay-client';
import { ACPMain } from '../../components/ACPMain';

interface SessionDetailProps {
  sessionId: string;
  onBack?: () => void;
  onSessionMetaChange?: (meta: { title?: string; isAcp: boolean } | null) => void;
}

function parseInitialAutomationState(raw: unknown): AutomationState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return null;
  return {
    enabled: obj.enabled,
    phase: obj.phase === 'standby' || obj.phase === 'sleeping' ? obj.phase : null,
    next_tick_at: typeof obj.next_tick_at === 'number' ? obj.next_tick_at : null,
    sleep_until: typeof obj.sleep_until === 'number' ? obj.sleep_until : null,
  };
}

export function SessionDetail({ sessionId, onBack, onSessionMetaChange }: SessionDetailProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [tasks, setTasks] = useState<SessionTaskItem[]>([]);
  const [automationState, setAutomationState] = useState<AutomationState | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);
  const mountedRef = useRef(true);
  const onSessionMetaChangeRef = useRef(onSessionMetaChange);
  onSessionMetaChangeRef.current = onSessionMetaChange;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Create per-session RCSChatAdapter
  const adapter = useMemo(
    () =>
      new RCSChatAdapter(sessionId, setEntries, {
        onStatusChange: status => {
          if (!mountedRef.current) return;
          // Official: session_status is source of truth for turn busy state.
          // Re-entering a running/requires_action session must restore loading UI.
          setSessionStatus(status);
          setIsLoading(isBusySessionStatus(status));
        },
        onError: err => {
          if (!mountedRef.current) return;
          console.error('[RCSChatAdapter] error:', err);
          setStreamError(err);
          setIsLoading(false);
        },
        onPermissionRequest: permission => {
          if (!mountedRef.current) return;
          setPendingPermissions(prev => {
            if (prev.some(p => p.requestId === permission.requestId)) return prev;
            return [...prev, permission];
          });
        },
        onPermissionResolved: requestId => {
          if (!mountedRef.current) return;
          setPendingPermissions(prev => prev.filter(p => p.requestId !== requestId));
        },
        onTasksChange: nextTasks => {
          if (!mountedRef.current) return;
          setTasks(nextTasks);
        },
        onAutomationStateChange: nextState => {
          if (!mountedRef.current) return;
          setAutomationState(nextState);
        },
        onConversationCleared: () => {
          if (!mountedRef.current) return;
          setPendingPermissions([]);
          setIsLoading(false);
        },
        onTurnComplete: () => {
          if (!mountedRef.current) return;
          setIsLoading(false);
        },
        onInterrupt: () => {
          if (!mountedRef.current) return;
          setPendingPermissions([]);
          setIsLoading(false);
        },
      }),
    [sessionId],
  );

  // Load session data and initialize adapter (skip SSE for ACP & closed sessions)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError('');
      setStreamError(null);
      setEntries([]);
      setPendingPermissions([]);
      setTasks([]);
      setAutomationState(null);
      setIsLoading(false);
      setSessionStatus(null);
      setSession(null);

      let loadedSession: Session;
      try {
        loadedSession = await apiFetchSession(sessionId);
        if (cancelled) return;
        setSession(loadedSession);
        setSessionStatus(loadedSession.status);
        setAutomationState(parseInitialAutomationState(loadedSession.automation_state));
        onSessionMetaChangeRef.current?.({
          title: loadedSession.title || loadedSession.id,
          isAcp: loadedSession.source === 'acp',
        });
        // Restore busy UI when opening an in-flight session (not only local submit).
        setIsLoading(isBusySessionStatus(loadedSession.status));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load session');
        return;
      }

      // ACP sessions use the WebSocket relay in ACPSessionDetail — do not open an RCS SSE stream
      if (loadedSession.source === 'acp' && loadedSession.environment_id) {
        return;
      }

      // Closed sessions still load history via REST, without opening a 409 SSE connection
      const shouldConnectSse = !isClosedSessionStatus(loadedSession.status);

      try {
        await adapter.init({ connectSse: shouldConnectSse });
      } catch (err) {
        if (cancelled) return;
        console.warn('Failed to init adapter:', err);
        setStreamError(err instanceof Error ? err.message : 'Failed to load session history');
      }
    }

    load();
    return () => {
      cancelled = true;
      adapter.disconnect();
    };
  }, [sessionId, adapter]);

  const closed = isClosedSessionStatus(sessionStatus);

  // Send message via ChatInput
  const handleSubmit = useCallback(
    async (message: ChatInputMessage) => {
      const text = message.text.trim();
      if (!text || closed) return;
      setStreamError(null);
      setIsLoading(true);
      try {
        await adapter.sendMessage(text, message.images);
      } catch (err) {
        console.error('Send failed:', err);
        setStreamError(err instanceof Error ? err.message : 'Failed to send message');
        setIsLoading(false);
      }
    },
    [adapter, closed],
  );

  // Interrupt
  const handleInterrupt = useCallback(async () => {
    try {
      await adapter.interrupt();
      setPendingPermissions([]);
    } catch (err) {
      console.error('Interrupt failed:', err);
      setStreamError(err instanceof Error ? err.message : 'Failed to interrupt session');
    } finally {
      setIsLoading(false);
    }
  }, [adapter]);

  // Fallback clear: history ended the turn but session_status lag/miss.
  // Never clear while official busy statuses say the turn is still open.
  useEffect(() => {
    if (isBusySessionStatus(sessionStatus)) return;
    if (entries.length === 0) return;
    const last = entries[entries.length - 1];
    if (last?.type === 'assistant_message' || last?.type === 'tool_call') {
      if (last.type === 'tool_call') {
        const st = last.toolCall.status;
        if (st === 'running' || st === 'waiting_for_confirmation') return;
      }
      setIsLoading(false);
    }
  }, [entries, sessionStatus]);

  // Permission actions — only dismiss prompt AFTER backend confirms receipt,
  // and always transition the matching ToolCallEntry via adapter.respondPermission().
  const handleApprovePermission = useCallback(
    async (requestId: string) => {
      setStreamError(null);
      try {
        await adapter.respondPermission(requestId, true);
        setPendingPermissions(prev => prev.filter(p => p.requestId !== requestId));
      } catch (err) {
        console.error('Failed to approve:', err);
        setStreamError(err instanceof Error ? err.message : 'Failed to approve permission');
      }
    },
    [adapter],
  );

  const handleRejectPermission = useCallback(
    async (requestId: string) => {
      setStreamError(null);
      try {
        await adapter.respondPermission(requestId, false);
        setPendingPermissions(prev => prev.filter(p => p.requestId !== requestId));
      } catch (err) {
        console.error('Failed to reject:', err);
        setStreamError(err instanceof Error ? err.message : 'Failed to reject permission');
      }
    },
    [adapter],
  );

  const handleSubmitAnswers = useCallback(
    async (requestId: string, answers: Record<string, unknown>, questions: import('../types').Question[]) => {
      setStreamError(null);
      try {
        await adapter.respondPermission(requestId, true, {
          updated_input: { questions, answers },
        });
        setPendingPermissions(prev => prev.filter(p => p.requestId !== requestId));
      } catch (err) {
        console.error('Failed to submit answers:', err);
        setStreamError(err instanceof Error ? err.message : 'Failed to submit answers');
      }
    },
    [adapter],
  );

  const handleSubmitPlanResponse = useCallback(
    async (requestId: string, value: string, feedback?: string) => {
      setStreamError(null);
      try {
        if (value === 'no') {
          await adapter.respondPermission(requestId, false, feedback ? { message: feedback } : undefined);
        } else {
          const modeMap: Record<string, string> = {
            'yes-accept-edits': 'acceptEdits',
            'yes-default': 'default',
          };
          await adapter.respondPermission(requestId, true, {
            updated_permissions: [{ type: 'setMode', mode: modeMap[value] || 'default', destination: 'session' }],
          });
        }
        setPendingPermissions(prev => prev.filter(p => p.requestId !== requestId));
      } catch (err) {
        console.error('Failed to submit plan response:', err);
        setStreamError(err instanceof Error ? err.message : 'Failed to submit plan response');
      }
    },
    [adapter],
  );

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-status-error">{error}</p>
          {onBack ? (
            <button type="button" onClick={onBack} className="mt-4 inline-block text-brand hover:underline">
              &larr; Back to Dashboard
            </button>
          ) : (
            <a href="/code/" className="mt-4 inline-block text-brand hover:underline">
              &larr; Back to Dashboard
            </a>
          )}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-text-muted">Loading session...</div>
      </div>
    );
  }

  // ACP session — render ACP relay chat
  if (session.source === 'acp' && session.environment_id) {
    return <ACPSessionDetail sessionId={sessionId} agentId={session.environment_id} onBack={onBack} />;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col overflow-hidden">
        <h1 className="sr-only">{session.title || session.id}</h1>
        {/* Session Header */}
        <div className="border-b bg-surface-1 px-4 py-3">
          <div className="mx-auto max-w-5xl">
            <div className="mb-1">
              <a
                href="/code/"
                onClick={e => {
                  if (onBack) {
                    e.preventDefault();
                    onBack();
                  }
                }}
                className="text-sm text-text-muted hover:text-text-secondary transition-colors no-underline"
              >
                &larr; Dashboard
              </a>
            </div>
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-text-primary">{session.title || session.id}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {sessionStatus && <StatusBadge status={sessionStatus} />}
                  <span className="text-xs text-text-muted">{formatTime(session.created_at)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowMeta(!showMeta)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text-secondary transition-colors"
                  title="Session info"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setTaskPanelOpen(!taskPanelOpen)}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-2 transition-colors"
                >
                  <span>Tasks</span>
                  {tasks.length > 0 && (
                    <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                      {tasks.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
            {showMeta && (
              <div className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-text-muted space-y-1 font-mono">
                <div>
                  <span className="text-text-secondary font-sans font-medium">Session</span> {session.id}
                </div>
                {session.environment_id && (
                  <div>
                    <span className="text-text-secondary font-sans font-medium">Environment</span>{' '}
                    {session.environment_id}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stream / action error banner */}
        {streamError && (
          <div className="border-b border-status-error/25 bg-status-error/10 px-4 py-2 text-sm text-status-error">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
              <span className="truncate">{streamError}</span>
              <button
                type="button"
                onClick={() => setStreamError(null)}
                className="flex-shrink-0 text-xs underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Chat messages — unified ChatView */}
        <ChatView entries={entries} isLoading={isLoading} emptyTitle="开始对话" emptyDescription="输入消息开始聊天" />

        {/* Unified Permission Panel — above input */}
        {pendingPermissions.length > 0 && (
          <div className="border-t bg-surface-1 px-4 py-3">
            <div className="mx-auto max-w-3xl space-y-3">
              {pendingPermissions.map(req => (
                <PermissionEventView
                  key={req.requestId}
                  request={req}
                  onApprove={() => void handleApprovePermission(req.requestId)}
                  onReject={() => void handleRejectPermission(req.requestId)}
                  onSubmitAnswers={handleSubmitAnswers}
                  onSubmitPlan={handleSubmitPlanResponse}
                />
              ))}
            </div>
          </div>
        )}

        {/* Unified ChatInput — claude.ai style */}
        <ChatInput
          onSubmit={handleSubmit}
          isLoading={isLoading}
          onInterrupt={handleInterrupt}
          disabled={closed}
          placeholder={closed ? '会话已关闭' : '输入消息...'}
        />

        {/* Task Panel */}
        {taskPanelOpen && (
          <TaskPanel tasks={tasks} automationState={automationState} onClose={() => setTaskPanelOpen(false)} />
        )}
      </div>
    </TooltipProvider>
  );
}

// ============================================================
// Permission Event View — routes to correct UI
// ============================================================

function PermissionEventView({
  request,
  onApprove,
  onReject,
  onSubmitAnswers,
  onSubmitPlan,
}: {
  request: PendingPermission;
  onApprove: () => void;
  onReject: () => void;
  onSubmitAnswers: (
    requestId: string,
    answers: Record<string, unknown>,
    questions: import('../types').Question[],
  ) => void;
  onSubmitPlan: (requestId: string, value: string, feedback?: string) => void;
}) {
  const toolName = request.toolName;
  const toolInput = request.toolInput;
  const description = request.description || '';

  if (toolName === 'AskUserQuestion') {
    const questions = (toolInput.questions as import('../types').Question[]) || [];
    return (
      <AskUserPanelView
        requestId={request.requestId}
        questions={questions}
        description={description}
        onSubmit={answers => onSubmitAnswers(request.requestId, answers, questions)}
        onSkip={onReject}
      />
    );
  }

  if (toolName === 'ExitPlanMode') {
    const planContent = (toolInput.plan as string) || '';
    return (
      <PlanPanelView
        requestId={request.requestId}
        planContent={planContent}
        description={description}
        onSubmit={(value, feedback) => onSubmitPlan(request.requestId, value, feedback)}
      />
    );
  }

  return (
    <PermissionPromptView
      requestId={request.requestId}
      toolName={toolName}
      toolInput={toolInput}
      description={description}
      onApprove={onApprove}
      onReject={onReject}
    />
  );
}

// ============================================================
// ACP Session Detail — renders ACP relay chat in session page
// ============================================================

function ACPSessionDetail({ agentId, onBack }: { sessionId: string; agentId: string; onBack?: () => void }) {
  const [client, setClient] = useState<ACPClient | null>(null);
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>(
    'connecting',
  );
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const clientRef = useRef<ACPClient | null>(null);

  useEffect(() => {
    const relayClient = createRelayClient(agentId);

    relayClient.setConnectionStateHandler((state, err) => {
      setConnectionState(state);
      if (err) {
        setError(err);
      } else if (state === 'connected' || state === 'connecting') {
        setError(null);
      }
    });

    clientRef.current = relayClient;
    setClient(relayClient);
    setConnectionState('connecting');
    setError(null);

    relayClient.connect().catch(e => {
      if (e instanceof DisconnectRequestedError) return;
      setError((e as Error).message);
      setConnectionState('error');
    });

    return () => {
      relayClient.disconnect();
      clientRef.current = null;
      setClient(null);
      setConnectionState('disconnected');
    };
  }, [agentId, retryCount]);

  const handleRetry = useCallback(() => {
    setRetryCount(c => c + 1);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col overflow-hidden">
        {connectionState === 'connecting' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-2 border-brand border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-text-muted text-sm">Connecting to agent...</p>
            </div>
          </div>
        )}

        {(connectionState === 'error' || connectionState === 'disconnected') && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center max-w-md space-y-3">
              <p className="font-medium text-text-primary">
                {connectionState === 'error' ? 'Connection Failed' : 'Disconnected from Agent'}
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
                {onBack ? (
                  <button
                    type="button"
                    onClick={onBack}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                  >
                    Back to Dashboard
                  </button>
                ) : (
                  <a
                    href="/code/"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2 transition-colors no-underline"
                  >
                    Back to Dashboard
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {client && connectionState === 'connected' && (
          <div className="flex-1 min-h-0">
            <ACPMain client={client} agentId={agentId} />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
