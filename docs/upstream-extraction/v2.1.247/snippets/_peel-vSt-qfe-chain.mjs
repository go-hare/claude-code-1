import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

function findAll(needle, limit = 20) {
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
  const begin = start
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
        const end = i + 1
        return { start: begin, end, text: asciiWindow(buf, begin, end) }
      }
    }
  }
  return { start: begin, end: begin + 200, text: asciiWindow(buf, begin, begin + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# vSt qfe/J8 chain')

dump(
  'gold-vSt-import-qfe-J8-block.txt',
  `# 212807500-212810200\n${asciiWindow(buf, 212807500, 212810200)}\n`,
)

dump(
  'gold-vSt-ih-export-211611800.txt',
  `# ih as Feb / ph as Oeb @211611800\n${asciiWindow(buf, 211611800, 211612400)}\n`,
)

dump(
  'gold-vSt-ih-gcssha-211423400.txt',
  `# ih=".gcs-sha" @211423473\n${asciiWindow(buf, 211423400, 211423700)}\n`,
)

dump(
  'gold-vSt-export-vSt-as-hea.txt',
  `# vSt as hea @219687213\n${asciiWindow(buf, 219686900, 219687500)}\n`,
)

// module boundaries between qfe-import and vSt
const bunHits = []
let from = 212808000
const needle = Buffer.from('.// @bun')
while (bunHits.length < 20) {
  const i = buf.indexOf(needle, from)
  if (i < 0 || i > 214520000) break
  bunHits.push(i)
  from = i + needle.length
}
log(`BUN-markers 212808000-214520000 count=${bunHits.length} hits=${bunHits.join(',')}`)
for (const i of bunHits.slice(0, 8)) {
  log(`  @${i} ${asciiWindow(buf, i, i + 80).replace(/\n/g, ' ')}`)
}

for (const n of [
  'function ph(r,n)',
  'function ph(',
  'function ol(r,n)',
  'function ol(',
  'ph as Oeb',
  'Le.marketplaceTree',
  'marketplaceTree',
]) {
  const hits = findAll(n, 12)
  log(`P ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(buf, i, i + 180).replace(/\n/g, ' ')}`)
  }
}

for (const [label, needle2] of [
  ['ph', 'function ph(r,n)'],
  ['ph-any', 'function ph('],
  ['ol', 'function ol(r,n)'],
  ['ch-mkt', 'function ch(r,n,a)'],
]) {
  const hits = findAll(needle2, 8)
  for (const [idx, i] of hits.slice(0, 3).entries()) {
    if (needle2 === 'function ph(' && i !== 211422000 && i < 211400000) {
      // dump all ph; filter later
    }
    const fn = extractFn(i)
    const len = fn.end - i
    dump(
      `gold-vSt-${label}-${idx}-${i}.txt`,
      `# ${needle2} pos=${i} end=${fn.end} len=${len}\n${fn.text}\n`,
    )
    log(`DUMP ${label} @${i} len=${len}`)
  }
}

// Does the 212808021 module mention vSt / _St / qLn in its export?
for (const n of ['vSt as hea', '_St as gea', 'qLn as iea', 'export{vSt', 'vSt as ']) {
  const hits = findAll(n, 8)
  log(`EX ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
}

// n.write / writeText inside the extracted vSt body range only
const body = buf.subarray(214518476, 214520232)
function findIn(hay, n) {
  const b = Buffer.from(n)
  const hits = []
  let f = 0
  while (hits.length < 10) {
    const i = hay.indexOf(b, f)
    if (i < 0) break
    hits.push(214518476 + i)
    f = i + b.length
  }
  return hits
}
for (const n of [
  'n.readText',
  'n.writeText',
  'n.write(',
  '.write(',
  'writeText',
  'catalog',
  'marketplaceCache',
  'qfe',
  'J8(',
  'Ne()',
]) {
  log(`BODY ${JSON.stringify(n)} hits=${findIn(body, n).join(',') || '-'}`)
}

dump('gold-vSt-qfe-chain-scan.txt', report.join('\n') + '\n')
