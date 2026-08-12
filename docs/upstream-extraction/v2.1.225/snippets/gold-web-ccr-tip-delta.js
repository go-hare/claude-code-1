/**
 * densable 2.1.225 #10 — Claude Code on the web sessions misreported stuck +
 * growing event backlog on every reconnect.
 *
 * Root cause: full CCR v2 internal-events rehydrate on every resume rewrote
 * local transcript and re-fetched the entire history. Tip sidecar +
 * after_event_id delta fetch stops the backlog growth.
 *
 * SEA gold (sessionStorage + RemoteIO + CCRClient):
 *
 * function Etf(e){ // tip path sibling of session jsonl
 *   let t=uL(e);
 *   return t.endsWith(".jsonl")?t.slice(0,-6)+".ccr-tip.json":t+".ccr-tip.json"
 * }
 * async function wtf(e){ // readCCRTip
 *   try{let t=await Hu.readFile(Etf(e),"utf-8"),r=Zt(t);
 *     if(typeof r==="object"&&r!==null&&"eventId"in r&&typeof r.eventId==="string")return r;
 *     return null}catch{return null}
 * }
 * async function Ctf(e,t){ // writeCCRTip
 *   let r={eventId:t,updatedAt:new Date().toISOString()};
 *   try{await tp(Etf(e),Oe(r),384)}catch(n){E(`Failed to write CCR tip sidecar: ${n}`)}
 * }
 * async function J0a(e){ // updateCCRTipFromAckedBatch
 *   for(let t=e.length-1;t>=0;t--){
 *     // ONLY session_agent_id (subagent stream) — agent_id on fg is OK
 *     let r=e[t]; if(!r||r.session_agent_id)continue;
 *     if(fHr(r.payload)){await Ctf(Ft(),r.payload.uuid);return}
 *   }
 * }
 * async function Dsi(e,t,r){ // getValidatedCCRTip
 *   if(!t)return{fallbackReason:"client-gated"};
 *   let[n,o]=await Promise.all([wtf(e),r!==void 0?r:II(uL(e),65536).catch(()=>null)]);
 *   if(!n)return{fallbackReason:"no-sidecar"};
 *   if(!o||!X0a(o.content).has(n.eventId))return{fallbackReason:"tip-not-in-tail"};
 *   return{eventId:n.eventId}
 * }
 *
 * async function Q0a(e,t,r=!1,n=!1){ // hydrateFromCCRv2InternalEvents
 *   // reader(after_event_id) when tip validated
 *   // if tip not in response but tip in local tail → append delta (ves)
 *   // else full rewrite (e4e); skip zero-content replace when local has content
 *   // tip advance: Ctf(e, j.event_id??j.payload.uuid)
 * }
 *
 * CCRClient:
 *   readInternalEvents(e) → paginatedGet(..., {limit:"1000", ...e&&{after_event_id:e}})
 *   internalEventUploader on ok → onInternalBatchAcked?.(batch)
 *   paginatedGet: after_event_id 400/not-found → anchorFallback + full refetch
 *
 * RemoteIO:
 *   ccrClient.onInternalBatchAcked = J0a
 *   hydratePrefetch when zGv(--resume): Dsi + readInternalEvents(tip) + optional subagent
 *   print.ts: Q0a(sessionId, prefetch, w3i(), C3i())
 *   w3i = tengu_ccr_delta_rehydrate (default false)
 *   C3i = tengu_ccr_subagent_skip_on_delta (default false)
 *
 * Local 1:1:
 *   getCCRTipPathForSession / readCCRTip / writeCCRTip
 *   updateCCRTipFromAckedBatch / getValidatedCCRTip
 *   hydrateFromCCRv2InternalEvents(sessionId, prefetch?, enableDelta?, skipSubagent?)
 *   CCRClient.readInternalEvents(afterEventId?) + onInternalBatchAcked
 *   remoteIO hydratePrefetch + print.ts wiring
 */
