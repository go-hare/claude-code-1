import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type KeyboardEvent, Box, StatusIcon, Text, useTabHeaderFocus, wrapText } from '@anthropic/ink';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { type AutoModeDenial, getAutoModeDenials } from '../../../utils/autoModeDenials.js';
import { isScreenReaderModeEnabled } from '../../../utils/screenReaderGate.js';
import { Select } from '../../CustomSelect/select.js';

export type RecentDenialsState = {
  approved: Set<number>;
  retry: Set<number>;
  denials: readonly AutoModeDenial[];
  canMark: boolean;
};

export function formatDenialRefusal(reason: string): string {
  return `This row can't be approved here: ${reason}`;
}

export function isDenialBodyOnScreen(
  commandText: string,
  terminalRows: number,
  terminalColumns: number,
  listedCount: number,
): boolean {
  if (!commandText) return true;
  const colWidth = Math.max(1, terminalColumns - 8);
  const bodyLines = wrapText(commandText, colWidth, 'wrap').split('\n').length;
  // Reserve rows for dialog header, tab bar, list rows, and footer.
  const reservedRows = 8 + Math.min(10, listedCount);
  const availableRows = Math.max(0, terminalRows - reservedRows);
  return bodyLines <= availableRows;
}

function removeFromSet(set: Set<number>, idx: number): Set<number> {
  if (!set.has(idx)) return set;
  const next = new Set(set);
  next.delete(idx);
  return next;
}

type Props = {
  onHeaderFocusChange?: (focused: boolean) => void;
  /** Called when approved/retry state changes so parent can act on exit */
  onStateChange: (state: RecentDenialsState) => void;
};

export function RecentDenialsTab({ onHeaderFocusChange, onStateChange }: Props): React.ReactNode {
  // Snapshot on mount — approved/retry Sets key by index, and the live store
  // prepends. A concurrent denial would shift all indices mid-edit.
  const [denials] = useState(() => [...getAutoModeDenials()]);
  const isEmpty = denials.length === 0;

  useEffect(() => {
    if (isEmpty) {
      onHeaderFocusChange?.(true);
    }
  }, [isEmpty, onHeaderFocusChange]);

  useEffect(() => {
    if (isEmpty) {
      onStateChange({ approved: new Set(), retry: new Set(), denials, canMark: false });
    }
  }, [isEmpty, denials, onStateChange]);

  if (isEmpty) {
    return <Text dimColor>No recent blocks. Commands auto mode blocks will appear here.</Text>;
  }

  return (
    <RecentDenialsList denials={denials} onHeaderFocusChange={onHeaderFocusChange} onStateChange={onStateChange} />
  );
}

function RecentDenialsList({
  denials,
  onHeaderFocusChange,
  onStateChange,
}: Props & { denials: readonly AutoModeDenial[] }): React.ReactNode {
  const { headerFocused, focusHeader } = useTabHeaderFocus();
  useEffect(() => {
    onHeaderFocusChange?.(headerFocused);
  }, [headerFocused, onHeaderFocusChange]);

  const [approved, setApproved] = useState<Set<number>>(() => new Set());
  const [retry, setRetry] = useState<Set<number>>(() => new Set());
  const [focusedIdx, setFocusedIdx] = useState(0);
  const isScreenReader = isScreenReaderModeEnabled();
  const { rows, columns } = useTerminalSize();
  const [prevSize, setPrevSize] = useState({ rows, columns });
  const [marksClearedNotice, setMarksClearedNotice] = useState(false);

  if (rows !== prevSize.rows || columns !== prevSize.columns) {
    setPrevSize({ rows, columns });
    if (!isScreenReader && approved.size + retry.size > 0 && (rows < prevSize.rows || columns < prevSize.columns)) {
      setApproved(new Set());
      setRetry(new Set());
      setMarksClearedNotice(true);
    }
  }

  const withheldIndices = useMemo(
    () =>
      new Set(
        denials.map((d, idx) => ((d as { withheld?: boolean }).withheld === true ? idx : -1)).filter(idx => idx >= 0),
      ),
    [denials],
  );

  const focusedDenial = denials[focusedIdx];
  const focusedCommand = focusedDenial ? (focusedDenial.command ?? focusedDenial.display) : '';
  const bodyOnScreen = isScreenReader ? true : isDenialBodyOnScreen(focusedCommand, rows, columns, denials.length);
  const isTooShort = focusedDenial !== undefined && !bodyOnScreen;

  const blockedIndices = useMemo(() => {
    if (!isTooShort) return withheldIndices;
    const next = new Set(withheldIndices);
    next.add(focusedIdx);
    return next;
  }, [withheldIndices, isTooShort, focusedIdx]);

  const canMark = isScreenReader ? withheldIndices.size < denials.length : !blockedIndices.has(focusedIdx);

  useEffect(() => {
    if (isTooShort) {
      setApproved(prev => removeFromSet(prev, focusedIdx));
      setRetry(prev => removeFromSet(prev, focusedIdx));
    }
  }, [isTooShort, focusedIdx]);

  useEffect(() => {
    onStateChange({ approved, retry, denials, canMark });
  }, [approved, retry, denials, canMark, onStateChange]);

  const handleSelect = useCallback(
    (value: string) => {
      const idx = Number(value);
      if (blockedIndices.has(idx)) {
        return;
      }
      setMarksClearedNotice(false);
      setApproved(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
    },
    [blockedIndices],
  );

  const handleFocus = useCallback((value: string) => {
    setFocusedIdx(Number(value));
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (headerFocused) return;
      if (e.ctrl || e.meta || e.shift) return;
      if (e.key !== 'r') return;
      e.preventDefault();
      if (blockedIndices.has(focusedIdx)) return;
      setMarksClearedNotice(false);
      setRetry(prev => {
        const next = new Set(prev);
        if (next.has(focusedIdx)) next.delete(focusedIdx);
        else next.add(focusedIdx);
        return next;
      });
      // Retry implies approve
      setApproved(prev => {
        if (prev.has(focusedIdx)) return prev;
        const next = new Set(prev);
        next.add(focusedIdx);
        return next;
      });
    },
    [focusedIdx, headerFocused, blockedIndices],
  );

  const options = denials.map((d, idx) => {
    const isApproved = approved.has(idx);
    const isWithheld = withheldIndices.has(idx);
    const suffix = retry.has(idx)
      ? ' (retry)'
      : !isScreenReader
        ? ''
        : isApproved
          ? ' (approved)'
          : isWithheld
            ? " (can't be approved)"
            : '';
    const reason = d.reason ? d.reason.replace(/\s+/g, ' ').trim() : undefined;
    return {
      label: (
        <Text>
          <StatusIcon status={isApproved ? 'success' : 'error'} withSpace />
          {d.command ?? d.display}
          <Text dimColor>{suffix}</Text>
        </Text>
      ),
      value: String(idx),
      ...(reason && { description: reason, dimDescription: true }),
    };
  });

  const refusalMessage = withheldIndices.has(focusedIdx)
    ? formatDenialRefusal("its command can't be read in full")
    : isTooShort
      ? formatDenialRefusal('this terminal is too short to show it')
      : undefined;
  const noticeText = `${marksClearedNotice ? 'Marks cleared: terminal shrank. ' : ''}${refusalMessage ?? ''}`.trim();

  return (
    <Box flexDirection="column" onKeyDown={handleKeyDown}>
      <Text>Commands recently blocked by auto mode.</Text>
      <Box marginTop={1}>
        <Select
          options={options}
          onChange={handleSelect}
          onFocus={handleFocus}
          visibleOptionCount={Math.min(10, options.length)}
          isDisabled={headerFocused}
          onUpFromFirstItem={focusHeader}
        />
      </Box>
      {noticeText ? (
        <Box marginTop={1}>
          <Text color="warning">{noticeText}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
