# densable 2.1.214 — OTel out-of-context interaction trace (#41)

> Binary: `C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe` (`@anthropic-ai/claude-code@2.1.214`)

> Official checklist #41: OTel loses interaction `trace_id`/`span_id` outside turn async context.

## Root cause densable fixed

Events and child spans read OTel context via `zKn()` (not raw `context.active()` only). Interaction start (`Wtg`/`Qrt`) stamps the active OTel context with the interaction span **and** a sticky module-level fallback `qKn` (`qWi`). When ALS store falls back to `ROOT_CONTEXT` (timers / detached promises / out-of-turn callbacks), `zKn` returns sticky `qKn` so log records still carry interaction `trace_id`/`span_id`.

## Minified evidence

### sticky_context_manager

```js
class O3c{als=new M3c.AsyncLocalStorage;active(){return this.als.getStore()??VWi.ROOT_CONTEXT}with(e,t,r,...n){let o=r==null?t:t.bind(r);return this.als.run(e,o,...n)}enterWith(e){this.als.enterWith(e)}bind(e,t){if(typeof t==="function"){let r=(...n)=>this.with(e,()=>t(...n));return Object.defineProperty(r,"length",{configurable:!0,enumerable:!1,writable:!1,value:t.length}),r}return t}enable(){return this}disable(){return this.als.disable(),this}}function qWi(e){qKn=e}function N3c(){return qKn}function zKn(){let e=WGe.active();return e===VWi.ROOT_CONTEXT&&qKn?qKn:e}var VWi,M3c,WGe,qKn;var KKn=b(()=>{VWi=C(rl(),1),M3c=require("async_hooks");WGe=new O3c});function Mtg(){return Z.OTEL_LOG_USER_PROMPTS}function H4r(e){return Mtg()?e:"<REDACTED>"}function U3c(){return Z.OTEL_LOG_ASSISTANT_RESPONSES??Z.OTEL_LOG_USER_PROMPTS}function Ntg(){let e=zKn(),t=f7t.trace.getSpanContext(e);if(t&&f7t.isS
```

### zKn_Ntg_vc

```js
function zKn(){let e=WGe.active();return e===VWi.ROOT_CONTEXT&&qKn?qKn:e}var VWi,M3c,WGe,qKn;var KKn=b(()=>{VWi=C(rl(),1),M3c=require("async_hooks");WGe=new O3c});function Mtg(){return Z.OTEL_LOG_USER_PROMPTS}function H4r(e){return Mtg()?e:"<REDACTED>"}function U3c(){return Z.OTEL_LOG_ASSISTANT_RESPONSES??Z.OTEL_LOG_USER_PROMPTS}function Ntg(){let e=zKn(),t=f7t.trace.getSpanContext(e);if(t&&f7t.isSpanContextValid(t))return e;if(dn()&&Z.TRACEPARENT)return Otg.extract(e,{traceparent:Z.TRACEPARENT,tracestate:Z.TRACESTATE},f7t.defaultTextMapGetter);return}async function vc(e,t={},r){let n={..._Ct(),"event.name":e,"event.timestamp":new Date().toISOString(),"event.sequence":Ltg++},o=mEt();if(o)n["prompt.id"]=o;let i=Z.CLAUDE_CODE_WORKSPACE_HOST_PATHS;if(i)n["workspace.host_paths"]=i.split("|");Object.assign(n,x$r(r));for(let[u,d]of Object.entries(t))if(d!==void 0)n[u]=d;let s=new Date,a=Ntg(),l={timestamp:s,observedTimestamp:s,body:`claude_code.${e}`,attributes:n,...a&&{context:a}},c=zkr();if(c){c.emit(l);return}if(!Goi(l)&&!$3c)$3c=!0,T(`[3P telemetry] Event dropped (no event logger initialized): ${e}`,{level:"warn"})}function Ege(e){if(e.from===e.to)return;vc("permission_mode_changed",{from_mode:e.from,to_mode:e.to,...e.trigger&&{trigger:e.trigger}})}function zrt(e){vc("compaction",{trigger:e.trigger,success:String(e.success),duration_ms:String(Math.round(e.durationMs)),...e.preTokens!==void 0&&{pre_tokens:String(e.preTokens)},...e.postTokens!==void 0&&{post_tokens:String(e.postTokens)},...e.error&&{error:e.error},...e.precomputeReuse&&{precompute_reuse:e.precomputeReuse}})}fun
```

### Qrt_Wtg_QKn_xMe

```js
function Qrt(e,t){Jrt.set(t.span,t);let r=Yb.trace.setSpan(t.priorContext,t.span).setValue(e,t);if(WGe.enterWith(r),e===Xrt)qWi(r)}function Zrt(e,t){if(t.ended=!0,e===Xrt&&N3c()?.getValue(e)===t)qWi(void 0);if(J8().getValue(e)===t)WGe.enterWith(t.priorContext)}function ACt(e,t={}){return{..._Ct(),"span.type":e,...t}}function Wtg(e){let t=VGe()?lGc(e):void 0,r=J8();if(!gre()){if(t){let c=Yb.trace.getActiveSpan()||M3().startSpan("dummy");return Qrt(Xrt,{span:c,startTime:performance.now(),attributes:{"span.type":"interaction"},perfettoSpanId:t,priorContext:r}),c}return Yb.trace.getActiveSpan()||M3().startSpan("dummy")}let n=M3(),i=Z.OTEL_LOG_USER_PROMPTS?e:"<REDACTED>";uGc++;let s=ACt("interaction",{user_prompt:i,user_prompt_length:e.length,"interaction.sequence":uGc}),a=dn()&&Z.TRACEPARENT?Yb.propagation.extract(r,{traceparent:Z.TRACEPARENT,tracestate:Z.TRACESTATE}):r,l=n.startSpan("claude_code.interaction",{attributes:s},a);return q3c(l,e),Qrt(Xrt,{span:l,startTime:performance.now(),attributes:s,perfettoSpanId:t,priorContext:r}),l}function QKn(e,t){let r=J8();Wtg(e);let n=J8();try{return WGe.with(n,t)}finally{if(J8()===n)WGe.enterWith(r)}}function xMe(){let e=g7t(Xrt);if(!e)return;if(e.perfettoSpanId)cGc(e.perfettoSpanId);if(!gre()){Zrt(Xrt,e);return}let t=Math.max(0,Math.round(performance.now()-e.startTime));e.span.setAttributes({"interaction.duration_ms":t}),e.span.end(),Zrt(Xrt,e)}function mGc(e,t,r,n,o){let i=VGe()?tGc({model:e,querySource:r?.querySource,messageId:void 0}):void 0,s=J8();if(!gre()){if(i){let d=Yb.trace.getActiveSpan()||M3().startSpan("dummy");return Jrt.set(d,{span:d,startTime:performance.now(),attributes:{model:e},perfettoSpanId:i,priorContext:s}),d}return Yb.trace.getActiveSpan()||M3().startSpan("dummy")}let a=M3(),l=J8().getValue(ECt),c=ACt("llm_request",{model:e,"gen_ai.system":"anthropic","gen_ai.request.model":e,"llm_request.context":l?"tool":g7t(Xrt)?"interaction":"standalone",speed:o?"fast":"normal"}),u=a.startSpan("claude_code.llm_request",{attributes:c},s);if(r?.querySource)u.setAttribute("query_source",r.querySource);if(t&&!Ihe(t)){if(t.agentId)u.setAttribute("agent_id",t.agentId);if(t.parentAgentId)u.setAttribute("parent_agent_id",
```

### bootstrap_setGlobalContextManager

```js
function _Hd(){if(Obe.context.setGlobalContextManager(WGe),!Z.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE)process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE="delta";if(CP()&&!a4e())SHd()}function bHd(){let e=zoi();if(e)return e;let t=Rt(),r={[vut.ATTR_SERVICE_NAME]:"claude-code",[vut.ATTR_SERVICE_VERSION]:{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/ove
```

### context_keys

```js
kingError} hook(s) failed`});r.span.end()}var Yb,dGc,Jrt,Xrt,ECt,I4r,e3i,pGc,uGc=0,Gtg;var yre=b(()=>{lt();qd();xy();xa();Gr();VKn();h7t();bCt();KKn();SCt();Yb=C(rl(),1),dGc=C(IS(),1),Jrt=new WeakMap,Xrt=Yb.createContextKey("cc.interaction_state"),ECt=Yb.createContextKey("cc.tool_state"),I4r=Yb.createContextKey("cc.blocked_state"),e3i=Yb.createContextKey("cc.execution_state"),pGc=Yb.createContextKey("cc.subagent_state");Gtg=new dGc.W3CTraceContextPropagator});function TCt(e){let t={CLAUDECODE:"1",CLAUDE_CODE_SESSION_ID:e.sessionId,CLAUDE_CODE_CHILD_SESSION:"1",CLAUDE_PID:String(process.pid)};i
```

### QKn_processUserInput

```js
nput_start");let A=[],w=!1,x,I,R,k,P,L,M=y??[],$=M[0]?.workload,D=$!==void 0&&M.every((U)=>U.workload===$)?$:void 0,j=Math.max(0,M.findIndex(jQn)),B=M[j]?.value,W=typeof B==="string"?B:B?Oc(B,`
`):"";await M4n(D,()=>QKn(W,async()=>{let U=E();for(let V=0;V<M.length;V++){let G=M[V],Q=V===j,q=G.origin??(G.mode==="task-notification"?{kind:"task-notification"}:void 0),Y=G.isMeta||!Bre(q)?"system":G.inputSource??_,X=await pyr({input:G.value,preExpansionInput:G.preExpansionValue,promptSource:Y,suppressWorkflowKeyword:G.suppressWorkflowKeyword,mode:G.mode,setToolJSX:s,context:U,pastedContents:G.pastedContents,messages:t,setUserInputOnProcessing:Q?l:void 0,isAlreadyProcessing:!Q,querySource:o,canUseT
```

### QKn_print_ask

```js
=null}}B=Lc(),W=[];let on=void 0;Promise.resolve().then(() => (TWt(),oxr)).then((pn)=>pn.flushSyncedFiles()).catch(()=>{}),XP("before_ask"),qXr();let Ur=Ir,In,wo,ao=typeof lr==="string"?lr:Oc(lr,`
`);await eZu(Ur.ccrTurnId,()=>M4n(Ur.workload??d.workload,()=>QKn(ao,async()=>{let pn=!1,Cn=!1,yi=0,Qo=c1(),Ts=se.length,Ol=OA();w=Date.now(),Zoe.startCLIActivity("print-ask");try{for await(let qi of T8f({commands:zA([...hr,...Wl.mcp.commands],"name"),prompt:lr,promptUuid:Ur.uuid,isMeta:Ur.isMeta,shouldQuery:Ur.shouldQuery,stopHookActive:Ur.stopHookActive,fileAttachments:Ur.fileAttachments,skipSlashCommands:Ur.skipSlashCommands,bridgeOrigin:Ur.bridgeOrigin,modelScheduledOrigin:Ur.modelScheduledOrig
```
