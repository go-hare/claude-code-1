# gold-251-i GAP #1 / #3 missing callees

- exe: C:/Users/Administrator/AppData/Local/Temp/official-251/package/claude.exe
- bytes: 217360032
- when: 2026-09-22T14:30:41.339Z
- rule: changelog text is an index, not a contract. Invent-ban. BODY only from extracted official bytes. Do not invent hook runners or empty-window copy. This file does not mark HAVE.
- locked parents (gold-251-a, not re-extracted): hdt @186760884, ydt @186762751, KSn @185573233, X1e @202991096, Dl @208975936

## Table

| callee | gap | verdict | offset | len | sha |
| --- | --- | --- | --- | --- | --- |
| Osn | #1 | BODY | 186758304 | 67 | b7a9efa8843d8ce6 |
| Lsn | #1 | BODY | 186757898 | 406 | 745c0ba7ad9ed0dd |
| z_ | #1 | BODY | 187242129 | 261 | c69b633a8407c3ce |
| $sn | #1 | BODY | 185574156 | 270 | 87935827b04fe4f2 |
| Y_e | #1 | BODY | 185568683 | 83 | 70f354bc5317effe |
| vwe | #1 | BODY | 185568973 | 270 | a69bbea65369c349 |
| VSn | #1 | BODY | 185573811 | 345 | d4f1b59917694bc9 |
| gRn | #1 | BODY | 179049328 | 147 | 82ea52c51c8c78da |
| dD | #1 | BODY | 186760799 | 85 | bb98049db725662c |
| cre | #1 | BODY | 180584703 | 97 | 410354fdbaffbc77 |
| hJ | #1 | BODY | 180584572 | 131 | b3b70c4821f152d5 |
| pEt | #1 | BODY | 179887321 | 35 | affde90d06fa895f |
| LOe | #1 | BODY | 180780907 | 30 | 6ff11d8499b77b25 |
| Kle | #1 | BODY | 186765144 | 40 | b38c507de20ac8ea |
| Hye | #1 | BODY | 185263247 | 9 | 87e0da92eb371034 |
| yBn | #1 | BODY | 186764691 | 256 | 2f1c6d7ff023ab17 |
| yEt | #1 | BODY | 186762723 | 28 | 737e63ab7a7eade3 |
| HPe | #3 | BODY | 184985281 | 40 | 68854330a39beb2a |
| jL | #3 | BODY | 184985089 | 154 | 09e58cf644b42090 |
| Jt | #3 | BODY | 208972948 | 2226 | d16b7d81ecf6bf05 |

## #1 callees

Collision rule: `function NAME(` via allHits. If many hits, pick the def used at hdt@186760884 / ydt@186762751 / KSn@185573233 (or Ewe@185569345 for vwe). Prefix collisions (`z_n`, `hJt`, `jLn`) discarded. `function z_(` has 2 hits, both unrelated; the hook runner is `async function*z_`.

### Osn

- verdict: BODY
- function: Osn @186758304 len=67 sha=b7a9efa8843d8ce6 via=function Osn( hits=1
- call: `await Osn()` in hdt/ydt
- Jt here is the plugin-registry getter (not the #3 spend bar). See supporting Jt-registry.

````
function Osn(){return Jt().hookRegistrationInFlight?.catch(()=>{})}
````

### Lsn

- verdict: BODY
- function: async function Lsn @186757898 len=406 sha=745c0ba7ad9ed0dd via=async function Lsn( hits=1
- call: `await Lsn(!0)` in hdt (block if plugins fail); `await Lsn(!1)` in ydt (log only)
- retry path calls `fY(r?.storageV5,r?.credentials)` then re-awaits `hookRegistrationInFlight`

````
async function Lsn(e){let t=Jt();if(await t.hookRegistrationInFlight?.catch(()=>{}),!t.hookRegistrationFailed)return!1;if(e&&!t.hookRegistrationRetried){t.hookRegistration=void 0,em("plugin hook registration retry");let r=t.hookRegistrationArgs;await fY(r?.storageV5,r?.credentials).catch(()=>{}),await t.hookRegistrationInFlight?.catch(()=>{}),t.hookRegistrationRetried=!0}return t.hookRegistrationFailed}
````

### z_

- verdict: BODY
- function: async function*z_ @187242129 len=261 sha=c69b633a8407c3ce via=async function*z_( hits=1
- `function z_(` hits=2 @189326711 (highlight.js illegal) and @201139597 (instanceof) — rejected
- call: `for await (let O of z_({session,hookInput,toolUseID,matchQuery,sessionHooks,signal,timeoutMs}))` in hdt/ydt
- hop: z_ → Xxt → Qxt. Not invented. PreModelSwitch is not in W6n, so z_ takes the `if(!W6n.has(...)){ yield*Xxt(e); return }` branch (no dm() around the loop).

````
async function*z_(e){let t=()=>xo()&&!e.signal?.aborted;if(!W6n.has(e.hookInput.hook_event_name)){if(t())return;yield*Xxt(e);return}if(t())await dm();try{for await(let r of Xxt(e)){if(t())await dm();yield r}}catch(r){if(t())await dm();throw r}if(t())await dm()}
````

#### z_ named hop Xxt

- function: async function*Xxt @187242390 len=964 sha=1e4a309bbb9390bf
- agent-context filter then `yield*Qxt(e)`; PreToolUse keeps blockingError. PreModelSwitch falls through to Qxt.

````
async function*Xxt(e){if(!Ha(e.agentContext)&&!Ha(e.toolUseContext?.agentContext)){yield*Qxt(e);return}let t=e.hookInput.hook_event_name==="PreToolUse";for await(let r of Qxt(e)){let o={...r.permissionBehavior!==void 0&&{permissionBehavior:r.permissionBehavior},...r.hookPermissionDecisionReason!==void 0&&{hookPermissionDecisionReason:r.hookPermissionDecisionReason},...r.heldForServedCall&&{heldForServedCall:!0},...r.updatedInput!==void 0&&{updatedInput:r.updatedInput},...r.preventContinuation!==void 0&&{preventContinuation:r.preventContinuation},...r.stopReason!==void 0&&{stopReason:r.stopReason},...r.impossible!==void 0&&{impossible:r.impossible},...r.hookSource!==void 0&&{hookSource:r.hookSource},...r.updatedToolOutput!==void 0&&{updatedToolOutput:r.updatedToolOutput},...r.updatedMCPToolOutput!==void 0&&{updatedMCPToolOutput:r.updatedMCPToolOutput},...t&&r.blockingError!==void 0&&{blockingError:r.blockingError}};if(Object.keys(o).length>0)yield o}}
````

#### z_ named hop Qxt

- function: async function*Qxt @187243749 len=23385 sha=8520e6f94a57e9d5
- this is the generic hook executor (session/hookInput/toolUseID/matchQuery/timeoutMs). Full official body; do not invent a second runner.

````
async function*Qxt({session:e,hookInput:t,extendedHookInput:r,toolUseID:o,matchQuery:u,signal:d,timeoutMs:y=Oi,toolUseContext:k,sessionHooks:A,messages:x,forceSyncExecution:O,suppressPerInvocationTelemetry:F,managedHooksOnly:U,skipSessionFunctionHooks:B,sessionFunctionHooksOnly:W,managedHooksExcluded:V,storageV5:me,credentials:fe}){let pe=t.hook_event_name,ge=u?`${pe}:${u}`:pe,ve=k?.storageV5??me,Ie=k?.credentials??fe;if(JY()){n(`Skipping ${ge} hook execution - workspace trust not accepted`);return}let ke=k?k.sessionHooksRegistry:A,Pe=k?.getAppState(),Me=k?.remoteCall!==void 0,Be=Hb(k,pe,e.id),$e=k?.remoteCall!==void 0&&Gie(ke,Be,pe,{managedHooksOnly:U}).length>0?await M6n(k.remoteCall,k.storageV5,Pe):void 0,qe=(await c3n(ke,Be,pe,t,k?.options?.tools,{managedHooksOnly:U,managedHooksExcluded:V,getToolAliases:()=>Pe?.toolPermissionContext.toolAliases,recordMatchers:Me,...$e!==void 0&&{ownSources:$e.ownSources}})).filter((hn)=>{let ct=!Me||P6n(hn);if(!ct&&(hn.hook.type==="agent"||hn.hook.type==="prompt"))n(`Hooks: ${hn.hook.type} hook skipped for a call served to a cloud session`);return ct}),We=W?qe.filter((hn)=>hn.hook.type==="function"):B?qe.filter((hn)=>hn.hook.type!=="function"):qe;if(We.length===0)return;if(d?.aborted)return;let Ke=lMt(pe,u),At=We.filter((hn)=>!iMt(hn));if(At.length>0){if(!F){let hn=l3n(At),ct=aMt(At),Jn=Q(At,(Hn)=>Hn.matcherIsMatchAll);s("tengu_run_hook",{hookName:Ke,numCommands:At.length,numMatchAllMatchers:Jn,numSpecificMatchers:At.length-Jn,hookTypeCounts:S(ct),...hn&&{pluginHookCounts:S(hn)}})}}else{let hn=Date.now(),ct=0,Jn=k?{getAppState:k.getAppState,applyAttributionOp:k.applyAttributionOp,session:k.session,storageV5:k.storageV5}:void 0;for(let[En,zn]of We.entries()){let{hook:Sr}=zn;if(Sr.type!=="callback")continue;let $r=await Sr.callback(t,o,d,En,Jn);if(uS($r)||Object.keys($r).length===0)continue;let Lr=gK({json:$r,command:"callback",hookName:`${pe}:Callback`,toolUseID:o,hookEvent:pe,expectedHookEvent:pe,stdout:void 0,stderr:void 0,exitCode:void 0});if(Lr.permissionBehavior==="deny")ct++,n(`Hook ${pe} (${lH(Sr)}) returned permissionDecision: deny${Lr.hookPermissionDecisionReason?` (reason: ${Lr.hookPermissionDecisionReason})`:""}`),yield{permissionBehavior:"deny",hookPermissionDecisionReason:Lr.hookPermissionDecisionReason,hookSource:zn.hookSource};if(Lr.additionalContext)yield{additionalContexts:[await bce(Lr.additionalContext,`${o}-${En}`,"additionalContext",{storageV5:ve})]};if(Lr.systemMessage)yield{message:On({type:"hook_system_message",content:await bce(Lr.systemMessage,`${o}-${En}`,"systemMessage",{storageV5:ve}),hookName:ge,toolUseID:o,hookEvent:pe})}}let Hn=Date.now()-hn;STe()?.observe("hook_duration_ms",Hn),s("tengu_repl_hook_finished",{hookName:Ke,numCommands:We.length,numSuccess:We.length-ct,numBlocking:ct,numNonBlockingError:0,numCancelled:0,totalDurationMs:Hn});return}let nt=$b()&&Sl(),mt=nt||Tj()?S(q6n(We)):"[]",en=ihr(pe,u);if(!F)Po("hook_execution_start",{hook_event:pe,hook_name:en,num_hooks:String(We.length),managed_only:String(wwe()),hook_source:wwe()?"policySettings":"merged",safe_mode:String(Dr()),...nt&&{hook_definitions:mt}});let nn=F?void 0:e8n(pe,en,We.length,mt);for(let{hook:hn}of We)yield{message:{type:"progress",data:{type:"hook_progress",hookEvent:pe,hookName:ge,command:lH(hn),...hn.type==="prompt"&&{promptText:hn.prompt},..."statusMessage"in hn&&hn.statusMessage!=null&&{statusMessage:hn.statusMessage}},parentToolUseID:o,toolUseID:o,timestamp:new Date().toISOString(),uuid:PT()}};let Pt=Date.now(),et,lt;function ut(hn){if(et!==void 0)return et;try{return et={ok:!0,value:S(t)}}catch(ct){return h(pt(Error(`Failed to stringify hook ${ge} input`,{cause:ct}),"Failed to stringify hook input")),et={ok:!1,error:ct}}}let Ve,Ye=We.map(async function*({hook:hn,pluginRoot:ct,pluginId:Jn,skillRoot:Hn,matcherTexts:En},zn){if(Jn)oH(Jn,"hook",{kind:"hook",name:pe});if(Me&&(hn.type==="agent"||hn.type==="prompt")){yield x6n(hn,pe);return}let Sr;if(Me&&(hn.type==="command"||hn.type==="http"||hn.type==="mcp_tool")){let Cn=await I6n({hook:hn,pluginRoot:ct,skillRoot:Hn,matcherTexts:En},pe,$e).catch((wo)=>(n(`Hooks: could not judge a hook for a served call (${l(wo)}); holding it`),{held:"unreadable"}));if(Cn.held!==void 0){yield $6n(hn,pe,Cn.held,Cn.cause);return}Sr=Cn.program}if(hn.type==="callback"){let Cn=hn.timeout?hn.timeout*1000:y,{signal:wo,cleanup:ps}=Xa(d,{timeoutMs:Cn});try{yield await G6n({toolUseID:o,hook:hn,hookEvent:pe,hookInput:t,signal:wo,hookIndex:zn,toolUseContext:k}).finally(ps)}catch(Ei){if(Ei instanceof la){Ve=Ei,n(`${pe} SDK callback hook cancelled (control stream closed); draining sibling hooks`),yield{outcome:"cancelled",hook:hn};return}if(pe!=="UserPromptSubmit"&&pe!=="UserPromptExpansion"||!wo.aborted||d?.aborted)throw Ei;n(`${ge} callback hook timed out; swallowed rejection: ${l(Ei)}`),s("tengu_sdk_hook_callback_timeout",{hookEvent:c(pe)}),yield{blockingError:{blockingError:`${ge} hook callback timed out after ${Cn}ms`,command:yG(hn)},suppressOriginalPrompt:!0,outcome:"blocking",hook:hn}}return}if(hn.type==="function"){if(!x){yield{message:On({type:"hook_error_during_execution",hookName:ge,toolUseID:o,hookEvent:pe,content:"Messages not provided for function hook"}),outcome:"non_blocking_error",hook:hn};return}yield z6n({hook:hn,messages:x,hookName:ge,toolUseID:o,hookEvent:pe,timeoutMs:y,signal:d});return}let $r=hn.timeout?hn.timeout*1000:y,{signal:Lr,cleanup:wn}=Xa(d,{timeoutMs:$r}),Qn=PT(),mr=Date.now(),Yn=lH(hn),xr=ct??Hn,er=yG(hn),Or=xr&&hn.type==="command"?er.replace(hn.args===void 0?/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g:/\$\{CLAUDE_PLUGIN_ROOT\}/g,()=>xr):er;try{let Cn=ut(Jn);if(!Cn.ok){yield{message:On({type:"hook_error_during_execution",hookName:ge,toolUseID:o,hookEvent:pe,content:`Failed to prepare hook input: ${l(Cn.error)}`,command:Yn,durationMs:Date.now()-mr}),outcome:"non_blocking_error",hook:hn},wn();return}let wo=Cn.value;if(hn.type==="prompt"){if(!k)throw Error(`prompt-type hooks are not supported for ${pe} events (no conversation context is available). Use a command-type hook instead.`);if(k.agentId?.startsWith(Bie)){wn(),yield{message:On({type:"hook_cancelled",hookName:ge,toolUseID:o,hookEvent:pe}),outcome:"cancelled",hook:hn};return}let In=await Cxt(hn,ge,pe,wo,Lr,k,x,o,$r);if(In.message?.type==="attachment"){let Bn=In.message.attachment;if(Bn.type==="hook_success"||Bn.type==="hook_non_blocking_error")Bn.command=Yn,Bn.durationMs=Date.now()-mr}yield In,wn?.();return}if(hn.type==="agent"){if(!k)throw Error(`agent-type hooks are not supported for ${pe} events (no conversation context is available). Use a command-type hook instead.`);if(k.agentId?.startsWith(Bie)){wn(),yield{message:On({type:"hook_cancelled",hookName:ge,toolUseID:o,hookEvent:pe}),outcome:"cancelled",hook:hn};return}let In=await Oxt(hn,ge,pe,wo,Lr,k,o,"agent_type"in t?t.agent_type:void 0);if(In.message?.type==="attachment"){let Bn=In.message.attachment;if(Bn.type==="hook_success"||Bn.type==="hook_non_blocking_error")Bn.command=Yn,Bn.durationMs=Date.now()-mr}yield In,wn?.();return}if(hn.type==="http"){r9(Qn,ge,pe);let In=await Kft(hn,pe,wo,d,y);if(wn?.(),In.aborted){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:"Hook cancelled",stdout:"",stderr:"",exitCode:void 0,outcome:"cancelled"}),yield{message:On({type:"hook_cancelled",hookName:ge,toolUseID:o,hookEvent:pe,timedOut:!d?.aborted,timeoutMs:hn.timeout?hn.timeout*1000:y}),outcome:"cancelled",hook:hn};return}if(In.error||!In.ok){let Cr=In.error||`HTTP ${In.statusCode} from ${hn.url}`;eu({hookId:Qn,hookName:ge,hookEvent:pe,output:Cr,stdout:"",stderr:Cr,exitCode:In.statusCode,outcome:"error"}),yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:Cr,stdout:"",exitCode:In.statusCode??0}),outcome:"non_blocking_error",hook:hn};return}let{json:Bn,validationError:rr}=Qft(In.body);if(rr){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:In.body,stdout:In.body,stderr:rr,exitCode:In.statusCode,outcome:"error"}),yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:rr,stdout:In.body,exitCode:In.statusCode??0}),outcome:"non_blocking_error",hook:hn};return}if(Bn&&uS(Bn)){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:In.body,stdout:In.body,stderr:"",exitCode:In.statusCode,outcome:"success"}),yield{outcome:"success",hook:hn};return}if(Bn){let Cr=gK({json:Bn,command:hn.url,hookName:ge,toolUseID:o,hookEvent:pe,expectedHookEvent:pe,stdout:In.body,stderr:"",exitCode:In.statusCode});Sce(Bn.metrics,Jn,pe),eu({hookId:Qn,hookName:ge,hookEvent:pe,output:In.body,stdout:In.body,stderr:"",exitCode:In.statusCode,outcome:"success"}),yield{...Cr,outcome:"success",hook:hn};return}return}if(hn.type==="mcp_tool"){r9(Qn,ge,pe);let In=await Xxe(hn,pe,t,Me?void 0:k?.options.mcpClients,d,y);wn?.();let Bn=Me&&pe==="PreToolUse"?In.aborted?d?.aborted?void 0:"timed out":In.error!==void 0&&In.body===""?"could not be run":!In.ok?"returned an error":void 0:void 0;if(Bn!==void 0){let po=`a PreToolUse mcp_tool hook here ${Bn} for a call served for a cloud session; refusing rather than skipping that gate`;n(`Hooks: served-call mcp_tool gate (${hn.server}/${hn.tool}) refused (${Bn})${In.error?` \u2014 ${In.error}`:""}`,{level:"warn"}),eu({hookId:Qn,hookName:ge,hookEvent:pe,output:po,stdout:In.body,stderr:In.error||po,exitCode:2,outcome:"error"}),yield{blockingError:{blockingError:po,command:Or},outcome:"blocking",hook:hn};return}if(In.aborted){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:"Hook cancelled",stdout:"",stderr:"",exitCode:void 0,outcome:"cancelled"}),yield{message:On({type:"hook_cancelled",hookName:ge,toolUseID:o,hookEvent:pe,timedOut:!d?.aborted,timeoutMs:hn.timeout?hn.timeout*1000:y}),outcome:"cancelled",hook:hn};return}if(In.error||!In.ok){let po=In.error||"MCP tool returned an error";eu({hookId:Qn,hookName:ge,hookEvent:pe,output:po,stdout:In.body,stderr:po,exitCode:1,outcome:"error"}),yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:po,stdout:In.body,exitCode:1}),outcome:"non_blocking_error",hook:hn};return}let{json:rr,validationError:Cr}=I0e(In.body);if(Cr){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:In.body,stdout:In.body,stderr:Cr,exitCode:1,outcome:"error"}),yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:Cr,stdout:In.body,exitCode:1}),outcome:"non_blocking_error",hook:hn};return}if(eu({hookId:Qn,hookName:ge,hookEvent:pe,output:In.body,stdout:In.body,stderr:"",exitCode:0,outcome:"success"}),rr&&_p(rr)){let po=gK({json:rr,command:Yn,hookName:ge,toolUseID:o,hookEvent:pe,expectedHookEvent:pe,stdout:In.body,stderr:"",exitCode:0});Sce(rr.metrics,Jn,pe),yield{...po,outcome:"success",hook:hn};return}yield{message:On({type:"hook_success",hookName:ge,toolUseID:o,hookEvent:pe,content:`${ae.bold(ge)} completed`,stdout:In.body,stderr:"",command:Yn,durationMs:Date.now()-mr}),outcome:"success",hook:hn};return}let ps=$e?.env,Ei=Sr===void 0?hn:{...hn,command:Sr};r9(Qn,ge,pe);let nr=await hK(Ei,pe,ge,wo,uee(t),e.project,$e?.spawnCwd??t.cwd,Lr,Qn,zn,ct,Jn,Hn,O||Me,ps?.extra,$e===void 0?void 0:{base:$e.env.base,omit:$e.env.omit,shellPrefix:$e.shellPrefix},ve,Ie);wn?.();let xn=Date.now()-mr;if(nr.backgrounded){yield{outcome:"success",hook:hn};return}if(nr.aborted){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"cancelled"}),yield{message:On({type:"hook_cancelled",hookName:ge,toolUseID:o,hookEvent:pe,command:Yn,durationMs:xn,timedOut:!d?.aborted,timeoutMs:$r}),outcome:"cancelled",hook:hn};return}let{json:vr,plainText:Ar,validationError:Ho}=I0e(nr.stdout);if(Ho&&nr.status!==2){let In=Jft(Ho,nr.status,nr.stderr);eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:In,exitCode:nr.status,outcome:"error"}),yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:In,stdout:nr.stdout,exitCode:nr.status,command:Yn,durationMs:xn}),outcome:"non_blocking_error",hook:hn};return}if(vr){if(uS(vr)){if(nr.status===2){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"error"}),yield{blockingError:{blockingError:`[${Me?`${hn.type} hook`:Or}]: ${nr.stderr||"No stderr output"}`,command:Or},outcome:"blocking",hook:hn};return}if(nr.status!==0){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"error"}),yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:`Announced async, then failed with status code ${nr.status}: ${nr.stderr.trim()||"No stderr output"}`,stdout:nr.stdout,exitCode:nr.status,command:Yn,durationMs:xn}),outcome:"non_blocking_error",hook:hn,...nr.exitedNormally===!0&&!nr.spawnFailed&&nr.status<=128&&nr.status!==126&&nr.status!==127&&{ranByContract:!0}};return}eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"success"}),yield{outcome:"success",hook:hn};return}let In=gK({json:vr,command:Yn,hookName:ge,toolUseID:o,hookEvent:pe,expectedHookEvent:pe,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,durationMs:xn});if(Sce(vr.metrics,Jn,pe),_p(vr)&&!vr.suppressOutput&&Ar&&nr.status===0){let Bn=`${ae.bold(ge)} completed`;eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"success"}),yield{...In,message:In.message||On({type:"hook_success",hookName:ge,toolUseID:o,hookEvent:pe,content:Bn,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,command:Yn,durationMs:xn}),outcome:"success",hook:hn};return}if(nr.status===2&&!In.blockingError)In.blockingError={blockingError:`[${Me?`${hn.type} hook`:Or}]: ${nr.stderr||"No stderr output"}`,command:Or};eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:nr.status===0?"success":"error"}),yield{...In,outcome:In.blockingError?"blocking":"success",hook:hn};return}if(nr.status===0){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"success"});let In=await bce(nr.stdout.trim(),Qn,"stdout",{storageV5:ve});yield{message:On({type:"hook_success",hookName:ge,toolUseID:o,hookEvent:pe,content:In,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,command:Yn,durationMs:xn}),outcome:"success",hook:hn};return}if(nr.status===2&&I1t({hookEvent:pe,stdout:nr.stdout,stderr:nr.stderr,pluginId:Jn})){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"error"}),yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:`Hook script appears to be missing \u2014 "${Or}" exited 2 with: ${nr.stderr.trim()}. Treating as non-blocking. `+(Jn?`Run \`/plugin\` to reinstall '${Jn}' or remove it from settings.`:"If this is a plugin hook, check the plugin install (run /plugin)."),stdout:nr.stdout,exitCode:nr.status,command:Yn,durationMs:xn}),outcome:"non_blocking_error",hook:hn};return}if(nr.status===2){eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"error"}),yield{blockingError:{blockingError:`[${Me?`${hn.type} hook`:Or}]: ${nr.stderr||"No stderr output"}`,command:Or},outcome:"blocking",hook:hn};return}if(eu({hookId:Qn,hookName:ge,hookEvent:pe,output:nr.output,stdout:nr.stdout,stderr:nr.stderr,exitCode:nr.status,outcome:"error"}),nr.spawnFailed&&!Vxt(pe,Or)){yield{outcome:"non_blocking_error",hook:hn};return}yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:`Failed with non-blocking status code: ${nr.stderr.trim()||"No stderr output"}`,stdout:nr.stdout,exitCode:nr.status,command:Yn,durationMs:xn}),outcome:"non_blocking_error",hook:hn,...nr.exitedNormally===!0&&!nr.spawnFailed&&nr.status<=128&&nr.status!==126&&nr.status!==127&&{ranByContract:!0}};return}catch(Cn){wn?.();let wo=Cn instanceof Error?Cn.message:String(Cn);if(n(`Hook failed to run (${ge}): ${wo}`,{level:"error"}),eu({hookId:Qn,hookName:ge,hookEvent:pe,output:`Failed to run: ${wo}`,stdout:"",stderr:`Failed to run: ${wo}`,exitCode:1,outcome:"error"}),!Vxt(pe,Or)){yield{outcome:"non_blocking_error",hook:hn};return}yield{message:On({type:"hook_non_blocking_error",hookName:ge,toolUseID:o,hookEvent:pe,stderr:`Failed to run: ${wo}`,stdout:"",exitCode:1,command:Yn,durationMs:Date.now()-mr}),outcome:"non_blocking_error",hook:hn};return}}),ht={success:0,blocking:0,non_blocking_error:0,cancelled:0},xt={additionalContextChars:0,classifierContextChars:0,systemMessageChars:0,initialUserMessageChars:0,hookSuccessStdoutChars:0},dn=new Map(We.map((hn)=>[hn.hook,hn.pluginId])),Lt=new Map(We.map((hn)=>[hn.hook,hn])),pn=new Map;function bn(hn,ct,Jn){let Hn=dn.get(hn);if(!Hn||Jn===0)return;let En=pn.get(Hn);if(!En)En={additionalContextChars:0,classifierContextChars:0,systemMessageChars:0,initialUserMessageChars:0,hookSuccessStdoutChars:0},pn.set(Hn,En);En[ct]+=Jn}let Sn=0,_n;for await(let hn of JZ(Ye)){let ct=Me?U6n(pe==="PreToolUse"?B6n(hn,d):hn):hn;if(ht[ct.outcome]++,ct.message?.type==="attachment"&&ct.message.attachment.type==="hook_success"){let Hn=ct.message.attachment.stdout?.length??0;xt.hookSuccessStdoutChars+=Hn,bn(ct.hook,"hookSuccessStdoutChars",Hn)}if(ct.updatedToolOutput!==void 0)n(`Hook ${pe} (${lH(ct.hook)}) replaced tool output`),yield{updatedToolOutput:ct.updatedToolOutput};if(ct.updatedMCPToolOutput!==void 0&&ct.updatedToolOutput===void 0)n(`Hook ${pe} (${lH(ct.hook)}) replaced tool output (updatedMCPToolOutput)`),yield{updatedMCPToolOutput:ct.updatedMCPToolOutput};if(ct.displayContent!==void 0)yield{displayContent:ct.displayContent};if(ct.classifierContext){let Hn=ce(ct.classifierContext,aP);n(`Hook ${pe} (${lH(ct.hook)}) provided classifierContext (${Hn.length} chars after cap)`),xt.classifierContextChars+=Hn.length,bn(ct.hook,"classifierContextChars",Hn.length),yield{pairedRewrite:ct.updatedToolOutput!==void 0?"direct":ct.updatedMCPToolOutput!==void 0?"legacy_mcp":ct.legacyMcpRewriteSuppressed?"suppressed":"none",classifierContexts:[{value:Hn,hostPrincipal:ct.hook.type==="callback"&&dn.get(ct.hook)===void 0&&(()=>{let En=Lt.get(ct.hook);return En!==void 0&&En.pluginRoot===void 0&&En.skillRoot===void 0})()}]}}if(ct.preventContinuation)n(`Hook ${pe} (${lH(ct.hook)}) requested preventContinuation`),yield{preventContinuation:!0,stopReason:ct.stopReason};let Jn=ct.hook?.type==="prompt"?{hook:ct.hook,stopReason:ct.stopReason,impossible:ct.impossible}:{};if(ct.blockingError)yield{blockingError:ct.blockingError,suppressOriginalPrompt:ct.suppressOriginalPrompt,...Jn},_n="deny";if(ct.message)yield{message:ct.message,...Jn};if((pe==="PreToolUse"||pe==="PermissionRequest")&&ct.outcome==="non_blocking_error"&&o)sH.noteHookFailure(o,Wxt(pe,ct.message?.type==="attachment"&&ct.message.attachment.type==="hook_non_blocking_error"?ct.message.attachment.stderr:""));if(ct.timedOut&&ct.hook.type==="prompt"&&pe==="Stop")yield{hook:ct.hook,timedOut:!0};if(Sn++,ct.systemMessage){xt.systemMessageChars+=ct.systemMessage.length,bn(ct.hook,"systemMessageChars",ct.systemMessage.length);let Hn=await bce(ct.systemMessage,`${o}-${Sn}`,"systemMessage",{storageV5:ve});yield{message:On({type:"hook_system_message",content:Hn,hookName:ge,toolUseID:o,hookEvent:pe,...ct.heldForServedCall&&{heldForServedCall:!0}})}}if(ct.terminalSequence)Ege(ct.terminalSequence);if(ct.additionalContext)xt.additionalContextChars+=ct.additionalContext.length,bn(ct.hook,"additionalContextChars",ct.additionalContext.length),n(`Hook ${pe} (${lH(ct.hook)}) provided additionalContext (${ct.additionalContext.length} chars)`),yield{additionalContexts:[await bce(ct.additionalContext,`${o}-${Sn}`,"additionalContext",{storageV5:ve})]};if(ct.initialUserMessage)xt.initialUserMessageChars+=ct.initialUserMessage.length,bn(ct.hook,"initialUserMessageChars",ct.initialUserMessage.length),n(`Hook ${pe} (${lH(ct.hook)}) provided initialUserMessage (${ct.initialUserMessage.length} chars)`),yield{initialUserMessage:await bce(ct.initialUserMessage,`${o}-${Sn}`,"initialUserMessage",{storageV5:ve})};if(ct.watchPaths&&ct.watchPaths.length>0)n(`Hook ${pe} (${lH(ct.hook)}) provided ${ct.watchPaths.length} watchPaths`),yield{watchPaths:ct.watchPaths};if(ct.reloadSkills)n(`Hook ${pe} (${lH(ct.hook)}) requested reloadSkills`),yield{reloadSkills:!0};if(ct.sessionTitle)n(`Hook ${pe} (${lH(ct.hook)}) provided sessionTitle (${[...ct.sessionTitle].length} chars)`),yield{sessionTitle:ct.sessionTitle};if(sun(ct,`Hook ${pe} (${lH(ct.hook)})`),ct.permissionBehavior)switch(n(`Hook ${pe} (${lH(ct.hook)}) returned permissionDecision: ${ct.permissionBehavior}${ct.hookPermissionDecisionReason?` (reason: ${ct.hookPermissionDecisionReason})`:""}`),ct.permissionBehavior){case"deny":_n="deny";break;case"defer":if(_n!=="deny")_n="defer";break;case"ask":if(_n!=="deny"&&_n!=="defer")_n="ask";break;case"allow":if(!_n)_n="allow";break;case"passthrough":break}if(ct.permissionBehavior&&_n===ct.permissionBehavior){let Hn=ct.updatedInput&&(ct.permissionBehavior==="allow"||ct.permissionBehavior==="ask")?ct.updatedInput:void 0;if(Hn)n(`Hook ${pe} (${lH(ct.hook)}) modified tool input keys: [${Object.keys(Hn).join(", ")}]`);yield{permissionBehavior:_n,hookPermissionDecisionReason:ct.hookPermissionDecisionReason,...ct.heldForServedCall&&{heldForServedCall:!0},hookSource:We.find((En)=>En.hook===ct.hook)?.hookSource,updatedInput:Hn}}if(ct.updatedInput&&ct.permissionBehavior===void 0)n(`Hook ${pe} (${lH(ct.hook)}) modified tool input keys: [${Object.keys(ct.updatedInput).join(", ")}]`),yield{updatedInput:ct.updatedInput};if(ct.permissionRequestResult)yield{permissionRequestResult:ct.permissionRequestResult};if(ct.retry)yield{retry:ct.retry};if(ct.elicitationResponse)yield{elicitationResponse:ct.elicitationResponse};if(ct.elicitationResultResponse)yield{elicitationResultResponse:ct.elicitationResultResponse};if(ke&&ct.hook.type!=="callback"){let Hn=u??"",En=ke.getEntry(e.id,pe,Hn,ct.hook);if(En?.onHookSuccess&&ct.outcome==="success")try{En.onHookSuccess(ct.hook,ct)}catch(zn){h(Error("Session hook success callback failed",{cause:zn}))}}}let mn=Date.now()-Pt;for(let hn of new Set(dn.values()))if(hn)Zw(hn);if(!F){STe()?.observe("hook_duration_ms",mn);for(let[hn,ct]of pn){let{name:Jn,marketplace:Hn}=qt(hn);s("tengu_hook_plugin_injected",{hookName:Ke,...V$(Jn,Hn),...ct})}if(s("tengu_repl_hook_finished",{hookName:Ke,numCommands:We.length,numSuccess:ht.success,numBlocking:ht.blocking,numNonBlockingError:ht.non_blocking_error,numCancelled:ht.cancelled,totalDurationMs:mn,...xt}),Po("hook_execution_complete",{hook_event:pe,hook_name:en,num_hooks:String(We.length),num_success:String(ht.success),num_blocking:String(ht.blocking),num_non_blocking_error:String(ht.non_blocking_error),num_cancelled:String(ht.cancelled),total_duration_ms:String(mn),managed_only:String(wwe()),hook_source:wwe()?"policySettings":"merged",safe_mode:String(Dr()),...nt&&{hook_definitions:mt}}),nn)t8n(nn,{numSuccess:ht.success,numBlocking:ht.blocking,numNonBlockingError:ht.non_blocking_error,numCancelled:ht.cancelled});if(ht.non_blocking_error>0)f(wpe(pe),"hook_non_blocking_error");else if(ht.cancelled>0)g(wpe(pe),"hook_cancelled");else _(wpe(pe))}if(Ve)throw Ve}
````

#### z_ named hop W6n

- assignment: W6n @187241944 len=124 sha=67698c04897ce000

````
var W6n=new Set(["PreToolUse","PermissionRequest","UserPromptSubmit","UserPromptExpansion","TaskCompleted","TeammateIdle"]);
````

### $sn

- verdict: BODY
- function: $sn @185574156 len=270 sha=87935827b04fe4f2 via=function $sn( hits=1
- call: `let o=$sn(e)` in KSn — context token count after last compact

````
function $sn(e){let t=e.findLastIndex(Pu);for(let o=e.length-1;o>t;o--){let u=e[o];if(u?.type!=="assistant")continue;let d=Eh(u),y=d?Pj(d):0;if(y>0)return y}let r=t===-1?void 0:e[t];if(r!==void 0&&Pu(r))return r.compactMetadata.postTokens??oh(e.slice(t+1));return oh(e)}
````

### Y_e

- verdict: BODY
- function: Y_e @185568683 len=83 sha=70f354bc5317effe via=function Y_e( near KSn (dist=662 from Ewe)
- rejected collision: async function Y_e @203470571 (CLAUDE_JOB_DIR bridge cleanup)

````
function Y_e(e){return e.findLast((t)=>t.type==="assistant"&&t.message.model!==rd)}
````

### vwe

- verdict: BODY
- function: vwe @185568973 len=270 sha=a69bbea65369c349 via=function vwe( near Ewe/KSn
- call: `vwe(e,t)` in Ewe; `vwe(t??d.message.model??at(),o)` in KSn — cache_ttl + estimated_cache_write_usd
- rejected collision: vwe @183444010 (goal_set / Stop hook)

````
function vwe(e,t,r=GSn()){let o={...gf,cache_creation_input_tokens:t,cache_creation:{ephemeral_5m_input_tokens:r==="5m"?t:0,ephemeral_1h_input_tokens:r==="1h"?t:0}},{usd:u,pricing:d}=Ler(e,o);return{cache_ttl:r,estimated_cache_write_usd:Math.round(u*1e4)/1e4,pricing:d}}
````

### VSn

- verdict: BODY
- function: VSn @185573811 len=345 sha=d4f1b59917694bc9 via=function VSn( hits=1
- call: `O=VSn(e)?y:NaN` in KSn — whether last compact is a cache-warm anchor

````
function VSn(e){let t=e.findLastIndex(Pu);if(t===-1)return!0;for(let u=e.length-1;u>t;u--){let d=e[u];if(d?.type!=="assistant")continue;let y=Eh(d);if(y&&Pj(y)>0)return!0}let r=e[t];if(r===void 0||!Pu(r))return!1;let o=r.compactMetadata.preservedMessages?.anchorUuid??r.compactMetadata.preservedSegment?.anchorUuid;return o!==void 0&&o===r.uuid}
````

### gRn

- verdict: BODY
- function: gRn @179049328 len=147 sha=82ea52c51c8c78da via=function gRn( hits=1
- call: `gRn({sessionId,contextTokens,requestAt,ttlMs})` in KSn — resume seed into requestJournal

````
function gRn(e){let t=n();if(e.sessionId!==void 0&&e.sessionId===t.id)t.requestJournal.applyResumeSeed(e);else t.requestJournal.stageResumeSeed(e)}
````

### dD

- verdict: BODY (gate)
- function: dD @186760799 len=85 sha=bb98049db725662c via=function dD( immediately before hdt
- call: `if(!dD(e)) return {decision:"proceed"}` — skip PreModelSwitch hooks unless nVn() or matcher iE hits
- rejected collision: dD @181119010 `return yh(_7,{})`

````
function dD(e){if(nVn())return!0;return iE("PreModelSwitch",Kle.of(e).registry,e.id)}
````

#### dD named hop nVn

- function: nVn @186758371 len=95 sha=409cd46e03f5d642

````
function nVn(){let e=Jt();return e.hookRegistrationInFlight!==void 0||e.hookRegistrationFailed}
````

### cre

- verdict: BODY (gate)
- function: cre @180584703 len=97 sha=410354fdbaffbc77 via=function cre( hits=1
- call: `if(cre(t.toModel)) await hJ(t.toModel)` — Bedrock application-inference-profile without a resolved backing id

````
function cre(e){return e.includes("application-inference-profile")&&typeof gie(hr(e))!=="string"}
````

### hJ

- verdict: BODY (gate)
- function: hJ @180584572 len=131 sha=b3b70c4821f152d5 via=function hJ( adjacent to cre @180584703
- call: `await hJ(t.toModel)` — cache inference-profile backing model
- rejected collision: hJ @203197469 (tmux UI, y(91))

````
function hJ(e){let t=hr(e),r=Ac().providerCache.inferenceProfileBackingModels,o=r.get(t);if(o===void 0)o=_I(t),r.set(t,o);return o}
````

### pEt

- verdict: BODY (gate)
- function: pEt @179887321 len=35 sha=affde90d06fa895f via=function pEt( hits=1
- call: `toolUseID:pEt()` in hdt/ydt
- adjacent literal: GXe="remote-settings-helper-consent"

````
function pEt(){return Kt(we(),GXe)}
````

### LOe

- verdict: BODY (gate)
- function: LOe @180780907 len=30 sha=6ff11d8499b77b25 via=function LOe( hits=1
- call: `matchQuery:LOe(d)?d:void 0` — wrapper over DOe

````
function LOe(e){return DOe(e)}
````

#### LOe named hop DOe

- function: DOe @180780145 len=70 sha=da81fe6303149f7e (same cluster as LOe; rejected DOe @202826256 zod schema)

````
function DOe(e){let t=fn(e);return Zl(t)!==void 0||_3.has(t)||t===aKt}
````

### Kle

- verdict: BODY (store, not `function Kle`)
- `function Kle(` hits=0. Binding is var Kle. `.of` comes from class Ln.
- assignment: Kle @186765144 len=40 sha=b38c507de20ac8ea
- call: `Kle.of(e).registry` in hdt/ydt/dD

````
var Kle=new Ln(()=>({registry:void 0}));
````

#### Kle / yEt named hop Ln

- class Ln @179027862 len=220 sha=5c466000a2e3b768

````
class Ln{#e;#t=new WeakMap;constructor(e){this.#e=e}peek(e){return this.#t.get(e.root)}of(e){let t=e.root,o=this.#t.get(t);if(o!==void 0)return o;let r=this.#e();return this.#t.set(t,r),r}drop(e){this.#t.delete(e.root)}}
````

### Hye

- verdict: BODY (const, not the colliding function)
- `function Hye(` @194737254 is `async function Hye(e)` hook-pins on a path — rejected (hdt uses `timeoutMs??Hye` with no call)
- assignment: Hye @185263247 len=9 sha=87e0da92eb371034
- cluster window @185263220: `=600000,Bye=30000,_Ve=6000,Hye=30000,x7e=5000;`

````
Hye=30000
````

### yBn

- verdict: BODY (gate)
- function: yBn @186764691 len=256 sha=2f1c6d7ff023ab17 via=function yBn( hits=1
- call: `yBn(O.message,o)` in hdt — collect hook_system_message / hook_non_blocking_error

````
function yBn(e,t){if(e?.type!=="attachment")return;let r=e.attachment;if(r.type==="hook_system_message")t.push(r.content);else if(r.type==="hook_non_blocking_error"){let o=r.stderr.trim();t.push(`PreModelSwitch hook ${r.hookName} failed${o?`: ${o}`:""}`)}}
````

### yEt

- verdict: BODY (store, not `function yEt`)
- `function yEt(` hits=0. Binding is var yEt over class gEt.
- assignment: yEt @186762723 len=28 sha=737e63ab7a7eade3
- class gEt @186762671 len=52 sha=8d9ffb89c4d8d170
- call: `let o=yEt.of(e)` in ydt — pending / landedOn / inFlight

````
var yEt=new Ln(()=>new gEt);
````

````
class gEt{pending=[];landedOn=null;inFlight=new Set}
````

### supporting #1 Jt (plugin registry, not spend bar)

Osn/Lsn call `Jt().hookRegistrationInFlight`. This no-arg Jt is adjacent to se() which owns those fields. 38 `function Jt(` collisions exist; this is not the #3 bar.

- function: Jt @181786426 len=35 sha=4866e46d5f708fda
- factory: se @181784689 len=1654 sha=1585fa90ebda943e

````
function Jt(){return ae().registry}
````

````
function se(){return{pluginLoad:void 0,pluginLoadArm:void 0,pluginLoadCacheOnly:void 0,pluginLoadCacheOnlyArm:void 0,commands:void 0,skills:void 0,skillsV5:void 0,agents:void 0,outputStyles:void 0,workflows:void 0,hookRegistration:void 0,hookRegistrationInFlight:void 0,hookRegistrationFailed:!1,hookRegistrationRetried:!1,hookRegistrationArgs:void 0,hookHotReloadUnsubscribe:void 0,hookHotReloadSettingsSnapshot:void 0,loadedModules:[],notices:Oa(new Map),openCalls:new Map,spawnProvenance:new Map,renderVersions:Oa(new Map),uiLogSink:null,pendingUiLog:[],armedMonitorKeys:new Set,marketplaces:new Map,marketplaceRefreshesInFlight:new Map,marketplaceHelperMemo:new Map,addDirMarketplacesMemo:void 0,headlessInstallPass:void 0,installedPluginsMigrated:!1,installedPluginsFile:null,installedPluginsEpoch:0,installedPluginsSnapshot:null,optionValues:new Map,flaggedPlugins:null,orphanedVersionGlobExclusions:null,recentActivity:[],pluginActivityFeatures:new Map,autoUpdateListener:null,commandSourceReresolve:null,pendingAutoUpdateNotification:null,ownInUseMarkerPaths:new Set,ownInUseMarkerHandles:new Map,commandProducerDirsDenied:new Set,commandProducerDirsScannedAt:0,commandProducerDirsComparable:null,commandProducerDirsNeedCanonicalCandidate:!1,commandProducerDirsWslProviderUndeterminable:!1,commandProducerDirsChanged:Fe(),inUseMarkerCleanup:void 0,hintedPluginIds:new Set,gitAvailable:void 0,operatorDeclaredMemo:void 0,marketplaceAdmissionVerdicts:new Map,hiddenRegistryEntries:{raw:new Map,v5:new Map},releasedRegistryEntries:{raw:new Set,v5:new Set},cacheRootComparableMemo:void 0,provenLocalRoots:new Map,wslProviderOfPluginsRootMemo:void 0}}
````

## #3 callees

Empty-window copy is already inside Dl (gold-251-a). Exact ASCII `Spend limit · shown once your gateway reports one` hits=0 because the official separator is U+00B7 (`\xB7`). Mid-needle `shown once your gateway reports one` hits=2 @93514262 (string table) and @208976292 (inside Dl). Do not invent a second copy.

### HPe

- verdict: BODY
- function: HPe @184985281 len=40 sha=68854330a39beb2a via=function HPe( hits=1
- call in Dl: `nm?e(Jt,{title:"Spend limit",...}):HPe()?null:e(t,{dimColor:!0,children:"Spend limit \xB7 shown once your gateway reports one"})`
- empty-window hide: when `pm.limitsObserved` is truthy, Dl returns null instead of the once-your-gateway-reports copy. Not invented.

````
function HPe(){return pm.limitsObserved}
````

### jL

- verdict: BODY
- function: jL @184985089 len=154 sha=09e58cf644b42090 via=function jL( adjacent to HPe (rawUtilization)
- call: `jL()` in X1e / Dl — filters pm.rawUtilization to live windows
- rejected collision: jL @200184164 (zod enum factory)

````
function jL(){let e=Date.now()/1000,t=e+31536000,r={};for(let[o]of V4e){let u=pm.rawUtilization[o];if(_Y(u)&&u.resets_at>e&&u.resets_at<t)r[o]=u}return r}
````

### Jt

- verdict: BODY (spend-limit bar factory)
- function: Jt @208972948 len=2226 sha=d16b7d81ecf6bf05 via=function Jt( nearest Dl@208975936 (dist=2988)
- call: `e(Jt,{title:"Spend limit",limit:{utilization,resets_at},maxWidth,alwaysShowDateInReset:!0})` when overage is present
- `qr===null` returns null (no bar). Not the plugin-registry Jt.

````
function Jt(zD){let et=y(41),{title:gs,limit:YD,maxWidth:Yr,showTimeInReset:fh,alwaysShowDateInReset:gh,extraSubtext:Zd,trailingLines:hs,subtextOverride:hh}=zD,em=fh===void 0?!0:fh,tm=gh===void 0?!1:gh,{utilization:qr,resets_at:Jr}=YD;if(qr===null){return null}let ys=`${Math.floor(qr)}% used`,it;if(Jr){let gt;if(et[0]!==tm||et[1]!==Jr||et[2]!==em)gt=R$e(Jr,!0,em,tm),et[0]=tm,et[1]=Jr,et[2]=em,et[3]=gt;else gt=et[3];it=`Resets ${gt}`}if(Zd){if(it)it=`${Zd} \xB7 ${it}`;else it=Zd}if(hh!==void 0)it=hh;if(Yr>=62){let gt;if(et[4]!==gs)gt=e(t,{bold:!0,children:gs}),et[4]=gs,et[5]=gt;else gt=et[5];const Fo=qr/100;let lo;if(et[6]!==Fo)lo=e(M_,{ratio:Fo,width:50,fillColor:"rate_limit_fill",emptyColor:"rate_limit_empty"}),et[6]=Fo,et[7]=lo;else lo=et[7];let co;if(et[8]!==ys)co=e(t,{children:ys}),et[8]=ys,et[9]=co;else co=et[9];let Uo;if(et[10]!==lo||et[11]!==co)Uo=r(o,{flexDirection:"row",gap:1,children:[lo,co]}),et[10]=lo,et[11]=co,et[12]=Uo;else Uo=et[12];let uo;if(et[13]!==it)uo=it&&e(t,{dimColor:!0,children:it}),et[13]=it,et[14]=uo;else uo=et[14];let mo;if(et[15]!==hs)mo=e(Mi,{lines:hs}),et[15]=hs,et[16]=mo;else mo=et[16];let Di;if(et[17]!==gt||et[18]!==Uo||et[19]!==uo||et[20]!==mo)Di=r(o,{flexDirection:"column",flexShrink:0,children:[gt,Uo,uo,mo]}),et[17]=gt,et[18]=Uo,et[19]=uo,et[20]=mo,et[21]=Di;else Di=et[21];return Di}else{let gt;if(et[22]!==gs)gt=e(t,{bold:!0,children:gs}),et[22]=gs,et[23]=gt;else gt=et[23];let Fo;if(et[24]!==it)Fo=it&&r(U,{children:[e(t,{children:" "}),r(t,{dimColor:!0,children:["\xB7 ",it]})]}),et[24]=it,et[25]=Fo;else Fo=et[25];let lo;if(et[26]!==gt||et[27]!==Fo)lo=r(t,{children:[gt,Fo]}),et[26]=gt,et[27]=Fo,et[28]=lo;else lo=et[28];let co;if(et[29]!==hs)co=e(Mi,{lines:hs}),et[29]=hs,et[30]=co;else co=et[30];const Uo=qr/100;let uo;if(et[31]!==Yr||et[32]!==Uo)uo=e(M_,{ratio:Uo,width:Yr,fillColor:"rate_limit_fill",emptyColor:"rate_limit_empty"}),et[31]=Yr,et[32]=Uo,et[33]=uo;else uo=et[33];let mo;if(et[34]!==ys)mo=e(t,{children:ys}),et[34]=ys,et[35]=mo;else mo=et[35];let Di;if(et[36]!==lo||et[37]!==co||et[38]!==uo||et[39]!==mo)Di=r(o,{flexDirection:"column",flexShrink:0,children:[lo,co,uo,mo]}),et[36]=lo,et[37]=co,et[38]=uo,et[39]=mo,et[40]=Di;else Di=et[40];return Di}}
````

## note

present=[Osn | Lsn | z_ | $sn | Y_e | vwe | VSn | gRn | dD | cre | hJ | pEt | LOe | Kle | Hye | yBn | yEt | HPe | jL | Jt]
absent=[-]
MISS=none
HPe invented=no
hook runner invented=no
z_ is the named async generator; Qxt is its official executor hop.
