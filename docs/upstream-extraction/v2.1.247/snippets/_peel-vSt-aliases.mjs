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
    const c = buf[j]
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

// fix typo - I used buf[j] above by mistake. rewrite extractFn properly below.
function extractFn2(start) {
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

log('# vSt alias peel')

const vSt = 214518476
dump(
  'gold-vSt-before-6k.txt',
  `# vSt@${vSt} before 6k\n${asciiWindow(buf, vSt - 6000, vSt)}\n`,
)
dump(
  'gold-vSt-after-nBo.txt',
  `# after vSt through nme\n${asciiWindow(buf, 214520232, 214520232 + 2500)}\n`,
)

const aliasNeedles = [
  ' as qfe',
  'qfe as ',
  'ih as qfe',
  ' as J8',
  'J8 as ',
  ' as BLn',
  'BLn as ',
  ' as jLn',
  'jLn as ',
  ' as kSt',
  'kSt as ',
  ' as WLn',
  'WLn as ',
  ' as QUo',
  'QUo as ',
  ' as Z5',
  'Z5 as ',
  ' as J5',
  'J5 as ',
  ' as wSt',
  'wSt as ',
  ' as FLn',
  'FLn as ',
  ' as ULn',
  'ULn as ',
  ' as JUo',
  'JUo as ',
  ' as SSt',
  'SSt as ',
  ' as nBo',
  'nBo as ',
  ' as eBo',
  'eBo as ',
  ' as wle',
  'wle as ',
  'dirname as BLn',
  'resolve as jLn',
  'join as kSt',
  'sep as eBo',
  'chmod as JUo',
  'rename as SSt',
  'rm as wSt',
  'mkdir as FLn',
  'writeFile as ULn',
  'readFile as QUo',
]

for (const n of aliasNeedles) {
  const hits = findAll(n, 20)
  log(`ALIAS ${JSON.stringify(n)} count=${hits.length} hits=${hits.slice(0, 10).join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 60, i + 100).replace(/\n/g, ' ')}`)
  }
}

// J8(e,t) marketplace-shaped
for (const n of [
  'function J8(e,t)',
  'function J8(e,t,n)',
  'function J8(r,n)',
  'J8(d,BLn',
  'function BLn(e)',
  'BLn=dirname',
  'jLn=resolve',
  'kSt=join',
]) {
  const hits = findAll(n, 12)
  log(`SHAPE ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 4)) {
    log(`  @${i} ${asciiWindow(buf, i, i + 200).replace(/\n/g, ' ')}`)
  }
}

// .gcs-sha bindings
for (const n of [
  '=".gcs-sha"',
  '=".gcs-sha"',
  'ih=".gcs-sha"',
  'qfe=".gcs',
  '".gcs-sha"',
]) {
  const hits = findAll(n, 12)
  log(`GCS ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(buf, i - 80, i + 80).replace(/\n/g, ' ')}`)
    dump(`gold-vSt-gcssha-${i}.txt`, `# ${n} @${i}\n${asciiWindow(buf, i - 200, i + 250)}\n`)
  }
}

// import line containing qfe near marketplace
const qfeImport = findAll('qfe', 40).filter((i) => i > 214510000 && i < 214530000)
log(`qfe-in-vSt-cluster count=${qfeImport.length} hits=${qfeImport.join(',')}`)
for (const i of qfeImport) {
  log(`  @${i} ${asciiWindow(buf, i - 40, i + 60).replace(/\n/g, ' ')}`)
}

dump('gold-vSt-alias-scan.txt', report.join('\n') + '\n')
