# gold-251-a bullets 1-5

- exe: C:/Users/Administrator/AppData/Local/Temp/official-251/package/claude.exe
- bytes: 217360032
- when: 2026-09-22T06:59:24.698Z
- rule: changelog text is an index, not a contract. BODY only when an extracted JS function body implements the needle behavior. STRING-ONLY when the string is present and control flow is not locked. MISS when needles are absent.

## #1

- verdict: BODY
- best needle: PreModelSwitch
- best needle hits: 59
- function: hdt @186760884 len=1494 sha=a8f9b451a0ac185a via=lastFnStartGeneric
- anchor: hook_event_name:"PreModelSwitch" @186761216 jsScore=102 rank=227.5
- judge: standaloneHigh=1 codeishKinds=1 codeish=6 flow=true

### hit counts

- `PreModelSwitch` primary high=true hits=59 first8=93405459,93406506,94324782,94325587,94326942,94328214,94328346,94330038
- `PostModelSwitch` primary high=true hits=33 first8=95811548,97036080,97215260,97215368,97215392,101625549,179651823,180813717
- `SessionStart` primary high=false hits=93 first8=92163193,92243380,92243422,92804240,94536075,96697364,96886218,96886277
- `staleness` primary high=true hits=31 first8=82489805,92350156,92350176,94632039,94632095,94632171,94632235,94632299
- `re-cache` primary high=true hits=12 first8=96254196,96254434,96254482,98236448,100191922,100192306,180818624,185429413
- `recache` primary high=true hits=4 first8=92432241,92432304,202997101,202997204
- `estimated re-cache` primary high=true hits=4 first8=100191912,100192296,209973116,209973579
- `seconds_since_last_response` follow hits=5 first8=96283280,98236369,180818120,180818545,185573676
- `context_tokens` follow hits=17 first8=92518600,96283140,98236458,100191889,100192273,180818251,180818634,180818744
- `prompt_cache_likely_expired` follow hits=3 first8=96283316,180818479,185573723
- `estimated_cache_write_usd` follow hits=6 first8=96283104,180818651,180823260,185569184,185573756,185573784
- `hook_event_name:"PreModelSwitch"` follow hits=1 first8=186761216
- `hook_event_name:"PostModelSwitch"` follow hits=1 first8=186763066

### needles inside function

- `PreModelSwitch` code=6 prose=0 @136 code literalLen=97 standalone=true
- `PostModelSwitch` code=0 prose=0 ABSENT
- `SessionStart` code=0 prose=0 ABSENT
- `staleness` code=0 prose=0 ABSENT
- `re-cache` code=0 prose=0 ABSENT
- `recache` code=0 prose=0 ABSENT
- `estimated re-cache` code=0 prose=0 ABSENT

### excerpt

fullLen=1494 sha=a8f9b451a0ac185a excerptCap=3500
````
async function hdt(e,t,r={}){let o=[];if(await Osn(),await Lsn(!0))return{decision:"block",reason:"plugin hooks could not be loaded, so PreModelSwitch hooks could not be checked; see the debug log",messages:o};if(!dD(e))return{decision:"proceed",skipConfirm:!1,messages:o};if(cre(t.toModel))await hJ(t.toModel);let u={...va(e,ee()),hook_event_name:"PreModelSwitch",from_model:t.fromModel,to_model:t.toModel,requested_model:t.requestedModel,source:t.source,...Ewe(t.toModel)},d=Xde(t.toModel),y,k,A=!1,x=!1;try{for await(let O of z_({session:e,hookInput:u,toolUseID:pEt(),matchQuery:LOe(d)?d:void 0,sessionHooks:Kle.of(e).registry,signal:r.signal,timeoutMs:r.timeoutMs??Hye})){if(yBn(O.message,o),O.message?.type==="attachment"&&O.message.attachment.type==="hook_cancelled"&&!r.signal?.aborted)y??=`PreModelSwitch hook ${O.message.attachment.hookName} did not respond before its timeout`;if(O.blockingError)y??=O.blockingError.blockingError;else if(O.permissionBehavior==="ask")A=!0,k??=O.hookPermissionDecisionReason;else if(O.permissionBehavior==="allow")x=!0}}catch(O){n(`PreModelSwitch hooks did not complete: ${O instanceof la?"control stream closed":String(O)}`,{level:"error"}),y??=O instanceof la?"PreModelSwitch hooks were cancelled (the control stream closed) before answering":"a PreModelSwitch hook failed before answering"}if(y!==void 0)return{decision:"block",reason:y,messages:o};if(A)return{decision:"ask",reason:k,messages:o};return{decision:"proceed",skipConfirm:x,messages:o}}
````

### other extracted functions

- Ewe @185569345 len=93 sha=b3b984471e5760ee via=lastFnStartGeneric rank=-6.5 codeNeedles=[-]
````
function Ewe(e){let t=mRn()??0;return{context_tokens:t,prompt_cache_warm:VB([]),...vwe(e,t)}}
````

- KSn @185573233 len=578 sha=5d993e7922d4c636 via=lastFnStartGeneric rank=70.8 codeNeedles=[-]
````
function KSn(e,t,r){let o=$sn(e),u=(U,B)=>{gRn({sessionId:r,contextTokens:o,requestAt:U,ttlMs:B})},d=Y_e(e),y=d?Date.parse(d.timestamp):NaN;if(!d||Number.isNaN(y))return u(null,null),{};let k=Math.max(0,Math.round((Date.now()-y)/1000)),A=vwe(t??d.message.model??at(),o),x=A.cache_ttl==="1h"?3600:300,O=VSn(e)?y:NaN,F=Number.isNaN(O)?1/0:Math.max(0,Math.round((Date.now()-O)/1000));return u(Number.isNaN(O)?null:O,Number.isNaN(O)?null:x*1000),{seconds_since_last_response:k,context_tokens:o,prompt_cache_likely_expired:F>=x,estimated_cache_write_usd:A.estimated_cache_write_usd}}
````

- mBn @186752356 len=818 sha=a7cacbd9f0fead61 via=lastFnStartGeneric rank=206.3 codeNeedles=[PreModelSwitch, PostModelSwitch, SessionStart]
````
function mBn(e){let t={PreToolUse:[],PostToolUse:[],PostToolUseFailure:[],PostToolBatch:[],PermissionDenied:[],Notification:[],UserPromptSubmit:[],UserPromptExpansion:[],SessionStart:[],SessionEnd:[],Stop:[],StopFailure:[],SubagentStart:[],SubagentStop:[],PreCompact:[],PostCompact:[],PreModelSwitch:[],PostModelSwitch:[],PermissionRequest:[],Setup:[],TeammateIdle:[],TaskCreated:[],TaskCompleted:[],Elicitation:[],ElicitationResult:[],ConfigChange:[],WorktreeCreate:[],WorktreeRemove:[],InstructionsLoaded:[],CwdChanged:[],FileChanged:[],DirectoryAdded:[],MessageDisplay:[]};if(!e.hooksConfig)return t;for(let[r,o]of Object.entries(e.hooksConfig)){let u=r;if(!t[u])continue;for(let d of o)if(d.hooks.length>0)t[u].push({matcher:d.matcher,hooks:d.hooks,pluginRoot:e.path,pluginName:e.name,pluginId:e.source})}return t}
````

- arrow @180817935 len=936 sha=f5101d80851d295a via=arrow rank=70.1 codeNeedles=[SessionStart]
````
m(()=>Re().and(p({hook_event_name:N("SessionStart"),source:ie(["startup","resume","clear","compact","fork"]),agent_type:i().optional(),model:i().optional(),session_title:i().optional(),seconds_since_last_response:T().optional().describe("resume/fork: seconds since the resumed transcript's last assistant response"),context_tokens:T().optional().describe("resume/fork: the resumed transcript's last response input + cache_read + cache_creation + output tokens (for a server-side tool loop, its last iteration's window, not the summed totals)"),prompt_cache_likely_expired:z().optional().describe("resume/fork: seconds_since_last_response exceeds the prompt-cache TTL, so the first request re-caches context_tokens"),estimated_cache_write_usd:T().optional().describe("resume/fork: estimated cost of re-caching context_tokens on the session model \u2014 the managed modelPricing when set, otherwise list price; excludes the response")})))
````

- jw @180822483 len=1179 sha=76eaef4074983918 via=lastFnStartGeneric rank=-10.2 codeNeedles=[-]
````
function jw(e){return p({from_model:i().describe("Resolved model id the session was running before the switch"),to_model:i().describe("Resolved model id the session runs after the switch"),requested_model:i().nullable().describe('What was asked for (alias such as "opus", a full id, or null for "default")'),source:ie(e).describe(e.map((t)=>kQ[t]).join("; ")),context_tokens:T().describe("Prompt tokens the next request re-sends: the last main-thread response's input + cache_read + cache_creation + output tokens (0 before the first response; for a server-side tool loop, its last iteration's window, not the summed totals)"),prompt_cache_warm:z().describe("Whether the current model's prompt cache is likely still warm (a switch then forfeits it)"),cache_ttl:ie(["5m","1h"]),estimated_cache_write_usd:T().describe("Estimated cost of re-caching context_tokens on to_model at its cache-write rate \u2014 the managed modelPricing when set, otherwise list price; excludes the response"),pricing:ie(["configured","catalog","default"]).describe("configured: priced at the managed modelPricing setting; catalog: list price; default: to_model unknown, the default tier was assumed")})}
````

- ydt @186762751 len=1390 sha=a6bea69d060aef6a via=lastFnStartGeneric rank=187.6 codeNeedles=[PostModelSwitch]
````
function ydt(e,t,r={}){let o=yEt.of(e),u=e.id;o.landedOn={sessionId:u,toModel:t.toModel};let y=(async()=>{if(await Osn(),await Lsn(!1))n("PostModelSwitch: plugin hooks could not be loaded; plugin-delivered hooks are missing from this run",{level:"error"});if(cre(t.toModel))await hJ(t.toModel);let k={...va(e,ee()),hook_event_name:"PostModelSwitch",from_model:t.fromModel,to_model:t.toModel,requested_model:t.requestedModel,source:t.source,...Ewe(t.toModel)},A=[],x=[];try{for await(let O of z_({session:e,hookInput:k,toolUseID:pEt(),matchQuery:LOe(Xde(t.toModel))?Xde(t.toModel):void 0,sessionHooks:Kle.of(e).registry,timeoutMs:r.timeoutMs??Hye})){if(O.additionalContexts)A.push(...O.additionalContexts);if(O.message?.type==="attachment"){let F=O.message.attachment;if(F.type==="hook_success"&&F.content)A.push(F.content);if(F.type!=="hook_blocking_error")x.push(O.message)}if(O.blockingError)x.push(P0e("PostModelSwitch",O.blockingError,`PostModelSwitch:${Xde(t.toModel)}`))}}catch(O){n(O instanceof la?"PostModelSwitch hooks cancelled (control stream closed)":`PostModelSwitch hooks failed: ${String(O)}`,{level:O instanceof la?"debug":"error"})}if(A.length>0||x.length>0)o.pending.push({sessionId:u,toModel:t.toModel,contexts:A,messages:x})})().catch((k)=>{n(`PostModelSwitch hooks failed: ${String(k)}`,{level:"error"})}).finally(()=>{o.inFlight.delete(y)});return o.inFlight.add(y),y}
````

### note

present=[PreModelSwitch | PostModelSwitch | SessionStart | staleness | re-cache | recache | estimated re-cache | seconds_since_last_response | context_tokens | prompt_cache_likely_expired | estimated_cache_write_usd | hook_event_name:"PreModelSwitch" | hook_event_name:"PostModelSwitch"]
absent=[-]
PreModelSwitch runner=hdt@186760884
PostModelSwitch runner=ydt@186762751
resume cache fields=KSn@185573233

## #2

- verdict: BODY
- best needle: parent_tool_use_id
- best needle hits: 90
- function: san @185859343 len=1052 sha=ff0787a07ae5e2bd via=function-star
- anchor: tool_use_result: @185860205 jsScore=82 rank=173.0
- judge: standaloneHigh=1 codeishKinds=1 codeish=2 flow=true

### hit counts

- `foreground subagent` primary high=true hits=2 first8=98276953,180869296
- `Remote Control` primary high=false hits=382 first8=92316728,92316904,92316935,92384375,92563136,92563360,92563928,92564096
- `tool calls and results` primary high=true hits=0 first8=-
- `tool_result` variant of `tool calls and results` high=true hits=648 first8=92405548,92556389,92595404,92623289,93386060,93464208,93476222,93480088
- `parent_tool_use_id` variant of `tool calls and results` high=true hits=90 first8=92267280,99295270,99773829,100078570,180848357,180860691,180861506,180867523
- `task_progress` primary high=true hits=10 first8=92523816,180914373,183630710,186038667,188152944,196805490,201141402,202699192
- `r?.type==="tool_result"` follow hits=2 first8=185859259,186116167
- `type==="tool_result"` follow hits=160 first8=179649975,181317415,181674171,182150427,183449602,183500957,183597854,183627844
- `tool_use_result:` follow hits=5 first8=180848418,185854256,185860205,185862532,204414007
- `parent_tool_use_id!=null` follow hits=4 first8=183631805,201018295,201165204,205772915

### needles inside function

- `foreground subagent` code=0 prose=0 ABSENT
- `Remote Control` code=0 prose=0 ABSENT
- `tool calls and results` code=0 prose=0 ABSENT
- `tool_result` code=0 prose=0 ABSENT
- `parent_tool_use_id` code=2 prose=0 @287 code literalLen=0 standalone=true
- `task_progress` code=0 prose=0 ABSENT

### excerpt

fullLen=1052 sha=ff0787a07ae5e2bd excerptCap=3500
````
function*san(e,t){let r=e.data.agentType,o=e.data.description;for(let u of vp([e.data.message]))switch(u.type){case"assistant":if(!tX(u))break;{let d=IN(u.message.content,t),y=MLe(u.message.content);yield{type:"assistant",message:y===u.message.content?u.message:{...u.message,content:y},parent_tool_use_id:e.parentToolUseID,session_id:K(),uuid:u.uuid,timestamp:u.timestamp,error:u.error,...u.requestId!==void 0&&{request_id:u.requestId},...r!==void 0&&{subagent_type:r},...o!==void 0&&{task_description:o},...u.isApiErrorMessage===!0&&{is_api_error_message:!0},...e.data.message.type==="assistant"&&e.data.message.apiError!==void 0&&{api_error:e.data.message.apiError},...d.length>0&&{tool_use_meta:d}}}break;case"user":{yield{type:"user",message:u.message,parent_tool_use_id:e.parentToolUseID,session_id:K(),uuid:u.uuid,timestamp:u.timestamp,isSynthetic:rbe(u),tool_use_result:u.mcpMeta?{content:u.toolUseResult,...u.mcpMeta}:u.toolUseResult,...u.origin&&{origin:u.origin},...r!==void 0&&{subagent_type:r},...o!==void 0&&{task_description:o}};break}}}
````

### other extracted functions

- idt @185859283 len=60 sha=e6321af3cf6dcb83 via=lastFnStartGeneric rank=-5.9 codeNeedles=[-]
````
function idt(e,t){return e.enabled&&(e.forwardText||bEn(t))}
````

- bEn @185859099 len=184 sha=d5e0bf8fcde43b8f via=lastFnStartGeneric rank=165.5 codeNeedles=[tool_result]
````
function bEn(e){if(e.type!=="assistant"&&e.type!=="user")return!1;let t=e.message.content;if(!Array.isArray(t))return!1;let r=t[0];return r?.type==="tool_use"||r?.type==="tool_result"}
````

- jVe @186038624 len=332 sha=1dfb825fb822991d via=lastFnStartGeneric rank=119.6 codeNeedles=[task_progress]
````
function jVe(e){wu({type:"system",subtype:"task_progress",task_id:e.taskId,tool_use_id:e.toolUseId,description:e.description,subagent_type:e.subagentType,usage:{total_tokens:e.totalTokens,tool_uses:e.toolUses,duration_ms:Date.now()-e.startTime},last_tool_name:e.lastToolName,summary:e.summary,workflow_progress:e.workflowProgress})}
````

- Ce @201165125 len=410 sha=0c2fff65317db73a via=lastFnStartGeneric rank=169.3 codeNeedles=[parent_tool_use_id]
````
function Ce(u){if(!kt)return;try{if((u.type==="assistant"||u.type==="user")&&u.parent_tool_use_id!=null){let U=u9e();if(idt(U,u))kt.writeSdkMessages([u]);return}if(u.type!=="system")return;if(!(u.subtype==="thinking_tokens"||u.subtype==="status"&&j8t(u.status)))return;kt.writeSdkMessages([jUe(u)])}catch(P){n(`[bridge:sdk] ${"subtype"in u?u.subtype:u.type} forward failed: ${Se(P).message}`,{level:"error"})}}
````

- yY @185860395 len=2340 sha=97c1c4c2b3f68c0e via=function-star rank=171.8 codeNeedles=[parent_tool_use_id]
````
function*yY(e,t,r){switch(e.type){case"assistant":{let o=e.supersedesUuids;for(let u of vp([e])){if(!tX(u))continue;let d=o;o=void 0;let y=IN(u.message.content,r);yield{type:"assistant",message:u.message,parent_tool_use_id:null,session_id:K(),uuid:u.uuid,timestamp:u.timestamp,error:u.error,...u.requestId!==void 0&&{request_id:u.requestId},...d!==void 0&&d.length>0&&{supersedes:d},...kve(e),...y.length>0&&{tool_use_meta:y}}}return}case"progress":if(ian(e))yield*san(e,r);else if(e.data.type==="repl_tool_call")yield{type:"tool_progress",tool_use_id:e.toolUseID,tool_name:"REPL",parent_tool_use_id:e.parentToolUseID,elapsed_time_seconds:0,repl_call:{inner_tool_name:e.data.toolName,inner_tool_input:e.data.toolInput,inner_tool_use_id:e.data.toolUseId,phase:e.data.phase},session_id:K(),uuid:e.uuid};else if(e.data.type==="bash_progress"||e.data.type==="powershell_progress"){if(!a.CLAUDE_CODE_REMOTE&&!a.CLAUDE_CODE_CONTAINER_ID)break;if(t.shouldEmit(e.parentToolUseID,Date.now(),SEn))yield{type:"tool_progress",tool_use_id:e.toolUseID,tool_name:e.data.type==="bash_progress"?"Bash":"PowerShell",parent_tool_use_id:e.parentToolUseID,elapsed_time_seconds:e.data.elapsedTimeSeconds,task_id:e.data.taskId,session_id:K(),uuid:e.uuid}}else if(e.data.type==="tool_heartbeat")yield{type:"tool_progress",tool_use_id:e.toolUseID,tool_name:e.data.toolName,parent_tool_use_id:e.parentToolUseID,elapsed_time_seconds:e.data.elapsedTimeSeconds,heartbeat:!0,session_id:K(),uuid:e.uuid};else if(e.data.type==="agent_api_retry")yield{type:"tool_progress",tool_use_id:e.toolUseID,tool_name:_t,parent_tool_use_id:e.…
````

- d @196798300 len=356 sha=f35840fbaf01b83f via=lastFnStartGeneric rank=164.5 codeNeedles=[tool_result]
````
function d(r){let e=!1;for(let o=r.length-1;o>=0;o--){let a=r[o];if(a?.type==="assistant"){e=!0;let t=a.message.content;if(Array.isArray(t)&&t.some((u)=>u.type==="tool_use"&&u.name===Gb))return!0;continue}if(a?.type==="user"){let t=a.message.content;if(!(Array.isArray(t)&&t.length>0&&t.every((c)=>c.type==="tool_result")))return!1;if(e)return!1}}return!1}
````

### note

tool-block filter=bEn@185859099
forward gate=idt@185859283
frame expand=san@185859343
sdk write=Ce@201165125
task_progress payload=jVe@186038624
foreground subagent phrase=ABSENT
bg-subagent context:
 Bs=dE.of(r.session).active;if(Bs&&(ar.type==="assistant"||ar.type==="user"))for(let To of vp([ar])){let El=p4e({toolUseID:`agent_${Sn}`,parentToolUseID:At,data:{message:To,type:"agent_progress",prompt:"",agentId:Sn,agentType:e.agentType,isBuiltIn:ja(e),resolvedModel:bn,...We&&{description:We}}});for(let Qi of yY(El,r.session.toolProgressThrottle,Wr))Bs.write(Qi).catch((rm)=>n(`bg-subagent progress write failed: ${rm}`,{level:"warn"}))}else if(Bs&&ar.type==="progress"&&ar.data.type==="agent_progress"&&r.options.forwardSubagentText)for(let To of yY(ar,r.session.toolProgressThrottle,Wr))Bs.write(To).catch((El)=>n(`bg-subagent nested progress write failed
stream-vs-status: bEn/idt/san/Ce build and write tool_use/tool_result frames (parent_tool_use_id) on the SDK path. task_progress is a separate status payload (counts, last_tool_name). Nested background agent_progress writes are gated by forwardSubagentText. The phrase "foreground subagent" is not in these functions.

## #3

- verdict: BODY
- best needle: spend_limit
- best needle hits: 73
- function: X1e @202991096 len=2130 sha=79a9c066d0a4bdd9 via=lastFnStartGeneric
- anchor: rate_limits @202992841 jsScore=76 rank=249.9
- judge: standaloneHigh=2 codeishKinds=2 codeish=3 flow=true

### hit counts

- `spend_limit` primary high=true hits=73 first8=92431388,94123108,96243672,96896494,96896524,96896604,96896628,99406378
- `Spend limit` primary high=true hits=7 first8=93514228,93514248,100660706,193669627,208976082,208976275,217027906
- `rate_limits` primary high=true hits=27 first8=92431684,94107871,94143048,100659853,180905387,180964072,180964209,180964237

### needles inside function

- `spend_limit` code=2 prose=0 @637 code literalLen=0 standalone=true
- `Spend limit` code=0 prose=0 ABSENT
- `rate_limits` code=1 prose=0 @1745 code literalLen=0 standalone=true

### excerpt

fullLen=2130 sha=79a9c066d0a4bdd9 excerptCap=3500
````
function X1e({session:b,permissionMode:R,exceeds200kTokens:x,fastMode:P,settings:j,messages:Z,addedDirs:re,mainLoopModel:ue,gitWorktree:de,repo:fe,prStatus:we,vimModeEnabled:Ce,vimMode:Re,cwd:Me,effortValue:Pe,thinkingEnabled:$e}){let Ie=Fy(),qe=ha(),Ke=hf({permissionMode:R,mainLoopModel:ue,exceeds200kTokens:x}),et=j?.outputStyle||eE,st=KVe(Z),ot=Lf(Ke,Vf()),Pt=GY(b.id),_t=jL(),Ht={..._t.five_hour&&{five_hour:{used_percentage:_t.five_hour.utilization*100,resets_at:_t.five_hour.resets_at}},..._t.seven_day&&{seven_day:{used_percentage:_t.seven_day.utilization*100,resets_at:_t.seven_day.resets_at}},...Ne()==="gateway"&&_t.overage&&{spend_limit:{used_percentage:_t.overage.utilization*100,resets_at:_t.overage.resets_at}}};return{...va(b,Me),...Pt&&{session_name:Pt},model:{id:Ke,display_name:cs(Ke)},workspace:{current_dir:Me,project_dir:b.project.originalCwd,added_dirs:re,...de&&{git_worktree:de},...fe&&{repo:fe}},version:{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.251",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-08-28T14:51:38Z",GIT_SHA:"37534ac596d80cefb02d272f036adba4ba055d2c",HOOKS_WORKER_URL:"B:/~BUN/root/src/plugins/functionHooks/hooks-worker/hooks-worker.js",DD_SOURCEMAP_GROUP:"win32"}.VERSION,output_style:{name:et},cost:{total_cost_usd:ul(),...!1,total_duration_ms:AW(),total_api_duration_ms:Xg(),total_lines_added:j5(),total_lines_removed:W5()},context_window:Y1e(st,ot),exceeds_200k_tokens:x,...oqe(),fast_mode:P,...lg(Ke)&&{effort:{level:tw(Ke,Pe)}},thinking:{enabled:$e!==!1},...(Ht.five_hour||Ht.seven_day||Ht.spend_limit)&&{rate_limits:Ht},...Ce&&{vim:{mode:Re??"INSERT"}},...Ie&&{agent:{name:Ie}},...Gr()!==null&&{remote:{session_id:b.id}},...we&&{pr:{number:we.number,url:we.url,...we.reviewState&&{review_state:we.reviewState},...we.kind&&{kind:we.kind}}},...qe&&{worktree:{name:qe.worktreeName,path:qe.worktreePath,branch:qe.worktreeBranch,original_cwd:qe.originalCwd,original_branch:qe.originalBranch}}}}
````

### other extracted functions

- Dl @208975936 len=703 sha=9ceaded7a5fc61b4 via=lastFnStartGeneric rank=138.5 codeNeedles=[Spend limit]
````
function Dl(ZD){let el=y(6),{maxWidth:om}=ZD,wh;if(el[0]===d)wh=jL(),el[0]=wh;else wh=el[0];let nm=wh.overage,tl;if(el[1]!==om)tl=nm?e(Jt,{title:"Spend limit",limit:{utilization:Math.round(nm.utilization*100),resets_at:new Date(nm.resets_at*1000).toISOString()},maxWidth:om,alwaysShowDateInReset:!0}):HPe()?null:e(t,{dimColor:!0,children:"Spend limit \xB7 shown once your gateway reports one"}),el[1]=om,el[2]=tl;else tl=el[2];let Dh;if(el[3]===d)Dh=e(t,{dimColor:!0,children:e(Ve,{action:"confirm:no",context:"Settings",fallback:"Esc",description:"cancel"})}),el[3]=Dh;else Dh=el[3];let Th;if(el[4]!==tl)Th=r(o,{flexDirection:"column",gap:1,children:[tl,Dh]}),el[4]=tl,el[5]=Th;else Th=el[5];return Th}
````

### note

present=[spend_limit | Spend limit | rate_limits]
absent=[-]

## #4

- verdict: BODY
- best needle: prompt_cache
- best needle hits: 34
- function: oqe @202996715 len=520 sha=d9745aab726b8e8d via=lastFnStartGeneric
- anchor: prompt_cache @202996818 jsScore=64 rank=365.0
- judge: standaloneHigh=3 codeishKinds=3 codeish=3 flow=true

### hit counts

- `prompt_cache` primary high=true hits=34 first8=92431896,94330544,94330580,94330616,96283164,96283316,96320738,96321070
- `tokens re-cached` primary high=true hits=2 first8=96254189,185429406
- `hit ratio` primary high=true hits=0 first8=-
- `hitRatio` variant of `hit ratio` high=true hits=5 first8=92432120,185035503,185429177,185429216,202997049
- `hit_ratio` variant of `hit ratio` high=true hits=2 first8=92432136,202997037
- `warm/cold` primary high=true hits=0 first8=-
- `warmCold` variant of `warm/cold` high=true hits=0 first8=-
- `warm-cold` variant of `warm/cold` high=true hits=0 first8=-

### needles inside function

- `prompt_cache` code=1 prose=0 @103 code literalLen=0 standalone=true
- `tokens re-cached` code=0 prose=0 ABSENT
- `hit ratio` code=0 prose=0 ABSENT
- `hitRatio` code=1 prose=0 @334 code literalLen=0 standalone=true
- `hit_ratio` code=1 prose=0 @322 code literalLen=0 standalone=true
- `warm/cold` code=0 prose=0 ABSENT
- `warmCold` code=0 prose=0 ABSENT
- `warm-cold` code=0 prose=0 ABSENT

### excerpt

fullLen=520 sha=d9745aab726b8e8d excerptCap=3500
````
function oqe(b=Date.now()){let R=c$t(void 0,b);if(R.requests===0||R.lastRequest===null)return{};return{prompt_cache:{warm:R.warm,caching_observed:R.cachingObserved,ttl:R.lastRequest.ttl,expires_at:R.expiresAt===null?null:Math.ceil(R.expiresAt/1000),requests:R.requests,misses:R.misses,expected_rebuilds:R.expectedRebuilds,hit_ratio:R.hitRatio,cache_write_tokens:R.cacheWriteTokens,miss_recache_tokens:R.missRecacheTokens,last_miss_at:R.lastMissAt===null?null:Math.floor(R.lastMissAt/1000),recache_tokens_if_cold:u$t()}}}
````

### other extracted functions

- whn @185429010 len=937 sha=ca79ea9f10644d21 via=lastFnStartGeneric rank=231.1 codeNeedles=[tokens re-cached, hitRatio]
````
function whn(e=Date.now()){let t=c$t(void 0,e);if(t.requests===0||t.lastRequest===null)return null;let r=[`${t.requests} ${t.requests===1?"request":"requests"}`];if(t.hitRatio!==null)r.push(`${Math.round(t.hitRatio*100)}% of input tokens from cache`);if(r.push(t.misses===0?"no misses":`${t.misses} ${t.misses===1?"miss":"misses"} (last ${Ft(e-(t.lastMissAt??e))} ago, ${Wo(t.missRecacheTokens)} tokens re-cached)`),t.expectedRebuilds>0)r.push(`${t.expectedRebuilds} expected ${t.expectedRebuilds===1?"rebuild":"rebuilds"} (compaction or tool-result clearing)`);let o=Ft(e-(t.lastActivityAt??t.lastRequest.at)),u=u$t();if(!t.cachingObserved)r.push("no prompt caching reported by the API");else r.push(t.warm?`warm (${t.lastRequest.ttl} TTL, last activity ${o} ago)`:`cold \u2014 idle ${o}, ${u===null?"next turn re-caches the compacted prompt":`next turn re-caches ~${Wo(u)} tokens`}`);return`Prompt cache (main):   ${r.join(" \xB7 ")}`}
````

### note

present=[prompt_cache | tokens re-cached | hitRatio | hit_ratio]
absent=[hit ratio | warm/cold | warmCold | warm-cold]

## #5

- verdict: BODY
- best needle: claude attach
- best needle hits: 21
- function: We @203669318 len=1431 sha=ac5bf3741af6bbbc via=lastFnStartGeneric
- anchor: --resume @203670249 jsScore=116 rank=177.5
- judge: standaloneHigh=1 codeishKinds=1 codeish=2 flow=true

### hit counts

- `respawn` primary high=true hits=336 first8=82540731,92188572,92193505,92194312,92195709,92195738,92198829,92198852
- `claude attach` primary high=true hits=21 first8=92719620,93428096,93429757,93430823,93459993,93460134,99278402,99305484
- `--resume` primary high=false hits=137 first8=92191488,92253072,92275200,92304741,92430378,92664721,93251064,93422416
- `Usage: claude respawn` follow hits=4 first8=93430212,93430362,189876084,189876298

### needles inside function

- `respawn` code=0 prose=0 ABSENT
- `claude attach` code=1 prose=0 @501 code literalLen=14 standalone=true
- `--resume` code=1 prose=0 @931 code literalLen=15 standalone=true

### excerpt

fullLen=1431 sha=ac5bf3741af6bbbc excerptCap=3500
````
function We(Vt){let N=y(23),{sessionId:Io,jobId:b,projectPath:Y}=Vt,No;if(N[0]===d)No=[],N[0]=No;else No=N[0];Xn(qo,100,No);let Pe=ct(Go),Eo;if(N[1]!==Pe||N[2]!==Y)Eo=Y&&Y!==Pe?`cd ${ti([Y])} ${VCt()} `:"",N[1]=Pe,N[2]=Y,N[3]=Eo;else Eo=N[3];let Oe=Eo,Be=XN(Io)?` ${Io}`:"";const He=b?` (${b})`:"";let ue;if(N[4]!==He)ue=r(t,{children:["That session is still running as a background session",He,"."]}),N[4]=He,N[5]=ue;else ue=N[5];let fe;if(N[6]!==b)fe=b?r(t,{children:["Run ",r(t,{bold:!0,children:["claude attach ",b]})," to open it, or"," ",r(t,{bold:!0,children:["claude stop ",b]})," first to resume it here."]}):null,N[6]=b,N[7]=fe;else fe=N[7];let pe;if(N[8]!==b)pe=b?e(t,{children:"To branch off a copy instead, run:"}):r(t,{children:["Run ",e(t,{bold:!0,children:"claude agents"})," to find its id and attach to it, or run:"]}),N[8]=b,N[9]=pe;else pe=N[9];let Ce;if(N[10]!==Oe||N[11]!==Be)Ce=r(t,{children:[" ",Oe,"claude --resume",Be," --fork-session"]}),N[10]=Oe,N[11]=Be,N[12]=Ce;else Ce=N[12];let he;if(N[13]!==pe||N[14]!==Ce)he=r(o,{flexDirection:"column",children:[pe,Ce]}),N[13]=pe,N[14]=Ce,N[15]=he;else he=N[15];let Re;if(N[16]!==b)Re=b?null:e(t,{dimColor:!0,children:"to branch off a copy."}),N[16]=b,N[17]=Re;else Re=N[17];let jo;if(N[18]!==ue||N[19]!==fe||N[20]!==he||N[21]!==Re)jo=r(o,{flexDirection:"column",gap:1,children:[ue,fe,he,Re]}),N[18]=ue,N[19]=fe,N[20]=he,N[21]=Re,N[22]=jo;else jo=N[22];return jo}
````

### other extracted functions

- nge @189865746 len=324 sha=1da5cc2d0cad6c55 via=lastFnStartGeneric rank=99.7 codeNeedles=[claude attach]
````
function nge(e,t,o){let r=(i,d)=>ae.dim("  "+i.padEnd(26)+d);return[`backgrounded \xB7 ${ae.cyan(e)}${o?` \xB7 ${o}`:""}${t?ae.dim(` ${t}`):""}`,r("claude agents","list sessions"),r(`claude attach ${e}`,"open in this terminal"),r(`claude logs ${e}`,"show recent output"),r(`claude stop ${e}`,"stop this session")].join(`
`)}
````

- cEr @189876006 len=2127 sha=786792b75c9e57b3 via=lastFnStartGeneric rank=166.9 codeNeedles=[respawn]
````
async function cEr(e,t){if(sn(),e==="--help"||e==="-h"){process.stdout.write(`Usage: claude respawn <id>|--all

  Restart a background session (or all of them) so it picks up the current Claude binary.
`);return}if(e?.startsWith("-")&&e!=="--all"){process.stderr.write(`unknown option '${e}'
Usage: claude respawn <id>|--all
`),process.exitCode=1;return}if(!e){process.stderr.write(`usage: claude respawn <id>|--all
`),process.exitCode=1;return}let o=await Rt(void 0,t);if(!o.ok){process.stderr.write(`Couldn't respawn \u2014 ${ou()} is unavailable (${o.reason})${rre("status")}
`),await In("cli_bg_respawn","daemon_unavailable"),process.exitCode=1;return}if(e==="--all"){let b=(await fy(void 0,t)).filter((R)=>!Pv(R.state.state));if(b.length===0){process.stdout.write(`no live jobs to respawn
`);return}let y=0,A=0;for(let R of b){let k=await X1e(R.id,{force:!0,knownState:R.state},t);if(k.ok)y++,process.stdout.write(`respawned ${R.id}${k.short!==R.id?` \u2192 ${k.short}`:""}
`);else if(k.alive)A++,process.exitCode=1,process.stderr.write(`${R.id}: still running \u2014 couldn't confirm restart, retry in a moment
`);else process.exitCode=1,process.stderr.write(`${R.id}: ${k.error}
`)}if(y===b.length)await Zs("cli_bg_respawn");else if(y>0||A>0)await Ic("cli_bg_respawn",A>0?"still_alive":"partial");else await In("cli_bg_respawn","spawn_failed");return}let i=(t?await AYt(t)??[]:await rn(qS()).catch(()=>[])).filter((p)=>oP.test(p)).filter((p)=>p.startsWith(e));if(i.length!==1){process.stderr.write(i.length===0?`No job matching '${e}'
`:`Ambiguous prefix '${e}', matches: ${i.join(", ")}
`),…
````

### note

present=[respawn | claude attach | --resume | Usage: claude respawn]
absent=[-]
resume message=We@203669318
respawn usage=cEr@189876006
