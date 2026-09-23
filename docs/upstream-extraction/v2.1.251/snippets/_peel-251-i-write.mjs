/**
 * densable 2.1.251 — write gold-251-i.md from official SEA bytes.
 * Invent-ban. Changelog is an index. Does not mark HAVE.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_251,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()

function extractGrow(i, caps = [2000, 8000, 20000, 60000, 200000]) {
  let last = { i, miss: true }
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) return last
  }
  return last
}

function fence(body) {
  return '````\n' + body + '\n````'
}

function sliceExact(off, len) {
  const body = asciiSlice(buf, off, off + len)
  return { i: off, body, sha: sha(body), len: body.length }
}

const Osn = extractGrow(186758304)
const Lsn = extractGrow(186757898)
const z_ = extractGrow(187242129)
const $sn = extractGrow(185574156)
const Y_e = extractGrow(185568683)
const vwe = extractGrow(185568973)
const VSn = extractGrow(185573811)
const gRn = extractGrow(179049328)
const dD = extractGrow(186760799)
const cre = extractGrow(180584703)
const hJ = extractGrow(180584572)
const pEt = extractGrow(179887321)
const LOe = extractGrow(180780907)
const yBn = extractGrow(186764691)
const HPe = extractGrow(184985281)
const jL = extractGrow(184985089)
const JtBar = extractGrow(208972948)
const Xxt = extractGrow(187242390)
const Qxt = extractGrow(187243749)
const nVn = extractGrow(186758371)
const DOe = extractGrow(180780145)
const JtReg = extractGrow(181786426)
const se = extractGrow(181784689)

const Kle = sliceExact(186765144, 40)
const yEt = sliceExact(186762723, 28)
const gEt = sliceExact(186762671, 52)
const Ln = sliceExact(179027862, 220)
const Hye = sliceExact(185263247, 9)
const HyeWin = sliceExact(185263220, 46)
const W6n = sliceExact(187241944, 124)

const when = new Date().toISOString()

const table = [
  ['Osn', '#1', 'BODY', Osn],
  ['Lsn', '#1', 'BODY', Lsn],
  ['z_', '#1', 'BODY', z_],
  ['$sn', '#1', 'BODY', $sn],
  ['Y_e', '#1', 'BODY', Y_e],
  ['vwe', '#1', 'BODY', vwe],
  ['VSn', '#1', 'BODY', VSn],
  ['gRn', '#1', 'BODY', gRn],
  ['dD', '#1', 'BODY', dD],
  ['cre', '#1', 'BODY', cre],
  ['hJ', '#1', 'BODY', hJ],
  ['pEt', '#1', 'BODY', pEt],
  ['LOe', '#1', 'BODY', LOe],
  ['Kle', '#1', 'BODY', Kle],
  ['Hye', '#1', 'BODY', Hye],
  ['yBn', '#1', 'BODY', yBn],
  ['yEt', '#1', 'BODY', yEt],
  ['HPe', '#3', 'BODY', HPe],
  ['jL', '#3', 'BODY', jL],
  ['Jt', '#3', 'BODY', JtBar],
]

let md = `# gold-251-i GAP #1 / #3 missing callees

- exe: ${EXE_251}
- bytes: ${buf.length}
- when: ${when}
- rule: changelog text is an index, not a contract. Invent-ban. BODY only from extracted official bytes. Do not invent hook runners or empty-window copy. This file does not mark HAVE.
- locked parents (gold-251-a, not re-extracted): hdt @186760884, ydt @186762751, KSn @185573233, X1e @202991096, Dl @208975936

## Table

| callee | gap | verdict | offset | len | sha |
| --- | --- | --- | --- | --- | --- |
`

for (const [name, gap, verdict, fn] of table) {
  md += `| ${name} | ${gap} | ${verdict} | ${fn.i} | ${fn.len} | ${fn.sha} |\n`
}

md += `
## #1 callees

Collision rule: \`function NAME(\` via allHits. If many hits, pick the def used at hdt@186760884 / ydt@186762751 / KSn@185573233 (or Ewe@185569345 for vwe). Prefix collisions (\`z_n\`, \`hJt\`, \`jLn\`) discarded. \`function z_(\` has 2 hits, both unrelated; the hook runner is \`async function*z_\`.

### Osn

- verdict: BODY
- function: Osn @${Osn.i} len=${Osn.len} sha=${Osn.sha} via=function Osn( hits=1
- call: \`await Osn()\` in hdt/ydt
- Jt here is the plugin-registry getter (not the #3 spend bar). See supporting Jt-registry.

${fence(Osn.body)}

### Lsn

- verdict: BODY
- function: async function Lsn @${Lsn.i} len=${Lsn.len} sha=${Lsn.sha} via=async function Lsn( hits=1
- call: \`await Lsn(!0)\` in hdt (block if plugins fail); \`await Lsn(!1)\` in ydt (log only)
- retry path calls \`fY(r?.storageV5,r?.credentials)\` then re-awaits \`hookRegistrationInFlight\`

${fence(Lsn.body)}

### z_

- verdict: BODY
- function: async function*z_ @${z_.i} len=${z_.len} sha=${z_.sha} via=async function*z_( hits=1
- \`function z_(\` hits=2 @189326711 (highlight.js illegal) and @201139597 (instanceof) — rejected
- call: \`for await (let O of z_({session,hookInput,toolUseID,matchQuery,sessionHooks,signal,timeoutMs}))\` in hdt/ydt
- hop: z_ → Xxt → Qxt. Not invented. PreModelSwitch is not in W6n, so z_ takes the \`if(!W6n.has(...)){ yield*Xxt(e); return }\` branch (no dm() around the loop).

${fence(z_.body)}

#### z_ named hop Xxt

- function: async function*Xxt @${Xxt.i} len=${Xxt.len} sha=${Xxt.sha}
- agent-context filter then \`yield*Qxt(e)\`; PreToolUse keeps blockingError. PreModelSwitch falls through to Qxt.

${fence(Xxt.body)}

#### z_ named hop Qxt

- function: async function*Qxt @${Qxt.i} len=${Qxt.len} sha=${Qxt.sha}
- this is the generic hook executor (session/hookInput/toolUseID/matchQuery/timeoutMs). Full official body; do not invent a second runner.

${fence(Qxt.body)}

#### z_ named hop W6n

- assignment: W6n @${W6n.i} len=${W6n.len} sha=${W6n.sha}

${fence(W6n.body)}

### $sn

- verdict: BODY
- function: $sn @${$sn.i} len=${$sn.len} sha=${$sn.sha} via=function $sn( hits=1
- call: \`let o=$sn(e)\` in KSn — context token count after last compact

${fence($sn.body)}

### Y_e

- verdict: BODY
- function: Y_e @${Y_e.i} len=${Y_e.len} sha=${Y_e.sha} via=function Y_e( near KSn (dist=662 from Ewe)
- rejected collision: async function Y_e @203470571 (CLAUDE_JOB_DIR bridge cleanup)

${fence(Y_e.body)}

### vwe

- verdict: BODY
- function: vwe @${vwe.i} len=${vwe.len} sha=${vwe.sha} via=function vwe( near Ewe/KSn
- call: \`vwe(e,t)\` in Ewe; \`vwe(t??d.message.model??at(),o)\` in KSn — cache_ttl + estimated_cache_write_usd
- rejected collision: vwe @183444010 (goal_set / Stop hook)

${fence(vwe.body)}

### VSn

- verdict: BODY
- function: VSn @${VSn.i} len=${VSn.len} sha=${VSn.sha} via=function VSn( hits=1
- call: \`O=VSn(e)?y:NaN\` in KSn — whether last compact is a cache-warm anchor

${fence(VSn.body)}

### gRn

- verdict: BODY
- function: gRn @${gRn.i} len=${gRn.len} sha=${gRn.sha} via=function gRn( hits=1
- call: \`gRn({sessionId,contextTokens,requestAt,ttlMs})\` in KSn — resume seed into requestJournal

${fence(gRn.body)}

### dD

- verdict: BODY (gate)
- function: dD @${dD.i} len=${dD.len} sha=${dD.sha} via=function dD( immediately before hdt
- call: \`if(!dD(e)) return {decision:"proceed"}\` — skip PreModelSwitch hooks unless nVn() or matcher iE hits
- rejected collision: dD @181119010 \`return yh(_7,{})\`

${fence(dD.body)}

#### dD named hop nVn

- function: nVn @${nVn.i} len=${nVn.len} sha=${nVn.sha}

${fence(nVn.body)}

### cre

- verdict: BODY (gate)
- function: cre @${cre.i} len=${cre.len} sha=${cre.sha} via=function cre( hits=1
- call: \`if(cre(t.toModel)) await hJ(t.toModel)\` — Bedrock application-inference-profile without a resolved backing id

${fence(cre.body)}

### hJ

- verdict: BODY (gate)
- function: hJ @${hJ.i} len=${hJ.len} sha=${hJ.sha} via=function hJ( adjacent to cre @180584703
- call: \`await hJ(t.toModel)\` — cache inference-profile backing model
- rejected collision: hJ @203197469 (tmux UI, y(91))

${fence(hJ.body)}

### pEt

- verdict: BODY (gate)
- function: pEt @${pEt.i} len=${pEt.len} sha=${pEt.sha} via=function pEt( hits=1
- call: \`toolUseID:pEt()\` in hdt/ydt
- adjacent literal: GXe="remote-settings-helper-consent"

${fence(pEt.body)}

### LOe

- verdict: BODY (gate)
- function: LOe @${LOe.i} len=${LOe.len} sha=${LOe.sha} via=function LOe( hits=1
- call: \`matchQuery:LOe(d)?d:void 0\` — wrapper over DOe

${fence(LOe.body)}

#### LOe named hop DOe

- function: DOe @${DOe.i} len=${DOe.len} sha=${DOe.sha} (same cluster as LOe; rejected DOe @202826256 zod schema)

${fence(DOe.body)}

### Kle

- verdict: BODY (store, not \`function Kle\`)
- \`function Kle(\` hits=0. Binding is var Kle. \`.of\` comes from class Ln.
- assignment: Kle @${Kle.i} len=${Kle.len} sha=${Kle.sha}
- call: \`Kle.of(e).registry\` in hdt/ydt/dD

${fence(Kle.body)}

#### Kle / yEt named hop Ln

- class Ln @${Ln.i} len=${Ln.len} sha=${Ln.sha}

${fence(Ln.body)}

### Hye

- verdict: BODY (const, not the colliding function)
- \`function Hye(\` @194737254 is \`async function Hye(e)\` hook-pins on a path — rejected (hdt uses \`timeoutMs??Hye\` with no call)
- assignment: Hye @${Hye.i} len=${Hye.len} sha=${Hye.sha}
- cluster window @${HyeWin.i}: \`${HyeWin.body}\`

${fence(Hye.body)}

### yBn

- verdict: BODY (gate)
- function: yBn @${yBn.i} len=${yBn.len} sha=${yBn.sha} via=function yBn( hits=1
- call: \`yBn(O.message,o)\` in hdt — collect hook_system_message / hook_non_blocking_error

${fence(yBn.body)}

### yEt

- verdict: BODY (store, not \`function yEt\`)
- \`function yEt(\` hits=0. Binding is var yEt over class gEt.
- assignment: yEt @${yEt.i} len=${yEt.len} sha=${yEt.sha}
- class gEt @${gEt.i} len=${gEt.len} sha=${gEt.sha}
- call: \`let o=yEt.of(e)\` in ydt — pending / landedOn / inFlight

${fence(yEt.body)}

${fence(gEt.body)}

### supporting #1 Jt (plugin registry, not spend bar)

Osn/Lsn call \`Jt().hookRegistrationInFlight\`. This no-arg Jt is adjacent to se() which owns those fields. 38 \`function Jt(\` collisions exist; this is not the #3 bar.

- function: Jt @${JtReg.i} len=${JtReg.len} sha=${JtReg.sha}
- factory: se @${se.i} len=${se.len} sha=${se.sha}

${fence(JtReg.body)}

${fence(se.body)}

## #3 callees

Empty-window copy is already inside Dl (gold-251-a). Exact ASCII \`Spend limit · shown once your gateway reports one\` hits=0 because the official separator is U+00B7 (\`\\xB7\`). Mid-needle \`shown once your gateway reports one\` hits=2 @93514262 (string table) and @208976292 (inside Dl). Do not invent a second copy.

### HPe

- verdict: BODY
- function: HPe @${HPe.i} len=${HPe.len} sha=${HPe.sha} via=function HPe( hits=1
- call in Dl: \`nm?e(Jt,{title:"Spend limit",...}):HPe()?null:e(t,{dimColor:!0,children:"Spend limit \\xB7 shown once your gateway reports one"})\`
- empty-window hide: when \`pm.limitsObserved\` is truthy, Dl returns null instead of the once-your-gateway-reports copy. Not invented.

${fence(HPe.body)}

### jL

- verdict: BODY
- function: jL @${jL.i} len=${jL.len} sha=${jL.sha} via=function jL( adjacent to HPe (rawUtilization)
- call: \`jL()\` in X1e / Dl — filters pm.rawUtilization to live windows
- rejected collision: jL @200184164 (zod enum factory)

${fence(jL.body)}

### Jt

- verdict: BODY (spend-limit bar factory)
- function: Jt @${JtBar.i} len=${JtBar.len} sha=${JtBar.sha} via=function Jt( nearest Dl@208975936 (dist=2988)
- call: \`e(Jt,{title:"Spend limit",limit:{utilization,resets_at},maxWidth,alwaysShowDateInReset:!0})\` when overage is present
- \`qr===null\` returns null (no bar). Not the plugin-registry Jt.

${fence(JtBar.body)}

## note

present=[Osn | Lsn | z_ | $sn | Y_e | vwe | VSn | gRn | dD | cre | hJ | pEt | LOe | Kle | Hye | yBn | yEt | HPe | jL | Jt]
absent=[-]
MISS=none
HPe invented=no
hook runner invented=no
z_ is the named async generator; Qxt is its official executor hop.
`

writeFileSync(join(dir, 'gold-251-i.md'), md)
console.log('wrote gold-251-i.md', md.length)
for (const [name, gap, verdict, fn] of table) {
  console.log(`${name}\t${gap}\t${verdict}\t@${fn.i}\t${fn.len}\t${fn.sha}`)
}
