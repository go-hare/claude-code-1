import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useInterval } from 'usehooks-ts';
import type { CommandResultDisplay } from '../../commands.js';
import { Markdown } from '../../components/Markdown.js';
import { SpinnerGlyph } from '../../components/Spinner/SpinnerGlyph.js';
import { FORK_GLYPH } from '../../constants/figures.js';
import { getSystemPrompt } from '../../constants/prompts.js';
import { useModalOrTerminalSize } from '../../context/modalContext.js';
import { getSystemContext, getUserContext } from '../../context.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import {
  Box,
  Byline,
  type KeyboardEvent,
  KeyboardShortcutHint,
  type ScrollBoxHandle,
  ScrollBox,
  setClipboard,
  Text,
} from '@anthropic/ink';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { createAbortController } from '../../utils/abortController.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { errorMessage } from '../../utils/errors.js';
import { type CacheSafeParams, getLastCacheSafeParams } from '../../utils/forkedAgent.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js';
import {
  type BtwHistoryEntry,
  getBtwHistory,
  resetBtwHistory,
  runSideQuestion,
  type SideQuestionRetryInfo,
} from '../../utils/sideQuestion.js';
import { asSystemPrompt } from '../../utils/systemPromptType.js';
import { truncateToWidth } from '../../utils/truncate.js';
import { launchInSessionForkAgent } from '../fork/launchInSessionForkAgent.js';

type BtwComponentProps = {
  question: string;
  /** densable initialResponse — reopen path skips re-query and seeds response. */
  initialResponse?: string;
  context: ProcessUserInputContext;
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

const CHROME_ROWS = 5;
const OUTER_CHROME_ROWS = 6;
const SCROLL_LINES = 3;
/** densable wNo — max history rows shown in panel chrome. */
const HISTORY_VISIBLE = 5;

/**
 * densable bgr — collapse whitespace then width-truncate for history labels.
 */
function collapseAndTruncate(text: string, maxWidth: number): string {
  return truncateToWidth(text.replace(/\s+/g, ' ').trim(), maxWidth);
}

function statusLabel(status: number | undefined): string {
  switch (status) {
    case 429:
      return 'Rate limited';
    case 529:
      return 'API overloaded';
    case 401:
    case 403:
      return 'Authentication failed';
    default:
      return 'API error';
  }
}

function AnsweringStatus({
  frame,
  retry,
}: {
  frame: number;
  retry: (SideQuestionRetryInfo & { retryAt: number }) | null;
}): React.ReactNode {
  if (!retry) {
    return (
      <Box>
        <SpinnerGlyph frame={frame} messageColor="warning" />
        <Text color="warning">Answering…</Text>
      </Box>
    );
  }
  const secs = Math.max(0, Math.ceil((retry.retryAt - Date.now()) / 1000));
  return (
    <Box>
      <SpinnerGlyph frame={frame} messageColor="warning" />
      <Text color="warning">{statusLabel(retry.status)}</Text>
      <Text dimColor>
        {' '}
        · retrying in {secs}s · attempt {retry.retryAttempt}/{retry.maxRetries}
      </Text>
    </Box>
  );
}

/**
 * densable yXs — side-question panel with history list, reopen via initialResponse,
 * left/right history browse, c copy, f fork, x clear history.
 */
function BtwSideQuestion({ question, initialResponse, context, onDone }: BtwComponentProps): React.ReactNode {
  const [response, setResponse] = useState<string | null>(initialResponse ?? null);
  const [synthetic, setSynthetic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(SideQuestionRetryInfo & { retryAt: number }) | null>(null);
  const [frame, setFrame] = useState(0);
  // densable: when reopening (initialResponse set), history for list excludes current last entry
  const [history, setHistory] = useState<BtwHistoryEntry[]>(() =>
    initialResponse === undefined ? getBtwHistory() : getBtwHistory().slice(0, -1),
  );
  const historyRef = useRef(history);
  historyRef.current = history;
  const forkingRef = useRef(false);
  const [forking, setForking] = useState(false);
  const scrollRef = useRef<ScrollBoxHandle>(null);
  /** densable aUe / J8e — index into history list, or null = current question. */
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const historyCursorRef = useRef<number | null>(null);
  historyCursorRef.current = historyCursor;
  const [copiedFlash, setCopiedFlash] = useState(0);
  const { rows, columns } = useModalOrTerminalSize(useTerminalSize());

  // Animate spinner while loading
  useInterval(() => setFrame(f => f + 1), response || error ? null : 80);
  // densable _u — clear "Copied" flash after 2s
  useInterval(() => setCopiedFlash(0), copiedFlash ? 2000 : null);

  function resetBrowseScroll(): void {
    scrollRef.current?.scrollTo?.(0);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (forkingRef.current) {
      e.preventDefault();
      return;
    }

    const displayText =
      historyCursorRef.current !== null ? historyRef.current[historyCursorRef.current]?.response : response;

    if (e.key === 'escape' || e.key === 'return' || e.key === ' ' || (e.ctrl && (e.key === 'c' || e.key === 'd'))) {
      e.preventDefault();
      onDone(undefined, { display: 'skip' });
      return;
    }

    // densable left/right — browse history (last HISTORY_VISIBLE window + current)
    if (e.key === 'left' || e.key === 'right') {
      e.preventDefault();
      const len = historyRef.current.length;
      if (len === 0) return;
      const minCursor = Math.max(0, len - HISTORY_VISIBLE);
      const current = historyCursorRef.current ?? len;
      const next = Math.max(minCursor, Math.min(len, current + (e.key === 'left' ? -1 : 1)));
      if (next === current) return;
      const nextCursor = next === len ? null : next;
      historyCursorRef.current = nextCursor;
      setHistoryCursor(nextCursor);
      resetBrowseScroll();
      return;
    }

    // densable x — clear history; keep current answer if real
    if (e.key === 'x' && historyRef.current.length > 0) {
      e.preventDefault();
      const keep = response && !synthetic ? [{ question, response }] : ([] as BtwHistoryEntry[]);
      resetBtwHistory(keep);
      historyRef.current = [];
      setHistory([]);
      historyCursorRef.current = null;
      setHistoryCursor(null);
      resetBrowseScroll();
      return;
    }

    // densable c — copy current display text
    if (e.key === 'c' && !e.ctrl && !e.meta && displayText) {
      e.preventDefault();
      void setClipboard(displayText).then(() => {
        setCopiedFlash(n => n + 1);
      });
      return;
    }

    // densable f — fork current Q&A into in-session agent (when viewing current, real answer)
    if (e.key === 'f' && response && !synthetic && historyCursorRef.current === null) {
      e.preventDefault();
      forkingRef.current = true;
      setForking(true);
      void (async () => {
        try {
          const lastAssistant = [...context.messages].reverse().find(m => m.type === 'assistant');
          if (!lastAssistant) {
            forkingRef.current = false;
            setForking(false);
            onDone('Cannot fork before the first conversation turn', {
              display: 'system',
            });
            return;
          }
          // densable xZr(rie, …) with Q&A as seed — local launch uses question as directive
          const launched = await launchInSessionForkAgent(question, context, lastAssistant);
          if (launched) {
            onDone(`${FORK_GLYPH} forked ${launched.name} (${launched.agentId.slice(-4)})`, { display: 'system' });
          } else {
            forkingRef.current = false;
            setForking(false);
            onDone('Cannot fork before the first conversation turn', {
              display: 'system',
            });
          }
        } catch (err) {
          forkingRef.current = false;
          setForking(false);
          onDone(`Failed to fork: ${errorMessage(err)}`, { display: 'system' });
        }
      })();
      return;
    }

    if (e.key === 'up' || (e.ctrl && e.key === 'p')) {
      e.preventDefault();
      scrollRef.current?.scrollBy(-SCROLL_LINES);
    }
    if (e.key === 'down' || (e.ctrl && e.key === 'n')) {
      e.preventDefault();
      scrollRef.current?.scrollBy(SCROLL_LINES);
    }
  }

  useEffect(() => {
    // densable: if (CNt !== void 0) return — reopen path skips fetch
    if (initialResponse !== undefined) {
      return;
    }

    const abortController = createAbortController();

    async function fetchResponse(): Promise<void> {
      try {
        const cacheSafeParams = await buildCacheSafeParams(context);
        const result = await runSideQuestion({
          question,
          cacheSafeParams,
          parentController: abortController,
          onRetry: info => {
            if (abortController.signal.aborted) return;
            setRetry({ ...info, retryAt: Date.now() + info.retryInMs });
          },
        });

        if (!abortController.signal.aborted) {
          if (result.aborted) {
            return;
          }
          if (result.response) {
            setHistoryCursor(null);
            setError(null);
            setRetry(null);
            setResponse(result.response);
            setSynthetic(result.synthetic ?? false);
            // densable refreshes list from global after append inside xhr
            setHistory(getBtwHistory().slice(0, -1));
          } else {
            setHistoryCursor(null);
            setRetry(null);
            setError('No response received');
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setHistoryCursor(null);
          setRetry(null);
          setError(errorMessage(err) || 'Failed to get response');
        }
      }
    }

    void fetchResponse();

    return () => {
      abortController.abort();
    };
  }, [question, context, initialResponse]);

  const visibleHistory = history.slice(-HISTORY_VISIBLE);
  const earlierCount = history.length - visibleHistory.length;
  const browsingEntry = historyCursor !== null ? history[historyCursor] : null;
  const historyRows = visibleHistory.length + (earlierCount > 0 ? 1 : 0);
  const maxContentHeight = Math.max(5, rows - CHROME_ROWS - OUTER_CHROME_ROWS - historyRows);
  const labelWidth = Math.max(20, columns - 7);

  const titleColor = browsingEntry ? undefined : 'warning';
  const titleBold = !browsingEntry;
  const titleDim = !!browsingEntry;

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      {earlierCount > 0 && <Text dimColor>{`(+${earlierCount} earlier /btw)`}</Text>}
      {visibleHistory.map((entry, i) => {
        const absIndex = earlierCount + i;
        const selected = historyCursor === absIndex;
        return (
          <Text key={absIndex} dimColor={!selected} bold={selected}>
            {`/btw ${collapseAndTruncate(entry.question, labelWidth)}`}
          </Text>
        );
      })}
      <Box>
        <Text color={titleColor} bold={titleBold} dimColor={titleDim}>
          /btw{' '}
        </Text>
        <Text dimColor>{collapseAndTruncate(question, labelWidth)}</Text>
      </Box>
      <Box marginTop={1} marginLeft={2} maxHeight={maxContentHeight}>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1} stickyScroll={false}>
          {browsingEntry ? (
            <Markdown>{browsingEntry.response}</Markdown>
          ) : error ? (
            <Text color="error">{error}</Text>
          ) : response ? (
            <Markdown>{response}</Markdown>
          ) : (
            <AnsweringStatus frame={frame} retry={retry} />
          )}
        </ScrollBox>
      </Box>
      <Box marginTop={1}>
        {forking ? (
          <Text dimColor>Forking…</Text>
        ) : (
          <Text dimColor>
            <Byline>
              {history.length > 0 ? (
                <KeyboardShortcutHint shortcut="←/→" action="switch" />
              ) : (
                (browsingEntry || response || error) && <KeyboardShortcutHint shortcut="↑/↓" action="scroll" />
              )}
              {(browsingEntry || response) &&
                (copiedFlash > 0 ? (
                  <Text color="success">Copied to clipboard</Text>
                ) : (
                  <KeyboardShortcutHint shortcut="c" action="copy" />
                ))}
              {response && !synthetic && historyCursor === null && <KeyboardShortcutHint shortcut="f" action="fork" />}
              {history.length > 0 && <KeyboardShortcutHint shortcut="x" action="clear history" />}
              <KeyboardShortcutHint shortcut="esc" action="close" />
            </Byline>
          </Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Build CacheSafeParams for the side question fork.
 *
 * The preferred source is getLastCacheSafeParams — the exact
 * systemPrompt/userContext/systemContext bytes the main thread sent on its
 * last request (captured in stopHooks). Reusing them guarantees a byte-
 * identical prefix and thus a prompt cache hit. We pair these with the
 * current toolUseContext (for thinkingConfig/tools) and current messages
 * (for up-to-date context).
 *
 * Fallback (first turn before stop hooks fire, or prompt-suggestion
 * disabled): rebuild from scratch. This may miss the cache if the main loop
 * applied buildEffectiveSystemPrompt extras (--agent, --system-prompt,
 * --append-system-prompt, coordinator mode).
 */
function stripInProgressAssistantMessage(messages: Message[]): Message[] {
  const last = messages.at(-1);
  if (last?.type === 'assistant' && last.message!.stop_reason === null) {
    return messages.slice(0, -1);
  }
  return messages;
}

async function buildCacheSafeParams(context: ProcessUserInputContext): Promise<CacheSafeParams> {
  const forkContextMessages = getMessagesAfterCompactBoundary(stripInProgressAssistantMessage(context.messages));
  const saved = getLastCacheSafeParams();
  if (saved) {
    return {
      systemPrompt: saved.systemPrompt,
      userContext: saved.userContext,
      systemContext: saved.systemContext,
      toolUseContext: context,
      forkContextMessages,
    };
  }
  const [rawSystemPrompt, userContext, systemContext] = await Promise.all([
    getSystemPrompt(context.options.tools, context.options.mainLoopModel, [], context.options.mcpClients),
    getUserContext(),
    getSystemContext(),
  ]);
  return {
    systemPrompt: asSystemPrompt(rawSystemPrompt),
    userContext,
    systemContext,
    toolUseContext: context,
    forkContextMessages,
  };
}

/**
 * densable IO_ — bare `/btw` reopens last history entry with initialResponse;
 * non-empty args bump btwUseCount and open a fresh query panel.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ProcessUserInputContext,
  args: string,
): Promise<React.ReactNode> {
  const question = args?.trim();

  if (!question) {
    const last = getBtwHistory().at(-1);
    if (!last) {
      onDone('Usage: /btw <your question>', { display: 'system' });
      return null;
    }
    return (
      <BtwSideQuestion question={last.question} initialResponse={last.response} context={context} onDone={onDone} />
    );
  }

  saveGlobalConfig(current => ({
    ...current,
    btwUseCount: current.btwUseCount + 1,
  }));

  return <BtwSideQuestion question={question} context={context} onDone={onDone} />;
}
