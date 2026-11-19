import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setCwdState } from '../../../bootstrap/state.js'
import { getCwd } from '../../../utils/cwd.js'
import {
  checkRememberedDbUndeclared,
  clearDbUndeclared,
  executeArtifactDbAction,
  formatArtifactDbError,
  getArtifactDbRowMarkerPath,
  rememberDbUndeclared,
  saveArtifactDbRowWithMarker,
} from '../artifactDb.js'
import { resetArtifactAutoReactStoreForTests } from '../store.js'
import {
  formatLaterReportRefusedNotice,
  formatSubagentSafeguardsGuidance,
  parseHandbackBodyParts,
} from '../../../../packages/builtin-tools/src/tools/AgentTool/agentToolUtils.js'
import { parseClaudeAiShareUrl } from '../../../../packages/builtin-tools/src/tools/WebFetchTool/WebFetchTool.js'
import { capMcpResourceListing } from '../../../../packages/builtin-tools/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import {
  installStoppedByPerson,
  isAgentStoppedByPerson,
  resetStoppedByPersonForTests,
} from '../../../utils/sessionHost.js'
import { normalizeWatchCwdPath } from '../../../utils/hooks/fileChangedWatcher.js'
import {
  ASK_USER_QUESTION_REWRITE_DROPPED_MESSAGE,
  buildDroppedOutputRewriteNotice,
  EXIT_PLAN_MODE_REWRITE_DROPPED_MESSAGE,
  holdPostToolUseAbortGrace,
  isPostToolUseOutputRewriteProtected,
  mergeAskHookCandidates,
} from '../../tools/toolHooks.js'
import { applyContextLayersToToolUseContext } from '../../tools/StreamingToolExecutor.js'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wave319-321-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetStoppedByPersonForTests()
  delete process.env.CLAUDE_CODE_ENTRYPOINT
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!
    rmSync(d, { recursive: true, force: true })
  }
})

describe('Wave 319-321 Group 3: Artifact DB, AgentTool, WebFetch, ListMcpResources, Hooks, Executor', () => {
  test('#1756: 1-hour dbUndeclaredAt cache suppresses repeated DB calls until publish clears it', async () => {
    const slug = '11111111-1111-1111-1111-111111111111'
    const url = `https://claude.ai/code/artifact/${slug}`
    let fetchCalls = 0
    const mockFetch = (async () => {
      fetchCalls++
      return new Response(JSON.stringify({ error: { code: 'not_declared' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const first = await executeArtifactDbAction({
      action: 'read_db',
      url,
      oauthToken: 'test-oauth-token',
      fetchImpl: mockFetch,
    })
    expect(fetchCalls).toBe(1)
    expect(first.error).toContain('does not declare the database capability')

    const second = await executeArtifactDbAction({
      action: 'read_db',
      url,
      oauthToken: 'test-oauth-token',
      fetchImpl: mockFetch,
    })
    expect(fetchCalls).toBe(1)
    expect(second.error).toContain('the call was not sent')

    clearDbUndeclared(slug)
    expect(checkRememberedDbUndeclared(slug)).toBeUndefined()
    rememberDbUndeclared(slug, 404, 'not_declared', Date.now() + 5)
    expect(checkRememberedDbUndeclared(slug)).toBeDefined()
  })

  test('#1798 & #1916: scan_budget, refused_writes, and missing-doc update error copy', () => {
    const scanErr = formatArtifactDbError('quota_or_rate', 'read', {
      kind: 'scan_budget',
    })
    expect(scanErr).toContain('drop `query.order_by`')
    expect(scanErr).toContain('query.cursor')

    const refusedErr = formatArtifactDbError('quota_or_rate', 'write', {
      kind: 'refused_writes',
    })
    expect(refusedErr).toContain('repeated refused writes')
    expect(refusedErr).toContain('this write was not applied')

    const missingUpdateErr = formatArtifactDbError('not_found', 'write', {
      op: 'update',
      path: 'items/doc1',
    })
    expect(missingUpdateErr).toContain('items/doc1 does not exist')
    expect(missingUpdateErr).toContain('use "set"')
  })

  test('#1818: saveArtifactDbRowWithMarker creates hidden marker and leaves unmarked existing files alone', async () => {
    const dir = makeTempDir()
    const existing = join(dir, 'row1.json')
    writeFileSync(existing, 'user-original', 'utf8')

    const skipped = await saveArtifactDbRowWithMarker(
      dir,
      'row1.json',
      'overwrite',
    )
    expect(skipped.status).toBe('skipped_existing_unmarked')
    expect(readFileSync(existing, 'utf8')).toBe('user-original')

    const written = await saveArtifactDbRowWithMarker(
      dir,
      'row2.json',
      '{"a":1}',
    )
    expect(written.status).toBe('written')
    expect(existsSync(getArtifactDbRowMarkerPath(written.filePath))).toBe(true)

    const updated = await saveArtifactDbRowWithMarker(
      dir,
      'row2.json',
      '{"a":2}',
    )
    expect(updated.status).toBe('written')
    expect(readFileSync(written.filePath, 'utf8')).toBe('{"a":2}')

    // Refuses live symlink target and dangling symlink target via lstat
    const realTarget = join(dir, 'secret.txt')
    writeFileSync(realTarget, 'secret', 'utf8')
    const liveLink = join(dir, 'live-link.json')
    symlinkSync(realTarget, liveLink)
    await expect(
      saveArtifactDbRowWithMarker(dir, 'live-link.json', '{"bad":1}'),
    ).rejects.toThrow(/symlink/i)
    expect(readFileSync(realTarget, 'utf8')).toBe('secret')

    const danglingLink = join(dir, 'dangling-link.json')
    symlinkSync(join(dir, 'does-not-exist.txt'), danglingLink)
    await expect(
      saveArtifactDbRowWithMarker(dir, 'dangling-link.json', '{"bad":2}'),
    ).rejects.toThrow(/symlink/i)

    // Refuses symlink marker
    const markerLink = getArtifactDbRowMarkerPath(join(dir, 'row3.json'))
    symlinkSync(realTarget, markerLink)
    await expect(
      saveArtifactDbRowWithMarker(dir, 'row3.json', '{"bad":3}'),
    ).rejects.toThrow(/symlink/i)

    // Resolves relative outDir against getCwd() rather than process.cwd()
    const origCwd = getCwd()
    try {
      setCwdState(dir)
      const rel = await saveArtifactDbRowWithMarker(
        'nested-rel',
        'row-rel.json',
        '{"rel":true}',
      )
      expect(rel.status).toBe('written')
      expect(rel.filePath).toBe(join(dir, 'nested-rel', 'row-rel.json'))
      expect(readFileSync(rel.filePath, 'utf8')).toBe('{"rel":true}')
    } finally {
      setCwdState(origCwd)
    }
  })

  test('#1818: executeArtifactDbAction requires OAuth login and attaches Authorization + frame control-plane headers', async () => {
    const slug = '22222222-2222-2222-2222-222222222222'
    const url = `https://claude.ai/code/artifact/${slug}`
    let fetchCalled = false
    const noCallFetch = (async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const unauth = await executeArtifactDbAction({
      action: 'read_db',
      url,
      oauthToken: null,
      fetchImpl: noCallFetch,
    })
    expect(fetchCalled).toBe(false)
    expect(unauth.error).toContain('upstream_auth')
    expect(unauth.error).toContain('/login')

    let capturedHeaders: Record<string, string> | undefined
    const authedFetch = (async (_input: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const authed = await executeArtifactDbAction({
      action: 'read_db',
      url,
      oauthToken: 'oauth-secret-tok',
      fetchImpl: authedFetch,
    })
    expect(authed.error).toBeUndefined()
    expect(capturedHeaders?.Authorization).toBe('Bearer oauth-secret-tok')
    expect(capturedHeaders?.['X-Frame-CP']).toBe('go')
    expect(capturedHeaders?.['Content-Type']).toBe('application/json')
  })

  test('#1868: mergeAskHookCandidates preserves high-priority updatedInput when lower-priority hostsOwnAsk arrives', () => {
    const nonHost = {
      message: 'user hook ask',
      decisionReason: { type: 'hook' as const, hookName: 'PreToolUse:Bash' },
      updatedInput: { command: 'echo safe' },
    }
    const hostAskNoInput = {
      message: 'host ask',
      decisionReason: { type: 'hook' as const, hookName: 'PreToolUse:Bash' },
      updatedInput: undefined,
    }
    const hostAskWithInput = {
      message: 'host ask 2',
      decisionReason: { type: 'hook' as const, hookName: 'PreToolUse:Bash' },
      updatedInput: { command: 'echo lower' },
    }
    const serverAsk = {
      message: 'server ask',
      decisionReason: { type: 'hook' as const, hookName: 'PreToolUse:Bash' },
      updatedInput: { command: 'echo server' },
    }

    const res1 = mergeAskHookCandidates({
      nonHostAskCandidate: nonHost,
      hostAskCandidate: hostAskNoInput,
      fallbackCandidate: hostAskNoInput,
    })
    expect(res1.behavior).toBe('ask')
    if (res1.behavior === 'ask') {
      expect(res1.message).toBe('user hook ask')
      expect(res1.updatedInput).toEqual({ command: 'echo safe' })
    }

    const res2 = mergeAskHookCandidates({
      nonHostAskCandidate: nonHost,
      hostAskCandidate: hostAskWithInput,
      fallbackCandidate: hostAskWithInput,
    })
    expect(res2.behavior).toBe('ask')
    if (res2.behavior === 'ask') {
      expect(res2.updatedInput).toEqual({ command: 'echo safe' })
    }

    const res3 = mergeAskHookCandidates({
      serverAskCandidate: serverAsk,
      nonHostAskCandidate: nonHost,
      hostAskCandidate: hostAskWithInput,
      fallbackCandidate: hostAskWithInput,
    })
    expect(res3.behavior).toBe('ask')
    if (res3.behavior === 'ask') {
      expect(res3.message).toBe('server ask')
      expect(res3.updatedInput).toEqual({ command: 'echo server' })
    }
  })

  test('#1732, #1791, #1815: AgentTool handback split, refused later report notice, and safeguards guidance', () => {
    const parts = parseHandbackBodyParts(
      'Provenance note\n--- subagent report ---\n  Line 1\n  Line 2',
    )
    expect(parts.note).toBe('Provenance note')
    expect(parts.report).toBe('Line 1\nLine 2')

    const laterRefused = formatLaterReportRefusedNotice(true)
    expect(laterRefused).toContain('was refused')
    expect(laterRefused).toContain('SendMessage')

    const guidance = formatSubagentSafeguardsGuidance(
      {
        type: 'assistant',
        message: {
          stop_reason: 'refusal',
          stop_details: { category: 'cyber' },
        },
      } as never,
      true,
    )
    expect(guidance).toContain('Safeguards stopped this agent.')
    expect(guidance).toContain('clearer prompt')
    expect(guidance).toContain("Don't do the agent's work yourself")
  })

  test('#1755: WebFetch detects https://claude.ai/share/<uuid>', () => {
    expect(
      parseClaudeAiShareUrl(
        'https://claude.ai/share/11111111-2222-3333-4444-555555555555',
      ),
    ).toEqual({ snapshotId: '11111111-2222-3333-4444-555555555555' })
    expect(parseClaudeAiShareUrl('https://example.com/share/123')).toBeNull()
  })

  test('#1888: ListMcpResourcesTool caps oversize non-ASCII resource names', () => {
    const hugeNonAscii = '🚀'.repeat(40_000)
    const { items, skippedCount } = capMcpResourceListing(
      [
        { uri: 'a://1', name: 'small' },
        { uri: 'a://2', name: hugeNonAscii },
      ],
      { maxTextToSanitize: 1000 },
    )
    expect(items).toHaveLength(1)
    expect(skippedCount).toBe(1)
  })

  test('#1913: sessionHost stoppedByPerson distinguishes cloud service interrupt from user stop', () => {
    expect(isAgentStoppedByPerson('agent-1', true)).toBe(true)
    installStoppedByPerson(id => id === 'agent-user-stopped')
    expect(isAgentStoppedByPerson('agent-service-interrupted', true)).toBe(
      false,
    )
    expect(isAgentStoppedByPerson('agent-user-stopped', false)).toBe(true)
  })

  test('#1857: fileChangedWatcher normalizes Windows drive-letter case', () => {
    expect(normalizeWatchCwdPath('C:\\Users\\dev', 'win32')).toBe(
      'c:\\Users\\dev',
    )
    expect(normalizeWatchCwdPath('c:\\Users\\dev', 'win32')).toBe(
      'c:\\Users\\dev',
    )
    expect(normalizeWatchCwdPath('/Users/dev', 'darwin')).toBe('/Users/dev')
  })

  test('#1814 & #1954: PostToolUse 10s interrupt grace and Cowork cloud AskUserQuestion/ExitPlanMode rewrite drop', async () => {
    const parent = new AbortController()
    const grace = holdPostToolUseAbortGrace(
      { abortController: parent } as never,
      false,
      50,
    )
    parent.abort('interrupt')
    expect(grace.heldAbortBack).toBe(true)
    expect(grace.context.abortController.signal.aborted).toBe(false)
    await new Promise(r => setTimeout(r, 80))
    expect(grace.context.abortController.signal.aborted).toBe(true)
    grace.hooksEnded()
    grace.dispose()

    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    const askTool = { name: 'AskUserQuestion' } as never
    const exitTool = { name: 'ExitPlanMode' } as never
    expect(isPostToolUseOutputRewriteProtected(askTool)).toBe(true)
    expect(isPostToolUseOutputRewriteProtected(exitTool)).toBe(true)
    const askNotice = buildDroppedOutputRewriteNotice(
      askTool,
      { a: 2 },
      { a: 1 },
      'tu-1',
    )
    const exitNotice = buildDroppedOutputRewriteNotice(
      exitTool,
      { p: 2 },
      { p: 1 },
      'tu-2',
    )
    expect((askNotice?.attachment as { content?: string })?.content).toBe(
      ASK_USER_QUESTION_REWRITE_DROPPED_MESSAGE,
    )
    expect((exitNotice?.attachment as { content?: string })?.content).toBe(
      EXIT_PLAN_MODE_REWRITE_DROPPED_MESSAGE,
    )
  })

  test('#1894: applyContextLayersToToolUseContext appends working_directory layers in order', () => {
    const base = {
      options: {},
      permissionLayers: [{ kind: 'working_directory', directory: '/a' }],
    } as never
    const next = applyContextLayersToToolUseContext(base, [
      { kind: 'working_directory', directory: '/b' },
    ])
    expect(next.permissionLayers).toEqual([
      { kind: 'working_directory', directory: '/a' },
      { kind: 'working_directory', directory: '/b' },
    ])
  })
})
