import * as React from 'react';
import { pathToFileURL } from 'url';
import { Box, Link, supportsHyperlinks, Text } from '@anthropic/ink';
import { useAppStateMaybeOutsideOfProvider } from '../../state/AppState.js';
import { MessageResponse } from '../MessageResponse.js';

type Props = {
  imageId?: number;
  addMargin?: boolean;
  startsUserTurn?: boolean;
};

/**
 * Renders an image attachment in user messages.
 * densable Us: path from AppState.storedImagePaths and optional description from
 * AppState.imageDescriptions. Shows as a clickable link if the image is stored
 * and terminal supports hyperlinks. Uses MessageResponse styling unless this
 * image starts a new user turn (startsUserTurn ?? addMargin).
 */
export function UserImageMessage({ imageId, addMargin, startsUserTurn }: Props): React.ReactNode {
  const label = imageId ? `[Image #${imageId}]` : '[Image]';
  const imagePath =
    useAppStateMaybeOutsideOfProvider(s =>
      imageId !== undefined ? (s.storedImagePaths.get(imageId) ?? null) : null,
    ) ?? null;
  const imageDescription =
    useAppStateMaybeOutsideOfProvider(s => {
      if (imageId === undefined) return null;
      const descriptions = (s as { imageDescriptions?: ReadonlyMap<number, string> }).imageDescriptions;
      return descriptions?.get(imageId) ?? null;
    }) ?? null;

  const labelNode =
    imagePath && supportsHyperlinks() ? (
      <Link url={pathToFileURL(imagePath).href}>
        <Text>{label}</Text>
      </Link>
    ) : (
      <Text>{label}</Text>
    );

  const content = (
    <Text>
      {labelNode}
      {imageDescription ? <Text dimColor> {imageDescription}</Text> : null}
    </Text>
  );

  // When this image starts a new user turn (no text before it),
  // show without the connected ⎿ gutter even when a metadata header suppressed addMargin.
  if (startsUserTurn ?? addMargin) {
    return <Box marginTop={addMargin ? 1 : 0}>{content}</Box>;
  }

  return <MessageResponse>{content}</MessageResponse>;
}
