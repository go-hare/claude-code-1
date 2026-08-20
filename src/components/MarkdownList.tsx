/**
 * densable 2.1.235 #3 — Ink list path (Hqi / WIl / n6T).
 * Flex hanging indent: [indent spacer][marker cell][content column],
 * nested indent capped at LIST_INDENT_CAP (OIl=32).
 */
import type { Token, Tokens } from 'marked';
import React, { useMemo } from 'react';
import { Ansi, Box, Text, stringWidth, useTheme } from '@anthropic/ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { CliHighlight } from '../utils/cliHighlight.js';
import {
  endsWithBlankLine,
  formatListMarker,
  formatToken,
  isListBlockToken,
  LIST_COLUMN_SAFETY_MARGIN,
  LIST_CONTENT_MIN_WIDTH_CAP,
  LIST_INDENT_CAP,
  LIST_MARKER_MIN_WIDTH,
  listItemNeedsBlankBefore,
  listNumberRange,
} from '../utils/markdown.js';
import type { ThemeName } from '../utils/theme.js';

type WrapMode =
  | 'wrap'
  | 'wrap-trim'
  | 'wrap-stream'
  | 'end'
  | 'middle'
  | 'truncate-end'
  | 'truncate'
  | 'truncate-middle'
  | 'truncate-start';

type MarkdownListProps = {
  token: Tokens.List;
  highlight: CliHighlight | null;
  dimColor?: boolean;
  italic?: boolean;
  tailWrap?: WrapMode;
};

type ListShared = {
  theme: ThemeName;
  highlight: CliHighlight | null;
  dimColor?: boolean;
  italic?: boolean;
  minContentWidth: number;
  tailWrap?: WrapMode;
};

export function MarkdownList({ token, highlight, dimColor, italic, tailWrap }: MarkdownListProps): React.ReactNode {
  const [theme] = useTheme();
  const { columns } = useTerminalSize();
  const minContentWidth = Math.max(
    1,
    Math.min(LIST_CONTENT_MIN_WIDTH_CAP, columns - LIST_MARKER_MIN_WIDTH - LIST_COLUMN_SAFETY_MARGIN),
  );
  const shared: ListShared = useMemo(
    () => ({
      theme,
      highlight,
      dimColor,
      italic,
      minContentWidth,
      tailWrap,
    }),
    [theme, highlight, dimColor, italic, minContentWidth, tailWrap],
  );
  return (
    <Box flexDirection="column">
      <MarkdownListItems token={token} indent={0} listDepth={0} shared={shared} />
    </Box>
  );
}

function MarkdownListItems({
  token,
  indent,
  listDepth,
  shared,
}: {
  token: Tokens.List;
  indent: number;
  listDepth: number;
  shared: ListShared;
}): React.ReactNode {
  const range = listNumberRange(token);
  return token.items.map((item, index) => (
    <MarkdownListItem
      key={index}
      item={item}
      marker={formatListMarker(listDepth, token.ordered ? { number: range.first + index, ...range } : null)}
      indent={indent}
      listDepth={listDepth}
      blankLineBefore={index > 0 && listItemNeedsBlankBefore(token.items[index - 1]!)}
      shared={shared}
      tailWrap={index === token.items.length - 1 ? shared.tailWrap : undefined}
    />
  ));
}

type Segment =
  | { kind: 'inline'; text: string }
  | { kind: 'block'; text: string; code: boolean }
  | { kind: 'list'; token: Tokens.List };

function MarkdownListItem({
  item,
  marker,
  indent,
  listDepth,
  blankLineBefore,
  shared,
  tailWrap,
}: {
  item: Tokens.ListItem;
  marker: string;
  indent: number;
  listDepth: number;
  blankLineBefore: boolean;
  shared: ListShared;
  tailWrap?: WrapMode;
}): React.ReactNode {
  const segments: Segment[] = [];
  for (const child of item.tokens) {
    // marked GFM may emit checkbox tokens; densable folds into list_item.task.
    if (child.type === 'checkbox') {
      continue;
    }
    if (child.type === 'list') {
      segments.push({ kind: 'list', token: child as Tokens.List });
      continue;
    }
    const rendered = formatToken(child, shared.theme, listDepth + 1, null, item, shared.highlight);
    if (isListBlockToken(child)) {
      segments.push({
        kind: 'block',
        text: rendered,
        code: child.type === 'code',
      });
      continue;
    }
    const last = segments.at(-1);
    if (last?.kind === 'inline') {
      last.text += rendered;
    } else {
      segments.push({ kind: 'inline', text: rendered });
    }
  }
  if (segments[0]?.kind !== 'inline') {
    segments.unshift({ kind: 'inline', text: '' });
  }

  const markerCellWidth = stringWidth(marker) + 1;
  const nestedIndent = Math.min(indent + markerCellWidth, LIST_INDENT_CAP);
  let marginPending = blankLineBefore;
  const lastIndex = segments.length - 1;

  return segments.map((segment, index) => {
    const wrap = index === lastIndex ? tailWrap : undefined;
    if (segment.kind === 'inline') {
      const startsWithNewline = segment.text.startsWith('\n');
      const blankEnd = endsWithBlankLine(segment.text);
      const text = segment.text.replace(/^\n+/, '').trimEnd();
      if (!text && index > 0) {
        marginPending = marginPending || segment.text.includes('\n');
        return null;
      }
      const node = (
        <Box key={index} flexDirection="row" marginTop={marginPending || (index > 0 && startsWithNewline) ? 1 : 0}>
          <Box flexShrink={1} width={indent} />
          <Box flexShrink={1} width={markerCellWidth} minWidth={LIST_MARKER_MIN_WIDTH}>
            {index === 0 ? (
              <Text dimColor={shared.dimColor} italic={shared.italic}>
                {marker}
              </Text>
            ) : null}
          </Box>
          <Box flexDirection="column" flexShrink={1000} minWidth={shared.minContentWidth}>
            <Ansi dimColor={shared.dimColor} wrap={wrap}>
              {text}
            </Ansi>
          </Box>
        </Box>
      );
      marginPending = blankEnd;
      return node;
    }
    if (segment.kind === 'block') {
      const body = segment.code ? segment.text.replace(/\n$/, '') : segment.text.replace(/^\n+/, '').trimEnd();
      const node = (
        <Box key={index} marginTop={marginPending ? 1 : 0}>
          <Ansi dimColor={shared.dimColor} wrap={wrap}>
            {body}
          </Ansi>
        </Box>
      );
      marginPending = false;
      return node;
    }
    const node = (
      <Box key={index} flexDirection="column" marginTop={marginPending ? 1 : 0}>
        <MarkdownListItems
          token={segment.token}
          indent={nestedIndent}
          listDepth={listDepth + 1}
          shared={{ ...shared, tailWrap: wrap }}
        />
      </Box>
    );
    marginPending = false;
    return node;
  });
}
