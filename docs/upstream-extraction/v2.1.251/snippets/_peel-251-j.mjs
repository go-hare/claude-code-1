/**
 * densable 2.1.251 SEA peel — missing callees for PARTIAL #2 #4 #6 #9 #10 #16 #18.
 * Writes gold-251-j.md only. Invent-ban. No checklist/board/product edits.
 *
 * Method: start from locked caller, allHits `function NAME`, pick nearest
 * declaration, extractFnAt. BODY only with a full extracted body. MISS if
 * the named function or the requested loop is absent.
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

const EXPECT = 217360032
const buf = loadSea()
if (buf.length !== EXPECT) throw new Error(`SEA bytes ${buf.length} != ${EXPECT}`)

const dir = dirname(fileURLToPath(import.meta.url))
const OUT = join(dir, 'gold-251-j.md')

const CALLERS = {
  san: 185859343,
  Ce: 201165125,
  oqe: 202996715,
  whn: 185429010,
  UWt: 182185287,
  DH: 182187516,
  Rst: 193380425,
  htn: 193380194,
  E2t: 183343478,
  lyrHint: 181659488,
  iJt: 190710208,
  Qan: 186055955,
}

function extractGrow(i, maxLen = 80000) {
  const caps = [4000, 12000, 40000, maxLen]
  let last = { i, missEnd: true }
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) return last
  }
  return last
}

function declHits(name) {
  const needles = [
    `function ${name}(`,
    `function*${name}(`,
    `function* ${name}(`,
    `async function ${name}(`,
  ]
  const hits = []
  const seen = new Set()
  for (const n of needles) {
    for (const h of allHits(buf, n)) {
      if (seen.has(h)) continue
      seen.add(h)
      hits.push({ h, needle: n })
    }
  }
  hits.sort((a, b) => a.h - b.h)
  return hits
}

function nearestDecl(name, near, maxDist = 2_000_000) {
  const hits = declHits(name)
  if (!hits.length) return { name, miss: true, hits: 0 }
  let best = hits[0]
  let bestDist = Math.abs(hits[0].h - near)
  for (const row of hits) {
    const d = Math.abs(row.h - near)
    if (d < bestDist) {
      best = row
      bestDist = d
    }
  }
  if (bestDist > maxDist) {
    return {
      name,
      miss: true,
      hits: hits.length,
      first: hits.slice(0, 8).map((r) => r.h),
      nearest: best.h,
      dist: bestDist,
      reason: `nearest decl ${bestDist} > ${maxDist}`,
    }
  }
  const ex = extractGrow(best.h)
  if (!ex.body) {
    return {
      name,
      miss: true,
      hits: hits.length,
      at: best.h,
      dist: bestDist,
      reason: 'extractFnAt missEnd',
      preview: ex.preview,
    }
  }
  return {
    name,
    miss: false,
    hits: hits.length,
    at: best.h,
    dist: bestDist,
    needle: best.needle,
    body: ex.body,
    sha: ex.sha,
    len: ex.len,
    first: hits.slice(0, 8).map((r) => r.h),
  }
}

function encloseHit(hit) {
  const st = lastFnStartGeneric(buf, hit + 1, 16000)
  if (st.i < 0) return null
  const ex = extractGrow(st.i)
  if (!ex.body) return null
  if (hit < st.i || hit >= st.i + ex.body.length) return null
  return { name: st.name, at: st.i, body: ex.body, sha: ex.sha, len: ex.len }
}

function hasProcFd(body) {
  return (
    typeof body === 'string' &&
    (body.includes('/proc/self/fd') || body.includes('/proc/${process.pid}/fd'))
  )
}

function ancestorWalkOfFd(body) {
  if (!hasProcFd(body)) return false
  // A loop that walks parents of an fd path (L(N), dirname, ao(...) of fd).
  const fdish =
    body.includes('`/proc/self/fd/${') ||
    body.includes('"/proc/self/fd/"') ||
    body.includes("'/proc/self/fd/'") ||
    body.includes('`/proc/${process.pid}/fd/${')
  if (!fdish) return false
  const walksParents =
    /for\s*\([^)]*(?:ao\(|L\(|dirname)/.test(body) ||
    /for\s*\(;;/.test(body) ||
    /for\s*\([^;]*;\s*[^;]*;\s*(?:N|p|A|f)=L\(/.test(body)
  return walksParents && fdish
}

function fence(text) {
  let n = 3
  while (text.includes('`'.repeat(n))) n++
  const f = '`'.repeat(n)
  return `${f}\n${text}\n${f}`
}

function clip(body, cap = 8000) {
  if (!body) return ''
  if (body.length <= cap) return body
  return `${body.slice(0, cap)}\n… (${body.length - cap} chars omitted; fullLen=${body.length})`
}

function renderFn(row, cap = 8000) {
  if (row.miss) {
    return [
      `### \`${row.name}\` — MISS`,
      '',
      `- hits=${row.hits ?? 0}${row.at != null ? ` nearest@${row.at}` : ''}${row.dist != null ? ` dist=${row.dist}` : ''}${row.reason ? ` reason=${row.reason}` : ''}`,
      row.first ? `- first=${row.first.join(',')}` : '',
      row.preview ? fence(row.preview) : '',
      '',
    ]
      .filter((x) => x !== '')
      .join('\n')
  }
  return [
    `### \`${row.name}\` — BODY`,
    '',
    `- offset=${row.at} len=${row.len} sha=${row.sha} distFromCaller=${row.dist} declHits=${row.hits} via=${row.needle}`,
    `- firstDecls=${(row.first || []).join(',')}`,
    '',
    fence(clip(row.body, cap)),
    '',
  ].join('\n')
}

const lines = []
const table = []
const say = (s = '') => lines.push(s)

say('# gold-251-j missing pieces #2 #4 #6 #9 #10 #16 #18')
say('')
say(`- exe: ${EXE_251}`)
say(`- bytes: ${buf.length}`)
say(`- when: ${new Date().toISOString()}`)
say(
  '- rule: changelog is an INDEX. Extract ONLY missing callees/branches named from locked gold-251-a/b/c. BODY = full extracted JS function. MISS = name or requested loop absent. Do not invent `/proc/self/fd` ancestor walk.',
)
say(
  '- method: `allHits("function NAME")` + `extractFnAt` at the declaration nearest the locked caller. sha is sha256/16 of the full body.',
)
say('')

// ---------------------------------------------------------------------------
// #2
// ---------------------------------------------------------------------------
say('## #2 san expanders + system frames + foreground tool-frame writer')
say('')
say(
  'Locked callers: `san` @185859343 (vp/tX/IN/MLe/K/rbe), `Ce` @201165125 (j8t/jUe). Phrase "foreground subagent" may be absent.',
)
say('')

const n2 = {}
for (const [name, near] of [
  ['vp', CALLERS.san],
  ['tX', CALLERS.san],
  ['IN', CALLERS.san],
  ['MLe', CALLERS.san],
  ['K', CALLERS.san],
  ['rbe', CALLERS.san],
  ['j8t', CALLERS.Ce],
  ['jUe', CALLERS.Ce],
]) {
  n2[name] = nearestDecl(name, near, name === 'K' ? 80000 : 2_000_000)
  say(renderFn(n2[name], 6000))
}

// Any function that writes tool frames for a FOREGROUND subagent.
const fgNeedles = [
  'foreground subagent',
  'foregroundSubagent',
  'forwardText',
  'writeSdkMessages',
  'parent_tool_use_id!=null',
]
say('### foreground tool-frame writer hunt')
say('')
for (const n of fgNeedles) {
  const hits = allHits(buf, n)
  say(`- \`${n}\` hits=${hits.length} first=${hits.slice(0, 6).join(',') || '-'}`)
}

const fgWriterHits = allHits(buf, 'writeSdkMessages')
const fgWriters = []
const seenWriter = new Set()
for (const h of fgWriterHits) {
  const enc = encloseHit(h)
  if (!enc || seenWriter.has(enc.at)) continue
  seenWriter.add(enc.at)
  const toolish =
    enc.body.includes('parent_tool_use_id') ||
    enc.body.includes('tool_result') ||
    enc.body.includes('tool_use')
  if (!toolish) continue
  fgWriters.push(enc)
}
say('')
say(`writeSdkMessages enclosing fns with tool-frame needles: ${fgWriters.length}`)
say('')
for (const w of fgWriters.slice(0, 8)) {
  say(
    `- \`${w.name}\` @${w.at} len=${w.len} sha=${w.sha} parent_tool_use_id=${w.body.includes('parent_tool_use_id')} writeSdkMessages=${w.body.includes('writeSdkMessages')}`,
  )
  say(fence(clip(w.body, 2500)))
  say('')
}

const n2bodies = Object.values(n2).filter((r) => !r.miss)
const n2miss = Object.values(n2).filter((r) => r.miss)
const fgPhrase = allHits(buf, 'foreground subagent').length
const n2verdict =
  n2bodies.length >= 6 && (fgWriters.length > 0 || n2.jUe || n2.j8t)
    ? 'BODY'
    : n2bodies.length
      ? 'BODY'
      : 'MISS'
say(`**#2 verdict:** ${n2verdict}`)
say(
  `extracted=${n2bodies.map((r) => `${r.name}@${r.at}`).join(', ') || '-'} miss=${n2miss.map((r) => r.name).join(', ') || '-'} foreground-subagent-phrase-hits=${fgPhrase} writers=${fgWriters.map((w) => `${w.name}@${w.at}`).join(', ') || '-'}`,
)
say('')
table.push({
  n: 2,
  verdict: n2verdict,
  names: [...n2bodies.map((r) => r.name), ...fgWriters.map((w) => w.name)],
  miss: n2miss.map((r) => r.name),
})

// ---------------------------------------------------------------------------
// #4
// ---------------------------------------------------------------------------
say('## #4 live session cache tracker (not oqe/whn projection)')
say('')
say('Locked projectors: `oqe` @202996715 calls `c$t`/`u$t`; `whn` @185429010 same.')
say('')

const n4 = {}
for (const [name, near] of [
  ['c$t', CALLERS.oqe],
  ['u$t', CALLERS.oqe],
]) {
  n4[name] = nearestDecl(name, near)
  say(renderFn(n4[name], 8000))
}

// Hunt writers that accumulate hit/miss/re-cache, near c$t / oqe / whn.
const trackerNeedles = [
  'cacheWriteTokens',
  'missRecacheTokens',
  'cachingObserved',
  'expectedRebuilds',
  'hitRatio',
  'gRn(',
]
say('### tracker accumulate hunt')
say('')
const n4writers = []
const seenAcc = new Set()
for (const n of trackerNeedles) {
  const hits = allHits(buf, n)
  say(`- \`${n}\` hits=${hits.length} first=${hits.slice(0, 8).join(',') || '-'}`)
  for (const h of hits.slice(0, 20)) {
    const enc = encloseHit(h)
    if (!enc || seenAcc.has(enc.at)) continue
    if (enc.name === 'oqe' || enc.name === 'whn') continue
    const acc =
      (enc.body.includes('misses') || enc.body.includes('hitRatio') || enc.body.includes('cacheWrite')) &&
      (enc.body.includes('+=') ||
        enc.body.includes('++') ||
        enc.body.includes('.push(') ||
        enc.body.includes('requests') ||
        /=\s*\{/.test(enc.body))
    if (!acc && enc.name !== 'gRn' && enc.name !== 'c$t' && enc.name !== 'u$t') continue
    seenAcc.add(enc.at)
    n4writers.push({ ...enc, needle: n })
  }
}
say('')
for (const w of n4writers) {
  if (n4[w.name]) continue
  say(
    `### \`${w.name}\` — BODY (accumulate hunt via \`${w.needle}\`)`,
  )
  say('')
  say(`- offset=${w.at} len=${w.len} sha=${w.sha}`)
  say('')
  say(fence(clip(w.body, 6000)))
  say('')
}

const n4ok = !n4['c$t'].miss && !n4['u$t'].miss
say(`**#4 verdict:** ${n4ok ? 'BODY' : 'MISS'}`)
say(
  `c$t=${n4['c$t'].miss ? 'MISS' : `${n4['c$t'].at}/${n4['c$t'].len}`} u$t=${n4['u$t'].miss ? 'MISS' : `${n4['u$t'].at}/${n4['u$t'].len}`} extra=${n4writers.map((w) => `${w.name}@${w.at}`).join(', ') || '-'}`,
)
say('')
table.push({
  n: 4,
  verdict: n4ok ? 'BODY' : 'MISS',
  names: ['c$t', 'u$t', ...n4writers.map((w) => w.name)],
  miss: [n4['c$t'].miss && 'c$t', n4['u$t'].miss && 'u$t'].filter(Boolean),
})

// ---------------------------------------------------------------------------
// #6
// ---------------------------------------------------------------------------
say('## #6 UWt/DH /proc/self/fd ancestor walk')
say('')
say(
  'Locked: `UWt` @182185287 and `DH` @182187516 already have O_NOFOLLOW + a `/proc/self/fd/${fd}` readlink. Peel the ancestor walk of that fd path IF it exists in those functions or callees. If absent: MISS the loop — do not invent it.',
)
say('')

const n6 = {}
for (const [name, near] of [
  ['ao', CALLERS.UWt],
  ['gt', CALLERS.UWt],
  ['Jo', CALLERS.UWt],
  ['ht', CALLERS.UWt],
  ['Ut', CALLERS.UWt],
  ['tt', CALLERS.UWt],
  ['aV', CALLERS.UWt],
  ['I', CALLERS.DH],
]) {
  // I() is too short / common; skip unless near DH and body is the write refuse.
  const maxDist = name === 'I' || name === 'gt' || name === 'tt' ? 20000 : 200000
  n6[name] = nearestDecl(name, near, maxDist)
}

// Re-extract UWt/DH to inspect loop (already gold; record fd facts only).
const UWt = extractGrow(CALLERS.UWt)
const DH = extractGrow(CALLERS.DH)

say('### UWt/DH fd facts (already in gold-251-b; not re-copied in full)')
say('')
say(
  `- \`UWt\` @${CALLERS.UWt} len=${UWt.len} sha=${UWt.sha} hasProcFd=${hasProcFd(UWt.body)} ancestorWalkOfFd=${ancestorWalkOfFd(UWt.body)}`,
)
say(
  `- \`DH\` @${CALLERS.DH} len=${DH.len} sha=${DH.sha} hasProcFd=${hasProcFd(DH.body)} ancestorWalkOfFd=${ancestorWalkOfFd(DH.body)}`,
)
say('')

for (const name of ['ao', 'gt', 'Jo', 'ht', 'Ut', 'tt', 'aV']) {
  const row = n6[name]
  const extra = row.miss
    ? ''
    : ` hasProcFd=${hasProcFd(row.body)} ancestorWalkOfFd=${ancestorWalkOfFd(row.body)}`
  say(renderFn({ ...row, name }, name === 'ao' || name === 'Ut' || name === 'Jo' ? 4000 : 2000))
  if (!row.miss) {
    // already rendered; append flags after heading is hard — add a fact line
    say(`- flags:${extra}`)
    say('')
  }
}

// Hunt any function near UWt that both contains /proc/self/fd AND walks parents.
say('### /proc/self/fd ancestor-walk hunt near UWt/DH')
say('')
const procHits = allHits(buf, '/proc/self/fd')
const walkCands = []
const seenWalk = new Set()
for (const h of procHits) {
  if (h < 182000000 || h > 182400000) continue
  const enc = encloseHit(h)
  if (!enc || seenWalk.has(enc.at)) continue
  seenWalk.add(enc.at)
  walkCands.push({
    ...enc,
    hasProcFd: hasProcFd(enc.body),
    ancestorWalkOfFd: ancestorWalkOfFd(enc.body),
    hit: h,
  })
}
for (const c of walkCands) {
  say(
    `- \`${c.name}\` @${c.at} len=${c.len} sha=${c.sha} hit@${c.hit} hasProcFd=${c.hasProcFd} ancestorWalkOfFd=${c.ancestorWalkOfFd}`,
  )
}
if (!walkCands.length) say('- no /proc/self/fd hits enclosed in 182000000..182400000')
say('')

const aoRow = n6.ao
const aoWalksFd = !aoRow.miss && hasProcFd(aoRow.body)
const loopInUWtDh = ancestorWalkOfFd(UWt.body) || ancestorWalkOfFd(DH.body)
const loopInCallee = Object.values(n6).some((r) => !r.miss && ancestorWalkOfFd(r.body))
const loopInHunt = walkCands.some((c) => c.ancestorWalkOfFd)
const n6loop = loopInUWtDh || loopInCallee || loopInHunt || aoWalksFd
say(
  `**#6 ancestor-walk verdict:** ${n6loop ? 'BODY' : 'MISS'} (UWt/DH themselves are BODY in gold-251-b; this peel is the fd ancestor loop only)`,
)
say(
  `loopInUWtDh=${loopInUWtDh} loopInCallee=${loopInCallee} loopInHunt=${loopInHunt} aoHasProcFd=${aoWalksFd} ao=${aoRow.miss ? 'MISS' : `${aoRow.name}@${aoRow.at} len=${aoRow.len}`}`,
)
say('')
table.push({
  n: 6,
  verdict: n6loop ? 'BODY' : 'MISS',
  names: Object.values(n6)
    .filter((r) => !r.miss)
    .map((r) => r.name),
  miss: n6loop ? [] : ['/proc/self/fd ancestor walk'],
})

// ---------------------------------------------------------------------------
// #9
// ---------------------------------------------------------------------------
say('## #9 qhn + Oo tools-readable-set gate')
say('')
say('Locked: `Rst` @193380425, `It` @193380027. Window already showed `htn`/`qhn`/`Oo`.')
say('')

const n9 = {}
for (const [name, near, maxDist] of [
  ['qhn', CALLERS.Rst, 50000],
  ['Oo', CALLERS.Rst, 20000],
  ['htn', CALLERS.Rst, 20000],
  ['iJ', CALLERS.Rst, 200000],
]) {
  n9[name] = nearestDecl(name, near, maxDist)
  say(renderFn(n9[name], 4000))
}

const n9ok = !n9.qhn.miss && !n9.Oo.miss
say(`**#9 verdict:** ${n9ok ? 'BODY' : 'MISS'}`)
say(
  `qhn=${n9.qhn.miss ? 'MISS' : `${n9.qhn.at}/${n9.qhn.len}`} Oo=${n9.Oo.miss ? 'MISS' : `${n9.Oo.at}/${n9.Oo.len}`} htn=${n9.htn.miss ? 'MISS' : `${n9.htn.at}/${n9.htn.len}`}`,
)
say('')
table.push({
  n: 9,
  verdict: n9ok ? 'BODY' : 'MISS',
  names: Object.values(n9)
    .filter((r) => !r.miss)
    .map((r) => r.name),
  miss: [n9.qhn.miss && 'qhn', n9.Oo.miss && 'Oo'].filter(Boolean),
})

// ---------------------------------------------------------------------------
// #10
// ---------------------------------------------------------------------------
say('## #10 E2t /proc/self/fd walk')
say('')
say(
  'Locked: `E2t` @183343478 (full body in gold-251-b, including a linux/wsl `/proc/self/fd/${k.fd}` readlink) and `oht` lexical+canonical deny compile. This peel isolates the fd walk or MISSes it. Do not invent an ancestor loop.',
)
say('')

const E2t = extractGrow(CALLERS.E2t)
const n10 = {}
for (const [name, near] of [
  ['lY', CALLERS.E2t],
  ['cY', CALLERS.E2t],
  ['uY', CALLERS.E2t],
  ['_Y', CALLERS.E2t],
]) {
  n10[name] = nearestDecl(name, near, 80000)
}

say('### E2t fd-walk facts')
say('')
say(
  `- \`E2t\` @${CALLERS.E2t} len=${E2t.len} sha=${E2t.sha} hasProcFd=${hasProcFd(E2t.body)} ancestorWalkOfFd=${ancestorWalkOfFd(E2t.body)}`,
)
say('')
const e2tFd = E2t.body
  ? (() => {
      const i = E2t.body.indexOf('/proc/self/fd')
      if (i < 0) return ''
      const a = Math.max(0, i - 180)
      const b = Math.min(E2t.body.length, i + 520)
      return E2t.body.slice(a, b)
    })()
  : ''
if (e2tFd) {
  say('fd walk excerpt from locked E2t body:')
  say('')
  say(fence(e2tFd))
  say('')
}

for (const name of ['lY', 'cY', 'uY', '_Y']) {
  say(renderFn(n10[name], 1500))
  if (!n10[name].miss) {
    say(
      `- flags: hasProcFd=${hasProcFd(n10[name].body)} ancestorWalkOfFd=${ancestorWalkOfFd(n10[name].body)}`,
    )
    say('')
  }
}

const n10walk = hasProcFd(E2t.body)
say(`**#10 fd-walk verdict:** ${n10walk ? 'BODY' : 'MISS'}`)
say(
  `E2t.hasProcFd=${hasProcFd(E2t.body)} E2t.ancestorWalkOfFd=${ancestorWalkOfFd(E2t.body)} lY=${n10.lY.miss ? 'MISS' : `${n10.lY.at}/${n10.lY.len}`}`,
)
say('')
table.push({
  n: 10,
  verdict: n10walk ? 'BODY' : 'MISS',
  names: ['E2t fd walk', ...Object.values(n10).filter((r) => !r.miss).map((r) => r.name)],
  miss: n10walk ? [] : ['E2t /proc/self/fd walk'],
})

// ---------------------------------------------------------------------------
// #16
// ---------------------------------------------------------------------------
say('## #16 lyr truncation')
say('')
say('Locked: `IMe` @181666523 calls `lyr`. Gold-251-c has `lyr` @181659488 len=216 — re-extract; expand if truncated.')
say('')

const n16 = nearestDecl('lyr', CALLERS.lyrHint, 50000)
say(renderFn(n16, 2000))

// Also peel $e / ce / xP / RP if they are the truncate helpers AND nearest to lyr.
const lyrCallees = {}
if (!n16.miss) {
  for (const name of ['$e', 'ce', 'xP']) {
    lyrCallees[name] = nearestDecl(name, n16.at, 30000)
    if (!lyrCallees[name].miss && lyrCallees[name].len < 800) {
      say(renderFn(lyrCallees[name], 800))
    } else if (lyrCallees[name].miss) {
      say(`### \`${name}\` — MISS (or too far)`)
      say('')
      say(`- hits=${lyrCallees[name].hits} ${lyrCallees[name].reason || ''}`)
      say('')
    }
  }
}

const n16ok = !n16.miss
say(`**#16 verdict:** ${n16ok ? 'BODY' : 'MISS'}`)
say(
  `lyr=${n16.miss ? 'MISS' : `${n16.at}/${n16.len} sha=${n16.sha}`} truncatedMarker=${!n16.miss && n16.body.includes('result truncated')}`,
)
say('')
table.push({
  n: 16,
  verdict: n16ok ? 'BODY' : 'MISS',
  names: n16ok ? ['lyr'] : [],
  miss: n16ok ? [] : ['lyr'],
})

// ---------------------------------------------------------------------------
// #18
// ---------------------------------------------------------------------------
say('## #18 hM policy-error gate + o5 + Qan origin')
say('')
say(
  'Locked: `iJt` @190710208 (`hM().length===0||o5()` && `Bdt` && `Qan()`), `BFt` @186056763, `$at` @186055822, `Qan` @186055955. Peel `hM` and `o5` if present. Qan origin helpers only if they are the origin check.',
)
say('')

const n18 = {}
for (const [name, near, maxDist] of [
  ['hM', CALLERS.iJt, 400000],
  ['o5', CALLERS.iJt, 400000],
  ['Bdt', CALLERS.iJt, 200000],
  ['Fx', CALLERS.Qan, 200000],
  ['db', CALLERS.Qan, 80000],
  ['yN', CALLERS.Qan, 80000],
]) {
  n18[name] = nearestDecl(name, near, maxDist)
}

// hM / o5 are the required peels. Origin helpers only if small and look like origin.
for (const name of ['hM', 'o5']) {
  say(renderFn(n18[name], 4000))
}

say('### Qan origin helpers (only if they implement origin; else note)')
say('')
for (const name of ['Fx', 'db', 'yN', 'Bdt']) {
  const row = n18[name]
  if (row.miss) {
    say(`- \`${name}\` MISS hits=${row.hits} ${row.reason || ''}`)
    continue
  }
  const originish =
    row.body.includes('policy') ||
    row.body.includes('managed') ||
    row.body.includes('remote') ||
    row.body.includes('auto') ||
    row.len < 400
  say(
    `- \`${name}\` @${row.at} len=${row.len} sha=${row.sha} dist=${row.dist} originish=${originish}`,
  )
  if (originish && row.len <= 800) {
    say(fence(row.body))
  } else if (!originish) {
    say(`  (skipped body — not origin-shaped; first80=${JSON.stringify(row.body.slice(0, 80))})`)
  } else {
    say(fence(clip(row.body, 800)))
  }
  say('')
}

const n18ok = !n18.hM.miss || !n18.o5.miss
const n18verdict = !n18.hM.miss && !n18.o5.miss ? 'BODY' : n18ok ? 'BODY' : 'MISS'
say(`**#18 verdict:** ${n18verdict}`)
say(
  `hM=${n18.hM.miss ? 'MISS' : `${n18.hM.at}/${n18.hM.len}`} o5=${n18.o5.miss ? 'MISS' : `${n18.o5.at}/${n18.o5.len}`}`,
)
say('')
table.push({
  n: 18,
  verdict: n18verdict,
  names: ['hM', 'o5'].filter((n) => !n18[n].miss),
  miss: ['hM', 'o5'].filter((n) => n18[n].miss),
})

// ---------------------------------------------------------------------------
// compact table
// ---------------------------------------------------------------------------
say('## Compact table')
say('')
say('| # | verdict | extracted | miss |')
say('| --- | --- | --- | --- |')
for (const r of table) {
  say(
    `| ${r.n} | ${r.verdict} | ${(r.names || []).join(', ') || '-'} | ${(r.miss || []).join(', ') || '-'} |`,
  )
}
say('')
say('No checklist/board/HAVE updates.')
say('')

writeFileSync(OUT, lines.join('\n'))
console.log('WROTE', OUT, 'chars', lines.join('\n').length)
for (const r of table) {
  console.log(`#${r.n}\t${r.verdict}\textracted=${(r.names || []).join(',')}\tmiss=${(r.miss || []).join(',')}`)
}
