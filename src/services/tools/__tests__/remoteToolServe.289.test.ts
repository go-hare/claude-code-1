/**
 * densable 2.1.289 inbound serve leftover — gold `fqo`/`gqo`/`tr`/`Qo`/`cn`/`V`.
 * Print Host inbound of these subtypes stays reject.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { analyticsMock } from '../../../../tests/mocks/analytics.js'
import { mock } from 'bun:test'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/debug.js', debugMock)
mock.module('src/services/analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.ts', analyticsMock)

import {
  bindServedChannel,
  clipServedRequestId,
  createServingContext,
  dispatchServedChannelRequest,
  honourRemoteToolsReannounce,
  leftoverDirSyncPlumbingListed,
  leftoverQnServedTools,
  leftoverRunSessionToolCall,
  leftoverServedSendOpts,
  leftoverServedSessionPlumbing,
  leftoverServedToolsKit,
  leftoverServedToolResult,
  mintServedInstanceId,
  normalizeServedAttestationStatus,
  parseLeftoverSyncFilesArgs,
  parseRemoteServeEnvelope,
  SERVED_CHANNEL_TOOL_REPLY_TIMEOUT_MS,
  serveInboundSessionFrame,
  SERVED_TOOLS_UNAVAILABLE_FLAG_OFF,
  isRemoteToolsServedSubtype,
  parseRemotePlumbingCallRequest,
  parseRemoteToolCallRequest,
  REMOTE_SERVE_NOT_HERE,
  REMOTE_SERVE_REQUEST_ID_CAP,
  REMOTE_TOOL_CALL_INPUT_KEY,
  REMOTE_TOOLS_SERVED_SUBTYPES,
  remoteCommandUnattestedMessage,
  remoteToolNotServedOn,
  routeServedChannelRequest,
  servedChannelResultLimitBytes,
  servedErrorResult,
  UNSUPPORTED_CONTROL_REQUEST_SUBTYPE,
  wrapServedResultForChannel,
} from '../remoteToolServe.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

function toolCallBody(over: Record<string, unknown> = {}) {
  return {
    instance_id: 'desk-1',
    host: 'desk',
    name: 'Bash',
    input: { command: 'echo hi', [REMOTE_TOOL_CALL_INPUT_KEY]: { op: 'call' } },
    envelope: {
      v: 1,
      op: 'call',
      call_id: 'tu_1',
      caller: { kind: 'local_process' },
      expires_in_ms: 58000,
    },
    tool_use_id: 'tu_1',
    issued_at: 1,
    deadline_ms: 58000,
    ...over,
  }
}

describe('remoteToolServe 289 leftover wrap', () => {
  test('source-locks gold inbound serve; no minify public API; print inbound stays reject', () => {
    const body = src('../remoteToolServe.ts')
    expect(body).toContain('gold `Cle` @202407176')
    expect(body).toContain('gold `un` @206773509')
    expect(body).toContain('gold `fqo` @183229909')
    expect(body).toContain('gold `gqo` @183230623')
    expect(body).toContain('gold `tr` @206816057')
    expect(body).toContain('gold `Qo` @206814317')
    expect(body).toContain('gold `xn` @206813815')
    expect(body).toContain('gold `cn` @206773650')
    expect(body).toContain('gold `gte` @205776140')
    expect(body).toContain('gold `qoe` @183231639')
    expect(body).toContain('gold `r2e` @185491704')
    expect(body).toContain('gold `er` @206815531')
    expect(body).toContain('leftover `servedSessionPlumbing` @207176929')
    expect(body).toContain('gold `Be` @206773533')
    expect(body).toContain('gold ye deliver @206726603')
    expect(body).toContain('leftover `Mre` @185930444')
    expect(body).not.toMatch(/^export function Mre\b/m)
    expect(body).toContain('Do not add a print `case "remote_tool_call"`')
    expect(body).not.toMatch(/^export function fqo\b/m)
    expect(body).not.toMatch(/^export function gqo\b/m)
    expect(body).not.toMatch(/^export async function tr\b/m)
    expect(body).not.toMatch(/^export function Qo\b/m)
    expect(body).not.toMatch(/^export function qoe\b/m)
    expect(body).not.toMatch(/^export function r2e\b/m)
    expect(body).not.toMatch(/^export function er\b/m)
    expect(body).not.toMatch(/^export function Be\b/m)
    expect(body).not.toMatch(/^export function nr\b/m)
    expect(REMOTE_TOOLS_SERVED_SUBTYPES).toEqual([
      'remote_tool_call',
      'remote_plumbing_call',
      'remote_tools_probe',
      'remote_tools_reannounce',
    ])
    const extras = src('../../../cli/printControlExtras.ts')
    expect(extras).not.toContain("subtype === 'remote_tool_call'")
    const print = src('../../../cli/print.ts')
    expect(print).not.toContain("case 'remote_tool_call'")
    const cloud = src('../../../cli/cloudSession.ts')
    expect(cloud).toContain('is agent-originated and cannot be sent by a host')
  })

  test('ye unwraps payload wrapper into extras bag', () => {
    const sentAt = Date.parse('2026-01-01T00:00:00.000Z')
    const now = sentAt + 2500
    const { message, extras } = serveInboundSessionFrame(
      {
        payload: {
          type: 'control_request',
          request_id: 'r1',
          request: { subtype: 'remote_tool_call' },
          remote_tool_gate: 'caller_reauthored',
        },
        source: 'worker',
        created_at: '2026-01-01T00:00:00.000Z',
        device_attestation_status: 'VERIFIED',
      },
      { connectedSince: sentAt + 1000, now },
    )
    expect(message).toMatchObject({
      type: 'control_request',
      request_id: 'r1',
    })
    expect(extras).toMatchObject({
      source: 'worker',
      ageMs: 2500,
      replayed: true,
      attestationStatus: 'VERIFIED',
      modeStamp: 'present',
    })
    const bare = serveInboundSessionFrame(
      {
        type: 'control_request',
        request_id: 'r2',
        request: { subtype: 'interrupt' },
      },
      { connectedSince: 0, now: 1 },
    )
    expect(bare.message).toMatchObject({
      type: 'control_request',
      request_id: 'r2',
    })
    expect(bare.extras).toEqual({})
  })

  test('un matches Cle', () => {
    expect(isRemoteToolsServedSubtype('remote_tool_call')).toBe(true)
    expect(isRemoteToolsServedSubtype('can_use_tool')).toBe(false)
  })

  test('fqo strips __remote_tool_call and rejects call_id !== tool_use_id', () => {
    const parsed = parseRemoteToolCallRequest(toolCallBody())
    expect(parsed?.name).toBe('Bash')
    expect(parsed?.input).toEqual({ command: 'echo hi' })
    expect(parsed?.request).toEqual({
      ok: true,
      kind: 'call',
      value: { call_id: 'tu_1', approval: undefined },
    })
    const mismatched = parseRemoteToolCallRequest(
      toolCallBody({
        envelope: { v: 1, op: 'call', call_id: 'other' },
      }),
    )
    expect(mismatched?.request).toEqual({ ok: false, why: 'malformed' })
    expect(parseRemoteToolCallRequest({ instance_id: 'x' })).toBeUndefined()
    expect(
      parseRemoteServeEnvelope({ v: 1, op: 'call', call_id: 'tu_1' }),
    ).toEqual({ ok: false, why: 'malformed' })
    expect(leftoverQnServedTools({ woodOn: false, kit: { epoch: 1 } })).toEqual(
      { servedToolsUnavailable: SERVED_TOOLS_UNAVAILABLE_FLAG_OFF },
    )
  })

  test('leftover runSessionToolCall answers _ho for an unknown tool', async () => {
    const result = await leftoverRunSessionToolCall(
      {
        instance_id: 'desk-1',
        host: 'desk',
        name: 'NoSuchTool',
        input: {},
        tool_use_id: 'tu_1',
        issued_at: 1,
        deadline_ms: 58000,
        request: { ok: false, why: 'missing' },
      },
      new AbortController().signal,
    )
    const message = 'NoSuchTool is not served on desk.'
    expect(result).toMatchObject(
      leftoverServedToolResult({
        envelope: {
          outcome: 'refused',
          call_id: 'tu_1',
          target: { name: 'desk', working_dir: '' },
          code: 'not_served',
          message,
        },
        content: [{ type: 'text', text: message }],
      }),
    )
    expect(leftoverServedToolsKit().runSessionToolCall).toBe(
      leftoverRunSessionToolCall,
    )
    expect(leftoverServedToolsKit().plumbing?.names()).toEqual(['sync_files'])
  })

  test('r2e / qoe / Be / nr leftover wrap', () => {
    expect(normalizeServedAttestationStatus('server_authored')).toBe(
      'SERVER_AUTHORED',
    )
    expect(normalizeServedAttestationStatus('VERIFIED')).toBe('VERIFIED')
    expect(normalizeServedAttestationStatus('nope')).toBe('UNSPECIFIED')
    expect(leftoverServedSendOpts('tool')).toEqual({
      timeoutMs: SERVED_CHANNEL_TOOL_REPLY_TIMEOUT_MS,
    })
    expect(leftoverServedSendOpts(null)).toEqual({})
    expect(mintServedInstanceId().startsWith('cc-')).toBe(true)
    const wrapped = leftoverServedToolResult({
      envelope: {
        outcome: 'completed',
        call_id: 'tu_1',
        target: { name: 'desk', working_dir: '' },
      },
      content: 'hi',
    })
    expect(wrapped.isError).toBe(false)
    expect(wrapped.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(
      wrapped.structuredContent['anthropic/remoteToolExecution'],
    ).toMatchObject({ outcome: 'completed', call_id: 'tu_1' })
  })

  test('Lt r2e maps server_authored on ye unwrap', () => {
    const { extras } = serveInboundSessionFrame(
      {
        payload: {
          type: 'control_request',
          request_id: 'r1',
          request: { subtype: 'remote_tool_call' },
        },
        source: 'worker',
        created_at: '2026-01-01T00:00:00.000Z',
        device_attestation_status: 'server_authored',
      },
      { connectedSince: 0, now: Date.parse('2026-01-01T00:00:01.000Z') },
    )
    expect(extras.attestationStatus).toBe('SERVER_AUTHORED')
    const host = serveInboundSessionFrame(
      {
        payload: {
          type: 'control_request',
          request_id: 'r2',
          request: { subtype: 'remote_tool_call' },
          remote_tool_gate: 'caller_reauthored',
        },
        source: 'host',
        created_at: '2026-01-01T00:00:00.000Z',
        device_attestation_status: 'server_authored',
      },
      { connectedSince: 0, now: Date.parse('2026-01-01T00:00:01.000Z') },
    )
    expect(host.extras.attestationStatus).toBeUndefined()
    expect(host.extras.modeStamp).toBeUndefined()
    expect(host.extras.source).toBe('host')
  })

  test('leftover sync_files plumbing refuses no_engine / unknown_job', async () => {
    expect(parseLeftoverSyncFilesArgs({ up_to: 3, upload: true })).toEqual({
      upTo: 3,
      upload: true,
      waitMs: 15_000,
    })
    const plumbing = leftoverServedSessionPlumbing()
    const none = await plumbing.serve(
      {
        instance_id: 'desk-1',
        host: 'desk',
        name: 'sync_files',
        args: {},
        issued_at: 1,
        deadline_ms: 5000,
      },
      new AbortController().signal,
    )
    expect(none.result).toMatchObject({
      isError: true,
      structuredContent: { state: 'refused', reason: 'no_engine' },
    })
    const job = await plumbing.serve(
      {
        instance_id: 'desk-1',
        host: 'desk',
        name: 'sync_files',
        args: { job: 'job-1' },
        issued_at: 1,
        deadline_ms: 5000,
      },
      new AbortController().signal,
    )
    expect(job.result).toMatchObject({
      structuredContent: { state: 'refused', reason: 'unknown_job' },
    })
    expect(leftoverDirSyncPlumbingListed()).toBe(true)
    expect(plumbing.names()).toEqual(['sync_files'])
    const prev = process.env.CLAUDE_CODE_DIR_SYNC_ENGINE
    process.env.CLAUDE_CODE_DIR_SYNC_ENGINE = 'off'
    try {
      expect(leftoverDirSyncPlumbingListed()).toBe(false)
      expect(leftoverServedSessionPlumbing().names()).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_DIR_SYNC_ENGINE
      else process.env.CLAUDE_CODE_DIR_SYNC_ENGINE = prev
    }
  })

  test('gqo requires a stripped non-empty name', () => {
    const parsed = parseRemotePlumbingCallRequest({
      instance_id: 'desk-1',
      host: 'desk',
      name: 'sync_files',
      args: { paths: ['a'] },
      issued_at: 1,
      deadline_ms: 5000,
    })
    expect(parsed?.name).toBe('sync_files')
    expect(
      parseRemotePlumbingCallRequest({
        instance_id: 'desk-1',
        host: 'desk',
        name: '',
        args: {},
        issued_at: 1,
        deadline_ms: 5000,
      }),
    ).toBeUndefined()
  })

  test('tr probe answers only this instance; reannounce is empty', async () => {
    const serving = createServingContext({ instanceId: 'desk-1', epoch: 7 })
    const probe = await routeServedChannelRequest(
      {
        requestId: 'r1',
        subtype: 'remote_tools_probe',
        request: { instance_id: 'desk-1' },
        signal: new AbortController().signal,
      },
      serving,
    )
    expect(probe).toEqual({ result: { epoch: 7 } })
    const miss = await routeServedChannelRequest(
      {
        requestId: 'r2',
        subtype: 'remote_tools_probe',
        request: { instance_id: 'other' },
        signal: new AbortController().signal,
      },
      serving,
    )
    expect(miss).toBeUndefined()
    const reannounce = await routeServedChannelRequest(
      {
        requestId: 'r3',
        subtype: 'remote_tools_reannounce',
        request: { worker_epoch: 1, deadline_ms: 1000 },
        signal: new AbortController().signal,
      },
      serving,
    )
    expect(reannounce).toBeUndefined()
  })

  test('Qo nothing serving releases the id', async () => {
    const released: string[] = []
    await dispatchServedChannelRequest(
      {
        requestId: 'r-none',
        subtype: 'remote_tool_call',
        request: {},
        signal: new AbortController().signal,
      },
      () => null,
      () => ({
        respondToServedChannelRequest: () => false,
        releaseServedChannelRequest: id => {
          released.push(id)
        },
      }),
    )
    expect(released).toEqual(['r-none'])
  })

  test('plumbing not listed is not served here; undated is stale unanswered', async () => {
    const serving = createServingContext({
      instanceId: 'desk-1',
      plumbing: {
        names: () => ['sync_files'],
        serve: async () => ({ result: { ok: true } }),
      },
    })
    const notHere = await routeServedChannelRequest(
      {
        requestId: 'p1',
        subtype: 'remote_plumbing_call',
        request: {
          instance_id: 'desk-1',
          host: 'desk',
          name: 'other',
          args: {},
          issued_at: 1,
          deadline_ms: 5000,
        },
        signal: new AbortController().signal,
        ageMs: 10,
      },
      serving,
    )
    expect(notHere).toEqual({
      result: servedErrorResult(`other: ${REMOTE_SERVE_NOT_HERE}`),
    })
    const stale = await routeServedChannelRequest(
      {
        requestId: 'p2',
        subtype: 'remote_plumbing_call',
        request: {
          instance_id: 'desk-1',
          host: 'desk',
          name: 'sync_files',
          args: {},
          issued_at: 1,
          deadline_ms: 5000,
        },
        signal: new AbortController().signal,
      },
      serving,
    )
    expect(stale).toBeUndefined()
  })

  test('below-floor plumbing uses Aqe leftover copy', async () => {
    const serving = createServingContext({
      instanceId: 'desk-1',
      targetName: 'desk',
      plumbing: {
        names: () => ['sync_files'],
        serve: async () => ({ result: { ok: true } }),
      },
    })
    const held = await routeServedChannelRequest(
      {
        requestId: 'p3',
        subtype: 'remote_plumbing_call',
        request: {
          instance_id: 'desk-1',
          host: 'desk',
          name: 'sync_files',
          args: {},
          issued_at: 1,
          deadline_ms: 5000,
        },
        signal: new AbortController().signal,
        ageMs: 10,
        attestationStatus: 'BELOW_FLOOR',
      },
      serving,
    )
    const message = remoteCommandUnattestedMessage({
      status: 'BELOW_FLOOR',
      subtype: 'remote_plumbing_call',
      targetName: 'desk',
    })
    expect(held).toEqual({
      result: servedErrorResult(`sync_files: ${message}`),
    })
    expect(message).toContain('Nothing was done for it on desk')
    expect(message).toContain('tell the user instead of retrying')
  })

  test('V reannounce honour gate', () => {
    const req = {
      requestId: 'ra',
      subtype: 'remote_tools_reannounce' as const,
      request: {
        subtype: 'remote_tools_reannounce',
        worker_epoch: 3,
        deadline_ms: 1000,
      },
      signal: new AbortController().signal,
      ageMs: 10,
    }
    expect(honourRemoteToolsReannounce(req).honour).toBe(true)
    expect(
      honourRemoteToolsReannounce({ ...req, ageMs: undefined }).honour,
    ).toBe(false)
    expect(
      honourRemoteToolsReannounce(req, { newestWorkerEpoch: 4 }).honour,
    ).toBe(false)
    expect(
      honourRemoteToolsReannounce(req, {
        lastHonoured: { epoch: 3, at: Date.now() },
      }).honour,
    ).toBe(false)
  })

  test('cn wraps an oversize answer; kv clips', () => {
    const limit = servedChannelResultLimitBytes()
    expect(wrapServedResultForChannel({ result: { ok: true } })).toEqual({
      result: { ok: true },
    })
    const huge = wrapServedResultForChannel(
      { result: { text: 'x'.repeat(limit) } },
      100,
    ) as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(huge.result.isError).toBe(true)
    expect(huge.result.content[0]?.text).toContain(
      'the result was too large to return',
    )
    expect(clipServedRequestId('a'.repeat(90))).toContain('(+10)')
    expect(UNSUPPORTED_CONTROL_REQUEST_SUBTYPE).toBe(
      'Unsupported control request subtype',
    )
    expect(remoteToolNotServedOn('Bash', 'desk')).toBe(
      'Bash is not served on desk.',
    )
    expect(REMOTE_SERVE_REQUEST_ID_CAP).toBe(256)
  })

  test('wAt leftover binds xn and intercepts V reannounce', () => {
    expect(
      bindServedChannel({
        sessionId: 's1',
        manager: () => undefined,
        viewerOnly: true,
        servedTools: {},
      }),
    ).toBeNull()
    expect(
      bindServedChannel({
        sessionId: 's1',
        manager: () => undefined,
        woodOn: false,
        servedTools: {},
      }),
    ).toBeNull()
    expect(
      bindServedChannel({
        sessionId: 's1',
        manager: () => undefined,
        woodOn: true,
      }),
    ).toBeNull()
    expect(
      bindServedChannel({
        sessionId: 's1',
        manager: () => undefined,
        woodOn: true,
        servedTools: {},
        bound: false,
      }),
    ).toBeNull()
    const released: string[] = []
    const honoured: number[] = []
    const bound = bindServedChannel({
      sessionId: 's1',
      manager: () => ({
        respondToServedChannelRequest: () => false,
        releaseServedChannelRequest: id => {
          released.push(id)
        },
      }),
      serving: createServingContext({
        instanceId: 'desk-1',
        epoch: 9,
      }),
      servedTools: {},
      onReannounceHonoured: epoch => {
        honoured.push(epoch)
      },
    })
    expect(bound?.instanceId).toBe('desk-1')
    bound?.callbacks.onServedChannelRequest({
      requestId: 'ra1',
      subtype: 'remote_tools_reannounce',
      request: {
        subtype: 'remote_tools_reannounce',
        worker_epoch: 3,
        deadline_ms: 1000,
      },
      signal: new AbortController().signal,
      ageMs: 10,
    })
    expect(released).toEqual(['ra1'])
    expect(honoured).toEqual([3])
    bound?.close()
  })
})
