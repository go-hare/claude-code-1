/**
 * densable 2.1.246 — Bkn owner persist + initReplBridge Fe/Fr/ze/Mr + qs kn().
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('densable 2.1.246 Bkn owner + occupancy owner-match', () => {
  test('saveBridgeSession stamps owner onto transcript and process cache', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../utils/sessionStorage.ts'),
      'utf8',
    )
    expect(src).toContain(
      'owner?.accountUuid ? { ownerAccountUuid: owner.accountUuid }',
    )
    expect(src).toContain(
      'project.currentSessionBridgeOwnerAccountUuid = owner?.accountUuid',
    )
    expect(src).toContain(
      'project.currentSessionBridgeOwnerOrganizationUuid = owner?.organizationUuid',
    )
    expect(src).toContain(
      'ownerAccountUuid: project.currentSessionBridgeOwnerAccountUuid',
    )
    expect(src).toContain('validateUuid(ownerAccountUuid) === null')
    expect(src).toContain('meta.bridgeOwnerAccountUuid')
  })

  test('initReplBridge owner-match Fe/Fr/ze + qn only on Bkn adopt', () => {
    const init = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    expect(init).toContain('tengu_sequential_puffin')
    expect(init).toContain('tengu_bridge_resume_respects_local_owner')
    expect(init).toContain('restored_owner_match_pinned')
    expect(init).toContain('restored_owner_match')
    expect(init).toContain('restored_identity_unreadable')
    expect(init).toContain('restored_owner_unknown')
    expect(init).toContain('Restored-pointer')
    expect(init).toContain('Host-directed')
    expect(init).toContain(
      'the credential store account changed since this conversation',
    )
    expect(init).toContain('owner unconfirmed')
    expect(init).toContain('if (!envReattachSession && restored)')
    expect(init).toContain('isBridgeResumeRespectsLocalOwner()')
    expect(init).toContain(
      "logEvent('tengu_bridge_restored_pointer_takeover', {})",
    )
  })

  test('useReplBridge passes OAuth owner into Bkn', () => {
    const hook = readFileSync(
      join(import.meta.dir, '../../hooks/useReplBridge.tsx'),
      'utf8',
    )
    expect(hook).toContain('accountUuid: ownerAccountUuid')
    expect(hook).toContain('organizationUuid: ownerOrganizationUuid')
  })

  test('qs kn() is isBgSession()', () => {
    const qs = readFileSync(
      join(import.meta.dir, '../../interactiveHelpers.tsx'),
      'utf8',
    )
    expect(qs).toContain(
      'if (isBgSession() || process.env.CLAUDE_BRIDGE_REATTACH_SESSION)',
    )
  })

  test('Kn writes history-suppression taint on owner veto', () => {
    const init = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    expect(init).toContain('writeHistorySuppression(')
    expect(init).toContain("'restored_owner_mismatch'")
    expect(init).toContain("'env_owner_mismatch'")
    expect(init).toContain('reattachOrFail = false')
    expect(init).toContain(
      'leftoverGt / hook pin must not refuse the mint this arm just promised',
    )
    expect(init).toContain("logEvent('rc_cross_account_suppression'")
    const store = readFileSync(
      join(import.meta.dir, '../../utils/sessionStorage.ts'),
      'utf8',
    )
    expect(store).toContain("type: 'history-suppression'")
    expect(store).toContain("cause: 'migration'")
    expect(store).toContain('knownTaintedSessionIds')
    expect(store).toContain('currentSessionHistorySuppressed')
    expect(store).toContain('if (!isSessionPersistenceDisabled())')
    expect(store).not.toContain(
      'isSessionPersistenceDisabled() && (project.sessionFile || fullPath)',
    )
  })

  test('ln/Jn host-directed owner recheck before env-less connect', () => {
    const init = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    expect(init).toContain('hostTargetOwner')
    expect(init).toContain('host_target_owner_recheck_failed')
    expect(init).toContain(
      'Host-directed target on a recorded conversation: owner re-verified immediately before connecting',
    )
    expect(init).toContain('HOST_ACCOUNT_CHANGED_HINT')
    expect(init).toContain('reattachOrFail,')
    expect(init).toContain('reattachOrigin,')
    expect(init).toContain('onReattachGoneBounce')
    expect(init).toContain('ownTitles.add(neutralFallbackTitle)')
    expect(init).toContain('shouldSuppressSessionTitleHistory(getSessionId())')
    expect(init).toContain('onRenameSession')
    expect(init).toContain('Dropping inbound rename mirror')
    expect(init).toContain('!isTeammate() && !foreign')
    expect(init).toContain('applyLeftoverS8nUserName')
    expect(init).toContain('onRenameSession: name propagation failed:')
    expect(init).toContain(
      'markPrecautionarySessionSuppression(getSessionId())',
    )
    expect(init).toContain('clearScanUncertaintyHoldSid(getSessionId())')
    expect(init).toContain('markResilientPrecautionSid(sid)')
    expect(init).toContain("'remote'")
    expect(init).toContain(
      'forceNoHistoryBackfill ||\n        isForeignSessionBinding() ||\n        shouldSuppressSessionTitleHistory(getSessionId())',
    )
    expect(init).toContain('onReattachPointerDead')
    expect(init).toContain('clearBridgeSession(')
    expect(init).toContain('getSessionId() as import(')
    expect(init).toContain('getOauthAccountInfoFromDisk()')
    expect(init).toContain(
      'initialMessages: forceNoHistoryBackfill ? undefined : initialMessages',
    )
    expect(
      init.split(
        'initialMessages: forceNoHistoryBackfill ? undefined : initialMessages',
      ).length - 1,
    ).toBe(2)
    expect(init).toContain(
      'sessionTitleUnlessHistorySuppressed(getCurrentSessionTitle) ?? title',
    )
    expect(init).toContain('} else if (!forceNoHistoryBackfill) {')
    expect(init).toContain("reattachOrigin = 'env_or_fail'")
    expect(init).toContain('reattachOrigin = undefined')
    const auth = readFileSync(
      join(import.meta.dir, '../../utils/auth.ts'),
      'utf8',
    )
    expect(auth).toContain('export function getOauthAccountInfoFromDisk')
    expect(auth).toContain('readGlobalConfigFromDisk()?.oauthAccount')
    const config = readFileSync(
      join(import.meta.dir, '../../utils/config.ts'),
      'utf8',
    )
    expect(config).toContain('export function readGlobalConfigFromDisk')
  })

  test('MCc reattach-or-fail uses official jKe copy', () => {
    const core = readFileSync(
      join(import.meta.dir, '../remoteBridgeCore.ts'),
      'utf8',
    )
    expect(core).toContain('PREVIOUS_SESSION_UNAVAILABLE_DETAIL')
    expect(core).toContain('bridge_repl_v2_revive_reattach_teleported')
    expect(core).toContain('bridge_repl_v2_revive_reattach_gone')
    expect(core).toContain('bridge_repl_v2_revive_fresh_refused')
    expect(core).toContain('onReattachPointerDead?.()')
    const remint = readFileSync(
      join(import.meta.dir, '../remintRecovery.ts'),
      'utf8',
    )
    expect(remint).toContain(
      'Previous session is unavailable — run /remote-control to start a new one',
    )
  })

  test('useReplBridge leftover reattachOrFail is Yn&&W||gt from stash', () => {
    const hook = readFileSync(
      join(import.meta.dir, '../../hooks/useReplBridge.tsx'),
      'utf8',
    )
    expect(hook).toContain(
      'reviveInitiated && lastBridgeSessionIdRef.current !== undefined',
    )
    expect(hook).toContain('leftoverGt = !stashed?.accountUuid')
    expect(hook).toContain('leftoverPn')
    expect(hook).toContain('? false')
    expect(hook).toContain('|| leftoverGt')
    expect(hook).not.toContain('!getOauthAccountInfo()?.accountUuid')
    expect(hook).toContain(
      'suppressHistoryBackfill: leftoverEt || leftoverDt || leftoverMo',
    )
  })
})
