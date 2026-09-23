/**
 * densable 2.1.251 SEA peel — missing callees for PARTIAL
 * #53 #55 #59 #60 #61 #62 #63 #67 (model/sandbox/analytics).
 * Writes gold-251-l.md. Does not touch src/, checklist, or the board.
 * Invent-ban. Not a HAVE mark.
 *
 * Method: allHits `function NAME` / `async function NAME` (drop the
 * substring hit inside `async function`). Nearest def to the gold
 * caller, including hoisted defs after the call. Assignments (NU, Rn,
 * Cn, bjn) use a brace/regex walker. Host-flag `return[]` uses
 * lastFnStartGeneric from each hit.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) {
  throw new Error(`unexpected SEA size ${buf.length}`)
}

const __dir = dirname(fileURLToPath(import.meta.url))

function hitsOf(needle) {
  return allHits(buf, needle)
}

function namedFnHits(name) {
  const raw = [
    ...hitsOf(`function ${name}(`),
    ...hitsOf(`async function ${name}(`),
  ]
  const uniq = [...new Set(raw)].sort((a, b) => a - b)
  return uniq.filter(
    i => !asciiSlice(buf, Math.max(0, i - 6), i).endsWith('async '),
  )
}

function fnStart(i) {
  const pre = asciiSlice(buf, Math.max(0, i - 6), i)
  return pre.endsWith('async ') ? i - 6 : i
}

function extractNamed(name, caller, maxLen = 20000) {
  const hs = namedFnHits(name)
  if (hs.length === 0) {
    return { name, miss: true, hits: 0, caller }
  }
  let best = hs[0]
  let bestAbs = Math.abs(hs[0] - caller)
  for (const h of hs) {
    const d = Math.abs(h - caller)
    if (d < bestAbs) {
      bestAbs = d
      best = h
    }
  }
  const start = fnStart(best)
  const ext = extractFnAt(buf, start, maxLen)
  if (!ext.body) {
    return {
      name,
      miss: true,
      hits: hs.length,
      at: start,
      dist: bestAbs,
      preview: ext.preview,
      caller,
    }
  }
  return {
    name,
    at: start,
    dist: bestAbs,
    hits: hs.length,
    body: ext.body,
    sha: ext.sha,
    len: ext.len,
    caller,
  }
}

function extractAssign(needle, nth = 0, maxLen = 8000) {
  const hs = hitsOf(needle)
  const i = hs[nth]
  if (i === undefined) return { needle, miss: true, hits: 0 }
  const win = asciiSlice(buf, i, i + maxLen)
  const eq = win.indexOf('=')
  if (eq < 0) return { needle, i, miss: true, hits: hs.length }
  let p = eq + 1
  const startChar = win[p]
  if (startChar === '/') {
    let esc = false
    for (let q = p + 1; q < win.length; q++) {
      const c = win[q]
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\') {
        esc = true
        continue
      }
      if (c === '/') {
        let r = q + 1
        while (r < win.length && /[gimsuy]/.test(win[r])) r++
        let body = win.slice(0, r)
        let at = i
        if (body.startsWith(',')) {
          body = body.slice(1)
          at = i + 1
        }
        return { needle, i: at, body, sha: sha(body), len: body.length, hits: hs.length }
      }
    }
    return { needle, i, miss: true, preview: win.slice(0, 200), hits: hs.length }
  }
  let depth = 0
  let inStr = null
  let esc = false
  for (let q = p; q < win.length; q++) {
    const c = win[q]
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
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (depth === 0 && (c === ';' || c === ',')) {
      let body = win.slice(0, q)
      let at = i
      if (body.startsWith(',')) {
        body = body.slice(1)
        at = i + 1
      }
      return { needle, i: at, body, sha: sha(body), len: body.length, hits: hs.length }
    }
  }
  return { needle, i, miss: true, preview: win.slice(0, 200), hits: hs.length }
}

function hostFlagEmpties() {
  const needle = 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return[]'
  const hs = hitsOf(needle)
  return hs.map(h => {
    const st = lastFnStartGeneric(buf, h + 1, 8000)
    const ext = st.i >= 0 ? extractFnAt(buf, st.i, 8000) : { miss: true }
    return {
      hit: h,
      name: st.name,
      at: st.i,
      body: ext.body,
      sha: ext.sha,
      len: ext.len,
    }
  })
}

const CALL = {
  Pbt: 180587897,
  Jbn: 180784878,
  tomb: 186913600,
  BZn: 187544776,
  rw: 180760796,
  RYe: 181265183,
  aw: 180769116,
  J: 181689542,
  Kh: 180677347,
  ign: 185402726,
  Tn: 179761036,
}

const NU = extractAssign(',NU=', 0, 400)
const ME = extractNamed('ME', CALL.Pbt, 2000)
const gl = extractNamed('gl', CALL.Pbt, 2000)
const CAt = extractNamed('CAt', CALL.tomb, 2000)
const bjn = extractAssign('var bjn=', 0, 200)
const x0e = extractNamed('x0e', CALL.tomb, 8000)
const OS = extractNamed('OS', CALL.tomb, 2000)
const qo = extractNamed('qo', CALL.tomb, 4000)
const AVt = extractNamed('AVt', CALL.BZn, 2000)
const wo = extractNamed('wo', CALL.rw, 20000)
const pbr = extractNamed('pbr', CALL.RYe, 2000)
const aw = extractNamed('aw', CALL.aw, 4000)
const G3 = extractNamed('G3', CALL.J, 2000)
const p5e = extractNamed('p5e', CALL.J, 2000)
const Ii = extractNamed('Ii', CALL.J, 4000)
const Zq = extractNamed('Zq', CALL.Kh, 2000)
const ign = extractNamed('ign', CALL.ign, 20000)
const Rn = extractAssign('var Rn=/', 0, 200)
const $Kt = extractNamed('$Kt', CALL.Tn, 4000)
const Cn = extractAssign(',Cn=/', 0, 2000)
const hostFns = hostFlagEmpties()

const zjeHit = hitsOf('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return;')[0]
const zjeSt = zjeHit
  ? lastFnStartGeneric(buf, zjeHit + 1, 8000)
  : { i: -1, name: '' }
const zje =
  zjeSt.i >= 0
    ? { ...extractFnAt(buf, zjeSt.i, 4000), name: zjeSt.name, at: zjeSt.i }
    : { miss: true }

function must(rec, label) {
  if (rec.miss || !rec.body) {
    throw new Error(`MISS ${label} ${JSON.stringify(rec)}`)
  }
  return rec
}

must(NU, 'NU')
must(ME, 'ME')
must(gl, 'gl')
must(CAt, 'CAt')
must(bjn, 'bjn')
must(x0e, 'x0e')
must(OS, 'OS')
must(qo, 'qo')
must(AVt, 'AVt')
must(wo, 'wo')
must(pbr, 'pbr')
must(aw, 'aw')
must(G3, 'G3')
must(p5e, 'p5e')
must(Ii, 'Ii')
must(Zq, 'Zq')
must(ign, 'ign')
must(Rn, 'Rn')
must($Kt, '$Kt')
must(Cn, 'Cn')

const S = hostFns.find(f => f.name === 'S')
const F = hostFns.find(f => f.name === 'F')
const R = hostFns.find(f => f.name === 'R')
const U = hostFns.find(f => f.name === 'U')
const B = hostFns.find(f => f.name === 'B')
if (!S || !F || !R || !U || !B) {
  throw new Error(`host-flag set incomplete ${hostFns.map(f => f.name)}`)
}

function row(num, name, rec, note) {
  const verdict = rec.miss || !rec.body ? 'MISS' : 'BODY'
  const at = rec.at ?? rec.i ?? ''
  const sh = rec.sha ?? ''
  return `| ${num} | \`${name}\` | ${verdict} | ${at} | ${sh} | ${note} |`
}

const table = [
  '| # | name | Verdict | @ | sha | Body |',
  '| --- | --- | --- | --- | --- | --- |',
  row('53', 'NU', NU, 'firstParty id → catalog key; Jbn treats hasOwn as alias'),
  row('53', 'ME', ME, 'AWS region via host or shared-config; Pbt awaits then gl()'),
  row('53', 'gl', gl, 'fire-and-forget ef() after KFe/bedrock gate; no host-flag skip'),
  row('53', 'S', S, 'already gold-251-e; bedrock upgrade return[] on host flag'),
  row('53', 'F', F, 'already gold-251-e; bedrock fallback return[] on host flag'),
  row('53', 'R', R, 'vertex upgrade return[] on host flag'),
  row('53', 'U', U, 'vertex fallback return[] on host flag'),
  row('53', 'B', B, 'mantle default/fallback return[] on host flag'),
  row('53', 'zje', zje, 'host flag returns undefined, not []'),
  row('55', 'CAt', CAt, 'last assistant text vs bjn leaked-invoke regex; no 3P branch'),
  row('55', 'bjn', bjn, 'CAt predicate <antml:invoke\\\\b'),
  row('55', 'x0e', x0e, 'StopFailure hook after exhausted tombstone; no 3P branch'),
  row('55', 'OS', OS, 'repl_main_thread markApiFailure; no 3P branch'),
  row(
    '55',
    'qo',
    qo,
    'exhausted system/api-error message factory; no 3P branch',
  ),
  row('59', 'AVt', AVt, 'Claude ${VP(id)} or Claude (${id})'),
  row('60', 'wo', wo, 'available-models state refused/inactive/active'),
  row('60', 'pbr', pbr, 'Dn()?.seatTier ?? null'),
  row('60', 'aw', aw, 'full; bedrock/vertex only when Ne() is those strings'),
  row('61', 'G3', G3, 'low|medium|high|xhigh else undefined; no max'),
  row('61', 'p5e', p5e, 'canonical model key fn(Xe(Mt(e),{deterministic:!0}))'),
  row('61', 'Ii', Ii, 'enabled settings sources + flagSettings + policySettings'),
  row('62', 'Zq', Zq, 'complete; !firstParty unless PROVIDER_MANAGED_BY_HOST'),
  row('63', 'ign', ign, 'complete REST footer fetch; gold-251-f was clipped'),
  row('67', 'Rn', Rn, 'header-name token grammar'),
  row('67', '$Kt', $Kt, 'header-value line_break/nul/non_ascii or null'),
  row('67', 'Cn', Cn, 'sensitive header-name regex; complete'),
].join('\n')

function block(title, rec) {
  const at = rec.at ?? rec.i
  return `### \`${title}\` @${at} sha=\`${rec.sha}\` len=${rec.len}

\`\`\`
${rec.body}
\`\`\`
`
}

const md = `# gold-251-l

Official densable 2.1.251 win32-x64 SEA \`claude.exe\` ${buf.length} bytes. Invent-ban. Not a HAVE mark. Missing callees for PARTIAL #53 #55 #59 #60 #61 #62 #63 #67. Pbt/S/F, BZn, Xbt/RYe/aw/bl/xt/rw, J/K, Kh, n$t/wtt/Kfn, zNe/Tn already in gold-251-e / gold-251-f.

Method: \`allHits\` \`function NAME(\` + \`async function NAME(\` (drop the \`async \` substring hit). Nearest def to the gold caller offset, including hoisted defs after the call. NU/Rn/Cn/bjn are assignments (brace/regex walker). Host-flag \`return[]\` uses \`lastFnStartGeneric\` from each hit. sha is sha256/16 of the printed body. BODY or MISS. Full body, no clip.

${table}

## #53 NU, ME, gl + host-flag empty returns

Gold: \`Jbn\` \`Object.hasOwn(NU,t)\` @${CALL.Jbn}. \`Pbt\` \`await ME(),gl();return\` @${CALL.Pbt}. \`S\`/\`F\` already gold-251-e. Extra \`return[]\` on the host flag: vertex \`R\`/\`U\`, mantle \`B\`. \`zje\` returns undefined on the host flag, not \`[]\`. \`gl\` itself has no host-flag skip (it still calls \`ef()\`).

${block('NU', NU)}
${block('ME', ME)}
${block('gl', gl)}
${block('R', R)}
${block('U', U)}
${block('B', B)}
${block('zje', zje)}

## #55 CAt, x0e, OS, qo

Gold excerpt @${CALL.tomb} names \`CAt(Cr)\`, \`qo({content,now,uuid})\`, \`x0e(Li,ct)\`, \`OS(ct,A,Li)\`. None of these four bodies mention Bedrock, Vertex, or Foundry.

${block('CAt', CAt)}
${block('bjn', bjn)}
${block('x0e', x0e)}
${block('OS', OS)}
${block('qo', qo)}

## #59 AVt

Gold \`BZn\` @${CALL.BZn}: known catalog id → \`AVt(e)\`; else \`ZO\` → \`Claude\` / leftover → \`Claude Code\`.

${block('AVt', AVt)}

## #60 wo, pbr, aw

Gold \`rw\` @${CALL.rw} reads \`wo().state!=="inactive"\`. Gold \`RYe\` @${CALL.RYe} reads \`pbr()==="enterprise_usage_based"\`. \`aw\` @${CALL.aw} was already complete in gold-251-f (len=410); reprinted. The Bedrock/Vertex arm is only \`if(e==="bedrock"||e==="vertex")\` inside this body.

${block('wo', wo)}
${block('pbr', pbr)}
${block('aw', aw)}

## #61 G3, p5e, Ii

Gold \`J\` @${CALL.J} / \`K\`: \`p5e\` canonicalizes the model key; \`G3\` filters effort tokens; \`Ii()\` is the settings-source list mapped through \`_e\`.

${block('G3', G3)}
${block('p5e', p5e)}
${block('Ii', Ii)}

## #62 Zq

Gold \`Kh\` @${CALL.Kh}: \`Zq()||gi()!==null||bW()||e2()\`. \`Zq\` in gold-251-f was already the full 77-byte body. Reprinted.

${block('Zq', Zq)}

## #63 ign

Gold-251-f sketched \`n$t\`/\`wtt\`/\`Kfn\` and clipped \`ign\` (1023 chars omitted). Full \`ign\` @${CALL.ign} below.

${block('ign', ign)}

## #67 Rn, $Kt, Cn

Gold \`Tn\` @${CALL.Tn}: \`!Rn.test(s)||$Kt(...)!==null||Cn.test(s.toLowerCase())\`. \`zNe\`/\`Tn\` already gold-251-f.

${block('Rn', Rn)}
${block('$Kt', $Kt)}
${block('Cn', Cn)}
`

const out = join(__dir, 'gold-251-l.md')
writeFileSync(out, md)
console.log(`WROTE ${out} chars=${md.length}`)
for (const rec of [
  NU,
  ME,
  gl,
  CAt,
  bjn,
  x0e,
  OS,
  qo,
  AVt,
  wo,
  pbr,
  aw,
  G3,
  p5e,
  Ii,
  Zq,
  ign,
  Rn,
  $Kt,
  Cn,
  R,
  U,
  B,
  zje,
]) {
  console.log(
    (rec.name || rec.needle || '?').padEnd(8),
    rec.at ?? rec.i,
    rec.sha,
    rec.len,
  )
}
