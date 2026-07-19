/**
 * densable qIa residual — footer frame pill when AppState.frameUrls non-empty.
 * Shows basename of the nav-selected (or latest) frame; click opens with via=banner_open.
 */
import * as React from 'react';
import { basename } from 'path';
import { Box, Text } from '@anthropic/ink';
import { useAppState } from 'src/state/AppState.js';
import { withBannerOpenParam } from '../../utils/openArtifactShortcut.js';
import { selectFrameNavIndex, type FrameUrlEntry } from '../../utils/frameUrls.js';
import { openBrowser } from '../../utils/browser.js';
import { logEvent } from '../../services/analytics/index.js';

type Props = {
  isSelected?: boolean;
};

export function FrameFooterStatus({ isSelected }: Props): React.ReactNode {
  const frameUrls = useAppState(s => s.frameUrls ?? {});
  const frameNavPath = useAppState(s => s.frameNavPath);
  const frameExpanded = useAppState(s => s.frameExpanded);
  const entries = React.useMemo(() => Object.entries(frameUrls) as [string, FrameUrlEntry][], [frameUrls]);
  if (entries.length === 0) return null;

  const idx = selectFrameNavIndex(entries, frameNavPath);
  const [path, entry] = entries[idx] ?? entries[entries.length - 1]!;
  const name = entry.title ?? basename(path);
  const count = entries.length;
  const label = frameExpanded && count > 1 ? `${name} (${idx + 1}/${count})` : count > 1 ? `${name} · ${count}` : name;

  return (
    <Box
      flexShrink={0}
      onClick={() => {
        void openBrowser(withBannerOpenParam(entry.url));
        logEvent('frame_link_open', {});
      }}
    >
      <Text dimColor={!isSelected} inverse={isSelected} color={isSelected ? 'claude' : undefined}>
        {label}
      </Text>
    </Box>
  );
}
