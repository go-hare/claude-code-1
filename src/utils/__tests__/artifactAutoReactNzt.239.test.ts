/**
 * densable Artifact reply/live-edit + qPw/aDw/lDw compose/edit helpers.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  applyHtmlPatches,
  parseEditDecision,
  resetArtifactAutoReactStoreForTests,
  resetNztRunnerForTests,
  Ttn,
  setNztRunner,
} from '../../services/artifactAutoReact/index.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetNztRunnerForTests()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ar =
    require('../../services/artifactAutoReact/index.js') as typeof import('../../services/artifactAutoReact/index.js')
  ar.resetArtifactLiveEditVfForTests()
})

describe('DTm applyHtmlPatches', () => {
  test('applies sequential unique finds', () => {
    const r = applyHtmlPatches('<h1>a</h1><p>b</p>', [
      { find: '<h1>a</h1>', replace: '<h1>A</h1>' },
      { find: '<p>b</p>', replace: '<p>B</p>' },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toBe('<h1>A</h1><p>B</p>')
  })

  test('rejects ambiguous find', () => {
    const r = applyHtmlPatches('<p>x</p><p>x</p>', [
      { find: '<p>x</p>', replace: '<p>y</p>' },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('ambiguous')
  })
})

describe('sDw parseEditDecision', () => {
  test('parses reply / patch / rewrite', () => {
    expect(parseEditDecision('{"action":"reply","text":"ok"}')).toEqual({
      kind: 'reply',
      text: 'ok',
    })
    expect(
      parseEditDecision(
        'here\n{"action":"edit","edits":[{"find":"a","replace":"b"}],"reply":"done"}',
      ),
    ).toEqual({
      kind: 'patch',
      edits: [{ find: 'a', replace: 'b' }],
      reply: 'done',
    })
    expect(
      parseEditDecision(
        '{"action":"edit","content":"<html/>","reply":"rewrote"}',
      ),
    ).toEqual({
      kind: 'rewrite',
      content: '<html/>',
      reply: 'rewrote',
    })
  })
})

describe('ArtifactTool action:reply via Ttn/nzt', () => {
  test('default path yields posted when tool returns replied', async () => {
    setNztRunner(async function* (toolUse) {
      expect(toolUse.input.action).toBe('reply')
      expect(toolUse.name).toBe('Artifact')
      yield {
        message: {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: 'ok',
              },
            ],
          },
          toolUseResult: {
            replied: true,
            thread_id: 'th',
            comment_id: 'c9',
          },
        },
      }
    })
    const r = await Ttn({
      url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      slug: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      threadId: 'th',
      text: 'hi',
      signal: new AbortController().signal,
    })
    expect(r.kind).toBe('posted')
    if (r.kind === 'posted') expect(r.commentId).toBe('c9')
  })
})

describe('ArtifactTool.call reply', () => {
  test('action reply posts via control plane', async () => {
    const authMock = {
      getClaudeAIOAuthTokens: mock(() => ({ accessToken: 'tok' })),
    }
    mock.module('src/utils/auth.js', () => authMock)
    mock.module('../../utils/auth.js', () => authMock)

    const prevFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 'cid-1', thread_id: 'th1' }), {
        status: 201,
      })) as unknown as typeof fetch

    try {
      const { ArtifactTool } = await import(
        '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
      )
      const result = await ArtifactTool.call({
        action: 'reply',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        thread_id: 'th1',
        text: 'hello from tool',
      })
      // Tip upload opens the tool; official REST stays ASe-gated.
      expect(result.data.replied).toBeUndefined()
      expect(result.data.error).toContain('cobalt registration is closed')
    } finally {
      globalThis.fetch = prevFetch
    }
  })
})

describe('B3i / KPw numbered ack list', () => {
  test('FAST_ACK_OPTIONS matches densable B3i (curly apostrophes + edit flags)', async () => {
    const { FAST_ACK_OPTIONS, FAST_ACK_TEXT } = await import(
      '../../services/artifactAutoReact/index.js'
    )
    expect(FAST_ACK_OPTIONS).toHaveLength(7)
    expect(FAST_ACK_OPTIONS[0]?.text).toBe(FAST_ACK_TEXT)
    expect(FAST_ACK_OPTIONS[0]?.edit).toBe(false)
    expect(FAST_ACK_OPTIONS[1]?.edit).toBe(true)
    expect(FAST_ACK_OPTIONS[1]?.text).toContain('\u2019')
    expect(FAST_ACK_OPTIONS[1]?.text).toBe(
      'I\u2019m making this change to the Artifact now. I\u2019ll reply here when it\u2019s done.',
    )
    expect(FAST_ACK_OPTIONS[6]?.edit).toBe(true)
  })
})

describe('vf live-edit permission module', () => {
  test('without vf bind, live-edit is not available in this build', async () => {
    const {
      resetArtifactLiveEditVfForTests,
      getArtifactLiveEditVf,
      checkLiveEditPermissions,
      planConsentMustDeny,
      getToolPermissionContextFromToolUse,
      setArtifactLiveEditVf,
      artifactLiveEditVf,
    } = await import('../../services/artifactAutoReact/index.js')
    resetArtifactLiveEditVfForTests()
    expect(getArtifactLiveEditVf()).toBeNull()

    const { ArtifactTool } = await import(
      '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
    )
    const denied = await ArtifactTool.checkPermissions!(
      {
        action: 'live-edit',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        html: '<html/>',
      },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'default' },
        }),
      } as never,
    )
    expect(denied.behavior).toBe('deny')
    if (denied.behavior === 'deny') {
      expect(denied.message).toContain('cobalt registration is closed')
    }

    setArtifactLiveEditVf(artifactLiveEditVf)
    const planDeny = await checkLiveEditPermissions(
      {
        action: 'live-edit',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        html: '<html/>',
      },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'plan' },
        }),
      },
      {
        planConsentMustDeny,
        getToolPermissionContext: getToolPermissionContextFromToolUse,
      },
    )
    expect(planDeny.behavior).toBe('deny')

    const acceptEditsAsk = await checkLiveEditPermissions(
      {
        action: 'live-edit',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        html: '<html/>',
      },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'acceptEdits' },
        }),
      },
      {
        planConsentMustDeny,
        getToolPermissionContext: getToolPermissionContextFromToolUse,
      },
    )
    expect(acceptEditsAsk.behavior).toBe('ask')
    if (acceptEditsAsk.behavior === 'ask') {
      expect(acceptEditsAsk.suppressAlwaysAllowRule).toBe(true)
    }

    const bypassAllow = await checkLiveEditPermissions(
      {
        action: 'live-edit',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        html: '<html/>',
      },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'bypassPermissions' },
        }),
      },
      {
        planConsentMustDeny,
        getToolPermissionContext: getToolPermissionContextFromToolUse,
      },
    )
    expect(bypassAllow.behavior).toBe('allow')

    const dontAskAsk = await checkLiveEditPermissions(
      {
        action: 'live-edit',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        html: '<html/>',
      },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'dontAsk' },
        }),
      },
      {
        planConsentMustDeny,
        getToolPermissionContext: getToolPermissionContextFromToolUse,
      },
    )
    expect(dontAskAsk.behavior).toBe('ask')
    resetArtifactLiveEditVfForTests()
  })
})

describe('ASe cobalt registration gate', () => {
  test('isArtifactToolRegistered stays false without tengu_cobalt_plinth', async () => {
    const { isArtifactToolRegistered, ASe } = await import('../artifactUrl.js')
    expect(isArtifactToolRegistered()).toBe(false)
    expect(ASe()).toBe(false)
  })

  test('ArtifactTool.isEnabled opens tip upload by default (hardcoded host)', async () => {
    const { ArtifactTool } = await import(
      '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
    )
    const prevUrl = process.env.CLAUDE_ARTIFACTS_URL
    const prevTok = process.env.CLAUDE_ARTIFACTS_TOKEN
    const prevArt = process.env.CLAUDE_CODE_ARTIFACT
    const prevDisable = process.env.CLAUDE_CODE_DISABLE_ARTIFACT
    delete process.env.CLAUDE_ARTIFACTS_URL
    delete process.env.CLAUDE_ARTIFACTS_TOKEN
    delete process.env.CLAUDE_CODE_ARTIFACT
    delete process.env.CLAUDE_CODE_DISABLE_ARTIFACT
    expect(ArtifactTool.isEnabled()).toBe(true)
    process.env.CLAUDE_CODE_DISABLE_ARTIFACT = '1'
    expect(ArtifactTool.isEnabled()).toBe(false)
    if (prevUrl === undefined) delete process.env.CLAUDE_ARTIFACTS_URL
    else process.env.CLAUDE_ARTIFACTS_URL = prevUrl
    if (prevTok === undefined) delete process.env.CLAUDE_ARTIFACTS_TOKEN
    else process.env.CLAUDE_ARTIFACTS_TOKEN = prevTok
    if (prevArt === undefined) delete process.env.CLAUDE_CODE_ARTIFACT
    else process.env.CLAUDE_CODE_ARTIFACT = prevArt
    if (prevDisable === undefined)
      delete process.env.CLAUDE_CODE_DISABLE_ARTIFACT
    else process.env.CLAUDE_CODE_DISABLE_ARTIFACT = prevDisable
  })
})

describe('Artifact permissions tree (hosted actions)', () => {
  test('list allow / resolve plan deny / reply ask', async () => {
    const { checkArtifactActionPermissions } = await import(
      '@claude-code/builtin-tools/tools/ArtifactTool/permissions.js'
    )
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
      }),
    }
    const list = await checkArtifactActionPermissions(
      { action: 'list' },
      ctx as never,
    )
    expect(list.behavior).toBe('allow')

    const reply = await checkArtifactActionPermissions(
      {
        action: 'reply',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        text: 'hi',
      },
      ctx as never,
    )
    expect(reply.behavior).toBe('ask')

    const planCtx = {
      abortController: new AbortController(),
      getAppState: () => ({
        toolPermissionContext: { mode: 'plan' },
      }),
    }
    const resolve = await checkArtifactActionPermissions(
      {
        action: 'resolve',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      },
      planCtx as never,
    )
    expect(resolve.behavior).toBe('deny')

    const resolveAsk = await checkArtifactActionPermissions(
      {
        action: 'resolve',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      },
      ctx as never,
    )
    expect(resolveAsk.behavior).toBe('ask')

    const dontAskCtx = {
      abortController: new AbortController(),
      getAppState: () => ({
        toolPermissionContext: { mode: 'dontAsk' },
      }),
    }
    const resolveDontAsk = await checkArtifactActionPermissions(
      {
        action: 'resolve',
        url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      },
      dontAskCtx as never,
    )
    expect(resolveDontAsk.behavior).toBe('ask')

    const { ArtifactTool } = await import(
      '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
    )
    const aseDeny = await ArtifactTool.checkPermissions!(
      { action: 'list' },
      ctx as never,
    )
    expect(aseDeny.behavior).toBe('deny')
    if (aseDeny.behavior === 'deny') {
      expect(aseDeny.message).toContain('cobalt registration is closed')
    }
  })
})
