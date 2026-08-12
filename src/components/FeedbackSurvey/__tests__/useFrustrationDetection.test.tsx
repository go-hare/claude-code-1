import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import * as React from 'react';
import { PassThrough } from 'stream';
import { Text, wrappedRender as render } from '@anthropic/ink';
import * as realConfig from '../../../utils/config.js';
import { renderToString } from '../../../utils/staticRender.js';
import type { Message } from '../../../types/message.js';
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js';

let transcriptShareDismissed = false;
let productFeedbackAllowed = true;
const policyKeys: string[] = [];
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
  isPolicyAllowed: (policy: string) => {
    policyKeys.push(policy);
    return productFeedbackAllowed;
  },
}));
mock.module('../submitTranscriptShare.js', () => ({
  submitTranscriptShare: mockSubmitTranscriptShare,
}));

const { useFrustrationDetection } = await import('../useFrustrationDetection.js');

type DetectionResult = ReturnType<typeof useFrustrationDetection>;

function apiError(uuid: string): Message {
  return {
    type: 'assistant',
    uuid: uuid as never,
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

type LiveApi = DetectionResult;

async function mountLive(
  messages: Message[],
  share: () => Promise<{ success: boolean }>,
): Promise<{ api: () => LiveApi; unmount: () => void }> {
  mockSubmitTranscriptShare.mockImplementation(share);
  let latest: LiveApi | null = null;

  function Probe(): React.ReactNode {
    const r = useFrustrationDetection(messages, false, false, false);
    latest = r;
    return <Text>{r.state}</Text>;
  }

  const stream = new PassThrough();
  const instance = await render(<Probe />, {
    stdout: stream as unknown as NodeJS.WriteStream,
    patchConsole: false,
  });
  await new Promise(r => setTimeout(r, 20));
  if (!latest) {
    instance.unmount();
    throw new Error('did not mount');
  }
  return {
    api: () => {
      if (!latest) throw new Error('unmounted');
      return latest;
    },
    unmount: () => instance.unmount(),
  };
}

async function waitForState(api: () => LiveApi, expected: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (api().state === expected) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for state=${expected}, last=${api().state}`);
}

afterEach(() => {
  transcriptShareDismissed = false;
  productFeedbackAllowed = true;
  policyKeys.length = 0;
  mockSubmitTranscriptShare.mockClear();
  mockSubmitTranscriptShare.mockImplementation(async () => ({ success: true }));
});

describe('useFrustrationDetection', () => {
  const mounts: Array<() => void> = [];
  afterEach(() => {
    while (mounts.length) mounts.pop()?.();
  });

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

  test('gates on densable allow_product_feedback policy key', async () => {
    await renderDetection({ messages: [apiError('a'), apiError('b')] });
    expect(policyKeys).toContain('allow_product_feedback');
    expect(policyKeys).not.toContain('product_feedback');
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

  test('share success → submitted (not thanks)', async () => {
    const messages = [apiError('a'), apiError('b')];
    const { api, unmount } = await mountLive(messages, async () => ({
      success: true,
    }));
    mounts.push(unmount);

    expect(api().state).toBe('transcript_prompt');
    api().handleTranscriptSelect('yes');
    await waitForState(api, 'submitted');
    expect(mockSubmitTranscriptShare).toHaveBeenCalledWith(messages, 'frustration', expect.any(String));
  });

  test('share failure → share_failed (densable #16)', async () => {
    const messages = [apiError('a'), apiError('b')];
    const { api, unmount } = await mountLive(messages, async () => ({
      success: false,
    }));
    mounts.push(unmount);

    api().handleTranscriptSelect('yes');
    await waitForState(api, 'share_failed');
    expect(api().state).not.toBe('submitted');
  });

  test('share exception → share_failed', async () => {
    const messages = [apiError('a'), apiError('b')];
    const { api, unmount } = await mountLive(messages, async () => {
      throw new Error('network');
    });
    mounts.push(unmount);

    api().handleTranscriptSelect('yes');
    await waitForState(api, 'share_failed');
  });

  test('shouldSkip does not mask share_failed / submitted terminal states (densable #16)', async () => {
    const messages = [apiError('a'), apiError('b')];
    let resolveShare: (v: { success: boolean }) => void = () => {};
    const sharePromise = new Promise<{ success: boolean }>(resolve => {
      resolveShare = resolve;
    });

    let latest: LiveApi | null = null;
    const api = (): LiveApi => {
      if (!latest) throw new Error('unmounted');
      return latest;
    };
    let isLoading = false;
    function Probe(): React.ReactNode {
      const r = useFrustrationDetection(messages, isLoading, false, false);
      latest = r;
      return <Text>{r.state}</Text>;
    }
    const stream = new PassThrough();
    const instance = await render(<Probe />, {
      stdout: stream as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    mounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 20));
    if (!latest) throw new Error('did not mount');

    mockSubmitTranscriptShare.mockImplementation(() => sharePromise);
    api().handleTranscriptSelect('yes');
    await waitForState(api, 'submitting');

    // Mid-submit: loading flips on — terminal/submitting must stay visible
    isLoading = true;
    instance.rerender(<Probe />);
    await new Promise(r => setTimeout(r, 20));
    expect(api().state).toBe('submitting');

    resolveShare({ success: false });
    await waitForState(api, 'share_failed');
    expect(api().state).toBe('share_failed');
  });
});
