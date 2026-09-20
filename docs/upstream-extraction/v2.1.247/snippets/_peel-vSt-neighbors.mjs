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

function findAll(needle, limit = 40) {
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
  const p = `${outDir}/${name}`
  writeFileSync(p, content)
  return p
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# vSt neighbors peel')

const clusterLo = 214500000
const clusterHi = 214530000

const needles = [
  'qfe=".gcs-sha"',
  'qfe=".gcs-sha"',
  'var qfe=',
  'qfe=',
  ',qfe=',
  'function J8(',
  'function BLn(',
  'function jLn(',
  'function kSt(',
  'function WLn(',
  'function QUo(',
  'function Z5(',
  'function J5(',
  'function wSt(',
  'async function wSt(',
  'function FLn(',
  'function ULn(',
  'function JUo(',
  'function SSt(',
  'async function SSt(',
  'function nBo(',
  'function Ne(){',
  'var eBo=',
  'eBo=',
  'var zLn=',
  'var HLn=',
  'n.readText',
  'n.writeText',
  'n.write(',
  '.writeText(',
  'readText([p])',
]

for (const n of needles) {
  const hits = findAll(n, 25)
  const inCluster = hits.filter((i) => i >= clusterLo && i <= clusterHi)
  log(
    `N ${JSON.stringify(n)} count=${hits.length} cluster=${inCluster.join(',') || '-'} hits=${hits.slice(0, 12).join(',')}`,
  )
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i - 50, i + 160).replace(/\n/g, ' ')}`)
  }
}

// dump uniquely-named or cluster-unique fns
for (const [label, needle] of [
  ['nBo', 'function nBo('],
  ['J8', 'function J8('],
  ['BLn', 'function BLn('],
  ['jLn', 'function jLn('],
  ['kSt', 'function kSt('],
  ['WLn', 'function WLn('],
  ['QUo', 'function QUo('],
  ['Z5', 'function Z5('],
  ['J5', 'function J5('],
  ['FLn', 'function FLn('],
  ['ULn', 'function ULn('],
  ['JUo', 'function JUo('],
  ['SSt', 'function SSt('],
  ['SSt-async', 'async function SSt('],
  ['wSt', 'function wSt('],
  ['wSt-async', 'async function wSt('],
]) {
  const hits = findAll(needle, 20)
  const prefer = hits.filter((i) => i >= 214000000 && i <= 215000000)
  const chosen = prefer.length ? prefer : hits.slice(0, 3)
  for (const [idx, i] of chosen.slice(0, 3).entries()) {
    const fn = extractFn(i)
    const len = fn.end - i
    if (len > 8000) {
      dump(
        `gold-vSt-nb-${label}-${idx}-${i}-head.txt`,
        `# needle=${needle} pos=${i} end=${fn.end} len=${len} (head 2k)\n${asciiWindow(buf, i, i + 2000)}\n`,
      )
      log(`DUMP ${label} @${i} LARGE len=${len}`)
    } else {
      dump(
        `gold-vSt-nb-${label}-${idx}-${i}.txt`,
        `# needle=${needle} pos=${i} end=${fn.end} len=${len}\n${fn.text}\n`,
      )
      log(`DUMP ${label} @${i} len=${len}`)
    }
  }
}

// qfe assignment windows
for (const n of ['qfe=', 'var qfe=', ',qfe="', 'qfe=".']) {
  const hits = findAll(n, 15)
  for (const i of hits.slice(0, 6)) {
    dump(
      `gold-vSt-qfe-${i}.txt`,
      `# ${n} @${i}\n${asciiWindow(buf, i - 80, i + 200)}\n`,
    )
  }
}

// Ne in marketplace cluster
const neHits = findAll('function Ne(){', 30)
for (const i of neHits) {
  if (i >= 214000000 && i <= 215000000) {
    const fn = extractFn(i)
    dump(
      `gold-vSt-Ne-${i}.txt`,
      `# function Ne(){ pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
    log(`DUMP Ne @${i} len=${fn.end - i}`)
  }
}

dump('gold-vSt-neighbors-scan.txt', report.join('\n') + '\n')
