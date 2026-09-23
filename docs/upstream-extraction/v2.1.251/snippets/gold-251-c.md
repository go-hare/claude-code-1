# gold-251-c bullets 12,13,16,17,18

exe bytes=217360032

Method: `allHits` per needle. Enclosing function is `lastFnStartGeneric` walked outward until `extractFnAt` covers the hit, or `extractFnAt` on the `function` keyword when the marker is the start. `sha256_16` hashes the full extracted body. Excerpts are at most 3500 characters.

## #12 fresh install starts in auto when the account startup default is auto

- `startup default` hits=0 offsets=(none)
- `auto mode` hits=256 offsets=92378502,92384201,92400350,92442937,92443009,92454277,92591567,92642467,92642497,92644275,92644324,93255932,93423074,93476102,93479743,93936620 … +240
- `fresh install` hits=0 offsets=(none)
- `defaultMode` hits=103 offsets=92225005,92251980,92252024,92258364,94307693,94313098,94313304,95054616,97768617,97769225,97913453,98360868,99209773,100561225,101588812,178923370 … +87

### #12 functions
##### `kgn` no-mode fallback
#### `kgn` @181693658
- len=3462 sha256_16=86104eaa90a6018e

```
function kgn(e){let{cli:o,env:t,settings:r,agentFrontmatter:u}=e,f=ym(o.permissionMode),i=o.dangerouslySkipPermissions,d=u?.permissionMode,p=Boolean(i||f||d);if(Oe(t.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB)){let l=i||f&&f!=="default"||d&&d!=="default",b="Permission mode forced to default \u2014 CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set "+"(allowed_non_write_users hardening). Declare allowedTools explicitly, or set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0 to opt out.";return{mode:"default",notification:l?b:void 0,fromAutoFallback:!1,baselineMode:"default",decidedByProactivityLevel:!1,modeSuppliedOnInvocation:!0}}let E=r.permissions?.disableBypassPermissionsMode==="disable",m=B(),g=!m&&!N(r),c=[],S;if(i)if(V("bypassPermissions"))S=R,c.push("default");else c.push("bypassPermissions");if(f){let l=vw(f);if(V(l))S=R,c.push("default");else if(l==="auto"&&m)n("auto mode killswitch active (override- or payload-served) \u2014 falling back to default",{level:"warn"});else c.push(l)}if(d)if(d==="auto"&&m)n("agent frontmatter requested auto mode but circuit breaker active \u2014 falling through",{level:"warn"});else c.push(d);if(pN()){let l=!Uht()?void 0:w().map((b)=>ym(_e(b)?.permissions?.defaultMode)).find((b)=>b!=null);if(l!=null&&Oe(t.CLAUDE_CODE_REMOTE)&&!x(l)){if(n(`settings defaultMode "${l}" is not supported in CLAUDE_CODE_REMOTE \u2014 only acceptEdits, plan, default, and auto are allowed`,{level:"warn"}),c.length===0)s("tengu_ccr_unsupported_default_mode_ignored",{mode_hash:qn(l)}),c.push("default")}else if(l==="bypassPermissions"){if(i||o.allowDangerouslySkipPermissions)c.push(l);else if(c.length===0)S='Permission mode bypassPermissions from settings was ignored \u2014 enable the "Claude Code: Allow Dangerously Skip Permissions" setting in VS Code to consent to it',n('settings defaultMode "bypassPermissions" ignored for a VS Code-owned session without the allow-bypass setting',{level:"warn"}),s("tengu_settings_bypass_unconsented_noninteractive_ignored",{}),process.stderr.write(`\u26A0 ${S}
`),c.push("default")}else if(l==="auto")if(!m)c.push(l);else n('settings defaultMode "auto" ignored for the IDE session \u2014 auto-mode circuit breaker is active',{level:"warn"});else if(l!=null)c.push(l)}else if(r.permissions?.defaultMode){let l=ym(r.permissions.defaultMode);if(Oe(t.CLAUDE_CODE_REMOTE)&&!x(l))n(`settings defaultMode "${l}" is not supported in CLAUDE_CODE_REMOTE \u2014 only acceptEdits, plan, default, and auto are allowed`,{level:"warn"}),s("tengu_ccr_unsupported_default_mode_ignored",{mode_hash:qn(l)});else if(l!=="auto")c.push(l);else if(!U())n('settings defaultMode "auto" ignored \u2014 only policy/user/flag settings may grant auto mode (projectSettings and localSettings are repo-controllable)',{level:"warn"}),s("tengu_settings_auto_mode_untrusted_source_ignored",{});else if(m)n("auto mode killswitch active (override- or payload-served) \u2014 falling back to default",{level:"warn"});else c.push("auto")}let v;for(let l of c){if(l==="bypassPermissions"&&E){n("bypassPermissions mode is disabled by settings",{level:"warn"}),S="Bypass permissions mode was disabled by settings";continue}v={mode:l,notification:S};break}let L=!1;if(!v){let l="default";if(g&&Uht()&&(!o.isNonInteractiveSession||pN()||I("tengu_moss_anchor",!1)))l="auto",L=!0;v={mode:l,notification:S}}let M=v.mode,h=!1;return{mode:v.mode,notification:v.notification,fromAutoFallback:L,baselineMode:M,decidedByProactivityLevel:h,modeSuppliedOnInvocation:p}}
```

##### `Uht` gate
#### `Uht` @181699368
- len=78 sha256_16=400e4c895c6c79a3

```
function Uht(){return I("tengu_harbor_willow",!1)||Pwn()?.meadow_lantern===!0}
```

##### `autoDefaultLaunchEnabled` @184273975
#### `b3n` @184272720
- len=1622 sha256_16=4d75a5d608582262

```
function b3n(e,t){let r=e.find((o)=>o.name==="claude-vscode");if(r&&r.type==="connected"){Wt().vscodeClient=r,nx(r,hun(),async(d)=>{let{eventName:y,eventData:k}=d.params;if(y==="tengu_feedback_survey_event"){if(r.config?.type==="sdk"&&pN())t?.onFeedbackSurveyEvent?.(k);return}if(y==="auto_default_nudge_shown"||y==="auto_default_nudge_resolved"){if(r.config?.type==="sdk"&&pN())t?.onAutoDefaultNudgeEvent?.(y==="auto_default_nudge_shown"?"shown":"resolved",k);return}s(`tengu_vscode_${y}`,k)}),Yi(r.client).onerror=j1t("vscode_notification_channel_error","claude-vscode");let o={tengu_vscode_review_upsell:I("tengu_vscode_review_upsell",!1),tengu_cobalt_harbor_notice:I("tengu_cobalt_harbor_notice",!0),tengu_vscode_onboarding:I("tengu_vscode_onboarding",!1),tengu_vscode_resume_precheck:I("tengu_vscode_resume_precheck",!0),tengu_quiet_fern:!0,tengu_vscode_cc_auth:!0,tengu_slate_ribbon:!0,tengu_brick_follow:I("tengu_brick_follow",!1),tengu_vellum_siding:I("tengu_vellum_siding",!1),tengu_lantern_sconce:I("tengu_lantern_sconce",!1),tengu_loggia_carousel:t?.refusalFallbackLaneEnabled??!1,tengu_loggia_carousel_config:t?.refusalFallbackSettingToggleVisible??!1,fable5_launch_show:t?.fable5LaunchShow??!1,startup_announcement:t?.startupAnnouncement??!1,tengu_harbor_willow:t?.autoDefaultLaunchEnabled??!1},u=XKt();o.tengu_auto_mode_state=u==="opt-in"?"enabled":u,Yi(r.client).notification({method:"experiment_gates",params:{gates:o}}).catch((d)=>{let y="unreadable error value";try{let k=d?.message;y=typeof k==="string"?k:String(d)}catch{}try{n(`[VSCode] Failed to send experiment_gates notification: ${y}`)}catch{}})}}
```

**Verdict:** BODY

`kgn` leaves mode `"default"` when nothing supplied a mode, and sets it to `"auto"` (`fromAutoFallback`) when `Uht()` is on. `Uht` is the `tengu_harbor_willow` gate or client-data `meadow_lantern`. The same gate is published from `autoDefaultLaunchEnabled`. Strings "startup default" and "fresh install" are absent; the fallback is the no-configured-mode path.

## #13 xhigh/max effort with thinking disabled is sent as high

- `is not supported when thinking is disabled` hits=2 offsets=96207194,185001006
- `effort` hits=857 offsets=82273166,82285917,82320844,82342479,84814092,84815571,84982800,89187944,92216152,92222680,92232632,92236130,92279417,92319049,92376348,92387056 … +841
- `xhigh` hits=114 offsets=92762152,92769288,93532953,94108609,94108953,94109230,94109350,94109623,94109963,94110173,95137081,97767308,98234110,98431911,98630414,98630762 … +98
- `thinking is disabled` hits=6 offsets=96207216,97225405,98630112,179845471,185001028,187348566

### #13 functions
##### clamp `ga.effort=Wht` @187348774
#### `GMt` @187317884
- len=98139 sha256_16=335aeb24bf070d4f
- note: extractFnAt span includes `}function ` at +398, before the focus at +30890 (a regex literal containing a quote keeps the brace matcher inside a string)

```
…,Up=void 0;if(xg&&tSn(F)){let vs=Oe(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING)&&(W.includes("opus-4-6")||W.includes("sonnet-4-6")),cu=UIn(d.model);if(cu!==void 0?cu==="adaptive":Xve(F)&&!vs)Up={type:"adaptive",display:HS};else{let Gc=Qer(F);if(r.type==="enabled"&&r.budgetTokens!==void 0)Gc=r.budgetTokens;Gc=Math.max(1024,Math.min(Ia-1,Gc)),Up={budget_tokens:Gc,type:"enabled",display:HS}}}else if(r.type==="disabled"&&Ne()==="firstParty"&&!Mc&&tSn(F)&&!0&&!NOe(F))Up={type:"disabled"};let nv=r.type==="disabled"?void 0:r,PA=nv?.display,rv="none";try{rv=FMt(PA,F,nv?.displayExplicit??Okt())}catch(vs){h(vs)}let H0=()=>{let vs=Ir.indexOf(Obt);if(vs!==-1)Ir.splice(vs,1)};if(Up&&HS)H0();switch(rv){case"thinking_and_connector_text":case"none":break;case"connector_text":{if((Up?.type==="adaptive"||Up?.type==="enabled")&&eS&&Ne()==="firstParty"&&jo()&&!K6()&&!("thinking"in sa)&&!bA(nt,L6)&&!a.CLAUDE_CODE_SIMULATE_PROXY_USAGE){if(Up={...Up,display:"updates"},!Ir.includes(L6))Ir.push(L6);H0()}break}}let r2=Up?.type==="enabled"||Up?.type==="adaptive"||Up===void 0&&NOe(F),fI=d.toolChoice;if(fI?.type==="tool"&&r2)n(`tool_choice {type:'tool', name:'${fI.name}'} demoted to auto: extended thinking is active`),fI={type:"auto"};let Vm=r.type==="disabled"&&r.mechanical===!0;if(Up?.type==="disabled"&&(Vm||SJn(F))&&typeof ga.effort==="string"&&bJn(ga.effort)){if(!n2)n2=!0,n(`output_config.effort '${ga.effort}' clamped to '${Wht}': thinking is ${Vm?"mechanically ":""}disabled for this request, and this model rejects higher effort when thinking is disabled`);if(!Vm&&Xl(d.querySource)==="main"&&Du().once("effort_thinking_disabled_clamp"))s("tengu_effort_clamped_thinking_disabled",{from:c(ga.effort),to:c(Wht),query_source:RE(d.querySource)});ga.effort=Wht}let qS=DMt({hasThinking:xg}),xA=d.enablePromptCaching??S4e(me??ir.model),ov;if(Xr()&&tb()&&!CV()&&sp(fe)&&!!ir.fastMode)ov="fast";if(Or&&!Ir.includes(H9e))Ir.push(H9e);if(ZT&&er&&rSn()&&U&&!Ir.includes(ZT)){if(Ir.push(ZT),xVt())n(`auto-mode 3P: sending afk-mode beta '${ZT.header}' to ${bo} via betas header`)}if(Sr==="1h"&&dw()&&!Ir.includes(AOe))Ir.push(AOe);let MA=null,sv=nr?.buildRequestParams(pn);if(sv)Ir.push(sv.beta),MA=sv.body;let iv=null;if(Ei&&xA){if(!Ir.includes(Gde))Ir.push(Gde);iv={cache_control:{type:"ephemeral",...Sr&&{ttl:Sr},evict_on_complete:!0}}}if(Cn&&!Ir.includes(Vde))Ir.push(Vde);let jy=a.CLAUDE_CODE_SIMULATE_PROXY_USAGE,s2=rr!==null&&!jy?rr.plan(pn):null,KS=$bt!==null&&bA(nt,$bt)?null:s2,uo=jy?Ir.filter((vs)=>vs===Nve):Ir;if(jy)n(`[API:client] SIMULATE_PROXY_USAGE: stripping ${Ir.length-uo.length} beta headers from request (keeping ${hk(uo).join(", ")||"none"}): ${hk(Ir).join(", ")}`);let yd=!xg&&RVt(F)?d.temperatureOverride??1:void 0;Rp=hk(uo);let Bu=oSn(uo),Br=Qn&&(!jy||uo.length>0)&&(Bu.includes(GH)||pg!==null&&Bu.includes(pg));if(ar=Br&&bK(pn),!Br&&bK(pn))bn="error_recovery";if(d.onWireMessagesBuilt!==void 0){let vs=pn;if(aZe(vs))try{vs=Wf(vs),F7(vs)}catch{}d.onWireMessagesBuilt(vs)}let hp=po=T8n(yIt(pn,Br),xA,Sr,d.skipCacheWrite,d.forkPointUuid,bA(nt,Nbt)||zIn(),bo,KS!==null,!jy&&iv!==null||sa.cache_control!=null),Mr=(vs)=>Array.isArray(vs.content)&&vs.content.some((cu)=>typeof cu==="object"&&cu!==null&&("cache_control"in cu)&&cu.cache_control!=null);mn=hp.some((vs)=>vs.role==="system"&&Mr(vs)),hn=hp.some(Mr);let ui={model:qP(d.model),messages:KS!==null&&KS.sliceFrom>0?hp.slice(KS.sliceFrom):hp,system:wn,tools:r5n(Yn,d.model),tool_choice:fI,...Qn&&(!jy||uo.length>0)&&{betas:hk(oS…
```

##### `d6e` API-error parse
#### `d6e` @185000915
- len=163 sha256_16=33d792b840da757e

```
function d6e(e){if(!(e instanceof Gt)||e.status!==400)return null;return/effort '([a-z]+)' is not supported when thinking is disabled/i.exec(e.message)?.[1]??null}
```

##### `bJn` rank above high
#### `bJn` @181686675
- len=42 sha256_16=dbc17e57ca8d642d

```
function bJn(e){return jT(e)&&y(e)>y(Wht)}
```

##### `SJn` opus-5 / thinking_disabled_effort_cap
#### `SJn` @181686717
- len=98 sha256_16=90f29ac8a2bc3a57

```
function SJn(e){let o=Xe(e);return o==="claude-opus-5"||_h(o,"thinking_disabled_effort_cap")===!0}
```

##### binding @181686660 / @181685068

```
var jh=["low","medium","high","xhigh","max"],EWt="Fable 5, Opus 4.7+, Sonnet 5",
"xhigh"}function jT(e){return jh.includes(e)}function y(e){return jh.indexOf(e)}var Wht="high";function bJn(e){return jT(e)&&y(e)>y(Wht)}function SJn(e){let o=Xe(e);return o==="claude-opus-5"||_h(o,"thinking_disabled_effort_cap")===!0}function f5e(e){let o=Ne();if(o!=="firstParty"&&o!=="gateway")ret
```

**Verdict:** BODY

The request builder assigns `ga.effort=Wht` when thinking is disabled and `bJn(ga.effort)`. `var Wht="high"`. `jh` is `low|medium|high|xhigh|max`, so `bJn` is rank above high (xhigh and max). `SJn` includes `claude-opus-5`. `d6e` only reads the API error `/effort '([a-z]+)' is not supported when thinking is disabled/`; it does not throw. `extractFnAt` names the builder span `GMt` and runs past a later `function` because a regex contains a quote.

## #16 teammate final answer is carried on the idle notification

- `idle notification` hits=14 offsets=92501568,92501715,92501953,92502023,92502082,92576480,95248421,197099079,202678699,202679148,202679300,202679804,202679946,202680004
- `available` hits=3545 offsets=66501761,66868230,66869271,66884693,66884787,66885294,66886338,66886520,66887706,66982260,67746386,67795574,67795702,68755280,68790580,68825364 … +3529
- `teammate` hits=699 offsets=92188295,92261688,92282292,92301561,92301589,92301888,92302028,92318469,92374749,92386788,92413593,92429892,92447274,92447325,92447397,92447461 … +683

### #16 functions
##### `JH` teammate Stop hook
#### `JH` @202677752
- len=1629 sha256_16=c3e525af9d5bc009

```
async function JH(b,R,x,P,j){let{teamName:Z,agentId:re,agentName:ue}=P,de=await Tp(Z,j);if(!de){n(`[TeammateInit] Team file not found for team: ${Z}`);return}let fe=VH(Ci,Z),we=de.teamAllowedPaths;if(we&&we.length>0&&NP())n(`[TeammateInit] Skipping ${we.length} team-wide allowed path(s): permission rules are restricted to managed settings (allowManagedPermissionRulesOnly)`),we=[];if(we&&we.length>0){n(`[TeammateInit] Found ${we.length} team-wide allowed path(s)`);for(let Re of we){let Me=b8e(Re.path),Pe=UEt(Me),$e=Me.startsWith("/")?`/${Pe}/**`:Pe.startsWith("\\")?`./${Pe}/**`:`${Pe}/**`;n(`[TeammateInit] Applying team permission: ${Re.toolName} allowed in ${Re.path} (rule: ${$e})`),b((Ie)=>({...Ie,toolPermissionContext:Uc(Ie.toolPermissionContext,{type:"addRules",rules:[{toolName:Re.toolName,ruleContent:$e}],behavior:"allow",destination:"session"})}))}}let Ce=Ci;if(re===fe){n("[TeammateInit] This agent is the team leader - skipping idle notification hook");return}n(`[TeammateInit] Registering Stop hook for teammate ${ue} to notify leader ${Ce}`),R.addFunctionHook(x,"Stop","",async(Re,Me)=>{c5e(Z,ue,!1,j);let{result:Pe,summary:$e}=aye(Re,{emitTelemetry:!0}),Ie=IMe(ue,{idleReason:"available",summary:$e,result:Pe}),qe;try{qe=await jg(Ce,{from:ue,text:S(Ie),timestamp:new Date().toISOString(),color:lb()},void 0,j)}finally{hEe(Ie,Pe,qe)}return n(qe!==void 0?`[TeammateInit] Sent idle notification to leader ${Ce}`:`[TeammateInit] Idle notification to leader ${Ce} not delivered (mailbox write returned no id)`),!0},"Failed to send idle notification to team leader",{timeout:1e4,id:"teammate-idle-notification"})}
```

##### `IMe` idle_notification
#### `IMe` @181666523
- len=382 sha256_16=88b75e9b83c5a7fa

```
function IMe(e,t){let s=lyr(t?.result,t?.senderReachable??t?.idleReason!=="failed")||void 0;return{type:"idle_notification",from:e,timestamp:new Date().toISOString(),idleReason:t?.idleReason,summary:t?.summary?xP(t.summary):void 0,completedTaskId:t?.completedTaskId,completedStatus:t?.completedStatus,failureReason:e5e(t?.failureReason?xP(t.failureReason):void 0)||void 0,result:s}}
```

##### `lyr` result text
#### `lyr` @181659488
- len=216 sha256_16=aa7bec7e816d03c1

```
function lyr(e,t=!0){let s=e?$e(e):"";if(!s)return"";let r=ce(s,RP);if(r.length>=s.length)return r;let o=xP(r);return t?`${o}
[result truncated \u2014 ask the agent for the rest via ${Yr}]`:`${o}
[result truncated]`}
```

##### in-process idle send @197099060
#### `lfr` @197090863
- len=10054 sha256_16=5c2869028e36792c

```
…et(B);ce.delete(ee.tool_use_id),B=ce}}}return{...C,messages:UGn(C.messages,o),inProgressToolUseIDs:B}})}return{success:!0,messages:de}})).finally(()=>{if(X)u.push(...X.preserved),X=null}),F(t,(o)=>({...o,currentWorkAbortController:void 0}),a),R.signal.aborted)break;let oe=ke||A.signal.aborted;if(oe){pe=!0,n(`[inProcessRunner] ${e.agentId} work interrupted, returning to idle`);let o=qo({content:JC});a.updateTranscript(t,(p)=>({...p,messages:Ile(p.messages,o)}))}Se||=de.some((o)=>o.type==="assistant"&&!o.isApiErrorMessage||o.type==="user");let Z=!oe?Sun(de):void 0;if(se=Z?.isTransient===!0&&!y&&Se,!y&&!oe){let o=null;try{o=await Ee(e,t,a,d.storageV5)}catch(p){n(`[inProcessRunner] ${e.agentName} turn-end mailbox check failed: ${p}`)}if(o){try{let{result:p,summary:C}=aye(u,{emitTelemetry:!0});if(p!==void 0||Z!==void 0){if(await _e(e.agentName,e.color,e.teamName,{idleReason:Z!==void 0?"failed":void 0,summary:C,failureReason:Z?.reason,result:p,senderReachable:!0},d.storageV5)&&p!==void 0)ue=p}}catch(p){n(`[inProcessRunner] ${e.agentName} turn-end result delivery failed: ${p}`)}await Ae(o);continue}}if(Z?.isTransient)s("tengu_teammate_transient_turn_failure",{error_kind:c(Z.errorKind??"unknown"),hold_evict:se});let we=d.getAppState().tasks[t],Ue=we?.type==="in_process_teammate"&&we.isIdle;F(t,(o)=>(o.onIdleCallbacks?.forEach((p)=>p()),{...o,isIdle:!0,evictAfter:se?void 0:Date.now()+BR,onIdleCallbacks:[]}),a);let Te=Z?.reason;if(!Ue&&!y){let o=aye(u,{emitTelemetry:!oe}),p=oe?void 0:o.result,C=await _e(e.agentName,e.color,e.teamName,{idleReason:oe?"interrupted":Te!==void 0?"failed":"available",summary:o.summary,failureReason:Te,result:p,senderReachable:Te===void 0||se},d.storageV5);if(p!==void 0&&C)ue=p}else n(`[inProcessRunner] Skipping duplicate idle notification for ${e.agentName}`);n(`[inProcessRunner] ${e.agentId} finished prompt, waiting for next`);let Oe=await Ve(e,R,t,d.getAppState,a,e.parentSessionId,y,ae,se,d.storageV5);await Ae(Oe)}let re=!1,v;if(F(t,(A)=>{if(A.status!=="running")return re=!0,A;return v=A.toolUseId,A.onIdleCallbacks?.forEach((G)=>G()),{...A,status:"completed",notified:!0,endTime:Date.now(),pendingUserMessages:[],abortController:void 0,currentWorkAbortController:void 0,retryWake:void 0,onIdleCallbacks:[]}},a),!re)a.updateTranscript(t,(A)=>({...A,messages:A.messages.length?[A.messages.at(-1)]:[],inProgressToolUseIDs:new Set}));if(_d(t),a.evictTerminal(t),!re)_s(t,"completed",{toolUseId:v,summary:e.agentId});if(qce(e.agentId),Ie)g("swarm_in_process_run","compact_blocked_by_hook");else _("swarm_in_process_run");return{success:!0,messages:u}}catch(I){let q=I instanceof Error?I.message:"Unknown error";n(`[inProcessRunner] Agent ${e.agentId} failed: ${q}`);let O=!1,re;if(F(t,(v)=>{if(v.status!=="running")return O=!0,v;return re=v.toolUseId,v.onIdleCallbacks?.forEach((A)=>A()),{...v,status:"failed",notified:!0,error:q,isIdle:!0,endTime:Date.now(),onIdleCallbacks:[],pendingUserMessages:[],abortController:void 0,currentWorkAbortController:void 0,retryWake:void 0}},a),!O)a.updateTranscript(t,(v)=>({...v,messages:v.messages.length?[v.messages.at(-1)]:[],inProgressToolUseIDs:new Set}));if(_d(t),a.evictTerminal(t),!O)_s(t,"failed",{toolUseId:re,summary:e.agentId});if(!y){let v;try{v=pe?void 0:vBn(u)}catch(A){n(`[inProcessRunner] ${e.agentName} failed to extract partial result: ${A}`)}if(v!==void 0&&v===ue)v=void 0;await _e(e.agentName,e.color,e.teamName,{idleReason:"failed",completedStatus:"failed",failureReason:q,result:v},d.sto…
```

**Verdict:** BODY

`JH` builds the leader idle notification with `idleReason:"available"` plus `summary` and `result` from `aye`, then writes that object as the mailbox text. `IMe` sets `type:"idle_notification"` and `result` from `lyr` (the result text). The in-process runner passes the same `result` on the available/failed/interrupted idle send. That is the final answer on the idle notification, not only the available token.

## #17 background reply: `from` is an address, not the agent type

- `not reachable` hits=25 offsets=88504974,94080908,94976408,94998347,95710103,99359746,99844366,99866632,99986018,99996662,178857648,178859870,183655854,190547503,192110369,193995168 … +9
- `from was the agent type` hits=0 offsets=(none)
- `unnamed` hits=66 offsets=82410281,83812929,84110387,84898007,84903694,92443157,92443181,92443213,92443769,92456217,92548185,92826144,93716370,93919685,94605856,94764280 … +50

### #17 representative windows
- @99359726 n stop`) and retry..*....?	.warning: the service manager accepted the ..2....N.., but the installed daemon is not reachable after ..........s. ..  .t.h.e. .f.i.r.s.t. .s.t.a.r.t. .a.f.t.e.r. .a.n. .u.p.d.a.t.e. .c.a.n. .b.e. .s.l.
- @95710092 ttings.........fI.iterm2_explicit_no_it2........S.teammateMode is set to "iterm2" but the it2 CLI is not reachable. Install it with `pip install it2` and enable the Python API in iTerm2 (Preferences > General > Magic > Enable Pyth
- @183655854 on nCr(){return a.CLAUDE_CODE_REMOTE===!0&&!a.CLAUDE_TRUSTED_DEVICE_TOKEN&&BGt()}var jGt="not reachable from a cloud session \u2014 that session requires a trusted device, which a cloud session never has; message it from one of yo
- @186222152 Date.now()-r.lastUsedAt)/86400000,u=Math.pow(0.5,o/7);return r.usageCount*Math.max(u,0.1)}function gmt(e){let t=lE(e);return t===lE("")?"(unnamed agent)":t}function ymt(e,t,r){return`${gmt(e)} agent: ${Nh(t,r)}`}function UMn(e,t,r

**Verdict:** STRING-ONLY

`"from was the agent type"` hits=0. `not reachable` windows are daemon, iTerm `it2`, cloud trusted-device, and machine-copy strings. `unnamed` windows are plugin, cell, session, tool, and `(unnamed agent)` display labels. None of those function bodies set `from` to an agent id or name for an unnamed sibling or parent.

## #18 mid-session managed disableAutoMode moves auto back to default

- `disableAutoMode` hits=19 offsets=92268240,92326008,96993624,99573735,179788508,179855121,180124624,180124824,181699727,181699758,186055026,186055847,186055891,191262423,191262470,191707710 … +3

### #18 functions
##### `Int` settings changed
#### `Int` @190709376
- len=803 sha256_16=03f115d399d33567

```
function Int(t,o,r,i){let l=Je();n(`Settings changed from ${t}, updating app state`),wfe();let T=cV();PD({userLayer:"retain"}),pH();let p=!1;if(o((b)=>{let R=AVe(b.toolPermissionContext,T);R=sJt(R,b.settings.permissions?.additionalDirectories,ade(),t,i?.trustFlip===!0,i?.prevCwd);let I=iJt(R,T);R=I.context,p=I.exitedAutoMode;let x=OHe();if(b.settings.effortLevel!==l.effortLevel||S(b.settings.modelSettings)!==S(l.modelSettings))Lm(r);let L=t==="policySettings"&&(S(b.settings.allowedMcpServers)!==S(l.allowedMcpServers)||S(b.settings.deniedMcpServers)!==S(l.deniedMcpServers)||b.settings.disableClaudeAiConnectors!==l.disableClaudeAiConnectors);return{...b,settings:l,toolPermissionContext:R,...L&&{policyVersion:b.policyVersion+1},...b.awaySummaryEnabled!==x&&{awaySummaryEnabled:x}}}),p)oJt.emit()}
```

##### `iJt` exit auto when policy disables it
#### `iJt` @190710208
- len=385 sha256_16=f3b6fb27972b5971

```
function iJt(t,o){let r=t;if(r.isBypassPermissionsModeAvailable&&i_())r=eln(r);if(r.strippedDangerousRules!==void 0){let l=new Set(Is),T=!NP(),p={};for(let[b,R]of Object.entries(r.strippedDangerousRules))if(R&&(T||b==="command")&&!l.has(b))p[b]=[...R];r={...r,strippedDangerousRules:p}}let i=(hM().length===0||o5())&&Bdt(r)&&Qan();if(i)r=BFt(r);return{context:Uqe(r),exitedAutoMode:i}}
```

##### `BFt` setMode default
#### `BFt` @186056763
- len=345 sha256_16=97f9ca245486c6e5

```
function BFt(e){let t="default";if(fk(!1),zM(!0),e.mode==="auto")return PG({from:"auto",to:t,trigger:"auto_gate_denied"}),{...Uc(vY(e),{type:"setMode",mode:t,destination:"session"}),isAutoModeAvailable:!1,canAutoClassifierRun:!1};return{...vY(e),prePlanMode:e.prePlanMode==="auto"?t:e.prePlanMode,isAutoModeAvailable:!1,canAutoClassifierRun:!1}}
```

##### `Qan` / `$at` managed disableAutoMode
#### `Qan` @186055955
- len=91 sha256_16=cbb5004d0400ac6e

```
function Qan(){let e=db();return(Fx(e)||e==="remote"&&yN())&&$at(_e("policySettings")||{})}
```

#### `$at` @186055822
- len=97 sha256_16=89a993a176e4b53f

```
function $at(e){return e.disableAutoMode==="disable"||e.permissions?.disableAutoMode==="disable"}
```

**Verdict:** BODY

`Int` runs on `Settings changed from ${t}` and applies `iJt` to the live permission context. `iJt` calls `BFt` when the session is in auto (`Bdt`) and `Qan()` is true. `Qan` requires managed policy origin plus `policySettings` `disableAutoMode==="disable"` (`$at`). `BFt` `setMode`s `"auto"` to `"default"`. The `iJt` predicate also requires `hM().length===0||o5()` (no non-warning policy errors, or the admin-survivor flag).
