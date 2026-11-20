import axios from 'axios';
import { readdir, readFile, stat } from 'fs/promises';
import { basename, dirname, join } from 'path';
import * as React from 'react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getIsRemoteMode, getLastAPIRequest, getSessionId } from 'src/bootstrap/state.js';
import { logEventTo1P } from 'src/services/analytics/firstPartyEventLogger.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { getLastAssistantMessage, normalizeMessagesForAPI } from 'src/utils/messages.js';
import type { CommandResultDisplay } from '../commands.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Byline, Dialog, KeyboardShortcutHint, StatusIcon, Text, useInput } from '@anthropic/ink';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { queryHaiku } from '../services/api/claude.js';
import { startsWithApiErrorPrefix } from '../services/api/errors.js';
import type { Message } from '../types/message.js';
import { checkAndRefreshOAuthTokenIfNeeded, getOauthAccountInfo, isAnthropicAuthEnabled } from '../utils/auth.js';
import { openBrowser } from '../utils/browser.js';
import { logForDebugging } from '../utils/debug.js';
import { env } from '../utils/env.js';
import type { FileStateCache } from '../utils/fileStateCache.js';
import { type GitRepoState, getGitState, getIsGit } from '../utils/git.js';
import { getAuthHeaders, getUserAgent } from '../utils/http.js';
import { getInMemoryErrors, logError } from '../utils/log.js';
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js';
import { formatFeedbackWithIssueFallback, getFeedbackCommandDisabledReason } from '../utils/feedbackDrafts/gates.js';
import {
  extractTeammateTranscriptsFromTasks,
  getTranscriptPath,
  loadAllSubagentTranscriptsFromDisk,
  MAX_TRANSCRIPT_READ_BYTES,
} from '../utils/sessionStorage.js';
import { jsonStringify } from '../utils/slowOperations.js';
import { asSystemPrompt } from '../utils/systemPromptType.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import TextInput from './TextInput.js';

// This value was determined experimentally by testing the URL length limit
const GITHUB_URL_LIMIT = 7250;
const GITHUB_ISSUES_REPO_URL =
  process.env.USER_TYPE === 'ant'
    ? 'https://github.com/anthropics/claude-cli-internal/issues'
    : 'https://github.com/anthropics/claude-code/issues';

type FeedbackScope = 'session' | 'day' | 'week';
type FeedbackMode = 'post' | 'bundle' | 'share';

const SCOPE_DESCRIPTIONS: Record<FeedbackScope, string> = {
  session: 'this session only',
  day: 'this session + this project’s other sessions from the last 24 hours',
  week: 'this session + this project’s other sessions from the last 7 days',
};

const SCOPE_OPTIONS: Array<{ label: string; value: FeedbackScope }> = [
  { label: 'This session only', value: 'session' },
  { label: 'This session + the last 24 hours', value: 'day' },
  { label: 'This session + the last 7 days', value: 'week' },
];

const RECENT_SESSION_SCOPE_MS: Record<Exclude<FeedbackScope, 'session'>, number> = {
  day: 86_400_000,
  week: 604_800_000,
};
const MAX_RECENT_SESSIONS_TOTAL_BYTES = 1_048_576;
const SESSION_OWNER_MARKER = '"type":"session-owner"';
const HISTORY_SUPPRESSION_MARKER = '"type":"history-suppression"';
const CREDENTIAL_ORG_MARKER = '"type":"credential_org"';
const ACCOUNT_UUID_RE = /"accountUuid":"([^"]*)"/;
const ORG_UUID_RE = /"organizationUuid":"([^"]*)"/;

export type TranscriptOwnershipAccount = {
  accountUuid?: string;
  organizationUuid?: string;
};

function safeParseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function sessionOwnerMatchesAccount(
  recorded: TranscriptOwnershipAccount,
  current: TranscriptOwnershipAccount | undefined,
): boolean {
  if (!current) return false;
  if (recorded.accountUuid && current.accountUuid) {
    if (recorded.accountUuid.toLowerCase() !== current.accountUuid.toLowerCase()) return false;
  } else if (recorded.accountUuid || current.accountUuid) {
    return false;
  }
  if (recorded.organizationUuid && current.organizationUuid) {
    return recorded.organizationUuid.toLowerCase() === current.organizationUuid.toLowerCase();
  }
  return recorded.organizationUuid === current.organizationUuid;
}

/**
 * Official 2.1.325 `Mut` (#2320): classify whether a transcript's JSONL lines
 * belong to the currently signed-in account, organization, another account/org,
 * or unknown.
 */
export function classifyTranscriptOwnership(
  lines: readonly string[],
  currentAccount: TranscriptOwnershipAccount | undefined,
  currentOrgUuid: string | undefined,
): 'account' | 'organization' | 'other' | 'unknown' {
  const normalizedOrg = currentOrgUuid?.toLowerCase();
  if (
    lines.some(
      line =>
        line.includes(HISTORY_SUPPRESSION_MARKER) ||
        (line.includes(CREDENTIAL_ORG_MARKER) &&
          (normalizedOrg === undefined || ORG_UUID_RE.exec(line)?.[1]?.toLowerCase() !== normalizedOrg)) ||
        (line.includes(SESSION_OWNER_MARKER) &&
          !sessionOwnerMatchesAccount(
            {
              accountUuid: ACCOUNT_UUID_RE.exec(line)?.[1],
              organizationUuid: ORG_UUID_RE.exec(line)?.[1],
            },
            currentAccount,
          )),
    )
  ) {
    return 'other';
  }
  if (lines.some(line => line.includes(SESSION_OWNER_MARKER) && safeParseJsonLine(line)?.type === 'session-owner')) {
    return 'account';
  }
  const hasMatchingOrg = lines.some(line => {
    if (!line.includes(CREDENTIAL_ORG_MARKER)) return false;
    const parsed = safeParseJsonLine(line);
    const att = parsed?.attachment as { type?: unknown } | undefined;
    return parsed?.type === 'attachment' && att?.type === 'credential_org';
  });
  return hasMatchingOrg ? 'organization' : 'unknown';
}

/**
 * Official 2.1.325 `Z1n` (#2320): returns true only when another session's
 * transcript was recorded by the signed-in account or organization.
 */
export function isTranscriptOwnedByCurrentAccountOrOrg(
  lines: readonly string[],
  currentAccount?: TranscriptOwnershipAccount,
  currentOrgUuid?: string,
): boolean {
  const acct =
    currentAccount ??
    (() => {
      const info = getOauthAccountInfo();
      return info ? { accountUuid: info.accountUuid, organizationUuid: info.organizationUuid } : undefined;
    })();
  const org =
    currentOrgUuid ??
    (isAnthropicAuthEnabled()
      ? (process.env.CLAUDE_CODE_OAUTH_TOKEN
          ? process.env.CLAUDE_CODE_ORGANIZATION_UUID
          : getOauthAccountInfo()?.organizationUuid
        )?.toLowerCase()
      : undefined);
  const verdict = classifyTranscriptOwnership(lines, acct, org);
  return verdict === 'account' || verdict === 'organization';
}

/**
 * Official 2.1.325 `Hn` (#2320): collect recent project sessions within the
 * chosen scope (`day` | `week`), withholding any session not recorded by the
 * currently signed-in account or organization.
 */
export async function loadRecentSessionTranscripts(
  currentTranscriptPath: string,
  scope: FeedbackScope,
  opts?: {
    currentAccount?: TranscriptOwnershipAccount;
    currentOrgUuid?: string;
    nowMs?: number;
  },
): Promise<Record<string, string> | undefined> {
  if (scope === 'session') return undefined;
  const dir = dirname(currentTranscriptPath);
  const currentName = basename(currentTranscriptPath);
  const cutoff = (opts?.nowMs ?? Date.now()) - RECENT_SESSION_SCOPE_MS[scope];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }
  const candidates: Array<{ path: string; sessionId: string; mtimeMs: number; size: number }> = [];
  await Promise.all(
    entries
      .filter(name => name.endsWith('.jsonl') && name !== currentName)
      .map(async name => {
        const fullPath = join(dir, name);
        try {
          const st = await stat(fullPath);
          if (st.isFile() && st.mtimeMs >= cutoff) {
            candidates.push({
              path: fullPath,
              sessionId: name.slice(0, -6),
              mtimeMs: st.mtimeMs,
              size: st.size,
            });
          }
        } catch {
          // skip unreadable file
        }
      }),
  );
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const transcripts: Record<string, string> = {};
  let totalBytes = 0;
  for (const item of candidates) {
    if (item.size === 0 || totalBytes + item.size > MAX_RECENT_SESSIONS_TOTAL_BYTES) continue;
    try {
      const content = await readFile(item.path, 'utf8');
      if (!content) continue;
      if (!isTranscriptOwnedByCurrentAccountOrOrg(content.split('\n'), opts?.currentAccount, opts?.currentOrgUuid)) {
        logForDebugging(`recent session ${item.sessionId} withheld: not_recorded_by_current_account`);
        continue;
      }
      transcripts[item.sessionId] = content;
      totalBytes += item.size;
    } catch {
      // skip unreadable session
    }
  }
  return Object.keys(transcripts).length > 0 ? transcripts : undefined;
}

const FEEDBACK_CANCELLED_MESSAGE = 'Feedback cancelled';

const MODE_COPY: Record<
  FeedbackMode,
  {
    consentAction: string;
    consentYes: string;
    consentIntro: string;
    consentFooter: string;
    submitting: string;
    stopped: string;
  }
> = {
  post: {
    consentAction: 'submit',
    consentYes: 'Yes, send it',
    consentIntro: 'This report will include:',
    consentFooter: 'We may use these to debug related issues and improve Claude Code.',
    submitting: 'Submitting report…',
    stopped: 'Stopped sending the report · Anthropic may already have it',
  },
  bundle: {
    consentAction: 'save',
    consentYes: 'Yes, save it',
    consentIntro: 'An archive will be saved to disk containing:',
    consentFooter:
      'Nothing leaves this machine until you send the bundle file. Secrets (API keys, tokens, credentials) are redacted before writing.',
    submitting: 'Saving bundle…',
    stopped: FEEDBACK_CANCELLED_MESSAGE,
  },
  share: {
    consentAction: 'share',
    consentYes: 'Yes, share it',
    consentIntro: 'This shared conversation will include:',
    consentFooter: 'A shareable link will be created so you can post the conversation for debugging and support.',
    submitting: 'Uploading share…',
    stopped: 'Stopped sharing the conversation · it may already be uploaded',
  },
};

/**
 * Official 2.1.328 (#608, SEA `X`): resolve the close/cancel result message so
 * closing `/bug` or `/feedback` after delivery NEVER says "cancelled".
 */
export function resolveFeedbackCloseMessage(params: {
  step: Step;
  mode: FeedbackMode;
  bundlePath?: string | null;
  error?: string | null;
}): { message: string | undefined; display: CommandResultDisplay } {
  const { step, mode, bundlePath, error } = params;
  if (step === 'done') {
    if (mode === 'share') {
      return { message: undefined, display: 'skip' };
    }
    if (error) {
      return { message: 'Error submitting feedback / bug report', display: 'system' };
    }
    if (mode === 'bundle' && bundlePath) {
      return { message: `Feedback bundle saved to \`${bundlePath}\``, display: 'system' };
    }
    return { message: 'Feedback / bug report submitted', display: 'system' };
  }
  if (step === 'submitting') {
    return { message: MODE_COPY[mode].stopped, display: 'system' };
  }
  return { message: FEEDBACK_CANCELLED_MESSAGE, display: 'system' };
}

/**
 * Official 2.1.328 (#668): Yes/No consent options with "No, edit the report"
 * first so repeated Enters never accidentally send a report.
 */
export function buildFeedbackConsentOptions(mode: FeedbackMode): Array<{ label: string; value: 'edit' | 'send' }> {
  return [
    { label: 'No, edit the report', value: 'edit' },
    { label: MODE_COPY[mode].consentYes, value: 'send' },
  ];
}

/**
 * Official 2.1.328 (#668): Done-step options with "Close" first so repeated
 * Enters never accidentally open GitHub.
 */
export function buildFeedbackDoneOptions(params: {
  hideGitHubIssue: boolean;
  title: string | null;
}): Array<{ label: string; value: 'close' | 'issue' }> {
  return [
    { label: 'Close', value: 'close' },
    ...(!params.hideGitHubIssue && params.title ? [{ label: 'Open a GitHub issue', value: 'issue' as const }] : []),
  ];
}

export type FeedbackSendSnapshot =
  | { status: 'none' }
  | { status: 'sending' }
  | { status: 'delivered'; referenceId: string }
  | { status: 'saved'; referenceId: string; bundlePath: string; transcriptProblem?: string }
  | { status: 'failed'; reason: string; final?: boolean };

export type FeedbackSendStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => FeedbackSendSnapshot;
  start: () => void;
  deliver: (referenceId: string) => void;
  save: (referenceId: string, bundlePath: string, transcriptProblem?: string) => void;
  fail: (reason: string, final?: boolean) => void;
  abandon: () => void;
};

/**
 * Official 2.1.292 (#221) `Me(mode)` — external send-state store so Ctrl+O /
 * Ctrl+Z unmount+remount while sending preserves progress instead of
 * restarting from userInput.
 */
export function createFeedbackSendStore(mode: FeedbackMode): FeedbackSendStore {
  let state: FeedbackSendSnapshot = { status: 'none' };
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = () => state;
  const setState = (updater: (prev: FeedbackSendSnapshot) => FeedbackSendSnapshot) => {
    const next = updater(state);
    if (Object.is(next, state)) return;
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };
  if (mode === 'share') {
    return {
      subscribe,
      getSnapshot,
      start() {},
      deliver() {},
      save() {},
      fail() {},
      abandon() {},
    };
  }
  return {
    subscribe,
    getSnapshot,
    start() {
      setState(() => ({ status: 'sending' }));
    },
    deliver(referenceId: string) {
      setState(() => ({ status: 'delivered', referenceId }));
    },
    save(referenceId: string, bundlePath: string, transcriptProblem?: string) {
      setState(() => ({
        status: 'saved',
        referenceId,
        bundlePath,
        ...(transcriptProblem !== undefined && { transcriptProblem }),
      }));
    },
    fail(reason: string, final?: boolean) {
      setState(prev =>
        prev.status === 'delivered' || prev.status === 'saved'
          ? prev
          : { status: 'failed', reason, ...(final === true && { final: true }) },
      );
    },
    abandon() {
      setState(prev => (prev.status === 'sending' ? { status: 'none' } : prev));
    },
  };
}

type Props = {
  abortSignal: AbortSignal;
  messages: Message[];
  initialDescription?: string;
  onDone(result?: string, options?: { display?: CommandResultDisplay }): void;
  backgroundTasks?: {
    [taskId: string]: {
      type: string;
      identity?: { agentId: string };
      messages?: Message[];
    };
  };
  mode?: FeedbackMode;
  readFileState?: FileStateCache;
  command?: string;
  send?: FeedbackSendStore;
};

type Step = 'userInput' | 'scope' | 'consent' | 'submitting' | 'done';

type FeedbackData = {
  // latestAssistantMessageId is the message ID from the latest main model call
  latestAssistantMessageId: string | null;
  message_count: number;
  datetime: string;
  description: string;
  platform: string;
  gitRepo: boolean;
  version: string | null;
  transcript: Message[];
  subagentTranscripts?: { [agentId: string]: Message[] };
  rawTranscriptJsonl?: string;
};

// Utility function to redact sensitive information from strings
export function redactSensitiveInfo(text: string): string {
  let redacted = text;

  // Anthropic API keys (sk-ant...) with or without quotes
  // First handle the case with quotes
  redacted = redacted.replace(/"(sk-ant[^\s"']{24,})"/g, '"[REDACTED_API_KEY]"');
  // Then handle the cases without quotes - more general pattern
  redacted = redacted.replace(
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .replace(re, string) on /bug path: no-match returns same string (Object.is)
    /(?<![A-Za-z0-9"'])(sk-ant-?[A-Za-z0-9_-]{10,})(?![A-Za-z0-9"'])/g,
    '[REDACTED_API_KEY]',
  );

  // AWS keys - AWSXXXX format - add the pattern we need for the test
  redacted = redacted.replace(/AWS key: "(AWS[A-Z0-9]{20,})"/g, 'AWS key: "[REDACTED_AWS_KEY]"');

  // AWS AKIAXXX keys
  redacted = redacted.replace(/(AKIA[A-Z0-9]{16})/g, '[REDACTED_AWS_KEY]');

  // Google Cloud keys
  redacted = redacted.replace(
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- same as above
    /(?<![A-Za-z0-9])(AIza[A-Za-z0-9_-]{35})(?![A-Za-z0-9])/g,
    '[REDACTED_GCP_KEY]',
  );

  // Vertex AI service account keys
  redacted = redacted.replace(
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- same as above
    /(?<![A-Za-z0-9])([a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com)(?![A-Za-z0-9])/g,
    '[REDACTED_GCP_SERVICE_ACCOUNT]',
  );

  // Generic API keys in headers
  redacted = redacted.replace(/(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\s)}\]]+/gi, '$1[REDACTED_API_KEY]');

  // Authorization headers and Bearer tokens
  redacted = redacted.replace(
    /(["']?authorization["']?\s*[:=]\s*["']?(bearer\s+)?)[^"',\s)}\]]+/gi,
    '$1[REDACTED_TOKEN]',
  );

  // AWS environment variables
  redacted = redacted.replace(/(AWS[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED_AWS_VALUE]');

  // GCP environment variables
  redacted = redacted.replace(/(GOOGLE[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED_GCP_VALUE]');

  // Environment variables with keys
  redacted = redacted.replace(
    /((API[-_]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi,
    '$1[REDACTED]',
  );

  return redacted;
}

// Get sanitized error logs with sensitive information redacted
function getSanitizedErrorLogs(): Array<{
  error?: string;
  timestamp?: string;
}> {
  // Sanitize error logs to remove any API keys
  return getInMemoryErrors().map(errorInfo => {
    // Create a copy of the error info to avoid modifying the original
    const errorCopy = { ...errorInfo } as { error?: string; timestamp?: string };

    // Sanitize error if present and is a string
    if (errorCopy && typeof errorCopy.error === 'string') {
      errorCopy.error = redactSensitiveInfo(errorCopy.error);
    }

    return errorCopy;
  });
}

async function loadRawTranscriptJsonl(): Promise<string | null> {
  try {
    const transcriptPath = getTranscriptPath();
    const { size } = await stat(transcriptPath);
    if (size > MAX_TRANSCRIPT_READ_BYTES) {
      logForDebugging(`Skipping raw transcript read: file too large (${size} bytes)`, { level: 'warn' });
      return null;
    }
    return await readFile(transcriptPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Official 2.1.326 #44: preserve typed `/feedback` draft across Ctrl+O/Ctrl+Z
 * remounts, cleared on submit or explicit cancel.
 */
const feedbackDraftBySession = new Map<string, string>();

export function getFeedbackDraft(sessionId: string): string {
  return feedbackDraftBySession.get(sessionId) ?? '';
}

export function setFeedbackDraft(sessionId: string, draft: string): void {
  if (draft.length === 0) {
    feedbackDraftBySession.delete(sessionId);
  } else {
    feedbackDraftBySession.set(sessionId, draft);
  }
}

export function clearFeedbackDraft(sessionId: string): void {
  feedbackDraftBySession.delete(sessionId);
}

export function Feedback({
  abortSignal,
  messages,
  initialDescription,
  onDone,
  backgroundTasks = {},
  mode = 'post',
  send,
}: Props): React.ReactNode {
  const sessionId = getSessionId();
  const [localStep, setStep] = useState<Step>('userInput');
  const initialDraft = initialDescription || getFeedbackDraft(sessionId);
  const [cursorOffset, setCursorOffset] = useState(initialDraft.length);
  const [description, setDescription] = useState(initialDraft);
  const [localFeedbackId, setFeedbackId] = useState<string | null>(null);
  const [localBundlePath] = useState<string | null>(null);
  const [localError, setError] = useState<string | null>(null);
  const [sendStore] = useState<FeedbackSendStore>(() => send ?? createFeedbackSendStore(mode));
  const sendSnapshot = useSyncExternalStore(sendStore.subscribe, sendStore.getSnapshot);
  const [userEdited, setUserEdited] = useState(false);
  const [frozenSnapshot, setFrozenSnapshot] = useState<FeedbackSendSnapshot | null>(null);

  const effectiveSnapshot = frozenSnapshot ?? sendSnapshot;
  const followSendStore = mode !== 'share' && !userEdited && effectiveSnapshot.status !== 'none';
  const step: Step =
    followSendStore && effectiveSnapshot.status !== 'failed'
      ? effectiveSnapshot.status === 'sending'
        ? 'submitting'
        : 'done'
      : localStep;
  const error =
    localError ?? (followSendStore && effectiveSnapshot.status === 'failed' ? effectiveSnapshot.reason : null);
  const feedbackId =
    followSendStore && (effectiveSnapshot.status === 'delivered' || effectiveSnapshot.status === 'saved')
      ? effectiveSnapshot.referenceId
      : localFeedbackId;
  const bundlePath =
    followSendStore && effectiveSnapshot.status === 'saved' ? effectiveSnapshot.bundlePath : localBundlePath;
  const isRemote = getIsRemoteMode();
  const [envInfo, setEnvInfo] = useState<{
    isGit: boolean;
    gitState: GitRepoState | null;
  }>({ isGit: false, gitState: null });
  const [title, setTitle] = useState<string | null>(null);
  const [scope, setScope] = useState<FeedbackScope>('session');
  const textInputColumns = useTerminalSize().columns - 4;
  const hideGitHubIssue = getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_lynx', false);

  useEffect(() => {
    if (isRemote) return;
    async function loadEnvInfo() {
      const isGit = await getIsGit();
      let gitState: GitRepoState | null = null;
      if (isGit) {
        gitState = await getGitState();
      }
      setEnvInfo({ isGit, gitState });
    }
    void loadEnvInfo();
  }, [isRemote]);

  const submitReport = useCallback(async () => {
    setStep('submitting');
    setError(null);
    setFeedbackId(null);
    sendStore.start();

    try {
      // Get sanitized errors for the report
      const sanitizedErrors = getSanitizedErrorLogs();

      // Extract last assistant message ID from messages array
      const lastAssistantMessage = getLastAssistantMessage(messages);
      const lastAssistantMessageId = lastAssistantMessage?.requestId ?? null;

      const [diskTranscripts, rawTranscriptJsonl, recentSessionTranscripts] = await Promise.all([
        loadAllSubagentTranscriptsFromDisk(),
        loadRawTranscriptJsonl(),
        isRemote ? Promise.resolve(undefined) : loadRecentSessionTranscripts(getTranscriptPath(), scope),
      ]);
      const teammateTranscripts = extractTeammateTranscriptsFromTasks(backgroundTasks);
      const subagentTranscripts = { ...diskTranscripts, ...teammateTranscripts };

      const reportData = {
        latestAssistantMessageId: lastAssistantMessageId,
        message_count: messages.length,
        datetime: new Date().toISOString(),
        description,
        platform: env.platform,
        gitRepo: envInfo.isGit,
        terminal: env.terminal,
        version: MACRO.VERSION,
        transcript: normalizeMessagesForAPI(messages),
        errors: sanitizedErrors,
        lastApiRequest: getLastAPIRequest(),
        ...(Object.keys(subagentTranscripts).length > 0 && {
          subagentTranscripts,
        }),
        ...(rawTranscriptJsonl && { rawTranscriptJsonl }),
        ...(recentSessionTranscripts && { recentSessionTranscripts }),
      };

      const [result, t] = await Promise.all([
        submitFeedback(reportData as FeedbackData, abortSignal),
        hideGitHubIssue ? Promise.resolve(null) : generateTitle(description, abortSignal),
      ]);

      if (abortSignal.aborted) return;

      setTitle(t);

      if (result.success) {
        if (result.feedbackId) {
          setFeedbackId(result.feedbackId);
          sendStore.deliver(result.feedbackId);
          logEvent('tengu_bug_report_submitted', {
            feedback_id: result.feedbackId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            last_assistant_message_id:
              lastAssistantMessageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          // 1P-only: freeform text approved for BQ. Join on feedback_id.
          logEventTo1P('tengu_bug_report_description', {
            feedback_id: result.feedbackId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            description: redactSensitiveInfo(description) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        } else {
          sendStore.deliver('');
        }
        clearFeedbackDraft(sessionId);
        setStep('done');
      } else {
        const failureReason = formatFeedbackFailureMessage(result);
        setError(failureReason);
        sendStore.fail(failureReason);
        // Stay on userInput step so user can retry with their content preserved
        setStep('userInput');
      }
    } finally {
      sendStore.abandon();
    }
  }, [
    abortSignal,
    backgroundTasks,
    description,
    envInfo.isGit,
    hideGitHubIssue,
    isRemote,
    messages,
    scope,
    sendStore,
    sessionId,
  ]);

  const handleCancel = useCallback(() => {
    clearFeedbackDraft(sessionId);
    // Official 2.1.328 (#608): after report delivery (`step === 'done'` or
    // delivered/saved snapshot), closing must report submitted/saved — never cancelled.
    const snap = sendStore.getSnapshot();
    const effectiveStep: Step =
      step === 'done' || snap.status === 'delivered' || snap.status === 'saved' ? 'done' : step;
    if (effectiveStep !== 'done' && followSendStore) {
      setFrozenSnapshot(prev => prev ?? snap);
    }
    const { message, display } = resolveFeedbackCloseMessage({
      step: effectiveStep,
      mode,
      bundlePath: bundlePath ?? (snap.status === 'saved' ? snap.bundlePath : null),
      error,
    });
    if (display === 'skip') {
      onDone(undefined, { display: 'skip' });
    } else {
      onDone(message, { display });
    }
  }, [step, mode, bundlePath, error, followSendStore, sendStore, onDone, sessionId]);

  // During text input, use Settings context where only Escape (not 'n') triggers confirm:no.
  // This allows typing 'n' in the text field while still supporting Escape to cancel.
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: step === 'userInput',
  });

  const isTerminalStep = step === 'done' || Boolean(error && step !== 'userInput');

  useInput((input, key) => {
    if (key.ctrl || key.meta) return;
    // Official 2.1.328 (#668): done-step actions use a Select ("Close" first,
    // "Open a GitHub issue" second), so Enter/arrows are handled by Select rather
    // than auto-opening GitHub on repeated Enters. Printable non-digit keys still close.
    if (step === 'done') {
      if (mode === 'share') return;
      if (
        !key.return &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow &&
        !key.escape &&
        input.length > 0 &&
        !/^\d$/.test(input) &&
        !/\p{Cc}/u.test(input)
      ) {
        handleCancel();
      }
      return;
    }

    // When in userInput step with error, allow user to edit and retry
    // (don't close on any keypress - they can still press Esc to cancel)
    if (error && step !== 'userInput') {
      onDone('Error submitting feedback / bug report', {
        display: 'system',
      });
      return;
    }

    if (step === 'consent') {
      if (key.leftArrow) {
        setStep(mode === 'share' || isRemote ? 'userInput' : 'scope');
        return;
      }
      // Official 2.1.328 (#668): submission is confirmed via the Yes/No Select below
      // ("No, edit the report" first) so repeated Enters never auto-send.
    }
  });

  return (
    <Dialog
      title="Submit feedback / bug report"
      onCancel={handleCancel}
      isCancelActive={step !== 'userInput' && !isTerminalStep}
      hideInputGuide={step === 'done' && mode !== 'share'}
      inputGuide={
        step === 'userInput' ? (
          <Byline>
            <KeyboardShortcutHint shortcut="enter" action="continue" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        ) : step === 'scope' ? (
          <Byline>
            <KeyboardShortcutHint shortcut="enter" action="choose" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        ) : step === 'consent' ? (
          <Byline>
            <KeyboardShortcutHint shortcut="enter" action={MODE_COPY[mode].consentAction} />
            <KeyboardShortcutHint shortcut="left" action="change" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        ) : step === 'submitting' ? (
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
        ) : step === 'done' ? (
          <Byline>
            <KeyboardShortcutHint shortcut="c" action="copy" />
            <KeyboardShortcutHint shortcut="enter" action="close" />
          </Byline>
        ) : null
      }
    >
      {step === 'userInput' && (
        <Box flexDirection="column" gap={1}>
          <Text>Describe the issue below:</Text>
          <TextInput
            value={description}
            onChange={value => {
              setDescription(value);
              setFeedbackDraft(sessionId, value);
              setUserEdited(true);
              // Clear error when user starts editing to allow retry
              if (error) {
                setError(null);
              }
            }}
            columns={textInputColumns}
            onSubmit={value => {
              setUserEdited(true);
              if (mode !== 'share' && !value.trim()) {
                setError('Please describe the issue before submitting.');
                return;
              }
              setError(null);
              setStep(mode === 'share' || isRemote ? 'consent' : 'scope');
            }}
            onExitMessage={show => {
              if (show) onDone('Feedback cancelled', { display: 'system' });
            }}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            showCursor
            focus
          />
          {error && (
            <Box flexDirection="column" gap={1}>
              <Text color="error">{error}</Text>
              <Text dimColor>Edit and press Enter to retry, or Esc to cancel</Text>
            </Box>
          )}
        </Box>
      )}

      {step === 'scope' && (
        <Box flexDirection="column" gap={1}>
          <Text>How much session history should we include?</Text>
          <Select
            options={SCOPE_OPTIONS}
            defaultFocusValue={scope}
            onChange={val => {
              setScope(val);
              setStep('consent');
            }}
            onCancel={handleCancel}
          />
        </Box>
      )}

      {step === 'consent' && (
        <Box flexDirection="column">
          <Text>{MODE_COPY[mode].consentIntro}</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              - Your feedback / bug description: <Text dimColor>{description}</Text>
            </Text>
            <Text>
              - Environment info:{' '}
              <Text dimColor>
                {env.platform}, {env.terminal}, v{MACRO.VERSION}
              </Text>
            </Text>
            {mode !== 'share' && isRemote && (
              <Text>
                - Remote workspace: <Text dimColor>git metadata is not collected from this machine</Text>
              </Text>
            )}
            {mode !== 'share' && envInfo.gitState && (
              <Text>
                - Git repo metadata:{' '}
                <Text dimColor>
                  {envInfo.gitState.branchName}
                  {envInfo.gitState.commitHash ? `, ${envInfo.gitState.commitHash.slice(0, 7)}` : ''}
                  {envInfo.gitState.remoteUrl ? ` @ ${envInfo.gitState.remoteUrl}` : ''}
                  {!envInfo.gitState.isHeadOnRemote && ', not synced'}
                  {!envInfo.gitState.isClean && ', has local changes'}
                </Text>
              </Text>
            )}
            <Text>
              - Session transcript:{' '}
              <Text dimColor>{mode === 'share' ? SCOPE_DESCRIPTIONS.session : SCOPE_DESCRIPTIONS[scope]}</Text>
            </Text>
            {mode !== 'share' && (
              <Text>
                - Recent error messages:{' '}
                <Text dimColor>up to the last 100 since you launched Claude Code (may include file paths)</Text>
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Text wrap="wrap" dimColor>
              {MODE_COPY[mode].consentFooter}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Select
              options={buildFeedbackConsentOptions(mode)}
              declineValue="edit"
              hideIndexes
              holdsFirstRow
              disablePrintableKeybindings
              onChange={value => {
                if (value === 'edit') {
                  setStep('userInput');
                } else {
                  void submitReport();
                }
              }}
              onCancel={handleCancel}
            />
          </Box>
        </Box>
      )}

      {step === 'submitting' && (
        <Box flexDirection="row" gap={1}>
          <Text>{MODE_COPY[mode].submitting}</Text>
        </Box>
      )}

      {step === 'done' && mode === 'bundle' && (
        <Box flexDirection="column">
          <Text color="success">
            <StatusIcon status="success" withSpace />
            Feedback bundle saved
          </Text>
          {bundlePath && (
            <Box marginTop={1} flexDirection="column">
              <Text>
                Bundle: <Text dimColor>{bundlePath}</Text>
              </Text>
              <Text>
                Reference ID: <Text dimColor>{feedbackId}</Text>
              </Text>
              <Box marginTop={1}>
                <Text wrap="wrap">
                  Send this file to your Anthropic account representative or attach it to your support request.
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {step === 'done' &&
        mode === 'post' &&
        (hideGitHubIssue ? (
          <Box flexDirection="column">
            {error ? (
              <Text color="error">{error}</Text>
            ) : (
              <Text color="success">
                <StatusIcon status="success" withSpace />
                Feedback sent
              </Text>
            )}
            {feedbackId && (
              <>
                <Box marginTop={1}>
                  <Text>
                    Reference ID: <Text dimColor>{feedbackId}</Text>
                  </Text>
                </Box>
                <Box marginTop={1}>
                  <Text wrap="wrap">If you&apos;re working with Anthropic support, please include the ID above.</Text>
                </Box>
              </>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            {error ? <Text color="error">{error}</Text> : <Text color="success">Thank you for your report!</Text>}
            {feedbackId && <Text dimColor>Feedback ID: {feedbackId}</Text>}
          </Box>
        ))}

      {step === 'done' && mode !== 'share' && (
        <Box marginTop={1}>
          <Select
            options={buildFeedbackDoneOptions({ hideGitHubIssue, title })}
            hideIndexes
            holdsFirstRow
            onChange={value => {
              if (value === 'issue' && title) {
                const issueUrl = createGitHubIssueUrl(feedbackId ?? '', title, description, getSanitizedErrorLogs());
                void openBrowser(issueUrl);
              }
              handleCancel();
            }}
            onCancel={handleCancel}
          />
        </Box>
      )}
    </Dialog>
  );
}

export function createGitHubIssueUrl(
  feedbackId: string,
  title: string,
  description: string,
  errors: Array<{
    error?: string;
    timestamp?: string;
  }>,
): string {
  const sanitizedTitle = redactSensitiveInfo(title);
  const sanitizedDescription = redactSensitiveInfo(description);

  const bodyPrefix =
    `**Bug Description**\n${sanitizedDescription}\n\n` +
    `**Environment Info**\n` +
    `- Platform: ${env.platform}\n` +
    `- Terminal: ${env.terminal}\n` +
    `- Version: ${MACRO.VERSION || 'unknown'}\n` +
    `- Feedback ID: ${feedbackId}\n` +
    `\n**Errors**\n\`\`\`json\n`;
  const errorSuffix = `\n\`\`\`\n`;
  const errorsJson = jsonStringify(errors);

  const baseUrl = `${GITHUB_ISSUES_REPO_URL}/new?title=${encodeURIComponent(sanitizedTitle)}&labels=user-reported,bug&body=`;
  const truncationNote = `\n**Note:** Content was truncated.\n`;

  const encodedPrefix = encodeURIComponent(bodyPrefix);
  const encodedSuffix = encodeURIComponent(errorSuffix);
  const encodedNote = encodeURIComponent(truncationNote);
  const encodedErrors = encodeURIComponent(errorsJson);

  // Calculate space available for errors
  const spaceForErrors =
    GITHUB_URL_LIMIT - baseUrl.length - encodedPrefix.length - encodedSuffix.length - encodedNote.length;

  // If description alone exceeds limit, truncate everything
  if (spaceForErrors <= 0) {
    const ellipsis = encodeURIComponent('…');
    const buffer = 50; // Extra safety margin
    const maxEncodedLength = GITHUB_URL_LIMIT - baseUrl.length - ellipsis.length - encodedNote.length - buffer;
    const fullBody = bodyPrefix + errorsJson + errorSuffix;
    let encodedFullBody = encodeURIComponent(fullBody);

    if (encodedFullBody.length > maxEncodedLength) {
      encodedFullBody = encodedFullBody.slice(0, maxEncodedLength);
      // Don't cut in middle of %XX sequence
      const lastPercent = encodedFullBody.lastIndexOf('%');
      if (lastPercent >= encodedFullBody.length - 2) {
        encodedFullBody = encodedFullBody.slice(0, lastPercent);
      }
    }

    return baseUrl + encodedFullBody + ellipsis + encodedNote;
  }

  // If errors fit, no truncation needed
  if (encodedErrors.length <= spaceForErrors) {
    return baseUrl + encodedPrefix + encodedErrors + encodedSuffix;
  }

  // Truncate errors to fit (prioritize keeping description)
  // Slice encoded errors directly, then trim to avoid cutting %XX sequences
  const ellipsis = encodeURIComponent('…');
  const buffer = 50; // Extra safety margin
  let truncatedEncodedErrors = encodedErrors.slice(0, spaceForErrors - ellipsis.length - buffer);
  // If we cut in middle of %XX, back up to before the %
  const lastPercent = truncatedEncodedErrors.lastIndexOf('%');
  if (lastPercent >= truncatedEncodedErrors.length - 2) {
    truncatedEncodedErrors = truncatedEncodedErrors.slice(0, lastPercent);
  }

  return baseUrl + encodedPrefix + truncatedEncodedErrors + ellipsis + encodedSuffix + encodedNote;
}

async function generateTitle(description: string, abortSignal: AbortSignal): Promise<string> {
  try {
    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([
        'Generate a concise, technical issue title (max 80 chars) for a public GitHub issue based on this bug report for Claude Code.',
        'Claude Code is an agentic coding CLI based on the Anthropic API.',
        'The title should:',
        '- Include the type of issue [Bug] or [Feature Request] as the first thing in the title',
        '- Be concise, specific and descriptive of the actual problem',
        '- Use technical terminology appropriate for a software issue',
        '- For error messages, extract the key error (e.g., "Missing Tool Result Block" rather than the full message)',
        '- Be direct and clear for developers to understand the problem',
        '- If you cannot determine a clear issue, use "Bug Report: [brief description]"',
        '- Any LLM API errors are from the Anthropic API, not from any other model provider',
        'Your response will be directly used as the title of the Github issue, and as such should not contain any other commentary or explaination',
        'Examples of good titles include: "[Bug] Auto-Compact triggers to soon", "[Bug] Anthropic API Error: Missing Tool Result Block", "[Bug] Error: Invalid Model Name for Opus"',
      ]),
      userPrompt: description,
      signal: abortSignal,
      options: {
        hasAppendSystemPrompt: false,
        toolChoice: undefined,
        isNonInteractiveSession: false,
        agents: [],
        querySource: 'feedback',
        mcpTools: [],
      },
    });

    const _firstBlock = response?.message?.content?.[0] as unknown as Record<string, unknown> | undefined;
    const title = _firstBlock?.type === 'text' ? (_firstBlock.text as string) : 'Bug Report';

    // Check if the title contains an API error message
    if (startsWithApiErrorPrefix(title)) {
      return createFallbackTitle(description);
    }

    return title;
  } catch (error) {
    // If there's any error in title generation, use a fallback title
    logError(error);
    return createFallbackTitle(description);
  }
}

function createFallbackTitle(description: string): string {
  // Create a safe fallback title based on the bug description

  // Try to extract a meaningful title from the first line
  const firstLine = description.split('\n')[0] || '';

  // If the first line is very short, use it directly
  if (firstLine.length <= 60 && firstLine.length > 5) {
    return firstLine;
  }

  // For longer descriptions, create a truncated version
  // Truncate at word boundaries when possible
  let truncated = firstLine.slice(0, 60);
  if (firstLine.length > 60) {
    // Find the last space before the 60 char limit
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 30) {
      // Only trim at word if we're not cutting too much
      truncated = truncated.slice(0, lastSpace);
    }
    truncated += '...';
  }

  return truncated.length < 10 ? 'Bug Report' : truncated;
}

// Helper function to sanitize and log errors without exposing API keys
function sanitizeAndLogError(err: unknown): void {
  if (err instanceof Error) {
    // Create a copy with potentially sensitive info redacted
    const safeError = new Error(redactSensitiveInfo(err.message));

    // Also redact the stack trace if present
    if (err.stack) {
      safeError.stack = redactSensitiveInfo(err.stack);
    }

    logError(safeError);
  } else {
    // For non-Error objects, convert to string and redact sensitive info
    const errorString = redactSensitiveInfo(String(err));
    logError(new Error(errorString));
  }
}

export type FeedbackRefusal = {
  kind: 'org' | 'credential' | 'transient' | 'other';
  serverMessage?: string;
  thirdParty?: boolean;
};

export type FeedbackSubmitResult = {
  success: boolean;
  feedbackId?: string;
  isZdrOrg?: boolean;
  payloadTooLarge?: boolean;
  failureReason?: string;
  statusCode?: number;
  refusal?: FeedbackRefusal;
};

const FEEDBACK_NOT_ENABLED_MSG = 'Feedback has not been enabled for your organization.';
const FEEDBACK_POLICY_DISABLED_MSG = "Feedback submission is disabled by your organization's policy.";
const ZDR_ORG_MSG = 'Feedback collection is not available for organizations with custom data retention policies.';

export function parseFeedbackHttpError(status: number, errorData: unknown): FeedbackSubmitResult {
  const errObj =
    errorData !== null && typeof errorData === 'object' && 'error' in errorData
      ? (errorData as { error?: { type?: string; message?: string; details?: { error_code?: string } } }).error
      : undefined;
  const errorCode = errObj?.details?.error_code;
  const message = typeof errObj?.message === 'string' ? errObj.message.trim() || undefined : undefined;

  if (
    errorCode === 'feedback_retention_blocked' ||
    (errorCode === undefined &&
      status === 403 &&
      errObj?.type === 'permission_error' &&
      message?.includes('Custom data retention settings'))
  ) {
    return {
      success: false,
      isZdrOrg: true,
      failureReason: 'zdr_org',
      statusCode: status,
      refusal: { kind: 'org', serverMessage: message },
    };
  }

  if (
    errorCode === 'feedback_disabled' ||
    errorCode === 'feedback_third_party_blocked' ||
    (errorCode === undefined &&
      status === 403 &&
      (message === FEEDBACK_NOT_ENABLED_MSG || message === FEEDBACK_POLICY_DISABLED_MSG))
  ) {
    return {
      success: false,
      failureReason: 'org_refused',
      statusCode: status,
      refusal: {
        kind: 'org',
        serverMessage: message,
        ...(errorCode === 'feedback_third_party_blocked' && { thirdParty: true }),
      },
    };
  }

  if (errorCode === 'oauth_scope_insufficient' || status === 401) {
    return {
      success: false,
      failureReason: errorCode === 'oauth_scope_insufficient' ? 'scope_refused' : 'auth_refused',
      statusCode: status,
      refusal: { kind: 'credential', serverMessage: message },
    };
  }

  const isTransient = errorCode === 'feedback_check_unavailable' || status === 408 || status === 429 || status >= 500;
  return {
    success: false,
    failureReason: 'http_error',
    statusCode: status,
    refusal: { kind: isTransient ? 'transient' : 'other', serverMessage: message },
  };
}

function formatServerStatusSuffix(result: FeedbackSubmitResult): string | undefined {
  if (!result.statusCode) return undefined;
  const serverMsg = result.refusal?.serverMessage?.replace(/\.$/, '');
  return ` (server returned ${result.statusCode}${serverMsg === undefined ? '' : `: ${serverMsg}`})`;
}

/** Official 2.1.309 (#1142): format org/credential/HTTP refusal with server reason + GitHub issues fallback. */
export function formatFeedbackFailureMessage(result: FeedbackSubmitResult): string {
  const orgMsg = result.isZdrOrg
    ? ZDR_ORG_MSG
    : result.refusal?.kind === 'org'
      ? (result.refusal.serverMessage ?? 'Your organization does not accept feedback.')
      : undefined;
  if (orgMsg !== undefined) {
    return formatFeedbackWithIssueFallback(`Couldn't send feedback: ${orgMsg}`, orgMsg);
  }
  if (result.refusal?.kind === 'credential') {
    const suffix = formatServerStatusSuffix(result) ?? '';
    return result.failureReason === 'scope_refused'
      ? `Couldn't send feedback: the sign-in this session uses is not allowed to send feedback${suffix}.`
      : `Couldn't send feedback: the server did not accept the credentials this session uses${suffix}.`;
  }
  if (result.failureReason === 'auth_error') {
    return "Couldn't send feedback: not signed in. Run /login, then retry.";
  }
  if (result.failureReason === 'policy_blocked') {
    return getFeedbackCommandDisabledReason('/feedback') ?? "Feedback is disabled by your organization's policy.";
  }
  const detail =
    formatServerStatusSuffix(result) ??
    (result.failureReason === 'timeout'
      ? ' (request timed out)'
      : result.payloadTooLarge
        ? ' (report was too large to send)'
        : result.failureReason === 'network_error'
          ? " (couldn't reach the service)"
          : '');
  return `Couldn't send feedback${detail}. If it keeps failing, you can file at ${GITHUB_ISSUES_REPO_URL} instead.`;
}

/**
 * Official 2.1.323 (#2087): classify axios/fetch timeout errors (`ECONNABORTED`,
 * `ETIMEDOUT`, `TimeoutError`) as `'timeout'` so they are never misreported as
 * payload-too-large.
 */
export function isFeedbackTimeoutError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    return err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return true;
  }
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return code === 'ECONNABORTED' || code === 'ETIMEDOUT';
  }
  return false;
}

async function postFeedbackPayload(data: FeedbackData, signal?: AbortSignal): Promise<FeedbackSubmitResult> {
  try {
    // Ensure OAuth token is fresh before getting auth headers
    // This prevents 401 errors from stale cached tokens
    await checkAndRefreshOAuthTokenIfNeeded();

    const authResult = getAuthHeaders();
    if (authResult.error) {
      return { success: false, failureReason: 'auth_error' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getUserAgent(),
      ...authResult.headers,
    };

    const serialized = jsonStringify(data);
    const response = await axios.post(
      'https://api.anthropic.com/api/claude_cli_feedback',
      {
        content: serialized,
      },
      {
        headers,
        timeout: 30000, // 30 second timeout to prevent hanging
        signal,
      },
    );

    if (response.status === 200) {
      const result = response.data;
      if (result?.feedback_id) {
        return { success: true, feedbackId: result.feedback_id };
      }
      sanitizeAndLogError(new Error('Failed to submit feedback: request did not return feedback_id'));
      return { success: false, failureReason: 'missing_feedback_id' };
    }

    if (response.status === 413) {
      return { success: false, payloadTooLarge: true, failureReason: 'payload_too_large_413', statusCode: 413 };
    }

    sanitizeAndLogError(new Error('Failed to submit feedback:' + response.status));
    return parseFeedbackHttpError(response.status, response.data);
  } catch (err) {
    // Handle cancellation/abort - don't log as error
    if (axios.isCancel(err)) {
      return { success: false };
    }
    if (err instanceof RangeError) {
      return { success: false, payloadTooLarge: true, failureReason: 'payload_too_large_range_error' };
    }
    if (axios.isAxiosError(err) && err.response) {
      if (err.response.status === 413) {
        return { success: false, payloadTooLarge: true, failureReason: 'payload_too_large_413', statusCode: 413 };
      }
      const parsed = parseFeedbackHttpError(err.response.status, err.response.data);
      if (parsed.isZdrOrg) {
        sanitizeAndLogError(new Error('Cannot submit feedback because custom data retention settings are enabled'));
      } else {
        sanitizeAndLogError(err);
      }
      return parsed;
    }
    sanitizeAndLogError(err);
    if (isFeedbackTimeoutError(err)) {
      return { success: false, failureReason: 'timeout' };
    }
    if (axios.isAxiosError(err)) {
      return { success: false, failureReason: 'network_error' };
    }
    return { success: false };
  }
}

// Official 2.1.323 $s (#2087): only retry a timed-out send with stripped
// transcript when the serialized payload is large (>1/8 of the 10MB ceiling),
// and never convert a timeout into a payloadTooLarge error.
const TIMEOUT_STRIP_THRESHOLD_BYTES = Math.floor((10 * 1024 * 1024) / 8);

/**
 * Official 2.1.309 (#1143) & 2.1.323 (#2087): if the initial submission fails
 * because the payload is too large (413 or RangeError), strip `transcript` and
 * resend. If it times out on a large payload, retry stripped, but if the retry
 * also times out report `'timeout'` — never misreporting timeout as too large.
 */
export async function submitFeedback(
  data: FeedbackData,
  signal?: AbortSignal,
  sender: (payload: FeedbackData, signal?: AbortSignal) => Promise<FeedbackSubmitResult> = postFeedbackPayload,
): Promise<FeedbackSubmitResult> {
  if (isEssentialTrafficOnly()) {
    return { success: false };
  }
  const first = await sender(data, signal);
  if (!first.success && first.payloadTooLarge && data.transcript.length > 0) {
    return sender({ ...data, transcript: [] }, signal);
  }
  if (!first.success && first.failureReason === 'timeout' && data.transcript.length > 0) {
    let serializedLen = 0;
    try {
      serializedLen = jsonStringify(data).length;
    } catch {
      serializedLen = TIMEOUT_STRIP_THRESHOLD_BYTES + 1;
    }
    if (serializedLen > TIMEOUT_STRIP_THRESHOLD_BYTES) {
      return sender({ ...data, transcript: [] }, signal);
    }
  }
  return first;
}
