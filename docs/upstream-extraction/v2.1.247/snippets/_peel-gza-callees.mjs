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
  // start at 'function' / 'async function' / 'var NAME='
  let i = start
  while (i < buf.length && buf[i] !== 123) i++ // {
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0 // 0 none, 34 ", 39 ', 96 `
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

log(`# gza callee peel official-247 size=${buf.length}`)

// --- unique strings ---
const uniqueNeedles = [
  'Removed marketplace source:',
  'still declared in another scope',
  'Omit --scope to remove it from all scopes',
  'Removed installed plugin for marketplace removal:',
  'Not marking a symlinked plugin version:',
  'Failed to write .orphaned_at',
  'deletePluginOptions',
  'Failed to delete plugin data dir',
  'pluginSecrets',
  'updateSettingsForSource:',
  'To stop using its plugins: claude plugin disable',
  'To stop using its plugins, disable each one in /plugin',
  'is not declared in',
  'Cannot destructure property \'orphanedPaths\'',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 4)) {
    log(`  @${i} ${asciiWindow(buf, i - 80, i + n.length + 80).replace(/\n/g, ' ')}`)
  }
}

// --- function name hits ---
const fnNeedles = [
  'async function gza(',
  'function gza(',
  'function r0n(',
  'async function r0n(',
  'function _0n(',
  'async function _0n(',
  'function nPe(',
  'async function nPe(',
  'function HFe(',
  'async function HFe(',
  'function dPe(',
  'async function dPe(',
  'function qFe(',
  'async function qFe(',
  'function wB(',
  'async function wB(',
  'function K8(',
  'async function K8(',
  'function Xr(',
  'async function Xr(',
  'var sk=',
  'sk=["userSettings"',
  'sk=["localSettings"',
  'sk=["projectSettings"',
]

for (const n of fnNeedles) {
  const hits = findAll(n, 30)
  log(`FN ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    const win = asciiWindow(buf, i, i + 180).replace(/\n/g, ' ')
    log(`  @${i} ${win}`)
  }
}

// dump full gza
const gzaHits = findAll('async function gza(', 5)
for (const i of gzaHits) {
  const fn = extractFn(i)
  dump(
    'gold-gza-full.txt',
    `# pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP gza @${i} len=${fn.end - i}`)
}

// dump each uniquely-named fn if few hits
for (const [label, needle] of [
  ['r0n', 'function r0n('],
  ['_0n', 'async function _0n('],
  ['_0n-sync', 'function _0n('],
  ['nPe', 'async function nPe('],
  ['nPe-sync', 'function nPe('],
  ['dPe', 'function dPe('],
  ['dPe-async', 'async function dPe('],
  ['qFe', 'function qFe('],
  ['HFe', 'async function HFe('],
  ['HFe-sync', 'function HFe('],
  ['wB', 'async function wB('],
  ['wB-sync', 'function wB('],
  ['K8', 'async function K8('],
  ['K8-sync', 'function K8('],
]) {
  const hits = findAll(needle, 20)
  hits.forEach((i, idx) => {
    const fn = extractFn(i)
    dump(
      `gold-gza-callee-${label}-${idx}.txt`,
      `# needle=${needle} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
  })
}

// gza neighborhood / imports
if (gzaHits[0] != null) {
  const i = gzaHits[0]
  dump(
    'gold-gza-before-8k.txt',
    `# gza@${i} before 8k\n${asciiWindow(buf, i - 8000, i)}\n`,
  )
  dump(
    'gold-gza-after-2k.txt',
    `# gza@${i} after 2k\n${asciiWindow(buf, i, i + 4000)}\n`,
  )
}

// alias / export search
const aliasNeedles = [
  'gza as ',
  ' as wB',
  'wB as ',
  ' as sk',
  'sk as ',
  ' as r0n',
  'r0n as ',
  ' as _0n',
  '_0n as ',
  ' as K8',
  'K8 as ',
  ' as nPe',
  'nPe as ',
  ' as HFe',
  'HFe as ',
  ' as dPe',
  'dPe as ',
  ' as qFe',
  'qFe as ',
  ' as Xr',
  'Xr as ',
]
for (const n of aliasNeedles) {
  const hits = findAll(n, 15)
  log(`ALIAS ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 40, i + 80).replace(/\n/g, ' ')}`)
  }
}

dump('gold-gza-callee-scan.txt', report.join('\n') + '\n')
