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

log('# mp pass6 ci/Fs + E/xe')

// ci as hMb @209535572 — find function ci in that module
dump(
  'gold-mp-ci-hMb-export.txt',
  `# ci as hMb @209535572\n${asciiWindow(209535400, 209536000)}\n`,
)

for (const n of [
  'function ci(',
  'function ci()',
  'function ci(){',
  'ci as hMb',
]) {
  const hits = findAll(n, 20)
  log(`CI ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const near = i > 209300000 && i < 209540000
    const fn = n.startsWith('function') ? extractFn(i) : null
    log(
      `  @${i} near585=${near} ${(fn ? fn.text : asciiWindow(i - 30, i + 100)).replace(/\n/g, ' ').slice(0, 220)}`,
    )
  }
}

// function ci in 2093xxxxx-2095xxxxx
{
  const n = Buffer.from('function ci(')
  let from = 209300000
  let c = 0
  while (c < 10) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i > 209540000) break
    const fn = extractFn(i)
    log(`ci-585 @${i} len=${fn.end - i} ${fn.text.slice(0, 300)}`)
    dump(`gold-mp-ci-${i}.txt`, `# @${i} len=${fn.end - i}\n${fn.text}\n`)
    from = i + 10
    c++
  }
}

// E as ydd — keys factory module ~20794xxxx
dump(
  'gold-mp-E-ydd-export.txt',
  `# E as ydd in L export @207949894\n${asciiWindow(207949880, 207950080)}\n`,
)

for (const n of [
  'E as ydd',
  'ydd as xe',
  'function E(e){return e.every',
  'function E(r){return r.every',
]) {
  const hits = findAll(n, 10)
  log(`XE ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 40, i + 140).replace(/\n/g, ' ')}`)
  }
}

// search function E( in keys module 207900000-207952000
{
  const n = Buffer.from('function E(')
  let from = 207900000
  let c = 0
  while (c < 15) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i > 207952000) break
    const fn = extractFn(i)
    log(`E-keys @${i} len=${fn.end - i} ${fn.text.slice(0, 250)}`)
    if (fn.text.includes('every') || fn.end - i < 400) {
      dump(`gold-mp-E-${i}.txt`, `# @${i} len=${fn.end - i}\n${fn.text}\n`)
    }
    from = i + 10
    c++
  }
}

// also C(e) isValidStoragePathSegment style near factory
for (const n of [
  'function C(e){',
  'isValidStoragePathSegment',
  '.every((',
]) {
  const hits = findAll(n, 8)
  log(`SEG ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    const near = i > 207900000 && i < 208000000
    log(`  @${i} nearKeys=${near} ${asciiWindow(i, i + 120).replace(/\n/g, ' ')}`)
  }
}

dump('gold-mp-pass6.txt', report.join('\n') + '\n')
