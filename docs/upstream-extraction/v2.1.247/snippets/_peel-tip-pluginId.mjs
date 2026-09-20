/**
 * Peel official-247 tip pluginId / Ohe / Nhe / FV / pZe / uk.
 * Invent-ban. Collision-ban Ohe/Nhe/FV/We (short names collide).
 * Do not reopen providerAgnostic / Vhe.
 */
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
  return {
    start: begin,
    end: begin + 200,
    text: asciiWindow(buf, begin, begin + 200),
  }
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

log(`# tip-pluginId peel official-247 size=${buf.length}`)

// Unique (long) needles first — not bare Ohe/Nhe/FV/We
const uniqueNeedles = [
  'if(!r.pluginId)continue',
  'Ohe(r.pluginId)',
  'Nhe(r.id)',
  'FV.of(e.session.host)',
  'pZe.of(uk().host)',
  'function fZe(){return pZe.of',
  'async function Qhe(e){if(MV().spinnerTipsEnabled',
  'pluginId:`${l.name}@${s}`',
  'o.push({id:O,pluginId:',
  'Math.max(s,a)>=EV',
  'fZe().fire(a,s)',
  'getMarketplacePluginTips(e.storageV5)',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 100, i + n.length + 120).replace(/\n/g, ' ')}`,
    )
  }
}

// Collision census (do not treat as unique)
const collideNeedles = [
  'function Ohe(',
  'async function Ohe(',
  'function Nhe(',
  'async function Nhe(',
  'var FV=',
  'FV=new',
  ' as FV',
  'FV as ',
  'function We(',
  'var pZe=',
  'pZe=new',
  ' as pZe',
  'pZe as ',
  'function uk(',
  'function uk()',
  'var uk=',
  ' as uk',
  'uk as ',
  'uk().host',
  'pluginId:',
]

for (const n of collideNeedles) {
  const hits = findAll(n, 30)
  log(`COLLIDE ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 10)) {
    log(`  @${i} ${asciiWindow(buf, i, i + 160).replace(/\n/g, ' ')}`)
  }
}

// Dump Qhe uniquely
const qheHits = findAll('async function Qhe(e){if(MV().spinnerTipsEnabled', 5)
for (const [idx, i] of qheHits.entries()) {
  const fn = extractFn(i)
  dump(
    `gold-tip-pluginId-Qhe-${idx}.txt`,
    `# needle=async function Qhe(e){if(MV().spinnerTipsEnabled pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP Qhe @${i} len=${fn.end - i}`)
  dump(
    `gold-tip-pluginId-Qhe-before-8k-${idx}.txt`,
    `# Qhe@${i} before 8k\n${asciiWindow(buf, i - 8000, i)}\n`,
  )
  dump(
    `gold-tip-pluginId-Qhe-after-2k-${idx}.txt`,
    `# Qhe@${i} after 2k\n${asciiWindow(buf, i, i + 4000)}\n`,
  )
}

// fZe uniquely
const fzeHits = findAll('function fZe(){return pZe.of', 5)
for (const [idx, i] of fzeHits.entries()) {
  const fn = extractFn(i)
  dump(
    `gold-tip-pluginId-fZe-${idx}.txt`,
    `# needle=function fZe(){return pZe.of pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP fZe @${i} len=${fn.end - i}`)
}

// pluginId setter uniquely
const setterHits = findAll('o.push({id:O,pluginId:', 8)
for (const [idx, i] of setterHits.entries()) {
  dump(
    `gold-tip-pluginId-setter-${idx}.txt`,
    `# needle=o.push({id:O,pluginId: pos=${i}\n${asciiWindow(buf, i - 400, i + 900)}\n`,
  )
  log(`DUMP setter @${i}`)
}

// Walk Qhe neighborhood for Ohe/Nhe/FV/pZe/uk defs (same module only)
if (qheHits[0] != null) {
  const q = qheHits[0]
  const neigh = asciiWindow(buf, q - 16000, q + 8000)
  dump(`gold-tip-pluginId-Qhe-neigh-16k.txt`, `# Qhe@${q} ±16k\n${neigh}\n`)

  for (const label of [
    'function Ohe(',
    'function Nhe(',
    'var FV=',
    'FV=new',
    'var pZe=',
    'pZe=new',
    'function uk(',
    'function uk()',
    'var uk=',
    'var EV=',
    'EV=',
  ]) {
    let from = 0
    let n = 0
    while (n < 8) {
      const j = neigh.indexOf(label, from)
      if (j < 0) break
      const abs = q - 16000 + j
      log(
        `NEIGH ${label} @abs=${abs} ${neigh.slice(j, j + 180).replace(/\n/g, ' ')}`,
      )
      from = j + label.length
      n++
    }
    if (n === 0) log(`NEIGH ${label} none in Qhe±16k`)
  }
}

dump('gold-tip-pluginId-scan.txt', report.join('\n') + '\n')
