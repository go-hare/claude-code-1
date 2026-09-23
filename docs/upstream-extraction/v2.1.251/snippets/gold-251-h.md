# gold-251-h

when=2026-09-22T14:32:42.978Z
exe=C:/Users/Administrator/AppData/Local/Temp/official-251/package/claude.exe
bytes=217360032
version=2.1.251
lane=#14 #17 #21 #22 #45 #46 #47 #48 #70 #71
rule=BODY is the bullet control flow in JS. A failure string or changelog sentence without that branch is STRING-ONLY. No branch and no distinctive phrase is MISS. Invent-ban. Not HAVE. Desktop/cloud/VSCode/quiet-notice/UI-cut copy without the branch stays STRING-ONLY or MISS.
primary needles are marked * . Offsets are bytes into claude.exe. excerptSha is sha256-16 of the excerpt below (<=2500). bodySha is the closed function extract when the hit sits inside it.

| # | verdict | sha | fn | offsets | hits |
| --- | --- | --- | --- | --- | --- |
| 14 | BODY | 90d4717e8209a6ee | call@196617994 len=- | @196617994 | *"not reachable"=25 *"SendMessage"=124 *"Claude Desktop"=95 *"delivered from another session"=0 *"through Claude Desktop"=0 "from another session"=5 "desktop_session_id"=2 "Forwarded to Claude Desktop"=2 "desktop_host"=8 |
| 17 | BODY | e09e464af047891c | Ce@196599616 len=364 | @196599616 | *"from was the agent type"=0 *"is not an address"=0 *"unnamed sibling"=0 "unnamed parent"=0 "from=`"=6 "from:e.agentType"=0 |
| 21 | MISS | - | -@-1 len=- | - | *"model had changed"=0 *"the model had changed"=0 *"initial model"=0 *"session's initial model"=0 *"host was only setting"=0 "modelChanged"=7 "model_changed"=2 "initialModel"=10 |
| 22 | STRING-ONLY | 982f28e8bd937a50 | yGt@182518308 len=1998 | @182518308 | *"policy disables"=2 *"Remote Control"=382 *"quiet notice"=0 "organization's policy"=59 "disableRemoteControl"=17 "Remote Control is disabled"=11 |
| 45 | BODY | 4a316def4d3d3074 | V_e@185450781 len=2301 | @185450781 | *"GitHub setup"=0 *"github setup"=0 *"transient GitHub"=0 *"github_preflight"=6 "preflight failed transiently"=3 "Retry in a moment"=6 "Please set up GitHub"=6 "checkGithubAppInstalled"=11 |
| 46 | STRING-ONLY | d1683021af312381 | Nt@182395520 len=811 | @182396013 | *"redundant UI"=0 *"re-render"=18 *"re-renders"=4 *"redundant render"=0 "cutting redundant"=0 "skipRedundant"=0 "UI re-render"=0 |
| 47 | MISS | - | -@-1 len=- | - | *"5 MB smaller"=0 *"5MB smaller"=0 *"about 5 MB"=0 *"install size"=0 "native binary is about"=0 "binary is about 5"=0 |
| 48 | STRING-ONLY | dd798b04a59e0fda | An@204216547 len=5008 | @204219870 | *"connection reset"=12 *"network proxy"=4 *"proxy drops"=0 *"names the host and reason"=1 "proxy drop"=0 "host and reason"=1 "recentRelayFailures"=3 "ECONNRESET"=53 |
| 70 | MISS | - | -@-1 len=- | - | *"Bedrock, Foundry, or Vertex"=0 *"third-party provider setup"=0 *"Foundry, or Vertex"=2 "Bedrock, Foundry"=0 "provider setup section"=0 "sign-in screen"=0 "#third-party"=0 |
| 71 | MISS | - | -@-1 len=- | - | *"footer pill"=2 *"Remote Control banner"=0 *"claude.ai/code"=96 "footerPill"=0 "RC banner"=0 "remote-control pill"=0 |

gold-251-c.md #17 was STRING-ONLY on phrase hits 0. This peel extracted Ce (from=id/name, agentType only on displayName). That is a new body — not a contradiction without extract.
gold-251-d.md #22 yGt/oe still kind:"error"; quiet notice still 0. Confirmed.
gold-251-e.md #46 still no UI-cut function. Confirmed.

## #14 SendMessage to a Desktop-delivered session id

verdict=BODY

SendMessage `async call` treats `Ke(e.to)` as a Claude Desktop session id. If `Yo()` is false it still errors `desktop_host`/`not_reachable` with U5e ("Cross-session messaging is not available"). If `qe(s)` is `unavailable` it errors that the id has the Desktop shape but the Desktop session-messaging tool is missing. Otherwise it calls `je({tool:T.tool,sessionId:e.to,...})` and on `w.kind==="sent"` returns success `Forwarded to Claude Desktop's session messaging`. Changelog phrases `delivered from another session` / `through Claude Desktop` are absent. Other `not reachable` hits are daemon / it2 / cloud trusted-device / artifact / Design / UDS — not this branch.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| not reachable | yes | 25 | 88504974,94080908,94976408,94998347,95710103,99359746,99844366,99866632,…+17 |
| SendMessage | yes | 124 | 88528524,88528669,92603827,92604121,92604411,92604507,92604706,92612065,…+116 |
| Claude Desktop | yes | 95 | 92308764,92308848,92308971,93984385,93984433,93984565,93984686,93991041,…+87 |
| delivered from another session | yes | 0 | - |
| through Claude Desktop | yes | 0 | - |
| from another session | no | 5 | 92381446,92476661,187444894,203267999,203341858 |
| desktop_session_id | no | 2 | 100827420,196618994 |
| Forwarded to Claude Desktop | no | 2 | 100827900,196619967 |
| desktop_host | no | 8 | 100827240,196618369,196618490,196618716,196618767,196619276,196619916,196620108 |

### evidence 1 off=196617994 fn=call@196617994 bodyLen=- bodySha=- excerptSha=90d4717e8209a6ee

~~~~
async call(e,s,u,o){let d=s.agentId,y=Date.now();function r(h,T,P){re({route:h,startedAt:y,errorClass:T,...P})}let b=qRe()?YRe(he(s)):void 0;if(d!==void 0&&Xct(s.session,d))return r("unresolved","not_reachable"),{data:{success:!1,message:"Observers report via ObserverReport, not SendMessage. SendMessage is not available from an observer."}};if(Ke(e.to)){if(!Yo())return r("desktop_host","not_reachable"),{data:{success:!1,message:U5e}};let h=!1;if(h=ne(e),typeof e.message!=="string")return r("desktop_host","invalid_target"),{data:{success:!1,message:`Not sent: a Claude Desktop session takes a plain-text message, not a structured ${e.message.type}.`}};if(e.message.trim().length===0){if(Ss(e,o,s.toolUseId))return r("desktop_host","handler_rewrite"),h?ks:Oe;return r("desktop_host",h?"not_reachable":"empty_message"),{data:{success:!1,message:h?`Nothing was subscribed: ${ue}`:"Not sent: the message is empty."}}}let T=qe(s);if("kind"in T)switch(T.kind){case"unavailable":return r("unresolved","desktop_session_id"),{data:{success:!1,message:`No agent named '${e.to}' is reachable. It has the shape of a Claude Desktop session id, but Claude Desktop's session messaging tool is not available in this session, so SendMessage cannot deliver to it.`}};case"loop-paused":return r("desktop_host",void 0,{degradedClass:"hop_loop"}),{data:{success:!1,message:`Not delivered: this session has already messaged Claude Desktop sessions ${T.forwards} times since your user last typed here, which looks like sessions messaging each other automatically. Paused until your user's next message in this session.`}}}let P=d?Ce(s,d).from:void 0,D=d!==void 0&&P!==void 0?Afe(P,e.message):e.message,M=TWe(d,P,{oneWay:!1}),w=await je({tool:T.tool,sessionId:e.to,message:D,context:s,canUseTool:u,assistantMessage:o}),x=w.blockedWait?{blockedWait:!0}:void 0,U=w.attachments.length>0?w.attachments:void 0;switch(w.kind){case"sent":return r("desktop_host",void 0,x),{data:{success:!0,message:`Forwarded to Claude Desktop's session messaging: ${w.detail||"sent."}${M.message}${h?Bs:""}`},...U&&{newMessages:U}};case"refused":return r("desktop_host","desktop_refused",x),{data:{success:!1,message:`Not delivered to Claude Desktop session ${e.to}: ${w.message}`},...U&&{newMessages:U}}}}let B=d?Ce(s,d):void 0,R=B?.from;if(typeof e.message==="string"){let h=fp(e.to),T=!1;if(h.scheme==="bridge"&&s.toolUseId){let D=s.toolState.get(ge);T=D.take(s.toolUseId,$e(e))!==void 0,D.dropToolUse(s.toolUseId)}if((h.scheme==="bridge"|
~~~~

## #17 background subagent reply: from is an address

verdict=BODY

Changelog phrases `from was the agent type` / `is not an address` / `unnamed sibling` are still 0 (same as gold-251-c.md). New extract: Ce(e,s) sets `from` to teammate `agentName`, then `agentNameRegistry` name, then `tasks[s].identity.agentName`, else the agent id `s`. `agentType` is only `displayName` when `kr(d)`. SendMessage `call` uses `Ce(s,d).from` as the sender address. `from=` hits are the #50 disclaimer string, not an assignment.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| from was the agent type | yes | 0 | - |
| is not an address | yes | 0 | - |
| unnamed sibling | yes | 0 | - |
| unnamed parent | no | 0 | - |
| from=` | no | 6 | 97753750,97753906,97754115,181642605,181642757,181642962 |
| from:e.agentType | no | 0 | - |

### evidence 1 off=196599616 fn=Ce@196599616 bodyLen=364 bodySha=402d980d47cc8e0c excerptSha=e09e464af047891c

~~~~
function Ce(e,s){let u=e.agentContext;if(u?.agentType==="teammate"&&u.agentName)return{from:u.agentName,displayName:u.agentName};let o=e.getAppState();for(let[y,r]of o.agentNameRegistry)if(r===s)return{from:y,displayName:y};let d=o.tasks[s];if(Ld(d))return{from:d.identity.agentName,displayName:d.identity.agentName};return{from:s,displayName:kr(d)?d.agentType:s}}
~~~~

### evidence 2 off=181642560 fn=jD@181639260 bodyLen=- bodySha=- excerptSha=24c1c9e0c4ec17e0

~~~~
ting your current task, decide whether/how to respond (reply via SendMessage to the `from=` address).",ue=" After completing your current task, decide whether/how to respond. This message was delivered by your host application, and its `from=` is a host session id that SendMessag
~~~~

## #21 cloud host initial model is not announced as a model change

verdict=MISS

Every changelog distinctive phrase is 0. `modelChanged` / `XEn` / `yit` are prompt-cache break diagnosis (`hydrated baseline`, tools/betas/effort). `qie` restores a sliced override from `initial_model`. `tengu_config_model_changed` is the interactive `/model` picker. None of those is a cloud-host "only setting the session's initial model" suppressor. Do not invent one.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| model had changed | yes | 0 | - |
| the model had changed | yes | 0 | - |
| initial model | yes | 0 | - |
| session's initial model | yes | 0 | - |
| host was only setting | yes | 0 | - |
| modelChanged | no | 7 | 95905860,185876244,185877555,185878389,185879272,185881955,185881971 |
| model_changed | no | 2 | 94324701,194005844 |
| initialModel | no | 10 | 92234660,99059328,179010518,179052663,191471269,191512267,202755988,202756077,…+2 |

### evidence 1 off=185879240 fn=XEn@185879240 bodyLen=1654 bodySha=b7ded582ae400326 excerptSha=beb35f4504ac50b1

Neighbor only — cache-break copy, not this bullet.

~~~~
function XEn(e,t){let r=[];if(e.modelChanged)r.push(`model changed (${t?"hydrated baseline":e.previousModel} \u2192 ${e.newModel})`);if(e.systemPromptChanged){let o=e.systemCharDelta,u=o===0?"":o>0?` (+${o} chars)`:` (${o} chars)`;r.push(`system prompt changed${u}`)}if(e.toolSchemasChanged){let o=e.addedToolCount>0||e.removedToolCount>0?` (+${e.addedToolCount}/-${e.removedToolCount} tools)`:" (tool prompt/schema changed, same tool set)";r.push(`tools changed${o}`)}if(e.fastModeChanged)r.push("fa
~~~~

## #22 Remote Control org-policy disable is a quiet notice

verdict=STRING-ONLY

Confirm gold-251-d.md. `yGt` still returns the policy-disable string. `oe` still `{kind:"error",message:b}`. `quiet notice` hits 0. No notice function. Do not invent one. `policy disables` is the artifact-subscription client_policy string, not RC.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| policy disables | yes | 2 | 94985587,190511621 |
| Remote Control | yes | 382 | 92316728,92316904,92316935,92384375,92563136,92563360,92563928,92564096,…+374 |
| quiet notice | yes | 0 | - |
| organization's policy | no | 59 | 92316970,92563813,93485321,93547209,93994925,93997201,93997308,93999209,…+51 |
| disableRemoteControl | no | 17 | 92317010,92321988,98042315,98044068,98044124,179827771,180124250,182517696,…+9 |
| Remote Control is disabled | no | 11 | 92316935,98038272,98042240,99398511,182518013,182518456,191665475,192154140,…+3 |

### evidence 1 off=182518308 fn=yGt@182518308 bodyLen=1998 bodySha=2bb7b69ab1c7a2a6 excerptSha=982f28e8bd937a50

~~~~
async function yGt(){if(u())return null;if(!g2())return L();if(eA())return"Remote Control is not available inside a cloud session.";if(wve())return"Remote Control is disabled by your organization's policy (managed setting `disableRemoteControl`).";if(!c())return"Remote Control requires a claude.ai subscription. Run `claude auth login` to sign in with your claude.ai account.";if(!i())return _Gt({prefix:"Remote Control requires claude.ai subscription auth.",suffix:"to use Remote Control."});if(!d())return"Remote Control requires a full-scope login token. Long-lived tokens (from `claude setup-token` or CLAUDE_CODE_OAUTH_TOKEN) are limited to inference-only for security reasons. Run `claude auth
~~~~

### evidence 2 off=209384187 fn=oe@209384187 bodyLen=376 bodySha=be997a078ce5d8ba excerptSha=1697218f3ccf2483

~~~~
async function oe(l){let b=await yGt();if(b)return{kind:"error",message:b};let _=await cst();if(_)return{kind:"error",message:_};if(!(M()&&l!==void 0?await ck(l):_y()))return{kind:"error",message:zSe};if(await WGt(l),await _bt()){if(R6())return{kind:"error",message:xve};return{kind:"unenrolled-trusted-device"}}return n("[bridge] Prerequisites passed, enabling bridge"),null}asyn
~~~~

## #45 cloud session creation: transient GitHub failure says retry

verdict=BODY

`V_e` (`checkGithubAppInstalled`) returns `transient:!0` on unexpected HTTP, 5xx/408/429/401, rate-limit 403, or thrown errors; `transient:!1` when the app is missing on a deterministic 4xx. `wT` stores `nt=Xn.transient` and `mt=Ke?"github_preflight_ok":"github_preflight_failed"`. On create-fail, `nt` picks `the GitHub App preflight failed transiently …` + `Retry in a moment` (or bundle-fail `retry in a moment to start from GitHub instead`) instead of `the GitHub App is not set up` / `Please set up GitHub on https://claude.ai/code`. Changelog phrases `GitHub setup` / `transient GitHub` are absent; the branch is the `nt` ternary.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| GitHub setup | yes | 0 | - |
| github setup | yes | 0 | - |
| transient GitHub | yes | 0 | - |
| github_preflight | yes | 6 | 96951892,96951920,185749056,185749078,185759412,185765915 |
| preflight failed transiently | no | 3 | 96953811,185753699,185755929 |
| Retry in a moment | no | 6 | 96261404,96954152,100888603,185463143,185754059,196775646 |
| Please set up GitHub | no | 6 | 96933943,96935123,96955282,185674554,185677798,185756158 |
| checkGithubAppInstalled | no | 11 | 96919636,96920432,96920492,96920612,185450845,185451070,185451190,185452081,…+3 |

### evidence 1 off=185450781 fn=V_e@185450781 bodyLen=2301 bodySha=4a316def4d3d3074 excerptSha=1097b04320ef8143

~~~~
function V_e(e,t,r){try{let o=Xt()?.accessToken;if(!o)return n("checkGithubAppInstalled: No access token found, assuming app not installed"),{appInstalled:!1,defaultBranch:null,transient:!1,linkedAccountAccess:"inconclusive",httpStatus:null};let u=await t0();if(!u){let A=zd();return n(A?"checkGithubAppInstalled: No org UUID found (profile fetch null \u2014 possibly transient), assuming app not installed":"checkGithubAppInstalled: No org UUID found (token lacks user:profile scope \u2014 deterministic), assuming app not installed"),{appInstalled:!1,defaultBranch:null,transient:A,linkedAccountAccess:"inconclusive",httpStatus:null}}let d=`${Vt().BASE_API_URL}/api/oauth/organizations/${u}/code/repos/${e}/${t}`,y={...Zb(o),"x-organization-uuid":u};n(`Checking GitHub app installation for ${e}/${t}`);let k=await st.get(d,{headers:y,timeout:15000,signal:r});if(k.status===200){let A=k.data.repo?.default_branch||null;if(k.data.status){let x=k.data.status.app_installed;return n(`GitHub app ${x?"is":"is not"} installed on ${e}/${t}`),{appInstalled:x,defaultBranch:A,transient:!1,linkedAccountAccess:"ok",httpStatus:k.status}}return n(`GitHub app is not installed on ${e}/${t} (status is null)`),{appInstalled:!1,defaultBranch:A,transient:!1,linkedAccountAccess:"ok",httpStatus:k.status}}return n(`checkGithubAppInstalled: Unexpected response status ${k.status}`),{appInstalled:!1,defaultBranch:null,transient:!0,linkedAccountAccess:"inconclusive",httpStatus:k.status}}catch(o){if(st.isAxiosError(o)){let u=o.response?.status,d=o.response?.headers??{},y=o.response?.data,k=vyn(u,o.response?.data),A=u===403&&(d["x-ratelimit-remaining"]==="0"||d["retry-after"]!==void 0||[y?.error,y?.message].some((x)=>typeof x==="string"&&/rate limit/i.test(x)));if(u&&u>=400&&u<500&&u!==408&&u!==429&&u!==401&&!A)return n(`checkGithubAppInstalled: Got ${u} error, app likely not installed on ${e}/${t} (linked-account access: ${k})`),{appInstalled:!1,defaultBranch:null,transient:!1,linkedAccountAccess:k,httpStatus:u};return n(`checkGithubAppInstalled error: ${l(o)}`),{appInstalled:!1,defaultBranch:null,transient:!0,linkedAccountAccess:k,httpStatus:u??null}}return n(`checkGithubAppInstalled error: ${l(o)}`),{appInstalled:!1,defaultBranch:null,transient:!0,linkedAccountAccess:"inconclusive",httpStatus:null}}}
~~~~

### evidence 2 off=185753650 fn=wT@185738595 bodyLen=29228 bodySha=0878913b1e7695bb excerptSha=88daf20c84318287

~~~~
?"CCR_FORCE_BUNDLE is set":We?nt?"the GitHub App preflight failed transiently (network or service hiccup)":"the GitHub App is not set up for this repository":"no GitHub remote was detected in this directory",oo=ut?"be seeded from your local working tree":"start with an empty sandbox";return e.onCreateFail?.(`${Pt} ${e.explicitRef} cannot be honored: ${Xn}, so the session would ${oo} instead. `+(!We?"":nt?"Retry in a moment, or ":En?`Cloud sessions can't clone from ${En} yet \u2014 `:"Set up the GitHub integration at https://claude.ai/code, or ")+(ut?`drop ${Pt} to seed from local HEAD.`:`drop ${Pt} to start with an empty sandbox.`),e.reuseOutcomeBranch?"on_branch_no_git_source":"explicit_ref_no_git_source",{preflightTransient:nt}),null}if(r.aborted)throw new Ze;if(!Pe&&ut){n("[teleport] phase: bundle-upload"),n(`[teleportToRemote] Bundling (reason: ${mt})`),s("tengu_teleport_bundle_start
~~~~

### evidence 3 off=185755900 fn=wT@185738595 bodyLen=29228 bodySha=0878913b1e7695bb excerptSha=a1f089172930aa58

~~~~
=!We?"":nt?". The GitHub App preflight failed transiently (network or service hiccup) \u2014 retry in a moment to start from GitHub instead":En?`. Cloud sessions can't clone from ${En} yet, so the bundle is the only way to start one from this repository`:". Please set up GitHub on https://claude.ai/code",qi;switch(Vn){case"empty_repo":qi=`${zr} \u2014 run \`git add . && git commit -m "initial"\` then retry`;break;case"too_large":qi=`Repo is too large to teleport${gs}`;break;case"git_error":qi=`Failed to create git bundle (${zr})${gs}`;break;case"stash_failed":case"no_changes":case"unsupported_layout":case"refused":qi=zr;break;case"not_a_repo":qi=zr;break;case"upload_failed":qi=`Could not upl
~~~~

## #46 cutting redundant UI re-renders

verdict=STRING-ONLY

Confirm gold-251-e.md. `redundant UI` / `redundant render` / `cutting redundant` / `skipRedundant` / `UI re-render` are 0. `re-render` / `re-renders` hits are `pre-rendered`, React docs, ConPTY (`Windows over SSH (ConPTY re-rendering)`), a goal-indicator comment, and changelog prose. No function cuts interactive-turn UI re-renders. Do not invent one.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| redundant UI | yes | 0 | - |
| re-render | yes | 18 | 66669394,66669764,82610663,82610817,82612350,84905536,84908922,84919622,…+10 |
| re-renders | yes | 4 | 84905536,98345440,180931453,215363106 |
| redundant render | yes | 0 | - |
| cutting redundant | no | 0 | - |
| skipRedundant | no | 0 | - |
| UI re-render | no | 0 | - |

### evidence 1 off=182396013 fn=Nt@182395520 bodyLen=811 bodySha=b9ed43531c3ccca8 excerptSha=d1683021af312381

Neighbor only — ConPTY disable copy, not a UI-cut.

~~~~
e"fullscreen":return!0;case"default":return!1}if(S(e))return!0;if(p(e))return!0;if(e.gbGateCached===void 0){let r=Um("tengu_pewter_brook",!1);e.gbGateCached=r.value,e.gbGateSource=r.source}return e.gbGateCached}function p(e=DP){return e.downsellGateCached??=I("tengu_amber_creek",!1),e.downsellGateCached}function xEe(e=DP){if(mg())return!1;if(s())return!1;if(a.CLAUDE_CODE_NO_FLICKER===!0)return!0;if(e.crashAutoOff||w5e())return!1;if(u())return!1;if(nV(e))return!1;switch(Je().t
~~~~

## #47 native binary about 5 MB smaller

verdict=MISS

Install-size changelog. Every size needle is 0. No runtime function. Not a JS body.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| 5 MB smaller | yes | 0 | - |
| 5MB smaller | yes | 0 | - |
| about 5 MB | yes | 0 | - |
| install size | yes | 0 | - |
| native binary is about | no | 0 | - |
| binary is about 5 | no | 0 | - |

## #48 cloud Bash proxy drop names host and reason

verdict=STRING-ONLY

`names the host and reason` is one hit inside `An()` — the agent-proxy markdown prompt. It says a dropped tunnel `reaches the tool as a bare reset` and that `recentRelayFailures` on `/__agentproxy/status` names host and reason. That is copy telling Claude to read the status endpoint, not a Bash tool-result rewrite. `connection reset` JS hits are the same prompt plus Rust error enums. `ECONNRESET` `nPn` is `node:_http_server` stack detection. No Bash tool-result function found. Do not invent one.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| connection reset | yes | 12 | 66885662,83347842,84245296,88319331,89216976,93949317,93949800,204215215,…+4 |
| network proxy | yes | 4 | 98661127,179785865,190048758,191009080 |
| proxy drops | yes | 0 | - |
| names the host and reason | yes | 1 | 204219936 |
| proxy drop | no | 0 | - |
| host and reason | no | 1 | 204219946 |
| recentRelayFailures | no | 3 | 93946044,204183409,204219895 |
| ECONNRESET | no | 53 | 66885649,66895731,67657203,67660840,67664092,67666205,67666264,67679656,…+45 |

### evidence 1 off=204219870 fn=An@204216547 bodyLen=5008 bodySha=0b480da53b81b366 excerptSha=dd798b04a59e0fda

~~~~
he tool as a bare reset. recentRelayFailures in the status
output names the host and reason; check it before concluding the remote
service refused the operation.

### Tool ignores the proxy entirely (timeouts with no proxy error)

Some clients do not read HTTPS_PROXY: Node's built-in fetch (run that command
with NODE_USE_ENV_PROXY=1 on Node >= 22.21), aiohttp (pass trust_env=True),
Ruby bundler (reads only HTTP_PROXY, which this proxy does not serve),
hand-rolled Go dialers. 
~~~~

## #70 [VSCode] Bedrock/Foundry/Vertex sign-in docs anchor

verdict=MISS

Exact changelog button `Bedrock, Foundry, or Vertex` and `third-party provider setup` are 0. This CLI SEA has no VSCode extension source. Neighbor `It` is the CLI `/login` picker label `Amazon Bedrock, Microsoft Foundry, or Vertex AI` → `platform_setup` — not a docs-hash button. Do not invent a VSCode anchor.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| Bedrock, Foundry, or Vertex | yes | 0 | - |
| third-party provider setup | yes | 0 | - |
| Foundry, or Vertex | yes | 2 | 94024638,199299410 |
| Bedrock, Foundry | no | 0 | - |
| provider setup section | no | 0 | - |
| sign-in screen | no | 0 | - |
| #third-party | no | 0 | - |

### evidence 1 off=199299300 fn=It@199298081 bodyLen=10118 bodySha=19f71286493f472f excerptSha=0a8318abd4d3fa29

Neighbor only — CLI login, not the VSCode bullet.

~~~~
age billing"})]}),value:"console"},p[6]=le;else le=p[6];let ae;if(p[7]===d)ae=[se,le,{label:r(t,{children:["3rd-party platform \xB7"," ",e(t,{dimColor:!0,children:"Amazon Bedrock, Microsoft Foundry, or Vertex AI"})]}),value:"platform"}],p[7]=ae;else ae=p[7];let ue;if(p[8]!==Lt||p[9]!==we||p[10]!==Te||p[11]!==T)ue=e(o,{children:e(ke,{options:ae,onChange:(xo)=>{if(xo==="platform")s("tengu_oauth_platform_selected",{}),T({state:"platform_setup"});else if(xo==="claudeai")s("tengu_
~~~~

## #71 [VSCode] Remote Control banner → footer pill

verdict=MISS

`Remote Control banner` / `footerPill` / `RC banner` / `remote-control pill` are 0. This CLI SEA has no VSCode extension source. The two `footer pill` hits are SDK `footer_indicator` / `SDKFooterIndicator` (`◆ <text>` terminal pill). `claude.ai/code` hits are artifact URLs and CLI `/remote-control` copy. Do not invent a VSCode RC banner or pill.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| footer pill | yes | 2 | 180879521,180947091 |
| Remote Control banner | yes | 0 | - |
| claude.ai/code | yes | 96 | 92276940,92276964,93248436,93263352,93457472,93457708,93458068,93458267,…+88 |
| footerPill | no | 0 | - |
| RC banner | no | 0 | - |
| remote-control pill | no | 0 | - |

### evidence 1 off=180879500 fn=-@-1 bodyLen=- bodySha=- excerptSha=dc60c94339f70fa8

Neighbor only — terminal SDK footer indicator, not VSCode.

~~~~
inal's server-configured "\u25C6 <text>" footer pill \u2014 see SDKFooterIndicator. Absent when nothing is configured.`),effort:ie(["low","medium","high","xhigh","max"]).nullable().optional().describe("The effort level the session will send on its next request \u2014 after env overrides, session sta
~~~~
