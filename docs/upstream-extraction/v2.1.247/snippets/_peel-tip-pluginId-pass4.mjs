/**
 * Pass 4: lock xod=uk() and Hnd=wa WeakOwnerCache. Collision-ban Ohe/Nhe/FV/We.
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

log(`# tip-pluginId pass4 size=${buf.length}`)

const uniqueNeedles = [
  'xod as uk',
  'xod as ',
  ' as xod',
  'Hnd as ye',
  'Hnd as wa',
  'export{h as Td,Lo as Ud,Do as Vd,Pi as Wd',
  'pluginSuggestionShownCounts?.[n]',
  'pluginSuggestionShownCounts??',
  'pluginSuggestionShownCounts:',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 25)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 10)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 80, i + n.length + 160).replace(/\n/g, ' ')}`,
    )
  }
}

// _839.js export of xod / Hnd
const expNeedles = [
  ' as xod',
  'xod as ',
  ' as Hnd',
  'Hnd as ',
]
for (const n of expNeedles) {
  const hits = findAll(n, 20)
  const near = hits.filter((i) => i > 206000000 && i < 208000000)
  log(`NEAR839 ${JSON.stringify(n)} count=${near.length} all=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const win = asciiWindow(buf, i - 60, i + 100)
    if (win.includes('export') || win.includes('_839') || win.includes('WeakMap')) {
      log(`  KEEP @${i} ${win.replace(/\n/g, ' ')}`)
    } else {
      log(`  @${i} ${win.replace(/\n/g, ' ')}`)
    }
  }
}

// WeakMap factory class near Hnd export
const wm = findAll('new WeakMap', 30)
log(`WeakMap count first30=${wm.length}`)

// Find class with .of( that is Hnd — unique: `#e=new WeakMap` + `of(e)` factory
const factoryNeedles = [
  'class ye{',
  'this.#e=new WeakMap',
  '#e=new WeakMap',
  'of(e){let t=this.#e.get(e)',
  'of(e){let t=this.#e.get(e);if(t)return t',
]

for (const n of factoryNeedles) {
  const hits = findAll(n, 15)
  log(`FAC ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i, i + 220).replace(/\n/g, ' ')}`)
  }
}

// uk() zero-arg call sites already 3. Find export xod body via
// "function ...(){return" near session host getter used by xod.
const hostGetters = [
  'function uk(){',
  'uk=()=>',
  '.host}',
  'return{host:',
  'getSession()',
]

for (const n of hostGetters) {
  const hits = findAll(n, 15)
  log(`HG ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i, i + 140).replace(/\n/g, ' ')}`)
  }
}

// dump tips-module export
const exp = findAll('export{h as Td,Lo as Ud,Do as Vd,Pi as Wd', 3)
for (const [n, i] of exp.entries()) {
  dump(
    `gold-tip-pluginId-tips-export-Td-${n}.txt`,
    `# export h as Td @${i}\n${asciiWindow(buf, i - 200, i + 180)}\n`,
  )
  log(`DUMP tips-export @${i}`)
}

dump('gold-tip-pluginId-scan4.txt', report.join('\n') + '\n')
