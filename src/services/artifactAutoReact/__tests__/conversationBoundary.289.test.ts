/**
 * densable 2.1.289 F7e / Ktn / N9e conversation-boundary subset.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import {
  clearedArtifactConversationAppState,
  emptyResumedArtifactFrameSeed,
  noteArtifactConversationReset,
  resetArtifactAutoReactStoreForTests,
  restoreResumedArtifactFrameState,
  un,
} from '../index.js'
import { getArtifactAutoReactHolder } from '../store.js'
import { KBe, Ozr, resetConsentStateForTests, _U } from '../readPerm/consent.js'
import type { AppState } from '../../../state/AppStateStore.js'

afterEach(() => {
  resetConsentStateForTests()
  resetArtifactAutoReactStoreForTests()
})

const SRC_ROOT = resolve(import.meta.dir, '../../../')

function seedF7eBags(): ReturnType<typeof un> {
  const store = un()
  store.ownPublishedSlugs.set('a', true)
  store.ownCreatedSlugs.set('a', true)
  store.strandedMints.set('a', true)
  store.reservedMints.add('a')
  store.live.heardVersions.set('a', 1)
  store.roomJoinArming.add('a')
  store.roomStoppedByUser.add('a')
  store.roomArmAsked.set('a', true)
  store.roomArmRefusedByUser.add('a')
  store.live.nonEditorSlugs.add('a')
  store.live.pendingSubagentArms.set('a', true)
  store.live.finishedSubagentAdopters.add('a')
  store.live.repliesConsent.outstanding.set('a', true)
  store.live.repliesConsent.declined.set('a', true)
  store.live.repliesConsent.approved.add('a')
  store.deferredSurface.set('a', true)
  store.remoteControlSkippedSlugs.add('a')
  store.createdFromType.set('a', 'page')
  store.verify.lastPublish = { slug: 'a' }
  store.verify.reads.set('a', 1)
  store.pathPins.set('a', new Map([['p', { seq: 1 }]]))
  store.resultNotes.kindSaid = true
  store.resultNotes.watchCodesSaid.add('x')
  store.resultNotes.previewedPaths.add('/p')
  store.resultNotes.previewHintedPaths.add('/p')
  return store
}

describe('noteArtifactConversationReset (densable F7e subset)', () => {
  test('is a no-op when the store was never created', () => {
    resetArtifactAutoReactStoreForTests()
    noteArtifactConversationReset()
    expect(getArtifactAutoReactHolder().current).toBeUndefined()
  })

  test('a new conversation bumps conversationEpoch; continue does not', () => {
    expect(un().conversationEpoch).toBe(0)
    noteArtifactConversationReset()
    expect(un().conversationEpoch).toBe(1)
    noteArtifactConversationReset({ continuesConversation: true })
    expect(un().conversationEpoch).toBe(1)
    noteArtifactConversationReset()
    expect(un().conversationEpoch).toBe(2)
  })

  test('KBe rotates, so a five-class yes from the last conversation no longer holds', () => {
    un()
    Ozr('foreign_read', '0123abcd-0123-4567-89ab-0123456789ab', true)
    expect(_U('foreign_read', '0123abcd-0123-4567-89ab-0123456789ab')).toBe(
      true,
    )
    const before = KBe()
    noteArtifactConversationReset()
    expect(KBe()).not.toBe(before)
    expect(_U('foreign_read', '0123abcd-0123-4567-89ab-0123456789ab')).toBe(
      false,
    )
  })

  test('clears gold F7e mint/room/live bags unless continuesConversation', () => {
    const store = seedF7eBags()
    noteArtifactConversationReset({ continuesConversation: true })
    expect(store.conversationEpoch).toBe(0)
    expect(store.ownPublishedSlugs.has('a')).toBe(true)
    expect(store.roomJoinArming.has('a')).toBe(true)
    expect(store.live.heardVersions.has('a')).toBe(true)
    expect(store.live.repliesConsent.approved.has('a')).toBe(true)
    expect(store.deferredSurface.has('a')).toBe(true)
    expect(store.pathPins.has('a')).toBe(true)
    expect(store.resultNotes.kindSaid).toBe(true)
    expect(store.createdFromType.size).toBe(0)
    expect(store.verify.lastPublish).toBeUndefined()
    expect(store.verify.reads.size).toBe(0)

    store.createdFromType.set('a', 'page')
    store.verify.lastPublish = { slug: 'a' }
    store.verify.reads.set('a', 1)
    noteArtifactConversationReset()
    expect(store.conversationEpoch).toBe(1)
    expect(store.ownPublishedSlugs.size).toBe(0)
    expect(store.ownCreatedSlugs.size).toBe(0)
    expect(store.strandedMints.size).toBe(0)
    expect(store.reservedMints.size).toBe(0)
    expect(store.live.heardVersions.size).toBe(0)
    expect(store.roomJoinArming.size).toBe(0)
    expect(store.roomStoppedByUser.size).toBe(0)
    expect(store.roomArmAsked.size).toBe(0)
    expect(store.roomArmRefusedByUser.size).toBe(0)
    expect(store.live.nonEditorSlugs.size).toBe(0)
    expect(store.live.pendingSubagentArms.size).toBe(0)
    expect(store.live.finishedSubagentAdopters.size).toBe(0)
    expect(store.live.repliesConsent.outstanding.size).toBe(0)
    expect(store.live.repliesConsent.declined.size).toBe(0)
    expect(store.live.repliesConsent.approved.size).toBe(0)
    expect(store.deferredSurface.size).toBe(0)
    expect(store.remoteControlSkippedSlugs.size).toBe(0)
    expect(store.createdFromType.size).toBe(0)
    expect(store.verify.lastPublish).toBeUndefined()
    expect(store.verify.reads.size).toBe(0)
    expect(store.pathPins.size).toBe(0)
    expect(store.resultNotes.kindSaid).toBe(false)
    expect(store.resultNotes.watchCodesSaid.size).toBe(0)
    expect(store.resultNotes.previewedPaths.size).toBe(0)
    expect(store.resultNotes.previewHintedPaths.size).toBe(0)
  })
})

describe('clearedArtifactConversationAppState (densable Ktn subset)', () => {
  test('empties hosted Vtn bags and zeros the AppState epoch', () => {
    const wipe = clearedArtifactConversationAppState()
    expect(wipe.artifactConsentEpoch).toBe(0)
    expect(wipe.ultrareviewOverageConfirmed).toBe(false)
    expect(wipe.bagelActive).toBeUndefined()
    expect(wipe.bagelUrl).toBeUndefined()
    expect(wipe.bagelPanelVisible).toBeUndefined()
    expect(wipe.computerUseMcpState).toBeUndefined()
    expect(wipe.denialTracking).toBeUndefined()
    expect(wipe.activeGoal).toBeUndefined()
    expect(wipe.queuedGoalOrigin).toBeUndefined()
    expect(wipe.artifactAssetReadConsentSlugs).toEqual({})
    expect(wipe.artifactReadConsentSlugs).toEqual({})
    expect(wipe.artifactAssetReadHumanConsentSlugs).toEqual({})
    expect(wipe.artifactOutsideOrgConsentSlugs).toEqual({})
    expect(wipe.frameUrls).toEqual({})
    expect(wipe.artifactReadVersions).toEqual({})
    expect(wipe.artifactReadObservers).toEqual({})
    expect(wipe.artifactRefs).toEqual([])
    wipe.artifactAssetReadConsentSlugs!['x'] = true
    expect(
      clearedArtifactConversationAppState().artifactAssetReadConsentSlugs,
    ).toEqual({})
    expect(clearedArtifactConversationAppState().frameUrls).toEqual({})
  })

  test('does not invent gold-only Vtn keys tip AppState does not host', () => {
    const wipe = clearedArtifactConversationAppState() as Record<
      string,
      unknown
    >
    for (const key of [
      'webBrowser',
      'workshopTelemetry',
      'frameOpenFailedPath',
      'artifactWatchApproved',
      'artifactRoomJoinConsentSlugs',
      'artifactReadPageDataApproved',
      'artifactPlanPublishConsentPaths',
      'prResolvedThisSession',
      'remoteAutocompactState',
    ]) {
      expect(key in wipe).toBe(false)
    }
  })
})

describe('restoreResumedArtifactFrameState (densable N9e subset)', () => {
  test('continuesConversation restores empty mNr seed without bumping epoch', () => {
    const store = seedF7eBags()
    let state = {
      frameUrls: { old: { url: 'https://claude.ai/code/artifact/old' } },
      artifactReadVersions: { old: 'v1' },
      artifactReadObservers: { old: { main: 'x' } },
      artifactRefs: [{ slug: 'old' }],
    } as unknown as AppState
    restoreResumedArtifactFrameState(
      f => {
        state = f(state)
      },
      emptyResumedArtifactFrameSeed(),
      { continuesConversation: true },
    )
    expect(store.conversationEpoch).toBe(0)
    expect(store.ownPublishedSlugs.has('a')).toBe(true)
    expect(store.createdFromType.size).toBe(0)
    expect(store.pathPins.has('a')).toBe(true)
    expect(state.frameUrls).toEqual({})
    expect(state.artifactReadVersions).toEqual({})
    expect(state.artifactReadObservers).toEqual({})
    expect(state.artifactRefs).toEqual([])
  })

  test('empty seed is gold mNr shape', () => {
    const seed = emptyResumedArtifactFrameSeed()
    expect(seed).toEqual({
      frameUrls: {},
      artifactReadVersions: {},
      artifactRefs: [],
      createdFromType: {},
      pathPins: new Map(),
    })
  })
})

describe('F7e / Ktn / N9e / QAt call sites', () => {
  test('/clear calls F7e and spreads the Ktn Vtn wipe', () => {
    const src = readFileSync(
      new URL('../../../commands/clear/conversation.ts', import.meta.url),
      'utf8',
    )
    expect(src).toContain('noteArtifactConversationReset()')
    expect(src).toContain('...clearedArtifactConversationAppState()')
    expect(src).not.toMatch(
      /noteArtifactConversationReset\(\s*\{\s*continuesConversation/,
    )
  })

  test('rewind QAt calls F7e only — not Ktn, not continuesConversation', () => {
    const src = readFileSync(
      new URL('../../../screens/REPL.tsx', import.meta.url),
      'utf8',
    )
    expect(src).toContain('noteArtifactConversationReset()')
    expect(src).not.toContain('clearedArtifactConversationAppState')
    expect(src).not.toMatch(
      /noteArtifactConversationReset\(\s*\{\s*continuesConversation/,
    )
  })

  test('N9e host is restoreSessionStateFromLog with continuesConversation', () => {
    expect(existsSync(resolve(SRC_ROOT, 'session/SessionController.ts'))).toBe(
      false,
    )
    const restore = readFileSync(
      resolve(SRC_ROOT, 'utils/sessionRestore.ts'),
      'utf8',
    )
    expect(restore).toContain('restoreResumedArtifactFrameState')
    expect(restore).toContain('extractResumedArtifactFrameSeed')
    expect(restore).toContain('isArtifactResumeSeedEligible')
    expect(restore).toContain('continuesConversation: true')
    expect(restore).toContain('conversationBoundary')
  })
})
