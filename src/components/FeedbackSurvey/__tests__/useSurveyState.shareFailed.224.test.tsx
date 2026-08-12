/**
 * densable 2.1.224 #16 — share fail → share_failed, not thanks.
 * Behavioral: real useSurveyState + long-lived Ink mount (not source-grep).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as React from 'react';
import { PassThrough } from 'stream';
import { Text, wrappedRender as render } from '@anthropic/ink';
import { useSurveyState } from '../useSurveyState.js';
import type { TranscriptShareResponse } from '../TranscriptSharePrompt.js';
import type { FeedbackSurveyResponse } from '../utils.js';

type ShareOutcome = boolean | 'throw';

type HarnessApi = {
  state: string;
  open: () => void;
  handleSelect: (selected: FeedbackSurveyResponse) => boolean;
  handleTranscriptSelect: (selected: TranscriptShareResponse) => void;
};

async function mountSurvey(shareOutcome: ShareOutcome): Promise<{ api: () => HarnessApi; unmount: () => void }> {
  let latest: HarnessApi | null = null;

  function Probe(): React.ReactNode {
    const survey = useSurveyState({
      // long enough that auto-close does not race assertions
      hideThanksAfterMs: 60_000,
      onOpen: () => {},
      onSelect: () => {},
      shouldShowTranscriptPrompt: () => true,
      onTranscriptSelect: async () => {
        if (shareOutcome === 'throw') {
          throw new Error('share boom');
        }
        return shareOutcome;
      },
    });
    latest = {
      state: survey.state,
      open: survey.open,
      handleSelect: survey.handleSelect,
      handleTranscriptSelect: survey.handleTranscriptSelect,
    };
    return <Text>{survey.state}</Text>;
  }

  const stream = new PassThrough();
  const instance = await render(<Probe />, {
    stdout: stream as unknown as NodeJS.WriteStream,
    patchConsole: false,
  });

  // let first commit settle
  await new Promise(r => setTimeout(r, 20));
  if (!latest) {
    instance.unmount();
    throw new Error('useSurveyState did not mount');
  }

  return {
    api: () => {
      if (!latest) throw new Error('harness unmounted');
      return latest;
    },
    unmount: () => instance.unmount(),
  };
}

async function waitForState(api: () => HarnessApi, expected: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (api().state === expected) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for state=${expected}, last=${api().state}`);
}

describe('densable 2.1.224 #16 share_failed transitions (behavioral)', () => {
  const mounts: Array<() => void> = [];

  afterEach(() => {
    while (mounts.length) mounts.pop()?.();
  });

  test('share success → submitted (not thanks)', async () => {
    const { api, unmount } = await mountSurvey(true);
    mounts.push(unmount);

    api().open();
    await waitForState(api, 'open');
    api().handleSelect('bad');
    await waitForState(api, 'transcript_prompt');
    api().handleTranscriptSelect('yes');
    await waitForState(api, 'submitted');
    expect(api().state).not.toBe('thanks');
    expect(api().state).not.toBe('share_failed');
  });

  test('share failure → share_failed (not thanks)', async () => {
    const { api, unmount } = await mountSurvey(false);
    mounts.push(unmount);

    api().open();
    await waitForState(api, 'open');
    api().handleSelect('bad');
    await waitForState(api, 'transcript_prompt');
    api().handleTranscriptSelect('yes');
    await waitForState(api, 'share_failed');
    expect(api().state).not.toBe('thanks');
    expect(api().state).not.toBe('submitted');
  });

  test('share exception → share_failed', async () => {
    const { api, unmount } = await mountSurvey('throw');
    mounts.push(unmount);

    api().open();
    await waitForState(api, 'open');
    api().handleSelect('bad');
    await waitForState(api, 'transcript_prompt');
    api().handleTranscriptSelect('yes');
    await waitForState(api, 'share_failed');
  });

  test('FeedbackSurvey densable error copy for share_failed', async () => {
    // UI copy still asserted from source (presentational, no hook state)
    const src = await Bun.file(new URL('../FeedbackSurvey.tsx', import.meta.url)).text();
    expect(src).toContain("state === 'share_failed'");
    expect(src).toContain("Couldn't share the transcript");
    expect(src).toContain('You can share details with /feedback instead');
  });
});
