# gold-251-k

densable 2.1.251 SEA `claude.exe` 217360032 bytes. Invent-ban. Missing callees for PARTIAL CLI/bg/session bullets. Not a HAVE mark.

Method: `allHits("function NAME")` + `lastFnStartGeneric` from known caller offsets. **BODY** = closed function (or import alias when the name is `import {x as NAME}`). **MISS** = no `function NAME` and no import alias.

| # | verdict | callees | note |
| --- | --- | --- | --- |
| 25 | BODY | `dpe` `2c2127c68e29d31d` len 480; `DVt` IMPORT lutimes; `HA` IMPORT rename | full dpe (gold-d excerpt started mid-fn). `function DVt(` hits 0. restore is `HA(aside, dest)` in S0e |
| 27 | BODY | `$Y` `4c4768ec1baaba7f` len 315; `fke` `b3794a1bb093d67c` len 657; `zS` `63d75c6a2ed3df0e` len 98 | null = do not refuse. reserved name + bad source returns the refuse string |
| 33 | BODY | `rNt` `cbfa59a5189ab8a3` len 50; `_` `7717e57593f5686c` len 63; `g` `2900953a4749f8f4` len 79; `J` `e051f77b3a45b82e` len 128 | uo chunk imports `{_,f,g}` and `{J}`. lastFn from switch is uo |
| 34 | BODY | `lr` `d1b12448fc337888` len 2693; `mbe` `235235a336fa2520` len 768; `gbe` `01cfd9ea9537843e` len 1145; `zk` `e762e225f805e0f2` len 58 | update-path is lr addDirectories. containsNullByte is mbe/gbe |
| 35 | BODY | `ZW` `5e7f25e03173395a` len 727 | copy-via detector. returns {copiedVia, copy, reset} |
| 36 | BODY | `jJn` `70c605e54f801cec` len 124; `rendersItalicAsStandout` `686a0acb1a69af82` len 78 | gold-d excerpt already had both; isolated full bodies |
| 41 | BODY | `awn` `4493deaecb3786ee` len 232; `Yp` `00efbf346b217ad6` len 85 | awn reads token then Yp. no new fable dialog beyond gP |
| 42 | BODY | `oc` `aecdf37202398f48` len 64 | `n().surfaceCapabilities.replBridgeActive()` |
| 44 | BODY | `n` `94c28c1a89edd42c` len 72; `wur` `ee448e3c4549efbf` len 277; `Tie` `16450a8510552d85` len 273 | n passes /bug into gRt→qe→wur→Tie→TG. no /feedback rename |
| 51 | BODY | `dKe` `329d1655410060a4` len 108; `kr` `7116b12e4dc90132` len 88; `Ld` `fad0e79e36650a8b` len 96; `Iln` `b3d2fcb7180d61ae` len 500 | localAgent is type local_agent; teammate is in_process_teammate |

## #25

same-ID transcript set-aside. gold-d excerpt of `dpe` started at `isRetentionExemptionDisabled`. Full `dpe` is 480 bytes. `DVt` / `HA` are not functions: `lutimes as DVt`, `rename as HA` from `fs/promises`. S0e restore is `await HA(x,y)` (aside → dest).

caller `existing destination set aside at` @184388676 lastFn=`dpe`@184388254

### `dpe` @184388254 sha=`2c2127c68e29d31d` len=480

```
async function dpe(e){let t=`${e}.superseded-${Date.now()}`;try{await HA(e,t)}catch(o){if(Y(o))return;throw o}let{isRetentionExemptionDisabled:r}=import.meta.require("B:/~BUN/root/chunk-kstgrp55.js");if(!r()){let o=new Date;await DVt(t,o,o).catch((u)=>{n(`relocateSessionTranscript: could not refresh the set-aside's mtime at ${t} (it ages from its old clock): ${u}`,{level:"warn"})})}return n(`relocateSessionTranscript: existing destination set aside at ${t}`,{level:"warn"}),t}
```

### `DVt` IMPORT (not `function DVt`)

```
import{copyFile as TBe,appendFile as lpe,open as uv,lstat as MVt,mkdir as xv,readdir as Pv,readFile as Iv,lutimes as DVt,realpath as QBe,rename as HA,rm as vBe,stat as ly,unlink as JBe,utimes as ZBe,writeFile as eHe}from"fs/promises"
```

sha=`82c2e821b180e51e` @184277583 (`function DVt(` hits=0, `async function HA(` hits=0)

### `HA` IMPORT + S0e restore

```
import{copyFile as TBe,appendFile as lpe,open as uv,lstat as MVt,mkdir as xv,readdir as Pv,readFile as Iv,lutimes as DVt,realpath as QBe,rename as HA,rm as vBe,stat as ly,unlink as JBe,utimes as ZBe,writeFile as eHe}from"fs/promises"
```

sha=`82c2e821b180e51e` @184277583

S0e ENOENT restore:

```
await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript: could not restore set-aside destination after ENOENT move: ${pe}`,{level:"warn"})}),fe;n(`relocateSessionTranscript: old file missing: ${fe}`),B=!1}else{if(x!==void 0)await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript:
```

S0e failed-move restore:

```
await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript: could not restore set-aside destination after failed move: ${pe}`,{level:"warn"})});throw fe}}let W=ka(Mg(d),r),V=ka(o,r),me=!0;try{await $Be(W,V,t,U?{fromScope:OB
```

## #27

`$Y` refuse-entry. qFe rereads when `Pe!==void 0 && $Y(ke,Pe)===null`. Null means do not refuse. A string is the refuse reason. `fke` is the reserved-source check `$Y` returns. Delays `_gr=[30,70,150]` stay in gold-d `qFe`.

caller `$Y(ke,Pe)` @187868585 lastFn=`qFe`@187868067

### `$Y` @187729104 sha=`4c4768ec1baaba7f` len=315

```
function $Y(e,t){if(!goe.has(e.toLowerCase()))return null;if(typeof t.installLocation==="string"&&zS(t.installLocation))return null;let r=t.source;if(typeof r!=="object"||r===null)return`The name '${e}' is reserved for official Anthropic marketplaces and its registered source is malformed.`;return fke(e,t.source)}
```

### `fke` @179690054 sha=`b3794a1bb093d67c` len=657 ($Y callee)

```
function fke(e,t){let s=e.toLowerCase();if(!goe.has(s))return null;if(t.source==="github"){let r=t.repo||"";if(!r.toLowerCase().startsWith(`${te}/`)||r.split("/").includes(".."))return`The name '${e}' is reserved for official Anthropic marketplaces. Only repositories from 'github.com/${te}/' can use this name.`;return null}if(t.source==="git"&&t.url){if(Is(t.url))return null;return`The name '${e}' is reserved for official Anthropic marketplaces. Only repositories from 'github.com/${te}/' can use this name.`}return`The name '${e}' is reserved for official Anthropic marketplaces and can only be used with GitHub sources from the '${te}' organization.`}
```

### `zS` @187704335 sha=`63d75c6a2ed3df0e` len=98 ($Y official installLocation)

```
function zS(e){let t=zp(e);return Zv().find((r)=>{let o=zp(r);return t===o||t.startsWith(o+W0t)})}
```

## #33

outcome switch after `z()` / `L()` /dev/tty `login_tty`. lastFn from the switch is `uo`. `rNt` / `_` / `g` / `J` are not declared in that function; the uo chunk imports `{_,f,g}` and `{J}`.

caller `rNt(),_("bg_worker_ctty")` @204655734 lastFn=`uo`@204655316

switch @204655670:

```
switch(J("info","bg_worker_ctty",{outcome:t}),t){case"acquired":rNt(),_("bg_worker_ctty");break;case"already":rNt();break;case"failed":g("bg_worker_ctty",t);break;case"ffi_unavailable":case"not_a_tty":g("bg_worker_ctty",t);break;case"unsupported":case"switched_off":break}}if(S)Gf(zu(S),"startup_custom_id");if(yS.unset("CLAUDE_CODE_MESSAGI
```

uo-chunk imports @204640375 / 204640472:

```
import{_,f,g}from"B:/~BUN/root/chunk-pp8hjrn6.js"
import{J}from"B:/~BUN/root/chunk-81n9r8qk.js"
```

### `rNt` @184311051 sha=`cbfa59a5189ab8a3` len=50

```
function rNt(){zy().markOwnsControllingTerminal()}
```

### `zy` @184310921 sha=`1146b7fa05f38df7` len=38 (rNt callee)

```
function zy(){return nNt.of(G().host)}
```

### `_` @179407606 sha=`7717e57593f5686c` len=63

```
function _(e,u){s("tengu_feature_ok",{feature_name:c(e),...u})}
```

### `g` @179407748 sha=`2900953a4749f8f4` len=79

```
function g(e,u,r){s("tengu_feature_sad",{...r,feature_name:c(e),error_code:u})}
```

### `J` @179949342 sha=`e051f77b3a45b82e` len=128

```
function J(n,t,i){let r=m();if(!r)return;let o;try{o=e(n,t,l(i))}catch{o=e(n,t,{diagnostics_payload_failed:!0})}c().append(r,o)}
```

## #34

gold-d startup/settings parse already drops `\0` additionalDirectories. The missing update-path is `lr` `case"addDirectories"` (`action:"drop"`). Workspace validate is `mbe` (`containsNullByte` via `zk(...,"Path contains null bytes")`). `gbe` is the user string.

### `lr` @182107056 sha=`d1b12448fc337888` len=2693

```
function lr(e){if(e===null||typeof e!=="object")return{action:"drop",reason:`non-object permission update: ${ke(e)}`};let{type:t,destination:r}=e;if(typeof r!=="string"||!ml.has(r))return{action:"drop",reason:`${typeof t==="string"?ke(t):"permission update"} with out-of-enum destination: ${ke(r)}`};let o=r;switch(t){case"addRules":case"replaceRules":case"removeRules":{let u=e.behavior;if(typeof u!=="string"||!Object.hasOwn(tn,u))return{action:"drop",reason:`${t} with out-of-enum behavior: ${ke(u)}`};let d=u,b=e.rules;if(!Array.isArray(b))return{action:"drop",reason:`${t} (${d}) whose rules field is not an array`};let y=[...b],x=y.map((P)=>{if(P===null||typeof P!=="object")return P;let{toolName:A,ruleContent:O}=P;return O===void 0?{toolName:A}:{toolName:A,ruleContent:O}});if(!(t==="removeRules"?d==="allow":d==="deny"||d==="ask")){let P=[];for(let A of x){if(!ar(A))return{action:"drop",reason:`widening ${t} (${d}) carries a shape-invalid rule: ${ke(A)}`};if(!o_t(A)){let O=t==="removeRules"?null:ul(A);if(O!==null){P.push(O);continue}return{action:"drop",reason:`widening ${t} (${d}) carries a rule that does not survive the store round-trip: ${ke(A)}`}}P.push(A)}return{action:"apply",update:{type:t,behavior:d,destination:o,rules:P}}}let k=[];for(let P of x){if(!ar(P))continue;let A=Ur(eo(P));if(A.toolName!==P.toolName||A.ruleContent!==P.ruleContent)k.push(A);else k.push(P)}if(k.length===0&&y.length>0)return{action:"drop",reason:`restrictive ${t} (${d}) in which every rule is shape-invalid`};return{action:"apply",update:{type:t,behavior:d,destination:o,rules:k}}}case"addDirectories":{let u=e.directories;if(!Array.isArray(u))return{action:"drop",reason:"addDirectories whose directories field is not an array"};let d=[...u];for(let b of d){if(typeof b!=="string")return{action:"drop",reason:`addDirectories carries a non-string directory: ${ke(b)}`};if(b.trim()==="")return{action:"drop",reason:`addDirectories carries a trim-empty directory: ${ke(b)}`};if(b.includes("\x00"))return{action:"drop",reason:`addDirectories carries a directory containing a null byte: ${ke(b)}`}}return{action:"apply",update:{type:t,destination:o,directories:d}}}case"removeDirectories":{let u=e.directories;if(!Array.isArray(u))return{action:"drop",reason:"removeDirectories whose directories field is not an array"};let d=[...u].filter((b)=>typeof b==="string");return{action:"apply",update:{type:t,destination:o,directories:d}}}case"setMode":{let u=e.mode;if(typeof u!=="string")return{action:"drop",reason:`setMode with non-string mode: ${ke(u)}`};return{action:"apply",update:{type:t,destination:o,mode:u}}}default:return{action:"drop",reason:`unknown permission update type: ${ke(t)}`}}}
```

addDirectories arm:

```
case"addDirectories":{let u=e.directories;if(!Array.isArray(u))return{action:"drop",reason:"addDirectories whose directories field is not an array"};let d=[...u];for(let b of d){if(typeof b!=="string")return{action:"drop",reason:`addDirectories carries a non-string directory: ${ke(b)}`};if(b.trim()==="")return{action:"drop",reason:`addDirectories carries a trim-empty directory: ${ke(b)}`};if(b.includes("\x00"))return{action:"drop",reason:`addDirectories carries a directory containing a null byte: ${ke(b)}`}}return{action:"apply",update:{type:t,destination:o,directories:d}}}
```

### `mbe` @186039090 sha=`235235a336fa2520` len=768

```
async function mbe(e,t){if(!e)return{resultType:"emptyPath"};let r;try{r=Lat(gt(e))}catch(d){let y=zk(d,"Path contains null bytes");if(!y)h(Error("validateDirectoryForWorkspace: expandPath threw"));return{resultType:"invalidPath",directoryPath:e,containsNullByte:y}}try{if(!(await mPn(r)).isDirectory())return{resultType:"notADirectory",directoryPath:e,absolutePath:r}}catch(d){if(!Rt(d))h(Object.assign(Error("validateDirectoryForWorkspace: unexpected stat errno"),{code:v(d)}));return{resultType:"pathNotFound",directoryPath:e,absolutePath:r}}let o=EE(t),u=be();for(let d of o)if(np(r,d,{caseFold:!1}))return{resultType:"alreadyInWorkingDirectory",directoryPath:e,workingDir:d,isExactMatch:Lat(d)===r,isOriginalCwd:d===u};return{resultType:"success",absolutePath:r}}
```

### `gbe` @186039858 sha=`01cfd9ea9537843e` len=1145

```
function gbe(e){switch(e.resultType){case"emptyPath":return"Please provide a directory path.";case"invalidPath":{let t=ae.bold(S(e.directoryPath));return e.containsNullByte?`Path ${t} contains a null character, so it can't be used as a working directory. Remove the null character from the path or from the settings entry that lists it.`:`Path ${t} couldn't be resolved, so it can't be used as a working directory. Check the path or the settings entry that lists it.`}case"pathNotFound":return`Path ${ae.bold(e.absolutePath)} was not found.`;case"notADirectory":{let t=fPn(e.absolutePath);return`${ae.bold(e.directoryPath)} is not a directory. Did you mean to add the parent directory ${ae.bold(t)}?`}case"alreadyInWorkingDirectory":{let t=ae.bold(e.directoryPath);if(e.isExactMatch)return e.isOriginalCwd?`${t} is already the current working directory.`:`${t} is already added as a working directory.`;let r=e.isOriginalCwd?"the current working directory":"the additional working directory";return`${t} is already accessible within ${r} ${ae.bold(e.workingDir)}.`}case"success":return`Added ${ae.bold(e.absolutePath)} as a working directory.`}}
```

### `zk` @178831583 sha=`e762e225f805e0f2` len=58 (mbe callee)

```
function zk(n,e){return n instanceof Error&&n.message===e}
```

## #35

`ZW` is the copy-via detector. Menu `cL`/`uL` already in gold-d. `cp` does `{copiedVia:ft,copy:se}=ZW(gt)`.

caller `copiedVia:ft,copy:se}=ZW(` @209162175 lastFn=`cp`@209161753

### `ZW` @199184593 sha=`5e7f25e03173395a` len=727

```
function ZW(r){let s=xt(),[P,a]=u(null),n=k(null),l=k(null),o=k(null),p=k(0),f=k(!0),C=B(()=>{p.current+=1,o.current?.(),o.current=null,l.current=null,n.current?.(),n.current=null,a(null)},[]);A(()=>{if(C(),r!==null)Xht()},[r,C]),A(()=>(f.current=!0,()=>{f.current=!1,o.current?.(),o.current=null,l.current=null,n.current?.(),n.current=null}),[]);let v=B((m)=>{if(l.current===m)return;l.current=m,o.current?.(),o.current=s.setTimeout(()=>{o.current=null,l.current=null},g);let b=zue(),R=p.current;yy(m).then((h)=>{if(!f.current||R!==p.current)return;if(h)process.stdout.write(h);if(n.current?.(),n.current=null,a(b),b==="native")n.current=s.setTimeout(()=>{n.current=null,a(null)},x)})},[s]);return{copiedVia:P,copy:v,reset:C}}
```

## #36

gold-d excerpt already showed both. Isolated full bodies. `jJn` strips italic-off SGR `\x1B[23m` when `s_.rendersItalicAsStandout()`. That method is on `class u` @183516370, not `t8n`.

### `jJn` @183518215 sha=`70c605e54f801cec` len=124

```
function jJn(r){for(let i of r)if(i.endCode===h)return s_.rendersItalicAsStandout()?r.filter((e)=>e.endCode!==h):r;return r}
```

### `rendersItalicAsStandout` @183517458 sha=`686a0acb1a69af82` len=78

```
rendersItalicAsStandout(){return(this.proc.env.TERM??"").startsWith("screen")}
```

## #41

`urr`/`oEn` already in gold-e. `So` does `urr(awn())`. `oI`/`iI` start with `if(!Yp())`. `awn` returns token subscription/tier only when `wl()` and `Yp()`. No fable credit dialog beyond gold-e `gP`.

caller `urr(awn())` @189860553 lastFn=`So`@189856700

caller `if(!Yp())` @181264508 lastFn=`oI`@181264494

### `awn` @181264770 sha=`4493deaecb3786ee` len=232

```
function awn(){if(!wl())return{subscriptionType:null,rateLimitTier:null};let e=Xt();if(!e||!Yp())return{subscriptionType:null,rateLimitTier:null};return{subscriptionType:e.subscriptionType??null,rateLimitTier:e.rateLimitTier??null}}
```

### `Yp` @181264685 sha=`00efbf346b217ad6` len=85

```
function Yp(){if(ko()||a.CLAUDE_CODE_OAUTH_TOKEN||Cc())return!1;return!(D7()&&!M7())}
```

## #42

`f_` is `oc()||wt()||pie()!==void 0`. `wt`/`pie` already in gold-e. `oc` is REPL bridge active.

caller `oc()||wt()` @181075191 lastFn=`f_`@181075177

### `oc` @179077773 sha=`aecdf37202398f48` len=64

```
function oc(){return n().surfaceCapabilities.replBridgeActive()}
```

## #44

gold-e `n` already passes `/share` or `/bug`. That is the /bug call site (`export{n as call}`). Chain: `n` → `gRt(p)` → `qe` → `wur(...,J)` → `Tie(J)` → `TG(b)`. `TG("/bug")` literal hits=0. No `/feedback` rename. `uln` still calls `TG()` with the default `/feedback`.

caller `m==="share"?"/share":"/bug"` @210459733 lastFn=`n`@210459690

### `n` @210459690 sha=`94c28c1a89edd42c` len=72

```
async function n(o,a,e,m){return gRt(o,a,e,m==="share"?"/share":"/bug")}
```

### `gRt` @210227259 sha=`c09d736650ea7b90` len=95

```
async function gRt(m,s,f,p="/feedback"){let v=f?.trim()==="public"?"":f||"";return qe(m,s,v,p)}
```

### `qe` @210227142 sha=`b5610c4a2b58e94f` len=117

```
function qe(m,s,f,p){return wur(m,s.abortController.signal,s.messages,f,{...s.taskRegistry.all()},s.readFileState,p)}
```

### `wur` @210226865 sha=`ee448e3c4549efbf` len=277

```
function wur(m,s,f,p="",v={},g,J="/feedback"){let K=Tie(J);if(K.kind==="disabled")return m(K.reason),null;let te=fOn()??void 0;return e(gt,{abortSignal:s,messages:f,initialDescription:p,onDone:m,backgroundTasks:v,mode:K.kind,readFileState:g,surveyFeedbackSource:te,command:J})}
```

### `Tie` @191440771 sha=`16450a8510552d85` len=273

```
function Tie(b="/feedback"){let P=TG(b);if(P!==null)return{kind:"disabled",reason:P};let E=Ne();if(E!=="firstParty")return{kind:"bundle",cause:"provider",label:Rp[E]};if(D6().error)return{kind:"bundle",cause:"no_creds",label:"no Anthropic credentials"};return{kind:"post"}}
```

### `uln` @186530870 sha=`9ce35f7d7027b082` len=239 (TG() default; not /bug-specific)

```
function uln(){if(TG()!==null)return!1;if(Nrr())return!1;if(a0())return!1;if(Ne()!=="firstParty")return!1;let e=a.CLAUDE_CODE_SEND_FEEDBACK;if(e===!1)return!1;if(e===!0)return I("tengu_juniper_relay",!1);return I("tengu_juniper_relay",!1)}
```

## #51

gold-e `wCe`/`_Mn`/`Bpe` already branch on `localAgent`. The arm is `dKe`: teammate if `Ld` (`in_process_teammate`), else localAgent if `kr` (`local_agent`). `Iln` uses `d??y` for the viewed task.

caller `dKe(s.viewingAgentTaskId,s.tasks)` @202541063 lastFn=`wCe`@202541044

### `dKe` @187092580 sha=`329d1655410060a4` len=108

```
function dKe(e,t){let r=e?t[e]:void 0,o=Ld(r)?r:void 0,u=!o&&kr(r)?r:void 0;return{teammate:o,localAgent:u}}
```

### `Ld` @185963190 sha=`fad0e79e36650a8b` len=96 (teammate predicate)

```
function Ld(e){return typeof e==="object"&&e!==null&&"type"in e&&e.type==="in_process_teammate"}
```

### `kr` @185970495 sha=`7116b12e4dc90132` len=88 (localAgent predicate)

```
function kr(e){return typeof e==="object"&&e!==null&&"type"in e&&e.type==="local_agent"}
```

### `Iln` @187092688 sha=`b3d2fcb7180d61ae` len=500

```
function Iln({viewingAgentTaskId:e,tasks:t,transcripts:r,mainIsBusy:o,mainConversationId:u}){let{teammate:d,localAgent:y}=dKe(e,t),k=d??y;if(!k||!e){let x=r[tt()];return{task:void 0,isMain:!0,isTeammate:!1,messages:x?.messages??LPt,inProgressToolUseIDs:x?.inProgressToolUseIDs??FPt,conversationKey:u,isLoading:o}}let A=r[e];return{task:k,isMain:!1,isTeammate:!!d,messages:A?.messages??LPt,inProgressToolUseIDs:A?.inProgressToolUseIDs??FPt,conversationKey:e,isLoading:k.status==="running"&&!k.isIdle}}
```
