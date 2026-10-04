/**
 * densable 2.1.283 leftover `Yo` / `tn.initializeWorker` compositor BODY wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `Yo` @202433401 BODY 5407 B next `function An(`
 *   leftover `tn.initializeWorker` @202378433 BODY 1004 B
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  analyticsMock,
  pushAnalyticsLogEvent,
} from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

const debugLogs: string[] = []
const events: Array<{ name: string; props: Record<string, unknown> }> = []

mock.module('../../utils/debug.js', () => ({
  ...debugMock(),
  logForDebugging: (msg: string) => {
    debugLogs.push(msg)
  },
}))
mock.module('../../utils/debug.ts', () => ({
  ...debugMock(),
  logForDebugging: (msg: string) => {
    debugLogs.push(msg)
  },
}))
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())

const {
  applyHeadlessOpeningRequests,
  attachHeadlessCloudSession,
  attachStreamStandsFailedCopy,
  headlessWorkerInitializeReason,
  initializeHeadlessCloudWorker,
  isRetryableWorkerInitializePost,
  noteHeadlessUndeclaredDialog,
} = await import('../leftoverHeadlessAttach.js')
const { formatCloudSessionId } = await import('../cloudSession.js')
const { attachDirSyncElsewhereUnknownReason } = await import(
  '../leftoverCloudCopy.js'
)
const {
  cloudSessionDidNotAcceptOptionalCopy,
  cloudSessionDidNotAcceptRequiredCopy,
} = await import('../leftoverHeadlessCopy.js')

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

let restoreAnalytics: (() => void) | undefined
beforeEach(() => {
  restoreAnalytics = pushAnalyticsLogEvent((name, props) => {
    events.push({ name, props: props ?? {} })
  })
})
afterEach(() => {
  restoreAnalytics?.()
  restoreAnalytics = undefined
  debugLogs.length = 0
  events.length = 0
})

describe('leftoverHeadlessAttach 283 leftover Yo/tn compositor', () => {
  test('source-locks leftover Yo/tn BODY wrap; no minify public API', () => {
    const attach = src('../leftoverHeadlessAttach.ts')
    const worker = src('../leftoverHeadlessWorker.ts')
    const leftoverUnique = src('../leftoverUnique.ts')
    const leftoverCopy = src('../leftoverHeadlessCopy.ts')
    const session = src('../cloudSession.ts')
    expect(attach).toContain('leftover `Yo` @202433401 BODY 5407 B')
    expect(attach).toContain('function An(')
    expect(attach).toContain('attachHeadlessCloudSession')
    expect(attach).toContain('isLocalServeLinkAllowed')
    expect(attach).toContain('no_device_proof')
    expect(attach).toContain('attachDirSyncElsewhereUnknownReason')
    expect(attach).toContain('logHeadlessAttachPreflightFailed')
    expect(attach).toContain('logRemoteHeadlessFeatureBad')
    expect(attach).toContain('formatCloudSessionId')
    expect(attach).toContain('stream stands')
    expect(attach).toContain(
      '[headlessCloud] attach preflight failed (continuing via the stream)',
    )
    expect(attach).toContain('startAttachSync')
    expect(attach).toContain('attach_session_unreadable')
    expect(attach).toContain('attach_dir_sync_lookup_failed')
    expect(attach).toContain('attach_dir_sync_elsewhere_unknown')
    expect(attach).toContain('attach_refused')
    expect(attach).toContain('attach_archived')
    expect(attach).toContain('attach_stream_position')
    expect(attach).toContain("from './deviceBind.js'")
    expect(attach).toContain('eTn(')
    expect(attach).toContain('heldKey')
    expect(attach).toContain('eventSigner')
    expect(attach).not.toMatch(/^export (async )?function Yo\b/m)
    expect(attach).not.toMatch(/^export class tn\b/m)
    expect(attach).not.toContain('new WebSocket')
    expect(attach).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(attach).not.toContain('tengu_violin_amati')
    expect(attach).not.toContain('FOCUS_IN')
    expect(attach).not.toContain('settings.set')
    expect(worker).toContain('leftover `tn.initializeWorker` @202378433')
    expect(worker).toContain('logRemoteHeadlessClientWorkerInitialize')
    expect(worker).toContain('logHeadlessWorkerTookClientInitialize')
    expect(worker).toContain('logHeadlessClientInitializeNotAnswered')
    expect(worker).toContain('cloudSessionDidNotAcceptRequiredCopy')
    expect(worker).toContain('cloudSessionDidNotAcceptOptionalCopy')
    expect(worker).toContain('logHeadlessNotPassingUndeclaredDialog')
    expect(worker).toContain('cloudSessionWaitingUndeclaredDialogCopy')
    expect(worker).toContain('declare_dialog_kinds')
    expect(worker).toContain('rearm_parked_prompt')
    expect(worker).not.toMatch(/^export class tn\b/m)
    expect(worker).not.toMatch(/^export (async )?function tn\b/m)
    expect(leftoverCopy).toContain(
      '[headlessCloudClient] attach preflight failed',
    )
    expect(leftoverCopy).toContain('the worker took this client')
    expect(leftoverCopy).toContain('was not answered')
    expect(leftoverUnique).toContain('leftoverHeadlessAttach.ts')
    expect(leftoverUnique).toContain('leftoverHeadlessWorker.ts')
    expect(leftoverUnique).toContain('leftoverHeadlessClient.ts')
    expect(leftoverUnique).toContain(
      'tengu_remote_headless_client_worker_initialize',
    )
    expect(leftoverUnique).toContain("from './leftoverHeadlessAttach.js'")
    expect(session).toContain('class HeadlessCloudSdkHost')
    expect(session).toContain('{ done: new HeadlessCloudSdkHost')
    expect(session).toContain(
      '[headlessCloud] attach preflight failed (continuing via the stream)',
    )
    expect(session).toContain('startAttachSync')
    expect(session).toContain('logRemoteHeadlessClientWorkerInitialize')
  })

  test('1:1 leftover Yo elsewhere_unknown / stream-stands copies', async () => {
    expect(
      attachDirSyncElsewhereUnknownReason({ why: 'elsewhere_unknown' }),
    ).toBe('attach_dir_sync_elsewhere_unknown')
    expect(
      attachStreamStandsFailedCopy('cse_1', 'boom', formatCloudSessionId),
    ).toBe(
      `Error: could not read where cloud session ${formatCloudSessionId('cse_1')}'s stream stands (boom).`,
    )

    const elsewhere = await attachHeadlessCloudSession(
      { sessionId: 'cse_else' },
      {
        fetchSession: async () => ({ session_status: 'idle' }),
        attachDirSync: async () => ({
          handle: undefined,
          why: 'elsewhere_unknown',
        }),
        readStreamPosition: async () => 7,
      },
    )
    expect(elsewhere.kind).toBe('opened')
    expect(
      events.some(
        e =>
          e.name === 'tengu_feature_bad' &&
          e.props.error_code === 'attach_dir_sync_elsewhere_unknown',
      ),
    ).toBe(true)

    const unreadable = await attachHeadlessCloudSession(
      { sessionId: 'cse_unread' },
      {
        fetchSession: async () => {
          throw new Error('offline')
        },
        readStreamPosition: async () => 0,
      },
    )
    expect(unreadable.kind).toBe('opened')
    expect(
      debugLogs.some(l =>
        l.includes(
          '[headlessCloud] attach preflight failed (continuing via the stream)',
        ),
      ),
    ).toBe(true)
    expect(
      debugLogs.some(l =>
        l.includes('[headlessCloudClient] attach preflight failed:'),
      ),
    ).toBe(true)
    expect(
      events.some(
        e =>
          e.name === 'tengu_feature_bad' &&
          e.props.error_code === 'attach_session_unreadable',
      ),
    ).toBe(true)

    const { TeleportOperationError } = await import('../../utils/errors.js')
    const refusedOp = await attachHeadlessCloudSession(
      { sessionId: 'cse_refused_op' },
      {
        fetchSession: async () => {
          throw new TeleportOperationError('blocked', 'blocked')
        },
      },
    )
    expect(refusedOp).toMatchObject({
      kind: 'failed',
      reason: 'attach_refused',
    })
    expect(
      events.some(
        e =>
          e.name === 'tengu_feature_bad' &&
          e.props.error_code === 'attach_refused',
      ),
    ).toBe(true)

    const archived = await attachHeadlessCloudSession(
      { sessionId: 'cse_arch' },
      {
        fetchSession: async () => ({ session_status: 'archived' }),
      },
    )
    expect(archived).toMatchObject({
      kind: 'failed',
      reason: 'attach_archived',
    })
    expect(
      events.some(
        e =>
          e.name === 'tengu_feature_bad' &&
          e.props.error_code === 'attach_archived',
      ),
    ).toBe(true)

    const stream = await attachHeadlessCloudSession(
      { sessionId: 'cse_stream' },
      {
        fetchSession: async () => ({ session_status: 'idle' }),
        readStreamPosition: async () => {
          throw new Error('no cursor')
        },
      },
    )
    expect(stream).toMatchObject({
      kind: 'failed',
      reason: 'attach_stream_position',
    })
    expect(stream.kind === 'failed' && stream.message).toContain(
      'could not read where cloud session',
    )
    expect(stream.kind === 'failed' && stream.message).toContain(
      'stream stands',
    )
    expect(
      events.some(
        e =>
          e.name === 'tengu_feature_bad' &&
          e.props.error_code === 'attach_stream_position',
      ),
    ).toBe(true)

    const lookup = await attachHeadlessCloudSession(
      { sessionId: 'cse_lookup' },
      {
        fetchSession: async () => ({ session_status: 'idle' }),
        attachDirSync: async () => ({
          handle: undefined,
          why: 'lookup_failed',
        }),
        readStreamPosition: async () => 1,
      },
    )
    expect(lookup.kind).toBe('opened')
    expect(
      events.some(
        e =>
          e.name === 'tengu_feature_bad' &&
          e.props.error_code === 'attach_dir_sync_lookup_failed',
      ),
    ).toBe(true)
  })

  test('1:1 leftover tn did not accept / worker took initialize', async () => {
    expect(headlessWorkerInitializeReason({ entry: 'attach' }, [])).toBe(null)
    expect(
      headlessWorkerInitializeReason(
        { entry: 'attach', workerAwaitsAnswer: true },
        [],
      ),
    ).toBe('rearm_parked_prompt')
    expect(headlessWorkerInitializeReason({ entry: 'create' }, ['ask'])).toBe(
      'declare_dialog_kinds',
    )
    expect(
      isRetryableWorkerInitializePost({
        outcome: 'failed',
        cause: 'http',
        status: 503,
      }),
    ).toBe(true)

    let held: Promise<void> | undefined
    const accepted = initializeHeadlessCloudWorker(
      { entry: 'attach', workerAwaitsAnswer: true },
      {
        postControlRequest: () => ({
          posted: Promise.resolve({ outcome: 'accepted' }),
          response: Promise.resolve({}),
        }),
      },
      {
        hostDialogKinds: ['ask', 'cloud_sync_consent'],
        holdLaterSendsBehind: work => {
          held = work
        },
      },
    )
    expect(accepted).toBe('rearm_parked_prompt')
    await held
    expect(
      debugLogs.some(l =>
        l.includes(
          "[headlessCloudClient] the worker took this client's initialize (rearm_parked_prompt)",
        ),
      ),
    ).toBe(true)
    expect(
      events.some(
        e =>
          e.name === 'tengu_remote_headless_client_worker_initialize' &&
          e.props.reason === 'rearm_parked_prompt' &&
          e.props.outcome === 'accepted',
      ),
    ).toBe(true)

    debugLogs.length = 0
    events.length = 0
    let unansweredHeld: Promise<void> | undefined
    initializeHeadlessCloudWorker(
      { entry: 'attach', workerAwaitsAnswer: true },
      {
        postControlRequest: () => ({
          posted: Promise.resolve({ outcome: 'failed', cause: 'timeout' }),
          response: Promise.reject(new Error('silence')),
        }),
      },
      {
        holdLaterSendsBehind: work => {
          unansweredHeld = work
        },
      },
    )
    await unansweredHeld
    expect(
      debugLogs.some(l =>
        l.includes(
          "[headlessCloudClient] this client's initialize (rearm_parked_prompt) was not answered:",
        ),
      ),
    ).toBe(true)

    expect(cloudSessionDidNotAcceptRequiredCopy('tools')).toBe(
      'Error: the cloud session did not accept tools, so this attach was stopped rather than continue without it.',
    )
    expect(cloudSessionDidNotAcceptOptionalCopy('plugins')).toBe(
      'The cloud session did not accept plugins; it keeps its own.',
    )

    await expect(
      applyHeadlessOpeningRequests(
        [
          {
            request: { subtype: 'set_permission_mode' },
            required: true,
            describe: 'tools',
          },
        ],
        {
          sendControlRequest: async () => {
            throw new Error('nope')
          },
        },
      ),
    ).rejects.toThrow(
      'Error: the cloud session did not accept tools, so this attach was stopped rather than continue without it.',
    )

    const notices: string[] = []
    await applyHeadlessOpeningRequests(
      [
        {
          request: { subtype: 'announce_plugins' },
          required: false,
          describe: 'plugins',
        },
      ],
      {
        sendControlRequest: async () => {
          throw new Error('keep')
        },
        emitNotice: text => notices.push(text),
      },
    )
    expect(notices).toEqual([
      'The cloud session did not accept plugins; it keeps its own.',
    ])
    expect(
      debugLogs.some(l =>
        l.includes(
          '[headlessCloudClient] opening request announce_plugins failed:',
        ),
      ),
    ).toBe(true)

    const waiting = noteHeadlessUndeclaredDialog('ask')
    expect(waiting).toContain('did not declare it can show')
    expect(
      debugLogs.some(l =>
        l.includes(
          'not passing a ask dialog to the host: its initialize did not declare the kind',
        ),
      ),
    ).toBe(true)
  })
})
