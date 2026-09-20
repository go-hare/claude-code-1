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

log('# mp pass3 sl / _r / Fs / vpt')

// --- sl definition (mp source) ---
for (const n of [
  'function sl(',
  'async function sl(',
  'function sl(e',
  'function sl(r',
  'sl=function',
  'var sl=',
  'sl as Heb',
]) {
  const hits = findAll(n, 25)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 10)) {
    const fn = n.startsWith('function') || n.startsWith('async')
      ? extractFn(i)
      : null
    log(
      `  @${i} ${(fn ? fn.text : asciiWindow(i - 40, i + 200)).replace(/\n/g, ' ').slice(0, 280)}`,
    )
    if (fn && fn.text.length < 2000) {
      dump(
        `gold-mp-sl-${i}.txt`,
        `# needle=${n} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
      )
    }
  }
}

// sl neighborhood in ss module (~211422)
dump(
  'gold-mp-sl-near-ss.txt',
  `# around lh/ss 211422000-211424000\n${asciiWindow(211421800, 211424000)}\n`,
)

// search function sl in 2113xxxxx-2116xxxxx
{
  const from = 211300000
  const to = 211620000
  const n = Buffer.from('function sl(')
  let i = from
  let c = 0
  while (c < 10) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j > to) break
    const fn = extractFn(j)
    log(`sl-in-ss-mod @${j} len=${fn.end - j} ${fn.text.slice(0, 300)}`)
    dump(
      `gold-mp-sl-ssmod-${j}.txt`,
      `# @${j} len=${fn.end - j}\n${fn.text}\n`,
    )
    i = j + 10
    c++
  }
}

// --- _r import in K8 module 212803258..214509181 ---
{
  const lo = 212803258
  const hi = 214509181
  for (const n of [' as _r}', ' as _r,', '{_r}', ',_r}', ' as _r from']) {
    const needle = Buffer.from(n)
    let from = lo
    let c = 0
    while (c < 15) {
      const i = buf.indexOf(needle, from)
      if (i < 0 || i > hi) break
      log(`K8mod ${JSON.stringify(n)} @${i} ${asciiWindow(i - 80, i + 120).replace(/\n/g, ' ')}`)
      from = i + n.length
      c++
    }
    if (c === 0) log(`K8mod ${JSON.stringify(n)} count=0`)
  }
}

// keys factory L export
for (const n of [
  ',L as ',
  '{L as ',
  'L as ',
  ' as L}',
  ' as L,',
]) {
  const hits = findAll(n, 20)
  log(`LEXP ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const near = i > 207900000 && i < 208100000
    log(`  @${i} nearFact=${near} ${asciiWindow(i - 50, i + 100).replace(/\n/g, ' ')}`)
  }
}

// factory module export after L=
dump(
  'gold-K8-v5-_r-factory-after.txt',
  `# after L factory @207948800\n${asciiWindow(207948800, 207952000)}\n`,
)

// search export{ after 207948340
{
  const start = 207948340
  let from = start
  let c = 0
  while (c < 6) {
    const i = buf.indexOf(Buffer.from('export{'), from)
    if (i < 0 || i > start + 80000) break
    const w = asciiWindow(i, i + 2000)
    const hasL = /\bL as /.test(w)
    log(`export-after-L @${i} hasL=${hasL} ${w.slice(0, 180)}`)
    if (hasL) dump(`gold-mp-L-export-${i}.txt`, `# @${i}\n${w}\n`)
    from = i + 7
    c++
  }
}

// K8 uses _r.pluginCache — find import of pluginCache factory hashed name in K8 imports
// Look at gold-25 ke module - keys often from _11 or similar
for (const n of [
  'pluginCache:(e,n,a,t)',
  'relPath:t}),cache:',
]) {
  const hits = findAll(n, 5)
  log(`FACT ${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
}

// --- Fs bind in ra module @214636711 ---
dump(
  'gold-mp-ra-imports.txt',
  `# ra module path imports @214636711\n${asciiWindow(214636500, 214637100)}\n`,
)

for (const n of [
  'function Fs()',
  'function Fs(){',
  'Fs as ',
]) {
  const hits = findAll(n, 20)
  log(`FS ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const nearRa = Math.abs(i - 214636997) < 200000
    log(`  @${i} nearRa=${nearRa} ${asciiWindow(i - 40, i + 140).replace(/\n/g, ' ')}`)
  }
}

// search Fs import in ra neighborhood 214630000-214637000
{
  const w = asciiWindow(214630000, 214637050)
  let idx = 0
  let c = 0
  while (c < 10) {
    const j = w.indexOf('Fs', idx)
    if (j < 0) break
    log(`Fs-near-ra @${214630000 + j} ${w.slice(Math.max(0, j - 50), j + 70).replace(/\n/g, ' ')}`)
    idx = j + 2
    c++
  }
}

// JD vpt = lstat?
for (const n of [
  'lstat as vpt',
  ' as vpt}',
  ' as vpt,',
  'function vpt(',
  'vpt as ',
]) {
  const hits = findAll(n, 12)
  log(`VPT ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 50, i + 100).replace(/\n/g, ' ')}`)
  }
}

// JD module imports just before 214078883
dump(
  'gold-K8-v5-JD-imports.txt',
  `# before JD @214078883\n${asciiWindow(214078200, 214078950)}\n`,
)

dump('gold-mp-pass3.txt', report.join('\n') + '\n')
