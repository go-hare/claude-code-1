/**
 * densable `zXt` retry row + `Zt`/`bhr` idle chrome.
 * DualInk press `baseButton` omitted from 审查差异.
 */
import figures from 'figures';
import * as React from 'react';
import { Box, KeyboardShortcutHint, Text, stringWidth } from '@anthropic/ink';
import { remainingRetryMs } from '../../utils/advisorNetworkStall.js';
import { formatDuration } from '../../utils/format.js';
import { truncateToWidth } from '../../utils/truncate.js';

export const LEFTOVER_ZXT_API_ERROR = 'API error';
export const LEFTOVER_BHR_PAD_LEFT = 2;
export const LEFTOVER_BHR_GAP = 3;
export const LEFTOVER_BHR_CONN_MIN = 12;
export const LEFTOVER_BHR_IDLE_MIN = 1;

type LeftoverZxtNoResponse = {
  retryWaitMs: number;
  waitedMs: number;
};

type LeftoverZxtRateLimits = {
  resetsAt?: number;
  rateLimitType?: string;
};

type LeftoverZxtError = {
  formatted?: string;
  noResponse?: LeftoverZxtNoResponse | null;
  rateLimits?: LeftoverZxtRateLimits | null;
  isNetworkDown?: boolean;
  connection?: { isSSLError?: boolean } | null;
};

type LeftoverZxtRow = {
  kind?: string;
  deadline?: number;
  attempt?: number;
  maxRetries?: number;
  error?: LeftoverZxtError | null;
};

function leftoverZxtRow(status: unknown): LeftoverZxtRow | null {
  if (status === null || typeof status !== 'object') return null;
  return status as LeftoverZxtRow;
}

function leftoverZxtCountdown(deadline: number, now = Date.now()): string {
  const remainMs = remainingRetryMs(deadline, now);
  return formatDuration(remainMs, { mostSignificantOnly: remainMs >= 300_000 });
}

/** densable `S3().waitBanner` analog — DualInk has no wait-banner host. */
export function leftoverLowPriorityWaitBanner(): string {
  return '';
}

/** densable `vu(j.resetsAt)` analog — DualInk duration until unix-seconds reset. */
export function leftoverZxtResetsAtSuffix(resetsAt: number | undefined, now = Date.now()): string {
  if (resetsAt == null) return '';
  const ms = Math.max(0, resetsAt * 1000 - now);
  return ` (${formatDuration(ms, { mostSignificantOnly: true })})`;
}

/** densable `gdt` analog — identity, fallback "usage limit". */
export function leftoverZxtRateLimitLabel(rateLimitType: string | undefined): string {
  return rateLimitType || 'usage limit';
}

export function leftoverZxtRetryTitle(input: {
  attempt: number;
  maxRetries: number;
  formatted: string | undefined;
  rateLimits: LeftoverZxtRateLimits | null | undefined;
  isNetworkDown: boolean;
  isSSLError: boolean;
}): string {
  const rateLimits = input.rateLimits;
  const it =
    input.attempt >= Math.min(3, input.maxRetries) || input.isNetworkDown || input.isSSLError || Boolean(rateLimits);
  if (!it) return LEFTOVER_ZXT_API_ERROR;
  if (rateLimits) {
    const st = leftoverZxtRateLimitLabel(rateLimits.rateLimitType);
    return `${st[0]?.toUpperCase() ?? ''}${st.slice(1)} reached`;
  }
  return input.formatted || LEFTOVER_ZXT_API_ERROR;
}

function leftoverZxtMark(color: 'error' | 'warning'): React.ReactNode {
  return (
    <Box aria-hidden flexWrap="wrap" height={1} width={2}>
      <Text color={color}>{figures.cross}</Text>
    </Box>
  );
}

function leftoverZxtTruncate(text: string, suffix: string, columns: number): string {
  const budget = Math.max(10, columns - 2 - stringWidth(suffix) - 2);
  return truncateToWidth(text, budget);
}

/**
 * densable `zXt({status, columns})`.
 */
export function leftoverZxt(input: { status: unknown; columns: number; now?: number }): React.ReactNode {
  const t = leftoverZxtRow(input.status);
  if (!t?.kind) return null;
  const now = input.now ?? Date.now();
  const columns = input.columns;
  const countdown = leftoverZxtCountdown(Number(t.deadline) || 0, now);
  const attempt = Number(t.attempt) || 0;
  const maxRetries = Number(t.maxRetries) || 0;

  if (t.kind === 'stalled') {
    return (
      <>
        {leftoverZxtMark('error')}
        <Box flexShrink={1}>
          <Text color="error">Waiting for API response</Text>
          <Text dimColor>
            {' · will retry in '}
            {countdown}
            {' · check your network'}
          </Text>
        </Box>
      </>
    );
  }

  if (t.kind === 'low_priority_waiting') {
    const suffix = ` · next try in ${countdown} · attempt ${attempt} · esc to interrupt`;
    const banner = leftoverZxtTruncate(leftoverLowPriorityWaitBanner(), suffix, columns);
    return (
      <>
        {leftoverZxtMark('warning')}
        <Box flexShrink={1}>
          {banner ? <Text color="warning">{banner}</Text> : null}
          <Text dimColor>{suffix}</Text>
        </Box>
      </>
    );
  }

  if (t.kind === 'auto_mode_unavailable') {
    const suffix = ` · next try in ${countdown} · attempt ${attempt}/${maxRetries} · `;
    return (
      <>
        {leftoverZxtMark('error')}
        <Box flexShrink={1}>
          <Text color="error">Auto mode check unavailable</Text>
          <Text dimColor>
            {suffix}
            <KeyboardShortcutHint shortcut="esc" action="interrupt" />
          </Text>
        </Box>
      </>
    );
  }

  const err = t.error ?? {};
  const noResponse = err.noResponse;
  if (noResponse) {
    const waitUpTo = formatDuration(noResponse.retryWaitMs);
    const waited = formatDuration(noResponse.waitedMs);
    const once = attempt >= maxRetries;
    const suffix = once
      ? ` · retrying once, waiting up to ${waitUpTo}`
      : ` · retrying, waiting up to ${waitUpTo} · attempt ${attempt}/${maxRetries}`;
    const title = leftoverZxtTruncate(`No response from the API after ${waited}`, suffix, columns);
    return (
      <>
        {leftoverZxtMark('error')}
        <Box flexBasis={0} flexDirection="column" flexGrow={1} flexShrink={1}>
          <Box>
            <Text color="error">{title}</Text>
            <Text dimColor>{suffix}</Text>
          </Box>
          <Text dimColor>
            A proxy or gateway that buffers streaming responses can cause this · set CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS
            to change the first wait
          </Text>
        </Box>
      </>
    );
  }

  const rateLimits = err.rateLimits;
  const resetsSuffix = leftoverZxtResetsAtSuffix(rateLimits?.resetsAt, now);
  const suffix = ` · Retrying in ${countdown}${resetsSuffix} · attempt ${attempt}/${maxRetries}`;
  const title = leftoverZxtTruncate(
    leftoverZxtRetryTitle({
      attempt,
      maxRetries,
      formatted: err.formatted,
      rateLimits,
      isNetworkDown: err.isNetworkDown === true,
      isSSLError: err.connection?.isSSLError === true,
    }),
    suffix,
    columns,
  );
  return (
    <>
      {leftoverZxtMark('error')}
      <Box flexShrink={1}>
        <Text color="error">{title}</Text>
        <Text dimColor>{suffix}</Text>
      </Box>
    </>
  );
}

/**
 * densable `Zt(columns, runningCount, showConnWarning)`.
 */
export function leftoverBhrIdleBudget(
  columns: number,
  runningCount: number,
  showConnWarning: boolean,
): { labelBudget: number; rightText: string } {
  const rightText = runningCount > 0 ? `${runningCount} in background` : '';
  const labelBudgetFull = columns - LEFTOVER_BHR_PAD_LEFT - LEFTOVER_BHR_GAP;
  const labelBudget = labelBudgetFull - (rightText ? 1 + stringWidth(rightText) : 0);
  if (rightText && labelBudget < (showConnWarning ? LEFTOVER_BHR_CONN_MIN : LEFTOVER_BHR_IDLE_MIN)) {
    return { labelBudget: labelBudgetFull, rightText: '' };
  }
  return { labelBudget, rightText };
}

/**
 * densable `bhr` left label: truncate "Reconnecting"/"Disconnected", then
 * append `…` when reconnecting and truncate did not already.
 */
export function leftoverBhrConnLabel(connStatus: string, labelBudget: number): string {
  const reconnecting = connStatus === 'reconnecting';
  const warning = reconnecting || connStatus === 'disconnected';
  if (!warning) return '';
  const raw = reconnecting ? 'Reconnecting' : 'Disconnected';
  const t = reconnecting ? 1 : 0;
  const truncated = truncateToWidth(raw, labelBudget + LEFTOVER_BHR_GAP - t);
  if (reconnecting && !truncated.endsWith('…')) return `${truncated}…`;
  return truncated;
}
