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

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# HP/pendingUsage pass3 — Y$/_448.js increment callers + Iln + pPe')

const needles = [
  'from"B:/~BUN/root/_448.js"',
  'Y$ as qe',
  'Y$ as tsc',
  '$$ as tt',
  '$$ as nsc',
  'Z$ as a',
  'Z$ as xsc',
  'function Iln(',
  'async function Iln(',
  'Iln as caa',
  'pPe as faa',
  'var pPe=',
  'uln({flush:oko,flushAtExit:sko})',
  'function pPe(',
  'faa as ',
  'caa as ',
  'tt(',
  'qe(',
  'Y$(',
]

for (const n of needles) {
  const hits = findAll(n, 25)
  log(`${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 12)) {
    log(`  @${i} ${asciiWindow(i - 90, i + n.length + 140).replace(/\n/g, ' ')}`)
  }
}

// dump each _448.js import
const imp448 = findAll('from"B:/~BUN/root/_448.js"', 20)
log(`\n## all _448.js imports count=${imp448.length}`)
for (const i of imp448) {
  log(`  @${i} ${asciiWindow(i - 400, i + 40).replace(/\n/g, ' ')}`)
  dump(
    `gold-HP-import-448-${i}.txt`,
    `# import _448.js ends @${i}\n${asciiWindow(i - 500, i + 50)}\n`,
  )
}

// Iln extract
for (const n of ['function Iln(', 'async function Iln(']) {
  const hits = findAll(n, 10)
  for (const i of hits) {
    const fn = extractFn(i)
    log(`Iln@${i} end=${fn.end} len=${fn.end - i} ${fn.text.slice(0, 240)}`)
    dump(
      `gold-HP-function-Iln-${i}.txt`,
      `# Iln @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
  }
}

// pPe extract
const pPeHits = findAll('var pPe=w(()=>{Ko();ip();Ls();zC();uln({flush:oko,flushAtExit:sko})})', 5)
log(`pPe unique count=${pPeHits.length} hits=${pPeHits.join(',')}`)
for (const i of pPeHits) {
  log(`  @${i} ${asciiWindow(i, i + 120)}`)
}

// Y$ as qe — is it _448?
log('\n## Y$ as qe neighborhood')
log(asciiWindow(225458800, 225459800))

// $$ as tt neighborhood — confirm _448
log('\n## $$ as tt neighborhood')
log(asciiWindow(222196900, 222197500))

// search unique increment call shapes via export alias
for (const n of [
  'Y$(',
  'qe(',
  'tsc(',
  'dm(e)',
  'recordPlugin',
  'trackPlugin',
  'pluginUsage[',
]) {
  const hits = findAll(n, 8)
  log(`CALL ${JSON.stringify(n)} count=${hits.length}`)
}

dump('gold-HP-pendingUsage-pass3.txt', report.join('\n') + '\n')
log('WROTE gold-HP-pendingUsage-pass3.txt')
