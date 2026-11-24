import { useState, useEffect, useCallback, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import type { ACPClient } from '../src/acp/client';
import type {
  ConnectionState,
  SessionUpdate,
  PermissionRequestPayload,
  PermissionOption,
  ContentBlock,
  ImageContent,
} from '../src/acp/types';
import type {
  ThreadEntry,
  ToolCallStatus,
  ToolCallData,
  UserMessageImage,
  UserMessageEntry,
  AssistantMessageEntry,
  ToolCallEntry,
  ChatInputMessage,
  PendingPermission,
  PlanDisplayEntry,
} from '../src/lib/types';
import { ChatView } from './chat/ChatView';
import { ChatInput } from './chat/ChatInput';
import { PermissionPanel } from './chat/PermissionPanel';
import { ModelSelectorPopover } from './model-selector';
import { useCommands } from '../src/hooks/useCommands';

// Image compression options
// Claude API has a 5MB limit, so we target 2MB to be safe
const IMAGE_COMPRESSION_OPTIONS = {
  maxSizeMB: 2, // Max output size in MB
  maxWidthOrHeight: 2048, // Max dimension (scales proportionally, no cropping)
  useWebWorker: true, // Non-blocking compression
  fileType: 'image/jpeg' as const, // Convert to JPEG for better compression
};

// Convert data URL to Blob without using fetch()
// This is critical for Chrome extensions where fetch(dataUrl) violates CSP
function dataUrlToBlob(dataUrl: string): Blob {
  // Parse the data URL: data:[<mediatype>][;base64],<data>
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL: missing comma separator');
  }

  const header = dataUrl.slice(0, commaIndex);
  const base64Data = dataUrl.slice(commaIndex + 1);

  // Extract MIME type from header (e.g., "data:image/png;base64")
  const mimeMatch = header.match(/^data:([^;,]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

  // Decode base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

import { Plus, Shield, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

// =============================================================================
// Type Definitions - imported from shared types module
// =============================================================================

// Tracks an in-flight initial session creation/restore per ACPClient so
// React StrictMode double-mount deduplicates without wedging on fallback or reconnect.
const inFlightSessionInits = new WeakMap<ACPClient, Promise<void>>();

export function clearInitialAcpSession(client: ACPClient): void {
  inFlightSessionInits.delete(client);
}

export function ensureInitialAcpSession(
  client: ACPClient,
  options: {
    lastSessionId: string | null;
    permissionMode: string;
  },
): Promise<void> {
  if (client.getSessionId() || !client.isConnected()) {
    return Promise.resolve();
  }
  const existing = inFlightSessionInits.get(client);
  if (existing) {
    return existing;
  }

  const initPromise = (async () => {
    const { lastSessionId, permissionMode } = options;
    if (lastSessionId && (client.supportsLoadSession || client.supportsResumeSession)) {
      try {
        if (client.supportsLoadSession) {
          await client.loadSession({ sessionId: lastSessionId });
        } else {
          await client.resumeSession({ sessionId: lastSessionId });
        }
        return;
      } catch (err) {
        if (!client.isConnected()) return;
        console.warn('[ChatInterface] Failed to restore session, creating new one:', err);
      }
    }
    if (!client.isConnected()) return;
    await client.createSession(undefined, permissionMode);
  })().finally(() => {
    if (inFlightSessionInits.get(client) === initPromise) {
      inFlightSessionInits.delete(client);
    }
  });

  inFlightSessionInits.set(client, initPromise);
  return initPromise;
}

export function applyPermissionModeChange(options: {
  nextMode: string;
  previousMode: string;
  seqRef: { current: number };
  setMode: (mode: string) => void;
  setModeOnClient: (mode: string) => Promise<void>;
  onError: (message: string) => void;
  shouldSyncClient: boolean;
}): Promise<void> {
  const { nextMode, previousMode, seqRef, setMode, setModeOnClient, onError, shouldSyncClient } = options;
  const seq = ++seqRef.current;
  setMode(nextMode);
  try {
    localStorage.setItem('acp_permission_mode', nextMode);
  } catch {}
  if (!shouldSyncClient) {
    return Promise.resolve();
  }
  return setModeOnClient(nextMode).catch(err => {
    console.warn('[ChatInterface] Failed to update session mode:', err);
    if (seqRef.current === seq) {
      setMode(previousMode);
      try {
        localStorage.setItem('acp_permission_mode', previousMode);
      } catch {}
    }
    onError(err instanceof Error ? err.message : 'Failed to update permission mode');
  });
}

interface ChatInterfaceProps {
  client: ACPClient;
  agentId?: string;
  newSessionTrigger?: number;
  onActiveSessionChange?: (sessionId: string | null) => void;
}

// =============================================================================
// Permission Mode Selector
// =============================================================================

const PERMISSION_MODES = [
  { value: 'default', label: '默认', description: '手动审批权限请求' },
  { value: 'acceptEdits', label: '自动接受编辑', description: '自动允许文件编辑操作' },
  { value: 'bypassPermissions', label: '跳过权限', description: '跳过所有权限检查' },
  { value: 'plan', label: '规划模式', description: '仅规划，不执行工具' },
  { value: 'dontAsk', label: '不询问', description: '不弹出询问，自动拒绝' },
  { value: 'auto', label: '自动判断', description: 'AI 自动判断是否批准' },
] as const;

function PermissionModeSelector({ mode, onModeChange }: { mode: string; onModeChange: (mode: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = PERMISSION_MODES.find(m => m.value === mode) ?? PERMISSION_MODES[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground h-7 px-2">
          <Shield className="h-3 w-3" />
          <span className="max-w-24 truncate">{current.label}</span>
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        {PERMISSION_MODES.map(m => (
          <button
            key={m.value}
            type="button"
            onClick={() => {
              onModeChange(m.value);
              setOpen(false);
            }}
            className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-surface-2 transition-colors"
          >
            <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
              {mode === m.value && <Check className="h-3.5 w-3.5 text-brand" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary">{m.label}</div>
              <div className="text-xs text-text-muted">{m.description}</div>
            </div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

// Map ACP status string to our status type
function mapToolStatus(status: string): ToolCallStatus {
  if (status === 'completed') return 'complete';
  if (status === 'failed') return 'error';
  return 'running';
}

// Find tool call index in entries (search from end, like Zed)
function findToolCallIndex(entries: ThreadEntry[], toolCallId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry && entry.type === 'tool_call' && entry.toolCall.id === toolCallId) {
      return i;
    }
  }
  return -1;
}

// =============================================================================
// ChatInterface Component
// =============================================================================

export function ChatInterface({ client, agentId, newSessionTrigger = 0, onActiveSessionChange }: ChatInterfaceProps) {
  // Flat list of entries (like Zed's entries: Vec<AgentThreadEntry>)
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [permissionMode, setPermissionMode] = useState(() => {
    try {
      return localStorage.getItem('acp_permission_mode') || 'default';
    } catch {
      return 'default';
    }
  });
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;
  const modeChangeSeqRef = useRef(0);
  const lastNewSessionTriggerRef = useRef(newSessionTrigger);
  // Reference: Zed's supports_images() checks prompt_capabilities.image
  const [supportsImages, setSupportsImages] = useState(false);
  const { commands: availableCommands } = useCommands(client);

  const showTransientError = useCallback((msg: string) => {
    setErrorMessage(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMessage(null), 5000);
  }, []);

  const updateActiveSession = useCallback(
    (sessionId: string | null) => {
      activeSessionIdRef.current = sessionId;
      onActiveSessionChange?.(sessionId);
    },
    [onActiveSessionChange],
  );

  const resetThreadState = useCallback(() => {
    setEntries([]);
    setIsLoading(false);
    setSessionReady(false);
  }, []);

  const storageKey = agentId ? `acp_last_session_${agentId}` : null;

  const activateSession = useCallback(
    (sessionId: string, options?: { resetEntries?: boolean }) => {
      const shouldResetEntries = options?.resetEntries ?? true;
      if (shouldResetEntries) {
        setEntries([]);
        setIsLoading(false);
      }
      updateActiveSession(sessionId);
      setSessionReady(true);
      setSupportsImages(client.supportsImages);
      // Persist session ID for restoration on remount
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, sessionId);
        } catch {}
      }
      console.log('[ChatInterface] Active session:', sessionId, 'supportsImages:', client.supportsImages);
    },
    [client, storageKey, updateActiveSession],
  );

  // =============================================================================
  // Permission Request Handler
  // =============================================================================
  const handlePermissionRequest = useCallback((request: PermissionRequestPayload) => {
    if (!activeSessionIdRef.current || request.sessionId !== activeSessionIdRef.current) {
      return;
    }
    console.log('[ChatInterface] Permission request:', request);

    setEntries(prev => {
      // Find matching tool call (search from end)
      const toolCallIndex = findToolCallIndex(prev, request.toolCall.toolCallId);

      if (toolCallIndex >= 0) {
        // Update existing tool call's status
        return prev.map((entry, index) => {
          if (index !== toolCallIndex) return entry;
          if (entry.type !== 'tool_call') return entry;
          if (entry.toolCall.status !== 'running') return entry;

          return {
            type: 'tool_call',
            toolCall: {
              ...entry.toolCall,
              status: 'waiting_for_confirmation' as const,
              permissionRequest: {
                requestId: request.requestId,
                options: request.options,
              },
            },
          };
        });
      } else {
        // No matching tool call - create standalone permission request as new entry
        console.log('[ChatInterface] No matching tool call, creating standalone permission request');

        const permissionToolCall: ToolCallEntry = {
          type: 'tool_call',
          toolCall: {
            id: request.toolCall.toolCallId,
            title: request.toolCall.title || 'Permission Request',
            status: 'waiting_for_confirmation',
            permissionRequest: {
              requestId: request.requestId,
              options: request.options,
            },
            isStandalonePermission: true,
          },
        };

        return [...prev, permissionToolCall];
      }
    });
  }, []);

  // =============================================================================
  // Session Update Handler (Zed-style: check last entry type)
  // =============================================================================
  const handleSessionUpdate = useCallback((sessionId: string, update: SessionUpdate) => {
    if (!activeSessionIdRef.current || sessionId !== activeSessionIdRef.current) {
      return;
    }

    // Handle agent message chunk
    if (update.sessionUpdate === 'agent_message_chunk') {
      const text = update.content.type === 'text' && update.content.text ? update.content.text : '';
      if (!text) return;

      setEntries(prev => {
        const lastEntry = prev[prev.length - 1];

        // If last entry is AssistantMessage, append to it
        if (lastEntry?.type === 'assistant_message') {
          const lastChunk = lastEntry.chunks[lastEntry.chunks.length - 1];

          // If last chunk is same type (message), append text
          if (lastChunk?.type === 'message') {
            return [
              ...prev.slice(0, -1),
              {
                ...lastEntry,
                chunks: [...lastEntry.chunks.slice(0, -1), { type: 'message', text: lastChunk.text + text }],
              },
            ];
          }

          // Otherwise add new message chunk
          return [
            ...prev.slice(0, -1),
            {
              ...lastEntry,
              chunks: [...lastEntry.chunks, { type: 'message', text }],
            },
          ];
        }

        // Create new AssistantMessage entry
        const newEntry: AssistantMessageEntry = {
          type: 'assistant_message',
          id: `assistant-${Date.now()}`,
          chunks: [{ type: 'message', text }],
        };
        return [...prev, newEntry];
      });
    }
    // Handle agent thought chunk (NEW - was missing before)
    else if (update.sessionUpdate === 'agent_thought_chunk') {
      const text = update.content.type === 'text' && update.content.text ? update.content.text : '';
      if (!text) return;

      setEntries(prev => {
        const lastEntry = prev[prev.length - 1];

        // If last entry is AssistantMessage, append to it
        if (lastEntry?.type === 'assistant_message') {
          const lastChunk = lastEntry.chunks[lastEntry.chunks.length - 1];

          // If last chunk is same type (thought), append text
          if (lastChunk?.type === 'thought') {
            return [
              ...prev.slice(0, -1),
              {
                ...lastEntry,
                chunks: [...lastEntry.chunks.slice(0, -1), { type: 'thought', text: lastChunk.text + text }],
              },
            ];
          }

          // Otherwise add new thought chunk
          return [
            ...prev.slice(0, -1),
            {
              ...lastEntry,
              chunks: [...lastEntry.chunks, { type: 'thought', text }],
            },
          ];
        }

        // Create new AssistantMessage entry with thought
        const newEntry: AssistantMessageEntry = {
          type: 'assistant_message',
          id: `assistant-${Date.now()}`,
          chunks: [{ type: 'thought', text }],
        };
        return [...prev, newEntry];
      });
    }
    // Handle user message chunk (NEW - was missing before)
    else if (update.sessionUpdate === 'user_message_chunk') {
      const text = update.content.type === 'text' && update.content.text ? update.content.text : '';
      if (!text) return;

      setEntries(prev => {
        const lastEntry = prev[prev.length - 1];

        // If last entry is UserMessage, append to it
        if (lastEntry?.type === 'user_message') {
          return [
            ...prev.slice(0, -1),
            {
              ...lastEntry,
              content: lastEntry.content + text,
            },
          ];
        }

        // Create new UserMessage entry
        const newEntry: UserMessageEntry = {
          type: 'user_message',
          id: `user-${Date.now()}`,
          content: text,
        };
        return [...prev, newEntry];
      });
    }
    // Handle tool call (UPSERT - update if exists, create if not)
    else if (update.sessionUpdate === 'tool_call') {
      const toolCallData: ToolCallData = {
        id: update.toolCallId,
        title: update.title,
        status: mapToolStatus(update.status),
        content: update.content,
        rawInput: update.rawInput,
        rawOutput: update.rawOutput,
      };

      setEntries(prev => {
        // UPSERT: Check if tool call already exists
        const existingIndex = findToolCallIndex(prev, update.toolCallId);

        if (existingIndex >= 0) {
          // UPDATE existing tool call
          return prev.map((entry, index) => {
            if (index !== existingIndex) return entry;
            if (entry.type !== 'tool_call') return entry;

            return {
              type: 'tool_call',
              toolCall: {
                ...entry.toolCall,
                ...toolCallData,
              },
            };
          });
        }

        // CREATE new tool call entry
        const newEntry: ToolCallEntry = {
          type: 'tool_call',
          toolCall: toolCallData,
        };
        return [...prev, newEntry];
      });
    }
    // Handle tool call update (partial update)
    else if (update.sessionUpdate === 'tool_call_update') {
      setEntries(prev => {
        const existingIndex = findToolCallIndex(prev, update.toolCallId);

        if (existingIndex < 0) {
          // Tool call not found - create a failed tool call entry (like Zed)
          console.warn(`[ChatInterface] Tool call not found for update: ${update.toolCallId}`);
          const failedEntry: ToolCallEntry = {
            type: 'tool_call',
            toolCall: {
              id: update.toolCallId,
              title: update.title || 'Tool call not found',
              status: 'error',
              content: [{ type: 'content', content: { type: 'text', text: 'Tool call not found' } }],
            },
          };
          return [...prev, failedEntry];
        }

        return prev.map((entry, index) => {
          if (index !== existingIndex) return entry;
          if (entry.type !== 'tool_call') return entry;

          const newStatus = update.status ? mapToolStatus(update.status) : entry.toolCall.status;
          const mergedContent = update.content
            ? [...(entry.toolCall.content || []), ...update.content]
            : entry.toolCall.content;

          return {
            type: 'tool_call',
            toolCall: {
              ...entry.toolCall,
              status: newStatus,
              ...(update.title && { title: update.title }),
              content: mergedContent,
              ...(update.rawInput && { rawInput: update.rawInput }),
              ...(update.rawOutput && { rawOutput: update.rawOutput }),
            },
          };
        });
      });
    }
    // Handle plan update (replace entire plan)
    else if (update.sessionUpdate === 'plan') {
      setEntries(prev => {
        // Empty entries → remove existing plan
        if (update.entries.length === 0) {
          return prev.filter(e => e.type !== 'plan');
        }

        // Find last plan entry
        const lastPlanIndex = prev.reduce((acc, entry, i) => (entry.type === 'plan' ? i : acc), -1);

        if (lastPlanIndex >= 0) {
          // Update existing plan in place
          return prev.map((entry, index) => (index === lastPlanIndex ? { ...entry, entries: update.entries } : entry));
        }

        // Create new plan entry
        const newPlanEntry: PlanDisplayEntry = {
          type: 'plan',
          id: `plan-${Date.now()}`,
          entries: update.entries,
        };
        return [...prev, newPlanEntry];
      });
    }
  }, []);

  // =============================================================================
  // Setup Effect
  // =============================================================================
  useEffect(() => {
    let cancelled = false;

    client.setSessionCreatedHandler(sessionId => {
      if (cancelled) return;
      console.log('[ChatInterface] Session created:', sessionId);
      activateSession(sessionId);
    });

    client.setSessionLoadedHandler(sessionId => {
      if (cancelled) return;
      console.log('[ChatInterface] Session loaded/resumed:', sessionId);
      activateSession(sessionId, { resetEntries: false });
    });

    client.setSessionSwitchingHandler(sessionId => {
      if (cancelled) return;
      console.log('[ChatInterface] Switching to session:', sessionId);
      // Synchronously update ref before history replay session_update frames arrive
      updateActiveSession(sessionId);
      resetThreadState();
    });

    client.setSessionUpdateHandler((sessionId: string, update: SessionUpdate) => {
      if (cancelled) return;
      handleSessionUpdate(sessionId, update);
    });

    client.setPromptCompleteHandler(stopReason => {
      if (cancelled) return;
      console.log('[ChatInterface] Prompt complete:', stopReason);
      setIsLoading(false);
    });

    client.setPermissionRequestHandler(request => {
      if (cancelled) return;
      handlePermissionRequest(request);
    });

    client.setErrorMessageHandler(msg => {
      if (cancelled) return;
      console.error('[ChatInterface] Agent error:', msg);
      showTransientError(msg);
    });

    const startInitialSession = () => {
      let lastSessionId: string | null = null;
      if (storageKey) {
        try {
          lastSessionId = localStorage.getItem(storageKey);
        } catch {
          // ignore storage errors
        }
      }
      void ensureInitialAcpSession(client, {
        lastSessionId,
        permissionMode: permissionModeRef.current,
      }).catch(err => {
        if (!cancelled) {
          console.warn('[ChatInterface] Failed to initialize session:', err);
        }
      });
    };

    const handleConnectionState = (state: ConnectionState) => {
      if (cancelled) return;
      if (state === 'disconnected' || state === 'error') {
        clearInitialAcpSession(client);
        resetThreadState();
        updateActiveSession(null);
      } else if (state === 'connected' && !client.getSessionId()) {
        startInitialSession();
      }
    };
    client.setConnectionStateHandler(handleConnectionState);

    const existingSessionId = client.getSessionId();
    if (existingSessionId) {
      // Reuse already-active session (e.g. React StrictMode remount)
      activateSession(existingSessionId, { resetEntries: false });
    } else if (client.isConnected()) {
      startInitialSession();
    }

    return () => {
      cancelled = true;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      client.removeConnectionStateHandler(handleConnectionState);
      client.setSessionCreatedHandler(() => {});
      client.setSessionLoadedHandler(() => {});
      client.setSessionSwitchingHandler(null);
      client.setSessionUpdateHandler(() => {});
      client.setPromptCompleteHandler(() => {});
      client.setPermissionRequestHandler(() => {});
      client.setErrorMessageHandler(() => {});
    };
  }, [
    activateSession,
    client,
    handlePermissionRequest,
    handleSessionUpdate,
    resetThreadState,
    showTransientError,
    storageKey,
    updateActiveSession,
  ]);

  // =============================================================================
  // User Actions
  // =============================================================================

  // Reference: Zed's ConnectionView.reset() + set_server_state() + _external_thread()
  // Creates a new session by clearing current state and calling new_session
  const handleNewSession = useCallback(() => {
    console.log('[ChatInterface] Creating new session...');

    if (isLoading && client.isConnected()) {
      client.cancel();
    }

    resetThreadState();
    updateActiveSession(null);

    if (client.isConnected()) {
      client.createSession(undefined, permissionModeRef.current).catch(err => {
        console.error('[ChatInterface] Failed to create new session:', err);
        showTransientError(err instanceof Error ? err.message : 'Failed to create new session');
      });
    }
  }, [client, isLoading, resetThreadState, showTransientError, updateActiveSession]);

  // Trigger new session creation from sidebar "+" button in ACPMain
  useEffect(() => {
    if (newSessionTrigger > lastNewSessionTriggerRef.current) {
      lastNewSessionTriggerRef.current = newSessionTrigger;
      handleNewSession();
    }
  }, [newSessionTrigger, handleNewSession]);

  // Cancel handler - matches Zed's cancel() logic in acp_thread.rs
  // 1. Mark all pending/running/waiting_for_confirmation tool calls as canceled
  // 2. Send cancel notification to agent
  // 3. Do NOT set isLoading=false here - wait for prompt_complete with stopReason="cancelled"
  const handleCancel = () => {
    console.log('[ChatInterface] Cancel requested');

    // Like Zed: iterate all entries, mark Pending/WaitingForConfirmation/InProgress tool calls as Canceled
    setEntries(prev =>
      prev.map(entry => {
        if (entry.type !== 'tool_call') return entry;

        // Check if status should be canceled (matches Zed's logic)
        const shouldCancel =
          entry.toolCall.status === 'running' || entry.toolCall.status === 'waiting_for_confirmation';

        if (!shouldCancel) return entry;

        console.log('[ChatInterface] Marking tool call as canceled:', entry.toolCall.id);
        return {
          type: 'tool_call',
          toolCall: {
            ...entry.toolCall,
            status: 'canceled' as ToolCallStatus,
            permissionRequest: undefined, // Clear any pending permission request
          },
        };
      }),
    );

    // Send cancel notification to server (which forwards to agent)
    client.cancel();
    // Note: Do NOT set isLoading=false here!
    // Wait for prompt_complete with stopReason="cancelled" from the agent
  };

  const handlePermissionResponse = useCallback(
    (requestId: string, optionId: string | null, optionKind: PermissionOption['kind'] | null) => {
      console.log('[ChatInterface] Permission response:', { requestId, optionId, optionKind });
      client.respondToPermission(requestId, optionId);

      // Determine new status based on option kind
      const isRejected = optionKind === 'reject_once' || optionKind === 'reject_always' || optionId === null;

      // Update the tool call status in entries
      setEntries(prev =>
        prev.map(entry => {
          if (entry.type !== 'tool_call') return entry;
          if (entry.toolCall.permissionRequest?.requestId !== requestId) return entry;

          // For standalone permission requests, mark as complete immediately when approved
          // For regular tool calls, mark as running (agent will update to complete later)
          let newStatus: ToolCallStatus;
          if (isRejected) {
            newStatus = 'rejected';
          } else if (entry.toolCall.isStandalonePermission) {
            newStatus = 'complete';
          } else {
            newStatus = 'running';
          }

          return {
            type: 'tool_call',
            toolCall: {
              ...entry.toolCall,
              status: newStatus,
              permissionRequest: undefined,
              isStandalonePermission: undefined,
            },
          };
        }),
      );
    },
    [client],
  );

  // =============================================================================
  // Render
  // =============================================================================

  // Collect pending permissions from tool call entries
  const pendingPermissions: PendingPermission[] = entries
    .filter(
      (e): e is ToolCallEntry =>
        e.type === 'tool_call' && e.toolCall.status === 'waiting_for_confirmation' && !!e.toolCall.permissionRequest,
    )
    .map(e => ({
      requestId: e.toolCall.permissionRequest!.requestId,
      toolName: e.toolCall.title,
      toolInput: e.toolCall.rawInput || {},
      description: e.toolCall.title,
      options: e.toolCall.permissionRequest!.options,
    }));

  // Handle permission respond for unified PermissionPanel
  const handlePermissionPanelRespond = useCallback(
    (requestId: string, approved: boolean) => {
      // Find the matching permission request to get the real optionId
      const perm = pendingPermissions.find(p => p.requestId === requestId);
      let optionId: string | null = null;
      let optionKind: PermissionOption['kind'] | null = null;

      if (perm?.options && perm.options.length > 0) {
        if (approved) {
          // Pick allow_once, then allow_always, then any non-reject option, then options[0]
          // so clicking Allow never silently downgrades to cancelled (optionId=null).
          const allowOpt =
            perm.options.find(o => o.kind === 'allow_once') ??
            perm.options.find(o => o.kind === 'allow_always') ??
            perm.options.find(o => !o.kind.startsWith('reject')) ??
            perm.options[0];
          if (allowOpt) {
            optionId = allowOpt.optionId;
            optionKind = allowOpt.kind;
          }
        } else {
          // Pick the first reject option
          const rejectOpt =
            perm.options.find(o => o.kind === 'reject_once') ?? perm.options.find(o => o.kind === 'reject_always');
          if (rejectOpt) {
            optionId = rejectOpt.optionId;
            optionKind = rejectOpt.kind;
          }
        }
      }

      // Fallback when options list is empty or reject option isn't enumerated
      if (!optionId) {
        optionKind = approved ? 'allow_once' : 'reject_once';
      }

      handlePermissionResponse(requestId, optionId, optionKind);
    },
    [handlePermissionResponse, pendingPermissions],
  );

  // Handle ChatInput submit — convert ChatInputMessage to ContentBlock[]
  const handleChatInputSubmit = useCallback(
    async (message: ChatInputMessage) => {
      const text = message.text.trim();
      const images = message.images || [];

      if ((!text && images.length === 0) || isLoading || !sessionReady) return;

      const contentBlocks: ContentBlock[] = [];

      if (text) {
        contentBlocks.push({ type: 'text', text });
      }

      // Convert images to ContentBlock
      const userImages: UserMessageImage[] = [];

      for (const img of images) {
        try {
          const dataUrl = `data:${img.mimeType};base64,${img.data}`;
          let blob: Blob;
          if (dataUrl.startsWith('data:')) {
            blob = dataUrlToBlob(dataUrl);
          } else {
            const response = await fetch(dataUrl);
            blob = await response.blob();
          }

          let finalBlob: Blob = blob;
          let finalMimeType = img.mimeType;

          if (blob.size > 2 * 1024 * 1024) {
            const imageFile = new File([blob], 'image.jpg', { type: blob.type });
            finalBlob = await imageCompression(imageFile, IMAGE_COMPRESSION_OPTIONS);
            finalMimeType = 'image/jpeg';
          }

          const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const commaIndex = result.indexOf(',');
              resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
            };
            reader.onerror = () => reject(new Error('FileReader error: ' + reader.error?.message));
            reader.readAsDataURL(finalBlob);
          });

          const imageContent: ImageContent = {
            type: 'image',
            mimeType: finalMimeType,
            data: base64Data,
          };
          contentBlocks.push(imageContent);

          userImages.push({
            mimeType: finalMimeType,
            data: base64Data,
          });
        } catch (error) {
          console.error('[ChatInterface] Failed to process image:', error);
        }
      }

      if (contentBlocks.length === 0) return;

      // Add user message entry
      const userEntry: UserMessageEntry = {
        type: 'user_message',
        id: `user-${Date.now()}`,
        content: text,
        images: userImages.length > 0 ? userImages : undefined,
      };
      setEntries(prev => [...prev, userEntry]);
      setIsLoading(true);

      try {
        await client.sendPrompt(contentBlocks);
      } catch (error) {
        console.error('[ChatInterface] Failed to send prompt:', error);
        setIsLoading(false);
      }
    },
    [isLoading, sessionReady, client],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Chat messages — unified ChatView (permissions are handled by PermissionPanel below to avoid duplicate controls) */}
      <ChatView
        entries={entries}
        isLoading={isLoading && !sessionReady ? false : isLoading}
        emptyTitle={sessionReady ? '开始对话' : undefined}
        emptyDescription={sessionReady ? '输入消息开始与 ACP agent 聊天' : undefined}
      />

      {/* Permission panel — fixed above input */}
      <PermissionPanel requests={pendingPermissions} onRespond={handlePermissionPanelRespond} />

      {/* Error banner */}
      {errorMessage && (
        <div className="mx-auto max-w-3xl w-full px-4 sm:px-8 pb-1">
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="ml-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 flex-shrink-0"
            >
              {'\u00D7'}
            </button>
          </div>
        </div>
      )}

      {/* Model selector + New thread + ChatInput */}
      <div className="flex-shrink-0">
        <div className="max-w-3xl mx-auto w-full px-4 sm:px-8 pb-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <PermissionModeSelector
              mode={permissionMode}
              onModeChange={(m: string) => {
                void applyPermissionModeChange({
                  nextMode: m,
                  previousMode: permissionModeRef.current,
                  seqRef: modeChangeSeqRef,
                  setMode: setPermissionMode,
                  setModeOnClient: mode => client.setSessionMode(mode),
                  onError: showTransientError,
                  shouldSyncClient: Boolean(sessionReady && client.isConnected() && client.getSessionId()),
                });
              }}
            />
            <ModelSelectorPopover client={client} />
          </div>
          {entries.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-text-muted hover:text-brand font-display gap-1"
                  onClick={handleNewSession}
                >
                  <Plus className="h-3 w-3" />
                  新会话
                </Button>
              </TooltipTrigger>
              <TooltipContent>New Thread</TooltipContent>
            </Tooltip>
          )}
        </div>
        <ChatInput
          onSubmit={handleChatInputSubmit}
          isLoading={isLoading}
          onInterrupt={handleCancel}
          disabled={!sessionReady}
          placeholder={sessionReady ? '给 Claude 发送消息…' : '等待会话...'}
          supportsImages={supportsImages}
          commands={availableCommands.length > 0 ? availableCommands : undefined}
        />
      </div>
    </div>
  );
}
