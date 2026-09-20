import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
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

function findAll(needle, limit = 40) {
  const n = Buffer.from(needle)
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

function extractFn(start) {
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
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

function nextBun(from, limit) {
  const n = Buffer.from('// @bun')
  const i = buf.indexOf(n, from)
  if (i < 0 || i > from + limit) return from + limit
  return i
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# HP/pendingUsage pass4 — qe/tt callers in _448 consumer modules')

// qe module: Y$ as qe @225459219 from _448.js
const qeImp = 225459219
const qeModEnd = nextBun(qeImp, 400000)
log(`qe-import@${qeImp} nextBun@${qeModEnd} span=${qeModEnd - qeImp}`)
const qeWin = asciiWindow(qeImp, qeModEnd)
let idx = 0
const qeCalls = []
while (true) {
  const j = qeWin.indexOf('qe(', idx)
  if (j < 0) break
  qeCalls.push(qeImp + j)
  idx = j + 3
}
log(`qe( in qe-module count=${qeCalls.length} hits=${qeCalls.join(',')}`)
for (const i of qeCalls.slice(0, 20)) {
  log(`  @${i} ${asciiWindow(i - 100, i + 80).replace(/\n/g, ' ')}`)
}

// walk back from each qe( to enclosing function
for (const i of qeCalls.slice(0, 12)) {
  const back = asciiWindow(i - 800, i + 20)
  const m = back.match(/(async function|function) [A-Za-z0-9_$]+\([^)]*\)\{[^]*$/)
  log(`  ENCLOSE-near@${i} tail=${back.slice(-200).replace(/\n/g, ' ')}`)
  if (m) log(`    MATCH ${m[0].slice(0, 160)}`)
}

dump(
  'gold-HP-qe-module.txt',
  `# Y$ as qe @${qeImp} .. ${qeModEnd}\n${asciiWindow(qeImp - 200, Math.min(qeImp + 8000, qeModEnd))}\n`,
)

// tt module: $$ as tt @222197331
const ttImp = 222197331
const ttModEnd = nextBun(ttImp, 400000)
log(`tt-import@${ttImp} nextBun@${ttModEnd} span=${ttModEnd - ttImp}`)
const ttWin = asciiWindow(ttImp, ttModEnd)
idx = 0
const ttCalls = []
while (true) {
  const j = ttWin.indexOf('tt(', idx)
  if (j < 0) break
  ttCalls.push(ttImp + j)
  idx = j + 3
}
log(`tt( in tt-module count=${ttCalls.length} hits=${ttCalls.join(',')}`)
for (const i of ttCalls.slice(0, 20)) {
  log(`  @${i} ${asciiWindow(i - 100, i + 80).replace(/\n/g, ' ')}`)
}
dump(
  'gold-HP-tt-module.txt',
  `# $$ as tt @${ttImp} .. ${ttModEnd}\n${asciiWindow(ttImp - 200, Math.min(ttImp + 8000, ttModEnd))}\n`,
)

// dm(e) all 5
log('\n## dm(e) all')
for (const i of findAll('dm(e)', 10)) {
  log(`  @${i} ${asciiWindow(i - 80, i + 80).replace(/\n/g, ' ')}`)
}

// unique qe call shapes
for (const n of [
  'qe(',
  'qe(e)',
  'qe(t)',
  'qe(n)',
  'qe(r)',
  'qe(o)',
  'qe(s)',
  'qe(i)',
  'qe(a)',
  'qe(l)',
  'qe(c)',
  'qe(u)',
  'qe(d)',
  'qe(p)',
]) {
  const hits = findAll(n, 15)
  log(`QESHAPE ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
}

// Iln / pPe / lln / cln gold
const Iln = extractFn(213653329)
dump(
  'gold-HP-function-Iln-full.txt',
  `# LOCKED Iln @213653329 end=${Iln.end} len=${Iln.end - 213653329}
# unique function Iln( count=1. READ persisted pluginUsage via es(), not pendingUsage.
${Iln.text}
`,
)
const lln = extractFn(213647259)
dump(
  'gold-HP-class-lln-full.txt',
  `# LOCKED class lln @213647259 end=${lln.end} len=${lln.end - 213647259}
# unique class lln{ count=1. module singleton r3=new lln (flushers).
${lln.text}
`,
)
dump(
  'gold-HP-var-pPe-full.txt',
  `# LOCKED var pPe @213654230
# unique uln({flush:oko,flushAtExit:sko}) count=1
var pPe=w(()=>{Ko();ip();Ls();zC();uln({flush:oko,flushAtExit:sko})})
`,
)
dump(
  'gold-HP-var-cln-full.txt',
  `# LOCKED var cln @213647317
# unique aln=new fn(()=>new iln) count=1
var cln=w(()=>{ro();aln=new fn(()=>new iln);r3=new lln})
`,
)

// 246 leftover gold rename
log('\n## 246 leftover already extracted as gold-HP-246-*')

// more _448.js imports beyond 25?
const all448 = findAll('from"B:/~BUN/root/_448.js"', 80)
log(`_448.js imports total count=${all448.length}`)

// does any other _448 import include Y$?
let y448 = 0
for (const i of all448) {
  const win = asciiWindow(i - 600, i)
  if (win.includes('Y$ as') || win.includes(',Y$') || win.includes('{Y$')) {
    y448++
    log(`  Y$ in import ending@${i} ${win.slice(-200).replace(/\n/g, ' ')}`)
  }
}
log(`_448 imports mentioning Y$ count=${y448}`)

dump('gold-HP-pendingUsage-pass4.txt', report.join('\n') + '\n')
log('WROTE gold-HP-pendingUsage-pass4.txt')
