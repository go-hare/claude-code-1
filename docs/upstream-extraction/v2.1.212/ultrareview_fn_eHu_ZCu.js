// densable 2.1.212 — eHu (CreateSession events) + ZCu (session link analytics)
// Extracted from densable-212/package/claude.exe

function eHu(e){
  let t=[];
  if(e.permissionMode)t.push({type:"event",data:{type:"control_request",request_id:`set-mode-${Hkt.randomUUID()}`,request:{subtype:"set_permission_mode",mode:e.permissionMode,ultraplan:e.ultraplan}}});
  // interactive (dn=isNonInteractive) + X7t focus:
  if(!dn()&&X7t())t.push({type:"event",data:{type:"control_request",request_id:`apply-flag-settings-${Hkt.randomUUID()}`,request:{subtype:"apply_flag_settings",settings:{viewMode:"focus"}}}});
  let r=bro(); // advisor setting if advisor enabled
  if(r)t.push({type:"event",data:{type:"control_request",request_id:`apply-flag-settings-${Hkt.randomUUID()}`,request:{subtype:"apply_flag_settings",settings:{advisorModel:r}}}});
  if(typeof e.initialMessage==="string"?e.initialMessage:e.initialMessage&&e.initialMessage.length>0)
    t.push({type:"event",data:{uuid:e.initialMessageUuid??Hkt.randomUUID(),session_id:"",type:"user",parent_tool_use_id:null,message:{role:"user",content:e.initialMessage}}});
  return t
}

// X7t: viewMode==="focus" else briefTranscript
// bro: if advisor enabled return settings.advisorModel
// dn: !isInteractive

function ZCu(e,t,r,n){
  // e=sessionId, t=source, r={project,global}, n={endpoint,grouped}
  O("tengu_ccr_session_link",{ccr_session_id:e,source:be(t),create_endpoint:be(n.endpoint),grouped:n.grouped});
  // project/global config flags (hasUsedRemoteSession / hasRemoteEnvironment) —
  // densable GlobalConfig; not present in this fork's config schema
  if(r.project&&!kp().hasUsedRemoteSession)i0((o)=>o.hasUsedRemoteSession?o:{...o,hasUsedRemoteSession:!0});
  if(r.global&&!At().hasRemoteEnvironment)cr((o)=>o.hasRemoteEnvironment?o:{...o,hasRemoteEnvironment:!0})
}

// Qre early gates:
// _8("allow_remote_sessions","Cloud sessions","are") → policy_denied
// !ou() first-party → not_first_party
// no token → onCreateFail(ne,"no_access_token")
// no org → onCreateFail(ne,"no_org_uuid")
// explicit success: ZCu(id, source, {project:!1,global:!1}, {endpoint:"v1",grouped:sessionGroupingId!=null})
