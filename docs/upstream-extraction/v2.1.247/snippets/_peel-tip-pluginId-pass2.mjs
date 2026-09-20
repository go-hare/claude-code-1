/**
 * Pass 2: lock Ohe/Nhe/FV/uk/wa via unique import+body, not bare names.
 * Collision-ban Ohe/Nhe/FV/We.
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

log(`# tip-pluginId pass2 size=${buf.length}`)

const uniqueNeedles = [
  'tengu_dead_probe_legacy_plugin_tip_counts',
  'class Khe{',
  'var pZe=new wa(()=>new Khe)',
  'var EV=2',
  'var h=new ye(()=>new Xt)',
  'h.of(e.session.host)',
  'h.of(t.session.host)',
  'FV.of(t.session.host)',
  'legacy_plugin_tip',
  'plugin_tip_counts',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 80, i + n.length + 160).replace(/\n/g, ' ')}`,
    )
  }
}

// Alias census — still need uniqueness via neighbor
const aliasNeedles = [
  ' as Ohe',
  'Ohe as ',
  ' as Nhe',
  'Nhe as ',
  ' as wa',
  'wa as ',
  ' as EV',
  'EV as ',
  'h as ',
  ' as h,',
  'Xt as ',
  ' as Xt',
]

for (const n of aliasNeedles) {
  const hits = findAll(n, 25)
  log(`ALIAS ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 12)) {
    log(`  @${i} ${asciiWindow(buf, i - 50, i + 90).replace(/\n/g, ' ')}`)
  }
}

// Qhe-module import head: walk back to nearest "import{" before Qhe
const qhe = 232387553
let importAt = -1
const needle = Buffer.from('import{')
let from = qhe
while (from > 232000000) {
  const i = buf.lastIndexOf(needle, from - 1)
  if (i < 0) break
  const win = asciiWindow(buf, i, i + 200)
  log(`IMPORT-BACK @${i} ${win.replace(/\n/g, ' ')}`)
  if (win.includes(' as FV') || win.includes(' as Ohe') || win.includes(' as uk')) {
    importAt = i
    dump(
      'gold-tip-pluginId-Qhe-import-hit.txt',
      `# import@${i} before Qhe@${qhe}\n${asciiWindow(buf, i, i + 2500)}\n`,
    )
  }
  from = i
  if (qhe - i > 400000) break
}

// Dump all import{ windows in 232020000..232390000 that mention FV/Ohe/Nhe/uk
const rangeStart = 232000000
const rangeEnd = 232390000
from = rangeStart
let idx = 0
while (idx < 40) {
  const i = buf.indexOf(needle, from)
  if (i < 0 || i > rangeEnd) break
  const win = asciiWindow(buf, i, i + 400)
  if (
    win.includes('FV') ||
    win.includes('Ohe') ||
    win.includes('Nhe') ||
    win.includes(' as uk')
  ) {
    dump(
      `gold-tip-pluginId-import-range-${idx}.txt`,
      `# import@${i}\n${asciiWindow(buf, i, i + 1800)}\n`,
    )
    log(`RANGE-IMPORT @${i} ${win.slice(0, 180).replace(/\n/g, ' ')}`)
    idx++
  }
  from = i + 7
}

// Find Ohe/Nhe assignment forms (not function Ohe)
for (const n of [
  'var Ohe=',
  'Ohe=e=>',
  'Ohe=(e)',
  'Ohe=function',
  'var Nhe=',
  'Nhe=e=>',
  'Nhe=(e)',
  'Nhe=function',
  'function Ohe(e){',
  'function Nhe(e){',
]) {
  const hits = findAll(n, 15)
  log(`DEF ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i, i + 200).replace(/\n/g, ' ')}`)
  }
}

// Khe full class
const kheHits = findAll('class Khe{', 5)
for (const [n, i] of kheHits.entries()) {
  const fn = extractFn(i)
  dump(
    `gold-tip-pluginId-Khe-${n}.txt`,
    `# class Khe pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP Khe @${i} len=${fn.end - i}`)
}

// h=new ye Xt
const hHits = findAll('var h=new ye(()=>new Xt)', 5)
for (const [n, i] of hHits.entries()) {
  dump(
    `gold-tip-pluginId-h-Xt-${n}.txt`,
    `# var h=new ye(()=>new Xt) pos=${i}\n${asciiWindow(buf, i - 200, i + 400)}\n`,
  )
  log(`DUMP h-Xt @${i}`)
}

// module export near Xt / h
const exportNeedles = [
  'h as ',
  'Xt as ',
  'export{',
]
for (const n of exportNeedles) {
  const hits = findAll(n, 20)
  // only those near 222270000 (tips module)
  const near = hits.filter((i) => i > 222250000 && i < 222320000)
  log(`TIPS-MOD ${JSON.stringify(n)} near-tips count=${near.length} hits=${near.join(',')}`)
  for (const i of near.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i - 80, i + 200).replace(/\n/g, ' ')}`)
    dump(
      `gold-tip-pluginId-tips-export-${i}.txt`,
      `# ${n} @${i}\n${asciiWindow(buf, i - 200, i + 500)}\n`,
    )
  }
}

dump('gold-tip-pluginId-scan2.txt', report.join('\n') + '\n')
