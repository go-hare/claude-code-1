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

function walkBackToFn(pos, maxBack = 4000) {
  const from = Math.max(0, pos - maxBack)
  const win = asciiWindow(from, pos + 1)
  const needles = [
    'async function ',
    'function ',
    'var ',
  ]
  let best = -1
  let kind = ''
  for (const n of needles) {
    let idx = 0
    while (true) {
      const j = win.indexOf(n, idx)
      if (j < 0) break
      const abs = from + j
      if (abs <= pos && abs > best) {
        best = abs
        kind = n
      }
      idx = j + n.length
    }
  }
  return { pos: best, kind }
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

log(`# mp/K8-v5 peel official-247 size=${buf.length}`)

const K8 = 214509181
log(`K8 locked @${K8}`)
log(`K8 body: ${asciiWindow(K8, K8 + 520)}`)

// --- unique strings ---
const uniqueNeedles = [
  'mp(e,ra())',
  'mp(Fo(ra(),"_","_","_"),ra())',
  'function ra(){return Fo(Fs(),"cache")}',
  '_r.pluginCache(',
  'n.marketplace,n.plugin,n.version,[wg]',
  's.marketplace,s.plugin,s.version,[wg]',
  'Not marking a symlinked plugin version:',
  'Failed to write .orphaned_at',
  'Failed to remove .orphaned_at',
  'Failed to stat orphaned marker:',
  'Could not drop a stray orphan marker',
  'plugin cache version parent could not be examined',
  'isSymbolicLink',
  '".orphaned_at"',
  "'.orphaned_at'",
  'wg=".orphaned_at"',
  'var wg=',
  'wg=".orphaned',
  'function dSt(',
  'function mp(',
  'async function mp(',
  'function ra(',
  'function JD(',
  'async function JD(',
  'dSt(e)',
  'await JD(e)',
  'pluginCache:',
  'pluginCache(',
  'namespace:"pluginCache"',
  'Fo(Fs(),"cache")',
  'Fo(e,wg)',
  'Fo(e,".orphaned_at")',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 30)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(i - 70, i + n.length + 90).replace(/\n/g, ' ')}`)
  }
}

// K8 module imports: walk back to last bun header / import block
const bunHdr = Buffer.from('// @bun')
let from = Math.max(0, K8 - 8_000_000)
let lastHdr = -1
while (from < K8) {
  const i = buf.indexOf(bunHdr, from)
  if (i < 0 || i > K8) break
  lastHdr = i
  from = i + 4
}
log(`K8 bun-header last=${lastHdr} dist=${K8 - lastHdr}`)
if (lastHdr > 0) {
  dump(
    'gold-K8-v5-mod-start.txt',
    `# bun-header@${lastHdr} K8@${K8} dist=${K8 - lastHdr}\n${asciiWindow(lastHdr, lastHdr + 6000)}\n`,
  )
}

// imports containing mp / ra / JD / dSt / _r / wg near K8 module start
const importWinStart = lastHdr > 0 ? lastHdr : K8 - 200000
const importWin = asciiWindow(importWinStart, importWinStart + 80000)
dump('gold-K8-v5-mod-imports.txt', `# @${importWinStart}\n${importWin}\n`)

for (const alias of [
  ' as mp}',
  ' as mp,',
  ',mp as ',
  '{mp as ',
  ' as ra}',
  ' as ra,',
  ',ra as ',
  '{ra as ',
  ' as JD}',
  ' as JD,',
  ',JD as ',
  '{JD as ',
  ' as dSt}',
  ' as dSt,',
  ',dSt as ',
  '{dSt as ',
  ' as _r}',
  ' as _r,',
  ',_r as ',
  '{_r as ',
  ' as wg}',
  ' as wg,',
  ',wg as ',
  '{wg as ',
]) {
  const hits = findAll(alias, 25)
  log(`ALIAS ${JSON.stringify(alias)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const nearK8 = Math.abs(i - K8) < 400000
    log(
      `  @${i} nearK8=${nearK8} ${asciiWindow(i - 80, i + 100).replace(/\n/g, ' ')}`,
    )
  }
}

// function defs
for (const n of [
  'function mp(',
  'async function mp(',
  'function ra(',
  'async function ra(',
  'function JD(',
  'async function JD(',
  'function dSt(',
  'async function dSt(',
  'function QT(',
  'var wg=',
  'var _r=',
  '_r={',
]) {
  const hits = findAll(n, 40)
  log(`FN ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 12)) {
    const fn = n.startsWith('var') || n.includes('={') ? null : extractFn(i)
    const win = fn
      ? fn.text.slice(0, 220)
      : asciiWindow(i, i + 220)
    log(`  @${i} ${win.replace(/\n/g, ' ')}`)
  }
}

dump('gold-mp-scan.txt', report.join('\n') + '\n')
