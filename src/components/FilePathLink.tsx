import React, { createContext, useContext } from 'react';
import { isAbsolute, win32 } from 'path';
import { pathToFileURL } from 'url';
import { Link, Text, stringWidth } from '@anthropic/ink';
import { getPlatform } from '../utils/platform.js';
import { truncatePathMiddle } from '../utils/truncate.js';

type Props = {
  /** The absolute file path */
  filePath: string;
  /** Optional display text (defaults to filePath) */
  children?: React.ReactNode;
};

/** densable hbo — max columns for FilePathLink labels. null = do not truncate. */
export const FilePathWidthContext = createContext<number | null>(null);

/**
 * densable e7h — leftover columns for the tool-use `({args})` path after the
 * name (and optional spinner/dot). Floor 20.
 */
export function toolUsePathWidth(columns: number, shouldShowDot: boolean, toolName: string): number {
  return Math.max(columns - (shouldShowDot ? 2 : 0) - stringWidth(toolName) - 2, 20);
}

/** densable Ucs — only drive/UNC-style Windows abs paths become file:// links. */
export function isLinkableAbsolutePath(filePath: string): boolean {
  if (getPlatform() === 'windows') {
    return win32.isAbsolute(filePath) && win32.parse(filePath).root.length > 1;
  }
  return isAbsolute(filePath);
}

/** densable HN label clamp: AU only when width context is a number and label is a string. */
export function clampPathLabel(label: React.ReactNode, width: number | null): React.ReactNode {
  return width !== null && typeof label === 'string' ? truncatePathMiddle(label, width) : label;
}

/**
 * Renders a file path as an OSC 8 hyperlink when the path is a real absolute
 * file path. Relative / drive-relative Windows paths stay plain text (official HN).
 */
export function FilePathLink({ filePath, children }: Props): React.ReactNode {
  const width = useContext(FilePathWidthContext);
  const label = clampPathLabel(children ?? filePath, width);
  let url: string | null = null;
  if (isLinkableAbsolutePath(filePath)) {
    try {
      url = pathToFileURL(filePath).href;
    } catch {
      url = null;
    }
  }
  if (url === null) {
    return <Text>{label}</Text>;
  }
  return <Link url={url}>{label}</Link>;
}
