# gold-251-l

Official densable 2.1.251 win32-x64 SEA `claude.exe` 217360032 bytes. Invent-ban. Not a HAVE mark. Missing callees for PARTIAL #53 #55 #59 #60 #61 #62 #63 #67. Pbt/S/F, BZn, Xbt/RYe/aw/bl/xt/rw, J/K, Kh, n$t/wtt/Kfn, zNe/Tn already in gold-251-e / gold-251-f.

Method: `allHits` `function NAME(` + `async function NAME(` (drop the `async ` substring hit). Nearest def to the gold caller offset, including hoisted defs after the call. NU/Rn/Cn/bjn are assignments (brace/regex walker). Host-flag `return[]` uses `lastFnStartGeneric` from each hit. sha is sha256/16 of the printed body. BODY or MISS. Full body, no clip.

| # | name | Verdict | @ | sha | Body |
| --- | --- | --- | --- | --- | --- |
| 53 | `NU` | BODY | 180248954 | fc440091bb3634f1 | firstParty id → catalog key; Jbn treats hasOwn as alias |
| 53 | `ME` | BODY | 179503988 | 49f82c421f280f3c | AWS region via host or shared-config; Pbt awaits then gl() |
| 53 | `gl` | BODY | 180587669 | 72e16d2483a176fb | fire-and-forget ef() after KFe/bedrock gate; no host-flag skip |
| 53 | `S` | BODY | 204744184 | b47e9cf7bb384c5f | already gold-251-e; bedrock upgrade return[] on host flag |
| 53 | `F` | BODY | 204745112 | 8e99466362e1ca4d | already gold-251-e; bedrock fallback return[] on host flag |
| 53 | `R` | BODY | 204736845 | 350e3d6c45ce086d | vertex upgrade return[] on host flag |
| 53 | `U` | BODY | 204737601 | 0a4f61343a5ec9d1 | vertex fallback return[] on host flag |
| 53 | `B` | BODY | 205209120 | 03f7740b53977d76 | mantle default/fallback return[] on host flag |
| 53 | `zje` | BODY | 203965042 | 223d6828242ac34c | host flag returns undefined, not [] |
| 55 | `CAt` | BODY | 186859544 | d0bae59d6c4cb823 | last assistant text vs bjn leaked-invoke regex; no 3P branch |
| 55 | `bjn` | BODY | 186859505 | db4e95f7cd367824 | CAt predicate <antml:invoke\\b |
| 55 | `x0e` | BODY | 187199244 | 7d412f35c8c1bcd0 | StopFailure hook after exhausted tombstone; no 3P branch |
| 55 | `OS` | BODY | 186864583 | 97e1299be7b26e5e | repl_main_thread markApiFailure; no 3P branch |
| 55 | `qo` | BODY | 188061219 | 46a0f99a1ecfcc06 | exhausted system/api-error message factory; no 3P branch |
| 59 | `AVt` | BODY | 180783062 | 40746fb48732def4 | Claude ${VP(id)} or Claude (${id}) |
| 60 | `wo` | BODY | 180773882 | 73b17367a8b0b303 | available-models state refused/inactive/active |
| 60 | `pbr` | BODY | 181265557 | 6099c67bd5983c68 | Dn()?.seatTier ?? null |
| 60 | `aw` | BODY | 180769116 | 08c0e16ae1ea774e | full; bedrock/vertex only when Ne() is those strings |
| 61 | `G3` | BODY | 181688603 | 5a44f1c7b55a6393 | low|medium|high|xhigh else undefined; no max |
| 61 | `p5e` | BODY | 181690350 | c5fe646fa7f75aaa | canonical model key fn(Xe(Mt(e),{deterministic:!0})) |
| 61 | `Ii` | BODY | 180094315 | 4040dfaae4906ca8 | enabled settings sources + flagSettings + policySettings |
| 62 | `Zq` | BODY | 180677112 | 8933888a4bf06806 | complete; !firstParty unless PROVIDER_MANAGED_BY_HOST |
| 63 | `ign` | BODY | 185402726 | 5a676d2f3cc48c37 | complete REST footer fetch; gold-251-f was clipped |
| 67 | `Rn` | BODY | 179761257 | d3ffc1d38d7ac327 | header-name token grammar |
| 67 | `$Kt` | BODY | 179744103 | 67e95689a1e54f21 | header-value line_break/nul/non_ascii or null |
| 67 | `Cn` | BODY | 179760659 | 3f592e50a6dd958e | sensitive header-name regex; complete |

## #53 NU, ME, gl + host-flag empty returns

Gold: `Jbn` `Object.hasOwn(NU,t)` @180784878. `Pbt` `await ME(),gl();return` @180587897. `S`/`F` already gold-251-e. Extra `return[]` on the host flag: vertex `R`/`U`, mantle `B`. `zje` returns undefined on the host flag, not `[]`. `gl` itself has no host-flag skip (it still calls `ef()`).

### `NU` @180248954 sha=`fc440091bb3634f1` len=72

```
NU=Object.fromEntries(Object.entries(so).map(([e,t])=>[t.firstParty,e]))
```

### `ME` @179503988 sha=`49f82c421f280f3c` len=96

```
async function ME(){let r=d();if(r)return r;return await u().readAwsSharedConfigRegion()||AAe()}
```

### `gl` @180587669 sha=`72e16d2483a176fb` len=84

```
function gl(){if(KFe()!==null)return;if(Ne()!=="bedrock"){Pkt(zr(Ne()));return}ef()}
```

### `R` @204736845 sha=`350e3d6c45ce086d` len=726

```
async function R(){if(Ne()!=="vertex")return[];if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return[];let i=Wje(p);if(i.length===0)return[];s("tengu_vertex_upgrade_check",{stale_tiers:wi(i.length)});let u=(await Promise.all(i.map(async(e)=>{let t=so[e.defaultKey].vertex;if(t===null)return null;let r=await g(t);if(s("tengu_vertex_probe_result",{tier:c(e.tier),model_id:yn(t),accessible:r}),!r)return null;let f=$u(so[e.pinnedKey].firstParty),l=$u(so[e.defaultKey].firstParty);if(!f||!l)return null;return{tier:e.tier,envVar:e.envVar,fromKey:e.pinnedKey,fromMarketingName:f,toKey:e.defaultKey,toMarketingName:l,toVertexId:t}}))).filter((e)=>e!==null);return n(`[vertex-upgrade] tiersWithPin=${i.length} candidates=${u.length}`),u}
```

### `U` @204737601 sha=`0a4f61343a5ec9d1` len=830

```
async function U(){if(Ne()!=="vertex")return[];if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return[];let i=Je().modelOverrides,o=Gje(p,i);if(o.length===0)return[];s("tengu_vertex_default_check",{unpinned_tiers:wi(o.length)});let u=await Promise.all(o.map(async(t)=>{let r=so[t.defaultKey],f=await g(r.vertex);if(s("tengu_vertex_probe_result",{tier:c(t.tier),model_id:yn(r.vertex),accessible:f}),f)return null;let l=await y(t.defaultKey,t.tier,i);if(!l)return null;let m=$u(r.firstParty),d=$u(so[l.key].firstParty);if(!m||!d)return null;return{tier:t.tier,envVar:t.envVar,defaultKey:t.defaultKey,defaultName:m,fallbackKey:l.key,fallbackName:d,fallbackVertexId:so[l.key].vertex,...l.crossTier&&{crossTier:!0}}})),e=[];for(let t of u)if(t!==null)e.push(t);return n(`[vertex-fallback] unpinnedTiers=${o.length} fallbacks=${e.length}`),e}
```

### `B` @205209120 sha=`03f7740b53977d76` len=1788

```
async function B(e=qve,o){if(Ne()!=="mantle")return[];if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return[];let r=Je().modelOverrides;if(r?.[so[e].firstParty])return[];let u=o?.userPinned??ap()!=null,m=a.ANTHROPIC_DEFAULT_OPUS_MODEL,i;if(m!==void 0&&!CK("opus")){if(u)return[];let t=await b(qP(m));if(s("tengu_mantle_probe_result",{model_key:w("admin_pin"),accessible:w(t==="refuted"?"false":t==="accessible"?"true":"unknown")}),t!=="refuted")return[{kind:"adminPin",tier:"opus",adminMantleId:m}];i=m}let d=so[e].mantle;if(!d)return[];s("tengu_mantle_default_check",{});let l=await E(d);if(s("tengu_mantle_probe_result",{model_key:c(e),accessible:w(l?"true":"false")}),l){if(i!==void 0)return[{kind:"pinRefuted",tier:"opus",refutedValue:i,workingKey:e,workingName:$u(so[e].firstParty)??d,workingMantleId:d,defaultKey:e}];return[]}let f=$u(so[e].firstParty)??d,g=M.indexOf(e),p=M.slice(0,g).reverse().filter((t)=>t.startsWith("opus")&&!r?.[so[t].firstParty]),k=await Promise.all(p.map(async(t)=>{let A=so[t].mantle,_=await E(A);s("tengu_mantle_probe_result",{model_key:c(t),accessible:w(_?"true":"false")});let P=$u(so[t].firstParty)??A;return{key:t,mantleId:A,name:P,ok:_}}));for(let t of k)if(t.ok){if(n(`[mantle-fallback] default=${e} fallback=${t.key}`),i!==void 0)return[{kind:"pinRefuted",tier:"opus",refutedValue:i,workingKey:t.key,workingName:t.name,workingMantleId:t.mantleId,defaultKey:e}];return[{kind:"fallback",tier:"opus",envVar:"ANTHROPIC_DEFAULT_OPUS_MODEL",defaultKey:e,defaultName:f,fallbackKey:t.key,fallbackName:t.name,fallbackMantleId:t.mantleId}]}let h=[...i!==void 0?[`the admin-configured model (${i})`]:[],f,...k.map((t)=>t.name)];return n(`[mantle-fallback] default=${e} exhausted \u2014 no working Opus`),[{kind:"exhausted",tier:"opus",defaultName:f,triedNames:h}]}
```

### `zje` @203965042 sha=`223d6828242ac34c` len=292

```
function zje(e,o){let r=e?.trim();if(!r)return;if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return;let t=T(r);if(!t)return;let n=l(t);if(!n)return;if(n==="haiku")return;let i=o[n];if(Je().modelOverrides?.[so[i.defaultKey].firstParty])return;return{tier:n,envVar:i.envVarPriority.at(-1),value:r}}
```


## #55 CAt, x0e, OS, qo

Gold excerpt @186913600 names `CAt(Cr)`, `qo({content,now,uuid})`, `x0e(Li,ct)`, `OS(ct,A,Li)`. None of these four bodies mention Bedrock, Vertex, or Foundry.

### `CAt` @186859544 sha=`d0bae59d6c4cb823` len=116

```
function CAt(e){let t=e.flatMap((r)=>r.message.content).findLast((r)=>r.type==="text")?.text??"";return bjn.test(t)}
```

### `bjn` @186859505 sha=`db4e95f7cd367824` len=38

```
var bjn=new RegExp("<antml:invoke\\b")
```

### `x0e` @187199244 sha=`7d412f35c8c1bcd0` len=495

```
async function x0e(e,t,r=Oi){if(Ha(t.agentContext))return;if(!iE("StopFailure",t.sessionHooksRegistry,t.session.id))return;let o=Vr(e.message.content,`
`).trim()||void 0,u=e.error??"unknown",d={...va(t.session,ee(),void 0,t),hook_event_name:"StopFailure",error:u,error_details:e.errorDetails,last_assistant_message:o};await kv({session:t.session,sessionHooks:t.sessionHooksRegistry,getAppState:t.getAppState,hookInput:d,timeoutMs:r,matchQuery:u,storageV5:t.storageV5,credentials:t.credentials})}
```

### `OS` @186864583 sha=`97e1299be7b26e5e` len=182

```
function OS(e,t,r){let o=cT(e);if(!Jh||!o||!t.startsWith("repl_main_thread")||e.agentId)return;Jh().markApiFailure(o,pu(),r.error,ex(r)??r.errorDetails??"",r.apiError).catch(()=>{})}
```

### `qo` @188061219 sha=`46a0f99a1ecfcc06` len=357

```
function qo({content:e,apiError:t,apiErrorIsTransient:r,quotaLimits:o,error:u,errorDetails:d,truncatedAfterOutput:y,now:k,uuid:A}){let x=gGt({content:[{type:"text",text:e===""?op:e}],isApiErrorMessage:!0,apiError:t,apiErrorIsTransient:r,quotaLimits:o,error:u,errorDetails:d,truncatedAfterOutput:y,now:k,uuid:A});if(vGt(x))x.healsDistinctCarrier=!0;return x}
```


## #59 AVt

Gold `BZn` @187544776: known catalog id → `AVt(e)`; else `ZO` → `Claude` / leftover → `Claude Code`.

### `AVt` @180783062 sha=`40746fb48732def4` len=75

```
function AVt(e){let t=VP(e);if(t)return`Claude ${t}`;return`Claude (${e})`}
```


## #60 wo, pbr, aw

Gold `rw` @180760796 reads `wo().state!=="inactive"`. Gold `RYe` @181265183 reads `pbr()==="enterprise_usage_based"`. `aw` @180769116 was already complete in gold-251-f (len=410); reprinted. The Bedrock/Vertex arm is only `if(e==="bedrock"||e==="vertex")` inside this body.

### `wo` @180773882 sha=`73b17367a8b0b303` len=2376

```
function wo(){try{let e=hM(),t=_e("policySettings"),r=(A)=>{if(!t||e.length===0)return;let y=A?"enforceAvailableModels: an admin policy source failed to load; enforcing the surviving admin tier (the failed source may carry a different policy \u2014 fix it to restore full coverage)":"enforceAvailableModels: an admin policy source failed to load and the surviving admin tier carries no model policy \u2014 model enforcement is OFF; the failed source may have carried it";if(!ot().has(y))ot().add(y),n(y,{level:"warn"})};if(e.length>0&&!o5()){if(!ot().has("enforceAvailableModels: a policy source exists but failed to load; refusing cascade-trust mode (model enforcement from user/project settings is disabled until the policy source is fixed)"))ot().add("enforceAvailableModels: a policy source exists but failed to load; refusing cascade-trust mode (model enforcement from user/project settings is disabled until the policy source is fixed)"),n("enforceAvailableModels: a policy source exists but failed to load; refusing cascade-trust mode (model enforcement from user/project settings is disabled until the policy source is fixed)",{level:"warn"});return{state:"refused"}}if(!t)return{state:"inactive",cascadeTrusted:!0};let{availableModels:o,enforceAvailableModels:u,modelOverrides:d}=t;if(e.length===0&&o===void 0&&u===void 0&&d===void 0&&(db()==="hkcu"||db()==="parent"))return{state:"inactive",cascadeTrusted:!0};if(u&&o===void 0){if(!ot().has("enforceAvailableModels: the policy view sets the enforce flag but not availableModels; enforcement is disabled (the flag requires a policy-owned allowlist)"))ot().add("enforceAvailableModels: the policy view sets the enforce flag but not availableModels; enforcement is disabled (the flag requires a policy-owned allowlist)"),n("enforceAvailableModels: the policy view sets the enforce flag but not availableModels; enforcement is disabled (the flag requires a policy-owned allowlist)",{level:"warn"});return r(!1),{state:"inactive",cascadeTrusted:!1}}if(u!==!0||o===void 0||o.length===0)return r(!1),{state:"inactive",cascadeTrusted:!1};return r(!0),{state:"active",allowlist:o,overridesMap:d??UJ()??{}}}catch(e){let t=`enforceAvailableModels: policy-tier settings read failed; refusing cascade-trust mode: ${e instanceof Error?e.message:String(e)}`;if(!ot().has(t))ot().add(t),n(t,{level:"warn"});return{state:"refused"}}}
```

### `pbr` @181265557 sha=`6099c67bd5983c68` len=43

```
function pbr(){return Dn()?.seatTier??null}
```

### `aw` @180769116 sha=`08c0e16ae1ea774e` len=410

```
function aw(){if(Et()){if(Xbt())return{setting:Qb()?qe(bl()):bl(),envFamily:"opus"}}else if(ra())return{setting:Qb()?qe(bl()):bl(),envFamily:"opus"};let e=Ne();if(e==="mantle")return{setting:pc()[qve],envFamily:null,concreteBaseline:String(Pt()[qve])};if(e==="bedrock"||e==="vertex"){if(rw())return{setting:cp(),envFamily:"sonnet"};return{setting:bl(),envFamily:"opus"}}return{setting:cp(),envFamily:"sonnet"}}
```


## #61 G3, p5e, Ii

Gold `J` @181689542 / `K`: `p5e` canonicalizes the model key; `G3` filters effort tokens; `Ii()` is the settings-source list mapped through `_e`.

### `G3` @181688603 sha=`5a44f1c7b55a6393` len=83

```
function G3(e){if(e==="low"||e==="medium"||e==="high"||e==="xhigh")return e;return}
```

### `p5e` @181690350 sha=`c5fe646fa7f75aaa` len=56

```
function p5e(e){return fn(Xe(Mt(e),{deterministic:!0}))}
```

### `Ii` @180094315 sha=`4040dfaae4906ca8` len=238

```
function Ii(){let e=ime(),t=Ra();if(t.enabledSources?.allowed===e)return t.enabledSources.result;let r=new Set(e);r.add("flagSettings"),r.add("policySettings");let o=Is.filter((i)=>r.has(i));return t.enabledSources={allowed:e,result:o},o}
```


## #62 Zq

Gold `Kh` @180677347: `Zq()||gi()!==null||bW()||e2()`. `Zq` in gold-251-f was already the full 77-byte body. Reprinted.

### `Zq` @180677112 sha=`8933888a4bf06806` len=77

```
function Zq(){if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return!1;return!dr()}
```


## #63 ign

Gold-251-f sketched `n$t`/`wtt`/`Kfn` and clipped `ign` (1023 chars omitted). Full `ign` @185402726 below.

### `ign` @185402726 sha=`5a676d2f3cc48c37` len=2623

```
async function ign(e){let t=Date.now();if(kt()||gZ())return null;if(e==="main"||e==="master")return null;let r=await lgn();if(!r)return null;let o=await _ke(r.host);if(o.kind!=="token"){if(!zo(r.host)&&!rW(process.env.GH_HOST,r.host))return null;return jA().logAuthState(o.kind==="gh-missing"?"gh_missing":"needs_auth"),bke(r.host),o.kind==="gh-missing"?"gh-missing":"needs-auth"}jA().logAuthState("token_present");let u=o.token,d=await ugn(r,u),y=jA().directStateForBranch(e),k=y.pr&&{...y.pr,reviewDecision:y.reviewDecision},A=_vt(r.host),x=new URL(A).origin,O=`${A}/repos/${d.owner}/${d.repo}/pulls?head=${encodeURIComponent(r.owner)}:${encodeURIComponent(e)}&state=open&per_page=1`,F=!1,U;try{let ge=AbortSignal.timeout(hZ),ve={Authorization:`Bearer ${u}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":Mtt,"User-Agent":Va(),...y.etag&&{"If-None-Match":y.etag}},Ie=(Be)=>fetch(Be,{...Hi({url:Be}),keepalive:!1,method:"GET",headers:ve,redirect:"manual",signal:ge}),ke=await Ie(y.redirectedListUrl??O),Pe=rgn.has(ke.status)?ke.headers.get("location"):null,Me=Pe?new URL(Pe,O):null;if(Me?.origin===x)y.redirectedListUrl=Me.href,ke=await Ie(Me.href);if(U=ke.status,ke.status===304);else if(ke.ok){y.etag=ke.headers.get("etag"),F=!0;let Be=ogn().safeParse(await ke.json()),$e=Be.success?Be.data[0]:void 0;if($e&&y.pr?.number!==$e.number)y.reviewDecision="";y.pr=$e?{number:$e.number,url:$e.html_url,isDraft:$e.draft}:null}else{if(ke.status===401)bke(r.host);else if(ke.status===403||ke.status===429)jA().backOffFromResponse(ke);return f("github_pr_status_direct",ke.status===401?"unauthorized":ke.status===403||ke.status===429?"rate_limited":"http_error",{http_status:wi(ke.status)}),n(`[ghPrStatus] REST list ${ke.status} on ${r.host}`,{level:"debug"}),"fetch-failed"}}catch(ge){return f("github_pr_status_direct","fetch_threw",{error_name:lI(ge)??w("unknown"),errno_code:co(ge)??co(ge?.cause)??w("")}),"fetch-failed"}let B=y.pr;if(!B)return _("github_pr_status_direct",{http_status:wi(U),pr_found:!1,review_fetched:!1}),null;let W=y.reviewDecision,V=!1,me=F||Date.now()-y.lastReviewFetchAt>=ngn;if(me){let ge=await agn({host:r.host,owner:d.owner,repo:d.repo},u,B.number);if(ge!==null){if(W=ge,y.pr?.number===B.number)y.reviewDecision=ge,y.lastReviewFetchAt=t}else V=!0}let fe={http_status:wi(U),pr_found:!0,review_fetched:me};if(V)g("github_pr_status_direct","review_decision_unavailable",fe);else _("github_pr_status_direct",fe);let pe=!V&&k?.number===B.number&&k.url===B.url&&k.isDraft===B.isDraft&&k.reviewDecision===W;return{number:B.number,url:B.url,reviewState:egn(B.isDraft,W),...pe&&{notModified:!0}}}
```


## #67 Rn, $Kt, Cn

Gold `Tn` @179761036: `!Rn.test(s)||$Kt(...)!==null||Cn.test(s.toLowerCase())`. `zNe`/`Tn` already gold-251-f.

### `Rn` @179761257 sha=`d3ffc1d38d7ac327` len=38

```
var Rn=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
```

### `$Kt` @179744103 sha=`67e95689a1e54f21` len=342

```
function $Kt(e){let t=0,o=e.length;while(t<o&&Ke(e.charCodeAt(t)))t++;while(o>t&&Ke(e.charCodeAt(o-1)))o--;let s=je(e.slice(t,o));if(s!==-1)return{kind:"line_break",index:x(e,t+s)};for(let r=t;r<o;r++){let c=e.charCodeAt(r);if(c===0)return{kind:"nul",index:x(e,r)};if(c>255)return{kind:"non_ascii",index:x(e,r),codePoint:$e(e,r)}}return null}
```

### `Cn` @179760659 sha=`3f592e50a6dd958e` len=376

```
Cn=/auth|key|token|cookie|secret|credential|session|signature|passw|jwt|assertion|cert|oidc|org|tenant|account|project|workspace|user|email|identity|principal|consumer|client|host|url|base|target|upstream|endpoint|proxy|forward|route|fallback|override|apigw|x-goog-|l5d-|bypass|guardrail|amz|x-ms-|azureml|extra-parameters|envoy|helicone|litellm|cf-aig|cf-access|beta|version/
```

