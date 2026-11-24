import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { AccessibilityContext, stringWidth } from '@anthropic/ink';
import chalk from 'chalk';
import * as React from 'react';
import stripAnsi from 'strip-ansi';
import Ink from '../../../../packages/@ant/ink/src/core/ink.js';
import { extractScreenReaderText } from '../../../../packages/@ant/ink/src/core/screenReaderTree.js';
import { leftoverPolicyLimitsHost } from '../../../cli/leftoverTulip.js';
import { AppStateProvider } from '../../../state/AppState.js';
import { type AppState, getDefaultAppState } from '../../../state/AppStateStore.js';
import { createStore } from '../../../state/store.js';
import type { TaskState } from '../../../tasks/types.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import {
  buildBorderText,
  formatUltracodeTag,
  SwarmBannerBorder,
  ULTRACODE_SHIMMER_HEX,
  ULTRACODE_SHIMMER_INTERVAL_MS,
} from '../PromptInput.js';
import { FooterRightIndicators, formatFooterSessionModeLabels } from '../PromptInputFooter.js';
import {
  BackgroundCountPill,
  doesClassicCycleHintFitRow,
  PromptInputFooterLeftSide,
  resetAgentsHintExpiredForTest,
  resolveFullscreenFooterHint,
} from '../PromptInputFooterLeftSide.js';
import { usePromptInputPlaceholder } from '../usePromptInputPlaceholder.js';

const ROOT = join(import.meta.dir, '../../../..');

function renderToText(element: React.ReactElement, columns = 100): string {
  const stdout = Object.assign(new PassThrough(), {
    columns,
    rows: 24,
    isTTY: true,
  });
  stdout.resume();
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {},
    ref() {},
    unref() {},
  });
  const ink = new Ink({
    stdout: stdout as never,
    stdin: stdin as never,
    stderr: new PassThrough() as never,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  ink.render(element);
  const text = extractScreenReaderText((ink as unknown as { rootNode: never }).rootNode);
  ink.unmount();
  return text;
}

function makePermissionContext(mode: ToolPermissionContext['mode']): ToolPermissionContext {
  return {
    mode,
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  };
}

function makeRunningBashTask(id: string, command = 'sleep 10'): TaskState {
  return {
    id,
    type: 'local_bash',
    status: 'running',
    description: command,
    startTime: Date.now(),
    outputFile: `/tmp/${id}.out`,
    outputOffset: 0,
    notified: false,
    command,
    completionStatusSentInAttachment: false,
    shellCommand: null,
    unregisterCleanup: () => {},
    stdoutLineCount: 0,
    stderrLineCount: 0,
    lastReportedStdoutLines: 0,
    lastReportedStderrLines: 0,
    isBackgrounded: true,
  } as unknown as TaskState;
}

function makeRunningLocalAgentTask(id: string): TaskState {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    agentType: 'explore',
    description: 'explore',
    startTime: Date.now(),
    outputFile: `/tmp/${id}.out`,
    outputOffset: 0,
    notified: false,
    isBackgrounded: true,
    pendingMessages: [],
    messages: [],
  } as unknown as TaskState;
}

describe('Official 2.1.328 UI Alignment — PromptInput, Footer, Notifications & Placeholder', () => {
  const prevNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER;
  const prevDisableAltScreen = process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN;

  beforeEach(() => {
    resetAgentsHintExpiredForTest();
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN;
  });

  afterEach(() => {
    if (prevNoFlicker === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER;
    else process.env.CLAUDE_CODE_NO_FLICKER = prevNoFlicker;
    if (prevDisableAltScreen === undefined) delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN;
    else process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = prevDisableAltScreen;
    resetAgentsHintExpiredForTest();
  });

  // ── Item 1: Footer left-side jl, sc, (↓ to manage), abo, Frt ──────────────

  describe('Item 1: PromptInputFooterLeftSide (jl, sc, manage parens, abo, Frt)', () => {
    test('resolveFullscreenFooterHint implements official 2.1.328 jl single-winner priority order', () => {
      const base = {
        voiceWarmingUp: false,
        forceInterrupt: false,
        showHint: true,
        allowInterruptHint: false,
        canShowEscInterrupt: false,
        isArtifactsSelected: false,
        hasManageableTasks: false,
        isPanelRowSelected: false,
        hasTaskItems: false,
        agentsAvailable: false,
        hasAgentsHintContent: false,
        isScreenReader: false,
        hasParkedSubagentsHint: false,
        canShowVoiceHint: false,
        canShowCycleHint: false,
      };

      expect(resolveFullscreenFooterHint({ ...base, voiceWarmingUp: true, canShowEscInterrupt: true })).toBe('warmup');
      expect(resolveFullscreenFooterHint({ ...base, forceInterrupt: true, hasManageableTasks: true })).toBe(
        'interrupt',
      );
      expect(
        resolveFullscreenFooterHint({
          ...base,
          canShowEscInterrupt: true,
          agentsAvailable: true,
          hasAgentsHintContent: true,
        }),
      ).toBe('interrupt_agents');
      expect(resolveFullscreenFooterHint({ ...base, canShowEscInterrupt: true, canShowCycleHint: true })).toBe(
        'interrupt',
      );
      expect(resolveFullscreenFooterHint({ ...base, isArtifactsSelected: true, hasManageableTasks: true })).toBe(
        'artifacts',
      );
      expect(resolveFullscreenFooterHint({ ...base, hasManageableTasks: true, hasTaskItems: true })).toBe('manage');
      expect(resolveFullscreenFooterHint({ ...base, hasTaskItems: true, agentsAvailable: true })).toBe('ctrl_t');
      expect(
        resolveFullscreenFooterHint({
          ...base,
          agentsAvailable: true,
          hasAgentsHintContent: true,
          canShowCycleHint: true,
        }),
      ).toBe('agents');
      expect(resolveFullscreenFooterHint({ ...base, agentsAvailable: true, hasAgentsHintContent: false })).toBe('none');
      expect(resolveFullscreenFooterHint({ ...base, hasParkedSubagentsHint: true, canShowVoiceHint: true })).toBe(
        'none',
      );
      expect(resolveFullscreenFooterHint({ ...base, canShowVoiceHint: true, canShowCycleHint: true })).toBe('voice');
      expect(resolveFullscreenFooterHint({ ...base, canShowCycleHint: true })).toBe('cycle');
      expect(resolveFullscreenFooterHint(base)).toBe('shortcuts');
    });

    test('fullscreen idle default mode with agents shows ONLY "← for agents" (never stacks "? for shortcuts")', () => {
      process.env.CLAUDE_CODE_NO_FLICKER = '1';
      const store = createStore<AppState>(getDefaultAppState());
      const out = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('default')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={true}
          />
        </AppStateProvider>,
      );
      expect(out).toContain('manual mode on');
      expect(out).toContain('← for agents');
      expect(out).not.toContain('? for shortcuts');
      expect(out).not.toContain('shift+tab to cycle');
    });

    test('fullscreen idle default mode without agents shows "? for shortcuts"', () => {
      process.env.CLAUDE_CODE_NO_FLICKER = '1';
      const store = createStore<AppState>(getDefaultAppState());
      const out = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('default')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
          />
        </AppStateProvider>,
      );
      expect(out).toContain('manual mode on');
      expect(out).toContain('? for shortcuts');
      expect(out).not.toContain('← for agents');
    });

    test('fullscreen renders "(shift+tab to cycle)" ONLY when jl === "cycle", never with esc or agents', () => {
      process.env.CLAUDE_CODE_NO_FLICKER = '1';
      const store = createStore<AppState>(getDefaultAppState());

      // Idle non-default mode without agents -> jl === 'cycle'
      const idleCycle = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('acceptEdits')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
          />
        </AppStateProvider>,
      );
      expect(idleCycle).toContain('accept edits on');
      expect(idleCycle).toContain('(shift+tab to cycle)');
      expect(idleCycle).not.toContain('? for shortcuts');

      // Idle non-default mode WITH agents -> jl === 'agents', NO cycle hint
      const idleAgents = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('acceptEdits')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={true}
          />
        </AppStateProvider>,
      );
      expect(idleAgents).toContain('accept edits on');
      expect(idleAgents).toContain('← for agents');
      expect(idleAgents).not.toContain('shift+tab to cycle');

      // Loading non-default mode -> jl === 'interrupt', NO cycle hint
      const loading = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('acceptEdits')}
            suppressHint={false}
            isLoading={true}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
          />
        </AppStateProvider>,
      );
      expect(loading).toContain('accept edits on');
      expect(loading).toContain('esc to interrupt');
      expect(loading).not.toContain('shift+tab to cycle');
    });

    test('fullscreen manage hint renders "(↓ to manage)" / "(enter to view tasks)" in parens directly beside pill', () => {
      process.env.CLAUDE_CODE_NO_FLICKER = '1';
      const t1 = makeRunningBashTask('b1', 'npm run dev');
      const store = createStore<AppState>({
        ...getDefaultAppState(),
        tasks: { b1: t1 },
      });

      const unselected = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('default')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
          />
        </AppStateProvider>,
      );
      expect(unselected).toContain('(↓ to manage)');
      expect(unselected).not.toContain('· (↓ to manage)');

      const selected = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('default')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={true}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
          />
        </AppStateProvider>,
      );
      expect(selected).toContain('(enter to view tasks)');
      expect(selected).not.toContain('· (enter to view tasks)');
    });

    test('fullscreen >= 2 background tasks renders official Frt "↳ N background" directly beside "(↓ to manage)"', () => {
      process.env.CLAUDE_CODE_NO_FLICKER = '1';
      const t1 = makeRunningBashTask('b1', 'sleep 10');
      const t2 = makeRunningBashTask('b2', 'sleep 20');
      const store = createStore<AppState>({
        ...getDefaultAppState(),
        tasks: { b1: t1, b2: t2 },
      });

      const pillOnly = renderToText(<BackgroundCountPill count={3} selected={false} />);
      expect(pillOnly).toContain('3 background');

      const out = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('default')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
          />
        </AppStateProvider>,
      );
      expect(out).toContain('2 background');
      expect(out).toContain('(↓ to manage)');
      expect(out).not.toContain('· (↓ to manage)');
    });

    test('stale "ctrl+x ctrl+k to stop agents" is removed from interrupt/spinner hints (official abo)', () => {
      const footerLeftSrc = readFileSync(
        join(ROOT, 'src/components/PromptInput/PromptInputFooterLeftSide.tsx'),
        'utf8',
      );
      expect(footerLeftSrc).not.toContain('action="stop agents"');

      process.env.CLAUDE_CODE_NO_FLICKER = '0';
      const agentTask = makeRunningLocalAgentTask('ag-1');
      const store = createStore<AppState>({
        ...getDefaultAppState(),
        tasks: { 'ag-1': agentTask },
      });
      const out = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('default')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
          />
        </AppStateProvider>,
      );
      expect(out).not.toContain('stop agents');
    });

    test('classic mode gates "(shift+tab to cycle)" on rowWidth fit (official sc)', () => {
      expect(doesClassicCycleHintFitRow('⏵⏵ accept edits on (shift+tab to cycle)', 80, false)).toBe(true);
      expect(doesClassicCycleHintFitRow('⏵⏵ accept edits on (shift+tab to cycle)', 30, false)).toBe(false);
      expect(doesClassicCycleHintFitRow('⏵⏵ accept edits on (shift+tab to cycle)', 30, true)).toBe(true);
      expect(doesClassicCycleHintFitRow('⏵⏵ accept edits on (shift+tab to cycle)', undefined, false)).toBe(true);

      process.env.CLAUDE_CODE_NO_FLICKER = '0';
      const store = createStore<AppState>(getDefaultAppState());

      const narrow = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('acceptEdits')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
            wrappedRowWidth={28}
          />
        </AppStateProvider>,
      );
      expect(narrow).toContain('accept edits on');
      expect(narrow).not.toContain('shift+tab to cycle');

      const wide = renderToText(
        <AppStateProvider store={store}>
          <PromptInputFooterLeftSide
            exitMessage={{ show: false }}
            vimMode={undefined}
            mode="prompt"
            toolPermissionContext={makePermissionContext('acceptEdits')}
            suppressHint={false}
            isLoading={false}
            tasksSelected={false}
            teamsSelected={false}
            tmuxSelected={false}
            isSearching={false}
            historyQuery=""
            setHistoryQuery={() => {}}
            historyFailedMatch={false}
            leftArrowDetachAvailable={false}
            wrappedRowWidth={96}
          />
        </AppStateProvider>,
      );
      expect(wide).toContain('(shift+tab to cycle)');
    });
  });

  // ── Item 2: steppedEffortTag & ultracode 120ms #d0b4ff shimmer ────────────

  describe('Item 2: buildBorderText steppedEffortTag & ultracode shimmer', () => {
    test('formatUltracodeTag uses 120ms #d0b4ff bold shimmer sweep (official aue/lue)', () => {
      expect(ULTRACODE_SHIMMER_HEX).toBe('#d0b4ff');
      expect(ULTRACODE_SHIMMER_INTERVAL_MS).toBe(120);
      expect(formatUltracodeTag(false)).toBeUndefined();

      const plain = formatUltracodeTag(true);
      expect(plain).toBeDefined();
      expect(stripAnsi(plain!)).toBe('ultracode');

      const shimmered = formatUltracodeTag(true, 4);
      expect(shimmered).toBeDefined();
      expect(stripAnsi(shimmered!)).toBe('ultracode');
      // Shimmered output must differ from unshimmered output when ANSI colors are active
      if (chalk.level > 0) {
        expect(shimmered).not.toBe(plain);
      }
    });

    test('buildBorderText appends steppedEffortTag and joins tags with two spaces (official cue/NTe)', () => {
      const stepped = chalk.reset.dim('◐ medium · /effort');
      const onlyStepped = buildBorderText(false, false, false, false, { steppedEffortTag: stepped });
      expect(onlyStepped).toBeDefined();
      expect(onlyStepped!.align).toBe('end');
      expect(onlyStepped!.offset).toBe(0);
      expect(stripAnsi(onlyStepped!.content)).toBe(' ◐ medium · /effort ');

      const combined = buildBorderText(true, true, false, true, {
        ultracodeShimmerIdx: 2,
        steppedEffortTag: stepped,
      });
      expect(combined).toBeDefined();
      const plainCombined = stripAnsi(combined!.content);
      expect(plainCombined).toContain('ultracode  ');
      expect(plainCombined).toContain('  ◐ medium · /effort ');

      const promptSrc = readFileSync(join(ROOT, 'src/components/PromptInput/PromptInput.tsx'), 'utf8');
      expect(promptSrc).toContain('function useSteppedEffortTag(');
      expect(promptSrc).toContain('function useUltracodeShimmerIndex(');
      expect(promptSrc).toContain("current?.key === 'effort-level'");
    });
  });

  // ── Item 3: Swarm banner top/bottom startLabel borders (official EEt) ─────

  describe('Item 3: SwarmBannerBorder embeds topStartLabel & bottomMoreBorderText', () => {
    test('top border embeds "─── startLabel " and bottom borderOnly embeds "─── ↓ N more " to exact width', () => {
      const top = renderToText(
        <SwarmBannerBorder
          banner={{ text: '@worker', bgColor: 'cyan_FOR_SUBAGENTS_ONLY' }}
          columns={60}
          startLabel="history · ↑ 2 more"
        />,
        60,
      );
      expect(top).toContain('─── history · ↑ 2 more ');
      expect(top).toContain('@worker');
      expect(stringWidth(top.trimEnd())).toBe(60);

      const bottom = renderToText(
        <SwarmBannerBorder
          banner={{ text: '@worker', bgColor: 'cyan_FOR_SUBAGENTS_ONLY' }}
          columns={60}
          startLabel="↓ 4 more"
          borderOnly
        />,
        60,
      );
      expect(bottom).toContain('─── ↓ 4 more ');
      expect(bottom).not.toContain('@worker');
      expect(stringWidth(bottom.trimEnd())).toBe(60);
    });

    test('preserves optional fork gradient segments alongside startLabel and handles screen-reader mode', () => {
      const gradTop = renderToText(
        <SwarmBannerBorder
          banner={{
            text: 'pride-agent',
            bgColor: 'promptBorder',
            gradient: ['rainbow_red', 'rainbow_blue'],
          }}
          columns={60}
          startLabel="history"
        />,
        60,
      );
      expect(gradTop).toContain('─── history ');
      expect(gradTop).toContain('pride-agent');
      expect(stringWidth(gradTop.trimEnd())).toBe(60);

      const srTop = renderToText(
        <AccessibilityContext.Provider value={true}>
          <SwarmBannerBorder
            banner={{ text: '@worker', bgColor: 'cyan_FOR_SUBAGENTS_ONLY' }}
            columns={60}
            startLabel="history"
          />
        </AccessibilityContext.Provider>,
        60,
      );
      expect(srTop).toContain('@worker');
      expect(srTop).not.toContain('───');

      const srBottom = renderToText(
        <AccessibilityContext.Provider value={true}>
          <SwarmBannerBorder
            banner={{ text: '@worker', bgColor: 'cyan_FOR_SUBAGENTS_ONLY' }}
            columns={60}
            startLabel="↓ 2 more"
            borderOnly
          />
        </AccessibilityContext.Provider>,
        60,
      );
      expect(srBottom.trim()).toBe('');
    });
  });

  // ── Item 4: External editor banner copy ───────────────────────────────────

  test('Item 4: external editor banner uses official "Save and close the editor to continue…"', () => {
    const promptSrc = readFileSync(join(ROOT, 'src/components/PromptInput/PromptInput.tsx'), 'utf8');
    expect(promptSrc).toContain('Save and close the editor to continue…');
    expect(promptSrc).not.toContain('Save and close editor to continue...');
  });

  // ── Item 5: Footer row width={columns} & FooterRightIndicators ────────────

  describe('Item 5: PromptInputFooter width={columns} & FooterRightIndicators', () => {
    test('footer row passes width={columns} and preserves PipeStatusInline and StatusLine', () => {
      const footerSrc = readFileSync(join(ROOT, 'src/components/PromptInput/PromptInputFooter.tsx'), 'utf8');
      expect(footerSrc).toContain('width={columns}');
      expect(footerSrc).toContain('<PipeStatusInline />');
      expect(footerSrc).toContain('<StatusLine');
    });

    test('FooterRightIndicators renders HIPAA badge, dimmed cloud during remoteBootstrap, and account memory labels', () => {
      expect(formatFooterSessionModeLabels(true, 'read_only')).toEqual(['memory paused']);
      expect(formatFooterSessionModeLabels(false, 'read_only')).toEqual(['account memory: read-only']);
      expect(formatFooterSessionModeLabels(false, 'off')).toEqual(['account memory: off']);
      expect(formatFooterSessionModeLabels(false, null)).toEqual([]);

      const host = leftoverPolicyLimitsHost();
      const prevCompliance = [...host.complianceTaints];
      try {
        host.complianceTaints = ['hipaa'];
        const store = createStore<AppState>({
          ...getDefaultAppState(),
          remoteBootstrap: { seededFor: 'create' },
          accountMemoryMode: 'read_only',
        } as AppState);

        const out = renderToText(
          <AppStateProvider store={store}>
            <FooterRightIndicators debug={false} bridgeSelected={false} />
          </AppStateProvider>,
        );
        expect(out).toContain('HIPAA configured');
        expect(out).toContain('cloud');
        expect(out).toContain('account memory: read-only');
      } finally {
        host.complianceTaints = prevCompliance;
      }
    });
  });

  // ── Item 6: Auth error notification copy ──────────────────────────────────

  test('Item 6: Notifications uses official 2.1.328 auth error copy', () => {
    const notifSrc = readFileSync(join(ROOT, 'src/components/PromptInput/Notifications.tsx'), 'utf8');
    expect(notifSrc).toContain(`"Couldn't authenticate · try again"`);
    expect(notifSrc).toContain(`'Not logged in · run /login'`);
    expect(notifSrc).not.toContain('Authentication error · Try again');
    expect(notifSrc).not.toContain('Not logged in · Run /login');
  });

  // ── Item 7: Placeholder copy & takeback placeholder ───────────────────────

  describe('Item 7: usePromptInputPlaceholder copy & takeback placeholder', () => {
    test('replaces "immediately" with "now" and shows "Taking your message back…" during takeback', () => {
      const placeholderSrc = readFileSync(
        join(ROOT, 'src/components/PromptInput/usePromptInputPlaceholder.ts'),
        'utf8',
      );
      expect(placeholderSrc).toContain('Press up to edit queued messages, Enter to send them now');
      expect(placeholderSrc).not.toContain('Enter to send them immediately');

      let captured: string | undefined;
      function Harness({ isTakingBack, viewingAgentName }: { isTakingBack?: boolean; viewingAgentName?: string }) {
        captured = usePromptInputPlaceholder({
          input: '',
          submitCount: 0,
          hasMessages: true,
          viewingAgentName,
          nextStepHint: 'Resend your message to try again',
          isTakingBack,
        });
        return null;
      }

      const store = createStore<AppState>(getDefaultAppState());

      renderToText(
        <AppStateProvider store={store}>
          <Harness isTakingBack={true} />
        </AppStateProvider>,
      );
      expect(captured).toBe('Taking your message back…');

      // viewingAgentName still takes precedence over takeback (matching official yTe)
      renderToText(
        <AppStateProvider store={store}>
          <Harness isTakingBack={true} viewingAgentName="researcher" />
        </AppStateProvider>,
      );
      expect(captured).toBe('Message @researcher…');

      // Notification-driven cloud-line-take-back-pending fallback
      const notifStore = createStore<AppState>({
        ...getDefaultAppState(),
        notifications: {
          current: {
            key: 'cloud-line-take-back-pending',
            text: 'still taking your message back · wait for the session',
            priority: 'immediate',
          },
          queue: [],
          pinned: [],
        },
      });
      renderToText(
        <AppStateProvider store={notifStore}>
          <Harness />
        </AppStateProvider>,
      );
      expect(captured).toBe('Taking your message back…');
    });
  });
});
