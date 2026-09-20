/**
 * Pass 5: Tm=xod=uk and te=Hnd=wa/ye bodies. Collision-ban Ohe/Nhe/FV/We.
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

log(`# tip-pluginId pass5 size=${buf.length}`)

const expXod = 207022322
const expHnd = 207021885

dump(
  'gold-tip-pluginId-839-export-xod.txt',
  `# Tm as xod @${expXod}\n${asciiWindow(buf, expXod - 400, expXod + 80)}\n`,
)
dump(
  'gold-tip-pluginId-839-export-Hnd.txt',
  `# te as Hnd @${expHnd}\n${asciiWindow(buf, expHnd - 400, expHnd + 80)}\n`,
)

for (const n of [
  'function Tm(',
  'function Tm()',
  'Tm=()=>',
  'var Tm=',
  'class te{',
  'function te(',
  'te=class',
  'class te ',
]) {
  const hits = findAll(n, 20)
  log(`DEF ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i, i + 200).replace(/\n/g, ' ')}`)
  }
}

// Walk back from export for "function Tm" / "class te" in last 80k of _839
const win = asciiWindow(buf, expHnd - 80000, expXod + 20)
for (const label of [
  'function Tm(',
  'function Tm()',
  'Tm(){',
  'function te(',
  'class te{',
  'class te ',
  'te=class',
  'var te=',
  'var Tm=',
]) {
  const j = win.lastIndexOf(label)
  log(
    `BACK839 ${label} ${j < 0 ? 'none' : `@abs=${expHnd - 80000 + j} ${win.slice(j, j + 200).replace(/\n/g, ' ')}`}`,
  )
}

// Unique: Tm as xod neighbor in export list — dump full export{
const expStart = buf.lastIndexOf(Buffer.from('export{'), expXod)
dump(
  'gold-tip-pluginId-839-export-block.txt',
  `# export{ start=${expStart} xod@${expXod} Hnd@${expHnd}\n${asciiWindow(buf, expStart, expXod + 40)}\n`,
)
log(`export{ @${expStart}`)

// If Tm(){ found uniquely near export, extract
const tmHits = findAll('function Tm(', 10)
for (const [n, i] of tmHits.entries()) {
  const fn = extractFn(i)
  dump(
    `gold-tip-pluginId-Tm-${n}.txt`,
    `# function Tm( @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP Tm @${i} len=${fn.end - i}`)
}

const teHits = findAll('class te{', 10)
for (const [n, i] of teHits.entries()) {
  const fn = extractFn(i)
  const text = fn.text.slice(0, 800)
  dump(
    `gold-tip-pluginId-class-te-${n}.txt`,
    `# class te{ @${i} end=${fn.end} len=${fn.end - i}\n${text}\n`,
  )
  log(`DUMP class te @${i} len=${fn.end - i} head=${text.slice(0, 180).replace(/\n/g, ' ')}`)
}

dump('gold-tip-pluginId-scan5.txt', report.join('\n') + '\n')
