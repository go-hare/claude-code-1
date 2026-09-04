import type { ReactNode } from 'react';
import React from 'react';
import { supportsHyperlinks } from '../core/supports-hyperlinks.js';
import Text from './Text.js';

export type Props = {
  readonly children?: ReactNode;
  readonly url: string;
  readonly fallback?: ReactNode;
  /** densable assumeSupport — force OSC 8 wrap even when autodetection is off */
  readonly assumeSupport?: boolean;
};

export default function Link({ children, url, fallback, assumeSupport = false }: Props): React.ReactNode {
  // Use children if provided, otherwise display the URL
  const content = children ?? url;

  if (assumeSupport || supportsHyperlinks()) {
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
