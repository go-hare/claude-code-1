/**
 * densable qn @202796112 — two-choice confirm.
 * Screen reader (Xe) renders qMn @202752035, not the same list.
 */
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Box, Byline, ClockContext, KeyboardShortcutHint, Text, type KeyboardEvent } from '@anthropic/ink';
import { Select } from './CustomSelect/index.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';

/** densable z — ATt default and qn window when windowMs is omitted. */
export const CONFIRM_SELECT_ARM_MS = 500;
/** Inter-keystroke gap (ms) to consider a stray pre-prompt typing burst finished (#1891). */
export const CONFIRM_STREAM_QUIET_GAP_MS = 350;

export type ConfirmStreamGuard = {
  /**
   * Decide whether an incoming keystroke should be dropped as part of a
   * continuous stray typing stream that started while input was refused (#1891).
   */
  shouldDropKey(key: string, refused: boolean, now: number): boolean;
  reset(): void;
};

export function createConfirmStreamGuard(gapMs = CONFIRM_STREAM_QUIET_GAP_MS): ConfirmStreamGuard {
  let droppingStream = false;
  let lastKeyAt = -Infinity;

  return {
    shouldDropKey(key: string, refused: boolean, now: number): boolean {
      if (refused) {
        droppingStream = true;
        lastKeyAt = now;
        return true;
      }
      if (droppingStream) {
        const elapsed = now - lastKeyAt;
        if (elapsed >= 0 && elapsed < gapMs) {
          lastKeyAt = now;
          if (key === 'return') {
            droppingStream = false;
          }
          return true;
        }
        droppingStream = false;
      }
      return false;
    },
    reset(): void {
      droppingStream = false;
      lastKeyAt = -Infinity;
    },
  };
}

export type ConfirmChoice = 'confirm' | 'cancel';

export function confirmSelectOrder(cancelFirst: boolean): ConfirmChoice[] {
  return cancelFirst ? ['cancel', 'confirm'] : ['confirm', 'cancel'];
}

/** densable ATt(armAfterMs) — clock.now() has passed the arm point. Omitted means armed. */
export function confirmSelectArmed(armAfterMs: number | undefined, clockNow: number): boolean {
  if (armAfterMs === undefined) return true;
  return clockNow >= armAfterMs;
}

/** densable wi(openedAt, windowMs) — still inside the refuse window. */
export function confirmSelectRefused(openedAt: number | undefined, windowMs: number | undefined, now: number): boolean {
  if (openedAt === undefined) return false;
  const window = windowMs ?? CONFIRM_SELECT_ARM_MS;
  const elapsed = now - openedAt;
  return elapsed >= 0 && elapsed < window;
}

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Cancel row before confirm. Default false (confirm first). */
  cancelFirst?: boolean;
  /** Initial focus. Default "confirm". */
  focus?: ConfirmChoice;
  hideIndexes?: boolean;
  /** Official 2.1.326 (#24): override Up from first item (e.g. prevent wrap to Yes). */
  onUpFromFirstItem?: () => void;
  /** Official 2.1.326: override Down from last item. */
  onDownFromLastItem?: () => void;
  /** Official 2.1.326 (#29): ignore printable key shortcuts like j/k. */
  disablePrintableKeybindings?: boolean;
  /** Screen-reader path only. The list path does not see this. */
  refuseInput?: () => boolean;
  openedAt?: number;
  windowMs?: number;
  /** Clock timestamp after which the list enables. Omitted = enabled. */
  armAfterMs?: number;
};

function useConfirmArmed(armAfterMs: number | undefined): boolean {
  const clock = useContext(ClockContext);
  const [now, setNow] = useState(() => clock?.now() ?? 0);
  useEffect(() => {
    if (armAfterMs === undefined) return;
    if (clock) {
      return clock.subscribeKeepAlive(() => setNow(clock.now()));
    }
    const timer = setTimeout(() => setNow(armAfterMs), Math.max(0, armAfterMs));
    return () => clearTimeout(timer);
  }, [armAfterMs, clock]);
  return confirmSelectArmed(armAfterMs, now);
}

function ScreenReaderConfirm({
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  refuseInput,
  openedAt,
  windowMs,
}: Required<Pick<Props, 'confirmLabel' | 'cancelLabel' | 'onConfirm' | 'onCancel'>> &
  Pick<Props, 'refuseInput' | 'openedAt' | 'windowMs'>): React.ReactNode {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLElement | null>(null);
  const streamGuardRef = useRef<ConfirmStreamGuard | null>(null);
  if (streamGuardRef.current === null) {
    streamGuardRef.current = createConfirmStreamGuard();
  }
  const refuse = (): boolean => (refuseInput?.() ?? false) || confirmSelectRefused(openedAt, windowMs, Date.now());
  const submit = (raw: string): void => {
    const answer = raw.trim().toLowerCase();
    if ((answer === 'y' || answer === 'yes' || answer === 'n' || answer === 'no') && refuse()) {
      setTyped('');
      return;
    }
    if (answer === 'y' || answer === 'yes') {
      onConfirm();
      return;
    }
    if (answer === 'n' || answer === 'no') {
      onCancel();
      return;
    }
    setError('Please answer y or n.');
    setTyped('');
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const now = Date.now();
    const isRefused = refuse();
    if (event.key === 'escape') {
      event.preventDefault();
      if (streamGuardRef.current!.shouldDropKey('escape', isRefused, now)) {
        setTyped('');
        return;
      }
      onCancel();
      return;
    }
    if (event.key === 'return') {
      event.preventDefault();
      if (streamGuardRef.current!.shouldDropKey('return', isRefused, now)) {
        setTyped('');
        return;
      }
      submit(typed);
      return;
    }
    if (event.key === 'backspace' || event.key === 'delete') {
      event.preventDefault();
      if (streamGuardRef.current!.shouldDropKey(event.key, isRefused, now)) {
        setTyped('');
        return;
      }
      setTyped(prev => prev.slice(0, -1));
      return;
    }
    if (event.key.length === 1 && !event.ctrl && !event.meta) {
      event.preventDefault();
      if (streamGuardRef.current!.shouldDropKey(event.key, isRefused, now)) {
        setTyped('');
        return;
      }
      setError(null);
      setTyped(prev => prev + event.key);
    }
  };
  const prompt = `Enter y/n: ${typed}`;
  return (
    <Box ref={boxRef as React.Ref<never>} flexDirection="column" tabIndex={0} autoFocus onKeyDown={onKeyDown}>
      <Text>y. {confirmLabel}</Text>
      <Text>n. {cancelLabel}</Text>
      {error ? <Text>{error}</Text> : null}
      <Text>{prompt}</Text>
    </Box>
  );
}

export function ConfirmSelect({
  onConfirm,
  onCancel,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  cancelFirst = false,
  focus = 'confirm',
  hideIndexes = false,
  onUpFromFirstItem,
  onDownFromLastItem,
  disablePrintableKeybindings = false,
  refuseInput,
  openedAt,
  windowMs,
  armAfterMs,
}: Props): React.ReactNode {
  const armed = useConfirmArmed(armAfterMs);
  if (isScreenReaderModeEnabled()) {
    return (
      <ScreenReaderConfirm
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
        refuseInput={refuseInput}
        openedAt={openedAt}
        windowMs={windowMs ?? armAfterMs}
      />
    );
  }
  const paint = (label: string): React.ReactNode => (armed ? label : <Text dimColor>{label}</Text>);
  const confirm = { label: paint(confirmLabel), value: 'confirm' as const };
  const cancel = { label: paint(cancelLabel), value: 'cancel' as const };
  return (
    <Select
      options={confirmSelectOrder(cancelFirst).map(choice => (choice === 'confirm' ? confirm : cancel))}
      hideIndexes={hideIndexes}
      disablePrintableKeybindings={disablePrintableKeybindings}
      onUpFromFirstItem={onUpFromFirstItem}
      onDownFromLastItem={onDownFromLastItem}
      isDisabled={!armed}
      defaultFocusValue={focus}
      onChange={value => {
        if (value === 'confirm') onConfirm();
        else onCancel();
      }}
      onCancel={onCancel}
    />
  );
}

/** densable trust footer — Byline of enter/escape hints, not a single sentence. */
export function ConfirmSelectHint({
  pending,
  pendingKeyName,
}: {
  pending: boolean;
  pendingKeyName?: string;
}): React.ReactNode {
  if (pending) {
    return <Text dimColor>Press {pendingKeyName} again to exit</Text>;
  }
  return (
    <Text dimColor>
      <Byline>
        <KeyboardShortcutHint shortcut="enter" action="confirm" />
        <KeyboardShortcutHint shortcut="escape" action="cancel" />
      </Byline>
    </Text>
  );
}
