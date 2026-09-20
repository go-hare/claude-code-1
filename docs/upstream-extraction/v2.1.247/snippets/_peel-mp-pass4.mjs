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

log('# mp pass4 Fs / zr / xe / Yr / Edd')

// Fs import in K8/ra module
{
  const lo = 212803258
  const hi = 214637100
  for (const n of [' as Fs}', ' as Fs,', 'Fs as ', 'function Fs()']) {
    const needle = Buffer.from(n)
    let from = lo
    let c = 0
    while (c < 12) {
      const i = buf.indexOf(needle, from)
      if (i < 0 || i > hi) break
      log(`K8Fs ${JSON.stringify(n)} @${i} ${asciiWindow(i - 70, i + 120).replace(/\n/g, ' ')}`)
      from = i + n.length
      c++
    }
    if (c === 0) log(`K8Fs ${JSON.stringify(n)} count=0`)
  }
}

// Edd as _r uniqueness
for (const n of ['Edd as _r', 'L as Edd', 'Edd as ']) {
  const hits = findAll(n, 15)
  log(`EDD ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 40, i + 100).replace(/\n/g, ' ')}`)
  }
}

// zr / xe / Yr in sl module
for (const n of [
  'function zr(',
  'function zr(r',
  'function xe(',
  'function xe(e){return e.every',
  'function xe(r){return r.every',
  'function Yr(',
  'function Yr(r){return r.endsWith',
  'function qr(',
]) {
  const hits = findAll(n, 15)
  log(`CAL ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    const fn = n.startsWith('function') ? extractFn(i) : null
    log(
      `  @${i} ${(fn ? fn.text : asciiWindow(i, i + 180)).replace(/\n/g, ' ').slice(0, 260)}`,
    )
  }
}

// zr in 2113xxxxx-2115xxxxx
{
  const n = Buffer.from('function zr(')
  let from = 211300000
  let c = 0
  while (c < 8) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i > 211620000) break
    const fn = extractFn(i)
    log(`zr-ssmod @${i} len=${fn.end - i} ${fn.text.slice(0, 400)}`)
    dump(`gold-mp-zr-${i}.txt`, `# @${i} len=${fn.end - i}\n${fn.text}\n`)
    from = i + 10
    c++
  }
}

{
  const n = Buffer.from('function xe(')
  let from = 211300000
  let c = 0
  while (c < 8) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i > 211620000) break
    const fn = extractFn(i)
    log(`xe-ssmod @${i} len=${fn.end - i} ${fn.text.slice(0, 300)}`)
    dump(`gold-mp-xe-${i}.txt`, `# @${i} len=${fn.end - i}\n${fn.text}\n`)
    from = i + 10
    c++
  }
}

{
  const n = Buffer.from('function Yr(')
  let from = 211300000
  let c = 0
  while (c < 8) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i > 211620000) break
    const fn = extractFn(i)
    log(`Yr-ssmod @${i} len=${fn.end - i} ${fn.text}`)
    dump(`gold-mp-Yr-${i}.txt`, `# @${i} len=${fn.end - i}\n${fn.text}\n`)
    from = i + 10
    c++
  }
}

// Fs definition used by ra — search function Fs in same module via callers
// also getPluginsDirectory style
for (const n of [
  'function Fs(){return',
  'Fs=()=>',
  'join(homedir()',
  '"plugins","cache"',
  ',"plugins")',
  'function Fs(){return Fo(',
]) {
  const hits = findAll(n, 12)
  log(`PLUG ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 30, i + 140).replace(/\n/g, ' ')}`)
  }
}

// Deb as wg uniqueness
for (const n of ['Deb as wg', 'ss as Deb', 'var ss=".orphaned_at"']) {
  const hits = findAll(n, 8)
  log(`WG ${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
}

// Heb as mp uniqueness
for (const n of ['Heb as mp', 'sl as Heb']) {
  const hits = findAll(n, 8)
  log(`MPBIND ${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
}

dump('gold-mp-pass4.txt', report.join('\n') + '\n')
