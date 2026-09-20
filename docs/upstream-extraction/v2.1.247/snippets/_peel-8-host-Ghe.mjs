/**
 * Peel leftover #8 host/Ghe — official 247 vs 246.
 * A) hook-mb-ptl pass-3 confirm only (no invent 1MB; no lre-as-247-HAVE).
 * B) uniquely lock Ghe + session.host constructor / identity.
 * Invent-ban. Collision-ban function Ghe( / host: elsewhere.
 * Do not edit src/. Do not invent a host factory.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const bufs = {
  246: readFileSync(SEA[246]),
  247: readFileSync(SEA[247]),
}
const buf = bufs[247]
console.log('loaded', bufs[246].length, bufs[247].length)

function count(b, needle) {
  const n = Buffer.from(needle)
  let c = 0
  let i = 0
  while (true) {
    const j = b.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

function findAll(b, needle, limit = 80) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = b.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function asciiWindow(b, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const z = Math.min(b.length, end)
  for (let j = a; j < z; j++) {
    const c = b[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function extractFn(b, start) {
  let i = start
  while (i < b.length && b[i] !== 123) i++
  if (i >= b.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < b.length; i++) {
    const c = b[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, text: asciiWindow(b, start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(b, start, start + 200) }
}

function dump(name, content) {
  const body = content.endsWith('\n') ? content : `${content}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log(`# peel-8-host-Ghe official-247=${buf.length} official-246=${bufs[246].length}`)

// ============================================================
// A) hook-mb-ptl pass-3 confirm — unique 247 attach-cap only
// ============================================================
log('\n## A hook-mb-ptl pass-3 confirm')

const hookNeedles = [
  'MAX_HOOK_OUTPUT',
  'MAX_HOOK_OUTPUT_LENGTH',
  'output truncated - exceeded',
  'applyTruncation',
  'slice(0,1048576)',
  'slice(0,1e6)',
  'slice(0,2e6)',
  'substring(0,10000)',
  '.length>1e6',
  '.length>2e6',
  'length>1048576',
  '1MB',
  '1 MiB',
  '1048576',
  'hook conversation',
  'conversation attach',
  'attach cap',
  'lre(he.stderr',
  'Rne(ye.stderr',
  'blockingError:await lre',
  'blockingError:await Rne',
  ',"stderr",{storageV5',
  'tengu_hook_output_persisted',
  'Hook ${n} truncated',
  'persist-to-disk failed',
  'threshold:r=JWr',
  'threshold:r=BBr',
  'Yvb as JWr',
  'lHb as BBr',
  'async function lre(',
  'async function Rne(',
  'printed megabytes',
  'overflow the conversation',
  'wedge the session',
  'megabytes of error',
  'background agent error',
  'Background agent error',
  'agent error output',
  'tengu_agent_output_persisted',
  'tengu_bg_output_persisted',
]

log('needle\t246\t247\tdiff')
for (const n of hookNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  const mark = a === b ? '' : ' DIFF'
  log(`${JSON.stringify(n)}\t${a}\t${b}${mark}`)
}

// unique-247 attach-cap function hunt: only functions that mention BOTH
// hook/bg-agent attach AND a byte/char cap in the same 400-byte window
const attachCaps = [
  'hook_blocking_error',
  'hook_success',
  'hook_additional_context',
  'No stderr output',
  'hook blocking error from command',
]
log('\nATTACH-WINDOW 247 unique vs 246 (cap tokens in ±400 of attach strings):')
const capTokens = [
  '1048576',
  '1e6',
  '1MB',
  'slice(0,',
  'substring(0,',
  'MAX_HOOK_OUTPUT',
]
for (const n of attachCaps) {
  const h246 = findAll(bufs[246], n, 20)
  const h247 = findAll(bufs[247], n, 20)
  log(`  ${JSON.stringify(n)} 246=${h246.length} 247=${h247.length}`)
  for (const i of h247.slice(0, 4)) {
    const win = asciiWindow(buf, i - 200, i + n.length + 200)
    const caps = capTokens.filter((t) => win.includes(t))
    log(`    247@${i} capTokensInWin=${caps.length ? caps.join(',') : 'NONE'}`)
  }
}

// ============================================================
// B1) Ghe body + call sites + collision-ban
// ============================================================
log('\n## B1 Ghe defs + calls + collisions')

const gheDefNeedles = [
  'async function Ghe(e,t){',
  'function Ghe(e,t){',
  'async function Ghe(',
  'function Ghe(',
  'Ghe=async',
  'Ghe=(e,t)',
]
for (const n of gheDefNeedles) {
  const hits = findAll(buf, n, 30)
  log(`GHEDEF ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    const win = asciiWindow(buf, i, i + 220).replace(/\n/g, ' ')
    const looksTip =
      win.includes('content') ||
      win.includes('failedTipIds') ||
      win.includes('session.host') ||
      win.includes('tip content')
    log(`  @${i}${looksTip ? ' TIP' : ' COLLIDE'} ${win}`)
    const fn = extractFn(buf, i)
    dump(
      `gold-Ghe-def-${i}.txt`,
      `# needle=${n} pos=${i} end=${fn.end} len=${fn.end - i} tip=${looksTip}\n${fn.text}\n`,
    )
  }
}

const gheCallNeedles = [
  'await Ghe(',
  'Ghe(c,{session:',
  'Ghe(c,{',
  'return Ghe(',
  '=Ghe(',
  '=await Ghe(',
]
for (const n of gheCallNeedles) {
  const hits = findAll(buf, n, 40)
  log(`GHECALL ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(buf, i - 80, i + n.length + 160).replace(/\n/g, ' ')}`)
    dump(
      `gold-Ghe-call-${i}.txt`,
      `# ${n} @${i}\n${asciiWindow(buf, i - 400, i + 500)}\n`,
    )
  }
}

// raw Ghe( — classify
const rawGhe = findAll(buf, 'Ghe(', 80)
log(`RAW Ghe( count=${rawGhe.length}`)
for (const i of rawGhe) {
  const win = asciiWindow(buf, i - 40, i + 80).replace(/\n/g, ' ')
  const kind = win.includes('function Ghe')
    ? 'DEF'
    : win.includes('await Ghe') || win.includes('Ghe(c')
      ? 'CALL'
      : 'OTHER'
  log(`  ${kind} @${i} ${win}`)
}

// unique tip Ghe
const tipGheHits = findAll(buf, 'async function Ghe(e,t){try{return await e.content(t)}', 5)
log(`UNIQUE tip-Ghe count=${tipGheHits.length}`)
if (tipGheHits.length === 1) {
  const fn = extractFn(buf, tipGheHits[0])
  dump(
    'gold-Ghe-full.txt',
    `# UNIQUE async function Ghe(e,t) pos=${tipGheHits[0]} end=${fn.end} len=${fn.end - tipGheHits[0]}\n${fn.text}\n`,
  )
}

// 246 twin
const ghe246 = [
  'async function Ghe(e,t){try{return await e.content(t)}',
  'tip content threw',
  'failedTipIds.add',
]
log('\n246 Ghe twins:')
for (const n of ghe246) {
  log(`  246 ${JSON.stringify(n)} count=${count(bufs[246], n)}`)
}

// ============================================================
// B2) session.host constructor: Li / Xi / k / es
// ============================================================
log('\n## B2 session.host constructor Li/Xi/k/es')

const ctorNeedles = [
  'Li({host:Xi()',
  'return Li({host:Xi()',
  'function Li(e){return Ri({kind:"root",host:e.host',
  'function Li(e){return Ri({kind:"root"',
  'host:Xi()',
  'function es(){',
  'function Tm(){return n()}',
  'function n(){return re()?.session??k}',
  're()?.session??k',
  'e.of(k.host)',
  'function ts(e){return e.of(k.host)}',
  'function Xi(){',
  'function Xi(){return',
  'Xi=()=>',
  'Xi=()=>{',
]
for (const n of ctorNeedles) {
  const hits = findAll(buf, n, 25)
  log(`CTOR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i - 60, i + n.length + 180).replace(/\n/g, ' ')}`)
  }
}

// Li unique session ctor
const liHits = findAll(buf, 'function Li(e){return Ri({kind:"root",host:e.host', 5)
log(`LI-SESSION count=${liHits.length}`)
for (const i of liHits) {
  const fn = extractFn(buf, i)
  dump(
    `gold-Li-session-${i}.txt`,
    `# function Li(e) session ctor pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
}

// Ri (Li callee) — unique by kind:root neighbor
const riHits = findAll(buf, 'function Ri(e,t){let o=D(t.originalCwd)', 5)
log(`RI-SESSION count=${riHits.length}`)
for (const i of riHits) {
  const fn = extractFn(buf, i)
  dump(
    `gold-Ri-session-${i}.txt`,
    `# function Ri(e,t) session body pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
}

// es()
const esHits = findAll(buf, 'function es(){let e="";if(typeof process<"u"', 5)
log(`ES count=${esHits.length}`)
for (const i of esHits) {
  const fn = extractFn(buf, i)
  dump(
    `gold-es-session-${i}.txt`,
    `# function es() pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
}

// Xi() near es / host:Xi()
const hostXi = findAll(buf, 'host:Xi()', 15)
log(`host:Xi() count=${hostXi.length}`)
for (const i of hostXi) {
  dump(
    `gold-host-Xi-call-${i}.txt`,
    `# host:Xi() @${i}\n${asciiWindow(buf, i - 300, i + 400)}\n`,
  )
}

// function Xi(){  — classify host vs collide
const xiDefs = findAll(buf, 'function Xi(){', 30)
log(`function Xi(){ count=${xiDefs.length}`)
for (const i of xiDefs) {
  const fn = extractFn(buf, i)
  const win = fn.text.slice(0, 240)
  const looksHost =
    win.includes('WeakMap') ||
    win.includes('failedTip') ||
    win.includes('host') ||
    win.length < 80
  log(
    `  @${i} len=${fn.end - i}${looksHost ? ' HOSTISH' : ''} ${win.replace(/\n/g, ' ')}`,
  )
  dump(
    `gold-Xi-def-${i}.txt`,
    `# function Xi(){ pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
}

const xiEDefs = findAll(buf, 'function Xi(e){', 30)
log(`function Xi(e){ count=${xiEDefs.length} (collision-ban unless host:Xi bind)`)
for (const i of xiEDefs.slice(0, 12)) {
  const win = asciiWindow(buf, i, i + 160).replace(/\n/g, ' ')
  log(`  COLLIDE @${i} ${win}`)
}

// k fallback assignment in _839 neighborhood (Tm @206986838)
const tmPos = 206986838
const aroundTm = asciiWindow(buf, tmPos - 8000, tmPos + 12000)
dump('gold-Tm-around-8k-12k.txt', `# Tm@${tmPos} -8k/+12k\n${aroundTm}\n`)

const kNeedles = [
  'var k=es()',
  'k=es()',
  'var k=Li(',
  'k=Li({',
  ',k=es()',
  'k=es(),',
  'var k,re',
  'var re,k',
  'k=es()',
]
log('\nk-assign needles:')
for (const n of kNeedles) {
  const hits = findAll(buf, n, 20)
  log(`  ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`    @${i} ${asciiWindow(buf, i - 80, i + 200).replace(/\n/g, ' ')}`)
    dump(
      `gold-k-assign-${i}.txt`,
      `# ${n} @${i}\n${asciiWindow(buf, i - 400, i + 600)}\n`,
    )
  }
}

// walk _839 init for k=
const kEq = findAll(buf, 'k=es()', 20)
const kEq2 = findAll(buf, 'k=Li(', 20)
log(`k=es()=${kEq.length} k=Li(=${kEq2.length}`)

// Li as tod export uniqueness
const liExport = findAll(buf, 'Li as tod', 10)
log(`Li as tod count=${liExport.length} hits=${liExport.join(',')}`)

// ============================================================
// B3) identity: session.host vs REPL / getReplDiffHost / uk().host / We()
// ============================================================
log('\n## B3 identity binds')

const idNeedles = [
  'uk().host',
  'e.session.host',
  't.session.host',
  'n.session.host',
  'getReplDiffHost',
  'session:{host:',
  'session: { host:',
  '{session:e,theme:t',
  'Ghe(c,{session:e,theme:t',
  'host:S.host',
  'host:e.host',
  '{storageV5:p,credentials:g}=We()',
  'function We(){return i(e)}',
  'function b(){return i(e)}',
  'pZe.of(uk().host)',
  'FV.of(t.session.host)',
  'FV.of(e.session.host)',
  'h.of(e.session.host)',
  'h.of(t.session.host)',
  'ns().host',
  'Tm().host',
  'n().host',
  'k.host',
]
for (const n of idNeedles) {
  const hits = findAll(buf, n, 25)
  log(`ID ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i - 70, i + n.length + 140).replace(/\n/g, ' ')}`)
  }
}

// pickNewSpinnerTip neighborhood
const pickHits = findAll(buf, 'Ghe(c,{session:e,theme:t', 5)
log(`PICK Ghe(c,{session:e,theme:t count=${pickHits.length}`)
for (const i of pickHits) {
  dump(
    `gold-Ghe-pick-${i}.txt`,
    `# pickNewSpinnerTip Ghe call @${i}\n${asciiWindow(buf, i - 1500, i + 800)}\n`,
  )
  // walk back for function start
  const before = asciiWindow(buf, i - 2500, i)
  const fnStarts = [...before.matchAll(/function [A-Za-z_$][\w$]*\(/g)]
  log(
    `  pick@${i} preceding fns=${fnStarts
      .slice(-8)
      .map((m) => m[0])
      .join(' | ')}`,
  )
}

// We() ≢ host already locked; recount unique
const weHostish = [
  'We().host',
  'We().session',
  'of(We())',
  'of(We().host)',
]
log('\nWe() hostish (must be 0):')
for (const n of weHostish) {
  log(`  ${JSON.stringify(n)} 247=${count(buf, n)} 246=${count(bufs[246], n)}`)
}

// collision-ban host:  — only classify unique constructors
const hostColon = findAll(buf, 'host:Xi()', 10)
const hostColonOther = [
  'host:e.host',
  'host:t.host',
  'host:S.host',
  'host:n.host',
  'host:uk()',
  'host:getReplDiffHost',
  '{host:Xi()',
  '{host:e.host',
]
log('\nhost: collision-ban:')
for (const n of hostColonOther) {
  const hits = findAll(buf, n, 20)
  log(`  ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`    @${i} ${asciiWindow(buf, i - 50, i + 100).replace(/\n/g, ' ')}`)
  }
}

// function Ghe( collision already dumped; also ` as Ghe`
const asGhe = findAll(buf, ' as Ghe', 15)
const gheAs = findAll(buf, 'Ghe as ', 15)
log(`as Ghe count=${asGhe.length} hits=${asGhe.join(',')}`)
log(`Ghe as  count=${gheAs.length} hits=${gheAs.join(',')}`)
for (const i of [...asGhe, ...gheAs].slice(0, 10)) {
  log(`  @${i} ${asciiWindow(buf, i - 80, i + 120).replace(/\n/g, ' ')}`)
}

// local strings in official
const localStr = [
  'getReplDiffHost',
  'spinnerTipHostFromContext',
  'SpinnerTipHostState',
  'WeakOwnerCache',
  'evaluateTipContent',
]
log('\nLOCAL strings in official 247/246:')
for (const n of localStr) {
  log(`  ${JSON.stringify(n)} 246=${count(bufs[246], n)} 247=${count(buf, n)}`)
}

// 246 Li/Xi/es twins
log('\n246 ctor twins:')
for (const n of [
  'Li({host:Xi()',
  'function Li(e){return Ri({kind:"root",host:e.host',
  'function es(){let e="";if(typeof process<"u"',
  're()?.session??k',
  'function Tm(){return n()}',
  'async function Ghe(e,t){try{return await e.content(t)}',
]) {
  log(`  246 ${JSON.stringify(n)} count=${count(bufs[246], n)}`)
}

dump('gold-8-host-Ghe-scan.txt', report.join('\n') + '\n')
console.log('DONE scan lines', report.length)
