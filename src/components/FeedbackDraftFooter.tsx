import React from 'react';
import { Text } from '@anthropic/ink';
import { plural } from '../utils/stringUtils.js';
import { useSessionDraftCount } from '../utils/feedbackDrafts/useSessionDraftCount.js';

/** densable leftover QO */
export function FeedbackDraftFooter({ count }: { count: number }): React.ReactNode {
  if (count <= 0) return null;
  return (
    <Text dimColor>
      {count} {plural(count, 'feedback draft')}
    </Text>
  );
}

export function FeedbackDraftFooterCount(): React.ReactNode {
  return <FeedbackDraftFooter count={useSessionDraftCount()} />;
}
