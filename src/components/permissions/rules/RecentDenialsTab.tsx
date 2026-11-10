import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type KeyboardEvent, Box, StatusIcon, Text, useTabHeaderFocus } from '@anthropic/ink';
import { type AutoModeDenial, getAutoModeDenials } from '../../../utils/autoModeDenials.js';
import { Select } from '../../CustomSelect/select.js';

type Props = {
  onHeaderFocusChange?: (focused: boolean) => void;
  /** Called when approved/retry state changes so parent can act on exit */
  onStateChange: (state: { approved: Set<number>; retry: Set<number>; denials: readonly AutoModeDenial[] }) => void;
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
      onStateChange({ approved: new Set(), retry: new Set(), denials });
    }
  }, [isEmpty, denials, onStateChange]);

  if (isEmpty) {
    return <Text dimColor>No recent denials. Commands denied by the auto mode classifier will appear here.</Text>;
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

  useEffect(() => {
    onStateChange({ approved, retry, denials });
  }, [approved, retry, denials, onStateChange]);

  const withheldIndices = useMemo(
    () =>
      new Set(
        denials.map((d, idx) => ((d as { withheld?: boolean }).withheld === true ? idx : -1)).filter(idx => idx >= 0),
      ),
    [denials],
  );

  const handleSelect = useCallback(
    (value: string) => {
      const idx = Number(value);
      if (withheldIndices.has(idx)) {
        return;
      }
      setApproved(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
    },
    [withheldIndices],
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
      if (withheldIndices.has(focusedIdx)) return;
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
    [focusedIdx, headerFocused, withheldIndices],
  );

  const options = denials.map((d, idx) => {
    const isApproved = approved.has(idx);
    const suffix = retry.has(idx) ? ' (retry)' : '';
    const reason = d.reason ? d.reason.replace(/\s+/g, ' ').trim() : undefined;
    return {
      label: (
        <Text>
          <StatusIcon status={isApproved ? 'success' : 'error'} withSpace />
          {d.display}
          <Text dimColor>{suffix}</Text>
        </Text>
      ),
      value: String(idx),
      ...(reason && { description: reason, dimDescription: true }),
    };
  });

  return (
    <Box flexDirection="column" onKeyDown={handleKeyDown}>
      <Text>Commands recently denied by the auto mode classifier.</Text>
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
    </Box>
  );
}
