/**
 * densable 2.1.224 #30 — resume must not silently reconnect RC after user
 * turned it off (clearBridgeSession tombstone vs force-on gate).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sessionStorage = readFileSync(
  join(import.meta.dir, '../../utils/sessionStorage.ts'),
  'utf8',
)
const hook = readFileSync(join(import.meta.dir, '../useReplBridge.tsx'), 'utf8')
const sessionRestore = readFileSync(
  join(import.meta.dir, '../../utils/sessionRestore.ts'),
  'utf8',
)
const recovery = readFileSync(
  join(import.meta.dir, '../../utils/conversationRecovery.ts'),
  'utf8',
)
const resumeConversation = readFileSync(
  join(import.meta.dir, '../../screens/ResumeConversation.tsx'),
  'utf8',
)
const repl = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)
const logs = readFileSync(join(import.meta.dir, '../../types/logs.ts'), 'utf8')

describe('densable 2.1.224 #30 resume RC off (bridge-session tombstone)', () => {
  test('logs declare BridgeSessionEntry + LogOption.bridgeSessionId', () => {
    expect(logs).toContain("type: 'bridge-session'")
    expect(logs).toContain('bridgeSessionId: string')
    expect(logs).toContain('bridgeSessionId?: string')
  })

  test('saveBridgeSession / clearBridgeSession (Bkn / EGt) exist', () => {
    expect(sessionStorage).toContain('export function saveBridgeSession(')
    expect(sessionStorage).toContain('export function clearBridgeSession(')
    // tombstone empty string
    expect(sessionStorage).toContain("bridgeSessionId: ''")
    expect(sessionStorage).toContain('lastSequenceNum: 0')
  })

  test('loadTranscriptFile applies tombstone delete (applyBridgeSessionEntry)', () => {
    expect(sessionStorage).toContain('function applyBridgeSessionEntry')
    expect(sessionStorage).toContain('bridgeSessionIds.delete(sid)')
    expect(sessionStorage).toContain('Empty-string tombstone')
  })

  test('LogOption hydrate sites spread bridgeSessionId from maps', () => {
    // loadTranscriptFromFile / loadFullLog / getLastSessionLog / loadAllLogsFromSessionFile
    const sites = sessionStorage.split('bridgeSessionIds.get(sessionId)')
    expect(sites.length).toBeGreaterThan(3)
  })

  test('loadConversationForResume returns bridgeSessionId', () => {
    expect(recovery).toContain('bridgeSessionId?: string')
    expect(recovery).toContain(
      'bridgeSessionId: log?.bridgeSessionId ?? bridgeFromJsonl',
    )
  })

  test('processResumedConversation force-on only with bridgeSessionId and not fork', () => {
    expect(sessionRestore).toContain('result.bridgeSessionId')
    expect(sessionRestore).toContain('!opts.forkSession')
    expect(sessionRestore).toContain('replBridgeEnabled: true')
    expect(sessionRestore).toContain('replBridgeOutboundOnly: false')
    // already full RC guard
    expect(sessionRestore).toContain('replBridgeOutboundOnly')
  })

  test('ResumeConversation mid-picker force-on gated on bridgeSessionId', () => {
    expect(resumeConversation).toContain('result.bridgeSessionId')
    expect(resumeConversation).toContain('!forkSession')
    expect(resumeConversation).toContain('replBridgeEnabled: true')
  })

  test('REPL in-session /resume force-on gated on log.bridgeSessionId', () => {
    expect(repl).toContain('log.bridgeSessionId')
    expect(repl).toContain("entrypoint !== 'fork'")
    // co-located with densable #30 comment
    expect(repl).toContain('2.1.224 #30')
  })

  test('useReplBridge writes tombstone on disable and Bkn on connect/host_exit', () => {
    expect(hook).toContain('clearBridgeSession(')
    expect(hook).toContain('saveBridgeSession(')
    // disable path clears both process meta and transcript
    const disableIdx = hook.indexOf('clearBridgeSessionMeta()')
    expect(disableIdx).toBeGreaterThan(-1)
    expect(hook.indexOf('clearBridgeSession(', disableIdx)).toBeGreaterThan(
      disableIdx,
    )
  })
})
