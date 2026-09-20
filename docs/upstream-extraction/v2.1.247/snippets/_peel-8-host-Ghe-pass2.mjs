/**
 * Pass 2: Zt host class, TurnController session bind, 1MB DIFF classify,
 * Li call sites, 246 tip-Ghe twin name.
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

function findAll(b, needle, limit = 40) {
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

log(`# peel-8-host-Ghe pass2 247=${buf.length} 246=${bufs[246].length}`)

// --- class Zt near Xi @206986123 ---
log('\n## class Zt / host factory')
const ztNeedles = [
  'class Zt{',
  'class Zt {',
  'function Zt(',
  'Zt=class',
  'new Zt({backgroundHousekeeping',
]
for (const n of ztNeedles) {
  const hits = findAll(buf, n, 15)
  log(`ZT ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    const fn = n.startsWith('class') || n.startsWith('function') ? extractFn(buf, i) : null
    log(`  @${i} ${asciiWindow(buf, i, i + 220).replace(/\n/g, ' ')}`)
    if (fn) {
      dump(
        `gold-Zt-${i}.txt`,
        `# ${n} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
      )
    }
  }
}

// walk back from Xi for class Zt
const xi = 206986123
dump('gold-Xi-before-4k.txt', `# Xi@${xi} before 4k\n${asciiWindow(buf, xi - 4000, xi + 50)}\n`)
const beforeXi = asciiWindow(buf, xi - 4000, xi)
const classHits = [...beforeXi.matchAll(/class [A-Za-z_$][\w$]*\{/g)]
log(`classes before Xi: ${classHits.map((m) => m[0]).join(' | ')}`)

// --- Li( call sites ---
log('\n## Li( call sites (session ctor vs collide)')
const liCalls = findAll(buf, 'Li({host:', 20)
log(`Li({host: count=${liCalls.length}`)
for (const i of liCalls) {
  log(`  @${i} ${asciiWindow(buf, i - 40, i + 160).replace(/\n/g, ' ')}`)
}
const liCalls2 = findAll(buf, 'Li({', 30)
log(`Li({ count=${liCalls2.length}`)
for (const i of liCalls2.slice(0, 15)) {
  const win = asciiWindow(buf, i, i + 80).replace(/\n/g, ' ')
  log(`  @${i} ${win}`)
}

// --- TurnController host / session bind ---
log('\n## TurnController session bind')
const tcNeedles = [
  '_requireHost()',
  '_requireHost(){',
  'bindHost(e){',
  'this._host=e',
  'session:e,theme:t',
  'pickNewSpinnerTip(){',
  'wbe(t.session.host',
  'session:uk()',
  'session:Tm()',
  'session:n()',
  '{session:uk()',
  'session:k,',
  'session:k}',
  'host.session',
  'e.session=uk',
  'session:uk().',
]
for (const n of tcNeedles) {
  const hits = findAll(buf, n, 20)
  log(`TC ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 60, i + n.length + 140).replace(/\n/g, ' ')}`)
  }
}

const reqHost = findAll(buf, '_requireHost(){', 10)
for (const i of reqHost) {
  const fn = extractFn(buf, i)
  dump(
    `gold-requireHost-${i}.txt`,
    `# _requireHost(){ @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
}

const bindHost = findAll(buf, 'bindHost(e){', 10)
for (const i of bindHost) {
  const fn = extractFn(buf, i)
  dump(
    `gold-bindHost-${i}.txt`,
    `# bindHost(e){ @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
}

// REPL / main session: passed into host
const sessionPass = [
  'session:uk()',
  'session:Tm()',
  ',session:e,',
  'session:n(),',
  'get session(){return',
  'session:k',
]
for (const n of sessionPass) {
  const hits = findAll(buf, n, 15)
  log(`SP ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(buf, i - 80, i + 160).replace(/\n/g, ' ')}`)
    dump(`gold-session-pass-${i}.txt`, `# ${n} @${i}\n${asciiWindow(buf, i - 300, i + 400)}\n`)
  }
}

// --- 1MB DIFF classify ---
log('\n## 1MB / 1 MiB unique 247')
function uniqueHits(needle) {
  const a = findAll(bufs[246], needle, 40)
  const b = findAll(bufs[247], needle, 40)
  log(`${JSON.stringify(needle)} 246=${a.length} 247=${b.length}`)
  const wins246 = a.map((i) => asciiWindow(bufs[246], i - 80, i + needle.length + 80))
  let idx = 0
  for (const i of b) {
    const win = asciiWindow(buf, i - 80, i + needle.length + 80)
    const same = wins246.some((w) => w === win)
    if (!same) {
      log(`  UNIQ247 @${i} ${win.replace(/\n/g, ' ')}`)
      dump(
        `gold-8-pass3-1mb-uniq-${idx}.txt`,
        `# ${needle} uniq247 @${i}\n${asciiWindow(buf, i - 250, i + 350)}\n`,
      )
      idx++
    }
  }
}
uniqueHits('1MB')
uniqueHits('1 MiB')

// hook blocking slice(0, window
dump(
  'gold-8-pass3-hook-block-slice.txt',
  `# hook blocking error slice window @218249550\n${asciiWindow(buf, 218249350, 218249850)}\n`,
)
log(`hook-block-slice win: ${asciiWindow(buf, 218249500, 218249750).replace(/\n/g, ' ')}`)

// --- 246 tip-Ghe twin ---
log('\n## 246 tip content threw twin')
const threw246 = findAll(bufs[246], 'tip content threw', 10)
log(`246 tip content threw count=${threw246.length}`)
for (const i of threw246) {
  log(`  @${i} ${asciiWindow(bufs[246], i - 160, i + 80).replace(/\n/g, ' ')}`)
  dump(
    `gold-246-tip-content-threw-${i}.txt`,
    `# 246 tip content threw @${i}\n${asciiWindow(bufs[246], i - 400, i + 200)}\n`,
  )
}

// 246 Li/Xi/es names
const twins246 = [
  'function Xi(){return new ',
  'host:Xi()',
  'k=es()',
  'function es(){let e="";if(typeof process<"u"',
  'function Li(e){return Ri({kind:"root",host:e.host',
]
log('\n246 ctor name twins:')
for (const n of twins246) {
  const hits = findAll(bufs[246], n, 5)
  log(`  ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  if (hits[0] !== undefined) {
    log(`    ${asciiWindow(bufs[246], hits[0], hits[0] + 200).replace(/\n/g, ' ')}`)
  }
}

// uk().host vs e.session.host identity: who passes session into Vhe/Ghe
const vheCall = findAll(buf, 'Vhe({session:e,theme:t', 5)
log(`Vhe({session:e,theme:t count=${vheCall.length}`)
for (const i of vheCall) {
  dump(
    `gold-Vhe-pick-${i}.txt`,
    `# Vhe pick @${i}\n${asciiWindow(buf, i - 200, i + 400)}\n`,
  )
}

// REPL host.session assignment
const hostSession = [
  'session:uk()',
  'session: Tm()',
  'session:n()',
  '.session=uk()',
  '.session=n()',
  '.session=k',
  'session:e.host',
]
for (const n of hostSession) {
  log(`HS ${JSON.stringify(n)} 247=${count(buf, n)} 246=${count(bufs[246], n)}`)
}

dump('gold-8-host-Ghe-scan2.txt', report.join('\n') + '\n')
console.log('DONE pass2', report.length)
