import React from 'react';
import { Link, Text } from '@anthropic/ink';
import type { PrReviewState } from '../utils/ghPrStatus.js';
import { codeChangeNumberPrefix, codeChangeProviderFromUrl } from '../utils/worktree.js';

type Props = {
  number: number;
  url: string;
  reviewState?: PrReviewState;
  bold?: boolean;
};

export function PrBadge({ number, url, reviewState, bold }: Props): React.ReactNode {
  const statusColor = getPrStatusColor(reviewState);
  // densable 2.1.233 #1 — GitLab MR display uses !N; GitHub/Bitbucket keep #N
  const sigil = codeChangeNumberPrefix(codeChangeProviderFromUrl(url));
  const numLabel = `${sigil}${number}`;
  const kind = sigil === '!' ? 'MR' : 'PR';
  const label = (
    <Text color={statusColor} dimColor={!statusColor && !bold} bold={bold}>
      {numLabel}
    </Text>
  );
  return (
    <Text>
      <Text dimColor={!bold}>{kind}</Text>{' '}
      <Link url={url} fallback={label}>
        <Text color={statusColor} dimColor={!statusColor && !bold} underline bold={bold}>
          {numLabel}
        </Text>
      </Link>
    </Text>
  );
}

function getPrStatusColor(state?: PrReviewState): 'success' | 'error' | 'warning' | 'merged' | undefined {
  switch (state) {
    case 'approved':
      return 'success';
    case 'changes_requested':
      return 'error';
    case 'pending':
      return 'warning';
    case 'merged':
      return 'merged';
    default:
      return undefined;
  }
}
