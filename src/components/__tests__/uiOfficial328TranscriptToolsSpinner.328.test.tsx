import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import chalk from 'chalk';
import { marked, type Token } from 'marked';
import React from 'react';
import { color, instances, ThemeProvider, wrappedRender as render } from '@anthropic/ink';
import { cellAt, type Screen, type StylePool } from '../../../packages/@ant/ink/src/core/screen.js';
import BashToolResultMessage, {
  resetFirstExplainedDiff,
} from '../../../packages/builtin-tools/src/tools/BashTool/BashToolResultMessage.js';
import { renderToolUseErrorMessage as renderFileEditError } from '../../../packages/builtin-tools/src/tools/FileEditTool/UI.js';
import { renderToolUseErrorMessage as renderFileReadError } from '../../../packages/builtin-tools/src/tools/FileReadTool/UI.js';
import {
  renderToolResultMessage as renderFileWriteResult,
  renderToolUseErrorMessage as renderFileWriteError,
} from '../../../packages/builtin-tools/src/tools/FileWriteTool/UI.js';
import { renderToolResultMessage as renderMcpResult } from '../../../packages/builtin-tools/src/tools/MCPTool/UI.js';
import {
  renderToolResultMessage as renderWebSearchResult,
  renderToolUseProgressMessage as renderWebSearchProgress,
} from '../../../packages/builtin-tools/src/tools/WebSearchTool/UI.js';
import { TEARDROP_ASTERISK } from '../../constants/figures.js';
import { SPINNER_VERBS } from '../../constants/spinnerVerbs.js';
import { API_ERROR_MESSAGE_PREFIX } from '../../services/api/errors.js';
import { AppStateProvider } from '../../state/AppState.js';
import { getDefaultAppState } from '../../state/AppStateStore.js';
import type { CliHighlight } from '../../utils/cliHighlight.js';
import { formatResetTime } from '../../utils/format.js';
import { HYPERLINK_STYLE_RESET, OSC8_END, OSC8_START } from '../../utils/hyperlink.js';
import { formatToken } from '../../utils/markdown.js';
import { getTheme } from '../../utils/theme.js';
import { SubAgentProvider } from '../CtrlOToExpand.js';
import { FallbackToolUseErrorMessage } from '../FallbackToolUseErrorMessage.js';
import { InVirtualListContext, MessageActionsSelectedContext } from '../messageActions.js';
import { formatClientApiErrorLine } from '../messages/AssistantTextMessage.js';
import { AssistantThinkingMessage } from '../messages/AssistantThinkingMessage.js';
import { applyPromptMarkLinks, HighlightedThinkingText } from '../messages/HighlightedThinkingText.js';
import { UserPromptMessage } from '../messages/UserPromptMessage.js';
import {
  BTW_SPINNER_TIP,
  EXPLANATORY_TIP_FULL,
  registerSlashCommandLinkHandler,
  SlashCommandLink,
} from '../Spinner.js';
import {
  DEFAULT_LOW_PRIORITY_WAIT_BANNER,
  leftoverLowPriorityWaitBanner,
  leftoverZxt,
  leftoverZxtResetsAtSuffix,
} from '../Spinner/leftoverZxt.js';
import { resolveThinkingShimmerColor, SpinnerAnimationRow } from '../Spinner/SpinnerAnimationRow.js';
import { interpolateThemeColor } from '../Spinner/SpinnerGlyph.js';

const ROOT = join(import.meta.dir, '../../..');

function createTestStreams(columns = 100, rows = 24) {
  const stdout = Object.assign(new PassThrough(), {
    columns,
    rows,
    isTTY: true,
  }) as unknown as NodeJS.WriteStream;
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return stdin;
    },
    ref() {
      return stdin;
    },
    unref() {
      return stdin;
    },
  }) as unknown as NodeJS.ReadStream;
  return { stdout, stdin };
}

function readScreenLines(sc: Screen): string[] {
  const lines: string[] = [];
  for (let y = 0; y < sc.height; y++) {
    let row = '';
    for (let x = 0; x < sc.width; x++) {
      row += cellAt(sc, x, y)?.char ?? ' ';
    }
    lines.push(row.trimEnd());
  }
  return lines;
}

function getInkState(stdout: NodeJS.WriteStream): { screen: Screen; stylePool: StylePool } {
  const ink = instances.get(stdout) as unknown as { frontFrame: { screen: Screen }; stylePool: StylePool };
  return { screen: ink.frontFrame.screen, stylePool: ink.stylePool };
}

function getCellAnsiStyles(stdout: NodeJS.WriteStream, x: number, y: number): string {
  const { screen, stylePool } = getInkState(stdout);
  const cell = cellAt(screen, x, y);
  if (!cell) return '';
  return stylePool
    .get(cell.styleId)
    .map(t => t.code)
    .join('');
}

async function renderToText(
  node: React.ReactNode,
  opts?: {
    columns?: number;
    rows?: number;
    theme?: 'dark' | 'dark-ansi';
    appState?: ReturnType<typeof getDefaultAppState>;
  },
): Promise<{ text: string; lines: string[]; stdout: NodeJS.WriteStream; unmount: () => void }> {
  const { stdout, stdin } = createTestStreams(opts?.columns ?? 100, opts?.rows ?? 24);
  const wrapped = (
    <ThemeProvider initialState={opts?.theme ?? 'dark'}>
      <AppStateProvider initialState={opts?.appState ?? getDefaultAppState()}>{node}</AppStateProvider>
    </ThemeProvider>
  );
  const inst = await render(wrapped, { stdout, stdin, patchConsole: false, exitOnCtrlC: false });
  const lines = readScreenLines(getInkState(stdout).screen);
  return {
    text: lines.join('\n'),
    lines,
    stdout,
    unmount: () => inst.unmount(),
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  registerSlashCommandLinkHandler(null);
  resetFirstExplainedDiff();
});

describe('Official 2.1.328 UI alignment — Worker U3 (Transcript, Markdown, Spinner & Tool UIs)', () => {
  describe('1. Markdown fenced code blocks, images & links', () => {
    test('extracts leading language token, prepends dim header for info/unsupported langs, and colors unlabeled fences', () => {
      const seenLanguages: string[] = [];
      const fakeHighlight: CliHighlight = {
        supportsLanguage: lang => lang === 'ts',
        highlight: (code, options) => {
          seenLanguages.push(options?.language ?? '');
          return `<HL:${options?.language}>${code}</HL>`;
        },
      };

      // Info string `ts title="a.ts"` highlights as `ts` AND prepends dim header
      const infoTokens = marked.lexer('```ts title="a.ts"\nconst x = 1\n```');
      const infoRendered = formatToken(infoTokens[0]!, 'dark', 0, null, null, fakeHighlight);
      expect(seenLanguages.at(-1)).toBe('ts');
      expect(infoRendered).toBe(`${chalk.dim('ts title="a.ts"')}\n<HL:ts>const x = 1</HL>\n`);

      // Pure supported language `ts` has NO dim header
      const pureTokens = marked.lexer('```ts\nconst y = 2\n```');
      const pureRendered = formatToken(pureTokens[0]!, 'dark', 0, null, null, fakeHighlight);
      expect(pureRendered).toBe('<HL:ts>const y = 2</HL>\n');

      // Unsupported language `foo` prepends dim header and falls back to plaintext
      const unsupportedTokens = marked.lexer('```foo\nhello\n```');
      const unsupportedRendered = formatToken(unsupportedTokens[0]!, 'dark', 0, null, null, fakeHighlight);
      expect(seenLanguages.at(-1)).toBe('plaintext');
      expect(unsupportedRendered).toBe(`${chalk.dim('foo')}\n<HL:plaintext>hello</HL>\n`);

      // Unlabeled fenced code block colors non-whitespace spans in theme permission color
      const unlabeledTokens = marked.lexer('```\n  alpha beta  \n\n  gamma\n```');
      const unlabeledRendered = formatToken(unlabeledTokens[0]!, 'dark', 0, null, null, fakeHighlight);
      const perm = color('permission', 'dark');
      expect(unlabeledRendered).toBe(`  ${perm('alpha beta')}  \n\n  ${perm('gamma')}\n`);

      // Indented code block does NOT get permission coloring
      const indentedTok: Token = {
        type: 'code',
        raw: '    plain code',
        text: 'plain code',
        codeBlockStyle: 'indented',
      };
      const indentedRendered = formatToken(indentedTok, 'dark', 0, null, null, null);
      expect(indentedRendered).toBe('plain code\n');
    });

    test('renders image tokens as alt (url "title") matching chunk@302008315.js:18000', () => {
      const renderImage = (md: string) => {
        const para = marked.lexer(md)[0] as { tokens?: Token[] };
        return formatToken(para.tokens![0]!, 'dark', 0, null, null, null, { linkCap: false });
      };
      expect(renderImage('![](https://example.com/a.png)')).toBe('https://example.com/a.png');
      expect(renderImage('![Logo](https://example.com/a.png)')).toBe('Logo (https://example.com/a.png)');
      expect(renderImage('![Logo](https://example.com/a.png "Banner")')).toBe(
        'Logo (https://example.com/a.png "Banner")',
      );
      expect(renderImage('![](https://example.com/a.png "Banner")')).toBe('(https://example.com/a.png "Banner")');
    });

    test('preserves link titles and formats mailto: as text (email) when text differs', () => {
      const renderLink = (md: string, linkCap: boolean) => {
        const para = marked.lexer(md)[0] as { tokens?: Token[] };
        return formatToken(para.tokens![0]!, 'dark', 0, null, null, null, { linkCap });
      };

      expect(renderLink('[Email Alice](mailto:alice@example.com)', false)).toBe('Email Alice (alice@example.com)');
      expect(renderLink('[Email Alice](mailto:alice@example.com "Say hi")', false)).toBe(
        'Email Alice (alice@example.com) ("Say hi")',
      );
      expect(renderLink('[alice@example.com](MAILTO:alice@example.com)', false)).toBe('alice@example.com');

      const titledNoOsc = renderLink('[Docs](https://example.com "Read docs")', false);
      expect(titledNoOsc).toContain('Docs');
      expect(titledNoOsc).toContain('(https://example.com) ("Read docs")');

      const titledOsc = renderLink('[Docs](https://example.com "Read docs")', true);
      expect(titledOsc).toContain(`${OSC8_START}https://example.com${OSC8_END}`);
      expect(titledOsc).toContain(`${HYPERLINK_STYLE_RESET} (https://example.com) ("Read docs")`);
    });
  });

  describe('2. Remove TeammateSpinnerTree & foregrounded-teammate interrupt row', () => {
    test('Spinner.tsx does not render TeammateSpinnerTree and SpinnerAnimationRow drops esc-to-interrupt row', async () => {
      const spinnerSrc = readFileSync(join(ROOT, 'src/components/Spinner.tsx'), 'utf8');
      expect(spinnerSrc).not.toContain('<TeammateSpinnerTree');

      const rowSrc = readFileSync(join(ROOT, 'src/components/Spinner/SpinnerAnimationRow.tsx'), 'utf8');
      expect(rowSrc).not.toContain('(esc to interrupt ');

      const nowRef = { current: performance.now() - 20_000 };
      const zeroRef = { current: 0 };
      const nullRef = { current: null as number | null };
      const respRef = { current: 400 };
      const rendered = await renderToText(
        <SpinnerAnimationRow
          mode="responding"
          reducedMotion={true}
          hasActiveTools={false}
          responseLengthRef={respRef}
          message="Working…"
          messageColor="claude"
          shimmerColor="claudeShimmer"
          loadingStartTimeRef={nowRef}
          totalPausedMsRef={zeroRef}
          pauseStartTimeRef={nullRef}
          verbose={true}
          columns={90}
          hasRunningTeammates={true}
          teammateTokens={0}
          foregroundedTeammate={
            {
              id: 'tm-1',
              type: 'in_process_teammate',
              status: 'running',
              isIdle: false,
              identity: { agentName: 'researcher', color: 'cyan' },
              progress: { tokenCount: 250 },
            } as never
          }
          thinkingStatus={null}
          effortSuffix=""
        />,
      );
      cleanups.push(rendered.unmount);
      expect(rendered.text).not.toContain('esc to interrupt researcher');
      expect(rendered.text).toContain('Working…');
    });
  });

  describe('3. UserPromptMessage coordinator origin header & followsSpeakerLabel highlight', () => {
    test('renders From main / From another agent / plugin headers and preserves MessageActionsSelectedContext', async () => {
      const baseState = getDefaultAppState();
      const stateMainParent = {
        ...baseState,
        viewingAgentTaskId: 'agent-1',
        tasks: {
          'agent-1': {
            id: 'agent-1',
            type: 'local_agent',
            status: 'running',
            description: 'sub',
            startTime: Date.now(),
            pendingMessages: [],
            messages: [],
          },
        },
      } as unknown as ReturnType<typeof getDefaultAppState>;

      const fromMain = await renderToText(
        <UserPromptMessage
          addMargin={false}
          param={{ type: 'text', text: 'Investigate test failure' }}
          origin={{ kind: 'coordinator' }}
        />,
        { appState: stateMainParent },
      );
      cleanups.push(fromMain.unmount);
      expect(fromMain.text).toContain('From main');
      expect(fromMain.text).toContain('Investigate test failure');

      const stateNestedParent = {
        ...baseState,
        viewingAgentTaskId: 'agent-2',
        tasks: {
          'agent-2': {
            id: 'agent-2',
            type: 'local_agent',
            status: 'running',
            description: 'nested',
            parentAgentId: 'agent-1',
            startTime: Date.now(),
            pendingMessages: [],
            messages: [],
          },
        },
      } as unknown as ReturnType<typeof getDefaultAppState>;

      const fromOther = await renderToText(
        <UserPromptMessage
          addMargin={false}
          param={{ type: 'text', text: 'Nested prompt' }}
          origin={{ kind: 'coordinator' }}
        />,
        { appState: stateNestedParent },
      );
      cleanups.push(fromOther.unmount);
      expect(fromOther.text).toContain('From another agent');

      // followsSpeakerLabel wraps with flexGrow=1 + userMessageBackground & respects selection context
      const follows = await renderToText(
        <MessageActionsSelectedContext.Provider value={true}>
          <UserPromptMessage
            addMargin={false}
            param={{ type: 'text', text: 'Speaker body' }}
            followsSpeakerLabel={true}
          />
        </MessageActionsSelectedContext.Provider>,
        { appState: baseState },
      );
      cleanups.push(follows.unmount);
      expect(follows.text).toContain('Speaker body');
      const upmSrc = readFileSync(join(ROOT, 'src/components/messages/UserPromptMessage.tsx'), 'utf8');
      expect(upmSrc).toContain('flexGrow={1}');
      expect(upmSrc).toContain("isSelected ? 'messageActionsBackground' : 'userMessageBackground'");
      expect(upmSrc).toContain('markLinks={markLinks}');

      // markLinks helper wraps [Image #1] in OSC 8 hyperlink
      const linked = applyPromptMarkLinks(
        'Check [Image #1] please',
        new Map([['[Image #1]', 'file:///tmp/pic.png']]),
        true,
      );
      expect(linked).toBe(`Check ${OSC8_START}file:///tmp/pic.png${OSC8_END}[Image #1]${OSC8_START}${OSC8_END} please`);
    });
  });

  describe('4. Spinner retry banner & low_priority_waiting', () => {
    test('uses ✻ glyph, lowercase retrying in, wall-clock resetsAt, and low_priority_waiting banner', async () => {
      const now = 1_750_000_000_000;
      const resetsAt = Math.floor(now / 1000) + 1800;
      expect(leftoverLowPriorityWaitBanner()).toBe(DEFAULT_LOW_PRIORITY_WAIT_BANNER);
      expect(leftoverZxtResetsAtSuffix(resetsAt, now)).toBe(` (${formatResetTime(resetsAt)})`);

      const retryRes = await renderToText(
        <>
          {leftoverZxt({
            status: {
              kind: 'retrying',
              deadline: now + 5000,
              attempt: 2,
              maxRetries: 5,
              error: { formatted: 'Rate limited', rateLimits: { resetsAt, rateLimitType: 'five_hour' } },
            },
            columns: 100,
            now,
          })}
        </>,
      );
      cleanups.push(retryRes.unmount);
      expect(retryRes.text).toContain(TEARDROP_ASTERISK);
      expect(retryRes.text).toContain('retrying in 5s');
      expect(retryRes.text).toContain(`(${formatResetTime(resetsAt)})`);
      expect(retryRes.text).not.toContain('Retrying in');

      const lowPrioRes = await renderToText(
        <>
          {leftoverZxt({
            status: { kind: 'low_priority_waiting', deadline: now + 12_000, attempt: 3 },
            columns: 120,
            now,
          })}
        </>,
        { columns: 120 },
      );
      cleanups.push(lowPrioRes.unmount);
      expect(lowPrioRes.text).toContain(TEARDROP_ASTERISK);
      expect(lowPrioRes.text).toContain('Working at lower priority · waiting for capacity');
      expect(lowPrioRes.text).toContain('next try in 12s · attempt 3 · esc to interrupt');
    });
  });

  describe('5. Spinner theme-derived colors', () => {
    test('derives stalled and thinking shimmer colors from theme tokens with ANSI fallback', () => {
      const darkTheme = getTheme('dark');
      const lightTheme = getTheme('light');
      const ansiTheme = getTheme('dark-ansi');

      // Full stall intensity equals theme.error RGB (distinct between dark and light themes!)
      expect(String(interpolateThemeColor(darkTheme, 'claude', 'error', 1))).toBe(darkTheme.error);
      expect(String(interpolateThemeColor(lightTheme, 'claude', 'error', 1))).toBe(lightTheme.error);
      expect(darkTheme.error).not.toBe(lightTheme.error);

      // ANSI theme falls back safely to theme key
      expect(interpolateThemeColor(ansiTheme, 'claude', 'error', 0.8)).toBe('error');
      expect(interpolateThemeColor(ansiTheme, 'claude', 'error', 0.2)).toBe('claude');

      // Thinking shimmer derives from theme.inactive / theme.inactiveShimmer (not hardcoded 153/185)
      expect(String(resolveThinkingShimmerColor(0, 0, darkTheme))).toBe(darkTheme.inactive);
      expect(String(resolveThinkingShimmerColor(0, 0, lightTheme))).toBe(lightTheme.inactive);
      expect(resolveThinkingShimmerColor(0, 0, ansiTheme)).toBeUndefined();
      expect(resolveThinkingShimmerColor(0, 0.8, ansiTheme)).toBe('warning');

      const glyphSrc = readFileSync(join(ROOT, 'src/components/Spinner/SpinnerGlyph.tsx'), 'utf8');
      expect(glyphSrc).not.toContain('ERROR_RED');
      const rowSrc = readFileSync(join(ROOT, 'src/components/Spinner/SpinnerAnimationRow.tsx'), 'utf8');
      expect(rowSrc).not.toContain('THINKING_INACTIVE');
    });
  });

  describe('6. FallbackToolUseErrorMessage truncation hint, array content & <Ansi>', () => {
    test('extracts array blocks, renders <Ansi>, and uses CtrlOToExpand (suppressed in subagent/virtualList)', async () => {
      const manyLines = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n');
      const res = await renderToText(
        <FallbackToolUseErrorMessage
          result={[{ type: 'text', text: `<tool_use_error>\x1b[32m${manyLines}\x1b[39m</tool_use_error>` }]}
          verbose={false}
        />,
      );
      cleanups.push(res.unmount);
      expect(res.text).toContain('Error: line 1');
      expect(res.text).not.toContain('Tool execution failed');
      expect(res.text).not.toContain('\x1b[32m');
      expect(res.text).toContain('… +4 lines');
      expect(res.text).toContain('(ctrl+o to expand)');

      const subRes = await renderToText(
        <SubAgentProvider>
          <FallbackToolUseErrorMessage result={manyLines} verbose={false} />
        </SubAgentProvider>,
      );
      cleanups.push(subRes.unmount);
      expect(subRes.text).toContain('… +4 lines');
      expect(subRes.text).not.toContain('ctrl+o to expand');

      const virtRes = await renderToText(
        <InVirtualListContext.Provider value={true}>
          <FallbackToolUseErrorMessage result={manyLines} verbose={false} />
        </InVirtualListContext.Provider>,
      );
      cleanups.push(virtRes.unmount);
      expect(virtRes.text).toContain('… +4 lines');
      expect(virtRes.text).not.toContain('ctrl+o to expand');
    });
  });

  describe('7. File tool UIs (FileReadTool, FileWriteTool, FileEditTool)', () => {
    test('uses "Couldn\'t read/write/edit file", respects toolDenialKind permission-rule, and fixes FileWrite UI', async () => {
      const toolErr = '<tool_use_error>Permission denied by policy rule X</tool_use_error>';

      const readErr = await renderToText(renderFileReadError(toolErr, { verbose: false }));
      cleanups.push(readErr.unmount);
      expect(readErr.text).toContain("Couldn't read file");

      const readDenied = await renderToText(
        renderFileReadError(toolErr, { verbose: false, toolDenialKind: 'permission-rule' }),
      );
      cleanups.push(readDenied.unmount);
      expect(readDenied.text).toContain('Permission denied by policy rule X');
      expect(readDenied.text).not.toContain("Couldn't read file");

      const writeErr = await renderToText(renderFileWriteError(toolErr, { verbose: false }));
      cleanups.push(writeErr.unmount);
      expect(writeErr.text).toContain("Couldn't write file");

      const writeDenied = await renderToText(
        renderFileWriteError(toolErr, { verbose: false, toolDenialKind: 'permission-rule' }),
      );
      cleanups.push(writeDenied.unmount);
      expect(writeDenied.text).toContain('Permission denied by policy rule X');

      const editErr = await renderToText(
        renderFileEditError(toolErr, { progressMessagesForMessage: [], tools: [], verbose: false }),
      );
      cleanups.push(editErr.unmount);
      expect(editErr.text).toContain("Couldn't edit file");

      const editDenied = await renderToText(
        renderFileEditError(toolErr, {
          progressMessagesForMessage: [],
          tools: [],
          verbose: false,
          toolDenialKind: 'permission-rule',
        }),
      );
      cleanups.push(editDenied.unmount);
      expect(editDenied.text).toContain('Permission denied by policy rule X');

      // Undiffed large overwrite copy + FilePathLink + suppress +0 lines
      const writeReplaced = await renderToText(
        renderFileWriteResult(
          {
            type: 'update',
            filePath: '/tmp/example.ts',
            content: 'const a = 1;\n',
            structuredPatch: [],
            originalFile: null,
          },
          [],
          { verbose: false },
        ),
      );
      cleanups.push(writeReplaced.unmount);
      expect(writeReplaced.text).toContain('(previous content replaced, no diff shown)');
      expect(writeReplaced.text).not.toContain('— previous content replaced');
      expect(writeReplaced.text).not.toContain('+0 lines');

      const writeUiSrc = readFileSync(join(ROOT, 'packages/builtin-tools/src/tools/FileWriteTool/UI.tsx'), 'utf8');
      expect(writeUiSrc).toContain('<FilePathLink filePath={filePath}>');
      expect(writeUiSrc).toContain('{!verbose && hiddenLines > 0 && (');
    });
  });

  describe('8. BashToolResultMessage image notice, diff stats colors & omitted-file links', () => {
    test('updates image notices, uses LineDiffStats colors, FilePathLink for omitted files & +N lines expand hint', async () => {
      const imgRes = await renderToText(
        <BashToolResultMessage
          content={{
            stdout: '',
            stderr: '',
            isImage: true,
            viewedImagePaths: ['/tmp/shot.png'],
          }}
          verbose={false}
        />,
      );
      cleanups.push(imgRes.unmount);
      expect(imgRes.text).toContain('[Image sent to Claude]');
      expect(imgRes.text).toContain('[Image sent to Claude: /tmp/shot.png]');
      expect(imgRes.text).not.toContain('Image data detected');

      // Non-isImage with viewedImagePaths does not print (No output)
      const viewedOnly = await renderToText(
        <BashToolResultMessage
          content={{
            stdout: '',
            stderr: '',
            viewedImagePaths: ['/tmp/chart.png'],
          }}
          verbose={false}
        />,
      );
      cleanups.push(viewedOnly.unmount);
      expect(viewedOnly.text).toContain('[Image sent to Claude: /tmp/chart.png]');
      expect(viewedOnly.text).not.toContain('(No output)');

      // Diff stats without parentheses, truncated hunk hint, and omitted files
      const bigLines = Array.from({ length: 45 }, (_, i) => `+line ${i + 1}`);
      const diffRes = await renderToText(
        <BashToolResultMessage
          content={{
            stdout: '',
            stderr: '',
            bashEditDiff: {
              files: [
                {
                  filePath: '/tmp/foo.ts',
                  created: false,
                  deleted: false,
                  hunks: [
                    {
                      oldStart: 1,
                      oldLines: 1,
                      newStart: 1,
                      newLines: 45,
                      lines: ['-old', ...bigLines],
                    },
                  ],
                },
              ],
              moreFiles: 5,
              changedFiles: ['/tmp/foo.ts', '/tmp/a.ts', '/tmp/b.ts', '/tmp/c.ts', '/tmp/d.ts', '/tmp/e.ts'],
              skipped: false,
              unavailable: false,
              shared: false,
            },
          }}
          verbose={false}
        />,
        { rows: 60 },
      );
      cleanups.push(diffRes.unmount);
      expect(diffRes.text).toContain('Updated /tmp/foo.ts +45 -1');
      expect(diffRes.text).not.toContain('(+45 -1)');
      expect(diffRes.text).toContain('… +6 lines (ctrl+o to expand)');
      expect(diffRes.text).toContain('… +5 files changed');
      expect(diffRes.text).toContain('/tmp/a.ts');
      expect(diffRes.text).toContain('+2 more');

      const bashUiSrc = readFileSync(
        join(ROOT, 'packages/builtin-tools/src/tools/BashTool/BashToolResultMessage.tsx'),
        'utf8',
      );
      expect(bashUiSrc).toContain('color="diffAddedWord"');
      expect(bashUiSrc).toContain('color="diffRemovedWord"');
      expect(bashUiSrc).toContain('<FilePathLink key={filePath} filePath={filePath}>');
    });
  });

  describe('9. WebSearchTool/UI.tsx result formatting & retry progress', () => {
    test('formats zero/singular/plural counts, omits <1s duration, uses formatDuration >=1s, and RetryBanner', async () => {
      const zeroRes = await renderToText(renderWebSearchResult({ query: 'foo', results: [], durationSeconds: 0.4 }));
      cleanups.push(zeroRes.unmount);
      expect(zeroRes.text.trim()).toContain('Did no searches');
      expect(zeroRes.text).not.toContain(' in ');

      const oneFast = await renderToText(
        renderWebSearchResult({
          query: 'foo',
          results: [{ tool_use_id: '1', content: [] }],
          durationSeconds: 0.5,
        }),
      );
      cleanups.push(oneFast.unmount);
      expect(oneFast.text).toContain('Did 1 search');
      expect(oneFast.text).not.toContain(' in ');

      const twoSlow = await renderToText(
        renderWebSearchResult({
          query: 'foo',
          results: [
            { tool_use_id: '1', content: [] },
            { tool_use_id: '2', content: [] },
          ],
          durationSeconds: 60,
        }),
      );
      cleanups.push(twoSlow.unmount);
      expect(twoSlow.text).toContain('Did 2 searches in 1m');

      const singularProgress = await renderToText(
        renderWebSearchProgress([
          {
            data: { type: 'search_results_received', resultCount: 1, query: 'bun' },
          } as never,
        ]),
      );
      cleanups.push(singularProgress.unmount);
      expect(singularProgress.text).toContain('Found 1 result for "bun"');

      const pluralProgress = await renderToText(
        renderWebSearchProgress([
          {
            data: { type: 'search_results_received', resultCount: 3, query: 'bun' },
          } as never,
        ]),
      );
      cleanups.push(pluralProgress.unmount);
      expect(pluralProgress.text).toContain('Found 3 results for "bun"');

      const retryProgress = await renderToText(
        renderWebSearchProgress(
          [
            {
              data: {
                type: 'search_retry',
                query: 'bun',
                status: {
                  kind: 'retrying',
                  deadline: Date.now() + 8000,
                  attempt: 1,
                  maxRetries: 3,
                  error: { formatted: 'Overloaded' },
                },
              },
            } as never,
          ],
          { terminalSize: { columns: 90 } },
        ),
      );
      cleanups.push(retryProgress.unmount);
      expect(retryProgress.text).toContain(TEARDROP_ASTERISK);
      expect(retryProgress.text).toContain('retrying in');
      expect(retryProgress.text).toContain('attempt 1/3');
    });
  });

  describe('10. Transcript, Spinner & MCP polish', () => {
    test('HighlightedThinkingText uses inactive instead of subtle in brief/bodyOnly mode', () => {
      const src = readFileSync(join(ROOT, 'src/components/messages/HighlightedThinkingText.tsx'), 'utf8');
      expect(src).toContain("isDimmed ? 'inactive' : 'text'");
      expect(src).toContain("isDimmed ? 'inactive' : 'briefLabelYou'");
      expect(src).not.toContain("isDimmed ? 'subtle'");
    });

    test('AssistantThinkingMessage renders ∴ glyph without italic styling', async () => {
      const res = await renderToText(
        <AssistantThinkingMessage
          param={{ type: 'thinking', thinking: 'Checking invariants' }}
          addMargin={false}
          isTranscriptMode={false}
          verbose={false}
        />,
      );
      cleanups.push(res.unmount);
      expect(res.text).toContain('∴');
      const glyphAnsi = getCellAnsiStyles(res.stdout, 0, 0);
      expect(glyphAnsi).not.toContain('\x1b[3m');
    });

    test('AssistantTextMessage uses updated bare API Error hint and preserves MessageActionsSelectedContext', () => {
      expect(formatClientApiErrorLine(API_ERROR_MESSAGE_PREFIX)).toBe('API Error: Wait a moment and try again.');
      const src = readFileSync(join(ROOT, 'src/components/messages/AssistantTextMessage.tsx'), 'utf8');
      expect(src).toContain('MessageActionsSelectedContext');
    });

    test('Spinner tips use updated /btw copy, <Ansi>, clickable <SlashCommandLink>, and preserve fork provider hints', async () => {
      expect(BTW_SPINNER_TIP).toBe('Use /btw to ask a side question without interrupting Claude');
      expect(EXPLANATORY_TIP_FULL).toBe('Want Claude to teach as it works? · /config outputStyle=explanatory');

      const linkRes = await renderToText(
        <SlashCommandLink command="config" args="outputStyle=explanatory" color="suggestion" />,
      );
      cleanups.push(linkRes.unmount);
      expect(linkRes.text).toContain('/config outputStyle=explanatory');

      const spinnerSrc = readFileSync(join(ROOT, 'src/components/Spinner.tsx'), 'utf8');
      expect(spinnerSrc).toContain('<Ansi>{tipLineText}</Ansi>');
      expect(spinnerSrc).toContain('<SlashCommandLink');
      expect(spinnerSrc).toContain("openai: 'OpenAI'");
      expect(spinnerSrc).toContain("gemini: 'Google Gemini'");
      expect(spinnerSrc).toContain("grok: 'xAI Grok'");
    });

    test('spinnerVerbs.ts matches official 2.1.328 187-verb list', () => {
      expect(SPINNER_VERBS).toHaveLength(187);
      for (const added of ['Kerfuffling', 'Onioning', 'Philosophizing', 'Polishing', 'Transmogrifying', 'Unraveling']) {
        expect(SPINNER_VERBS).toContain(added);
      }
      for (const removed of ['Canoodling', 'Channelling', 'Evaporating', 'Musing', 'Philosophising', 'Unravelling']) {
        expect(SPINNER_VERBS).not.toContain(removed);
      }
    });

    test('MCPTool/UI.tsx uses middle-dot large response warning copy', async () => {
      const largePayload = 'x'.repeat(60_000);
      const res = await renderToText(renderMcpResult(largePayload, [], { verbose: false }));
      cleanups.push(res.unmount);
      expect(res.text).toContain('Large MCP response (~');
      expect(res.text).toContain('tokens) · can fill context quickly');
      expect(res.text).not.toContain('this can fill up context quickly');
    });
  });
});
