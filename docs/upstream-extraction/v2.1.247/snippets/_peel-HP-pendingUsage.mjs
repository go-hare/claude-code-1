import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const bins = {
  '247': readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  ),
  '246': readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
  ),
}

function asciiWindow(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(buf, needle, limit = 80) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(buf, start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
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
        return { start, end: i + 1, text: asciiWindow(buf, start, i + 1) }
      }
    }
  }
  return {
    start,
    end: start + 200,
    text: asciiWindow(buf, start, start + 200),
  }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

const buf = bins['247']
const buf246 = bins['246']

log(`# HP/pendingUsage peel official-247 size=${buf.length}`)
log(`# official-246 size=${buf246.length}`)
log(`# already locked yln@213648410 dPe@213653071 — not re-derived`)

const uniqueNeedles = [
  'let{pendingUsage:t}=HP()',
  'function yln(e){let{pendingUsage:t}=HP()',
  'function HP(){return aln.of(bn().host)}',
  'class iln{pendingUsage=new Map',
  'pendingUsage=new Map',
  'aln=new fn(()=>new iln)',
  'aln.of(bn().host)',
  'pendingUsage.set(',
  'pendingUsage.delete(',
  'pendingUsage.clear()',
  'pendingUsage.get(',
  'pendingUsage.has(',
  'pendingUsage.size',
  'pendingUsage.keys()',
  'pendingUsage.entries()',
  'Cannot destructure property \'pendingUsage\'',
  'function uln(e){r3.flushers=e;let t=HP()',
  'function dm(e){let t=Date.now(),n=HP()',
  'function sPe(){let e=HP()',
  'function uvi(e){return HP().pendingUsage.has(e)}',
  'HP().pendingUsage',
  'HP().exitFlushesInFlight',
  'HP().flushStorageV5',
  'function pln(e){HP().exitFlushesInFlight.push(e)}',
  'function gln(e){HP().flushStorageV5=e}',
  'function hln(){return HP().flushStorageV5}',
  'yln(n),ki(',
  'pluginUsage',
]

log('\n## 247 unique/shape needles')
for (const n of uniqueNeedles) {
  const hits = findAll(buf, n, 30)
  log(`247 STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 70, i + n.length + 110).replace(/\n/g, ' ')}`,
    )
  }
}

log('\n## 246 same-shape leftover')
for (const n of [
  'let{pendingUsage:t}=HP()',
  'function HP(){return aln.of(bn().host)}',
  'class iln{pendingUsage=new Map',
  'pendingUsage=new Map',
  'pendingUsage.set(',
  'pendingUsage.delete(',
  'pendingUsage.clear()',
  'function yln(',
  'let{pendingUsage:t}=',
]) {
  const hits = findAll(buf246, n, 20)
  log(`246 STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(
      `  @${i} ${asciiWindow(buf246, i - 70, i + n.length + 110).replace(/\n/g, ' ')}`,
    )
  }
}

log('\n## function HP( collision scan 247')
const hpHits = findAll(buf, 'function HP(', 40)
log(`function HP( count=${hpHits.length} hits=${hpHits.join(',')}`)
for (const i of hpHits) {
  const fn = extractFn(buf, i)
  log(
    `  HP@${i} end=${fn.end} len=${fn.end - i} ${fn.text.slice(0, 180).replace(/\n/g, ' ')}`,
  )
}

log('\n## async function HP( / function hp( / async function hp(')
for (const n of [
  'async function HP(',
  'function hp(',
  'async function hp(',
  'var HP=',
  'let HP=',
  'const HP=',
]) {
  const hits = findAll(buf, n, 20)
  log(`${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    const fn = n.includes('function') ? extractFn(buf, i) : null
    log(
      `  @${i} ${(fn ? fn.text : asciiWindow(buf, i, i + 160)).slice(0, 180).replace(/\n/g, ' ')}`,
    )
  }
}

log('\n## HP() call sites near pendingUsage cluster (213640000-213660000)')
const clusterStart = 213640000
const clusterEnd = 213660000
const hpCallNeedle = Buffer.from('HP()')
let from = clusterStart
const clusterCalls = []
while (from < clusterEnd) {
  const i = buf.indexOf(hpCallNeedle, from)
  if (i < 0 || i >= clusterEnd) break
  clusterCalls.push(i)
  from = i + 4
}
log(`HP() in cluster count=${clusterCalls.length} hits=${clusterCalls.join(',')}`)
for (const i of clusterCalls) {
  log(`  @${i} ${asciiWindow(buf, i - 60, i + 80).replace(/\n/g, ' ')}`)
}

log('\n## pendingUsage all hits 247 (full)')
const puHits = findAll(buf, 'pendingUsage', 40)
log(`pendingUsage count=${puHits.length} hits=${puHits.join(',')}`)
for (const i of puHits) {
  log(`  @${i} ${asciiWindow(buf, i - 80, i + 140).replace(/\n/g, ' ')}`)
}

log('\n## extract cluster fns from unique strings')
const extractTargets = [
  ['class iln', 'class iln{pendingUsage=new Map'],
  ['function HP', 'function HP(){return aln.of(bn().host)}'],
  ['function uln', 'function uln(e){r3.flushers=e;let t=HP()'],
  ['function dm', 'function dm(e){let t=Date.now(),n=HP()'],
  ['function dln', 'function dln(e,t){if(!r3.exitFlushRegistered)'],
  ['function pln', 'function pln(e){HP().exitFlushesInFlight.push(e)}'],
  ['function fln', 'function fln(e){let t=HP().exitFlushesInFlight'],
  ['function mln', 'function mln(){let e=HP(),t=e.exitFlushesInFlight'],
  ['function gln', 'function gln(e){HP().flushStorageV5=e}'],
  ['function hln', 'function hln(){return HP().flushStorageV5}'],
  ['function sPe', 'function sPe(){let e=HP()'],
  ['function uvi', 'function uvi(e){return HP().pendingUsage.has(e)}'],
  ['function yln', 'function yln(e){let{pendingUsage:t}=HP()'],
  ['function oko', 'function oko(){let e=sPe()'],
  ['async function Aln', 'async function Aln(e){let t=sPe()'],
  ['function xvi', 'function xvi(e){if(Ne()&&e!==void 0)gln(e)'],
  ['function sko', 'function sko(){let e=[...mln()??[],...sPe()??[]]'],
  ['function xit', 'function xit(e){return(t)=>{let n={...t.pluginUsage}'],
  ['function xln', 'function xln(e,t){let n=Date.now();ki((r)=>{'],
  ['function dPe', 'function dPe(e,t){let n=new Set(e.map((r)=>r.toLowerCase()));yln(n),ki('],
]

const extracted = {}
for (const [label, needle] of extractTargets) {
  const hits = findAll(buf, needle, 8)
  log(`EXTRACT ${label} needle count=${hits.length} hits=${hits.join(',')}`)
  if (hits.length === 1) {
    const start = hits[0]
    const fn = extractFn(buf, start)
    extracted[label] = fn
    log(`  LOCK-CANDIDATE ${label}@${fn.start} end=${fn.end} len=${fn.end - fn.start}`)
    log(`  BODY ${fn.text}`)
  } else if (hits.length === 0) {
    log(`  MISS ${label}`)
  } else {
    log(`  COLLISION ${label} count=${hits.length}`)
    for (const i of hits) {
      const fn = extractFn(buf, i)
      log(`    @${i} len=${fn.end - i} ${fn.text.slice(0, 160)}`)
    }
  }
}

log('\n## name-collision defs (dm / sPe / uln / uvi / xit / xln / dln)')
for (const n of [
  'function dm(',
  'async function dm(',
  'function sPe(',
  'function uln(',
  'function uvi(',
  'function xit(',
  'function xln(',
  'function dln(',
  'function pln(',
  'function fln(',
  'function mln(',
  'function gln(',
  'function hln(',
  'function oko(',
  'function xvi(',
  'function sko(',
  'async function Aln(',
  'class iln{',
  'class lln{',
  'var aln=',
  'var r3=',
  'var cln=',
  'var zC=',
]) {
  const hits = findAll(buf, n, 25)
  log(`FN ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 10)) {
    const show = n.startsWith('function') || n.startsWith('async') || n.startsWith('class')
    const win = show
      ? extractFn(buf, i).text.slice(0, 200)
      : asciiWindow(buf, i, i + 160)
    log(`  @${i} ${win.replace(/\n/g, ' ')}`)
  }
}

log('\n## aliases HP / pendingUsage cluster')
for (const alias of [
  ' HP as ',
  'HP as ',
  ' as HP}',
  ' as HP,',
  ',HP as ',
  '{HP as ',
  ' yln as ',
  'yln as ',
  ' as yln}',
  ' as yln,',
  ' sPe as ',
  'sPe as ',
  ' as sPe}',
  ' as sPe,',
  ' dm as ',
  ' as dm}',
  ' as dm,',
  ' uvi as ',
  ' as uvi}',
  ' as uvi,',
  ' xit as ',
  ' as xit}',
  ' xvi as ',
  ' as xvi}',
  ' oko as ',
  ' as oko}',
  ' uln as ',
  ' as uln}',
  ' iln as ',
  ' as iln}',
]) {
  const hits = findAll(buf, alias, 20)
  log(`ALIAS ${JSON.stringify(alias)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const near = Math.abs(i - 213647450) < 800000
    log(
      `  @${i} nearCluster=${near} ${asciiWindow(buf, i - 70, i + alias.length + 90).replace(/\n/g, ' ')}`,
    )
  }
}

// export map near dPe as baa @219684806
log('\n## export window around dPe as baa @219684806')
log(asciiWindow(buf, 219684700, 219685200).replace(/\n/g, ' '))

// import HP / sPe / dm / uvi / yln
log('\n## import windows mentioning HP / sPe / dm / yln / uvi / xit / xvi')
for (const n of [
  'HP as ',
  'sPe as ',
  'uvi as ',
  'xvi as ',
  'xit as ',
  'oko as ',
  'uln as ',
  'dm as ',
  'yln as ',
]) {
  const hits = findAll(buf, n, 15)
  log(`IMP ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i - 40, i + 120).replace(/\n/g, ' ')}`)
  }
}

// fn factory uniqueness near aln
log('\n## fn/bn bind (storage shape only, no invent)')
for (const n of [
  'aln=new fn(()=>new iln)',
  'new fn(()=>new iln)',
  'function bn(',
  'class fn{',
  'fn=class',
  'of(bn().host)',
]) {
  const hits = findAll(buf, n, 15)
  log(`SHAPE ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 50, i + n.length + 100).replace(/\n/g, ' ')}`)
  }
}

// write gold full files for unique extracts
for (const [label, fn] of Object.entries(extracted)) {
  const slug = label.replace(/\s+/g, '-')
  dump(
    `gold-HP-${slug}-full.txt`,
    `# LOCKED-CANDIDATE ${label} @${fn.start} end=${fn.end} len=${fn.end - fn.start}
# official-247 peel. Invent-ban. Bind via yln caller let{pendingUsage:t}=HP() count=1.
${fn.text}
`,
  )
}

dump(
  'gold-HP-pendingUsage-scan.txt',
  report.join('\n') + '\n',
)

log(`\nWROTE gold-HP-pendingUsage-scan.txt extracts=${Object.keys(extracted).join(',')}`)
