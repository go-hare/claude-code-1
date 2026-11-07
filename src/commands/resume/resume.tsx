import chalk from 'chalk';
import type { UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js';
import type { CommandResultDisplay, ResumeEntrypoint } from '../../commands.js';
import { LogSelector } from '../../components/LogSelector.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Spinner } from '../../components/Spinner.js';
import { useIsInsideModal, useModalOrTerminalSize } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { setClipboard } from '@anthropic/ink';
import { Box, Divider, Text } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { LogOption } from '../../types/logs.js';
import { agenticSessionSearch } from '../../utils/agenticSessionSearch.js';
import { checkCrossProjectResume } from '../../utils/crossProjectResume.js';
import { getWorktreePaths } from '../../utils/getWorktreePaths.js';
import { logError } from '../../utils/log.js';
import {
  getLastSessionLog,
  getSessionIdFromLog,
  isCustomTitleEnabled,
  isLiteLog,
  loadAllProjectsMessageLogs,
  loadFullLog,
  loadSameRepoMessageLogs,
  searchSessionsByCustomTitle,
} from '../../utils/sessionStorage.js';
import { validateUuid } from '../../utils/uuid.js';

type ResumeResult =
  | { resultType: 'sessionNotFound'; arg: string }
  | { resultType: 'multipleMatches'; arg: string; count: number };

function resumeHelpMessage(result: ResumeResult): string {
  switch (result.resultType) {
    case 'sessionNotFound':
      return `Session ${chalk.bold(result.arg)} was not found. Run ${chalk.bold('/resume')} without arguments to browse all sessions.`;
    case 'multipleMatches':
      return `Found ${result.count} sessions matching ${chalk.bold(result.arg)}. Run ${chalk.bold('/resume')} to pick one from the list.`;
  }
}

function ResumeError({
  message,
  args,
  onDone,
}: {
  message: string;
  args: string;
  onDone: () => void;
}): React.ReactNode {
  React.useEffect(() => {
    const timer = setTimeout(onDone, 0);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {figures.pointer} /resume {args}
      </Text>
      <MessageResponse>
        <Text>{message}</Text>
      </MessageResponse>
    </Box>
  );
}

function ResumeCommand({
  onDone,
  onResume,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  onResume: (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => Promise<void>;
}): React.ReactNode {
  const [logs, setLogs] = React.useState<LogOption[]>([]);
  const [worktreePaths, setWorktreePaths] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [resuming, setResuming] = React.useState(false);
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const cancelledRef = React.useRef(false);
  const hasListRef = React.useRef(false);
  // Inside FullscreenLayout's modal slot, use the modal's inner rows (already
  // minus transcript peek + divider) — floor(rows/2) collapses the list and
  // crushes the footer under default-on fullscreen (official 2.1.210 layout).
  const { rows } = useModalOrTerminalSize(useTerminalSize());
  const insideModal = useIsInsideModal();

  const loadLogs = React.useCallback(
    async (allProjects: boolean, paths: string[]) => {
      // First load (no list yet) takes the small status frame. A reload while
      // the list is up keeps the list and only marks it refreshing.
      if (!hasListRef.current) setLoading(true);
      try {
        const allLogs = allProjects ? await loadAllProjectsMessageLogs() : await loadSameRepoMessageLogs(paths);
        if (cancelledRef.current) return;
        const resumable = filterResumableSessions(allLogs, getSessionId());
        hasListRef.current = true;
        setLogs(resumable);
      } catch (_err) {
        if (!cancelledRef.current) {
          onDone('Failed to load conversations');
        }
      } finally {
        if (!cancelledRef.current) {
          setLoading(false);
        }
      }
    },
    [onDone],
  );

  React.useEffect(() => {
    async function init() {
      const paths = await getWorktreePaths(getOriginalCwd());
      // densable ie(): Esc during the worktree lookup must not start a load.
      if (cancelledRef.current) return;
      setWorktreePaths(paths);
      void loadLogs(false, paths);
    }
    void init();
  }, [loadLogs]);

  const handleToggleAllProjects = React.useCallback(() => {
    const newValue = !showAllProjects;
    setShowAllProjects(newValue);
    void loadLogs(newValue, worktreePaths);
  }, [showAllProjects, loadLogs, worktreePaths]);

  async function handleSelect(log: LogOption) {
    const sessionId = validateUuid(getSessionIdFromLog(log));
    if (!sessionId) {
      onDone('Failed to resume conversation');
      return;
    }

    // Load full messages for lite logs
    const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
    if (cancelledRef.current) return;

    // densable MTs: null → resume here (same dir / worktree / deleted path)
    const command = await checkCrossProjectResume(fullLog, showAllProjects, worktreePaths);
    if (cancelledRef.current) return;
    if (command) {
      const raw = await setClipboard(command);
      if (raw) process.stdout.write(raw);

      const message = [
        '',
        'This conversation is from a different directory.',
        '',
        'To resume, run:',
        `  ${command}`,
        '',
        '(Command copied to clipboard)',
        '',
      ].join('\n');

      onDone(message, { display: 'user' });
      return;
    }

    // Same directory - proceed with resume
    setResuming(true);
    void onResume(sessionId, fullLog, 'slash_command_picker');
  }

  function handleCancel() {
    cancelledRef.current = true;
    onDone('Resume cancelled', { display: 'system' });
  }

  useKeybinding('confirm:no', handleCancel, {
    context: 'Confirmation',
    isActive: loading && !resuming,
  });

  // Gold ie(): while the first load is in flight (or a session is being
  // resumed) the picker is not mounted. The list appears once, at its
  // content height, instead of growing a row at a time.
  if ((loading && logs.length === 0) || resuming) {
    const statusBody = (
      <>
        <Text bold color="suggestion">
          Resume session
        </Text>
        <Box marginTop={1}>
          <Spinner />
          <Text> {resuming ? 'Resuming conversation…' : 'Loading conversations…'}</Text>
        </Box>
      </>
    );
    // Gold paints this content-sized while logs are empty. The list frame
    // mounts only after logs arrive (empty logs return null), so do not
    // reserve the list height here — that draws a blank box that then fills.
    if (insideModal) {
      return (
        <Box flexDirection="column" paddingX={1} flexShrink={0}>
          {statusBody}
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Divider color="suggestion" />
        <Box flexDirection="column" paddingX={2}>
          {statusBody}
        </Box>
      </Box>
    );
  }

  return (
    <LogSelector
      logs={logs}
      maxHeight={insideModal ? rows : Math.max(1, rows - 2)}
      onCancel={handleCancel}
      onSelect={handleSelect}
      onLogsChanged={() => loadLogs(showAllProjects, worktreePaths)}
      showAllProjects={showAllProjects}
      onToggleAllProjects={handleToggleAllProjects}
      onAgenticSearch={agenticSessionSearch}
      isLoading={loading}
    />
  );
}

export function filterResumableSessions(logs: LogOption[], currentSessionId: string): LogOption[] {
  return logs.filter(l => !l.isSidechain && getSessionIdFromLog(l) !== currentSessionId);
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const onResume = async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
    try {
      await context.resume?.(sessionId, log, entrypoint);
      onDone(undefined, { display: 'skip' });
    } catch (error) {
      logError(error as Error);
      onDone(`Failed to resume: ${(error as Error).message}`);
    }
  };

  const arg = args?.trim();

  // No argument provided - show picker
  if (!arg) {
    return <ResumeCommand key={Date.now()} onDone={onDone} onResume={onResume} />;
  }

  // Load logs to search (includes same-repo worktrees)
  const worktreePaths = await getWorktreePaths(getOriginalCwd());
  const logs = await loadSameRepoMessageLogs(worktreePaths);
  if (logs.length === 0) {
    const message = 'No conversations found to resume.';
    return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
  }

  // First, check if arg is a valid UUID
  const maybeSessionId = validateUuid(arg);
  if (maybeSessionId) {
    const matchingLogs = logs
      .filter(l => getSessionIdFromLog(l) === maybeSessionId)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());

    if (matchingLogs.length > 0) {
      const log = matchingLogs[0]!;
      const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
      void onResume(maybeSessionId, fullLog, 'slash_command_session_id');
      return null;
    }

    // Enriched logs didn't find it — try direct file lookup. This handles
    // sessions filtered out by enrichLogs (e.g., first message >16KB makes
    // firstPrompt extraction fail, causing the session to be dropped).
    const directLog = await getLastSessionLog(maybeSessionId);
    if (directLog) {
      void onResume(maybeSessionId, directLog, 'slash_command_session_id');
      return null;
    }
  }

  // Next, try exact custom title match (only if feature is enabled)
  if (isCustomTitleEnabled()) {
    const titleMatches = await searchSessionsByCustomTitle(arg, {
      exact: true,
    });
    if (titleMatches.length === 1) {
      const log = titleMatches[0]!;
      const sessionId = getSessionIdFromLog(log);
      if (sessionId) {
        const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
        void onResume(sessionId, fullLog, 'slash_command_title');
        return null;
      }
    }

    // Multiple matches - show error
    if (titleMatches.length > 1) {
      const message = resumeHelpMessage({
        resultType: 'multipleMatches',
        arg,
        count: titleMatches.length,
      });
      return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
    }
  }

  // No match found - show error
  const message = resumeHelpMessage({ resultType: 'sessionNotFound', arg });
  return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
};
