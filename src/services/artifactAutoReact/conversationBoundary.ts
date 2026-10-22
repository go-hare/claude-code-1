/**
 * densable F7e / Ktn / N9e conversation-boundary subset (2.1.289).
 * Semantic export only — invent-ban `export function F7e|Ktn|N9e`.
 *
 * Gold F7e(e) @186747228:
 *   if (a().current===undefined) return
 *   unless e?.continuesConversation===true:
 *     conversationEpoch++ AND clear gold bags (ownPublishedSlugs,
 *     ownCreatedSlugs, strandedMints, reservedMints, live.heardVersions,
 *     roomJoinArming / roomStoppedByUser / roomArmAsked /
 *     roomArmRefusedByUser, live.nonEditorSlugs / pendingSubagentArms /
 *     finishedSubagentAdopters, live.repliesConsent, deferredSurface,
 *     remoteControlSkippedSlugs)
 *     gold m(r) @186732956 wipes codeliveredFollowups / coordinatorEditors
 *     — KEEP (tip has no those bags)
 *   ALWAYS: createdFromType.clear(), verify.lastPublish=void 0,
 *     verify.reads.clear()
 *   then if !continuesConversation: pathPins + resultNotes
 *
 * Gold Ktn(e) @199714905 restores empty Vtn @199713637 (plus JCo
 * workshopTelemetry.invokeT0 and webBrowser). Tip wipes hosted Vtn
 * fields plus N9e AppState maps (frameUrls / artifactReadVersions /
 * artifactReadObservers / artifactRefs). KEEP: webBrowser,
 * AppState.workshopTelemetry (JCo), frameOpenFailed*, artifactWatchApproved,
 * artifactDbWrite*, artifactRoomJoinConsentSlugs, artifactReadPageData*,
 * artifactPlanPublishConsentPaths, prResolvedThisSession,
 * remoteAutocompactState.
 *
 * Gold QAt rewind @217225770 calls F7e() only — not Ktn.
 *
 * Gold N9e @190201509: rje() KEEP (bundledSkillSessionResetHooks not hosted);
 * F7e({continuesConversation}); restore createdFromType; if !continue
 * QXt(pathPins) + L7e() KEEP (refusedPublishBodies not hosted); setAppState
 * frameUrls / artifactReadVersions / artifactReadObservers / artifactRefs.
 * Tip host: restoreSessionStateFromLog → Iun(XXt) then
 * restoreResumedArtifactFrameState with continuesConversation:true.
 * Iun returns mNr() empty when !local / !seedEligible.
 */
import type { AppState } from 'src/state/AppStateStore.js'
import { getArtifactAutoReactHolder, un } from './store.js'

export type ArtifactConversationResetOpts = {
  /** densable N9e restore into the same conversation — do not bump the epoch. */
  continuesConversation?: boolean
}

export type ArtifactFrameUrlEntry = {
  url: string
  title?: string
  updatedAt?: number
  sessionMinted?: boolean
}

export type ArtifactRefEntry = {
  slug: string
  pin?: string
}

/** densable mNr @190201227 — empty resume seed. */
export type ResumedArtifactFrameSeed = {
  frameUrls: Record<string, ArtifactFrameUrlEntry>
  artifactReadVersions: Record<string, string>
  artifactRefs: ArtifactRefEntry[]
  createdFromType: Record<string, unknown>
  pathPins: Map<string, Map<string, { seq?: number }>>
}

/**
 * densable F7e portable — bump `conversationEpoch` on a new conversation
 * and clear gold bags. No-op when the store was never created
 * (gold `a().current===undefined`).
 */
export function noteArtifactConversationReset(
  opts?: ArtifactConversationResetOpts,
): void {
  const current = getArtifactAutoReactHolder().current
  if (current === undefined) return
  const continues = opts?.continuesConversation === true
  if (!continues) {
    current.conversationEpoch++
    current.ownPublishedSlugs.clear()
    current.ownCreatedSlugs.clear()
    current.strandedMints.clear()
    current.reservedMints.clear()
    current.live.heardVersions.clear()
    current.roomJoinArming.clear()
    current.roomStoppedByUser.clear()
    current.roomArmAsked.clear()
    current.roomArmRefusedByUser.clear()
    // gold m(r) @186732956 — KEEP (no codeliveredFollowups / coordinatorEditors)
    current.live.nonEditorSlugs.clear()
    current.live.pendingSubagentArms.clear()
    current.live.finishedSubagentAdopters.clear()
    current.live.repliesConsent.outstanding.clear()
    current.live.repliesConsent.declined.clear()
    current.live.repliesConsent.approved.clear()
    current.deferredSurface.clear()
    current.remoteControlSkippedSlugs.clear()
    // gold m(r) @186744402 — judged / judgedSends wipe; sightings stay
    for (const row of current.shareStatus.otherComments.values()) {
      row.judged.clear()
      row.judgedSends.clear()
    }
  }
  current.createdFromType.clear()
  current.verify.lastPublish = undefined
  current.verify.reads.clear()
  if (!continues) {
    current.pathPins.clear()
    current.resultNotes.kindSaid = false
    current.resultNotes.watchCodesSaid.clear()
    current.resultNotes.previewedPaths.clear()
    current.resultNotes.previewHintedPaths.clear()
  }
}

function emptySlugs(): Record<string, true> {
  return {}
}

function emptyFrameUrls(): Record<string, ArtifactFrameUrlEntry> {
  return {}
}

function emptyReadVersions(): Record<string, string> {
  return {}
}

function emptyReadObservers(): Record<string, Record<string, string>> {
  return {}
}

function emptyArtifactRefs(): ArtifactRefEntry[] {
  return []
}

/**
 * densable Ktn / empty-Vtn subset — hosted AppState bags only.
 * Reserved db / upload / handlers maps are wiped for gold shape only;
 * they have no tip writer — empty ≠ granted.
 */
export function clearedArtifactConversationAppState(): Pick<
  AppState,
  | 'bagelActive'
  | 'bagelUrl'
  | 'bagelPanelVisible'
  | 'computerUseMcpState'
  | 'denialTracking'
  | 'activeGoal'
  | 'queuedGoalOrigin'
  | 'ultrareviewOverageConfirmed'
  | 'artifactConsentEpoch'
  | 'artifactReadConsentSlugs'
  | 'artifactAssetReadConsentSlugs'
  | 'artifactAssetReadHumanConsentSlugs'
  | 'artifactOutsideOrgConsentSlugs'
  | 'artifactDbReadConsentSlugs'
  | 'artifactDbReadHumanConsentSlugs'
  | 'artifactAssetUploadConsentSlugs'
  | 'artifactAssetUploadHumanConsentSlugs'
  | 'artifactHandlersReadConsentSlugs'
  | 'artifactHandlersReadHumanConsentSlugs'
  | 'artifactHandlersWriteConsentSlugs'
  | 'artifactHandlersWriteHumanConsentSlugs'
  | 'frameUrls'
  | 'artifactReadVersions'
  | 'artifactReadObservers'
  | 'artifactRefs'
> {
  return {
    bagelActive: undefined,
    bagelUrl: undefined,
    bagelPanelVisible: undefined,
    computerUseMcpState: undefined,
    denialTracking: undefined,
    activeGoal: undefined,
    queuedGoalOrigin: undefined,
    ultrareviewOverageConfirmed: false,
    artifactConsentEpoch: 0,
    artifactReadConsentSlugs: emptySlugs(),
    artifactAssetReadConsentSlugs: emptySlugs(),
    artifactAssetReadHumanConsentSlugs: emptySlugs(),
    artifactOutsideOrgConsentSlugs: emptySlugs(),
    artifactDbReadConsentSlugs: emptySlugs(),
    artifactDbReadHumanConsentSlugs: emptySlugs(),
    artifactAssetUploadConsentSlugs: emptySlugs(),
    artifactAssetUploadHumanConsentSlugs: emptySlugs(),
    artifactHandlersReadConsentSlugs: emptySlugs(),
    artifactHandlersReadHumanConsentSlugs: emptySlugs(),
    artifactHandlersWriteConsentSlugs: emptySlugs(),
    artifactHandlersWriteHumanConsentSlugs: emptySlugs(),
    frameUrls: emptyFrameUrls(),
    artifactReadVersions: emptyReadVersions(),
    artifactReadObservers: emptyReadObservers(),
    artifactRefs: emptyArtifactRefs(),
  }
}

/** densable mNr @190201227 */
export function emptyResumedArtifactFrameSeed(): ResumedArtifactFrameSeed {
  return {
    frameUrls: {},
    artifactReadVersions: {},
    artifactRefs: [],
    createdFromType: {},
    pathPins: new Map(),
  }
}

/** densable JXt @190199900 — observers stub `{main:""}` per version slug. */
export function artifactReadObserversFromVersions(
  versions: Record<string, string>,
): Record<string, { main: string }> {
  return Object.fromEntries(
    Object.keys(versions).map(slug => [slug, { main: '' }]),
  )
}

/**
 * densable N9e portable — F7e then restore createdFromType / AppState
 * frame maps. rje / L7e KEEP. QXt only when !continuesConversation.
 */
export function restoreResumedArtifactFrameState(
  setAppState: (f: (prev: AppState) => AppState) => void,
  seed: ResumedArtifactFrameSeed = emptyResumedArtifactFrameSeed(),
  opts?: ArtifactConversationResetOpts,
): void {
  const continues = opts?.continuesConversation === true
  noteArtifactConversationReset({ continuesConversation: continues })
  // Gold N9e `X()` after F7e — create the store so createdFromType restore lands.
  const current = un()
  for (const [key, value] of Object.entries(seed.createdFromType)) {
    current.createdFromType.set(key, value)
  }
  if (!continues) {
    for (const [slug, pins] of seed.pathPins) {
      const next = new Map<string, { seq?: number }>()
      for (const [key, pin] of pins) {
        current.pathPinSeq += 1
        next.set(key, { ...pin, seq: current.pathPinSeq })
      }
      current.pathPins.set(slug, next)
    }
  }
  const observers = artifactReadObserversFromVersions(seed.artifactReadVersions)
  const frameUrls = seed.frameUrls
  const versions = seed.artifactReadVersions
  const refs = seed.artifactRefs
  setAppState(prev => ({
    ...prev,
    frameUrls,
    artifactReadVersions: versions,
    artifactReadObservers: observers,
    artifactRefs: refs,
  }))
}
