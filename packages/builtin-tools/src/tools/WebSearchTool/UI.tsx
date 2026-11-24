import React from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { LEFTOVER_ZXT_API_ERROR, RetryBanner } from 'src/components/Spinner/leftoverZxt.js';
import { TOOL_SUMMARY_MAX_LENGTH } from 'src/constants/toolLimits.js';
import { Text } from '@anthropic/ink';
import type { ProgressMessage } from 'src/types/message.js';
import { formatDuration, truncate } from 'src/utils/format.js';
import { plural } from 'src/utils/stringUtils.js';
import type { Output, SearchResult, WebSearchProgress } from './WebSearchTool.js';

const WEB_SEARCH_RETRY_INDENT = 5;

function getSearchSummary(results: (SearchResult | string | null | undefined)[]): {
  searchCount: number;
  totalResultCount: number;
} {
  let searchCount = 0;
  let totalResultCount = 0;

  for (const result of results) {
    if (result != null && typeof result !== 'string') {
      searchCount++;
      totalResultCount += result.content?.length ?? 0;
    }
  }

  return { searchCount, totalResultCount };
}

/**
 * Official 2.1.328 `tCo` (`chunk@307352331.js`): validate/normalize a retry
 * status before handing it to the unified retry banner (`b2t`).
 */
function sanitizeSearchRetryStatus(status: unknown): Record<string, unknown> | null {
  if (status === null || typeof status !== 'object') return null;
  const candidate = status as Record<string, unknown>;
  if (
    candidate.kind !== 'retrying' &&
    candidate.kind !== 'stalled' &&
    candidate.kind !== 'auto_mode_unavailable' &&
    candidate.kind !== 'low_priority_waiting'
  ) {
    return null;
  }
  if (candidate.kind !== 'retrying') return candidate;
  if (
    typeof candidate.attempt !== 'number' ||
    !Number.isFinite(candidate.attempt) ||
    typeof candidate.maxRetries !== 'number' ||
    !Number.isFinite(candidate.maxRetries) ||
    typeof candidate.deadline !== 'number' ||
    !Number.isFinite(candidate.deadline)
  ) {
    return null;
  }
  const err = candidate.error;
  if (err !== null && typeof err === 'object' && typeof (err as { formatted?: unknown }).formatted === 'string') {
    return candidate;
  }
  const rawStatus =
    err !== null && typeof err === 'object' && 'status' in err ? (err as { status?: unknown }).status : undefined;
  return {
    ...candidate,
    error: {
      message: LEFTOVER_ZXT_API_ERROR,
      status: typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : undefined,
      formatted: LEFTOVER_ZXT_API_ERROR,
      connection: null,
      isNetworkDown: false,
      rateLimits: null,
      noResponse: null,
    },
  };
}

export function renderToolUseMessage(
  {
    query,
    allowed_domains,
    blocked_domains,
  }: Partial<{
    query: string;
    allowed_domains?: string[];
    blocked_domains?: string[];
  }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!query) {
    return null;
  }

  let message = '';

  if (query) {
    message += `"${query}"`;
  }

  if (verbose) {
    if (allowed_domains && allowed_domains.length > 0) {
      message += `, only allowing domains: ${allowed_domains.join(', ')}`;
    }

    if (blocked_domains && blocked_domains.length > 0) {
      message += `, blocking domains: ${blocked_domains.join(', ')}`;
    }
  }

  return message;
}

export function renderToolUseProgressMessage(
  progressMessages: ProgressMessage<WebSearchProgress>[],
  options?: { terminalSize?: { columns?: number } },
): React.ReactNode {
  if (progressMessages.length === 0) {
    return null;
  }

  const lastRetry = progressMessages.findLast(msg => msg?.data?.type === 'search_retry')?.data;
  const retryStatus = sanitizeSearchRetryStatus(lastRetry?.type === 'search_retry' ? lastRetry.status : null);
  if (retryStatus) {
    return (
      <MessageResponse>
        <RetryBanner status={retryStatus} columns={(options?.terminalSize?.columns ?? 80) - WEB_SEARCH_RETRY_INDENT} />
      </MessageResponse>
    );
  }

  const data = progressMessages.findLast(msg => msg?.data?.type !== 'search_retry')?.data ?? lastRetry;
  if (!data) {
    return null;
  }

  switch (data.type) {
    case 'search_retry':
    case 'query_update':
      return (
        <MessageResponse>
          <Text dimColor>Searching: {data.query}</Text>
        </MessageResponse>
      );
    case 'search_results_received':
      return (
        <MessageResponse>
          <Text dimColor>
            Found {data.resultCount} {plural(data.resultCount, 'result')} for &quot;{data.query}&quot;
          </Text>
        </MessageResponse>
      );
    default:
      return null;
  }
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const searchCount =
    (output as { searchCount?: number }).searchCount ?? getSearchSummary(output.results ?? []).searchCount;
  const durationPart =
    output.durationSeconds >= 1
      ? ` in ${formatDuration(output.durationSeconds * 1000, { hideTrailingZeros: true })}`
      : '';

  return (
    <MessageResponse height={1}>
      <Text>
        Did {searchCount > 0 ? searchCount : 'no'} {searchCount === 1 ? 'search' : 'searches'}
        {durationPart}
      </Text>
    </MessageResponse>
  );
}

export function getToolUseSummary(input: Partial<{ query: string }> | undefined): string | null {
  if (!input?.query) {
    return null;
  }
  return truncate(input.query, TOOL_SUMMARY_MAX_LENGTH);
}
