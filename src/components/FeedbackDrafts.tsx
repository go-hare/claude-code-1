import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import chalk from 'chalk';
import figures from 'figures';
import {
  AccessibilityContext,
  Box,
  Byline,
  Dialog,
  KeyboardShortcutHint,
  StatusIcon,
  Text,
  useInput,
  useIsInsideModal,
  useModalOrTerminalSize,
  wrapAnsi,
} from '@anthropic/ink';
import type { CommandResultDisplay } from '../commands.js';
import { useSessionServices } from '../context/sessionServices.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js';
import { getSessionId } from '../bootstrap/state.js';
import type { Message } from '../types/message.js';
import {
  FEEDBACK_FAILURE_MODES,
  FEEDBACK_TASK_CATEGORIES,
  FEEDBACK_TYPES,
  MAX_DETAILS_BYTES,
  type FeedbackFailureMode,
  type FeedbackTaskCategory,
  type FeedbackType,
} from '../utils/feedbackDrafts/constants.js';
import type { FeedbackDraft } from '../utils/feedbackDrafts/draft.js';
import { setSeededSessionDraftCount } from '../utils/feedbackDrafts/notice.js';
import { submitQueuedFeedbackDraft } from '../utils/feedbackDrafts/submitDraft.js';
import { discardFeedbackDraft, listFeedbackDrafts, writeFeedbackDraft } from '../utils/feedbackDrafts/writeDraft.js';
import { plural } from '../utils/stringUtils.js';
import { ItemList } from './ItemList.js';
import { Markdown } from './Markdown.js';
import TextInput from './TextInput.js';

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'bug',
  idea: 'idea',
  missing_capability: 'missing capability',
};
const FAILURE_MODE_OPTIONS: Array<FeedbackFailureMode | undefined> = [undefined, ...FEEDBACK_FAILURE_MODES];
const TASK_CATEGORY_OPTIONS: Array<FeedbackTaskCategory | undefined> = [undefined, ...FEEDBACK_TASK_CATEGORIES];
/** densable leftover Ue */
const FIELD_DEBOUNCE_MS = 500;

type ReviewField = 'type' | 'title' | 'area' | 'failure_mode' | 'task_category' | 'details' | 'transcript' | 'send';
type PanelMode = 'list' | 'review' | 'submitting' | 'receipt';
type ReviewForm = {
  type: FeedbackType;
  title: string;
  area: string;
  failureMode: FeedbackFailureMode | undefined;
  taskCategory: FeedbackTaskCategory | undefined;
  details: string;
};

type Props = {
  messages: Message[];
  onDone(result?: string, options?: { display?: CommandResultDisplay }): void;
  abortSignal: AbortSignal;
  onWriteNew?: () => void;
};

/** densable leftover vt */
export function formatFeedbackEnumValue(value: string | undefined): string {
  return value === undefined ? '(none)' : value.replace(/_/g, ' ');
}

/** densable leftover Dt */
export function reviewFieldIds(draft: { transcriptAvailable?: boolean }): ReviewField[] {
  return [
    'type',
    'title',
    'area',
    'failure_mode',
    'task_category',
    'details',
    ...(draft.transcriptAvailable ? (['transcript'] as const) : []),
    'send',
  ];
}

/** densable leftover tt */
export function formatDraftAge(createdAt: string, now = Date.now()): string {
  const delta = now - Date.parse(createdAt);
  if (!Number.isFinite(delta) || delta < 0) return 'now';
  const minutes = Math.floor(delta / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** densable leftover _t */
export function sanitizeFeedbackField(value: string, multiline: boolean): string {
  return value
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map(line => line)
    .join(multiline ? '\n' : ' ');
}

const DETAILS_LIMIT_ERROR = `That edit would push Details past the ${Math.floor(MAX_DETAILS_BYTES / 1024)}KB limit. Trim the details first.`;
const REVIEW_PRIVACY_FOOTER =
  'We may use these reports to debug related issues and improve Claude Code. Turn off Claude-drafted feedback anytime in /config.';
const WRITE_NEW_LABEL = '+ Write new feedback';
const LIST_INLINE_RESERVE_ROWS = 6;
const LIST_CHROME_ROWS = 3;
const LIST_MIN_ROWS = 5;

function formatScreenReaderDetails(value: string, columns: number, preview = false): string {
  if (value.trim() === '') return 'Details empty.';
  const lines = value.split('\n');
  const width = Math.max(1, columns - 6);
  const wrapped = lines.flatMap(line => wrapAnsi(line, width, { hard: true, trim: false }).split('\n'));
  return [
    preview
      ? `Draft preview, ${lines.length} ${plural(lines.length, 'line')}:`
      : `${lines.length} ${plural(lines.length, 'line')}:`,
    ...wrapped.map(line => `> ${line}`),
    preview ? 'End of preview. Review the full draft with /feedback.' : 'End of details.',
  ].join('\n');
}

function truncateDetailsRows(value: string, columns: number, maxRows: number): string {
  const out: string[] = [];
  let used = 0;
  const width = Math.max(1, columns);
  for (const line of value.split('\n')) {
    const wrapped = wrapAnsi(line, width, { hard: true, trim: false }).split('\n');
    if (used + wrapped.length <= maxRows) {
      out.push(line);
      used += wrapped.length;
      continue;
    }
    const remaining = maxRows - used;
    if (remaining > 0) {
      out.push(wrapped.slice(0, remaining).join('').trimEnd());
    }
    out.push('…');
    return out.join('\n');
  }
  return value;
}

/** densable nAt */
export function FeedbackDetailsBox({
  value,
  bold,
  dim,
  columns,
  maxRows,
  preview,
}: {
  value: string;
  bold?: boolean;
  dim?: boolean;
  columns: number;
  maxRows?: number;
  preview?: boolean;
}): React.ReactNode {
  const screenReader = useContext(AccessibilityContext);
  const sanitized = sanitizeFeedbackField(value, true);
  const text = maxRows === undefined ? sanitized : truncateDetailsRows(sanitized, Math.max(1, columns - 2), maxRows);
  return (
    <Box
      borderStyle={screenReader ? undefined : 'single'}
      borderLeft
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderDimColor
      paddingLeft={screenReader ? 0 : 1}
      flexDirection="column"
    >
      {screenReader ? (
        <Text bold={bold} dimColor={dim} wrap="wrap">
          {formatScreenReaderDetails(text, columns, preview)}
        </Text>
      ) : chalk.level === 0 ? (
        <Text bold={bold} dimColor={dim} wrap="wrap">
          {text}
        </Text>
      ) : (
        <Markdown promptMode skipTokenCache>
          {text}
        </Markdown>
      )}
    </Box>
  );
}

function FocusTick({ isFocused }: { isFocused: boolean }): React.ReactNode {
  return <Text color={isFocused ? 'suggestion' : undefined}>{isFocused ? `${figures.pointer} ` : '  '}</Text>;
}

function EnumValue({ value, isFocused }: { value: string; isFocused: boolean }): React.ReactNode {
  if (!isFocused) return <Text dimColor>{value}</Text>;
  return (
    <Text>
      <Text dimColor>{figures.triangleLeft} </Text>
      {value}
      <Text dimColor> {figures.triangleRight}</Text>
    </Text>
  );
}

function WriteNewRow({ isSelected }: { isSelected: boolean }): React.ReactNode {
  return (
    <Text color={isSelected ? 'suggestion' : undefined}>
      {isSelected ? `${figures.pointer} ` : '  '}
      {WRITE_NEW_LABEL}
    </Text>
  );
}

/** densable Me */
export function formatDraftMeta(draft: FeedbackDraft): string[] {
  return [
    TYPE_LABELS[draft.type],
    formatDraftAge(draft.created_at),
    sanitizeFeedbackField(draft.cwd, false),
    draft.transcriptAvailable ? 'transcript available' : 'transcript expired (report only)',
  ];
}

function DraftList({
  thisSession,
  others,
  hasWriteNew,
  defaultFocusIndex,
  onFocus,
  onOpen,
  onWriteNew,
}: {
  thisSession: FeedbackDraft[];
  others: FeedbackDraft[];
  hasWriteNew: boolean;
  defaultFocusIndex: number;
  onFocus: (index: number) => void;
  onOpen: (draft: FeedbackDraft) => void;
  onWriteNew: () => void;
}): React.ReactNode {
  const { rows } = useModalOrTerminalSize(useTerminalSize());
  const insideModal = useIsInsideModal();
  const ordered = useMemo(() => [...thisSession, ...others], [thisSession, others]);
  const totalLines =
    (thisSession.length > 0 ? 1 : 0) + (others.length > 0 ? 1 : 0) + ordered.length + (hasWriteNew ? 2 : 0);
  const budget = Math.max(LIST_MIN_ROWS, rows - LIST_CHROME_ROWS - (insideModal ? 0 : LIST_INLINE_RESERVE_ROWS));
  const visibleOptionCount = totalLines > budget ? budget - 2 : budget;

  const { options, selectableIndexByOptionIndex, optionIndexBySelectableIndex } = useMemo(() => {
    const built: Array<{
      heading?: boolean;
      value: string;
      label: React.ReactNode;
      facts?: readonly string[];
    }> = [];
    const optToSel = new Map<number, number>();
    const selToOpt = new Map<number, number>();
    let selIdx = 0;

    if (thisSession.length > 0) {
      built.push({
        heading: true,
        value: 'this-session',
        label: <Text bold>This session</Text>,
      });
      for (const draft of thisSession) {
        const optIdx = built.length;
        optToSel.set(optIdx, selIdx);
        selToOpt.set(selIdx, optIdx);
        selIdx++;
        built.push({
          value: draft.draft_id,
          label: sanitizeFeedbackField(draft.title, false),
          facts: formatDraftMeta(draft),
        });
      }
    }

    if (others.length > 0) {
      built.push({
        heading: true,
        value: 'other-sessions',
        label: <Text bold>Other sessions</Text>,
      });
      for (const draft of others) {
        const optIdx = built.length;
        optToSel.set(optIdx, selIdx);
        selToOpt.set(selIdx, optIdx);
        selIdx++;
        built.push({
          value: draft.draft_id,
          label: sanitizeFeedbackField(draft.title, false),
          facts: formatDraftMeta(draft),
        });
      }
    }

    if (hasWriteNew) {
      built.push({
        heading: true,
        value: 'gap',
        label: <Text> </Text>,
      });
      const optIdx = built.length;
      optToSel.set(optIdx, selIdx);
      selToOpt.set(selIdx, optIdx);
      built.push({
        value: 'write-new',
        label: WRITE_NEW_LABEL,
      });
    }

    return {
      options: built,
      selectableIndexByOptionIndex: optToSel,
      optionIndexBySelectableIndex: selToOpt,
    };
  }, [thisSession, others, hasWriteNew]);

  return (
    <ItemList
      options={options}
      visibleOptionCount={visibleOptionCount}
      defaultFocusIndex={optionIndexBySelectableIndex.get(defaultFocusIndex) ?? 0}
      onFocus={optIdx => {
        const selIdx = selectableIndexByOptionIndex.get(optIdx);
        if (selIdx !== undefined) onFocus(selIdx);
      }}
      onSelect={optIdx => {
        const selIdx = selectableIndexByOptionIndex.get(optIdx);
        if (selIdx === undefined) return;
        const draft = ordered[selIdx];
        if (draft) onOpen(draft);
        else onWriteNew();
      }}
    />
  );
}

function FieldEditor({
  label,
  value,
  isFocused,
  bold,
  dim,
  multiline,
  columns,
  cursorOffset,
  onChange,
  onCursorChange,
  onNext,
  onPrev,
  onExit,
}: {
  label: string;
  value: string;
  isFocused: boolean;
  bold?: boolean;
  dim?: boolean;
  multiline?: boolean;
  columns: number;
  cursorOffset: number | null;
  onChange(value: string): void;
  onCursorChange(offset: number | null): void;
  onNext(): void;
  onPrev(): void;
  onExit(): void;
}): React.ReactNode {
  const screenReader = useContext(AccessibilityContext);
  return (
    <Box flexDirection="column">
      <Box>
        <FocusTick isFocused={isFocused} />
        <Text>{label}</Text>
      </Box>
      <Box marginLeft={4}>
        {isFocused ? (
          <Box
            borderStyle={multiline && !screenReader ? 'single' : undefined}
            borderLeft={true}
            borderTop={false}
            borderBottom={false}
            borderRight={false}
            borderDimColor
            paddingLeft={multiline && !screenReader ? 1 : 0}
          >
            <TextInput
              value={value}
              onChange={onChange}
              columns={multiline && !screenReader ? columns - 2 : columns}
              onSubmit={onNext}
              onExit={onExit}
              onHistoryUp={onPrev}
              onHistoryDown={onNext}
              cursorOffset={cursorOffset ?? value.length}
              onChangeCursorOffset={onCursorChange}
              multiline={multiline}
              inputFilter={input => sanitizeFeedbackField(input, Boolean(multiline))}
              disableCursorMovementForUpDownKeys={!multiline}
              disableEscapeDoublePress
              showCursor
              focus
            />
          </Box>
        ) : multiline ? (
          <FeedbackDetailsBox value={value} bold={bold} dim={dim} columns={columns} />
        ) : (
          <Text bold={bold} dimColor={dim} wrap="wrap">
            {sanitizeFeedbackField(value, false)}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/** densable leftover sr */
export function FeedbackDrafts({ messages, onDone, abortSignal, onWriteNew }: Props): React.ReactNode {
  const [drafts, setDrafts] = useState<FeedbackDraft[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const screenReader = useContext(AccessibilityContext);
  const [mode, setMode] = useState<PanelMode>('list');
  const [selected, setSelected] = useState<FeedbackDraft | null>(null);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [cursorOffset, setCursorOffset] = useState<number | null>(null);
  const clearedDetailsAt = useRef(-Infinity);
  const [error, setError] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const columns = useTerminalSize().columns - 6;
  const sendArmedAt = useRef(0);
  const submitting = useRef(false);
  const discardArmedAt = useRef(0);
  const discarding = useRef(false);
  const { storageV5, credentials } = useSessionServices();
  const sessionId = getSessionId();
  const canWriteNew = onWriteNew !== undefined;

  const reload = useCallback(async () => {
    const { queued } = await listFeedbackDrafts(undefined, storageV5).catch(() => ({
      queued: [] as FeedbackDraft[],
      expired: [] as FeedbackDraft[],
    }));
    setSeededSessionDraftCount(queued.filter(draft => draft.source_session_id === sessionId).length);
    setDrafts(queued);
    const max = queued.length - (canWriteNew ? 0 : 1);
    setCursor(current => Math.min(current, Math.max(0, max)));
    return queued;
  }, [sessionId, canWriteNew, storageV5]);

  useEffect(() => {
    void reload().then(queued => {
      logEvent('tengu_feedback_queue_opened', {
        queued_count: queued.length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        this_session_count: queued.filter(draft => draft.source_session_id === sessionId)
          .length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    });
  }, [reload, sessionId]);

  const thisSession = (drafts ?? []).filter(draft => draft.source_session_id === sessionId);
  const otherSessions = (drafts ?? []).filter(draft => draft.source_session_id !== sessionId);
  const ordered = [...thisSession, ...otherSessions];
  const writeNewSelected = canWriteNew && cursor === ordered.length;
  const rowCount = ordered.length + (canWriteNew ? 1 : 0);
  const current = ordered[cursor];
  const requestIdCount = selected ? [...new Set(selected.request_ids)].length : 0;
  const fields = useMemo(() => (selected ? reviewFieldIds(selected) : []), [selected]);
  const field = fields[fieldIndex];
  const editingText = field === 'title' || field === 'area' || field === 'details';

  const finish = useCallback(
    (message?: string) => {
      if (message === undefined) onDone();
      else onDone(message, { display: 'system' });
    },
    [onDone],
  );

  const armLastField = useCallback((nextFields: ReviewField[]) => {
    sendArmedAt.current = Date.now();
    setFieldIndex(nextFields.length - 1);
  }, []);

  const openReview = useCallback(
    (draft: FeedbackDraft) => {
      setSelected(draft);
      setIncludeTranscript(Boolean(draft.transcriptAvailable));
      setError(null);
      setForm({
        type: draft.type,
        title: sanitizeFeedbackField(draft.title, false),
        area: sanitizeFeedbackField(draft.area ?? '', false),
        failureMode: draft.failure_mode,
        taskCategory: draft.task_category,
        details: sanitizeFeedbackField(draft.details, true),
      });
      setCursorOffset(null);
      clearedDetailsAt.current = -Infinity;
      armLastField(reviewFieldIds(draft));
      discardArmedAt.current = Date.now();
      submitting.current = false;
      setMode('review');
    },
    [armLastField],
  );

  const discardDraft = useCallback(
    async (draft: FeedbackDraft) => {
      const now = Date.now();
      const last = discardArmedAt.current;
      discardArmedAt.current = Math.max(now, last);
      if (now - last < FIELD_DEBOUNCE_MS || discarding.current) return;
      discarding.current = true;
      try {
        await discardFeedbackDraft(draft, 'panel', storageV5).catch(() => {});
        setMode('list');
        setSelected(null);
        await reload();
      } finally {
        discarding.current = false;
      }
    },
    [reload, storageV5],
  );

  const persistDraft = useCallback(
    (draft: FeedbackDraft) => {
      setSelected(draft);
      setDrafts(current => current?.map(item => (item.draft_id === draft.draft_id ? draft : item)) ?? current);
      const { transcriptAvailable: _ignored, ...persistable } = draft;
      return writeFeedbackDraft(persistable, new Date(), storageV5).then(result => {
        if (!result.success) {
          setError(
            result.reason === 'too_large'
              ? 'That draft is too large to save. Trim the details.'
              : 'Could not save the draft to disk.',
          );
        }
      });
    },
    [storageV5],
  );

  const mergedDraft = useCallback((): FeedbackDraft | null => {
    if (!selected || !form) return selected;
    const originalTitle = sanitizeFeedbackField(selected.title, false);
    const originalArea = sanitizeFeedbackField(selected.area ?? '', false);
    const originalDetails = sanitizeFeedbackField(selected.details, true);
    const title = form.title === originalTitle || form.title.trim() === '' ? selected.title : form.title.trim();
    const area = form.area === originalArea ? (selected.area ?? '') : form.area.trim();
    const details =
      form.details === originalDetails ? selected.details : form.details.trim() === '' ? '' : form.details;
    if (
      form.type === selected.type &&
      title === selected.title &&
      (area === '' ? undefined : area) === selected.area &&
      form.failureMode === selected.failure_mode &&
      form.taskCategory === selected.task_category &&
      details === selected.details
    ) {
      return selected;
    }
    return {
      ...selected,
      type: form.type,
      title,
      area: area === '' ? undefined : area,
      failure_mode: form.failureMode,
      task_category: form.taskCategory,
      details,
    };
  }, [selected, form]);

  const persistEdits = useCallback(() => {
    let next = mergedDraft();
    if (next && next !== selected) {
      if (
        selected &&
        next.details === '' &&
        selected.details !== '' &&
        Date.now() - clearedDetailsAt.current < FIELD_DEBOUNCE_MS
      ) {
        next = { ...next, details: selected.details };
      }
      void persistDraft(next);
    }
  }, [mergedDraft, selected, persistDraft]);

  const moveField = useCallback(
    (delta: number) => {
      setCursorOffset(null);
      setError(current => (current === DETAILS_LIMIT_ERROR ? null : current));
      setFieldIndex(current => {
        const next = Math.max(0, Math.min(fields.length - 1, current + delta));
        if (next !== current && fields[next] === 'send') sendArmedAt.current = Date.now();
        return next;
      });
    },
    [fields],
  );

  const cycleEnum = useCallback(
    (delta: number) => {
      if (field === 'type') {
        setForm(current => {
          if (!current) return current;
          const index = FEEDBACK_TYPES.indexOf(current.type);
          const next = FEEDBACK_TYPES[(index + delta + FEEDBACK_TYPES.length) % FEEDBACK_TYPES.length];
          return next ? { ...current, type: next } : current;
        });
      } else if (field === 'failure_mode') {
        setForm(current => {
          if (!current) return current;
          const index = FAILURE_MODE_OPTIONS.indexOf(current.failureMode);
          const length = FAILURE_MODE_OPTIONS.length;
          return { ...current, failureMode: FAILURE_MODE_OPTIONS[(index + delta + length) % length] };
        });
      } else if (field === 'task_category') {
        setForm(current => {
          if (!current) return current;
          const index = TASK_CATEGORY_OPTIONS.indexOf(current.taskCategory);
          const length = TASK_CATEGORY_OPTIONS.length;
          return { ...current, taskCategory: TASK_CATEGORY_OPTIONS[(index + delta + length) % length] };
        });
      } else if (field === 'transcript') {
        setIncludeTranscript(current => !current);
      }
    },
    [field],
  );

  const sendDraft = useCallback(async () => {
    if (!selected || submitting.current) return;
    const now = Date.now();
    const last = sendArmedAt.current;
    sendArmedAt.current = Math.max(now, last);
    if (now - last < FIELD_DEBOUNCE_MS) return;
    if (form && form.title.trim() === '') {
      setError('Title is blank. Type a title, or press esc on the field to restore it.');
      return;
    }
    const next = mergedDraft() ?? selected;
    submitting.current = true;
    setMode('submitting');
    setError(null);
    if (next !== selected) await persistDraft(next);
    let result: Awaited<ReturnType<typeof submitQueuedFeedbackDraft>>;
    try {
      result = await submitQueuedFeedbackDraft({
        draft: next,
        includeTranscript: includeTranscript && Boolean(next.transcriptAvailable),
        currentSessionMessages: messages,
        signal: abortSignal,
        storageV5,
        credentials,
      });
    } catch {
      result = {
        success: false,
        error: "Couldn't send feedback. The draft is still queued. Try again later.",
      };
    }
    if (result.success) {
      setReceiptId(result.feedbackId ?? null);
      setMode('receipt');
      void reload();
    } else {
      submitting.current = false;
      setError(result.error ?? null);
      if (result.payloadTooLarge) {
        const transcriptField = fields.indexOf('transcript');
        if (transcriptField >= 0) setFieldIndex(transcriptField);
      }
      setMode('review');
    }
  }, [
    selected,
    form,
    includeTranscript,
    messages,
    abortSignal,
    reload,
    mergedDraft,
    persistDraft,
    storageV5,
    credentials,
    fields,
  ]);

  const goBack = useCallback(() => {
    if (mode === 'review') {
      persistEdits();
      discardArmedAt.current = -Infinity;
      setMode('list');
      setSelected(null);
      return;
    }
    finish();
  }, [mode, persistEdits, finish]);

  useInput((input, key) => {
    if (key.ctrl || key.meta) return;
    if (mode === 'submitting') return;
    if (key.escape && !(mode === 'review' && editingText)) return;
    if (mode === 'receipt') {
      if ((drafts?.length ?? 0) > 0) {
        setMode('list');
        setSelected(null);
      } else {
        finish(`Feedback sent (receipt ${receiptId})`);
      }
      return;
    }
    if (mode === 'list') {
      if (!drafts) return;
      if (input.toLowerCase() === 'w' && onWriteNew) {
        onWriteNew();
        return;
      }
      if (rowCount === 0) {
        finish();
        return;
      }
      if (ordered.length > 0) {
        if (input.toLowerCase() === 'd' && current) void discardDraft(current);
        return;
      }
      if (key.upArrow || key.downArrow) return;
      if (key.return && onWriteNew) onWriteNew();
      else if (!key.escape) finish();
      return;
    }
    if (mode === 'review' && selected) {
      if (editingText) {
        if (key.escape && field) {
          const restore = field;
          setForm(current =>
            current && selected
              ? {
                  ...current,
                  [restore]:
                    restore === 'details'
                      ? sanitizeFeedbackField(selected.details, true)
                      : sanitizeFeedbackField(restore === 'area' ? (selected.area ?? '') : selected.title, false),
                }
              : current,
          );
          setCursorOffset(null);
          armLastField(fields);
          setError(current => (current === DETAILS_LIMIT_ERROR ? null : current));
        }
        return;
      }
      if (key.upArrow) moveField(-1);
      else if (key.downArrow) moveField(1);
      else if (key.leftArrow || key.rightArrow) cycleEnum(key.leftArrow ? -1 : 1);
      else if (input === ' ' && field === 'transcript') setIncludeTranscript(current => !current);
      else if (key.return) {
        if (field === 'send') void sendDraft();
        else moveField(1);
      } else if (input.toLowerCase() === 'd') void discardDraft(selected);
    }
  });

  const showListRowHints = !(screenReader && ordered.length > 0);
  const inputGuide =
    mode === 'list' ? (
      <Byline>
        {rowCount > 0 && showListRowHints && (
          <KeyboardShortcutHint shortcut="enter" action={writeNewSelected ? 'write new feedback' : 'review'} />
        )}
        {current !== undefined && showListRowHints && <KeyboardShortcutHint shortcut="d" action="discard" />}
        <KeyboardShortcutHint shortcut="esc" action="close" />
      </Byline>
    ) : mode === 'review' ? (
      <Byline>
        <KeyboardShortcutHint shortcut="up/down" action="move" />
        {(field === 'type' || field === 'failure_mode' || field === 'task_category' || field === 'transcript') && (
          <KeyboardShortcutHint shortcut="left/right" action="change" />
        )}
        <KeyboardShortcutHint shortcut="enter" action={field === 'send' ? 'send' : 'next'} />
        {field === 'details' && (
          <KeyboardShortcutHint shortcut={process.platform === 'darwin' ? 'shift+enter' : 'ctrl+j'} action="new line" />
        )}
        {!editingText && <KeyboardShortcutHint shortcut="d" action="discard" />}
        <KeyboardShortcutHint shortcut="esc" action={editingText ? 'cancel edit' : 'later'} />
      </Byline>
    ) : null;

  return (
    <Dialog
      title="Feedback drafts"
      onCancel={goBack}
      isCancelActive={mode !== 'submitting' && !editingText}
      hideInputGuide={mode === 'receipt' || mode === 'submitting'}
      inputGuide={inputGuide}
    >
      {mode === 'list' && drafts === null && <Text dimColor>Loading…</Text>}
      {mode === 'list' && drafts !== null && ordered.length === 0 && (
        <Box flexDirection="column" gap={1}>
          <Text>No feedback drafts queued.</Text>
          <Text dimColor>Claude drafts feedback at high-signal moments; drafts appear here for your review.</Text>
          {onWriteNew ? (
            <Box flexDirection="column" gap={1}>
              <WriteNewRow isSelected={writeNewSelected} />
              <Text dimColor>/bug works anytime. Any other key closes this panel.</Text>
            </Box>
          ) : (
            <Text dimColor>Any key closes this panel.</Text>
          )}
        </Box>
      )}
      {mode === 'list' && drafts !== null && ordered.length > 0 && (
        <Box flexDirection="column">
          <DraftList
            thisSession={thisSession}
            others={otherSessions}
            hasWriteNew={canWriteNew}
            defaultFocusIndex={cursor}
            onFocus={setCursor}
            onOpen={openReview}
            onWriteNew={() => onWriteNew?.()}
          />
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              Drafts live only on this machine and are never sent without you. Unsent drafts expire after 30 days.
            </Text>
          </Box>
        </Box>
      )}
      {mode === 'review' && selected && form && (
        <Box flexDirection="column">
          <Box>
            <FocusTick isFocused={field === 'type'} />
            <Text>Type: </Text>
            <EnumValue value={TYPE_LABELS[form.type]} isFocused={field === 'type'} />
          </Box>
          <FieldEditor
            label="Title:"
            value={form.title}
            isFocused={field === 'title'}
            bold
            columns={columns}
            cursorOffset={cursorOffset}
            onChange={value => setForm(current => (current ? { ...current, title: value } : current))}
            onCursorChange={setCursorOffset}
            onNext={() => moveField(1)}
            onPrev={() => moveField(-1)}
            onExit={goBack}
          />
          <FieldEditor
            label="Area:"
            value={form.area}
            isFocused={field === 'area'}
            dim
            columns={columns}
            cursorOffset={cursorOffset}
            onChange={value => setForm(current => (current ? { ...current, area: value } : current))}
            onCursorChange={setCursorOffset}
            onNext={() => moveField(1)}
            onPrev={() => moveField(-1)}
            onExit={goBack}
          />
          <Box>
            <FocusTick isFocused={field === 'failure_mode'} />
            <Text>Failure mode: </Text>
            <EnumValue value={formatFeedbackEnumValue(form.failureMode)} isFocused={field === 'failure_mode'} />
          </Box>
          <Box>
            <FocusTick isFocused={field === 'task_category'} />
            <Text>Task: </Text>
            <EnumValue value={formatFeedbackEnumValue(form.taskCategory)} isFocused={field === 'task_category'} />
          </Box>
          <FieldEditor
            label="Details:"
            value={form.details}
            isFocused={field === 'details'}
            dim
            multiline
            columns={columns}
            cursorOffset={cursorOffset}
            onChange={value => {
              const bytes = Buffer.byteLength(value, 'utf8');
              if (bytes > MAX_DETAILS_BYTES && bytes >= Buffer.byteLength(form.details, 'utf8')) {
                setError(DETAILS_LIMIT_ERROR);
                return;
              }
              setForm(current => {
                if (current && current.details.trim() !== '' && value.trim() === '') {
                  clearedDetailsAt.current = Date.now();
                }
                return current ? { ...current, details: value } : current;
              });
              setError(current => (current === DETAILS_LIMIT_ERROR ? null : current));
            }}
            onCursorChange={setCursorOffset}
            onNext={() => moveField(1)}
            onPrev={() => moveField(-1)}
            onExit={goBack}
          />
          {selected.transcriptAvailable ? (
            <Box flexDirection="column">
              <Box>
                <FocusTick isFocused={field === 'transcript'} />
                <Text>Send transcript: </Text>
                <EnumValue value={includeTranscript ? 'yes' : 'no'} isFocused={field === 'transcript'} />
                <Text dimColor> · {includeTranscript ? 'sends this conversation to Anthropic' : 'report only'}</Text>
              </Box>
              {selected.source_session_id !== sessionId && (
                <Box marginLeft={4}>
                  <Text dimColor wrap="wrap">
                    from {sanitizeFeedbackField(selected.cwd, false)} · session{' '}
                    {sanitizeFeedbackField(selected.source_session_id, false)}
                  </Text>
                </Box>
              )}
            </Box>
          ) : (
            <Box>
              <FocusTick isFocused={false} />
              <Text>
                Send transcript: <Text dimColor>expired (report only)</Text>
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <FocusTick isFocused={false} />
            <Text dimColor wrap="wrap">
              Environment info ({sanitizeFeedbackField(selected.os, false)}, v
              {sanitizeFeedbackField(selected.cli_version, false)}, {sanitizeFeedbackField(selected.model, false)}
              {selected.effort !== undefined && <>, effort {sanitizeFeedbackField(selected.effort, false)}</>}
              {selected.thinking_type !== undefined && (
                <>
                  , thinking {selected.thinking_type}
                  {selected.thinking_budget !== undefined && <> (budget {selected.thinking_budget})</>}
                </>
              )}
              {selected.assistant_turn_count !== undefined && (
                <>
                  , turn {selected.assistant_turn_count}
                  {selected.message_count !== undefined && <>/{selected.message_count}</>}
                  {selected.subagent_count !== undefined && selected.subagent_count > 0 && (
                    <>
                      {' '}
                      with {selected.subagent_count} {plural(selected.subagent_count, 'subagent')}
                    </>
                  )}
                </>
              )}
              , drafted {formatDraftAge(selected.created_at)} ago)
              {requestIdCount > 0 ? ` and ${requestIdCount} API request ${plural(requestIdCount, 'id')} are` : ' is'}{' '}
              always attached.
            </Text>
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color="error">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <FocusTick isFocused={field === 'send'} />
            <Text bold={field === 'send'}>Send feedback</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              {REVIEW_PRIVACY_FOOTER}
            </Text>
          </Box>
        </Box>
      )}
      {mode === 'submitting' && <Text>Sending feedback…</Text>}
      {mode === 'receipt' && (
        <Box flexDirection="column">
          <Text color="success">
            <StatusIcon status="success" withSpace />
            Feedback sent (receipt {receiptId}). Thanks!
          </Text>
          <Box marginTop={1}>
            <Text dimColor italic>
              Any key to continue
            </Text>
          </Box>
        </Box>
      )}
    </Dialog>
  );
}
