/**
 * densable 2.1.225 #7 — RC resume history after large compact.
 *
 * SEA gold (sessionStorage persistToRemote + jCt/oHr/Dtf/qCt):
 *
 * function OR(e){return e?.type==="system"&&e.subtype==="compact_boundary"}
 * function oHr(e){return OR(e)||e.type==="user"&&e.isCompactSummary===!0}
 * function Dtf(){return Otf?.()===!0}
 * function jCt(){return zCt()?.noHistoryBackfill===!0||Dtf()}
 * function qCt(e){Otf=e}
 *
 * async persistToRemote(e,t){
 *   if(nE()&&!(this.internalEventWriter&&WiS(t)))return;
 *   if(oHr(t)&&jCt()){
 *     E("[persist-remote] Skipping compact-pair upload: session carries history-backfill suppression");
 *     return
 *   }
 *   if(this.internalEventWriter){
 *     await this.internalEventWriter("transcript",t,{
 *       ...OR(t)&&{isCompaction:!0,preservedEventIds:t.compactMetadata.preservedMessages?.uuids},
 *       ...t.agentId&&{agentId:t.agentId}
 *     })
 *     return
 *   }
 *   ...
 * }
 *
 * Live probe registration (useReplBridge / remote bridge connect):
 *   qCt(()=>sE()?.noHistoryBackfill===!0)
 * Handle return after mint-after-gone:
 *   noHistoryBackfill:a||tr  (tr = Ge / skipInitialHistoryFlush)
 *
 * Local 1:1:
 *   isCompactPairEntry ≈ oHr
 *   isCompactPairWithheldFromRemote ≈ jCt
 *   registerLiveSuppressionProbe ≈ qCt
 *   isLiveBridgeSuppressed ≈ Dtf
 *   getCurrentSessionBridge ≈ zCt
 *   persistToRemote early-return on compact pair + withhold
 *   remoteBridgeCore.noHistoryBackfill = skipInitialHistoryFlush
 *   useReplBridge: saveBridgeSession(..., noHistoryBackfill) + qCt probe
 */
