# gold-251-d

when=2026-09-22T06:58:44.405Z
exe=C:/Users/Administrator/AppData/Local/Temp/official-251/package/claude.exe
bytes=217360032
version=2.1.251
skip=#20 #21 #28 #32 (LOCAL or cloud N/A-candidate; not peeled)
rule=BODY is the bullet control flow in JS. A failure string or changelog sentence without that branch is STRING-ONLY. No branch and no distinctive phrase is MISS. Invent-ban. Not HAVE.
primary needles are marked * . Offsets are bytes into claude.exe. excerptSha is sha256-16 of the excerpt below (<=2500). bodySha is the closed function extract when the hit sits inside it.

| # | verdict | sha | fn | offsets | hits |
| --- | --- | --- | --- | --- | --- |
| 19 | BODY | cbca892144a3c69e | n@193953444 len=- | @193954490 | *"switch to Opus 1M"=0 *"5x more context"=0 *"has1mContext"=0 "5× more context"=0 "x more context"=2 "for 5x more"=0 |
| 22 | STRING-ONLY | 7861647ed12f3cb9 | yGt@182518308 len=1998 | @182518440 | *"policy disables"=2 *"Remote Control"=382 *"quiet notice"=0 "organization's policy"=59 "disableRemoteControl"=17 "Remote Control is disabled"=11 |
| 23 | BODY | 52945bec802fc656 | Nje@193791820 len=- | @193792188 | *"disabled in another session"=5 *"mcp reconnect"=16 "/mcp reconnect"=5 "withheld"=429 |
| 24 | BODY | 07e64b6b29b3681a | aVn@185578524 len=1891 | @185578605 | *"without a message id"=0 *"stream-json"=112 *"message id"=4 "input-format"=22 "--input-format"=20 |
| 25 | BODY | 1d554ab7ab805cb7 | S0e@184385987 len=2007 | @184386898 | *"same-ID"=0 *"relocated"=110 *"overwritten"=18 "same-id"=0 "relocateSession"=20 "silently overwritten"=0 |
| 26 | BODY | 68beb56816322287 | cR@180043202 len=- | @180043256 | *"git worktree add"=17 "worktree add"=19 |
| 27 | BODY | 9f53360963237ff7 | ygr@187849078 len=- | @187849269 | *"without any plugin skills"=0 *"plugin marketplace"=52 "plugin skills"=11 "refreshing the plugin"=0 |
| 29 | BODY | f28d907f865faf18 | de@200808973 len=- | @200809687 | *"70 seconds"=0 *"handshake"=198 *"SDK MCP"=15 "handshake acknowledgment"=0 "70000"=11 "70_000"=0 "70e3"=0 "7e4"=6 |
| 30 | BODY | 8d5d1550f2e59418 | qi@188594529 len=- | @188596470 | *"force-stopped"=0 *"killProcessTree"=2 "force-stop"=2 "force stopped"=0 |
| 31 | BODY | 34ceda9ac4b72c55 | uen@184961866 len=2700 | @184964233 | *"usage-credit"=67 *"ask the admin"=0 "usage-credits"=66 "ask your admin"=39 "/usage-credits"=54 |
| 33 | BODY | a495a8c191c15a29 | re@204651605 len=- | @204652659 | *"Emacs quit unexpectedly"=0 *"/dev/tty"=9 "emacs -nw"=0 "quit unexpectedly"=2 |
| 34 | BODY | 3ce970cdcd9e381a | lr@182107056 len=2693 | @182109082 | *"additionalDirectories"=41 *"null byte"=61 "\\u0000"=76 "\\x00"=823 |
| 35 | BODY | 93643b47972f57a1 | cL@199185320 len=- | @199185607 | *"Copied!"=6 *"sign-in URL"=4 "(Copied!)"=2 "sign-in url"=0 |
| 36 | BODY | 6d586eafb5d25637 | t8n@183514842 len=- | @183517458 | *"TERM=screen"=0 *"GNU screen"=0 *"italic"=152 "screen-256color"=0 |

## #19 Opus 1M tip hidden when the model already has 1M

verdict=BODY

n() suppresses the tip unless setting is opus/sonnet AND ky(resolved model) is false; ky() is the native-1m check. Quoted tip phrase is a template (Opus 1M + multiplier 5).

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| switch to Opus 1M | yes | 0 | - |
| 5x more context | yes | 0 | - |
| has1mContext | yes | 0 | - |
| 5× more context | no | 0 | - |
| x more context | no | 2 | 94318800,193954869 |
| for 5x more | no | 0 | - |

### evidence 1 off=193954490 fn=n@193953444 bodyLen=- bodySha=- excerptSha=cbca892144a3c69e

~~~~
function n(){let e=ap();if(e==="opus"&&wx()&&!ky(bl()))return{alias:"opus[1m]",name:"Opus 1M",multiplier:5};else if(e==="sonnet"&&rM()&&!ky(cp()))return{alias:"sonnet[1m]",name:"Sonnet 1M",multiplier:5};return null}function HK(e){let t=n();if(!t)return null;switch(e){case"warning":return`/model ${t.alias}`;case"tip":return`Tip: You have access to ${t.name} with ${t.multiplier}x more context`;default:return null}}
export{HK};
.// @bun @bytecode
// Claude Code is a Beta product per Anthropic's Commercial Terms of Ser
~~~~

### evidence 2 off=180788665 fn=Cw@180788594 bodyLen=- bodySha=- excerptSha=450bab4a38be233f

~~~~
function ky(e){if(eN())return!1;let t=Rw(e);if(t===void 0)return!1;let r=Zl(fn(t))?.context,o=Ga(e);if(o==="firstParty"&&jo()||Dx(o)||o==="mantle")return!0;return O3(o,r)}function O3(e,t){let r=t?.native_1m_3p;switch(e){case"bedrock":case"vertex":case"foundry":return r?.[e]===!0;case"gateway":return r?.bedrock===!0&&r?.vertex===!0&&r?.foundry===!0;default:return!1}}function Qde(e){return e.includes("claude-3-")||e===
~~~~

## #22 Remote Control org-policy disable is a quiet notice

verdict=STRING-ONLY

policy-disable copy still returns an error string (yGt) and kind:"error" (oe). "quiet notice" and "Remote Control failed" are absent. "policy disables" is the artifact-subscription string, not RC.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| policy disables | yes | 2 | 94985587,190511621 |
| Remote Control | yes | 382 | 92316728,92316904,92316935,92384375,92563136,92563360,92563928,92564096,…+374 |
| quiet notice | yes | 0 | - |
| organization's policy | no | 59 | 92316970,92563813,93485321,93547209,93994925,93997201,93997308,93999209,…+51 |
| disableRemoteControl | no | 17 | 92317010,92321988,98042315,98044068,98044124,179827771,180124250,182517696,…+9 |
| Remote Control is disabled | no | 11 | 92316935,98038272,98042240,99398511,182518013,182518456,191665475,192154140,…+3 |

### evidence 1 off=182518440 fn=yGt@182518308 bodyLen=1998 bodySha=2bb7b69ab1c7a2a6 excerptSha=7861647ed12f3cb9

~~~~
urn L();if(eA())return"Remote Control is not available inside a cloud session.";if(wve())return"Remote Control is disabled by your organization's policy (managed setting `disableRemoteControl`).";if(!c())return"Remote Control requires a claude.ai subscription. Run `claude auth login` to sign in with your claude.ai account.";if(!i())return _Gt({prefix:"Remote Control requires claude.ai subscription auth.",suffix:"to use Remote Control."});if(!d())return"Remote Control requires a full-scope login 
~~~~

### evidence 2 off=209384187 fn=v@209381372 bodyLen=- bodySha=- excerptSha=ff6c5b0c55d12dbd

~~~~
async function oe(l){let b=await yGt();if(b)return{kind:"error",message:b};let _=await cst();if(_)return{kind:"error",message:_};if(!(M()&&l!==void 0?await ck(l):_y()))return{kind:"error",message:zSe};if(await WGt(l),await _bt()){if(R6())return{kind:"error",message:xve};return{ki
~~~~

## #23 RC /mcp reconnect shows the real remedy

verdict=BODY

qge/y$ build the disabled-in-another-session remedy; /mcp reconnect returns qge() instead of a generic withheld error.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| disabled in another session | yes | 5 | 92590111,193791725,193792807,193792945,203455494 |
| mcp reconnect | yes | 16 | 93303216,94007224,94007668,99781364,100152856,100663297,100665067,193796978,…+8 |
| /mcp reconnect | no | 5 | 100663296,100665066,193796977,193800171,193802012 |
| withheld | no | 429 | 92178928,92178996,92180877,92281979,92282241,92345132,92457860,92505052,…+421 |

### evidence 1 off=193792188 fn=Nje@193791820 bodyLen=- bodySha=- excerptSha=52945bec802fc656

~~~~
function qge(e,n,t){if(!n){let i=Q(e,(s)=>s.type==="disabled"&&!t(s.name));if(i===0)return null;let l=Q(e,(s)=>s.type==="disabled"&&t(s.name));return`${i} MCP server(s) were re-enabled in another session, so this disable didn't persist for them \u2014 enable then disable each in /mcp to make it stick. Left alone, they connect on the next launch.`+(l>0?` The other ${l} ${l===1?"remains":"remain"} disabled.`:"")}let o=e.filter((i)=>i.type!=="disabled"&&G8(i)!=="needs-approval"&&t(i.name));if(o.length===0)return null;let r=Q(o,Qo),a=Q(o,(i)=>!Qo(i)&&XS(i)),d=o.length-r-a,c=[];if(d>0)c.push(`${d} MCP server(s) were disabled in another session \u2014 disable and re-enable them in /mcp, or restart, to reconnect.`);if(a>0)c.push(`${a} MCP server(s) were disabled in another session but aren't configured yet \u2014 there's nothing to reconnect until they are.`);if(r>0)c.push(`${r} MCP server(s) are still available in this session but were disabled in another \u2014 they keep working here and won't reconnect after the next launch. Disable and re-enable them in /mcp to persist the re-enable.`);return c.join(" ")}function prt(e){return`"${Cr(e)}" is blocked by your organization's managed polic
~~~~

### evidence 2 off=193799912 fn=ae@193796340 bodyLen=4983 bodySha=d9a5af3f438f93e6 excerptSha=e2b24649ba499bdd

~~~~
f(!p&&e!=="all"&&!y(e))return r(Nje(e));if(e==="all"){let t=qge(f,p,y);if(t!==null){let m=p?Q(f,(v)=>z(v,y)):0;return r(m>0?`${t} ${G(m)}`:t)}}if(p){let t=Q(f,B);if(t>0)return r(e==="all"?`All MCP servers are already enabled, but ${G(t)}`:U(`"${u(e)}" is already enabled but not connected.`,` Run \`/mcp reconnect ${e}\` to retry.`,e))}return r(e==="all"?`All MCP servers are already ${p?"enabled":"disabled"}.`:`"${u(e)}" is already ${p?"enabled":"disabled"}.`)}let D=e==="all"?qge(f,p,y):null,k=await Promise.allSettled(A.map((t)=>_(t.name))),R=Q(k,(t)=>t.status==="fulfilled"),T=p?Q(k,(t)=>t.status==="fulfilled"&&t.value.type==="connected"):R,W=p?"Enabled":"Disabled",H=p&&T<R?` (${R-T} enabled but not yet connected)`:"";if(e!=="all"){
~~~~

## #24 stream-json assistant tool calls without a message id

verdict=BODY

deserializeMessages stamps message.id on id-less assistant entries (pre-#61940 stream-json injection) before same-id merge. Phrase "without a message id" is absent.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| without a message id | yes | 0 | - |
| stream-json | yes | 112 | 92257572,92303652,92303708,92303778,92303844,92305146,92316510,92316545,…+104 |
| message id | yes | 4 | 99301029,99301433,191875908,191876175 |
| input-format | no | 22 | 92303765,92316497,92316577,92316837,92317090,98496898,99186476,99295506,…+14 |
| --input-format | no | 20 | 92303763,92316495,92316575,92316835,92317088,98496896,99295504,99296744,…+12 |

### evidence 1 off=185578605 fn=aVn@185578524 bodyLen=1891 bodySha=560377b4c9c3bb06 excerptSha=07e64b6b29b3681a

~~~~
function xut(e){return aVn(e).messages}function aVn(e,t,r,o){try{Pee(e);let u=XVe(e),d=lbn(Hut(u),o),y=0,k=d.map((We)=>{if(We.type==="assistant"&&!We.message.id&&We.requestId===void 0)return y+=1,{...We,message:{...We.message,id:YSn()}};return We});if(y>0)n(`deserializeMessages: stamped a message.id on ${y} id-less assistant entr${y===1?"y":"ies"} (pre-#61940 stream-json injection)`);let A=0,x=k.map(ibn).filter((We)=>We!==null).flatMap((We)=>{let Ke=abn(We);if(Ke===null)return[We];A+=1;let At=Ke.message.content;if(Array.isArray(At)&&At.length===0)return[];return[Ke]});if(A>0)n(`deserializeMessages: dropped non-string text block(s) from ${A} message(s) \u2014 interrupted-stream artifact`,{level:"warn"});let O=lY(x,{site:"resume"}),F=new Set(h_);for(let We of O){if(We.type==="user"&&We.permissionMode!==void 0&&!F.has(We.permissionMode))We.permissionMode=void 0;if(We.type==="user"&&We.promptId!==void 0)delete We.promptId}let U=new Set,B=new Map,W=crt(O,o),V=urt(O),me=a.CLAUDE_CODE_RESUME_INTERRUPTED_TURN&&!t
~~~~

## #25 same-ID transcript not overwritten after relocate

verdict=BODY

relocate sets an existing destination aside via dpe() (.superseded-<ts>) before the move, and restores it if the move fails. "same-ID" phrase is absent.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| same-ID | yes | 0 | - |
| relocated | yes | 110 | 84959106,92730632,93347328,93414024,93414044,93926051,96081600,96081624,…+102 |
| overwritten | yes | 18 | 66501488,88370456,97480937,98758835,99838419,99864258,100739317,101129260,…+10 |
| same-id | no | 0 | - |
| relocateSession | no | 20 | 93409092,96858696,96858768,96858824,96859112,97203380,97203476,97203572,…+12 |
| silently overwritten | no | 0 | - |

### evidence 1 off=184386898 fn=S0e@184385987 bodyLen=2007 bodySha=9f5297a99d486061 excerptSha=1d554ab7ab805cb7

~~~~
nt:!0})]);A=fe.dev===pe.dev&&fe.ino===pe.ino}catch(fe){if(!Y(fe))throw fe}let x;if(!A)x=await dpe(y);let O=t&&mh(d),F=t&&mh(y),U=t!==void 0&&O!==void 0&&F!==void 0,B=!0;try{await $Be(d,y,t,U?{from:O,to:F}:void 0)}catch(fe){if(Y(fe)){if(x!==void 0)throw await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript: could not restore set-aside destination after ENOENT move: ${pe}`,{level:"warn"})}),fe;n(`relocateSessionTranscript: old file missing: ${fe}`),B=!1}else{if(x!==void 0)await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript: could not restore set-aside destination after failed move: ${pe}`,{level:"warn"})});throw fe}}let W=ka(Mg(d),r),V=ka(o,r),me=!0;try{await $Be(W,V,t,U?{fromScope:OBe(O),toScope:OBe(F)}:void 0)}catch(fe){if(me=!1,!Y(fe))h(fe)}if(u.setSessionFile(y),Gf(r,"cd",o),u.currentSessionRelocatedCwd=be(),B)try{await RT(y,{type:"relocated",sessionId:r,relocatedCwd:u.currentSessionRelocatedCwd},t)}catch(fe){n(`relocateSessionTranscript: relocated stamp fai
~~~~

### evidence 2 off=184388649 fn=dpe@184388254 bodyLen=480 bodySha=2c2127c68e29d31d excerptSha=0267f445fd90db96

~~~~
sRetentionExemptionDisabled:r}=import.meta.require("B:/~BUN/root/chunk-kstgrp55.js");if(!r()){let o=new Date;await DVt(t,o,o).catch((u)=>{n(`relocateSessionTranscript: could not refresh the set-aside's mtime at ${t} (it ages from its old clock): ${u}`,{level:"warn"})})}return n(`relocateSessionTranscript: existing destination set aside at ${t}`,{level:"warn"}),t}async function fYt(e,t,r){let o=await e.moveScope(t,r);if(!o.ok||o.value.published)return o;function u(){return Object.assign(Error("an
~~~~

## #26 bg session can edit files in a git worktree it created

verdict=BODY

bg write guard returns null (allow) when Fkn(canonical) — linked worktree — and the denial text says a git worktree add path is accepted.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| git worktree add | yes | 17 | 95889873,95890732,95893320,96151870,96309761,96313821,184735469,184735955,…+9 |
| worktree add | no | 19 | 94391388,95889877,95890736,95893324,96151874,96309765,96313825,184735473,…+11 |

### evidence 1 off=180043256 fn=cR@180043202 bodyLen=- bodySha=- excerptSha=68beb56816322287

~~~~
function Fkn(e){let t=lvt(e);return t!==null&&ue(t)!==t}async function Ukn(e){if(sn())return null;let t=await kw(e);if(!
~~~~

### evidence 2 off=184735012 fn=Q$@184734448 bodyLen=1655 bodySha=627e8471d7b8c7fc excerptSha=934a1ebe34158896

~~~~
CODE_SESSION_KIND!=="bg"&&!Xh())return null;if(zfe()==="none")return null;let o=t.agentId?be():ee(),u=Jm(e),d=Jm(o);if(!yw(u,d))return null;if(!Rn(o)&&(!Z9()||Mtr(o)))return null;if(cR(o))return null;if(u.canonical!==null&&Fkn(u.canonical))return null;let y=Yze(u,d);if(y==="unresolvable")return Xze();if(y==="network")return Qze();let k=d.canonical!==null;if(t.agentId)return`This subagent's parent bg session hasn't isolated yet, so writes to the shared checkout are blocked. Re-spawn this agent with \`isolation: "worktree"\`${k?`, have the parent call ${rk} before spawning, or make the edit inside a linked git worktree you create for this task with \`git worktree add\` \u2014 paths inside a worktree are accepted`:`, or have the parent call ${rk} before spawning`}. (To disable this guard for this repo, set \`"worktree": {"bgIsolation": "none"}\` in .claude/settings.json.)`;return`This background session hasn't isolated its changes yet. Call ${rk} first so edits land in a worktree instead of the shared checkout, then retry this edit using the worktree path${k?" (a path inside a linked git worktree, including one you create with `git worktree add`, is accepted)":""}. (To disable this guard for this repo, set \`"worktree": {"bgIsolation": "none"}\` in .claude/settings.json.)`}return nu
~~~~

## #27 bg session keeps plugin skills across marketplace refresh

verdict=BODY

qFe re-reads a null marketplace catalog on delays _gr=[30,70,150] while $Y does not refuse the entry, and logs that another process was refreshing it. "without any plugin skills" is absent.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| without any plugin skills | yes | 0 | - |
| plugin marketplace | yes | 52 | 93035044,93035144,93035216,93035296,93284681,93294478,93294538,93294589,…+44 |
| plugin skills | no | 11 | 96706976,97101845,97101905,97102272,97230334,185503691,187652053,187665302,…+3 |
| refreshing the plugin | no | 0 | - |

### evidence 1 off=187849269 fn=ygr@187849078 bodyLen=- bodySha=- excerptSha=9f53360963237ff7

~~~~
return d===null?void 0:{scope:u,path:d}}var _gr=[30,70,150],IHt="This plugin use
~~~~

### evidence 2 off=187868730 fn=qFe@187868067 bodyLen=7202 bodySha=8f876ab141125a4c excerptSha=921c985f404b5f63

~~~~
.map(({path:u,reason:d})=>({type:"hook-load-failed",source:t,plugin:r,hookPath:o,reason:`${u}: ${d}`}))}function FHt(e,t){if(!e)return t;let r={...e};for(let[o,u]of Object.entries(t))if(!r[o])r[o]=u;else r[o]=[...r[o]||[],...u];return r}async function qFe({cacheOnly:e,preview:t=!1,storageV5:r,credentials:o}){let u=vn(),d={...gle(),...u.enabledPlugins||{}},y=[],k=[],A=[],x=Object.entries(d).filter(([ke,Pe])=>{if(!wM().safeParse(ke).success||Pe===void 0)return!1;let{marketplace:Be}=qt(ke);return Be!==Uh&&!uc(Be)}),O=await cc(r),F=PO(),U=XMe(),B=new Set(x.map(([ke])=>qt(ke).marketplace).filter((ke)=>!!ke)),W=new Map;await Promise.all([...B].map(async(ke)=>{let Pe=Object.hasOwn(O,ke)?O[ke]:void 0,Me=await Ev(ke,r,{registryEntry:Pe}),Be=Pe!==void 0&&$Y(ke,Pe)===null;for(let $e of _gr){if(Me!==null||!Be)break;if(await ne($e),Me=await Ev(ke,r,{registryEntry:Pe}),Me!==null)n(`Marketplace ${ke}: catalog readable again after a re-read (another process was refreshing it)`)}W.set(ke,Me)}));let V=[],me=new Set(x.map(([ke])=>ke)),fe=new Map,pe=x.flatMap(([ke,Pe])=>{let{name:Me,marketplace:Be}=qt(ke),$e=Be?W.get(Be):n
~~~~

## #29 SDK MCP handshake ack wait times out at 70s

verdict=BODY

sendMcpMessage defaults to _e=70000 but arms the timer only when rot() is false (message lacks method+non-null id). Rd() connects each SDK server in Promise.allSettled and marks only the thrown server failed.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| 70 seconds | yes | 0 | - |
| handshake | yes | 198 | 67656074,67656100,67660922,67663945,67670494,67670600,67670642,67670666,…+190 |
| SDK MCP | yes | 15 | 92225066,92265168,99795509,99795548,99806398,100569112,100725718,191698456,…+7 |
| handshake acknowledgment | no | 0 | - |
| 70000 | no | 11 | 180441571,192945558,193395537,198025813,198028952,198031216,200809690,202861160,…+3 |
| 70_000 | no | 0 | - |
| 70e3 | no | 0 | - |
| 7e4 | no | 6 | 79232190,100112258,102223602,105279670,205230950,217235608 |

### evidence 1 off=200809687 fn=de@200808973 bodyLen=- bodySha=- excerptSha=f28d907f865faf18

~~~~
","CLAUDE_CODE_OAUTH_TOKEN"]),ge=300000,_e=70000,Re=0.01,Z=512;function ee(t){let e=lG().safeParse(t);if(!e.success)retu
~~~~

### evidence 2 off=200835862 fn=-@-1 bodyLen=- bodySha=- excerptSha=3d436a8af8d9ae59

~~~~
async sendMcpMessage(t,e,o=_e){let u=rot(e)?void 0:Xa(void 0,{timeoutMs:o,refTimer:!0});try{return(await this.sendRequest({subtype:"mcp_message",server_name:t,message:e},p({mcp_response:H5()}),u?.signal)).mcp_response}finally{u?.cleanup()}}async requestOAuthTokenRefresh(){let t=Date.now(),e;try{e=await this.sendRequest({subtype:"oauth_token_refresh"},dSn(),A
~~~~

### evidence 3 off=200802873 fn=-@-1 bodyLen=- bodySha=- excerptSha=ffb31a86a5282f8c

~~~~
function rot(s){return"method"in s&&"id"in s&&s.id!==null}class p2e{serverName;s
~~~~

### evidence 4 off=207450450 fn=hs@207450354 bodyLen=- bodySha=- excerptSha=68ba531ed483e80f

~~~~
async function Rd(e,t,o){let r=[],d=[],u=[];lo();let h=await Promise.allSettled(Object.entries(e).map(async([b,v])=>{let z=new p2e(b,t),U=new yQt({name:"claude-code",title:"Claude Code",version:{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.251",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-08-28T14:51:38Z",GIT_SHA:"37534ac596d80cefb02d272f036adba4ba055d2c",HOOKS_WORKER_URL:"B:/~BUN/root/src/plugins/functionHooks/hooks-worker/hooks-worker.js",DD_SOURCEMAP_GROUP:"win32"}.VERSION??"unknown",description:"Anthropic's agentic coding tool",websiteUrl:Gte},{capabilities:{},jsonSchemaValidator:new ao,versionNegotiation:co("sdk-control")});try{await U.connect(z);let ee=U.getServerCapabilities(),x=U.getInstructions(),W=qo(x,b),ue={type:"connected",serverInfo:U.getServerVersion(),name:b,capabilities:ee||{},instructions:W,negotiatedProtocolVersion:U.getNegotiatedProtocolVersion(),protocolEra:U.getProtocolEra(),client:Ho(U),config:{...v,scope:"dynamic"},cleanup:async()=>{await U.close()}},_e=cr(ue.name,ue.config);if(mr().toolLists.delete(_e),mu())at.invalidateMcpSkillsForServer(_e);let De=[];if(ee?.tools){let F=await yt(ue,o);De.push(...F)}let Pe=mu()&&ee?.resources?await at.fetchMcpSkillsForClient(ue,o):[];return _("mcp_sdk_connect"),{client:ue,tools:De,commands:Pe}}catch(ee){return f("mcp_sdk_connect","mcp_sdk_connect_failed"),to(b,`Failed to connect SDK MCP server: ${ee}`),{client:{type:"failed",name:b,config:{...v,scope:"user"}},tools:[],commands:[]}}}));for(let b of h)if(b.status==="fulfilled")r.push(b.value.client),d.push(...b.value.tools),u.push(...b.value.commands);if(r.some((b)=>b.type==="connected"&&!!b.capabilities?.resources)){if(![UA,VA].some((v)=>d.some((z)=>on(z,v.name))))d.push(UA,VA,gD)}return{clients:r,tools:d,commands:u}}async function Ad(e){await Promise.all(e.map(async(t)=>{if(t.type!=="connected")return;try{await t.cleanup()}catch(o){n(`MCP client cleanup failed for ${t.
~~~~

## #30 force-stop kills leftover Bash via killProcessTree

verdict=BODY

runner session terminate() calls ug(pid); stop() reaps descendants. ug is the killProcessTree module (taskkill /T). "force-stopped" phrase is absent.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| force-stopped | yes | 0 | - |
| killProcessTree | yes | 2 | 97801752,182467517 |
| force-stop | no | 2 | 99092736,178754959 |
| force stopped | no | 0 | - |

### evidence 1 off=188596470 fn=qi@188594529 bodyLen=- bodySha=- excerptSha=8d5d1550f2e59418

~~~~
max session age \u2014 aborting child pid=${this.child.pid}`),this.terminate()}signalGroup(e){let t=this.child.pid;if(t===void 0){this.child.kill(e);return}if(t<=1)return;try{process.kill(-t,e)}catch{this.child.kill(e)}}reapDescendants(e){let t=this.treeSnapshot;if(t===void 0)return;this.treeSnapshot=void 0;let n=this.child.pid,r=(async()=>{let s=await t;if(s===void 0){this.onStatus(`[runner:session] ${this.sessionId} could not list the child's process tree \u2014 signals reached its process group only; detached tool trees may survive`);return}if(s.rootRecycled){this.onStatus(`[runner:session] ${this.sessionId} child pid=${n} now names another process \u2014 no process-tree reap; detached tool trees may survive`);return}let d;if(e>0){let{live:h,incomplete:p}=await Fr(s);if(h>0||p)await ne(e),d=await ir(s,"SIGKILL")}else d=await ir(s,"SIGKILL");if(d?.incomplete){this.onStatus(`[runner:session] ${this.sessionId} process-tree identity check did not complete \u2014 ${s.pinned.size-d.proven} of ${s.pinned.size} descendant(s) unverified and not signalled; they may survive`);return}let o=d?.pids??0,u=d?.groups??0;if(s.degraded||s.truncated||s.unpinned>0){this.onStatus(`[runner:session] ${this.sessionId} process-tree listing incomplete (partial=${s.degraded} truncated=${s.truncated}) \u2014 SIGKILLed ${o} of ${s.pinned.size} identified descendant(s) and ${u} group(s); ${s.unpinned} descendant(s) could not be identified and were not signalled; they, and any unlisted tool trees, may survive`);return}this.onDebug(d===void 0?`[runner:session] process tree pid=${n}: ${s.pinned.size} descendant(s) at SIGTER
~~~~

### evidence 2 off=182467514 fn=f@182467475 bodyLen=155 bodySha=5f2f9361287d0327 excerptSha=6d9e50f34cd06f02

~~~~
gnore"],windowsHide:!0})}catch(l){o(l);return}let t="";r.stdout?.on("data",(l)=>t+=l),r.once("error",o),r.once("close",()=>e(t))})}function P(e){let o=(r)=>{f("taskkill",r);try{process.kill(e)}catch{}};try{let r=a.SYSTEMROOT||"C:\\Windows",t=h(r,"System32","taskkill.exe");k(t,["/PID",String(e),"/T","/F"],{cwd:void 0,stdio:"ignore",windowsHide:!0}).once("error",o)}catch(r){o(r)}}function f(e,o){try{let r=v(o),t=co(o);n(`killProcessTree ${e} failed: ${r??o}`),s("tengu_bash_tool_kill_error",{stage:
~~~~

### evidence 3 off=188598380 fn=qi@188594529 bodyLen=- bodySha=- excerptSha=a47d7176be9e2998

~~~~
[runner:session] Abort signal received, killing process tree at pid=${this.child.pid}`),this.child.pid)ug(this.child.pid);else this.child.kill()}stop(){if(this.stopped=!0,this.reapDescendants(Math.max(1,Math.min(Vi,this.terminatedAt+this.sigkillTimeoutMs-Date.
~~~~

### evidence 4 off=182466184 fn=D@182464479 bodyLen=- bodySha=- excerptSha=99d16cd4f241b901

~~~~
function ug(e,o="SIGKILL"){if(!Number.isInteger(e)||e<=1)return Promise.resolve();return P(e),Promise.resolve()}async function g(e,o){let r=await b(e);try{proce
~~~~

## #31 usage-credits $0 limit offers to ask the admin

verdict=BODY

group_zero_credit_limit / member_zero_credit_limit copy asks the admin via mhe() (/usage-credits), separate from the spend-cap branch. "ask the admin" phrase is absent.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| usage-credit | yes | 67 | 92386354,92387716,93320513,93321437,93396506,93464509,93464805,93497041,…+59 |
| ask the admin | yes | 0 | - |
| usage-credits | no | 66 | 92386354,92387716,93320513,93321437,93396506,93464509,93464805,93497041,…+58 |
| ask your admin | no | 39 | 92408889,93252833,95845625,96200691,96201530,96202161,96202207,96210565,…+31 |
| /usage-credits | no | 54 | 93320512,93321436,93396505,93464508,93464804,93497040,93514976,94121984,…+46 |

### evidence 1 off=184964233 fn=uen@184961866 bodyLen=2700 bodySha=50fbdbaf9c13fbd9 excerptSha=34ceda9ac4b72c55

~~~~
;return`You're out of usage credits${B}${W}`}if(e.overageDisabledReason&&hqe.has(e.overageDisabledReason)){let W=k?` \xB7 resets ${k}`:"";return wb(e.overageDisabledReason==="org_spend_cap_reached"?len:"org's monthly usage limit",W,t)}if(e.overageDisabledReason==="seat_tier_level_disabled"||e.overageDisabledReason==="seat_tier_zero_credit_limit")return`Your seat type doesn't include ${r?"usage":"usage credits"}`;if(e.overageDisabledReason==="org_service_level_disabled")return"This service is disabled for your org";if(e.overageDisabledReason==="member_level_disabled"||e.overageDisabledReason==="member_zero_credit_limit")return`Your usage allocation has been disabled by your admin${mhe()}`;if(e.overageDisabledReason==="group_zero_credit_limit")return`Your group's usage limit is set to $0${mhe()}`;if(r)return wb("usage limit",u,t);return wb("limit",B,t,{progressSavedSuffix:B!==""&&Gj()})}if(F){let B=O();if(B!==null)return B}if(r)return wb("usage limit",u,t);return wb("usage limit",A,t,{progressSavedSuffix:A!==""&&Gj()})}function den(e,t,r){switch(e.rateLimitType){case"seven_day_sonnet":return wb(ghe(),t,r,{progressSavedSuffix:Gj()});case"five_hour":case"seven_day":case"seven_day_opus"
~~~~

### evidence 2 off=184967616 fn=ghe@184967522 bodyLen=- bodySha=- excerptSha=9102c56376be9b54

~~~~
function mhe(){return nS()?" \xB7 run /usage-credits to ask your admin for a higher limit":" \xB7 ask your admin for a higher limit"}function wb(e,t,r,o){let u=o?.progressSavedSuffix?" \xB7 progress saved":"";return`You'
~~~~

## #33 Ctrl+G /dev/tty editors in background sessions

verdict=BODY

When CLAUDE_BG_BACKEND==="daemon" and tengu_bg_worker_ctty is on, startup awaits z(), which opens /dev/tty and login_tty(0). "Emacs quit unexpectedly" is absent.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| Emacs quit unexpectedly | yes | 0 | - |
| /dev/tty | yes | 9 | 95992600,97510020,97511128,183193688,183284191,183285882,183286002,187061830,…+1 |
| emacs -nw | no | 0 | - |
| quit unexpectedly | no | 2 | 94316517,192397381 |

### evidence 1 off=204652659 fn=re@204651605 bodyLen=- bodySha=- excerptSha=a495a8c191c15a29

~~~~
async function L(){try{return await(await se("/dev/tty",q.O_RDWR|q.O_NOCTTY)).close(),!0}catch{return!1}}async function z(){if(D()==="windows")return"unsupported";if(!N(0)||!N(1)||!N(2))return"not_a_tty";if(await L())return"already";let e=le();if(!e)return"ffi_unavailable";if(e(0)!==0)return n("[bg-ctty] login_tty(0) failed",{level:"warn"}),"failed";return"acquired"}function ie(){return D()==="macos"?["/usr/lib/libSystem.B.dylib","libSystem.B.dylib"]:["libc.so.6","libutil.so.1","libc.so"]}function le(){let e;try{e=ue("bun:ffi")}catch(o){return n(`[bg-ctty] bun:ffi unavailable: ${o instanceof Error?o.message:String(o)}`),null}for(let o of ie())try{let r=e.dlopen(o,{login_tty:{args:["i32"],returns:"i32"}});return(m)=>r.symbols.login_tty(m)}catch{}return n("[bg-ctty] no libc candidate exports login_tty"),null}import{copyFile as ce,stat as me}from"fs/promises";import{homedir as pe}from"os";i
~~~~

### evidence 2 off=204655599 fn=uo@204655316 bodyLen=7612 bodySha=b593357a0fe3f962 excerptSha=32641271d0d44024

~~~~
on 22 or higher.")),process.exit(1);if(a.CLAUDE_BG_BACKEND==="daemon"){let t=I("tengu_bg_worker_ctty",!0)?await z():await L()?"already":"switched_off";switch(J("info","bg_worker_ctty",{outcome:t}),t){case"acquired":rNt(),_("bg_worker_ctty");break;case"already":rNt();break;case"failed":g("bg_worker_ctty",t);break;case"ffi_unavailable":case"not_a_tty":g("bg_worker_ctty",t);break;case"unsupported":case"switched_off":break}}if(S)Gf(zu(S),"startup_custom_id");if(yS.unset("CLAUDE_CODE_MESSAGING_SOCKET
~~~~

## #34 additionalDirectories null-byte entries are skipped

verdict=BODY

addDirectories permission updates drop a directory that contains a null byte; workspace validate returns containsNullByte instead of throwing. "additionalDirectories" itself is not in that predicate.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| additionalDirectories | yes | 41 | 93923644,97902980,98421969,99067204,100562809,179032542,179075217,179798053,…+33 |
| null byte | yes | 61 | 66904690,66904982,66905172,67478342,67480572,67786096,67786931,68164002,…+53 |
| \u0000 | no | 76 | 67816995,86421254,88794534,92667581,93705850,93941081,94538315,94573081,…+68 |
| \x00 | no | 823 | 816661,840887,66778170,66791443,66791575,66791712,66791846,66792663,…+815 |

### evidence 1 off=182109082 fn=lr@182107056 bodyLen=2693 bodySha=d1b12448fc337888 excerptSha=3ce970cdcd9e381a

~~~~
ddDirectories whose directories field is not an array"};let d=[...u];for(let b of d){if(typeof b!=="string")return{action:"drop",reason:`addDirectories carries a non-string directory: ${ke(b)}`};if(b.trim()==="")return{action:"drop",reason:`addDirectories carries a trim-empty directory: ${ke(b)}`};if(b.includes("\x00"))return{action:"drop",reason:`addDirectories carries a directory containing a null byte: ${ke(b)}`}}return{action:"apply",update:{type:t,destination:o,directories:d}}}case"removeDirectories":{let u=e.directories;if(!Array.isArray(u))return{action:"drop",reason:"removeDirectories whose directories field is not an array"};let d=[...u].filter((b)=>typeof b==="string");return{action:"apply",update:{type:t,destination:o,directories:d}}}case"setMode":{let u=e.mode;if(typeof u!=="st
~~~~

### evidence 2 off=186039288 fn=mbe@186039090 bodyLen=768 bodySha=235235a336fa2520 excerptSha=8ef33c0b2f2135a1

~~~~
(e,t){if(!e)return{resultType:"emptyPath"};let r;try{r=Lat(gt(e))}catch(d){let y=zk(d,"Path contains null bytes");if(!y)h(Error("validateDirectoryForWorkspace: expandPath threw"));return{resultType:"invalidPath",directoryPath:e,containsNullByte:y}}try{if(!(await mPn(r)).isDirectory())return{resultType:"notADirectory",directoryPath:e,absolutePath:r}}catch(d){if(!Rt(d))h(Object.a
~~~~

## #35 MCP copy shortcut reports how the sign-in URL was copied

verdict=BODY

uL/cL branch on copiedVia (native "(Copied!)", tmux-buffer, osc52). MCP menu state ee.mcp wires ZW() copiedVia. "sign-in URL" hits are older changelog text.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| Copied! | yes | 6 | 94044381,100604426,100604850,193211120,193211544,199185425 |
| sign-in URL | yes | 4 | 190010197,190018844,190034104,190038433 |
| (Copied!) | no | 2 | 94044380,199185424 |
| sign-in url | no | 0 | - |

### evidence 1 off=199185607 fn=cL@199185320 bodyLen=- bodySha=- excerptSha=93643b47972f57a1

~~~~
n cL(W){let U=y(2),{via:L}=W;if(L==="native"){let c;if(U[0]===d)c=e(t,{color:"success",children:"(Copied!)"}),U[0]=c;else c=U[0];return c}if(L===null){let c;if(U[1]===d)c=e(t,{dimColor:!0,children:e(O,{chord:"c",action:"copy",parens:!0})}),U[1]=c;else c=U[1];return c}return null}function uL(G){let S=y(2),{via:E}=G;if(E==="tmux-buffer"){let i;if(S[0]===d)i=e(t,{dimColor:!0,children:"(Copied to tmux buffer \xB7 select the URL manually if paste fails)"}),S[0]=i;else i=S[0];return i}if(E==="osc52"){let i;if(S[1]===d)i=e(t,{dimColor:!0,children:"(Sent via OSC 52 \xB7 select the URL manually if paste fails)"}),S[1]=i;else i=S[1];return i}return null}
export{ZW,cL,uL};
.// @bun @bytecode
// Claude Code is a Beta product per Anthropic's Commercial Terms of Service.
// By using Claude Code, you agr
~~~~

### evidence 2 off=209162022 fn=cp@209161753 bodyLen=13669 bodySha=e027d4e730db1d3c excerptSha=5628dd47507a5a66

~~~~
Pe=W((ee)=>ee.mcp),Ne=At(),[xe,Ce]=u(null),[Je,st]=u(!1),Tt=k(null),[it,re]=u(!1),[we,Ge]=u(null),[jt,De]=u(!1),[ot,dt]=u(!1),gt=xe||we||(ot?Q4():null),{copiedVia:ft,copy:se}=ZW(gt),[tn,Bt]=u(""),[Gt,Et]=u(0),[In,hn]=u(null);A(()=>()=>{Tt.current?.abort()},[]);let $n=a.isAuthenticated||Qo(a.client)&&b>0,$t=Fie(),Ut=B(async()=>{re(!1),Ge(null),st(!0);try{let ee=await $t(a.name,{discardDiscovery:!1}),Le=ee.client.type=
~~~~

## #36 italic suppressed for GNU screen / TERM=screen

verdict=BODY

rendersItalicAsStandout() is TERM.startsWith("screen"); jJn strips italic-off SGR when that is true. "TERM=screen" and "GNU screen" phrases are absent.

| needle | primary | hits | offsets |
| --- | --- | --- | --- |
| TERM=screen | yes | 0 | - |
| GNU screen | yes | 0 | - |
| italic | yes | 152 | 66658383,66797234,84551270,85801528,88283969,88549838,92239784,93687028,…+144 |
| screen-256color | no | 0 | - |

### evidence 1 off=183517458 fn=t8n@183514842 bodyLen=- bodySha=- excerptSha=6d586eafb5d25637

~~~~
rendersItalicAsStandout(){return(this.proc.env.TERM??"").startsWith("screen")}}function R(r){if(!r)return null;let i=/^(\d+)\.(\d+)\.(\d+)/.exec(r);if(!i)return null;return+i[1]*1e6+ +i[2]*1000+ +i[3]}var s_=new u;var T={black:!0,red:!0,green:!0,yellow:!0,blue:!0,magenta:!0,cyan:!0,white:!0,blackBright:!0,redBright:!0,greenBright:!0,yellowBright:!0,blueBright:!0,magentaBright:!0,cyanBright:!0,whiteBright:!0},c=new Set(Object.keys(T));var A=/^\x1b\[([34]8);2;(\d+);(\d+);(\d+)m$/;function BJn(r){if(ae.level>=3||r.length===0)return r;let i;for(let e=0;e<r.length;e++){let n=r[e],o=A.exec(n.code);if(o)i??=r.slice(0,e),i.push({type:"ansi",code:`\x1B[${o[1]};5;${E(+o[2],+o[3],+o[4])}m`,endCode:n.endCode});else if(i)i.push(n)}return i??r}var h="\x1B[23m";function jJn(r){for(let i of r)if(i.endCode===h)return s_.rendersItalicAsStandout()?r.filter((e)=>e.endCode!==h):r;return r}var m=[0,95,135,175
~~~~
