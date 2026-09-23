# gold-251-f

Official densable 2.1.251 win32-x64 SEA `claude.exe` 217360032 bytes. Invent-ban. Not a HAVE mark. Skipped #64 #65 #68 #70 #71.

| # | Verdict | Hits | sha | Body |
| --- | --- | --- | --- | --- |
| 55 | BODY | malformed_tool_use=13 retry-context=0 broken-output=0 | excerpt aefaef4e3edeb540 | Tombstone the unparsed assistant turn; retry context is prior messages plus a meta retry prompt |
| 56 | BODY | /radio=4 name:"radio" obj=1 ==="radio"=1 | call 4ed480f21973cb49 | Local command radio; call opens https://clau.de/radio; no telemetry or 3P predicate on the object or call |
| 57 | BODY | skip_all_permission_checks=7 tengu_cfc=0 cfc_in_product=0 | Nq ee9ce6ba6dcc41ca | Chrome tool uses ask / follow_a_plan unless bypassPermissions; Nq is session bypass, not telemetry |
| 58 | BODY | CLAUDE_CODE_SUBAGENT_MODEL=6 | jR d9d770c32c697e1d | Per-spawn model r, then agent model e, then env sY() |
| 59 | BODY | literal Co-Authored-By: Claude Code=0 Co-Authored-By=2 | BZn 7dccb0f89e01118d | Unrecognized model falls through to Claude Code; trailer is composed, not a literal |
| 60 | BODY | seat-based=0 enterprise_usage_based=3 opus5 token=17 | aw 08c0e16ae1ea774e | Xbt includes non-usage-based enterprise; aw returns bl()/opus5 when Xbt() |
| 61 | BODY | effortByModel=0 effortLevel=61 /effort=25 | J f2900eb809eac659 | Read modelSettings[].effortLevel into byModel; write modelSettings[model].effortLevel |
| 62 | BODY | DISABLE_TELEMETRY=10 forceLoginMethod=32 | Kh 9a4057988f282332 | Analytics off for gateway only when gatewayAuth is set, or via privacy/DISABLE_TELEMETRY; Kh has no forceLoginMethod |
| 63 | BODY | gh pr view=29 gh auth token=9 tengu_harbor_prism=0 | ign 5a676d2f3cc48c37 | Footer fetch is n$t→ign REST; token is GH_TOKEN, GITHUB_TOKEN, or gh auth token; harbor flag absent |
| 66 | BODY | weakensIsolation=3 enableWeakerNestedSandbox=13 .restrictive=0 | VU 8d57fc9e876dd631 | qe sandbox keys enter sandboxSettings; Zor re-prompts when dangerousSettingsHash changes |
| 67 | BODY | ANTHROPIC_CUSTOM_HEADERS=44 | zNe f89ca1bbb4f2147e | Tn/Cn treats auth and host header names as sensitive; those values join the approval env set |
| 69 | BODY | name:"JavaScript"=2 name:"Mathematica"=0 maxima=0 isbl=0 "1c"=0 name:"GML"=0 name:"SQF"=0 | js grammar 2eba3bc49c028447 | highlight.js grammars present; the six language names are absent beside them |

## #55 BODY

Malformed tool-use retry drops the assistant turn. `Cr` is tombstoned. The next request is `messages:[...Cn, vi]` where `vi` uses `Blt`. `Blt` is "The previous response failed to produce a valid tool call. Please retry the tool call now." The neighbor string `bin` ("Your tool call was malformed and could not be parsed. Please retry.") is not the value inserted here. `transition.reason` is `malformed_tool_use_retry`. A second failure yields "The model's tool call could not be parsed (retry also failed)." This excerpt has no Bedrock, Vertex, or Foundry branch.

Blt @184252168 sha=63965e3fc0c7d4c3

```
Blt="The previous response failed to produce a valid tool call. Please retry the tool call now.",bin="Your tool call was malformed and could not be parsed. Please retry.",jlt="[Your previous response 
```

excerpt @186913600 len=1180 sha=aefaef4e3edeb540

```
covery","exhausted"),yield kn}if((kn?.message.stop_reason??Bn)==="tool_use"&&Ms.length===0&&!kn?.isApiErrorMessage){let ls=Pe.transition?.reason!=="malformed_tool_use_retry";if(s("tengu_malformed_tool_use_response",{will_retry:ls,model:yn(zr),text_has_leaked_invoke:CAt(Cr)}),ls){for(let ou of Cr)yield{type:"tombstone",message:ou};let vi=xe({content:Blt,isMeta:!0,turnCompanion:!0,now:pe.now,uuidFn:pe.uuid});yield vi,Pe={messages:[...Cn,vi],toolUseContext:ct,compactTracking:ps,maxOutputTokensRecoveryCount:0,hasAttemptedReactiveCompact:!1,maxOutputTokensOverride:void 0,pendingToolUseSummary:void 0,stopHookActive:Qn,thinkingOnlyNudged:Sr,stopHookBlockingCount:0,turnCount:Yn,transition:{reason:"malformed_tool_use_retry"}};continue}let Li=qo({content:"The model's tool call could not be parsed (retry also failed).",now:pe.now,uuid:pe.uuid});return yield Li,x0e(Li,ct),OS(ct,A,Li),{reason:"malformed_tool_use_exhausted"}}let Xo=kn?.message.stop_reason??Bn;if((Xo==="end_turn"||Xo==="stop_sequence")&&!kn?.isApiErrorMessage&&A!=="compact"&&!XE(A)&&!lrt(Cn)&&!Cr.some((ls)=>ls.message.content.some((Li)=>Li.type==="text"&&Li.text.trim().length>0))&&!Co(Cn)){if(!Sr){g("query_thi
```

## #56 BODY

`/radio` is a local command in the command list (`HLt=Lnr`) with no `isEnabled`. `call` only opens `https://clau.de/radio`. The `==="radio"` hit is an HTML input type. No other command-gate string for `radio` showed up.

command @187638607 sha=a17e4813ec598911

```
var Lnr={type:"local",name:"radio",description:"Listen to Claude FM lo-fi radio",supportsNonInteractive:!1,load:()=>import("B:/~BUN/root/chunk-xbcmhz34.js")},HLt=Lnr;var KOe={type:"local-jsx",name:"advisor",description:"
```

call @193300847 len=212 sha=4ed480f21973cb49

```
async function r(){if(await Lr("https://clau.de/radio"))return{type:"text",value:"Opening Claude FM in your browser\u2026"};return{type:"text",value:"Couldn't open the browser. Listen at: https://clau.de/radio"}}
```

## #57 BODY

Claude in Chrome tool `call` sets `permissionMode` to `skip_all_permission_checks` only when the resolved mode is `bypassPermissions`. Otherwise it uses `follow_a_plan` (with `onPermissionRequest`) or `ask`. `Nq()` is `sessionBypassPermissionsMode`, and `Dme` / `TD` use that for `CLAUDE_CHROME_PERMISSION_MODE`. `tengu_cfc` and `cfc_in_product` are 0. No `DISABLE_TELEMETRY` read in these snippets.

Nq @179066448 len=75 sha=ee9ce6ba6dcc41ca

```
function Nq(){return n().host.launchOptions.sessionBypassPermissionsMode()}
```

Dme @191130466 sha=828f8d6bfa873521

```
function Dme(e){let t=[],o={};if(Nq())o.CLAUDE_CHROME_PERMISSION_MODE="skip_all_permission_checks";let i=Object.keys(o).length>0;return(async()=>{let r=wxe()&&!await PWn(vae()),{cmd:d,prefixArgs:u}=TZ({pinToCurrentBinary:r}),y=await ln([d,...u,"--chrome-native-host"]);await Vcr(y
```

TD @202677030 len=61 sha=be9e857cbd97e0b3

```
function TD(){return Nq()?"skip_all_permission_checks":"ask"}
```

chrome call excerpt @211738496 len=640 sha=44eb0317d7a3ed8c

```
vedHostByToolUseId.delete(i),uf().resolvedUrlByToolUseId.delete(i);let d=he(s),a=s.options?.tools?.find((w)=>on(w,e)),c=kx(a,d)==="bypassPermissions",h=x(d),b=h.allowed,R=[...h.allowedRaw];if(m&&!b.has(y(m)))b.add(y(m)),R.push(m);let p=F(),T=c?{permissionMode:"skip_all_permission_checks",sessionScope:p}:m?{permissionMode:"follow_a_plan",allowedDomains:R,onPermissionRequest:se(b),sessionScope:p}:R.length>0?{permissionMode:"follow_a_plan",allowedDomains:R,sessionScope:p}:{permissionMode:"ask",sessionScope:p},I=await ie(t,o,s,T);if(l!==void 0)E(K(),l);if(m)_("chrome_permission_prompt");return I}}}
export{Pvr,VQt};
.// @bun @bytecode
//
```

## #58 BODY

`sY()` reads `CLAUDE_CODE_SUBAGENT_MODEL` (anything other than `inherit`). `jR(e,t,r,o,u)`: `t` is the parent model, `o` is permission mode. Spawn site `jR(N9(en,dn), dn, We?"inherit":Pr, pe)` passes the agent-derived model as `e` and the per-spawn model as `r`. `jR` applies `r` first, then `e`, and calls `sY()` only after both are unset or not a concrete model.

sY @185481336 len=85 sha=112b036e30886d49

```
function sY(){let e=a.CLAUDE_CODE_SUBAGENT_MODEL;return e&&e!=="inherit"?e:"inherit"}
```

jR @185481421 len=830 sha=d9d770c32c697e1d

```
function jR(e,t,r,o,u){let d=()=>hf({permissionMode:o??"default",mainLoopModel:t,exceeds200kTokens:!1}),y=nVt(t),k=(U,B)=>{if(y&&Ga(U)==="bedrock"){if(nVt(B))return U;return ure(U,y)}return U},A=()=>{let U=sY();if(U==="inherit")return d();let B=k(Mt(U),U);if(Hr(B))return B;return Ay(U)??d()},x=(U,B,W=U)=>{let V=Ay(U);b_n(U,V!==null);let me=V!==null?B?qke(Jb(V)):V:A();if(fn(Mt(W)).toLowerCase()!==fn(Mt(me)).toLowerCase())u?.(U,me,V!==null?"family_step_down":"parent_inherit");return me};if(r){if(r==="inherit")return d();if(F$t(r,t))return t;let U=k(qke(Mt(r)),r);if(!Hr(U))return x(r,!0,U);return U}if(e!==void 0&&e!=="inherit"){if(F$t(e,t))return t;let U=k(qke(Mt(e)),e);if(!Hr(U))return x(e,!0,U);return U}if(e==="inherit")return d();let O=sY();if(O==="inherit")return d();let F=k(Mt(O),O);if(!Hr(F))return x(O,!1);return F}
```

spawn @186154627 sha=e1bd48eef1a43c5d

```
ed MCP servers.`)}}if(en.color)a5e(en.agentType,en.color);let dn=am(A),Lt=(Pr)=>jR(N9(en,dn),dn,We?"inherit":Pr,pe),pn={
```

## #59 BODY

The literal `Co-Authored-By: Claude Code` is absent. `UZn` builds `Co-Authored-By: ${BZn(at())} <noreply@anthropic.com>`. `BZn`: known catalog id via `rDt` becomes `AVt` (`Claude ${label}` or `Claude (${id})`). Otherwise `ZO` (canonical known model) yields `Claude`, and the remaining case yields `Claude Code`.

UZn @187544500 len=276 sha=33567a99226b4c0b

```
function UZn(){let e=DOt(),t=`Co-Authored-By: ${BZn(at())} <noreply@anthropic.com>`,r=Je(),o=r.attribution;if(o!==void 0&&Cvn(o))return{commit:o.commit??t,pr:o.pr??e};if(r.includeCoAuthoredBy===!1)return nDt().fire("attribution_texts"),{commit:"",pr:""};return{commit:t,pr:e}}
```

BZn @187544776 len=133 sha=7dccb0f89e01118d

```
function BZn(e){if(lp(e)&&(!dr()||jo()||ZO(e)))return AVt(NJ.firstParty);if(rDt(e))return AVt(e);return ZO(e)?"Claude":"Claude Code"}
```

## #60 BODY

`seat-based` is 0. Seat split is `seatTier==="enterprise_usage_based"` (`RYe` / `pbr`) versus any other `$n()==="enterprise"` (`_fe()&&!rw()`). `Xbt` is true for max, team `default_claude_max_5x`, usage-based enterprise, or other enterprise when `rw()` is false. `rw` is true when the catalog has sonnet, lacks opus, and available-models enforcement is off. When `Xbt()` is true, `aw` returns `bl()` with `envFamily:"opus"` (also on the `ra()` branch, and on Bedrock/Vertex when `rw()` is false). `bl` uses `ANTHROPIC_DEFAULT_OPUS_MODEL` or `xt`, and `xt` is `Hs("opus")??e.opus5`. Catalog maps `"claude-opus-5":"opus5"`.

Xbt @180781937 len=67 sha=d629fb758655ad5c

```
function Xbt(){if(fAe()||qSt()||RYe())return!0;return _fe()&&!rw()}
```

RYe @181265183 len=76 sha=cdc585039bbfc599

```
function RYe(){return $n()==="enterprise"&&pbr()==="enterprise_usage_based"}
```

aw @180769116 len=410 sha=08c0e16ae1ea774e

```
function aw(){if(Et()){if(Xbt())return{setting:Qb()?qe(bl()):bl(),envFamily:"opus"}}else if(ra())return{setting:Qb()?qe(bl()):bl(),envFamily:"opus"};let e=Ne();if(e==="mantle")return{setting:pc()[qve],envFamily:null,concreteBaseline:String(Pt()[qve])};if(e==="bedrock"||e==="vertex"){if(rw())return{setting:cp(),envFamily:"sonnet"};return{setting:bl(),envFamily:"opus"}}return{setting:cp(),envFamily:"sonnet"}}
```

bl @180765357 len=90 sha=d272127514bc367c

```
function bl(){let e=a.ANTHROPIC_DEFAULT_OPUS_MODEL;if(e!==void 0)return Jb(e);return xt()}
```

xt @180765447 len=49 sha=21f55afb869436aa

```
function xt(e=pc()){return Hs("opus",e)??e.opus5}
```

rw @180760796 len=115 sha=97f24c109da28be1

```
function rw(){let e=nw(),t=wo().state!=="inactive"||vn()?.enforceAvailableModels===!0;return e.sonnet&&!e.opus&&!t}
```

## #61 BODY

No `effortByModel` string. `J` walks settings sources, reads `modelSettings[model].effortLevel` into `byModel`, and if a source has no per-model entry it copies that source's `effortLevel` onto each model key. `K(model, level)` persists `{modelSettings:{[model]:{effortLevel}}}` (prototype-key guard writes top-level `effortLevel` instead).

J @181689542 len=626 sha=f2900eb809eac659

```
function J(){let e=Je(),o=D({cli:{effort:void 0},env:process.env,settings:e});if(e.ultracode===!0)return{default:o,byModel:{}};let t=Ii().map((i)=>_e(i)).filter((i)=>i!==void 0&&i!==null).reverse(),r=t.map((i)=>{let d=new Map;for(let[p,E]of Object.entries(i.modelSettings??{})){let m=E?.effortLevel;if(m===void 0)continue;let g=p5e(p);if(p===g||!d.has(g))d.set(g,m)}return d}),u=new Set;for(let i of r)for(let d of i.keys())u.add(d);let f={};for(let i of u)for(let d=0;d<t.length;d++){let p=r[d].get(i);if(p!==void 0){f[i]=G3(p);break}if(t[d].effortLevel!==void 0){f[i]=G3(t[d].effortLevel);break}}return{default:o,byModel:f}}
```

K @181690406 len=124 sha=15fca4d45893ed41

```
function K(e,o){let t=p5e(e);return Object.hasOwn(Object.prototype,t)?{effortLevel:o}:{modelSettings:{[t]:{effortLevel:o}}}}
```

## #62 BODY

`Kh` is the `analyticsDisabled` predicate: `Zq()||gi()!==null||bW()||e2()`. `Zq` is not-first-party (`!dr()`, `dr` is `Ne()==="firstParty"`) unless `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`. `gi` is `credentialSlots.gatewayAuth()` — analytics stay off when that slot is set, not when managed `forceLoginMethod==="gateway"` merely exists. `Kh` does not mention `forceLoginMethod`. `bW` is privacy `!=="default"`, and `x()` returns `no-telemetry` for `DISABLE_TELEMETRY` or `DO_NOT_TRACK`, and `essential-traffic` for `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. `e2` is `CLAUDE_CODE_CUSTOM_OAUTH_URL`.

Kh @180677347 len=51 sha=9a4057988f282332

```
function Kh(){return Zq()||gi()!==null||bW()||e2()}
```

Zq @180677112 len=77 sha=8933888a4bf06806

```
function Zq(){if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return!1;return!dr()}
```

dr @180251741 len=41 sha=11f0b8b552845696

```
function dr(){return Ne()==="firstParty"}
```

gi @179062364 len=60 sha=2d8c82893ceb2501

```
function gi(){return n().host.credentialSlots.gatewayAuth()}
```

x @179143548 len=218 sha=c59dda664c56003d

```
function x(){if(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)return"essential-traffic";if(process.env.DISABLE_TELEMETRY)return"no-telemetry";if(Oe(process.env.DO_NOT_TRACK))return"no-telemetry";return"default"}
```

bW @179143813 len=37 sha=b66fd6be501dcfbb

```
function bW(){return x()!=="default"}
```

## #63 BODY

Footer poller deps include `fetchPrStatus:()=>n$t(`. `n$t` returns `ign(branch) ?? wtt`. `wtt` runs `glab mr view` and returns null when the host is GitHub. `ign` calls the REST list `/repos/.../pulls?head=...&state=open&per_page=1` with `Authorization: Bearer`. It returns null first only for `kt()` (essential-traffic, not `DISABLE_TELEMETRY`) or gh backoff. `Kfn` takes `GH_TOKEN||GITHUB_TOKEN` (or the enterprise pair when `GH_HOST` matches), else `gh auth token --hostname`. `tengu_harbor_prism` is 0. `fgn` still shells `gh pr view` for the URL cache `prStatusByUrl`; that is not the branch footer fetch.

footer hook @203014762 sha=feeddc458b5f7da5

```
e.now(),getLastInteractionTime:()=>kh(),fetchPrStatus:()=>n$t(P),share
```

wtt @185398531 sha=94e78e67bbc6bdd8

```
async function wtt(e){if(kt())return null;let t=Hfn.of(e);if(!t.isGlabOnPath())return null;let r=jfn();if(r===null)return null;if(X3(r)==="github")return null;if(t.unauthenticatedHosts.has(r))return null;let o=await Ue("glab",["mr","view","-F","json"],{timeout:Bfn,preserveOutputO
```

kt @179143766 len=47 sha=9791dcea7427264c

```
function kt(){return x()==="essential-traffic"}
```

Kfn @185399858 len=576 sha=8ce3a300db0e59a2

```
async function Kfn(e){let t=zo(e)?process.env.GH_TOKEN||process.env.GITHUB_TOKEN:rW(process.env.GH_HOST,e)?process.env.GH_ENTERPRISE_TOKEN||process.env.GITHUB_ENTERPRISE_TOKEN:void 0;if(t)return{kind:"token",token:t};if(!await qa("gh"))return{kind:"gh-missing"};let{stdout:o,code:u}=await Ue("gh",["auth","token","--hostname",e],{timeout:5000,preserveOutputOnError:!1,env:{...process.env,GH_TOKEN:"",GITHUB_TOKEN:"",GH_ENTERPRISE_TOKEN:"",GITHUB_ENTERPRISE_TOKEN:""}});if(u!==0)return{kind:"no-token"};let d=o.trim();return d.length>0?{kind:"token",token:d}:{kind:"no-token"}}
```

n$t @185402278 len=151 sha=292eb6c9085abee9

```
async function n$t(e){if(!await Kg())return null;let[r,o]=await Promise.all([al(),Tw()]);if(r===o)return null;return await(()=>ign(r))()??await wtt(e)}
```

ign @185402726 len=2623 sha=5a676d2f3cc48c37

```
async function ign(e){let t=Date.now();if(kt()||gZ())return null;if(e==="main"||e==="master")return null;let r=await lgn();if(!r)return null;let o=await _ke(r.host);if(o.kind!=="token"){if(!zo(r.host)&&!rW(process.env.GH_HOST,r.host))return null;return jA().logAuthState(o.kind==="gh-missing"?"gh_missing":"needs_auth"),bke(r.host),o.kind==="gh-missing"?"gh-missing":"needs-auth"}jA().logAuthState("token_present");let u=o.token,d=await ugn(r,u),y=jA().directStateForBranch(e),k=y.pr&&{...y.pr,reviewDecision:y.reviewDecision},A=_vt(r.host),x=new URL(A).origin,O=`${A}/repos/${d.owner}/${d.repo}/pulls?head=${encodeURIComponent(r.owner)}:${encodeURIComponent(e)}&state=open&per_page=1`,F=!1,U;try{let ge=AbortSignal.timeout(hZ),ve={Authorization:`Bearer ${u}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":Mtt,"User-Agent":Va(),...y.etag&&{"If-None-Match":y.etag}},Ie=(Be)=>fetch(Be,{...Hi({url:Be}),keepalive:!1,method:"GET",headers:ve,redirect:"manual",signal:ge}),ke=await Ie(y.redirectedListUrl??O),Pe=rgn.has(ke.status)?ke.headers.get("location"):null,Me=Pe?new URL(Pe,O):null;if(Me?.origin===x)y.redirectedListUrl=Me.href,ke=await Ie(Me.href);if(U=ke.status,ke.status===304);else if(ke.ok){y.etag=ke.headers.get("etag"),F=!0;let Be=ogn().safeParse(await ke.json()),$e=Be.success?Be.data[0]:void 0;if($e&&y.pr?.number!==$e.number)y.reviewDecision="";y.pr=$e?{number:$e.number,url:$e.html_url,isDraft:$e.draft}:null}else{if(ke.status===401)bke(r.host);else if(ke.status===403||ke.status===429)jA().backOffFromResponse(ke);return f("github_pr_status_direct",ke.status===401?"unauthor
… (1023 chars omitted)
```

## #66 BODY

`VU` copies sandbox fields in `qe` into `sandboxSettings` when `so` says the value is set. `so` is false for null/false/empty, and for `credentials` that are deny-only (`ro`: files/envVars `mode==="deny"`, sigv4 deny, `allowPlaintextInject===false`). `network.tlsTerminate` and `credentials` also attach `network.allowedDomains`. `Zor` returns true when `dangerousSettingsHash` (`fEt` over shell/env/sandbox/hooks/claudeMd) differs from the consented payload. `.restrictive` reads are 0; the `restrictive:!1` path table is present and unused under that spelling.

qe @179753576 sha=178d7ca1c0719e24

```
qe=["allowAppleEvents","credentials","enableWeakerNestedSandbox","enableWeakerNetworkIsolation","filesystem.disabled","network.allowAllUnixSockets","network.allowMachLookup","network.allowUnixSockets","network.httpProxyPort","network.socksProxyPort","network.tlsTerminate"],An=new
```

so @179880760 len=135 sha=f7f9b159e5a157ed

```
function so(e,t){if(t===void 0||t===null||t===!1)return!1;if(Array.isArray(t)&&t.length===0)return!1;return!(e==="credentials"&&ro(t))}
```

VU @179878259 len=2246 sha=8d57fc9e876dd631

```
function VU(e){if(!e)return{shellSettings:{},envVars:{},sandboxSettings:{},hasHooks:!1,hasClaudeMd:!1};let t={},o;for(let A of Ze){let E=e[A];if(A==="policyHelpers"){if(E!==null&&typeof E==="object")for(let L of Z2){let P=Mt(E[L]);if(P){if(t[`policyHelpers.${L}`]=P.command,P.scriptSize)o??={},o[`policyHelpers.${L}`]=P.scriptSize}}continue}let _;if(typeof E==="string")_=E;else if(E!==null&&typeof E==="object"&&"command"in E&&typeof E.command==="string")_=E.command;if(_!==void 0&&_.length>0)t[A]=_}let s=Oo(e);if(s&&typeof s==="object")for(let[A,E]of Object.entries(s)){let _=E?.source;if(!_||typeof _!=="object")continue;if(_.source==="url"&&typeof _.headersHelper==="string"&&_.headersHelper.length>0)t[`extraKnownMarketplaces[${S(A)}].source.headersHelper`]=Dt(_.headersHelper,"url",_.url);if(_.source==="settings"&&Array.isArray(_.plugins)){let L=new Map;for(let P of _.plugins){let U=S(P?.name),F=L.get(U)??0;L.set(U,F+1);let v=P?.source;if(v!==null&&typeof v==="object"&&"source"in v&&v.source==="command"&&"command"in v&&typeof v.command==="string"&&v.command.length>0)t[`extraKnownMarketplaces[${S(A)}].plugins[${S(P.name)}][${F}].source.command`]=v.command;if(typeof P?.headersHelper==="string"&&P.headersHelper.length>0){let W=P.source,d=W!==null&&typeof W==="object";t[`extraKnownMarketplaces[${S(A)}].plugins[${S(P.name)}][${F}].headersHelper`]=Dt(P.headersHelper,d&&"source"in W?W.source:void 0,d&&"url"in W?W.url:void 0)}}}}let r=e.sandbox,c={};if(r!==null&&typeof r==="object"){let A={enabled:he(r,"enabled"),enabledPlatforms:he(r,"enabledPlatforms")};for(let E of Je){let _=co(r[E]);if(_)t[`sandbox.${E}`]=re({value:_,...A})}for(let E of qe){let _=he(r,E);if(so(E,_))c[`sandbox.${E}`]=re({value:_,...A,...no.has(E)&&{allowedDomains:oo(he(r,"network.allowedDomains"))}})}}let g={};i
… (446 chars omitted)
```

Zor @179883181 len=211 sha=1902036136361ee3

```
function Zor(e,t){switch(e.source){case"consented_payload":return wt(e.settings,t);case"org_record":{let o=VU(t);if(!c5(o))return!1;if(fEt(o)===e.dangerousSettingsHash)return!1;return wt(e.consentedPayload,t)}}}
```

## #67 BODY

`Tn` flags a custom-header block when a header name fails the token grammar, the value fails `$Kt`, or the name matches `Cn` (`auth|key|token|...|host|url|...|proxy|route|...|beta|version`). `authorization` matches `auth`. `host` matches `host`. `zNe` is true for `ANTHROPIC_CUSTOM_HEADERS` only when `!Tn` (not sensitive). `VU` puts env entries with `!zNe` into `envVars`, which `Zor` / `dangerousSettingsHash` treats as needing consent.

Tn @179761036 len=221 sha=0bdafc7480a3c25e

```
function Tn(e){if(/\r(?!\n)/.test(e))return!0;return e.split(/\n|\r\n/).some((t)=>{let o=t.indexOf(":");if(o===-1)return!1;let s=t.slice(0,o).trim();return!Rn.test(s)||$Kt(t.slice(o+1))!==null||Cn.test(s.toLowerCase())})}
```

zNe @179761296 len=115 sha=f89ca1bbb4f2147e

```
function zNe(e,t){let o=e.toUpperCase();return An.has(o)||On.has(o)&&Oe(t)||o==="ANTHROPIC_CUSTOM_HEADERS"&&!Tn(t)}
```

## #69 BODY

highlight.js is in the bundle (`registerLanguage`=9, `highlight.js`=4, `name:"JavaScript"`=2, `name:"Python"`=2, `name:"TypeScript"`=1). Grammar window 188800000–189500000. Absence of the language id next to those `name:` grammars is the removal signal. A global string can still be a MIME type or an unrelated substring.

- mathematica "mathematica" global=5 nearHljs=0
- maxima "maxima" global=0 nearHljs=0
- isbl "isbl" global=0 nearHljs=0
- gml quoted "\"gml\"" global=0 nearHljs=0
- gml raw "gml" global=36 nearHljs=0
- 1c quoted "\"1c\"" global=0 nearHljs=0
- 1C:Enterprise "1C:Enterprise" global=0 nearHljs=0
- sqf quoted "\"sqf\"" global=0 nearHljs=0
- sqf raw "sqf" global=4 nearHljs=0
- name Mathematica "name:\"Mathematica\"" global=0 nearHljs=0
- name Maxima "name:\"Maxima\"" global=0 nearHljs=0
- name ISBL "name:\"ISBL\"" global=0 nearHljs=0
- name GML "name:\"GML\"" global=0 nearHljs=0
- name SQF "name:\"SQF\"" global=0 nearHljs=0
- name 1C "name:\"1C" global=0 nearHljs=0
- GameMaker "GameMaker" global=0 nearHljs=0

Ids that hit as highlight.js language names in that window: none of mathematica, maxima, isbl, gml, 1c, sqf.

Global strings that are not language ids: `mathematica` is `application/mathematica` and `application/vnd.wolfram.mathematica` (MIME). `gml` substrings include `spreadsheetml`, a locale token `.gml.`, and `text/vnd.gml`. `sqf` raw hits are binary noise and an unrelated id `sqfi+`. `ISBL` only occurs inside `ISBLANK`. `maxima`, `isbl`, `"1c"`, `"gml"`, `"sqf"`, `1C:Enterprise`, `GameMaker`, and every `name:"…"` for the six languages are 0.

js grammar @188967652 sha=2eba3bc49c028447

```
return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:i,exports:{PA
```
