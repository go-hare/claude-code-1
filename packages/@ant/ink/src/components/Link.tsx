import type { ReactNode } from 'react';
import React from 'react';
import { getForcedHyperlinkSupport, supportsHyperlinks } from '../core/supports-hyperlinks.js';
import Text from './Text.js';

export type Props = {
  readonly children?: ReactNode;
  readonly url: string;
  readonly fallback?: ReactNode;
  /** densable assumeSupport — force OSC 8 wrap unless FORCE_HYPERLINK=0 */
  readonly assumeSupport?: boolean;
};

export default function Link({ children, url, fallback, assumeSupport = false }: Props): React.ReactNode {
  // Use children if provided, otherwise display the URL
  const content = children ?? url;

  // densable Ot @197212343: `c ? tAe() ?? true : G_()`
  const forced = getForcedHyperlinkSupport();
  const enabled = forced !== undefined ? forced : assumeSupport || supportsHyperlinks();
  if (enabled) {
    // Wrap in Text to ensure we're in a text context
    // (ink-link is a text element like ink-text)
    return (
      <Text>
        <ink-link href={url}>{content}</ink-link>
      </Text>
    );
  }

  return <Text>{fallback ?? content}</Text>;
}
