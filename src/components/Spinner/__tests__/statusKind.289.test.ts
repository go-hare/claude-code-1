import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatDuration } from '../../../utils/format.js'
import {
  advanceSpinnerToolWindow,
  cosinePulse,
  emptySpinnerToolWindow,
  formatSpinnerStatusText,
  pingPongFrameIndex,
  recoveringLabel,
  resolveSpinnerStatusKind,
  STALL_TELEMETRY_THRESHOLDS_MS,
} from '../statusKind.js'

describe('densable 2.1.289 Je extras', () => {
  test('Un stall telemetry thresholds 10s/45s/5min', () => {
    expect([...STALL_TELEMETRY_THRESHOLDS_MS]).toEqual([
      10_000, 45_000, 300_000,
    ])
  })

  test('eo recovering copy', () => {
    expect(recoveringLabel({ attempt: 1, limit: 3 })).toBe(
      'picking the thought back up',
    )
    expect(recoveringLabel({ attempt: 2, limit: 3 })).toBe(
      'picking the thought back up (2 of 3)',
    )
  })

  test('qe tool-running after 2s, recovering, thought-for, none', () => {
    const now = 50_000
    const running = advanceSpinnerToolWindow(emptySpinnerToolWindow(), {
      now: now - 3_000,
      isThinking: false,
      hasActiveTools: true,
      thinkingStatus: null,
    })
    const stillRunning = advanceSpinnerToolWindow(running, {
      now,
      isThinking: false,
      hasActiveTools: true,
      thinkingStatus: null,
    })
    expect(
      resolveSpinnerStatusKind(stillRunning, {
        now,
        hasActiveTools: true,
        thinkingStatus: null,
        showToolCallTimer: true,
        outputLimitRecovery: null,
      }),
    ).toEqual({ kind: 'tool-running', toolMs: 3_000 })

    expect(
      resolveSpinnerStatusKind(emptySpinnerToolWindow(), {
        now,
        hasActiveTools: false,
        thinkingStatus: null,
        showToolCallTimer: false,
        outputLimitRecovery: { attempt: 1, limit: 3 },
      }),
    ).toEqual({
      kind: 'recovering',
      recovery: { attempt: 1, limit: 3 },
    })

    expect(
      resolveSpinnerStatusKind(emptySpinnerToolWindow(), {
        now,
        hasActiveTools: false,
        thinkingStatus: 7_000,
        showToolCallTimer: false,
        outputLimitRecovery: null,
      }),
    ).toEqual({ kind: 'thought-for', thoughtMs: 7_000 })
  })

  test('Fe thinking burst starts on rising edge, qe thinking uses burst ms', () => {
    const t0 = 10_000
    const started = advanceSpinnerToolWindow(emptySpinnerToolWindow(), {
      now: t0,
      isThinking: true,
      hasActiveTools: false,
      thinkingStatus: 'thinking',
    })
    expect(started.thinkingBurstStart).toBe(t0)
    const later = advanceSpinnerToolWindow(started, {
      now: t0 + 12_000,
      isThinking: true,
      hasActiveTools: false,
      thinkingStatus: 'thinking',
    })
    expect(later.thinkingBurstStart).toBe(t0)
    expect(
      resolveSpinnerStatusKind(later, {
        now: t0 + 12_000,
        hasActiveTools: false,
        thinkingStatus: 'thinking',
        showToolCallTimer: false,
        outputLimitRecovery: null,
      }),
    ).toEqual({ kind: 'thinking', thinkingMs: 12_000 })
  })

  test('Je lt switch copies', () => {
    expect(
      formatSpinnerStatusText({ kind: 'tool-running', toolMs: 3_000 }, '').text,
    ).toBe(`running tool for ${formatDuration(3_000)}`)
    expect(
      formatSpinnerStatusText({ kind: 'tool-done', toolMs: 4_000 }, '').text,
    ).toBe(`ran tool for ${formatDuration(4_000)}`)
    expect(
      formatSpinnerStatusText(
        { kind: 'thinking', thinkingMs: 45_000 },
        ' extra',
      ).text,
    ).toBe('deep in thought extra')
    expect(formatSpinnerStatusText({ kind: 'none' }, '').text).toBeNull()
  })

  test('jTt cosine pulse and Xn frame mapping', () => {
    expect(cosinePulse(0, 2000)).toBe(0)
    expect(cosinePulse(1000, 2000)).toBeCloseTo(1, 10)
    expect(cosinePulse(2000, 2000)).toBeCloseTo(0, 10)
    expect(pingPongFrameIndex(0, 6, false)).toBe(0)
    expect(pingPongFrameIndex(1000, 6, false)).toBe(5)
    expect(pingPongFrameIndex(1000, 6, true)).toBe(0)
  })

  test('Rte glyph uses accessibility.hidden, cosinePulse, h7t base frames', () => {
    const glyph = readFileSync(
      join(import.meta.dir, '../SpinnerGlyph.tsx'),
      'utf8',
    )
    expect(glyph).toContain('accessibility={GLYPH_A11Y}')
    expect(glyph).toContain('hidden: true')
    expect(glyph).toContain('cosinePulse')
    expect(glyph).toContain('PULSE_BLACK')
    expect(glyph).toContain('getDefaultCharacters()')
    expect(glyph).not.toContain('getSpinnerPingPongFrames()')
  })

  test('Je live glyph is gold Xn cosine onto h7t, requesting 50 else 100', () => {
    const row = readFileSync(
      join(import.meta.dir, '../SpinnerAnimationRow.tsx'),
      'utf8',
    )
    expect(row).toContain('pingPongFrameIndex(')
    expect(row).toContain('getDefaultCharacters().length')
    expect(row).not.toContain('Math.floor(time / 120)')
    expect(row).toContain("mode === 'requesting' ? 50 : 100")
    expect(row).not.toContain('reducedMotion && !retryStatus ? null : 50')
  })

  test('Je mn is gold outer column + inner row wrap; ht nullable', () => {
    const row = readFileSync(
      join(import.meta.dir, '../SpinnerAnimationRow.tsx'),
      'utf8',
    )
    expect(row).toContain('flexDirection="column" width="100%"')
    expect(row).toContain(
      'flexDirection="row" flexWrap="wrap" marginTop={1} width="100%"',
    )
    expect(row).toContain('let ht: React.ReactNode = null')
    expect(row).not.toContain('statusSlot')
    expect(row).not.toContain('always mount a 3-child slot')
  })

  test('GlimmerMessage is gold RTt 2-Text early returns, not always-4-Text', () => {
    const glimmer = readFileSync(
      join(import.meta.dir, '../GlimmerMessage.tsx'),
      'utf8',
    )
    expect(glimmer).not.toContain('function leftoverRttPair')
    expect(glimmer).not.toContain('function stableVerbRow')
    expect(glimmer).not.toContain('DualInk leftoverGs analog extra: ONE 4-Text')
    expect(glimmer).toContain('if (stalledIntensity > 0)')
    expect(glimmer).toContain('if (thinkingIntensity > 0)')
    expect(glimmer).toContain("if (mode === 'tool-use')")
    expect(glimmer).toContain('shimmerStart >= messageWidth || shimmerEnd < 0')
    expect(glimmer).toContain(
      '{before ? <Text color={messageColor}>{before}</Text> : null}',
    )
    expect(glimmer).toContain(
      '{after ? <Text color={messageColor}>{after}</Text> : null}',
    )
    expect(glimmer).toContain('<Text color={shimmerColor}>{shim}</Text>')
  })

  test('SpinnerWithVerb threads shining_fractals and agentId', () => {
    const spinner = readFileSync(
      join(import.meta.dir, '../../Spinner.tsx'),
      'utf8',
    )
    expect(spinner).toContain('tengu_shining_fractals')
    expect(spinner).toContain('outputLimitRecovery={outputLimitRecovery}')
    expect(spinner).toContain('agentId={agentId}')
  })

  test('REPL hosts fl bag: query announce, setMode clears off requesting', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('outputLimitRecovery={outputLimitRecovery}')
    expect(repl).toContain('setOutputLimitRecovery')
    expect(repl).toContain(
      "if (mode !== 'requesting') setOutputLimitRecovery(null)",
    )
    const query = readFileSync(
      join(import.meta.dir, '../../../query.ts'),
      'utf8',
    )
    expect(query).toContain(
      'announceOutputLimitRecovery(state.transition, toolUseContext)',
    )
    expect(query).toContain("setStreamMode?.('requesting')")
    expect(query).not.toContain('export function fl(')
  })

  test('REPL does not mount analog BackgroundAgentSelector (gold MIe only)', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).not.toContain('BackgroundAgentSelector')
    expect(repl).not.toContain('shift+↓ to manage background agents')
    const prompt = readFileSync(
      join(import.meta.dir, '../../PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(prompt).not.toContain("'bg_agent'")
    expect(prompt).not.toContain('BackgroundAgentSelector')
    expect(prompt).not.toContain('selectedBgAgentIndex')
  })

  test('REPL SpinnerWithVerb is gold bJ scrollable after flexGrow', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    const spinner = repl.lastIndexOf('<SpinnerWithVerb')
    const scrollable = repl.lastIndexOf('scrollable={')
    const above = repl.lastIndexOf('abovePrompt={')
    const bottom = repl.lastIndexOf('bottom={')
    expect(spinner).toBeGreaterThan(0)
    expect(scrollable).toBeGreaterThan(0)
    expect(above).toBeGreaterThan(scrollable)
    expect(bottom).toBeGreaterThan(above)
    expect(spinner).toBeGreaterThan(scrollable)
    expect(spinner).toBeLessThan(above)
    const scrollChunk = repl.slice(scrollable, above)
    expect(scrollChunk).toContain('<SpinnerWithVerb')
    expect(scrollChunk).toContain('<BriefIdleStatus')
    expect(scrollChunk).toContain('<Box flexGrow={1} />')
    expect(scrollChunk.indexOf('<Box flexGrow={1} />')).toBeLessThan(
      scrollChunk.indexOf('<SpinnerWithVerb'),
    )
    expect(scrollChunk).toContain('isLoading && !showSpinner')
    expect(scrollChunk).toContain('LeftoverMhrRetryRow')
    expect(scrollChunk.indexOf('LeftoverMhrRetryRow')).toBeLessThan(
      scrollChunk.indexOf('<SpinnerWithVerb'),
    )
    expect(scrollChunk).not.toContain('isLoading && !isBriefOnly')
    expect(scrollChunk).not.toContain('!hasRunningTeammates &&')
    expect(repl.slice(bottom)).toContain('<DialogHost')
    expect(repl.slice(bottom)).not.toContain('<SpinnerWithVerb')
    expect(repl.slice(bottom)).not.toContain('<BriefIdleStatus')
    expect(repl.slice(bottom)).not.toContain('<PluginAbovePromptSite')
  })

  test('Spinner Cn has no Idle teammates-running early return; footer XOR compacting/retry', () => {
    const spinner = readFileSync(
      join(import.meta.dir, '../../Spinner.tsx'),
      'utf8',
    )
    expect(spinner).not.toContain('teammates running')
    expect(spinner).toContain(
      'compactingHint && compactProgressActiveRef?.current',
    )
    expect(spinner).not.toContain('compactProgressActiveRef?.current ? null')
    expect(spinner).toContain('retryStatus ? (')
    expect(spinner).toContain("status.kind !== 'retrying'")
    expect(spinner).toContain('Math.min(3, status.maxRetries)')
    expect(spinner).toContain("includes('overload')")
    expect(spinner).not.toContain('Compacting conversation')
  })
})
