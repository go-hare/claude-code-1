/**
 * densable 2.1.246 fe / B — session auto-title contract.
 * Do not mock src/services/api/claude.js (process-global last-write-wins).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'

import type { Message } from '../../types/message.js'
import {
  getProject,
  isForeignBoundSessionMismatch,
  isForeignSessionBinding,
  isKnownTaintedSession,
  isLiveBridgeSuppressed,
  isPrecautionarySuppressed,
  markPrecautionarySessionSuppression,
  markResilientPrecautionSid,
  markScanUncertaintyHoldSid,
  clearScanUncertaintyHoldSid,
  applyScanPrecautionHold,
  scanFileForHistorySuppression,
  releaseScanPrecautionHold,
  bindMainSessionTranscriptPersistence,
  getCustomTitleSidecarPath,
  isHistorySuppressionJsonlLine,
  probeActiveSessionHistorySuppression,
  isSessionTranscriptRelocating,
  isScanUncertaintyHeld,
  getActiveSessionTranscriptPath,
  markSessionHistorySuppressed,
  registerForeignSessionBindingProbe,
  registerLiveSuppressionProbe,
  resetProjectForTesting,
  shouldSuppressSessionTitleHistory,
} from '../sessionStorage.js'
import {
  extractConversationText,
  generateSessionTitle,
  isSyntheticSessionTitleText,
  parseSessionTitleResponse,
} from '../sessionTitle.js'
import { startsWithRegisteredSlashCommand } from '../slashCommandParsing.js'

const utilsRoot = join(import.meta.dir, '..')
const srcRoot = join(import.meta.dir, '../..')

describe('densable 2.1.246 generateSessionTitle fe/B', () => {
  test('source-locks official W prompt, J=10, B session wrap, and REPL gate', () => {
    const src = readFileSync(join(utilsRoot, 'sessionTitle.ts'), 'utf8')
    expect(src).toContain(
      'You are naming a coding session so the user can pick it out of a long list of sessions',
    )
    expect(src).toContain('not a sentence describing the task')
    expect(src).toContain('SESSION_TITLE_MIN_LENGTH = 10')
    expect(src).toContain('<session>')
    expect(src).toContain('stripMarkdownJsonFence')
    expect(src).toContain('getSettings_DEPRECATED()?.language')
    expect(src).toContain('promptTooLongIsHandled: true')
    expect(src).toContain('agentContext: getAgentContext()')
    expect(src).toContain('credentials')
    expect(src).toContain('credentials?: unknown')
    expect(src).toContain('stripCcMemoryTags')
    const client = readFileSync(join(srcRoot, 'services/api/client.ts'), 'utf8')
    expect(client).toContain('x-claude-code-agent-id')
    expect(client).toContain('x-claude-code-parent-agent-id')
    expect(client).toContain('isOAuthRefreshDead(credentials)')
    expect(client).toContain('OAuthRefreshDeadError')
    expect(client).toContain('buildFetch(fetchOverride, source, storageV5)')
    expect(client).toContain(
      'checkAndRefreshOAuthTokenIfNeeded(0, false, credentials, storageV5)',
    )
    const auth = readFileSync(join(srcRoot, 'utils/auth.ts'), 'utf8')
    expect(auth).toContain('export async function isOAuthRefreshDead')
    expect(auth).toContain('checkAndRefreshOAuthTokenIfNeededImpl')
    expect(auth).toContain('storageV5?: unknown')
    const hold = readFileSync(join(srcRoot, 'utils/accountOnHold.ts'), 'utf8')
    expect(hold).toContain(
      'OAuth refresh token is no longer valid; run /login to re-authenticate',
    )
    expect(hold).toContain("this.name = 'OAuthRefreshDeadError'")
    const claude = readFileSync(join(srcRoot, 'services/api/claude.ts'), 'utf8')
    expect(claude).toContain('credentials: options.credentials')
    expect(claude).toContain('credentials?: unknown')
    expect(claude).toContain('storageV5: options.storageV5')
    expect(claude).toContain('storageV5?: unknown')
    expect(src).not.toContain('storageV5')
    expect(src).not.toContain(
      'Generate a concise, sentence-case title (3-7 words)',
    )
    const repl = readFileSync(join(srcRoot, 'screens/REPL.tsx'), 'utf8')
    expect(repl).toContain('!sessionAiTitle')
    expect(repl).toContain('titleSessionId !== getSessionId()')
    expect(repl).toContain('isSyntheticSessionTitleText')
    expect(repl).toContain('startsWithRegisteredSlashCommand')
    expect(repl).toContain('adoptLocalAiTitle')
    const logging = readFileSync(
      join(srcRoot, 'services/api/logging.ts'),
      'utf8',
    )
    expect(logging).toContain('promptTooLongIsHandled')
    expect(logging).toContain("errorType === 'prompt_too_long'")
    const bridge = readFileSync(
      join(srcRoot, 'bridge/initReplBridge.ts'),
      'utf8',
    )
    expect(bridge).toContain('adoptLocalAiTitle')
    expect(bridge).toContain('getCurrentSessionAiTitle')
    // leftover #49 — official Ii @233528249:
    //   H||Bi||ne===n → done; Ae(X) → done; it(n) → done; then G++
    //   G===1&&!V → rt (Haiku only; no Xo/deriveTitle)
    //   G===3 → rt even when V
    //   done: G>=3&&(V||H)||G>=8
    // Local leftovers: hasExplicitTitle / lastAdoptedRemoteSession /
    // syncLocalAiTitle / Bi latch / Ae leftover. He=t9s=eQe?.().foreign===!0
    // via isForeignSessionBinding. Ne leftover = Jre||Sno||xno||y4t.
    // Ano/Cno/_4t/B() not inlined. No 升标.
    expect(bridge).toContain('lastAdoptedRemoteSession === bridgeSessionId')
    expect(bridge).toContain('sessionTitleUnlessHistorySuppressed')
    expect(bridge).toContain(
      'shouldSuppressSessionTitleHistory(getSessionId())',
    )
    expect(bridge).toContain(
      'forceNoHistoryBackfill ||\n      isForeignSessionBinding() ||\n      shouldSuppressSessionTitleHistory(getSessionId())',
    )
    const beforeInc = bridge.slice(
      bridge.indexOf('const onUserMessage'),
      bridge.indexOf('userMessageCount++'),
    )
    expect(beforeInc).toContain(
      'sessionTitleUnlessHistorySuppressed(\n      getCurrentSessionTitle',
    )
    expect(beforeInc).toContain(
      'isOwnOrSentTitle(bridgeSessionId, customTitle)',
    )
    expect(beforeInc).toContain('hasExplicitTitle = true')
    expect(beforeInc).toContain('syncLocalAiTitle(bridgeSessionId)')
    expect(beforeInc).toContain('alreadyAdoptedLocalAi(bridgeSessionId)')
    expect(beforeInc).toContain('lastAdoptedRemoteSession === bridgeSessionId')
    expect(
      beforeInc.indexOf('sessionTitleUnlessHistorySuppressed'),
    ).toBeLessThan(beforeInc.indexOf('syncLocalAiTitle(bridgeSessionId)'))
    expect(bridge).toContain('userMessageCount === 1 && !hasTitle')
    expect(bridge).toContain('generateAndPatch(text, bridgeSessionId)')
    const count1 = bridge.slice(
      bridge.indexOf('userMessageCount === 1 && !hasTitle'),
      bridge.indexOf('userMessageCount === 3'),
    )
    expect(count1).toContain('generateAndPatch(text, bridgeSessionId)')
    expect(count1).not.toContain('deriveTitle')
    expect(count1).not.toContain('placeholder')
    const count3 = bridge.slice(
      bridge.indexOf('userMessageCount === 3'),
      bridge.indexOf('Official: G>=3'),
    )
    expect(count3).toContain('generateAndPatch(input, bridgeSessionId)')
    expect(count3).toContain('isForeignSessionBinding()')
    expect(count3).toContain(
      'shouldSuppressSessionTitleHistory(getSessionId())',
    )
    expect(count3).not.toContain('!hasTitle')
    expect(bridge).toContain(
      '(userMessageCount >= 3 && (hasTitle || hasExplicitTitle)) ||',
    )
    expect(bridge).toContain('userMessageCount >= 8')
    expect(bridge).toContain('stored && !ownTitles.has(stored)')
    // Official rt @233526302: ei → rn → Pe===null abort / !Re → ne.
    const rt = bridge.slice(
      bridge.indexOf('const generateAndPatch'),
      bridge.indexOf('const onUserMessage'),
    )
    expect(rt).toContain('getBridgeSession(bridgeSessionId')
    expect(rt).toContain('if (remote === null)')
    expect(rt).toContain('titleWriter.noteRemoteTitle')
    expect(rt).toContain('lastAdoptedRemoteSession = bridgeSessionId')
    expect(rt).toContain('aiTitle && !ownTitles.has(aiTitle)')
    expect(rt).toContain('isOwnOrSentTitle(bridgeSessionId, remote.title)')
    expect(rt).not.toContain('isKnownTitle')
    const itBody = bridge.slice(
      bridge.indexOf('const syncLocalAiTitle'),
      bridge.indexOf('const adoptLocalAiTitle'),
    )
    expect(itBody).toContain(
      'sessionTitleUnlessHistorySuppressed(\n      getCurrentSessionAiTitle',
    )
    expect(itBody).toContain('genSeq++')
    expect(itBody).toContain('adoptedLocalAi = { bridgeSessionId, sessionId }')
    expect(itBody).toContain('isOwnOrSentTitle(bridgeSessionId, aiTitle)')
    const initTitle = bridge.slice(
      bridge.indexOf('sessionTitleUnlessHistorySuppressed ='),
      bridge.indexOf('const onUserMessage'),
    )
    expect(initTitle).toContain(
      'sessionTitleUnlessHistorySuppressed(\n      getCurrentSessionAiTitle',
    )
    expect(initTitle).toContain('title = aiTitle')
    expect(initTitle).toContain('hasTitle = true')
    expect(bridge).toContain('onRemoteTitleAdopted:')
    expect(bridge).toContain('shouldSend: () => !teardownStarted')
    expect(bridge).toContain(
      'ownTitles.has(value) || titleWriter.hasSent(sessionId, value)',
    )
  })

  test('fe: trimmed length below J=10 returns null without calling Haiku', async () => {
    const title = await generateSessionTitle(
      '123456789',
      new AbortController().signal,
    )
    expect(title).toBeNull()
  })

  test('Abe qQ: official six synthetic prefixes', () => {
    expect(isSyntheticSessionTitleText('<local-command-stdout>x')).toBe(true)
    expect(isSyntheticSessionTitleText('<local-command-stderr>x')).toBe(true)
    expect(isSyntheticSessionTitleText('<command-name>x')).toBe(true)
    expect(isSyntheticSessionTitleText('<command-message>x')).toBe(true)
    expect(isSyntheticSessionTitleText('<bash-input>x')).toBe(true)
    expect(isSyntheticSessionTitleText('<task-notification>x')).toBe(true)
    expect(isSyntheticSessionTitleText('fix the login button')).toBe(false)
    expect(isSyntheticSessionTitleText('<command-args>x')).toBe(false)
  })

  test('B accepts official JSON title and a short proxy noun phrase', () => {
    expect(parseSessionTitleResponse('{"title":"Consul RPC"}')).toBe(
      'Consul RPC',
    )
    expect(
      parseSessionTitleResponse('```json\n{"title":"Consul RPC"}\n```'),
    ).toBe('Consul RPC')
    expect(parseSessionTitleResponse('Consul RPC')).toBe('Consul RPC')
    expect(parseSessionTitleResponse('API Error: model not found')).toBeNull()
    expect(parseSessionTitleResponse('{"nope":1}')).toBeNull()
  })
})

test('KSe fn: registered slash prefix, including dotted first-token', () => {
  const registered = new Set(['help', 'foo.bar'])
  const has = (name: string) => registered.has(name)
  expect(startsWithRegisteredSlashCommand('/help me', has)).toBe(true)
  expect(startsWithRegisteredSlashCommand('  /help', has)).toBe(true)
  expect(startsWithRegisteredSlashCommand('fix login', has)).toBe(false)
  expect(startsWithRegisteredSlashCommand('/unknown', has)).toBe(false)
  expect(startsWithRegisteredSlashCommand('/foo.bar now', has)).toBe(true)
})

test('ge nub: strip cc-memory on text blocks only', () => {
  const tagged = 'hello <cc-memory filenames="a.md">secret</cc-memory> world'
  const blockMsg = {
    type: 'user',
    message: { content: [{ type: 'text', text: tagged }] },
  } as Message
  const stringMsg = {
    type: 'user',
    message: { content: tagged },
  } as Message
  expect(extractConversationText([blockMsg])).toBe('hello secret world')
  expect(extractConversationText([stringMsg])).toBe(tagged)
})

test('He leftover: eQe?.().foreign===true gates title', () => {
  expect(isForeignSessionBinding()).toBe(false)
  registerForeignSessionBindingProbe(() => ({ foreign: true, boundSid: 'x' }))
  expect(isForeignSessionBinding()).toBe(true)
  registerForeignSessionBindingProbe(undefined)
  expect(isForeignSessionBinding()).toBe(false)
})

test('Jre leftover: foreign sid mismatch / missing boundSid', () => {
  registerForeignSessionBindingProbe(() => ({ foreign: true, boundSid: 'a' }))
  expect(isForeignBoundSessionMismatch('a')).toBe(false)
  expect(isForeignBoundSessionMismatch('b')).toBe(true)
  expect(isForeignBoundSessionMismatch(undefined)).toBe(true)
  registerForeignSessionBindingProbe(() => ({ foreign: true }))
  expect(isForeignBoundSessionMismatch('a')).toBe(true)
  registerForeignSessionBindingProbe(() => ({
    foreign: false,
    boundSid: 'a',
  }))
  expect(isForeignBoundSessionMismatch('b')).toBe(false)
  registerForeignSessionBindingProbe(undefined)
  expect(isForeignBoundSessionMismatch('a')).toBe(false)
})

test('y4t / Pno leftover: taint and noHistoryBackfill gate Ne', () => {
  resetProjectForTesting()
  registerForeignSessionBindingProbe(undefined)
  const sid = '11111111-1111-4111-8111-111111111111'
  expect(isKnownTaintedSession(sid)).toBe(false)
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(false)
  markSessionHistorySuppressed(sid as import('crypto').UUID)
  expect(isKnownTaintedSession(sid)).toBe(true)
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(true)
  resetProjectForTesting()
  expect(isKnownTaintedSession(sid)).toBe(false)
  getProject().currentSessionHistorySuppressed = true
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(true)
  resetProjectForTesting()
  getProject().currentSessionBridgeId = 'cse_x'
  getProject().currentSessionBridgeNoBackfill = true
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(true)
  resetProjectForTesting()
  registerForeignSessionBindingProbe(undefined)
})

test('Ano leftover: liveSuppressionProbe gates Ne', () => {
  resetProjectForTesting()
  registerLiveSuppressionProbe(undefined)
  const sid = '11111111-1111-4111-8111-111111111111'
  expect(isLiveBridgeSuppressed()).toBe(false)
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(false)
  registerLiveSuppressionProbe(() => true)
  expect(isLiveBridgeSuppressed()).toBe(true)
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(true)
  registerLiveSuppressionProbe(() => false)
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(false)
  registerLiveSuppressionProbe(undefined)
  resetProjectForTesting()
})

test('_4t / Cno leftover: precaution set gates Ne; B=Xg identity', () => {
  resetProjectForTesting()
  registerForeignSessionBindingProbe(undefined)
  registerLiveSuppressionProbe(undefined)
  const sid = '11111111-1111-4111-8111-111111111111'
  expect(isPrecautionarySuppressed(sid)).toBe(false)
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(false)
  markPrecautionarySessionSuppression(sid)
  expect(isPrecautionarySuppressed(sid)).toBe(true)
  expect(shouldSuppressSessionTitleHistory(sid)).toBe(true)
  const gold = readFileSync(
    join(
      srcRoot,
      '../docs/upstream-extraction/v2.1.246/snippets/gold-bytecode-na-ie-he-bln.txt',
    ),
    'utf8',
  )
  expect(gold).toContain('function Xg(e){return e}')
  expect(gold).toContain(
    'function Ano(){return Ms().liveSuppressionProbe?.()===!0}',
  )
  expect(gold).toContain('function Cno(){return _4t(Xg(We()))}')
  expect(gold).toContain(
    'function _4t(e){return e!==void 0&&Yn().currentSessionPrecautionarySuppression?.has(e)===!0}',
  )
  resetProjectForTesting()
})

test('XXs leftover: ui is scanUncertaintyHoldSids.has === true', () => {
  resetProjectForTesting()
  const sid = '11111111-1111-4111-8111-111111111111'
  expect(isScanUncertaintyHeld()).toBe(false)
  expect(isScanUncertaintyHeld(sid)).toBe(false)
  markScanUncertaintyHoldSid(sid)
  expect(isScanUncertaintyHeld(sid)).toBe(true)
  getProject().sessionFile = '/tmp/torn.jsonl'
  expect(getActiveSessionTranscriptPath()).toBe('/tmp/torn.jsonl')
  resetProjectForTesting()
})

test('te/_e leftover: KXs marks resilient; ZXs drops uncertainty hold', () => {
  resetProjectForTesting()
  const sid = '11111111-1111-4111-8111-111111111111'
  markScanUncertaintyHoldSid(sid)
  expect(getProject().scanUncertaintyHoldSids?.has(sid)).toBe(true)
  clearScanUncertaintyHoldSid(sid)
  expect(getProject().scanUncertaintyHoldSids?.has(sid)).toBe(false)
  markResilientPrecautionSid(sid)
  expect(getProject().clearResilientPrecautionSids?.has(sid)).toBe(true)
  expect(getCustomTitleSidecarPath('/proj/sess.jsonl', sid)).toBe(
    join(dirname('/proj/sess.jsonl'), sid, 'custom-title.json'),
  )
  const gold = readFileSync(
    join(
      srcRoot,
      '../docs/upstream-extraction/v2.1.246/snippets/gold-leftover-49-title.txt',
    ),
    'utf8',
  )
  expect(gold).toContain('KXs as JUa')
  expect(gold).toContain('ZXs as MUa')
  expect(gold).toContain('Me=YXs as KUa')
  expect(gold).toContain('XXs as LUa')
  expect(gold).toContain('e9s(e){eQe=e}')
  expect(gold).toContain('stripBridgeSessionIdPrefix=lQc')
  expect(gold).toContain('leftover `ur`')
  expect(gold).toContain('hook leftover et||Dt||Mo')
  resetProjectForTesting()
})

test('JXs leftover: clean scan drops hold + resilient + precaution', () => {
  resetProjectForTesting()
  const sid = '11111111-1111-4111-8111-111111111111'
  markScanUncertaintyHoldSid(sid)
  markResilientPrecautionSid(sid)
  markPrecautionarySessionSuppression(sid)
  releaseScanPrecautionHold(sid)
  expect(getProject().scanUncertaintyHoldSids?.has(sid)).toBe(false)
  expect(getProject().clearResilientPrecautionSids?.has(sid)).toBe(false)
  expect(isPrecautionarySuppressed(sid)).toBe(false)
  releaseScanPrecautionHold(sid)
  expect(getProject().scanUncertaintyHoldSids?.has(sid)).toBe(false)
  resetProjectForTesting()
})

test('Me leftover: L+te always; Me only when !re', () => {
  resetProjectForTesting()
  const sid = '11111111-1111-4111-8111-111111111111'
  applyScanPrecautionHold(sid)
  expect(isPrecautionarySuppressed(sid)).toBe(true)
  expect(getProject().clearResilientPrecautionSids?.has(sid)).toBe(true)
  expect(getProject().scanUncertaintyHoldSids?.has(sid)).toBe(true)
  resetProjectForTesting()
  markPrecautionarySessionSuppression(sid)
  applyScanPrecautionHold(sid)
  expect(getProject().scanUncertaintyHoldSids?.has(sid) === true).toBe(false)
  expect(isPrecautionarySuppressed(sid)).toBe(true)
  resetProjectForTesting()
})

test('Tno leftover: history-suppression line + sid filter', () => {
  const sid = '11111111-1111-4111-8111-111111111111'
  expect(isHistorySuppressionJsonlLine('{"type":"user"}')).toBe(false)
  expect(
    isHistorySuppressionJsonlLine(
      `{"type":"history-suppression","sessionId":"${sid}"}`,
    ),
  ).toBe(true)
  expect(
    isHistorySuppressionJsonlLine(
      `{"type":"history-suppression","sessionId":"${sid}"}`,
      {
        sid,
      },
    ),
  ).toBe(true)
  expect(
    isHistorySuppressionJsonlLine(
      `{"type":"history-suppression","sessionId":"${sid}"}`,
      {
        sid: 'other',
      },
    ),
  ).toBe(false)
  expect(isHistorySuppressionJsonlLine('{"type":"history-suppression"')).toBe(
    false,
  )
})

test('UXs leftover: sessionFile clean / found', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join: pathJoin } = await import('path')
  const { getSessionId } = await import('../../bootstrap/state.js')
  resetProjectForTesting()
  const sid = getSessionId()
  const dir = mkdtempSync(pathJoin(tmpdir(), 'uxs-'))
  const file = pathJoin(dir, `${sid}.jsonl`)
  writeFileSync(file, '')
  getProject().sessionFile = file
  expect(await probeActiveSessionHistorySuppression()).toBe('clean')
  writeFileSync(
    file,
    `${JSON.stringify({ type: 'history-suppression', sessionId: sid })}\n`,
  )
  expect(await probeActiveSessionHistorySuppression()).toBe('found')
  const other = pathJoin(dir, 'other.jsonl')
  writeFileSync(other, '')
  getProject().sessionFile = other
  expect(await scanFileForHistorySuppression(other)).toBe('clean')
  expect(isSessionTranscriptRelocating()).toBe(false)
  getProject().beginTranscriptRelocation()
  expect(isSessionTranscriptRelocating()).toBe(true)
  await getProject().endTranscriptRelocation()
  rmSync(dir, { recursive: true, force: true })
  resetProjectForTesting()
})

test('Tg leftover: sidecar walk to getProjectsDir; jsonl leaf rejected', async () => {
  const { jobIdHasJsonlSegment } = await import('../sessionNameJobSidecar.js')
  const {
    parseSessionSidecarKeyFromPath,
    getSidecarKeyValidationError,
    getProjectsDir,
  } = await import('../sessionStorage.js')
  const { readTranscriptEventsReverse } = await import(
    '../sessionPersistenceSync.js'
  )
  expect(jobIdHasJsonlSegment('custom-title.json')).toBe(false)
  expect(jobIdHasJsonlSegment('sid.jsonl')).toBe(true)
  const root = getProjectsDir()
  const sidecar = join(root, 'projkey', 'sid', 'custom-title.json')
  expect(parseSessionSidecarKeyFromPath(sidecar)).toEqual({
    namespace: 'sidecar',
    projectKey: 'projkey',
    sessionId: 'sid',
    relPath: ['custom-title.json'],
  })
  expect(
    getSidecarKeyValidationError(parseSessionSidecarKeyFromPath(sidecar)!),
  ).toBeUndefined()
  expect(
    parseSessionSidecarKeyFromPath(join(root, 'projkey', 'sid.jsonl')),
  ).toBeUndefined()
  expect(
    await readTranscriptEventsReverse(join(root, 'missing.jsonl')),
  ).toEqual([])
})

test('fr leftover: projectsDir main/subagent paths → transcript key', async () => {
  const { parseTranscriptKeyFromPath, createTranscriptStorageKey } =
    await import('../sessionPersistenceSync.js')
  const { getProjectsDir } = await import('../sessionStorage.js')
  const root = getProjectsDir()
  const main = join(root, 'proj', 'sid.jsonl')
  expect(parseTranscriptKeyFromPath(main)).toEqual(
    createTranscriptStorageKey('proj', 'sid'),
  )
  const sub = join(root, 'proj', 'sid', 'subagents', 'agent-aid.jsonl')
  expect(parseTranscriptKeyFromPath(sub)).toEqual(
    createTranscriptStorageKey('proj', 'sid', 'aid'),
  )
  expect(
    parseTranscriptKeyFromPath(join(root, 'proj', 'not-json.txt')),
  ).toBeNull()
})

test('zr/R leftover: Owb projectKey; Jt pages; R listEntries agentIds', async () => {
  const {
    drainPagedListEntries,
    projectKeyIfDirectChildOfProjects,
    listSubagentIdsForSession,
    createListPageBudget,
  } = await import('../sessionPersistenceSync.js')
  const { getProjectsDir } = await import('../sessionStorage.js')
  const root = getProjectsDir()
  expect(projectKeyIfDirectChildOfProjects(join(root, 'projkey'))).toBe(
    'projkey',
  )
  expect(
    projectKeyIfDirectChildOfProjects(join(root, 'projkey', 'sid')),
  ).toBeUndefined()
  expect(createListPageBudget().pagesLeft).toBe(10000)
  const items: string[] = []
  const page = await drainPagedListEntries(
    async cursor =>
      cursor
        ? { ok: true as const, value: { items: ['b'] } }
        : { ok: true as const, value: { items: ['a'], cursor: 1 } },
    batch => {
      items.push(...batch)
    },
  )
  expect(page).toEqual({ status: 'done' })
  expect(items).toEqual(['a', 'b'])
  const ids = await listSubagentIdsForSession(
    {
      listEntries: async () => ({
        ok: true as const,
        value: {
          items: [
            {
              kind: 'key',
              key: {
                namespace: 'transcript',
                projectKey: 'p',
                sessionId: 's',
                agentId: 'aid',
              },
            },
          ],
        },
      }),
    },
    'p',
    's',
  )
  expect(ids).toEqual(['aid'])
})

test('xeo leftover: B6s/Peo, NotFound→ENOENT, strip nl, page-change abandon', async () => {
  const {
    iterateTranscriptRecordPages,
    createTranscriptStorageKey,
    RECORD_PAGE_FIRST_MAX_BYTES,
    RECORD_PAGE_NEXT_MAX_BYTES,
  } = await import('../sessionPersistenceSync.js')
  expect(RECORD_PAGE_FIRST_MAX_BYTES).toBe(262144)
  expect(RECORD_PAGE_NEXT_MAX_BYTES).toBe(2097152)
  const key = createTranscriptStorageKey('proj', 'sid')
  await expect(async () => {
    for await (const _ of iterateTranscriptRecordPages(
      {
        readRecords: async () => ({
          ok: false as const,
          error: { code: 'NotFound' },
        }),
      },
      key,
    )) {
      /* drain */
    }
  }).toThrow(/ENOENT/)
  const lines: string[] = []
  for await (const line of iterateTranscriptRecordPages(
    {
      readRecords: async () => ({
        ok: true as const,
        value: { items: [{ seq: 1, data: Buffer.from('{"uuid":"a"}\n') }] },
      }),
    },
    key,
  )) {
    lines.push(line)
  }
  expect(lines).toEqual(['{"uuid":"a"}'])
  let calls = 0
  await expect(async () => {
    for await (const _ of iterateTranscriptRecordPages(
      {
        readRecords: async () => {
          calls += 1
          if (calls === 1) {
            return {
              ok: true as const,
              value: {
                items: [{ seq: 2, data: Buffer.from('first\n') }],
                nextSeq: 1,
              },
            }
          }
          return {
            ok: true as const,
            value: {
              items: [{ seq: 99, data: Buffer.from('other\n') }],
            },
          }
        },
      },
      key,
    )) {
      /* drain */
    }
  }).toThrow(/changed between pages/)
})

test('Wt leftover: reverse Qt, skip seen, compact then taint-only, reverse out', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join: pathJoin } = await import('path')
  const { readTranscriptEventsReverse } = await import(
    '../sessionPersistenceSync.js'
  )
  const dir = mkdtempSync(pathJoin(tmpdir(), 'wt-'))
  const file = pathJoin(dir, 't.jsonl')
  writeFileSync(
    file,
    [
      JSON.stringify({ type: 'user', uuid: 'old' }),
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'bound',
      }),
      JSON.stringify({ type: 'user', uuid: 'fresh' }),
      '',
    ].join('\n'),
  )
  const all = await readTranscriptEventsReverse(file)
  expect(Array.isArray(all) && all.map(e => e.uuid)).toEqual(['bound', 'fresh'])
  const unseen = await readTranscriptEventsReverse(file, new Set(['fresh']))
  expect(Array.isArray(unseen) && unseen.map(e => e.uuid)).toEqual(['bound'])
  const sub = await readTranscriptEventsReverse(file, new Set(), false)
  expect(Array.isArray(sub) && sub.map(e => e.uuid)).toEqual(['bound', 'fresh'])
  writeFileSync(
    file,
    `${JSON.stringify({ type: 'history-suppression', sessionId: 'x' })}\n`,
  )
  expect(await readTranscriptEventsReverse(file)).toBe('tainted')
  rmSync(dir, { recursive: true, force: true })
})

test('h4t leftover: Be+uE → xeo; else pto', async () => {
  const src = readFileSync(join(utilsRoot, 'sessionStorage.ts'), 'utf8')
  expect(src).toContain('export function bindMainSessionTranscriptPersistence')
  expect(src).toContain('isHoverRestOn() && storageV5 !== undefined')
  expect(src).toContain('iterateTranscriptRecordPages(')
  expect(src).toContain('export function bindSubagentTranscriptPersistence')
  const { getProjectsDir } = await import('../sessionStorage.js')
  const { recordHoverRestDecision, resetHoverRestPinForTests } = await import(
    '../storageV5/index.js'
  )
  const path = join(getProjectsDir(), 'proj', 'sid.jsonl')
  const sid = '11111111-1111-4111-8111-111111111111'
  const suppression = `${JSON.stringify({ type: 'history-suppression', sessionId: sid })}\n`
  const storage = {
    readRecords: async () => ({
      ok: true as const,
      value: { items: [{ seq: 0, data: Buffer.from(suppression) }] },
    }),
  }
  resetHoverRestPinForTests()
  expect(bindMainSessionTranscriptPersistence(path, storage)).toBeUndefined()
  expect(await scanFileForHistorySuppression(path, { sid }, storage)).toBe(
    'clean',
  )
  recordHoverRestDecision(true)
  expect(bindMainSessionTranscriptPersistence(path, storage)).toEqual({
    backend: storage,
    key: { namespace: 'transcript', projectKey: 'proj', sessionId: 'sid' },
  })
  expect(
    bindMainSessionTranscriptPersistence(join('/tmp', 'sid.jsonl'), storage),
  ).toBeUndefined()
  expect(await scanFileForHistorySuppression(path, { sid }, storage)).toBe(
    'found',
  )
  const { bindSubagentTranscriptPersistence } = await import(
    '../sessionStorage.js'
  )
  const sub = join(
    getProjectsDir(),
    'proj',
    'sid',
    'subagents',
    'agent-aid.jsonl',
  )
  expect(bindSubagentTranscriptPersistence(sub, storage)).toEqual({
    backend: storage,
    key: {
      namespace: 'transcript',
      projectKey: 'proj',
      sessionId: 'sid',
      agentId: 'aid',
    },
  })
  resetHoverRestPinForTests()
})
