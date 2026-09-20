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

log('# mp pass2 bind aliases')

// --- K8-module import windows at known offsets ---
const wins = [
  ['gold-mp-import-Heb.txt', 212808067, 500, 400],
  ['gold-mp-import-Deb-wg.txt', 212807982, 200, 500],
  ['gold-K8-v5-import-Heb-wide.txt', 212807800, 0, 1200],
]

for (const [name, i, before, after] of wins) {
  dump(name, `# @${i}\n${asciiWindow(i - before, i + after)}\n`)
  log(`DUMP ${name} @${i}`)
}

// extract the full import{...}from that contains Heb as mp
{
  const i = 212808067
  let a = i
  while (a > i - 8000 && buf[a] !== 123 /* { */ && asciiWindow(a, a + 7) !== 'import{')
    a--
  // find import{
  const win = asciiWindow(i - 4000, i + 200)
  const idx = win.lastIndexOf('import{')
  const fromIdx = win.indexOf('from"', idx)
  const fromEnd = win.indexOf('"', fromIdx + 5)
  log(`IMPORT-Heb slice idx=${idx} from=${win.slice(fromIdx, fromEnd + 1)}`)
  dump(
    'gold-mp-import-clause-Heb.txt',
    `# around 212808067\n${win.slice(Math.max(0, idx), fromEnd + 20)}\n`,
  )
}

// search export Heb and function that is exported as Heb
for (const n of [
  'Heb as ',
  ',Heb as ',
  '{Heb as ',
  ' as Heb}',
  ' as Heb,',
  'function Heb(',
  'async function Heb(',
  'var Heb=',
  'Heb=',
  'Deb as ',
  ',Deb as ',
  ' as Deb}',
  ' as Deb,',
  'function Deb(',
  'var Deb=',
  'Eeb as ',
  ' as Eeb}',
  ' as Eeb,',
  'Aeb as ',
  ' as ss}',
  ' as ss,',
  ',ss as ',
  '{ss as ',
  'ss as ',
]) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(i - 60, i + 140).replace(/\n/g, ' ')}`)
  }
}

// source ss=".orphaned_at" module exports
dump(
  'gold-mp-ss-orphaned-mod.txt',
  `# ss@211423445\n${asciiWindow(211423300, 211424200)}\n`,
)
dump(
  'gold-mp-ss-exports-after.txt',
  `# after ss toward export\n${asciiWindow(211423445, 211428000)}\n`,
)

// find export{ near ss module — search forward for export{ containing ss
{
  const start = 211423445
  const hits = []
  let from = start
  while (hits.length < 8 && from < start + 200000) {
    const i = buf.indexOf(Buffer.from('export{'), from)
    if (i < 0 || i > start + 200000) break
    hits.push(i)
    from = i + 7
  }
  log(`export{ after ss: ${hits.join(',')}`)
  for (const i of hits.slice(0, 5)) {
    const w = asciiWindow(i, i + 2500)
    const hasSs = w.includes('ss as ') || w.includes('ss as')
    const hasDeb = w.includes('Deb')
    log(`  export@${i} hasSs=${hasSs} hasDeb=${hasDeb} ${w.slice(0, 200)}`)
    if (hasSs || w.includes(' as Deb') || w.includes('ss as')) {
      dump(`gold-mp-ss-export-${i}.txt`, `# export@${i}\n${w}\n`)
    }
  }
}

// pluginCache factory object at 207948340
dump(
  'gold-mp-pluginCache-factory.txt',
  `# @207948340\n${asciiWindow(207948200, 207948800)}\n`,
)

// walk back to object name for pluginCache factory
{
  const i = 207948340
  dump(
    'gold-K8-v5-_r-factory-before.txt',
    `# before pluginCache factory @${i}\n${asciiWindow(i - 2500, i + 400)}\n`,
  )
}

// K8 module import of _r — search import window 212803258..212820000
{
  const win = asciiWindow(212803258, 212820000)
  dump('gold-K8-v5-imports-16k.txt', `# @212803258+16k\n${win}\n`)
  for (const needle of ['_r', 'pluginCache', 'Heb as mp', 'Deb as wg', ' as _r', '_r as']) {
    let idx = 0
    let n = 0
    while (n < 6) {
      const j = win.indexOf(needle, idx)
      if (j < 0) break
      log(`IN16k ${JSON.stringify(needle)} @${212803258 + j} ${win.slice(Math.max(0, j - 40), j + 80).replace(/\n/g, ' ')}`)
      idx = j + needle.length
      n++
    }
  }
}

// dSt / OFe / wg neighborhood
dump(
  'gold-K8-v5-dSt-full.txt',
  `# dSt unique function dSt( count=1 @214510094\n${extractFn(214510094).text}\n`,
)
dump(
  'gold-K8-v5-dSt-neighbors.txt',
  `# dSt neighbors\n${asciiWindow(214509900, 214510400)}\n`,
)

// ra unique
dump(
  'gold-mp-ra-full.txt',
  `# ra unique via function ra(){return Fo(Fs(),"cache")} @214636997\n${extractFn(214636997).text}\n`,
)
dump(
  'gold-K8-v5-ra-neighbors.txt',
  `# ra+QT neighbors\n${asciiWindow(214636900, 214637200)}\n`,
)

// JD unique async
dump(
  'gold-K8-v5-JD-full.txt',
  `# async function JD count=1 @214078883\n${extractFn(214078883).text}\n`,
)
dump(
  'gold-K8-v5-JD-neighbors.txt',
  `# JD neighbors\n${asciiWindow(214078800, 214079200)}\n`,
)

// OFe bind
for (const n of [
  'function OFe(',
  'OFe as ',
  ' as OFe}',
  ' as OFe,',
  ',OFe as ',
  'function Fo(',
  'function Fs(',
  'Fs as ',
  ' as Fs}',
  ' as Fs,',
  'Fo as ',
  ' as Fo}',
  ' as Fo,',
]) {
  const hits = findAll(n, 15)
  log(`BIND ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 50, i + 120).replace(/\n/g, ' ')}`)
  }
}

dump('gold-mp-pass2.txt', report.join('\n') + '\n')
