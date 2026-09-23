/**
 * densable 2.1.251 SEA peel — PARTIAL CLI/bg/session missing callees.
 * #25 #27 #33 #34 #35 #36 #41 #42 #44 #51.
 * Invent-ban. Writes gold-251-k.md. Does not mark HAVE. Does not edit
 * checklist/board/product code.
 *
 * Method: allHits `function NAME` + lastFnStartGeneric from known caller
 * offsets. BODY or MISS per callee. Full body + sha.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_251,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const EXPECT = 217360032
const buf = loadSea()
if (buf.length !== EXPECT) throw new Error(`SEA bytes ${buf.length} != ${EXPECT}`)

function mustFn(anchor, maxLen = 12000) {
  const i = buf.indexOf(Buffer.from(anchor))
  if (i < 0) throw new Error(`MISS anchor ${anchor}`)
  const fn = extractFnAt(buf, i, maxLen)
  if (!fn.body) throw new Error(`missEnd ${anchor} @${i}`)
  const name =
    (asciiSlice(buf, i, i + 48).match(/function\s+([A-Za-z_$][\w$]*)/) ||
      [])[1] || '?'
  return { ...fn, name, anchor }
}

function mustMethod(anchor) {
  const i = buf.indexOf(Buffer.from(anchor))
  if (i < 0) throw new Error(`MISS method ${anchor}`)
  const win = asciiSlice(buf, i, i + 4000)
  const brace = win.indexOf('{')
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = brace; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length, name: 'rendersItalicAsStandout' }
      }
    }
  }
  throw new Error(`missEnd method ${anchor}`)
}

function sliceImport(at, before, after) {
  const startAbs = Math.max(0, at - before)
  const win = asciiSlice(buf, startAbs, at + after)
  const relAt = at - startAbs
  const start = win.lastIndexOf('import{', relAt)
  if (start < 0) throw new Error(`no import{ before ${at}: ${win.slice(0, 80)}`)
  const from = win.indexOf('}from"', start)
  if (from < 0) throw new Error(`no }from" after import near ${at}: ${win.slice(start, start + 120)}`)
  const q1 = win.indexOf('"', from)
  const q2 = win.indexOf('"', q1 + 1)
  const body = win.slice(start, q2 + 1)
  return { i: startAbs + start, body, sha: sha(body), len: body.length }
}

function callerLast(needle, expectName) {
  const hits = allHits(buf, needle)
  if (hits.length === 0) throw new Error(`MISS caller ${needle}`)
  const h = hits.find(i => i > 178000000) ?? hits[0]
  const fn = lastFnStartGeneric(buf, h, 16000)
  return { caller: h, hits: hits.length, ...fn, expectName }
}

const dpe = mustFn('async function dpe(e){let t=`${e}.superseded-${Date.now()}`', 2000)
const dollarY = mustFn('function $Y(e,t){if(!goe.has(e.toLowerCase()))', 800)
const fke = mustFn("function fke(e,t){let s=e.toLowerCase();if(!goe.has(s))", 2000)
const zS = mustFn('function zS(e){let t=zp(e);return Zv().find', 400)
const rNt = mustFn('function rNt(){zy().markOwnsControllingTerminal()}', 200)
const zy = mustFn('function zy(){return nNt.of(G().host)}', 200)
const und = mustFn('function _(e,u){s("tengu_feature_ok",{feature_name:c(e),...u})}', 200)
const gee = mustFn(
  'function g(e,u,r){s("tengu_feature_sad",{...r,feature_name:c(e),error_code:u})}',
  200,
)
const Jay = mustFn(
  'function J(n,t,i){let r=m();if(!r)return;let o;try{o=e(n,t,l(i))}',
  400,
)
const lr = mustFn(
  'function lr(e){if(e===null||typeof e!=="object")return{action:"drop"',
  4000,
)
const mbe = mustFn(
  'async function mbe(e,t){if(!e)return{resultType:"emptyPath"}',
  2000,
)
const gbe = mustFn('function gbe(e){switch(e.resultType){case"emptyPath"', 2000)
const zk = mustFn('function zk(n,e){return n instanceof Error&&n.message===e}', 200)
const ZW = mustFn('function ZW(r){let s=xt(),[P,a]=u(null)', 2000)
const jJn = mustFn(
  'function jJn(r){for(let i of r)if(i.endCode===h)return s_.rendersItalicAsStandout()',
  400,
)
const italic = mustMethod('rendersItalicAsStandout(){return(this.proc.env.TERM??"").startsWith("screen")}')
const awn = mustFn(
  'function awn(){if(!wl())return{subscriptionType:null,rateLimitTier:null}',
  600,
)
const Yp = mustFn(
  'function Yp(){if(ko()||a.CLAUDE_CODE_OAUTH_TOKEN||Cc())return!1;return!(D7()&&!M7())}',
  200,
)
const oc = mustFn('function oc(){return n().surfaceCapabilities.replBridgeActive()}', 200)
const nBug = mustFn(
  'async function n(o,a,e,m){return gRt(o,a,e,m==="share"?"/share":"/bug")}',
  200,
)
const gRt = mustFn(
  'async function gRt(m,s,f,p="/feedback"){let v=f?.trim()==="public"?"":f||"";return qe(m,s,v,p)}',
  300,
)
const qe = mustFn(
  'function qe(m,s,f,p){return wur(m,s.abortController.signal,s.messages,f,',
  400,
)
const wur = mustFn(
  'function wur(m,s,f,p="",v={},g,J="/feedback"){let K=Tie(J)',
  600,
)
const Tie = mustFn('function Tie(b="/feedback"){let P=TG(b);if(P!==null)return{kind:"disabled"', 600)
const uln = mustFn('function uln(){if(TG()!==null)return!1', 400)
const dKe = mustFn(
  'function dKe(e,t){let r=e?t[e]:void 0,o=Ld(r)?r:void 0,u=!o&&kr(r)?r:void 0',
  300,
)
const Ld = mustFn(
  'function Ld(e){return typeof e==="object"&&e!==null&&"type"in e&&e.type==="in_process_teammate"}',
  200,
)
const kr = mustFn(
  'function kr(e){return typeof e==="object"&&e!==null&&"type"in e&&e.type==="local_agent"}',
  200,
)
const Iln = mustFn(
  'function Iln({viewingAgentTaskId:e,tasks:t,transcripts:r,mainIsBusy:o,mainConversationId:u})',
  800,
)
const lutimes = sliceImport(buf.indexOf(Buffer.from('lutimes as DVt')), 280, 220)
const rename = lutimes
const importUnd = sliceImport(204640375, 20, 80)
const importJ = sliceImport(204640472, 20, 70)
if (!lutimes.body.includes('lutimes as DVt')) throw new Error(`bad DVt import ${lutimes.body}`)
if (!rename.body.includes('rename as HA')) throw new Error(`bad HA import ${rename.body}`)
if (!importUnd.body.includes('chunk-pp8hjrn6')) throw new Error(`bad _ import ${importUnd.body}`)
if (!importJ.body.includes('chunk-81n9r8qk')) throw new Error(`bad J import ${importJ.body}`)

if (dpe.i !== 184388254) throw new Error(`dpe @${dpe.i}`)
if (dollarY.i !== 187729104) throw new Error(`$Y @${dollarY.i}`)
if (rNt.i !== 184311051) throw new Error(`rNt @${rNt.i}`)
if (ZW.i !== 199184593) throw new Error(`ZW @${ZW.i}`)
if (jJn.i !== 183518215) throw new Error(`jJn @${jJn.i}`)
if (awn.i !== 181264770) throw new Error(`awn @${awn.i}`)
if (Yp.i !== 181264685) throw new Error(`Yp @${Yp.i}`)
if (oc.i !== 179077773) throw new Error(`oc @${oc.i}`)
if (dKe.i !== 187092580) throw new Error(`dKe @${dKe.i}`)
if (kr.i !== 185970495) throw new Error(`kr @${kr.i}`)
if (Ld.i !== 185963190) throw new Error(`Ld @${Ld.i}`)
if (Tie.i !== 191440771) throw new Error(`Tie @${Tie.i}`)
if (wur.i !== 210226865) throw new Error(`wur @${wur.i}`)

const dvtDecls = allHits(buf, 'function DVt(').length
const haDecls = allHits(buf, 'async function HA(').length
if (dvtDecls !== 0) throw new Error(`unexpected function DVt( hits ${dvtDecls}`)

const callers = {
  dpe: callerLast('existing destination set aside at', 'dpe'),
  dollarY: callerLast('$Y(ke,Pe)', 'qFe'),
  rNt: callerLast('rNt(),_("bg_worker_ctty")', 'uo'),
  ZW: callerLast('copiedVia:ft,copy:se}=ZW(', 'cp'),
  awn: callerLast('urr(awn())', 'So'),
  Yp: callerLast('if(!Yp())return null;switch(oEn()', 'oI'),
  oc: callerLast('return oc()||wt()||pie()!==void 0', 'f_'),
  nBug: callerLast('m==="share"?"/share":"/bug"', 'n'),
  dKe: callerLast('{teammate:n,localAgent:m}=dKe(s.viewingAgentTaskId', 'wCe'),
}

const restoreEnoent = asciiSlice(
  buf,
  buf.indexOf(Buffer.from('await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript: could not restore set-aside destination after ENOENT')),
  buf.indexOf(Buffer.from('await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript: could not restore set-aside destination after ENOENT')) + 280,
)
const restoreFailAt = (() => {
  const n = 'await HA(x,y).catch((pe)=>{n(`relocateSessionTranscript: could not restore set-aside destination after failed move'
  return buf.indexOf(Buffer.from(n))
})()
const restoreFail = asciiSlice(buf, restoreFailAt, restoreFailAt + 220)
const switchAt = buf.indexOf(Buffer.from('switch(J("info","bg_worker_ctty",{outcome:t}),t)'))
const switchWin = asciiSlice(buf, switchAt, switchAt + 340)
const addDirAt = buf.indexOf(Buffer.from('case"addDirectories":{let u=e.directories'))
const addDirWin = lr.body.slice(
  lr.body.indexOf('case"addDirectories"'),
  lr.body.indexOf('case"removeDirectories"'),
)

function block(fn, extra = '') {
  return [
    `### \`${fn.name}\` @${fn.i} sha=\`${fn.sha}\` len=${fn.len}${extra}`,
    '',
    '```',
    fn.body,
    '```',
    '',
  ].join('\n')
}

const lines = []
const log = s => lines.push(s)

log('# gold-251-k')
log('')
log(
  `densable 2.1.251 SEA \`claude.exe\` ${buf.length} bytes. Invent-ban. Missing callees for PARTIAL CLI/bg/session bullets. Not a HAVE mark.`,
)
log('')
log(
  'Method: `allHits("function NAME")` + `lastFnStartGeneric` from known caller offsets. **BODY** = closed function (or import alias when the name is `import {x as NAME}`). **MISS** = no `function NAME` and no import alias.',
)
log('')
log('| # | verdict | callees | note |')
log('| --- | --- | --- | --- |')
log(
  `| 25 | BODY | \`dpe\` \`${dpe.sha}\` len ${dpe.len}; \`DVt\` IMPORT lutimes; \`HA\` IMPORT rename | full dpe (gold-d excerpt started mid-fn). \`function DVt(\` hits ${dvtDecls}. restore is \`HA(aside, dest)\` in S0e |`,
)
log(
  `| 27 | BODY | \`$Y\` \`${dollarY.sha}\` len ${dollarY.len}; \`fke\` \`${fke.sha}\` len ${fke.len}; \`zS\` \`${zS.sha}\` len ${zS.len} | null = do not refuse. reserved name + bad source returns the refuse string |`,
)
log(
  `| 33 | BODY | \`rNt\` \`${rNt.sha}\` len ${rNt.len}; \`_\` \`${und.sha}\` len ${und.len}; \`g\` \`${gee.sha}\` len ${gee.len}; \`J\` \`${Jay.sha}\` len ${Jay.len} | uo chunk imports \`{_,f,g}\` and \`{J}\`. lastFn from switch is uo |`,
)
log(
  `| 34 | BODY | \`lr\` \`${lr.sha}\` len ${lr.len}; \`mbe\` \`${mbe.sha}\` len ${mbe.len}; \`gbe\` \`${gbe.sha}\` len ${gbe.len}; \`zk\` \`${zk.sha}\` len ${zk.len} | update-path is lr addDirectories. containsNullByte is mbe/gbe |`,
)
log(
  `| 35 | BODY | \`ZW\` \`${ZW.sha}\` len ${ZW.len} | copy-via detector. returns {copiedVia, copy, reset} |`,
)
log(
  `| 36 | BODY | \`jJn\` \`${jJn.sha}\` len ${jJn.len}; \`rendersItalicAsStandout\` \`${italic.sha}\` len ${italic.len} | gold-d excerpt already had both; isolated full bodies |`,
)
log(
  `| 41 | BODY | \`awn\` \`${awn.sha}\` len ${awn.len}; \`Yp\` \`${Yp.sha}\` len ${Yp.len} | awn reads token then Yp. no new fable dialog beyond gP |`,
)
log(
  `| 42 | BODY | \`oc\` \`${oc.sha}\` len ${oc.len} | \`n().surfaceCapabilities.replBridgeActive()\` |`,
)
log(
  `| 44 | BODY | \`n\` \`${nBug.sha}\` len ${nBug.len}; \`wur\` \`${wur.sha}\` len ${wur.len}; \`Tie\` \`${Tie.sha}\` len ${Tie.len} | n passes /bug into gRt→qe→wur→Tie→TG. no /feedback rename |`,
)
log(
  `| 51 | BODY | \`dKe\` \`${dKe.sha}\` len ${dKe.len}; \`kr\` \`${kr.sha}\` len ${kr.len}; \`Ld\` \`${Ld.sha}\` len ${Ld.len}; \`Iln\` \`${Iln.sha}\` len ${Iln.len} | localAgent is type local_agent; teammate is in_process_teammate |`,
)
log('')

log('## #25')
log('')
log(
  'same-ID transcript set-aside. gold-d excerpt of `dpe` started at `isRetentionExemptionDisabled`. Full `dpe` is 480 bytes. `DVt` / `HA` are not functions: `lutimes as DVt`, `rename as HA` from `fs/promises`. S0e restore is `await HA(x,y)` (aside → dest).',
)
log('')
log(
  `caller \`existing destination set aside at\` @${callers.dpe.caller} lastFn=\`${callers.dpe.name}\`@${callers.dpe.i}`,
)
log('')
log(block(dpe))
log('### `DVt` IMPORT (not `function DVt`)')
log('')
log('```')
log(lutimes.body)
log('```')
log('')
log(`sha=\`${lutimes.sha}\` @${lutimes.i} (\`function DVt(\` hits=${dvtDecls}, \`async function HA(\` hits=${haDecls})`)
log('')
log('### `HA` IMPORT + S0e restore')
log('')
log('```')
log(rename.body)
log('```')
log('')
log(`sha=\`${rename.sha}\` @${rename.i}`)
log('')
log('S0e ENOENT restore:')
log('')
log('```')
log(restoreEnoent)
log('```')
log('')
log('S0e failed-move restore:')
log('')
log('```')
log(restoreFail)
log('```')
log('')

log('## #27')
log('')
log(
  '`$Y` refuse-entry. qFe rereads when `Pe!==void 0 && $Y(ke,Pe)===null`. Null means do not refuse. A string is the refuse reason. `fke` is the reserved-source check `$Y` returns. Delays `_gr=[30,70,150]` stay in gold-d `qFe`.',
)
log('')
log(
  `caller \`$Y(ke,Pe)\` @${callers.dollarY.caller} lastFn=\`${callers.dollarY.name}\`@${callers.dollarY.i}`,
)
log('')
log(block(dollarY))
log(block(fke, ' ($Y callee)'))
log(block(zS, ' ($Y official installLocation)'))

log('## #33')
log('')
log(
  'outcome switch after `z()` / `L()` /dev/tty `login_tty`. lastFn from the switch is `uo`. `rNt` / `_` / `g` / `J` are not declared in that function; the uo chunk imports `{_,f,g}` and `{J}`.',
)
log('')
log(
  `caller \`rNt(),_("bg_worker_ctty")\` @${callers.rNt.caller} lastFn=\`${callers.rNt.name}\`@${callers.rNt.i}`,
)
log('')
log('switch @' + switchAt + ':')
log('')
log('```')
log(switchWin)
log('```')
log('')
log('uo-chunk imports @' + importUnd.i + ' / ' + importJ.i + ':')
log('')
log('```')
log(importUnd.body)
log(importJ.body)
log('```')
log('')
log(block(rNt))
log(block(zy, ' (rNt callee)'))
log(block(und))
log(block(gee))
log(block(Jay))

log('## #34')
log('')
log(
  'gold-d startup/settings parse already drops `\\0` additionalDirectories. The missing update-path is `lr` `case"addDirectories"` (`action:"drop"`). Workspace validate is `mbe` (`containsNullByte` via `zk(...,"Path contains null bytes")`). `gbe` is the user string.',
)
log('')
log(block(lr))
log('addDirectories arm:')
log('')
log('```')
log(addDirWin)
log('```')
log('')
log(block(mbe))
log(block(gbe))
log(block(zk, ' (mbe callee)'))

log('## #35')
log('')
log(
  '`ZW` is the copy-via detector. Menu `cL`/`uL` already in gold-d. `cp` does `{copiedVia:ft,copy:se}=ZW(gt)`.',
)
log('')
log(
  `caller \`copiedVia:ft,copy:se}=ZW(\` @${callers.ZW.caller} lastFn=\`${callers.ZW.name}\`@${callers.ZW.i}`,
)
log('')
log(block(ZW))

log('## #36')
log('')
log(
  'gold-d excerpt already showed both. Isolated full bodies. `jJn` strips italic-off SGR `\\x1B[23m` when `s_.rendersItalicAsStandout()`. That method is on `class u` @183516370, not `t8n`.',
)
log('')
log(block(jJn))
log(block(italic))

log('## #41')
log('')
log(
  '`urr`/`oEn` already in gold-e. `So` does `urr(awn())`. `oI`/`iI` start with `if(!Yp())`. `awn` returns token subscription/tier only when `wl()` and `Yp()`. No fable credit dialog beyond gold-e `gP`.',
)
log('')
log(
  `caller \`urr(awn())\` @${callers.awn.caller} lastFn=\`${callers.awn.name}\`@${callers.awn.i}`,
)
log('')
log(
  `caller \`if(!Yp())\` @${callers.Yp.caller} lastFn=\`${callers.Yp.name}\`@${callers.Yp.i}`,
)
log('')
log(block(awn))
log(block(Yp))

log('## #42')
log('')
log(
  '`f_` is `oc()||wt()||pie()!==void 0`. `wt`/`pie` already in gold-e. `oc` is REPL bridge active.',
)
log('')
log(
  `caller \`oc()||wt()\` @${callers.oc.caller} lastFn=\`${callers.oc.name}\`@${callers.oc.i}`,
)
log('')
log(block(oc))

log('## #44')
log('')
log(
  'gold-e `n` already passes `/share` or `/bug`. That is the /bug call site (`export{n as call}`). Chain: `n` → `gRt(p)` → `qe` → `wur(...,J)` → `Tie(J)` → `TG(b)`. `TG("/bug")` literal hits=0. No `/feedback` rename. `uln` still calls `TG()` with the default `/feedback`.',
)
log('')
log(
  `caller \`m==="share"?"/share":"/bug"\` @${callers.nBug.caller} lastFn=\`${callers.nBug.name}\`@${callers.nBug.i}`,
)
log('')
log(block(nBug))
log(block(gRt))
log(block(qe))
log(block(wur))
log(block(Tie))
log(block(uln, ' (TG() default; not /bug-specific)'))

log('## #51')
log('')
log(
  'gold-e `wCe`/`_Mn`/`Bpe` already branch on `localAgent`. The arm is `dKe`: teammate if `Ld` (`in_process_teammate`), else localAgent if `kr` (`local_agent`). `Iln` uses `d??y` for the viewed task.',
)
log('')
log(
  `caller \`dKe(s.viewingAgentTaskId,s.tasks)\` @${callers.dKe.caller} lastFn=\`${callers.dKe.name}\`@${callers.dKe.i}`,
)
log('')
log(block(dKe))
log(block(Ld, ' (teammate predicate)'))
log(block(kr, ' (localAgent predicate)'))
log(block(Iln))

const out = join(__dir, 'gold-251-k.md')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log('wrote', out)
console.log(
  JSON.stringify(
    {
      dpe: [dpe.i, dpe.sha, dpe.len],
      $Y: [dollarY.i, dollarY.sha, dollarY.len],
      rNt: [rNt.i, rNt.sha, rNt.len],
      _: [und.i, und.sha, und.len],
      g: [gee.i, gee.sha, gee.len],
      J: [Jay.i, Jay.sha, Jay.len],
      lr: [lr.i, lr.sha, lr.len],
      mbe: [mbe.i, mbe.sha, mbe.len],
      ZW: [ZW.i, ZW.sha, ZW.len],
      jJn: [jJn.i, jJn.sha, jJn.len],
      italic: [italic.i, italic.sha, italic.len],
      awn: [awn.i, awn.sha, awn.len],
      Yp: [Yp.i, Yp.sha, Yp.len],
      oc: [oc.i, oc.sha, oc.len],
      n: [nBug.i, nBug.sha, nBug.len],
      Tie: [Tie.i, Tie.sha, Tie.len],
      dKe: [dKe.i, dKe.sha, dKe.len],
      kr: [kr.i, kr.sha, kr.len],
    },
    null,
    2,
  ),
)
