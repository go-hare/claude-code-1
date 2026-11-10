import chalk from 'chalk';
import { Marked, marked, type Token, type Tokens } from 'marked';
import React, { useMemo, useRef, type ReactNode } from 'react';
import { LRUCache } from 'lru-cache';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, Text, useTheme, type Theme } from '@anthropic/ink';
import { type CliHighlight, peekCliHighlight } from '../utils/cliHighlight.js';
import { logForDebugging } from '../utils/debug.js';
import { hashContent } from '../utils/hash.js';
import { logError } from '../utils/log.js';
import { configureMarked, endsWithBlankLine, formatToken, shouldUseInkListLayout } from '../utils/markdown.js';
import { stripPromptXMLTags } from '../utils/messages.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import { countCharInString } from '../utils/stringUtils.js';
import type { ThemeName } from '../utils/theme.js';
import { MarkdownList } from './MarkdownList.js';
import { MarkdownTable } from './MarkdownTable.js';

type Props = {
  children: string;
  /** When true, render all text content as dim */
  dimColor?: boolean;
  /** When true, render all text content as italic */
  italic?: boolean;
  /** When true, strip ANSI foreground colors so parent Text color wins */
  monochrome?: boolean;
  /**
   * densable w0l `color` — wrap flushed ANSI in Ink Text with theme color
   * (user-prompt markdown inherits `text` / brief colors).
   */
  color?: keyof Theme;
  /**
   * densable jh `promptMode` — user-prompt markdown: lean lexer (no tables /
   * blockquotes / links), skip stripPromptTags + issue-ref linkify, raw
   * fallback when lexer yields nothing.
   */
  promptMode?: boolean;
  /**
   * densable w0l `stripPromptTags` — default true; forced off under promptMode.
   */
  stripPromptTags?: boolean;
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
  /**
   * densable xi capProseWidth — when true, prose (not tables/code) wraps at
   * settings.maxProseWidth. Assistant/streaming paths pass true.
   */
  capProseWidth?: boolean;
  /**
   * densable Or `hint` — append ` · ${hint}` on the last flushed prose/code
   * (Za `"summary"`). If never consumed, a leftover subtle row.
   */
  hint?: string;
};

// Module-level token cache — marked.lexer is the hot cost on virtual-scroll
// remounts (~3ms per message). useMemo doesn't survive unmount→remount, so
// scrolling back to a previously-visible message re-parses. Messages are
// immutable in history; same content → same tokens. Keyed by hash to avoid
// retaining full content strings (turn50→turn99 RSS regression, #24180).
const tokenCache = new LRUCache<string, Token[]>({ max: 500 });

// densable 2.1.289 an: CRLF blank lines, `N)` / `+` lists, setext `=`.
const MD_SYNTAX_RE =
  /[#*`|[>\-_~]|\n[\r\n]|\r\r|\r\n[\r\n]|(?:^|[\r\n]) {0,3}(?:\d+[.)]|\+) |(?:^|[\r\n]) {0,3}=+ *(?:[\r\n]|$)|https?:\/\/|www\./;
const NBSP_ENTITY = '&nbsp;';

/** densable 2.1.246 #9 — first-500 probe helper. */
export function hasMarkdownSyntax(s: string): boolean {
  return MD_SYNTAX_RE.test(s.slice(0, 500));
}

function hasFullMarkdownSyntax(s: string, promptMode = false): boolean {
  return MD_SYNTAX_RE.test(s) || (!promptMode && s.includes(NBSP_ENTITY));
}

const SGR_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional CSI SGR sequence match
  /\x1b\[([0-9;]*)m/g;

function stripForegroundSgr(input: string): string {
  return input.replace(SGR_RE, (full, params: string) => {
    if (params === '') return full;
    const codes = params.split(';').map(Number);
    const kept: number[] = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!;
      if (code === 38) {
        const mode = codes[i + 1];
        if (mode === 5) {
          i += 2;
        } else if (mode === 2) {
          i += 4;
        }
        continue;
      }
      if ((code >= 30 && code <= 37) || code === 39 || (code >= 90 && code <= 97)) {
        continue;
      }
      kept.push(code);
    }
    return kept.length > 0 ? `\x1b[${kept.join(';')}m` : '';
  });
}

function applyAnsiTextOverrides(text: string, italic?: boolean, monochrome?: boolean): string {
  if (!text) return text;
  let out = monochrome ? stripForegroundSgr(text) : text;
  if (italic) {
    out = `\x1b[3m${out.replace(SGR_RE, match => `${match}\x1b[3m`)}\x1b[23m`;
  }
  return out;
}

/**
 * densable z6m — lean Marked for user-prompt mode: keep code/lists/emphasis,
 * disable tables/blockquotes/hr/links/autolinks (and related) so prompts don't
 * grow reply-style chrome.
 */
const promptModeMarked = new Marked({
  tokenizer: {
    // densable: only allow underscore emStrong; `*...*` stays literal-ish.
    emStrong(src) {
      return src.startsWith('_') ? undefined : false;
    },
    // densable j6m.def — disable reference definitions
    def() {
      return undefined;
    },
    table() {
      return undefined;
    },
    blockquote() {
      return undefined;
    },
    hr() {
      return undefined;
    },
    lheading() {
      return undefined;
    },
    link() {
      return undefined;
    },
    autolink() {
      return undefined;
    },
    url() {
      return undefined;
    },
    escape() {
      return undefined;
    },
    br() {
      return undefined;
    },
  },
});

function plainParagraphTokens(content: string): Token[] {
  return [
    {
      type: 'paragraph',
      raw: content,
      text: content,
      tokens: [{ type: 'text', raw: content, text: content }],
    } as Token,
  ];
}

function safeLex(lexer: Marked | typeof marked, content: string): Token[] {
  try {
    return lexer.lexer(content);
  } catch (err) {
    if (err instanceof RangeError) {
      logForDebugging(`marked.lexer overflow on ${content.length} chars`, { level: 'error' });
    } else {
      logError(err as Error);
    }
    return plainParagraphTokens(content);
  }
}

function lexMarkdown(content: string, useCache: boolean, promptMode = false): Token[] {
  // densable mn: cache lookup first (LRU refresh), then fast path, then safe lex.
  const key = useCache ? `${promptMode ? '_' : ''}${content.length}:${hashContent(content)}` : '';
  if (useCache) {
    const hit = tokenCache.get(key);
    if (hit) return hit;
  }
  if (!hasFullMarkdownSyntax(content, promptMode)) {
    return plainParagraphTokens(content);
  }
  const lexer = promptMode ? promptModeMarked : marked;
  const tokens = safeLex(lexer, content);
  if (useCache) {
    tokenCache.set(key, tokens);
  }
  return tokens;
}

const QUOTE_GUTTER_WIDTH = 2;

function tokenContainsFullWidthBlock(root: Token): boolean {
  const stack: Token[] = [root];
  for (let tok = stack.pop(); tok !== undefined; tok = stack.pop()) {
    if (tok.type === 'code' || tok.type === 'table') return true;
    const children: Token[] =
      tok.type === 'list'
        ? ((tok as Tokens.List).items as unknown as Token[])
        : tok.type === 'blockquote' || tok.type === 'list_item'
          ? ((tok as { tokens?: Token[] }).tokens ?? [])
          : [];
    for (const child of children) {
      stack.push(child);
    }
  }
  return false;
}

function MarkdownBlockquote({
  token,
  theme,
  highlight,
  dimColor,
  isScreenReader,
  maxWidth,
}: {
  token: Tokens.Blockquote;
  theme: ThemeName;
  highlight: CliHighlight | null;
  dimColor?: boolean;
  isScreenReader: boolean;
  maxWidth?: number;
}): React.ReactNode {
  const parts = token.tokens.map(child => ({
    code: child.type === 'code',
    fullWidth: maxWidth !== undefined && tokenContainsFullWidthBlock(child),
    text: formatToken(child, theme, 0, null, null, highlight),
  }));

  if (maxWidth === undefined || isScreenReader || !parts.some(p => p.fullWidth)) {
    const body = chalk.italic(
      parts
        .map(p => p.text)
        .join('')
        .replace(/^\n+/, '')
        .trimEnd(),
    );
    return (
      <Box
        borderStyle="quote"
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderDimColor
        paddingLeft={1}
        maxWidth={maxWidth}
      >
        <Ansi dimColor={dimColor}>{body}</Ansi>
      </Box>
    );
  }

  const merged: Array<{ code: boolean; fullWidth: boolean; text: string }> = [];
  for (const part of parts) {
    const prev = merged.at(-1);
    if (prev && !prev.fullWidth && !part.fullWidth) {
      prev.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }

  const rows: React.ReactNode[] = [];
  let pendingNewlines = 0;
  for (const part of merged) {
    const leadingTrimmed = part.code ? part.text : part.text.replace(/^\n+/, '');
    const trimmed = part.code ? leadingTrimmed.replace(/\n$/, '') : leadingTrimmed.trimEnd();
    if (!trimmed) {
      pendingNewlines += countCharInString(part.text, '\n');
      continue;
    }
    pendingNewlines += part.text.length - leadingTrimmed.length;
    rows.push(
      <Box
        key={rows.length}
        marginTop={rows.length > 0 ? Math.max(0, pendingNewlines - 1) : 0}
        maxWidth={part.fullWidth ? undefined : maxWidth - QUOTE_GUTTER_WIDTH}
      >
        <Ansi dimColor={dimColor}>{chalk.italic(trimmed)}</Ansi>
      </Box>,
    );
    pendingNewlines = countCharInString(leadingTrimmed.slice(trimmed.length), '\n');
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="quote"
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderDimColor
      paddingLeft={1}
    >
      {rows}
    </Box>
  );
}

/**
 * Renders markdown content using a hybrid approach:
 * - Tables and blockquotes are rendered as React components with proper flexbox layout
 * - Other content is rendered as ANSI strings via formatToken
 */
export function Markdown(props: Props): React.ReactNode {
  const settings = useSettings();
  // gold oa: gN() is a sync snapshot (null until loaded). Do not Suspense —
  // fallback→highlight remount DualInk leftoverGs-clears the spinner row
  // on the first streaming token. Do not subscribe — gold oa does not
  // re-render markdown when gN later lands.
  const highlight = settings.syntaxHighlightingDisabled ? null : peekCliHighlight();
  return <MarkdownBody {...props} highlight={highlight} />;
}

type BlockKind = 'none' | 'prose' | 'list' | 'code' | 'block';

function MarkdownBody({
  children,
  color,
  dimColor,
  italic,
  monochrome,
  promptMode = false,
  stripPromptTags,
  skipTokenCache,
  tailWrap,
  capProseWidth,
  hint,
  highlight,
}: Props & { highlight: CliHighlight | null }): React.ReactNode {
  const [theme] = useTheme();
  const settings = useSettings();
  configureMarked();
  // densable w0l: stripPromptTags defaults true, but promptMode skips stripping.
  const shouldStrip = (stripPromptTags ?? true) && !promptMode;
  const maxProseWidth = capProseWidth ? settings.maxProseWidth : undefined;
  const isScreenReader = isScreenReaderModeEnabled();

  const elements = useMemo(() => {
    const source = shouldStrip ? stripPromptXMLTags(children) : children;
    const tokens = lexMarkdown(source, skipTokenCache !== true, promptMode);
    const elements: React.ReactNode[] = [];
    let nonTableContent = '';
    let prevKind: BlockKind = 'none';
    let hadBlankGap = false;
    let leftoverHintConsumed = false;
    const leftoverHint = hint ? `· ${hint}` : undefined;

    function leftoverHintNode(): React.ReactNode {
      if (!leftoverHint || leftoverHintConsumed) return null;
      leftoverHintConsumed = true;
      return <Text color="subtle"> {leftoverHint}</Text>;
    }

    // densable Or `J(node, marginTop, kind)` — 1-row block rhythm + maxWidth on prose only.
    function pushBlock(node: React.ReactNode, marginTop: number, kind: Exclude<BlockKind, 'none'>): void {
      elements.push(
        <Box key={elements.length} marginTop={marginTop} maxWidth={kind === 'prose' ? maxProseWidth : undefined}>
          {node}
        </Box>,
      );
      prevKind = kind;
      hadBlankGap = false;
    }

    function renderAnsiLeaf(text: string, wrap?: Props['tailWrap']): React.ReactNode {
      return (
        <Ansi dimColor={dimColor} wrap={wrap}>
          {applyAnsiTextOverrides(text, italic, monochrome)}
        </Ansi>
      );
    }

    // densable Or `O(wrap, withHint)`
    function flushNonTableContent(wrap?: Props['tailWrap'], withHint = false): void {
      if (!nonTableContent) return;
      const startsWithNewline = nonTableContent.startsWith('\n');
      const blankEnd = endsWithBlankLine(nonTableContent);
      const trimmed = nonTableContent.replace(/^\n+/, '').trimEnd();
      nonTableContent = '';
      if (!trimmed) {
        hadBlankGap = true;
        return;
      }
      const marginTop =
        prevKind === 'none' ? 0 : (prevKind === 'list' || prevKind === 'code') && !startsWithNewline ? 0 : 1;
      const ansi = renderAnsiLeaf(trimmed, wrap);
      const hintNode = withHint ? leftoverHintNode() : null;
      const inner =
        color || hintNode ? (
          <Text color={color} wrap={wrap}>
            {ansi}
            {hintNode}
          </Text>
        ) : (
          ansi
        );
      pushBlock(inner, marginTop, 'prose');
      hadBlankGap = blankEnd;
    }

    // densable Or `N(node, kind)`
    function pushStructuredBlock(node: React.ReactNode, kind: 'block' | 'list' | 'code'): void {
      flushNonTableContent();
      const marginTop = prevKind === 'none' ? 0 : kind === 'block' || prevKind === 'block' || hadBlankGap ? 1 : 0;
      pushBlock(node, marginTop, kind);
    }

    // densable Or: `U = !F && !u && Pr(M)` — disable Ink list layout in screen-reader or promptMode.
    const useInkLists = !isScreenReader && !promptMode && shouldUseInkListLayout(tokens);
    const lastNonSpaceIndex = tokens.findLastIndex(t => t.type !== 'space');

    for (const [index, token] of tokens.entries()) {
      if (token.type === 'table') {
        pushStructuredBlock(<MarkdownTable token={token as Tokens.Table} highlight={highlight} />, 'block');
      } else if (token.type === 'list' && useInkLists) {
        pushStructuredBlock(
          <MarkdownList
            token={token as Tokens.List}
            highlight={highlight}
            dimColor={dimColor}
            italic={italic}
            tailWrap={index === lastNonSpaceIndex ? tailWrap : undefined}
            maxProseWidth={maxProseWidth}
          />,
          'list',
        );
      } else if (token.type === 'blockquote') {
        pushStructuredBlock(
          <MarkdownBlockquote
            token={token as Tokens.Blockquote}
            theme={theme}
            highlight={highlight}
            dimColor={dimColor}
            isScreenReader={isScreenReader}
            maxWidth={maxProseWidth}
          />,
          'block',
        );
      } else if (maxProseWidth !== undefined && token.type === 'code') {
        const rendered = formatToken(token, theme, 0, null, null, highlight, promptMode);
        const isLast = index === lastNonSpaceIndex;
        const wrap = isLast ? tailWrap : undefined;
        const hintNode = isLast ? leftoverHintNode() : null;
        const ansi = renderAnsiLeaf(rendered.replace(/\n$/, ''), wrap);
        pushStructuredBlock(
          color || hintNode ? (
            <Text color={color} wrap={wrap}>
              {ansi}
              {hintNode}
            </Text>
          ) : (
            ansi
          ),
          'code',
        );
      } else {
        nonTableContent += formatToken(token, theme, 0, null, null, highlight, promptMode);
      }
    }

    flushNonTableContent(tailWrap, true);
    // densable w0l: promptMode empty-render fallback → raw source
    if (promptMode && elements.length === 0 && source.trim()) {
      nonTableContent = source;
      flushNonTableContent(tailWrap, true);
    }
    if (leftoverHint && !leftoverHintConsumed) {
      pushBlock(<Text color="subtle">{leftoverHint}</Text>, 0, 'prose');
    }
    return elements;
  }, [
    children,
    color,
    dimColor,
    italic,
    monochrome,
    highlight,
    theme,
    isScreenReader,
    skipTokenCache,
    tailWrap,
    promptMode,
    shouldStrip,
    maxProseWidth,
    hint,
  ]);

  // gold oa: e(s,{flexDirection:"column",children:P}) — no gap.
  return <Box flexDirection="column">{elements}</Box>;
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
        <Markdown skipTokenCache capProseWidth>
          {markdownSource}
        </Markdown>
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
    <Markdown skipTokenCache tailWrap={tailWrap} capProseWidth>
      {unstableForRender}
    </Markdown>
  ) : null;

  // gold Ehr: r(s,{flexDirection:"column",gap:1,children:[y&&e(oa,...),R]})
  if (state.chunks.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        {hasStable && (
          <Markdown skipTokenCache capProseWidth>
            {stablePrefix}
          </Markdown>
        )}
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
          <Markdown skipTokenCache capProseWidth>
            {stablePrefix}
          </Markdown>
        </Box>
      )}
      {unstableEl && <Box marginTop={hasStable ? 1 : gap}>{unstableEl}</Box>}
    </Box>
  );
}
