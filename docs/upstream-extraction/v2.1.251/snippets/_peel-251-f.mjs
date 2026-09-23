/**
 * densable 2.1.251 SEA peel — changelog #55–#63 #66 #67 #69.
 * Writes gold-251-f.md. Does not touch src/, checklist, or the alignment board.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) {
  throw new Error(`unexpected SEA size ${buf.length}`)
}

const __dir = dirname(fileURLToPath(import.meta.url))

function count(needle) {
  return allHits(buf, needle).length
}

function mustFind(needle, nth = 0) {
  const hits = allHits(buf, needle)
  if (hits[nth] === undefined) throw new Error(`miss ${JSON.stringify(needle)}`)
  return hits[nth]
}

function fnAt(needle, maxLen = 20000) {
  const i = mustFind(needle)
  const ex = extractFnAt(buf, i, maxLen)
  if (!ex.body) throw new Error(`no body ${JSON.stringify(needle)} ${ex.preview ?? ''}`)
  return { ...ex, at: i }
}

function windowAt(needle, before, after) {
  const i = mustFind(needle)
  const text = asciiSlice(buf, i - before, i + after)
  return { at: i, text, sha: sha(text), len: text.length }
}

function clip(s, n = 2400) {
  if (s.length <= n) return s
  return `${s.slice(0, n)}\n… (${s.length - n} chars omitted)`
}

function countIn(needle, lo, hi) {
  return allHits(buf, needle).filter(h => h >= lo && h < hi).length
}

const HL_LO = 188800000
const HL_HI = 189500000

const tomb = windowAt(
  'for(let ou of Cr)yield{type:"tombstone",message:ou}',
  280,
  900,
)
const radioObj = windowAt('var Lnr={type:"local",name:"radio"', 0, 220)
const radioCall = fnAt(
  'async function r(){if(await Lr("https://clau.de/radio"))',
  800,
)
const chrome = windowAt('kx(a,d)==="bypassPermissions"', 120, 520)
const nq = fnAt('function Nq(){return n().host.launchOptions.sessionBypassPermissionsMode()}')
const dme = windowAt('function Dme(e){let t=[],o={};if(Nq())', 0, 280)
const td = fnAt('function TD(){return Nq()?"skip_all_permission_checks":"ask"}')
const sY = fnAt('function sY(){let e=a.CLAUDE_CODE_SUBAGENT_MODEL;')
const jR = fnAt('function jR(e,t,r,o,u){let d=()=>hf({permissionMode:o??"default",mainLoopModel:t')
const spawn = windowAt('jR(N9(en,dn),dn,We?"inherit":Pr,pe)', 80, 40)
const uZn = fnAt('function UZn(){let e=DOt(),t=`Co-Authored-By:')
const bZn = fnAt('function BZn(e){if(lp(e)&&(!dr()||jo()||ZO(e)))')
const xbt = fnAt('function Xbt(){if(fAe()||qSt()||RYe())return!0;return _fe()&&!rw()}')
const rye = fnAt('function RYe(){return $n()==="enterprise"&&pbr()==="enterprise_usage_based"}')
const aw = fnAt('function aw(){if(Et()){if(Xbt())return{setting:')
const bl = fnAt('function bl(){let e=a.ANTHROPIC_DEFAULT_OPUS_MODEL;')
const xt = fnAt('function xt(e=pc()){return Hs("opus",e)??e.opus5}')
const rw = fnAt('function rw(){let e=nw(),t=wo().state!=="inactive"||vn()?.enforceAvailableModels===!0;return e.sonnet&&!e.opus&&!t}')
const effortJ = fnAt('function J(){let e=Je(),o=D({cli:{effort:void 0},env:process.env,settings:e})')
const effortK = fnAt('function K(e,o){let t=p5e(e);return Object.hasOwn(Object.prototype,t)?{effortLevel:o}:{modelSettings:{[t]:{effortLevel:o}}}')
const kh = fnAt('function Kh(){return Zq()||gi()!==null||bW()||e2()}')
const zq = fnAt('function Zq(){if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return!1;return!dr()}')
const gi = fnAt('function gi(){return n().host.credentialSlots.gatewayAuth()}')
const priv = fnAt('function x(){if(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)return"essential-traffic";if(process.env.DISABLE_TELEMETRY)')
const bw = fnAt('function bW(){return x()!=="default"}')
const dr1p = fnAt('function dr(){return Ne()==="firstParty"}')
const ign = fnAt('async function ign(e){let t=Date.now();if(kt()||gZ())return null;')
const kfn = fnAt('async function Kfn(e){let t=zo(e)?process.env.GH_TOKEN||process.env.GITHUB_TOKEN:')
const nst = fnAt('async function n$t(e){if(!await Kg())return null;')
const kt = fnAt('function kt(){return x()==="essential-traffic"}')
const vu = fnAt('function VU(e){if(!e)return{shellSettings:{},envVars:{},sandboxSettings:{}')
const zor = fnAt('function Zor(e,t){switch(e.source){case"consented_payload":return wt(e.settings,t);')
const so = fnAt('function so(e,t){if(t===void 0||t===null||t===!1)return!1;')
const tn = fnAt('function Tn(e){if(/\\r(?!\\n)/.test(e))return!0;return e.split(/\\n|\\r\\n/).some((t)=>{')
const zne = fnAt('function zNe(e,t){let o=e.toUpperCase();return An.has(o)||On.has(o)&&Oe(t)||o==="ANTHROPIC_CUSTOM_HEADERS"&&!Tn(t)}')
const qe = windowAt('qe=["allowAppleEvents","credentials","enableWeakerNestedSandbox"', 0, 280)
const jsName = windowAt('return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"]', 0, 80)
const footerHook = windowAt('fetchPrStatus:()=>n$t(', 40, 30)
const bltStr = windowAt(
  'Blt="The previous response failed to produce a valid tool call',
  0,
  200,
)
const wtt = windowAt('async function wtt(e){if(kt())return null;', 0, 280)

const ids = [
  ['mathematica', 'mathematica'],
  ['maxima', 'maxima'],
  ['isbl', 'isbl'],
  ['gml quoted', '"gml"'],
  ['gml raw', 'gml'],
  ['1c quoted', '"1c"'],
  ['1C:Enterprise', '1C:Enterprise'],
  ['sqf quoted', '"sqf"'],
  ['sqf raw', 'sqf'],
  ['name Mathematica', 'name:"Mathematica"'],
  ['name Maxima', 'name:"Maxima"'],
  ['name ISBL', 'name:"ISBL"'],
  ['name GML', 'name:"GML"'],
  ['name SQF', 'name:"SQF"'],
  ['name 1C', 'name:"1C'],
  ['GameMaker', 'GameMaker'],
]

const idLines = ids
  .map(([label, needle]) => {
    const global = count(needle)
    const near = countIn(needle, HL_LO, HL_HI)
    return `- ${label} ${JSON.stringify(needle)} global=${global} nearHljs=${near}`
  })
  .join('\n')

const rows = [
  [
    '55',
    'BODY',
    `malformed_tool_use=${count('malformed_tool_use')} retry-context=${count('retry context')} broken-output=${count('broken output')}`,
    `excerpt ${tomb.sha}`,
    'Tombstone the unparsed assistant turn; retry context is prior messages plus a meta retry prompt',
  ],
  [
    '56',
    'BODY',
    `/radio=${count('/radio')} name:"radio" obj=1 ==="radio"=${count('==="radio"')}`,
    `call ${radioCall.sha}`,
    'Local command radio; call opens https://clau.de/radio; no telemetry or 3P predicate on the object or call',
  ],
  [
    '57',
    'BODY',
    `skip_all_permission_checks=${count('skip_all_permission_checks')} tengu_cfc=${count('tengu_cfc')} cfc_in_product=${count('cfc_in_product')}`,
    `Nq ${nq.sha}`,
    'Chrome tool uses ask / follow_a_plan unless bypassPermissions; Nq is session bypass, not telemetry',
  ],
  [
    '58',
    'BODY',
    `CLAUDE_CODE_SUBAGENT_MODEL=${count('CLAUDE_CODE_SUBAGENT_MODEL')}`,
    `jR ${jR.sha}`,
    'Per-spawn model r, then agent model e, then env sY()',
  ],
  [
    '59',
    'BODY',
    `literal Co-Authored-By: Claude Code=${count('Co-Authored-By: Claude Code')} Co-Authored-By=${count('Co-Authored-By')}`,
    `BZn ${bZn.sha}`,
    'Unrecognized model falls through to Claude Code; trailer is composed, not a literal',
  ],
  [
    '60',
    'BODY',
    `seat-based=${count('seat-based')} enterprise_usage_based=${count('enterprise_usage_based')} opus5 token=${count('opus5')}`,
    `aw ${aw.sha}`,
    'Xbt includes non-usage-based enterprise; aw returns bl()/opus5 when Xbt()',
  ],
  [
    '61',
    'BODY',
    `effortByModel=${count('effortByModel')} effortLevel=${count('effortLevel')} /effort=${count('/effort')}`,
    `J ${effortJ.sha}`,
    'Read modelSettings[].effortLevel into byModel; write modelSettings[model].effortLevel',
  ],
  [
    '62',
    'BODY',
    `DISABLE_TELEMETRY=${count('DISABLE_TELEMETRY')} forceLoginMethod=${count('forceLoginMethod')}`,
    `Kh ${kh.sha}`,
    'Analytics off for gateway only when gatewayAuth is set, or via privacy/DISABLE_TELEMETRY; Kh has no forceLoginMethod',
  ],
  [
    '63',
    'BODY',
    `gh pr view=${count('gh pr view')} gh auth token=${count('gh auth token')} tengu_harbor_prism=${count('tengu_harbor_prism')}`,
    `ign ${ign.sha}`,
    'Footer fetch is n$t→ign REST; token is GH_TOKEN, GITHUB_TOKEN, or gh auth token; harbor flag absent',
  ],
  [
    '66',
    'BODY',
    `weakensIsolation=${count('weakensIsolation')} enableWeakerNestedSandbox=${count('enableWeakerNestedSandbox')} .restrictive=${count('.restrictive')}`,
    `VU ${vu.sha}`,
    'qe sandbox keys enter sandboxSettings; Zor re-prompts when dangerousSettingsHash changes',
  ],
  [
    '67',
    'BODY',
    `ANTHROPIC_CUSTOM_HEADERS=${count('ANTHROPIC_CUSTOM_HEADERS')}`,
    `zNe ${zne.sha}`,
    'Tn/Cn treats auth and host header names as sensitive; those values join the approval env set',
  ],
  [
    '69',
    'BODY',
    `name:"JavaScript"=${count('name:"JavaScript"')} name:"Mathematica"=${count('name:"Mathematica"')} maxima=${count('maxima')} isbl=${count('isbl')} "1c"=${count('"1c"')} name:"GML"=${count('name:"GML"')} name:"SQF"=${count('name:"SQF"')}`,
    `js grammar ${jsName.sha}`,
    'highlight.js grammars present; the six language names are absent beside them',
  ],
]

const table = [
  '| # | Verdict | Hits | sha | Body |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} |`),
].join('\n')

const md = `# gold-251-f

Official densable 2.1.251 win32-x64 SEA \`claude.exe\` ${buf.length} bytes. Invent-ban. Not a HAVE mark. Skipped #64 #65 #68 #70 #71.

${table}

## #55 BODY

Malformed tool-use retry drops the assistant turn. \`Cr\` is tombstoned. The next request is \`messages:[...Cn, vi]\` where \`vi\` uses \`Blt\`. \`Blt\` is "The previous response failed to produce a valid tool call. Please retry the tool call now." The neighbor string \`bin\` ("Your tool call was malformed and could not be parsed. Please retry.") is not the value inserted here. \`transition.reason\` is \`malformed_tool_use_retry\`. A second failure yields "The model's tool call could not be parsed (retry also failed)." This excerpt has no Bedrock, Vertex, or Foundry branch.

Blt @${bltStr.at} sha=${bltStr.sha}

\`\`\`
${clip(bltStr.text)}
\`\`\`

excerpt @${tomb.at} len=${tomb.len} sha=${tomb.sha}

\`\`\`
${clip(tomb.text)}
\`\`\`

## #56 BODY

\`/radio\` is a local command in the command list (\`HLt=Lnr\`) with no \`isEnabled\`. \`call\` only opens \`https://clau.de/radio\`. The \`==="radio"\` hit is an HTML input type. No other command-gate string for \`radio\` showed up.

command @${radioObj.at} sha=${radioObj.sha}

\`\`\`
${clip(radioObj.text)}
\`\`\`

call @${radioCall.at} len=${radioCall.len} sha=${radioCall.sha}

\`\`\`
${clip(radioCall.body)}
\`\`\`

## #57 BODY

Claude in Chrome tool \`call\` sets \`permissionMode\` to \`skip_all_permission_checks\` only when the resolved mode is \`bypassPermissions\`. Otherwise it uses \`follow_a_plan\` (with \`onPermissionRequest\`) or \`ask\`. \`Nq()\` is \`sessionBypassPermissionsMode\`, and \`Dme\` / \`TD\` use that for \`CLAUDE_CHROME_PERMISSION_MODE\`. \`tengu_cfc\` and \`cfc_in_product\` are 0. No \`DISABLE_TELEMETRY\` read in these snippets.

Nq @${nq.at} len=${nq.len} sha=${nq.sha}

\`\`\`
${clip(nq.body)}
\`\`\`

Dme @${dme.at} sha=${dme.sha}

\`\`\`
${clip(dme.text)}
\`\`\`

TD @${td.at} len=${td.len} sha=${td.sha}

\`\`\`
${clip(td.body)}
\`\`\`

chrome call excerpt @${chrome.at} len=${chrome.len} sha=${chrome.sha}

\`\`\`
${clip(chrome.text)}
\`\`\`

## #58 BODY

\`sY()\` reads \`CLAUDE_CODE_SUBAGENT_MODEL\` (anything other than \`inherit\`). \`jR(e,t,r,o,u)\`: \`t\` is the parent model, \`o\` is permission mode. Spawn site \`jR(N9(en,dn), dn, We?"inherit":Pr, pe)\` passes the agent-derived model as \`e\` and the per-spawn model as \`r\`. \`jR\` applies \`r\` first, then \`e\`, and calls \`sY()\` only after both are unset or not a concrete model.

sY @${sY.at} len=${sY.len} sha=${sY.sha}

\`\`\`
${clip(sY.body)}
\`\`\`

jR @${jR.at} len=${jR.len} sha=${jR.sha}

\`\`\`
${clip(jR.body)}
\`\`\`

spawn @${spawn.at} sha=${spawn.sha}

\`\`\`
${clip(spawn.text)}
\`\`\`

## #59 BODY

The literal \`Co-Authored-By: Claude Code\` is absent. \`UZn\` builds \`Co-Authored-By: \${BZn(at())} <noreply@anthropic.com>\`. \`BZn\`: known catalog id via \`rDt\` becomes \`AVt\` (\`Claude \${label}\` or \`Claude (\${id})\`). Otherwise \`ZO\` (canonical known model) yields \`Claude\`, and the remaining case yields \`Claude Code\`.

UZn @${uZn.at} len=${uZn.len} sha=${uZn.sha}

\`\`\`
${clip(uZn.body)}
\`\`\`

BZn @${bZn.at} len=${bZn.len} sha=${bZn.sha}

\`\`\`
${clip(bZn.body)}
\`\`\`

## #60 BODY

\`seat-based\` is 0. Seat split is \`seatTier==="enterprise_usage_based"\` (\`RYe\` / \`pbr\`) versus any other \`$n()==="enterprise"\` (\`_fe()&&!rw()\`). \`Xbt\` is true for max, team \`default_claude_max_5x\`, usage-based enterprise, or other enterprise when \`rw()\` is false. \`rw\` is true when the catalog has sonnet, lacks opus, and available-models enforcement is off. When \`Xbt()\` is true, \`aw\` returns \`bl()\` with \`envFamily:"opus"\` (also on the \`ra()\` branch, and on Bedrock/Vertex when \`rw()\` is false). \`bl\` uses \`ANTHROPIC_DEFAULT_OPUS_MODEL\` or \`xt\`, and \`xt\` is \`Hs("opus")??e.opus5\`. Catalog maps \`"claude-opus-5":"opus5"\`.

Xbt @${xbt.at} len=${xbt.len} sha=${xbt.sha}

\`\`\`
${clip(xbt.body)}
\`\`\`

RYe @${rye.at} len=${rye.len} sha=${rye.sha}

\`\`\`
${clip(rye.body)}
\`\`\`

aw @${aw.at} len=${aw.len} sha=${aw.sha}

\`\`\`
${clip(aw.body)}
\`\`\`

bl @${bl.at} len=${bl.len} sha=${bl.sha}

\`\`\`
${clip(bl.body)}
\`\`\`

xt @${xt.at} len=${xt.len} sha=${xt.sha}

\`\`\`
${clip(xt.body)}
\`\`\`

rw @${rw.at} len=${rw.len} sha=${rw.sha}

\`\`\`
${clip(rw.body)}
\`\`\`

## #61 BODY

No \`effortByModel\` string. \`J\` walks settings sources, reads \`modelSettings[model].effortLevel\` into \`byModel\`, and if a source has no per-model entry it copies that source's \`effortLevel\` onto each model key. \`K(model, level)\` persists \`{modelSettings:{[model]:{effortLevel}}}\` (prototype-key guard writes top-level \`effortLevel\` instead).

J @${effortJ.at} len=${effortJ.len} sha=${effortJ.sha}

\`\`\`
${clip(effortJ.body)}
\`\`\`

K @${effortK.at} len=${effortK.len} sha=${effortK.sha}

\`\`\`
${clip(effortK.body)}
\`\`\`

## #62 BODY

\`Kh\` is the \`analyticsDisabled\` predicate: \`Zq()||gi()!==null||bW()||e2()\`. \`Zq\` is not-first-party (\`!dr()\`, \`dr\` is \`Ne()==="firstParty"\`) unless \`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST\`. \`gi\` is \`credentialSlots.gatewayAuth()\` — analytics stay off when that slot is set, not when managed \`forceLoginMethod==="gateway"\` merely exists. \`Kh\` does not mention \`forceLoginMethod\`. \`bW\` is privacy \`!=="default"\`, and \`x()\` returns \`no-telemetry\` for \`DISABLE_TELEMETRY\` or \`DO_NOT_TRACK\`, and \`essential-traffic\` for \`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC\`. \`e2\` is \`CLAUDE_CODE_CUSTOM_OAUTH_URL\`.

Kh @${kh.at} len=${kh.len} sha=${kh.sha}

\`\`\`
${clip(kh.body)}
\`\`\`

Zq @${zq.at} len=${zq.len} sha=${zq.sha}

\`\`\`
${clip(zq.body)}
\`\`\`

dr @${dr1p.at} len=${dr1p.len} sha=${dr1p.sha}

\`\`\`
${clip(dr1p.body)}
\`\`\`

gi @${gi.at} len=${gi.len} sha=${gi.sha}

\`\`\`
${clip(gi.body)}
\`\`\`

x @${priv.at} len=${priv.len} sha=${priv.sha}

\`\`\`
${clip(priv.body)}
\`\`\`

bW @${bw.at} len=${bw.len} sha=${bw.sha}

\`\`\`
${clip(bw.body)}
\`\`\`

## #63 BODY

Footer poller deps include \`fetchPrStatus:()=>n$t(\`. \`n$t\` returns \`ign(branch) ?? wtt\`. \`wtt\` runs \`glab mr view\` and returns null when the host is GitHub. \`ign\` calls the REST list \`/repos/.../pulls?head=...&state=open&per_page=1\` with \`Authorization: Bearer\`. It returns null first only for \`kt()\` (essential-traffic, not \`DISABLE_TELEMETRY\`) or gh backoff. \`Kfn\` takes \`GH_TOKEN||GITHUB_TOKEN\` (or the enterprise pair when \`GH_HOST\` matches), else \`gh auth token --hostname\`. \`tengu_harbor_prism\` is 0. \`fgn\` still shells \`gh pr view\` for the URL cache \`prStatusByUrl\`; that is not the branch footer fetch.

footer hook @${footerHook.at} sha=${footerHook.sha}

\`\`\`
${clip(footerHook.text)}
\`\`\`

wtt @${wtt.at} sha=${wtt.sha}

\`\`\`
${clip(wtt.text)}
\`\`\`

kt @${kt.at} len=${kt.len} sha=${kt.sha}

\`\`\`
${clip(kt.body)}
\`\`\`

Kfn @${kfn.at} len=${kfn.len} sha=${kfn.sha}

\`\`\`
${clip(kfn.body, 1200)}
\`\`\`

n$t @${nst.at} len=${nst.len} sha=${nst.sha}

\`\`\`
${clip(nst.body, 500)}
\`\`\`

ign @${ign.at} len=${ign.len} sha=${ign.sha}

\`\`\`
${clip(ign.body, 1600)}
\`\`\`

## #66 BODY

\`VU\` copies sandbox fields in \`qe\` into \`sandboxSettings\` when \`so\` says the value is set. \`so\` is false for null/false/empty, and for \`credentials\` that are deny-only (\`ro\`: files/envVars \`mode==="deny"\`, sigv4 deny, \`allowPlaintextInject===false\`). \`network.tlsTerminate\` and \`credentials\` also attach \`network.allowedDomains\`. \`Zor\` returns true when \`dangerousSettingsHash\` (\`fEt\` over shell/env/sandbox/hooks/claudeMd) differs from the consented payload. \`.restrictive\` reads are 0; the \`restrictive:!1\` path table is present and unused under that spelling.

qe @${qe.at} sha=${qe.sha}

\`\`\`
${clip(qe.text)}
\`\`\`

so @${so.at} len=${so.len} sha=${so.sha}

\`\`\`
${clip(so.body)}
\`\`\`

VU @${vu.at} len=${vu.len} sha=${vu.sha}

\`\`\`
${clip(vu.body, 1800)}
\`\`\`

Zor @${zor.at} len=${zor.len} sha=${zor.sha}

\`\`\`
${clip(zor.body)}
\`\`\`

## #67 BODY

\`Tn\` flags a custom-header block when a header name fails the token grammar, the value fails \`$Kt\`, or the name matches \`Cn\` (\`auth|key|token|...|host|url|...|proxy|route|...|beta|version\`). \`authorization\` matches \`auth\`. \`host\` matches \`host\`. \`zNe\` is true for \`ANTHROPIC_CUSTOM_HEADERS\` only when \`!Tn\` (not sensitive). \`VU\` puts env entries with \`!zNe\` into \`envVars\`, which \`Zor\` / \`dangerousSettingsHash\` treats as needing consent.

Tn @${tn.at} len=${tn.len} sha=${tn.sha}

\`\`\`
${clip(tn.body)}
\`\`\`

zNe @${zne.at} len=${zne.len} sha=${zne.sha}

\`\`\`
${clip(zne.body)}
\`\`\`

## #69 BODY

highlight.js is in the bundle (\`registerLanguage\`=${count('registerLanguage')}, \`highlight.js\`=${count('highlight.js')}, \`name:"JavaScript"\`=${count('name:"JavaScript"')}, \`name:"Python"\`=${count('name:"Python"')}, \`name:"TypeScript"\`=${count('name:"TypeScript"')}). Grammar window ${HL_LO}–${HL_HI}. Absence of the language id next to those \`name:\` grammars is the removal signal. A global string can still be a MIME type or an unrelated substring.

${idLines}

Ids that hit as highlight.js language names in that window: none of mathematica, maxima, isbl, gml, 1c, sqf.

Global strings that are not language ids: \`mathematica\` is \`application/mathematica\` and \`application/vnd.wolfram.mathematica\` (MIME). \`gml\` substrings include \`spreadsheetml\`, a locale token \`.gml.\`, and \`text/vnd.gml\`. \`sqf\` raw hits are binary noise and an unrelated id \`sqfi+\`. \`ISBL\` only occurs inside \`ISBLANK\`. \`maxima\`, \`isbl\`, \`"1c"\`, \`"gml"\`, \`"sqf"\`, \`1C:Enterprise\`, \`GameMaker\`, and every \`name:"…"\` for the six languages are 0.

js grammar @${jsName.at} sha=${jsName.sha}

\`\`\`
${clip(jsName.text)}
\`\`\`
`

const out = join(__dir, 'gold-251-f.md')
writeFileSync(out, md)
console.log(`WROTE ${out} chars=${md.length}`)
for (const r of rows) console.log(r[0], r[1], r[3])
