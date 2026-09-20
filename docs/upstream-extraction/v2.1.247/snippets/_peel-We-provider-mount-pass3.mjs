/**
 * Pass3: Us as Rz parent + H0/m8/h8 export names + 246 Us leftover.
 * Invent-ban.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf247 = readFileSync(SEA[247])
const buf246 = readFileSync(SEA[246])

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
  return s
}

function compact(s) {
  return s.replace(/[.]{4,}/g, '...').replace(/\n/g, ' ')
}

function isIdentChar(c) {
  return (
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 36 ||
    c === 95
  )
}

function findAll(buf, needle, limit = 80) {
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

function findIdent(buf, ident, start, end, limit = 200) {
  const n = Buffer.from(ident)
  const hits = []
  let from = start
  while (hits.length < limit && from < end) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= end) break
    const prev = i > 0 ? buf[i - 1] : 0
    const next = i + n.length < buf.length ? buf[i + n.length] : 0
    if (!isIdentChar(prev) && !isIdentChar(next)) hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(buf, start) {
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
        return { start, end: i + 1, text: asciiWindow(buf, start, i + 1) }
      }
    }
  }
  return { start, end: start + 400, text: asciiWindow(buf, start, start + 400) }
}

function walkBackFunction(buf, pos, maxBack = 20000) {
  const floor = Math.max(0, pos - maxBack)
  const n = Buffer.from('function ')
  let from = floor
  let last = -1
  while (from < pos) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= pos) break
    last = i
    from = i + n.length
  }
  return last
}

const VER247 = Buffer.from('// Version: 2.1.247')
const VER246 = Buffer.from('// Version: 2.1.246')

function findModuleBounds(buf, near, verNeedle) {
  const start = buf.lastIndexOf(verNeedle, near)
  if (start < 0) return { start: -1, end: -1 }
  const next = buf.indexOf(verNeedle, start + verNeedle.length)
  const bun = Buffer.from('.// @bun @bytecode')
  let end = next >= 0 ? next : buf.length
  const bunAt = buf.indexOf(bun, near)
  if (bunAt >= 0 && bunAt < end) end = bunAt + bun.length
  return { start, end }
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# PASS3 Us/Rz parents + H0 exports + 246 Us')

// full LR export
{
  const exp = 211365263
  dump(
    'gold-We-provider-mount-LR-export-full.txt',
    `# LR export @${exp}\n${asciiWindow(buf247, exp, exp + 2500)}\n`,
  )
  const win = asciiWindow(buf247, exp, exp + 2500)
  for (const name of ['H0', 'm8', 'h8', 'kR', 'n3']) {
    const re = new RegExp(`${name} as ([A-Za-z0-9_$]+)`)
    const m = win.match(re)
    log(`LR-export ${name} => ${m ? m[1] : 'NOT-IN-WINDOW'}`)
  }
}

// search H0 as / m8 as / h8 as globally near export
for (const n of ['H0 as ', 'm8 as ', 'h8 as ', 'function H0(e,o)', 'function m8(', 'function h8(']) {
  const hits = findAll(buf247, n, 15)
  log(`${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 30, i + 100))}`)
  }
}

// Rz imports
log('\n# Rz as (Us export)')
{
  const hits = findAll(buf247, 'Rz as ', 40)
  log(`Rz as count=${hits.length}`)
  for (const i of hits) {
    const win = asciiWindow(buf247, i - 80, i + 160)
    const isUs = win.includes('_253.js') || win.includes('Us as') || win.includes('from"B:/~BUN/root/')
    log(`  @${i} ${compact(win)}`)
  }
}

{
  const hits = findAll(buf247, ' as Rz', 10)
  log(`as Rz count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 40, i + 80))}`)
  }
}

// unique Us props destructure
for (const n of [
  'storageV5:hr,messageQueue',
  'AppStateProvider can not be nested',
  'Us as Rz',
  'function Us(',
  'Tr(hr)',
  'n(Ar,{...Dn,children:_r})',
]) {
  const a = findAll(buf246, n, 8)
  const b = findAll(buf247, n, 8)
  log(`${a.length === b.length ? 'same' : 'DIFF'} 246=${a.length} 247=${b.length} ${JSON.stringify(n)}`)
  for (const i of b.slice(0, 3)) log(`  247 @${i} ${compact(asciiWindow(buf247, i - 20, i + 80))}`)
  for (const i of a.slice(0, 3)) log(`  246 @${i} ${compact(asciiWindow(buf246, i - 20, i + 80))}`)
}

// 246 Us-like: storageV5:hr or Tr(hr) or ubb as Eo mount
for (const n of [
  'storageV5:hr',
  'function Us(',
  'n(Eo,{...',
  'ubb as Eo',
  '{...Dn,children:',
  'Hr===void 0',
  'hr===void 0){return',
]) {
  const hits = findAll(buf246, n, 12)
  log(`246 ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${compact(asciiWindow(buf246, i - 40, i + 140))}`)
  }
}

// H0 callers: H0(  in LR module and globally with ident
{
  const uses = findIdent(buf247, 'H0', 210987644, 211367378, 40)
  log(`H0 ident in LR mod count=${uses.length}`)
  for (const i of uses) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 30, i + 80))}`)
  }
}

{
  const uses = findIdent(buf247, 'm8', 210987644, 211367378, 20)
  log(`m8 ident in LR mod count=${uses.length}`)
  for (const i of uses) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 20, i + 70))}`)
  }
}

{
  const uses = findIdent(buf247, 'h8', 210987644, 211367378, 20)
  log(`h8 ident in LR mod count=${uses.length}`)
  for (const i of uses) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 20, i + 70))}`)
  }
}

dump('gold-We-provider-mount-pass3-scan.txt', report.join('\n') + '\n')
