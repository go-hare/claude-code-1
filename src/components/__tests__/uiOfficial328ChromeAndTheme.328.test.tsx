import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import chalk from 'chalk';
import figures from 'figures';
import React, { useContext, useLayoutEffect } from 'react';
import {
  Box,
  Dialog,
  getTheme as getInkTheme,
  instances,
  isValidThemeColor as isValidInkThemeColor,
  MODAL_LAYOUT_PADDING_X,
  ModalContext,
  PANE_PADDING_X_INLINE,
  PANE_PADDING_X_MODAL,
  Pane,
  ScrollViewport,
  THEME_NAMES,
  Text,
  ThemeProvider,
  wrappedRender as render,
} from '@anthropic/ink';
import { cellAt, type Screen, type StylePool } from '../../../packages/@ant/ink/src/core/screen.js';
import { AppStateProvider } from '../../state/AppState.js';
import { resetFullscreenGateCache } from '../../utils/fullscreen.js';
import { getTheme as getAppTheme, isValidThemeColor as isValidAppThemeColor } from '../../utils/theme.js';
import { FullscreenLayout, ScrollChromeContext } from '../FullscreenLayout.js';
import {
  compactRcPillLabel,
  computeProTrialState,
  formatProTrialBadgeLabel,
  getTuiJustSwitchedMode,
} from '../LogoV2/CondensedLogo.js';
import { ModalScroller } from '../ModalScroller.js';
import { ThemePicker } from '../ThemePicker.js';

const ROOT = join(import.meta.dir, '../../..');

function createTestStreams(columns = 60, rows = 14) {
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
    lines.push(row);
  }
  return lines;
}

function getInkState(stdout: NodeJS.WriteStream): { screen: Screen; stylePool: StylePool } {
  const ink = instances.get(stdout) as unknown as { frontFrame: { screen: Screen }; stylePool: StylePool };
  return { screen: ink.frontFrame.screen, stylePool: ink.stylePool };
}

function getInkScreen(stdout: NodeJS.WriteStream): Screen {
  return getInkState(stdout).screen;
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

describe('Official 2.1.328 UI alignment — Core Chrome, Theme, Pane, Dialog, FullscreenLayout, ModalScroller, LogoV2 & ThemePicker', () => {
  const prevNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER;
  const prevJustSwitched = process.env.CLAUDE_CODE_TUI_JUST_SWITCHED;
  const prevChalkLevel = chalk.level;

  afterEach(() => {
    if (prevNoFlicker === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER;
    else process.env.CLAUDE_CODE_NO_FLICKER = prevNoFlicker;
    if (prevJustSwitched === undefined) delete process.env.CLAUDE_CODE_TUI_JUST_SWITCHED;
    else process.env.CLAUDE_CODE_TUI_JUST_SWITCHED = prevJustSwitched;
    chalk.level = prevChalkLevel;
    resetFullscreenGateCache();
  });

  test('Item 1: StickyPromptHeader uses color="text" (not "subtle") and passes leftMargin', async () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    resetFullscreenGateCache();
    chalk.level = 3;

    function StickyTrigger(): React.ReactNode {
      const chrome = useContext(ScrollChromeContext);
      useLayoutEffect(() => {
        chrome?.setStickyPrompt({ text: 'Fix login contrast', scrollTo: () => {} });
      }, [chrome]);
      return <Text>scroll body</Text>;
    }

    const { stdout, stdin } = createTestStreams(50, 12);
    const instance = await render(
      <ThemeProvider initialState="dark">
        <AppStateProvider>
          <FullscreenLayout scrollable={<StickyTrigger />} bottom={<Text>prompt</Text>} />
        </AppStateProvider>
      </ThemeProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 60));
      const screen = getInkScreen(stdout);
      const lines = readScreenLines(screen);
      const stickyRowIdx = lines.findIndex(line => line.includes('Fix login contrast'));
      expect(stickyRowIdx).toBe(0);

      const textCol = lines[stickyRowIdx]!.indexOf('Fix');
      expect(textCol).toBeGreaterThanOrEqual(0);
      const codes = getCellAnsiStyles(stdout, textCol, stickyRowIdx);
      // Dark theme: text = rgb(255,255,255) -> 38;2;255;255;255, NOT subtle rgb(80,80,80)
      expect(codes).toContain('38;2;255;255;255');
      expect(codes).not.toContain('38;2;80;80;80');
      // Background is userMessageBackground = rgb(55,55,55) -> 48;2;55;55;55
      expect(codes).toContain('48;2;55;55;55');
    } finally {
      instance.unmount();
    }

    const flSrc = readFileSync(join(ROOT, 'src/components/FullscreenLayout.tsx'), 'utf8');
    expect(flSrc).toContain('leftMargin={stickyLeftMargin}');
    expect(flSrc).toContain('<Text color="text" wrap="truncate-end">');
  });

  test('Item 2: all 72 official tokens + fork messageActionsBackground match 1:1 between ink theme-types.ts and src/utils/theme.ts across all 6 palettes', () => {
    for (const themeName of THEME_NAMES) {
      const inkTheme = getInkTheme(themeName);
      const appTheme = getAppTheme(themeName);
      const inkKeys = Object.keys(inkTheme).sort();
      const appKeys = Object.keys(appTheme).sort();
      expect(inkKeys).toEqual(appKeys);
      expect(inkKeys.length).toBe(73);
      expect(inkTheme).toEqual(appTheme);
      // Fork-only token preserved
      expect(typeof inkTheme.messageActionsBackground).toBe('string');
      expect(inkTheme.messageActionsBackground.length).toBeGreaterThan(0);
    }

    // Explicitly pin the 6 previously stale runtime Ink tokens
    expect(getInkTheme('light').rate_limit_empty).toBe('rgb(213,218,253)');
    expect(getInkTheme('light-ansi').rate_limit_fill).toBe('ansi:blue');
    expect(getInkTheme('light-ansi').rate_limit_empty).toBe('ansi:white');
    expect(getInkTheme('dark-ansi').rate_limit_empty).toBe('ansi:blackBright');
    expect(getInkTheme('dark-ansi').briefLabelYou).toBe('ansi:whiteBright');
    expect(getInkTheme('light-daltonized').rate_limit_empty).toBe('rgb(204,217,255)');
  });

  test('Item 3: Pane uses PANE_PADDING_X_MODAL=0 inside modals and suppresses redundant divider/padding on nested Panes', async () => {
    expect(PANE_PADDING_X_MODAL).toBe(0);
    expect(PANE_PADDING_X_INLINE).toBe(2);
    expect(MODAL_LAYOUT_PADDING_X).toBe(2);

    // 1. Inside modal: paddingX = 0, no divider
    {
      const { stdout, stdin } = createTestStreams(40, 8);
      const instance = await render(
        <ThemeProvider initialState="dark">
          <ModalContext.Provider value={{ rows: 8, columns: 40, scrollViewport: null }}>
            <Pane color="permission">
              <Text>MODAL_PANE_CONTENT</Text>
            </Pane>
          </ModalContext.Provider>
        </ThemeProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 40));
        const lines = readScreenLines(getInkScreen(stdout));
        const row = lines.find(l => l.includes('MODAL_PANE_CONTENT'));
        expect(row).toBeDefined();
        expect(row!.indexOf('MODAL_PANE_CONTENT')).toBe(0);
        expect(lines.some(l => l.includes('────────'))).toBe(false);
      } finally {
        instance.unmount();
      }
    }

    // 2. Inline nested Pane: outer has divider + paddingX=2; nested omits divider and extra paddingX
    {
      const { stdout, stdin } = createTestStreams(40, 10);
      const instance = await render(
        <ThemeProvider initialState="dark">
          <Pane color="permission">
            <Text>OUTER_LINE</Text>
            <Pane color="warning">
              <Text>NESTED_LINE</Text>
            </Pane>
          </Pane>
        </ThemeProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 40));
        const lines = readScreenLines(getInkScreen(stdout));
        const dividerLines = lines.filter(l => l.includes('────────'));
        expect(dividerLines.length).toBe(1);
        const outerRow = lines.find(l => l.includes('OUTER_LINE'));
        const nestedRow = lines.find(l => l.includes('NESTED_LINE'));
        expect(outerRow).toBeDefined();
        expect(nestedRow).toBeDefined();
        expect(outerRow!.indexOf('OUTER_LINE')).toBe(2);
        expect(nestedRow!.indexOf('NESTED_LINE')).toBe(2);
      } finally {
        instance.unmount();
      }
    }
  });

  test('Item 4: Dialog wraps title/subtitle, supports titleSuffix/isSubtitleDimmed/escapeAction/enterAction/keys, and gates inputGuide truncation on truncateInputGuide', async () => {
    chalk.level = 3;
    const longTitle = 'Long dialog heading that wraps across two rows';
    const longSubtitle = 'Detailed explanation text that should wrap instead of truncating';
    const longGuide = 'Arrow keys to navigate · Space to toggle · Enter to save · Esc to close';

    // 1. Wrapping title/subtitle/guide, titleSuffix, isSubtitleDimmed=false, custom actions + keys
    {
      const { stdout, stdin } = createTestStreams(34, 18);
      const instance = await render(
        <ThemeProvider initialState="dark">
          <Dialog
            hideBorder
            title={longTitle}
            titleSuffix={<Text dimColor> (beta)</Text>}
            titleEnd="v2"
            subtitle={longSubtitle}
            isSubtitleDimmed={false}
            enterAction="save"
            escapeAction="close"
            keys={[{ on: 'r', hint: 'refresh', run: () => {} }]}
            onCancel={() => {}}
          >
            <Text>Body</Text>
          </Dialog>
        </ThemeProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 50));
        const screen = getInkScreen(stdout);
        const lines = readScreenLines(screen);
        const joined = lines.map(l => l.trimEnd()).join('\n');

        // Long title + suffix wrapped without losing tail
        expect(joined).toContain('Long dialog');
        expect(joined).toContain('two rows');
        expect(joined).toContain('(beta)');
        expect(joined).toContain('v2');

        // Long subtitle wrapped without truncation and NOT dimmed (SGR 2 absent)
        expect(joined).toContain('Detailed explanation');
        expect(joined).toContain('truncating');
        const subRowIdx = lines.findIndex(l => l.includes('Detailed'));
        expect(subRowIdx).toBeGreaterThan(-1);
        const subCol = lines[subRowIdx]!.indexOf('Detailed');
        expect(getCellAnsiStyles(stdout, subCol, subRowIdx)).not.toContain('\x1b[2m');

        // Footer hints include keys entry + enterAction + escapeAction
        const normalized = lines.map(l => l.trim()).join(' ');
        expect(normalized).toContain('r to refresh');
        expect(normalized).toContain('Enter to save');
        expect(normalized).toContain('Esc to close');
      } finally {
        instance.unmount();
      }
    }

    // 2. truncateInputGuide=false (default) wraps long guide; truncateInputGuide=true truncates to 1 row
    {
      const { stdout: sWrap, stdin: inWrap } = createTestStreams(26, 12);
      const instWrap = await render(
        <ThemeProvider initialState="dark">
          <Dialog hideBorder title="Wrap" onCancel={() => {}} inputGuide={longGuide}>
            <Text>Body</Text>
          </Dialog>
        </ThemeProvider>,
        { stdout: sWrap, stdin: inWrap, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 40));
        const wrappedText = readScreenLines(getInkScreen(sWrap))
          .map(l => l.trim())
          .join(' ');
        expect(wrappedText).toContain('Esc to close');
      } finally {
        instWrap.unmount();
      }

      const { stdout: sTrunc, stdin: inTrunc } = createTestStreams(26, 12);
      const instTrunc = await render(
        <ThemeProvider initialState="dark">
          <Dialog hideBorder title="Trunc" onCancel={() => {}} inputGuide={longGuide} truncateInputGuide>
            <Text>Body</Text>
          </Dialog>
        </ThemeProvider>,
        { stdout: sTrunc, stdin: inTrunc, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 40));
        const truncLines = readScreenLines(getInkScreen(sTrunc));
        const guideLines = truncLines.filter(l => l.includes('Arrow keys') || l.includes('Esc to close'));
        expect(guideLines.length).toBe(1);
        expect(guideLines[0]).not.toContain('Esc to close');
      } finally {
        instTrunc.unmount();
      }
    }
  });

  test('Item 5: FullscreenLayout omits composerSidebarBackground on dock (keeps it on sidebar) and ModalScroller arrows align at right={0}', async () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    resetFullscreenGateCache();
    chalk.level = 3;

    // 1. Sidebar has composerSidebarBackground (rgb(38,38,38)), dock does NOT
    {
      const { stdout, stdin } = createTestStreams(60, 12);
      const instance = await render(
        <ThemeProvider initialState="dark">
          <AppStateProvider>
            <FullscreenLayout
              scrollable={<Text>MAIN</Text>}
              bottom={<Text>PROMPT</Text>}
              sidebar={<Text>SIDEBAR</Text>}
              sidebarWidth={12}
              dock={<Text>DOCK</Text>}
              dockWidth={12}
            />
          </AppStateProvider>
        </ThemeProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 60));
        const screen = getInkScreen(stdout);
        const lines = readScreenLines(screen);
        const sideRow = lines.findIndex(l => l.includes('SIDEBAR'));
        const dockRow = lines.findIndex(l => l.includes('DOCK'));
        expect(sideRow).toBeGreaterThan(-1);
        expect(dockRow).toBeGreaterThan(-1);

        const sideCol = lines[sideRow]!.indexOf('SIDEBAR');
        const dockCol = lines[dockRow]!.indexOf('DOCK');
        expect(getCellAnsiStyles(stdout, sideCol, sideRow)).toContain('48;2;38;38;38');
        expect(getCellAnsiStyles(stdout, dockCol, dockRow)).not.toContain('48;2;38;38;38');
      } finally {
        instance.unmount();
      }
    }

    // 2. ModalScroller ↑ / ↓ arrows sit at right={0} (column width - 1)
    {
      const scrollViewport = new ScrollViewport();
      const width = 40;
      const { stdout, stdin } = createTestStreams(width, 10);
      const instance = await render(
        <ThemeProvider initialState="dark">
          <ModalScroller scrollViewport={scrollViewport} maxRows={6}>
            {Array.from({ length: 20 }, (_, i) => (
              <Text key={i}>{`ROW_${i}`}</Text>
            ))}
          </ModalScroller>
        </ThemeProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 90));
        scrollViewport.handle?.scrollTo(4);
        await new Promise(r => setTimeout(r, 100));
        const lines = readScreenLines(getInkScreen(stdout));
        const upRow = lines.find(l => l.includes(figures.arrowUp));
        const downRow = lines.find(l => l.includes(figures.arrowDown));
        expect(upRow).toBeDefined();
        expect(downRow).toBeDefined();
        expect(upRow!.lastIndexOf(figures.arrowUp)).toBe(width - 1);
        expect(downRow!.lastIndexOf(figures.arrowDown)).toBe(width - 1);
      } finally {
        instance.unmount();
      }
    }
  });

  test('Item 6: CondensedLogo Pro trial/usage-credits badge, /tui classic copy, getTuiJustSwitchedMode guard, and compact rc pill', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    // Trial state & badge formatting (official _dn / evs @308205810)
    expect(formatProTrialBadgeLabel(computeProTrialState(false, '2026-06-10T00:00:00.000Z', now))).toBeNull();
    expect(formatProTrialBadgeLabel(computeProTrialState(true, null, now))).toBeNull();
    expect(formatProTrialBadgeLabel(computeProTrialState(true, 'not-a-date', now))).toBeNull();
    expect(formatProTrialBadgeLabel(computeProTrialState(true, '2026-06-01T12:00:00.000Z', now))).toBe(
      'Trial: 1 day left',
    );
    expect(formatProTrialBadgeLabel(computeProTrialState(true, '2026-06-06T00:00:00.000Z', now))).toBe(
      'Trial: 5 days left',
    );
    expect(formatProTrialBadgeLabel(computeProTrialState(true, '2026-05-31T23:59:59.000Z', now))).toBe('Usage credits');

    // getTuiJustSwitchedMode guards case 'default' on !isFullscreenEnvEnabled()
    process.env.CLAUDE_CODE_TUI_JUST_SWITCHED = 'default';
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    resetFullscreenGateCache();
    expect(getTuiJustSwitchedMode()).toBeUndefined();

    process.env.CLAUDE_CODE_NO_FLICKER = '0';
    resetFullscreenGateCache();
    expect(getTuiJustSwitchedMode()).toBe('default');

    process.env.CLAUDE_CODE_TUI_JUST_SWITCHED = 'fullscreen';
    expect(getTuiJustSwitchedMode()).toBeUndefined();
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    resetFullscreenGateCache();
    expect(getTuiJustSwitchedMode()).toBe('fullscreen');

    // compactRcPillLabel strips leading slash (official Zqi @318440442:3703)
    chalk.level = 3;
    expect(compactRcPillLabel({ label: '/rc active', color: 'success' })).toBe('rc');
    expect(compactRcPillLabel({ label: '/rc connecting…', color: 'warning' })).toBe('rc');
    chalk.level = 0;
    expect(compactRcPillLabel({ label: '/rc active', color: 'success' })).toBe('rc');
    expect(compactRcPillLabel({ label: '/rc connecting…', color: 'warning' })).toBe('rc connecting…');

    // /tui classic copy & badge color wiring in CondensedLogo.tsx
    const logoSrc = readFileSync(join(ROOT, 'src/components/LogoV2/CondensedLogo.tsx'), 'utf8');
    expect(logoSrc).toContain('use /tui classic');
    expect(logoSrc).not.toContain('use /tui default');
    expect(logoSrc).toContain("trialState.status === 'expired' ? 'suggestion' : 'warning'");
  });

  test('Item 7: ThemePicker supports isTitledByHost and aligns diff preview width to columns - 4', async () => {
    // 1. Default (isTitledByHost=false) shows "Theme" heading
    {
      const { stdout, stdin } = createTestStreams(80, 24);
      const instance = await render(
        <ThemeProvider initialState="dark">
          <AppStateProvider>
            <ThemePicker onThemeSelect={() => {}} skipExitHandling />
          </AppStateProvider>
        </ThemeProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 60));
        const text = readScreenLines(getInkScreen(stdout)).join('\n');
        expect(text).toContain('Theme');
        expect(text).toContain('Choose the text style that looks best with your terminal');
      } finally {
        instance.unmount();
      }
    }

    // 2. isTitledByHost=true suppresses duplicate "Theme" heading & subtitle while keeping helpText
    {
      const { stdout, stdin } = createTestStreams(80, 24);
      const instance = await render(
        <ThemeProvider initialState="dark">
          <AppStateProvider>
            <ThemePicker onThemeSelect={() => {}} skipExitHandling isTitledByHost helpText="Host help hint" />
          </AppStateProvider>
        </ThemeProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 60));
        const lines = readScreenLines(getInkScreen(stdout));
        const text = lines.join('\n');
        expect(lines.some(l => l.trim() === 'Theme')).toBe(false);
        expect(text).not.toContain('Choose the text style that looks best with your terminal');
        expect(text).toContain('Host help hint');
      } finally {
        instance.unmount();
      }
    }

    // 3. Diff preview width uses columns - 2 * horizontalPadding (columns - 4 in both inline and modal)
    const tpSrc = readFileSync(join(ROOT, 'src/components/ThemePicker.tsx'), 'utf8');
    expect(tpSrc).toContain('MODAL_LAYOUT_PADDING_X + PANE_PADDING_X_MODAL');
    expect(tpSrc).toContain('width={Math.max(0, columns - 2 * horizontalPadding)}');
    expect(tpSrc).not.toContain('columns - 6');
  });

  test('Item 8: ANSI_COLOR_NAMES matches official 16 standard ANSI color names (no gray/grey aliases)', () => {
    const standard16 = [
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'blackBright',
      'redBright',
      'greenBright',
      'yellowBright',
      'blueBright',
      'magentaBright',
      'cyanBright',
      'whiteBright',
    ];
    for (const name of standard16) {
      expect(isValidAppThemeColor(`ansi:${name}`)).toBe(true);
      expect(isValidInkThemeColor(`ansi:${name}`)).toBe(true);
    }
    expect(isValidAppThemeColor('ansi:gray')).toBe(false);
    expect(isValidAppThemeColor('ansi:grey')).toBe(false);
    expect(isValidInkThemeColor('ansi:gray')).toBe(false);
    expect(isValidInkThemeColor('ansi:grey')).toBe(false);
  });
});
