import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as React from 'react';
import {
  leftoverIhrApplyCompactProgress,
  leftoverIhrEvict,
  leftoverIhrGet,
  leftoverIhrMarkStoreMounted,
} from '../../../utils/collapseReadSearch.js';
import { resetScreenReaderModeCache } from '../../../utils/screenReaderGate.js';
import { renderToString } from '../../../utils/staticRender.js';
import { SpinnerAnimationRow, type SpinnerAnimationRowProps } from '../SpinnerAnimationRow.js';

const SESSION = 'spinner-compact-clock-289';
const EPOCH_START = 1_800_000_000_000;
let wallNow = EPOCH_START;
let monotonicNow = 10_000;
let wallClock: ReturnType<typeof spyOn>;
let monotonicClock: ReturnType<typeof spyOn>;
let screenReaderEnv: string | undefined;

function rowProps(overrides: Partial<SpinnerAnimationRowProps> = {}): SpinnerAnimationRowProps {
  return {
    mode: 'requesting',
    reducedMotion: true,
    hasActiveTools: false,
    responseLengthRef: { current: 1960 },
    message: 'Compacting conversation…',
    messageColor: 'claudeBlue_FOR_SYSTEM_SPINNER',
    shimmerColor: 'claudeBlueShimmer_FOR_SYSTEM_SPINNER',
    loadingStartTimeRef: { current: 1000 },
    totalPausedMsRef: { current: 2000 },
    pauseStartTimeRef: { current: 6000 },
    verbose: false,
    columns: 120,
    hasRunningTeammates: false,
    teammateTokens: 0,
    foregroundedTeammate: undefined,
    thinkingStatus: null,
    effortSuffix: '',
    ...overrides,
  };
}

async function renderRow(props: SpinnerAnimationRowProps): Promise<string> {
  return renderToString(<SpinnerAnimationRow {...props} />, 120);
}

beforeEach(() => {
  screenReaderEnv = process.env.CLAUDE_AX_SCREEN_READER;
  process.env.CLAUDE_AX_SCREEN_READER = '0';
  resetScreenReaderModeCache();
  leftoverIhrMarkStoreMounted(true);
  leftoverIhrEvict(SESSION);
  wallNow = EPOCH_START;
  monotonicNow = 10_000;
  wallClock = spyOn(Date, 'now').mockImplementation(() => wallNow);
  monotonicClock = spyOn(performance, 'now').mockImplementation(() => monotonicNow);
});

afterEach(() => {
  wallClock.mockRestore();
  monotonicClock.mockRestore();
  leftoverIhrEvict(SESSION);
  leftoverIhrMarkStoreMounted(false);
  if (screenReaderEnv === undefined) delete process.env.CLAUDE_AX_SCREEN_READER;
  else process.env.CLAUDE_AX_SCREEN_READER = screenReaderEnv;
  resetScreenReaderModeCache();
});

describe('densable 2.1.289 compact elapsed clock', () => {
  test('renders increasing elapsed time and tokens from the real compact store', async () => {
    leftoverIhrApplyCompactProgress(SESSION, { type: 'compact_start' });
    const state = leftoverIhrGet(SESSION);
    const props = rowProps({
      compactProgressActiveRef: { current: state.isCompacting },
      compactingStartTime: state.compactingStartTime,
    });
    expect(state.compactingStartTime).toBe(EPOCH_START);
    expect(await renderRow(props)).toContain('0s');

    wallNow += 5000;
    monotonicNow += 5000;
    const fiveSeconds = await renderRow(props);
    expect(fiveSeconds).toContain('5s');
    expect(fiveSeconds).toContain('490 tokens');

    wallNow += 25_000;
    monotonicNow += 25_000;
    props.responseLengthRef.current = 2800;
    const thirtySeconds = await renderRow(props);
    expect(thirtySeconds).toContain('30s');
    expect(thirtySeconds).toContain('700 tokens');
  });

  test('clamps a backwards wall clock to zero during compaction', async () => {
    leftoverIhrApplyCompactProgress(SESSION, { type: 'compact_start' });
    wallNow -= 1000;
    const text = await renderRow(
      rowProps({
        compactProgressActiveRef: { current: true },
        compactingStartTime: leftoverIhrGet(SESSION).compactingStartTime,
      }),
    );
    expect(text).toContain('0s');
    expect(text).not.toContain('-1s');
  });

  test('keeps ordinary loading and paused elapsed on the monotonic clock', async () => {
    const props = rowProps({
      compactProgressActiveRef: { current: false },
      compactingStartTime: EPOCH_START,
      pauseStartTimeRef: { current: null },
    });
    expect(await renderRow(props)).toContain('7s');
    wallNow += 3_600_000;
    expect(await renderRow(props)).toContain('7s');

    props.pauseStartTimeRef.current = 6000;
    expect(await renderRow(props)).toContain('3s');
    monotonicNow += 20_000;
    wallNow += 20_000;
    expect(await renderRow(props)).toContain('3s');
  });
});
