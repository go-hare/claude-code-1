import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ACPClient } from '../src/acp/client';
import type { AgentSessionInfo } from '../src/acp/types';
import { ChatInterface } from './ChatInterface';
import { cn } from '../src/lib/utils';
import { MessageSquare, Plus, PanelLeftClose, PanelLeft } from 'lucide-react';

interface ACPMainProps {
  client: ACPClient;
  agentId?: string;
}

/**
 * Main container — Anthropic sidebar + chat layout.
 * Sidebar: sectioned by recency, orange active state, warm raised bg.
 */
export function ACPMain({ client, agentId }: ACPMainProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => client.getSessionId());

  // Handle session selection
  const handleSelectSession = useCallback(
    async (session: AgentSessionInfo) => {
      try {
        if (client.supportsLoadSession) {
          await client.loadSession({ sessionId: session.sessionId, cwd: session.cwd });
        } else if (client.supportsResumeSession) {
          await client.resumeSession({ sessionId: session.sessionId, cwd: session.cwd });
        } else {
          throw new Error('Loading or resuming sessions is not supported by this agent.');
        }
      } catch (error) {
        console.error('Failed to load/resume session:', error);
      }
    },
    [client],
  );

  return (
    <div className="flex h-full w-full">
      {/* 侧边栏 — Anthropic warm sidebar, hidden on mobile */}
      <div
        className={cn(
          'hidden md:flex flex-col border-r border-border/60 bg-surface-1/50 transition-all duration-200 flex-shrink-0',
          sidebarCollapsed ? 'w-12' : 'w-64',
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-4">
          {!sidebarCollapsed && (
            <span className="text-xs font-display font-semibold text-text-muted uppercase tracking-widest px-1">
              会话
            </span>
          )}
          <div className={cn('flex items-center gap-0.5', sidebarCollapsed && 'mx-auto')}>
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => setNewSessionTrigger(n => n + 1)}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-text-muted hover:text-brand hover:bg-brand/10 transition-colors"
                title="新会话"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
            >
              {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* 会话列表 */}
        {!sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto">
            <SidebarSessionList
              client={client}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
            />
          </div>
        )}
      </div>

      {/* 聊天区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatInterface
          client={client}
          agentId={agentId}
          newSessionTrigger={newSessionTrigger}
          onActiveSessionChange={setActiveSessionId}
        />
      </div>
    </div>
  );
}

// =============================================================================
// 侧边栏会话列表 — Anthropic 分段式（今天/昨天/更早）
// =============================================================================

function SidebarSessionList({
  client,
  activeSessionId,
  onSelectSession,
}: {
  client: ACPClient;
  activeSessionId: string | null;
  onSelectSession: (session: AgentSessionInfo) => void;
}) {
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(activeSessionId);
  const loadSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sync sidebar highlight whenever ChatInterface creates/loads/switches sessions
  useEffect(() => {
    setSelectedId(activeSessionId);
  }, [activeSessionId]);

  const loadSessions = useCallback(async () => {
    if (!client.supportsSessionList) {
      setLoading(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const response = await client.listSessions();
      if (!mountedRef.current || loadSeqRef.current !== seq) return;
      setSessions(response.sessions);
    } catch (err) {
      if (!mountedRef.current || loadSeqRef.current !== seq) return;
      console.warn('[SidebarSessionList] Failed to load:', err);
    } finally {
      if (mountedRef.current && loadSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    if (client.getState() === 'connected' && client.supportsSessionList) {
      loadSessions();
    }
  }, [client, loadSessions, activeSessionId]);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = (state: string) => {
      if (state === 'connected') {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void loadSessions();
        }, 200);
      }
    };
    client.setConnectionStateHandler(handler);
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      client.removeConnectionStateHandler(handler);
    };
  }, [client, loadSessions]);

  useEffect(() => {
    const interval = setInterval(loadSessions, 10000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      }),
    [sessions],
  );

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-text-muted font-display">加载中...</span>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-text-muted font-display">暂无会话</span>
      </div>
    );
  }

  // 按日期分组
  const groups = groupByRecency(sorted);
  const effectiveActiveId = activeSessionId ?? selectedId;

  return (
    <nav className="py-1" aria-label="历史会话">
      {groups.map((group, gi) => (
        <div key={group.label}>
          {gi > 0 && <div className="mx-3 my-2 border-t border-border/40" />}
          <div className="px-4 py-2">
            <span className="text-[10px] font-display font-semibold uppercase tracking-widest text-text-muted/70">
              {group.label}
            </span>
          </div>
          {group.sessions.map(session => (
            <button
              key={session.sessionId}
              type="button"
              onClick={() => {
                setSelectedId(session.sessionId);
                onSelectSession(session);
              }}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors rounded-none',
                session.sessionId === effectiveActiveId
                  ? 'bg-brand/8 text-text-primary'
                  : 'text-text-secondary hover:bg-surface-2/60 hover:text-text-primary',
              )}
              title={session.title || session.sessionId}
            >
              <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
              <span className="text-[13px] font-display truncate leading-snug">
                {session.title && session.title.trim() ? session.title : '新会话'}
              </span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

// =============================================================================
// 按日期分组：今天 / 昨天 / 更早
// =============================================================================

interface SessionGroup {
  label: string;
  sessions: AgentSessionInfo[];
}

function groupByRecency(sessions: AgentSessionInfo[]): SessionGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: SessionGroup[] = [
    { label: '今天', sessions: [] },
    { label: '昨天', sessions: [] },
    { label: '更早', sessions: [] },
  ];

  for (const session of sessions) {
    const date = session.updatedAt ? new Date(session.updatedAt) : new Date(0);
    if (date >= today) {
      groups[0].sessions.push(session);
    } else if (date >= yesterday) {
      groups[1].sessions.push(session);
    } else {
      groups[2].sessions.push(session);
    }
  }

  return groups.filter(g => g.sessions.length > 0);
}
