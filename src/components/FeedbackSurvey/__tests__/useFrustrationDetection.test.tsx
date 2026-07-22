import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import * as React from 'react';
import * as realConfig from '../../../utils/config.js';
import { renderToString } from '../../../utils/staticRender.js';
import type { Message } from '../../../types/message.js';
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js';

let transcriptShareDismissed = false;
let productFeedbackAllowed = true;
const mockSubmitTranscriptShare = mock(async () => ({ success: true }));

// Snapshot BEFORE mock — thin config mock no-ops saveGlobalConfig for co-suites.
const configSnap = snapshotModuleExports(realConfig);
const realGetGlobalConfig = configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig;

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...realGetGlobalConfig(),
      transcriptShareDismissed,
    }),
    saveGlobalConfig: (
      updater: (current: { transcriptShareDismissed?: boolean }) => {
        transcriptShareDismissed?: boolean;
      },
    ) => {
      const next = updater({ transcriptShareDismissed });
      transcriptShareDismissed = next.transcriptShareDismissed ?? false;
    },
  };
}
mock.module('../../../utils/config.js', configMock);
mock.module('src/utils/config.js', configMock);
afterAll(() => {
  mock.module('../../../utils/config.js', () => ({ ...configSnap }));
  mock.module('src/utils/config.js', () => ({ ...configSnap }));
});
mock.module('../../../services/policyLimits/index.js', () => ({
  isPolicyAllowed: () => productFeedbackAllowed,
}));
mock.module('../submitTranscriptShare.js', () => ({
  submitTranscriptShare: mockSubmitTranscriptShare,
}));

const { useFrustrationDetection } = await import('../useFrustrationDetection.js');

type DetectionResult = ReturnType<typeof useFrustrationDetection>;

function apiError(uuid: string): Message {
  return {
    type: 'assistant',
    uuid: uuid as any,
    isApiErrorMessage: true,
    message: { role: 'assistant', content: [] },
  };
}

async function renderDetection(props: {
  messages: Message[];
  isLoading?: boolean;
  hasActivePrompt?: boolean;
  otherSurveyOpen?: boolean;
}): Promise<DetectionResult> {
  let result: DetectionResult | null = null;
  function Probe(): React.ReactNode {
    result = useFrustrationDetection(
      props.messages,
      props.isLoading ?? false,
      props.hasActivePrompt ?? false,
      props.otherSurveyOpen ?? false,
    );
    return null;
  }

  await renderToString(<Probe />);
  if (!result) {
    throw new Error('useFrustrationDetection did not render');
  }
  return result;
}

afterEach(() => {
  transcriptShareDismissed = false;
  productFeedbackAllowed = true;
  mockSubmitTranscriptShare.mockClear();
});

describe('useFrustrationDetection', () => {
  test('stays closed without frustration signals', async () => {
    const result = await renderDetection({ messages: [] });

    expect(result.state).toBe('closed');
    expect(typeof result.handleTranscriptSelect).toBe('function');
  });

  test('opens a transcript prompt for repeated API errors', async () => {
    const result = await renderDetection({
      messages: [apiError('a'), apiError('b')],
    });

    expect(result.state).toBe('transcript_prompt');
  });

  test('does not prompt while loading, prompting, blocked by another survey, dismissed, or policy-denied', async () => {
    const messages = [apiError('a'), apiError('b')];

    expect((await renderDetection({ messages, isLoading: true })).state).toBe('closed');
    expect((await renderDetection({ messages, hasActivePrompt: true })).state).toBe('closed');
    expect((await renderDetection({ messages, otherSurveyOpen: true })).state).toBe('closed');

    transcriptShareDismissed = true;
    expect((await renderDetection({ messages })).state).toBe('closed');

    transcriptShareDismissed = false;
    productFeedbackAllowed = false;
    expect((await renderDetection({ messages })).state).toBe('closed');
  });

  test('submits transcript share when the user accepts', async () => {
    const result = await renderDetection({
      messages: [apiError('a'), apiError('b')],
    });

    result.handleTranscriptSelect('yes');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockSubmitTranscriptShare).toHaveBeenCalledWith(
      [apiError('a'), apiError('b')],
      'frustration',
      expect.any(String),
    );
  });
});
