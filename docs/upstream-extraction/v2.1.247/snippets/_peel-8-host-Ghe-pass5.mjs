/**
 * Pass 5: vn/dt session reuse, REPL ge prop, S.host bind.
 */
import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function findAll(needle, limit = 30) {
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

function asciiWindow(start, end) {
  let s = ''
  const a = Math.max(0, start)
  const z = Math.min(buf.length, end)
  for (let j = a; j < z; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
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
  const body = content.endsWith('\n') ? content : `${content}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

const vnHits = findAll('function vn(e,t,n){let s=[],r=qt()', 5)
log(`vn unique count=${vnHits.length}`)
for (const i of vnHits) {
  const fn = extractFn(i)
  dump(
    `gold-vn-session-${i}.txt`,
    `# function vn(e,t,n) pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`  vn@${i} len=${fn.end - i}`)
}

const dtHits = findAll('dt({host:ft().host', 5)
log(`dt({host:ft().host count=${dtHits.length}`)
for (const i of dtHits) {
  dump(`gold-dt-host-ft-${i}.txt`, `# dt({host:ft().host @${i}\n${asciiWindow(i - 200, i + 400)}\n`)
}

// REPL function head: walk back for function ...(ge
const bind = 233141792
for (const back of [30000, 50000, 80000]) {
  const win = asciiWindow(bind - back, bind - back + 500)
  log(`REPL-back ${back} head=${win.slice(0, 180).replace(/\n/g, ' ')}`)
}

const replHeads = [
  'function REPL(',
  'function REPL({',
  'session:ge,',
  '{session:ge',
  'ge:e.session',
  'session:uk()',
  'session:ft()',
  'session:n()',
  'ge=ft()',
  'ge=uk()',
]
for (const n of replHeads) {
  const hits = findAll(n, 15)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.slice(0, 8).join(',')}`)
  for (const i of hits) {
    if (i > 231000000 && i < 234500000) {
      log(`  NEAR @${i} ${asciiWindow(i - 80, i + 160).replace(/\n/g, ' ')}`)
      dump(`gold-repl-head-${i}.txt`, `# ${n} @${i}\n${asciiWindow(i - 200, i + 300)}\n`)
    }
  }
}

// useReplBridge S
const sHost = 232466399
dump('gold-S-host-before-3k.txt', `# host:S.host @${sHost} before 3k\n${asciiWindow(sHost - 3000, sHost + 80)}\n`)
const beforeS = asciiWindow(sHost - 3000, sHost)
const sAssign = [...beforeS.matchAll(/let S=|const S=|,S=|S=uk|S=ge|S=ft|session:S|S=n\(\)/g)]
log(`S assigns in -3k: ${sAssign.length}`)
for (const m of sAssign) {
  const abs = sHost - 3000 + m.index
  log(`  @${abs} ${asciiWindow(abs - 30, abs + 90).replace(/\n/g, ' ')}`)
}

// ft() / uk() as session getter near REPL
for (const n of ['ft()', 'uk()', 'tod(', 'dt({host:']) {
  const hits = findAll(n, 25)
  const near = hits.filter((i) => i > 232000000 && i < 234000000)
  log(`${JSON.stringify(n)} total=${hits.length} nearREPL=${near.join(',')}`)
}

dump('gold-8-host-Ghe-scan5.txt', report.join('\n') + '\n')
console.log('DONE pass5', report.length)
