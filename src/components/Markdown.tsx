import { marked, type Token, type Tokens } from 'marked';
import React, { Suspense, use, useMemo, useRef, type ReactNode } from 'react';
import { LRUCache } from 'lru-cache';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, useTheme } from '@anthropic/ink';
import { type CliHighlight, getCliHighlightPromise } from '../utils/cliHighlight.js';
import { hashContent } from '../utils/hash.js';
import { configureMarked, formatToken } from '../utils/markdown.js';
import { stripPromptXMLTags } from '../utils/messages.js';
import { MarkdownTable } from './MarkdownTable.js';

type Props = {
  children: string;
  /** When true, render all text content as dim */
  dimColor?: boolean;
  /**
   * Official 2.1.207: streaming freezes push intermediate source through
   * Markdown without polluting the immutable history token cache.
   */
  skipTokenCache?: boolean;
  /**
   * densable Sh tailWrap — Text wrap mode for the last non-table flush
   * (e.g. wrap-stream for incomplete streaming line).
   */
  tailWrap?:
    | 'wrap'
    | 'wrap-trim'
    | 'wrap-stream'
    | 'end'
    | 'middle'
    | 'truncate-end'
    | 'truncate'
    | 'truncate-middle'
    | 'truncate-start';
};

// Module-level token cache — marked.lexer is the hot cost on virtual-scroll
// remounts (~3ms per message). useMemo doesn't survive unmount→remount, so
// scrolling back to a previously-visible message re-parses. Messages are
// immutable in history; same content → same tokens. Keyed by hash to avoid
// retaining full content strings (turn50→turn99 RSS regression, #24180).
const tokenCache = new LRUCache<string, Token[]>({ max: 500 });

// Official 2.1.207 MD syntax probe (Huy): includes ordered lists + bare URLs.
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|(?:^|\n) {0,3}\d+\. |https?:\/\/|www\./;

function hasMarkdownSyntax(s: string): boolean {
  // Sample first 500 chars — if markdown exists it's usually early (headers,
  // code fence, list). Long tool outputs are mostly plain text tails.
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}

function lexMarkdown(content: string, useCache: boolean): Token[] {
  // Fast path: plain text with no markdown syntax → single paragraph token.
  if (!hasMarkdownSyntax(content)) {
    return [
      {
        type: 'paragraph',
        raw: content,
        text: content,
        tokens: [{ type: 'text', raw: content, text: content }],
      } as Token,
    ];
  }
  if (!useCache) {
    return marked.lexer(content);
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) return hit;
  const tokens = marked.lexer(content);
  tokenCache.set(key, tokens);
  return tokens;
}

/**
 * Renders markdown content using a hybrid approach:
 * - Tables are rendered as React components with proper flexbox layout
 * - Other content is rendered as ANSI strings via formatToken
 */
export function Markdown(props: Props): React.ReactNode {
  const settings = useSettings();
  if (settings.syntaxHighlightingDisabled) {
    return <MarkdownBody {...props} highlight={null} />;
  }
  // Suspense fallback renders with highlight=null — plain markdown shows
  // for ~50ms on first ever render while cli-highlight loads.
  return (
    <Suspense fallback={<MarkdownBody {...props} highlight={null} />}>
      <MarkdownWithHighlight {...props} />
    </Suspense>
  );
}

function MarkdownWithHighlight(props: Props): React.ReactNode {
  const highlight = use(getCliHighlightPromise());
  return <MarkdownBody {...props} highlight={highlight} />;
}

function MarkdownBody({
  children,
  dimColor,
  skipTokenCache,
  tailWrap,
  highlight,
}: Props & { highlight: CliHighlight | null }): React.ReactNode {
  const [theme] = useTheme();
  configureMarked();

  const elements = useMemo(() => {
    const tokens = lexMarkdown(stripPromptXMLTags(children), skipTokenCache !== true);
    const elements: React.ReactNode[] = [];
    let nonTableContent = '';

    // densable Sh: only the final non-table flush gets tailWrap
    function flushNonTableContent(wrap?: Props['tailWrap']): void {
      if (nonTableContent) {
        elements.push(
          <Ansi key={elements.length} dimColor={dimColor} wrap={wrap}>
            {nonTableContent.trim()}
          </Ansi>,
        );
        nonTableContent = '';
      }
    }

    for (const token of tokens) {
      if (token.type === 'table') {
        flushNonTableContent();
        elements.push(<MarkdownTable key={elements.length} token={token as Tokens.Table} highlight={highlight} />);
      } else {
        nonTableContent += formatToken(token, theme, 0, null, null, highlight);
      }
    }

    flushNonTableContent(tailWrap);
    return elements;
  }, [children, dimColor, highlight, theme, skipTokenCache, tailWrap]);

  return (
    <Box flexDirection="column" gap={1}>
      {elements}
    </Box>
  );
}

// ─── Official 2.1.207 StreamingMarkdown (ths / isd / dpo / asd) ──────────────
// Freeze completed chunks once the unfrozen tail exceeds FREEZE_CHARS so long
// streamed lists/tables/code no longer re-lex+re-render the entire response
// on every delta (terminal freeze fix).

/** Official ZGr: freeze when unfrozen source exceeds this many chars. */
export const STREAM_MD_FREEZE_CHARS = 4096;
/** Official ssd: soft-split keeps about this many chars in the live tail. */
export const STREAM_MD_SOFT_TAIL_CHARS = 1536;
/** Official lsd: GFM fenced code open/close lines. */
export const STREAM_MD_FENCE_RE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm;

export type StreamMarkdownState = {
  chunks: ReactNode[];
  frozenSource: string;
  gapAfterChunks: boolean;
  stablePrefix: string;
  openFence: string | null;
};

export function createStreamMarkdownState(): StreamMarkdownState {
  return {
    chunks: [],
    frozenSource: '',
    gapAfterChunks: false,
    stablePrefix: '',
    openFence: null,
  };
}

/** Official csd: does this fence line close the open fence marker? */
export function isClosingFenceLine(openFence: string, marker: string, info: string): boolean {
  const openMarker = openFence.match(/^`+|^~+/)?.[0] ?? '';
  return marker[0] === openMarker[0] && marker.length >= openMarker.length && info.trim() === '';
}

/** Official Puy: track open fence across a source slice. */
export function updateOpenFence(openFence: string | null, source: string): string | null {
  let current = openFence;
  for (const match of source.matchAll(STREAM_MD_FENCE_RE)) {
    const marker = match[1] ?? '';
    const info = match[2] ?? '';
    if (current === null) {
      current = marker + info.trim();
    } else if (isClosingFenceLine(current, marker, info)) {
      current = null;
    }
  }
  return current;
}

/**
 * Official Ouy: index just past a closing fence line for `openFence`, or -1.
 */
export function findClosingFenceEnd(source: string, openFence: string): number {
  for (const match of source.matchAll(STREAM_MD_FENCE_RE)) {
    const end = (match.index ?? 0) + match[0].length;
    // Fence must be a full line (newline or EOF after).
    if (source[end] !== undefined && source[end] !== '\n') continue;
    if (isClosingFenceLine(openFence, match[1] ?? '', match[2] ?? '')) {
      return end + (source[end] === '\n' ? 1 : 0);
    }
  }
  return -1;
}

/**
 * Official asd: soft-split index for an oversize unfrozen tail — prefer a
 * newline, then a space, then a raw cut (with surrogate-pair guard).
 */
export function softSplitIndex(source: string): number {
  let idx = source.lastIndexOf('\n');
  if (idx < STREAM_MD_FREEZE_CHARS / 2) {
    idx = source.lastIndexOf(' ', source.length - STREAM_MD_SOFT_TAIL_CHARS);
  }
  if (idx < STREAM_MD_FREEZE_CHARS / 2) {
    idx = source.length - STREAM_MD_SOFT_TAIL_CHARS;
    const next = source.charCodeAt(idx + 1);
    // Don't split a surrogate pair mid-codepoint.
    if (next >= 0xdc00 && next <= 0xdfff) idx--;
  }
  return idx + 1;
}

type StreamingProps = {
  children: string;
  /**
   * densable aPa hideTrailingLine: when true and the unstable tail does not
   * end with a newline, mark the live markdown tail as wrap-stream (Ink
   * soft-wrap for in-progress source line). Only applies when transformed
   * display is absent (raw path).
   */
  hideTrailingLine?: boolean;
};

/**
 * Official 2.1.207 StreamingMarkdown (`ths` / densable `aPa`):
 * - Advance a stablePrefix at completed marked block boundaries.
 * - Freeze stable source into immutable React chunks once it exceeds 4KiB
 *   (or soft-split oversize open fences / live tails).
 * - Track open code fences so mid-fence freezes re-open the fence on the
 *   next chunk and closing fences flush cleanly.
 * - densable: hideTrailingLine → tailWrap wrap-stream on incomplete live line.
 */
export function StreamingMarkdown({ children, hideTrailingLine = false }: StreamingProps): React.ReactNode {
  // Mutates stream state during render (monotonic freeze). Opt out of React
  // Compiler memoization — same contract as the pre-2.1.207 stablePrefix path.
  'use no memo';
  configureMarked();

  const stripped = stripPromptXMLTags(children);
  const state = useRef(createStreamMarkdownState()).current;

  if (!stripped.startsWith(state.frozenSource)) {
    Object.assign(state, createStreamMarkdownState());
  }

  let live = stripped.substring(state.frozenSource.length);
  if (!live.startsWith(state.stablePrefix)) {
    state.stablePrefix = '';
  }

  const freezeUpTo = (source: string, end: number, gapAfter: boolean): string => {
    const frozenSlice = source.substring(0, end);
    const markdownSource = state.openFence !== null ? `${state.openFence}\n${frozenSlice}` : frozenSlice;
    state.chunks.push(
      <Box key={state.chunks.length} marginTop={state.chunks.length > 0 && state.gapAfterChunks ? 1 : 0}>
        <Markdown skipTokenCache>{markdownSource}</Markdown>
      </Box>,
    );
    state.openFence = updateOpenFence(state.openFence, frozenSlice);
    state.frozenSource += frozenSlice;
    state.gapAfterChunks = gapAfter;
    state.stablePrefix = '';
    return source.substring(end);
  };

  if (state.openFence !== null) {
    const closeAt = findClosingFenceEnd(live, state.openFence);
    if (closeAt >= 0) {
      live = freezeUpTo(live, closeAt, true);
    } else if (live.length > STREAM_MD_FREEZE_CHARS) {
      live = freezeUpTo(live, softSplitIndex(live), false);
    }
  }

  if (state.openFence === null) {
    const boundary = state.stablePrefix.length;
    const tokens = marked.lexer(live.substring(boundary));
    let lastContentIdx = tokens.length - 1;
    while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === 'space') {
      lastContentIdx--;
    }
    let advance = 0;
    for (let i = 0; i < lastContentIdx; i++) {
      advance += tokens[i]!.raw.length;
    }
    if (advance > 0) {
      state.stablePrefix = live.substring(0, boundary + advance);
    }
    if (state.stablePrefix.length > STREAM_MD_FREEZE_CHARS) {
      live = freezeUpTo(live, state.stablePrefix.length, true);
    }
    if (live.length - state.stablePrefix.length > STREAM_MD_FREEZE_CHARS) {
      const start = state.stablePrefix.length;
      const split = softSplitIndex(live.substring(start));
      live = freezeUpTo(live, start + split, false);
    }
  }

  const stablePrefix = state.stablePrefix;
  const unstableSuffix = live.substring(stablePrefix.length);
  const hasStable = stablePrefix.trim() !== '';
  const unstableForRender =
    unstableSuffix && state.openFence !== null ? `${state.openFence}\n${unstableSuffix}` : unstableSuffix;
  // densable aPa: hideTrailingLine && !suffix.endsWith('\n') → tailWrap wrap-stream
  const incompleteLiveLine = !unstableSuffix.endsWith('\n');
  const tailWrap = hideTrailingLine && incompleteLiveLine ? ('wrap-stream' as const) : undefined;
  const unstableEl = unstableSuffix ? (
    <Markdown skipTokenCache tailWrap={tailWrap}>
      {unstableForRender}
    </Markdown>
  ) : null;

  if (state.chunks.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        {hasStable && <Markdown skipTokenCache>{stablePrefix}</Markdown>}
        {unstableEl}
      </Box>
    );
  }

  const gap = state.gapAfterChunks ? 1 : 0;
  return (
    <Box flexDirection="column">
      {state.chunks}
      {hasStable && (
        <Box marginTop={gap}>
          <Markdown skipTokenCache>{stablePrefix}</Markdown>
        </Box>
      )}
      {unstableEl && <Box marginTop={hasStable ? 1 : gap}>{unstableEl}</Box>}
    </Box>
  );
}
