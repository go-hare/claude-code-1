/**
 * AgentView — Full-screen Ink dashboard for managing background sessions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { wrappedRender as render, Box, Text, useInput } from '@anthropic/ink';
import { listLiveSessions, attachHandler, killHandler } from '../cli/bg.js';
import type { SessionEntry } from '../cli/bg/engine.js';

function getStatusLabel(session: SessionEntry): string {
  if (session.waitingFor) return 'blocked';
  if (session.status === 'running') return 'working';
  return 'done';
}

function formatAge(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

function AgentViewApp(): React.ReactElement {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const live = await listLiveSessions();
      setSessions(live);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(sessions.length - 1, i + 1));
    } else if (key.return && sessions.length > 0) {
      const session = sessions[selectedIndex];
      if (session) {
        void attachHandler(session.name ?? String(session.pid));
      }
    } else if (input === 'x' && key.ctrl && sessions.length > 0) {
      const session = sessions[selectedIndex];
      if (session) {
        void killHandler(session.name ?? String(session.pid)).then(refresh);
      }
    } else if (input === 'q' || key.escape) {
      process.exit(0);
    }
  });

  const blocked = sessions.filter(s => s.waitingFor);
  const working = sessions.filter(s => !s.waitingFor && s.status === 'running');
  const done = sessions.filter(s => !s.waitingFor && s.status !== 'running');

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Claude Code</Text>
        <Text dimColor> · agent view · </Text>
        <Text dimColor>
          {blocked.length} awaiting input · {working.length} working · {done.length} completed
        </Text>
      </Box>

      {sessions.length === 0 && !error && (
        <Box>
          <Text dimColor>No background sessions running. Start one with: claude --bg -p "your task"</Text>
        </Box>
      )}

      {error && (
        <Box>
          <Text>{error}</Text>
        </Box>
      )}

      {sessions.map((session, index) => {
        const isSelected = index === selectedIndex;
        const label = getStatusLabel(session);
        const age = formatAge(session.startedAt);

        return (
          <Box key={session.pid} paddingLeft={1}>
            <Text inverse={isSelected}>
              <Text>{label === 'blocked' ? '◉ ' : label === 'working' ? '● ' : '○ '}</Text>
              <Text bold={isSelected}>{session.name ?? `session-${session.pid}`}</Text>
              <Text dimColor>
                {' '}
                · {label} · {age}
              </Text>
              {session.waitingFor && <Text dimColor> · waiting: {session.waitingFor}</Text>}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · enter attach · ctrl+x kill · q quit</Text>
      </Box>
    </Box>
  );
}

export async function renderAgentView(): Promise<void> {
  const instance = await render(<AgentViewApp />);
  await instance.waitUntilExit();
}
