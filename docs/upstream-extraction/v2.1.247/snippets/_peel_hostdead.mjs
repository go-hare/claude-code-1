import { readFileSync, writeFileSync, existsSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

const buf247 = readFileSync(p247)
const buf246 = existsSync(p246) ? readFileSync(p246) : null

function count(buf, needle) {
  const n = Buffer.from(needle)
  let i = 0
  let c = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

function utf16le(s) {
  return Buffer.from(s, 'utf16le')
}

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function decodeMixed(buf, start, end) {
  const slice = buf.subarray(start, Math.min(end, buf.length))
  // Prefer printable UTF-8 / latin1 with replacement of nonprintables
  let s = ''
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i]
    if (c === 0) {
      // likely utf16 gap
      continue
    }
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{3,}/g, '...')
}

function findAll(buf, needle) {
  const n = Buffer.isBuffer(needle) ? needle : Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

const needles = [
  'EHOSTDEAD',
  'ehostdead',
  'host process died',
  'This session\'s terminal host process died',
  'press Enter to restart',
  'conversation is saved',
  'ESTALLED|EUNVERIFIED|EHOSTDEAD',
  'ESTALLED|EUNVERIFIED',
  'opening…',
  'opening\u2026',
  'Opening…',
  'Opening\u2026',
]

console.log('=== hit counts 247 vs 246 ===')
for (const n of needles) {
  const a = count(buf247, n)
  const b = buf246 ? count(buf246, n) : 'NO246'
  const a16 = count(buf247, utf16le(n))
  const b16 = buf246 ? count(buf246, utf16le(n)) : 'NO246'
  console.log(JSON.stringify(n), 'ascii', a, 'vs', b, 'utf16', a16, 'vs', b16)
}

// dump windows around first ascii/utf16 hits
const dumps = []
function dump(name, needle, before, after, asUtf16 = false) {
  const n = asUtf16 ? utf16le(needle) : Buffer.from(needle)
  const i = buf247.indexOf(n)
  if (i < 0) {
    console.log('MISS', name, needle, asUtf16 ? 'utf16' : 'ascii')
    return
  }
  const start = Math.max(0, i - before)
  const mixed = decodeMixed(buf247, start, i + after)
  const ascii = asciiWindow(buf247, start, i + after)
  dumps.push(`# ${name} offset=${i} utf16=${asUtf16}\n\nASCII:\n${ascii}\n\nMIXED:\n${mixed}\n`)
  console.log('OK', name, i)
}

dump('ehostdead-ascii', 'EHOSTDEAD', 8000, 4000, false)
dump('ehostdead-utf16', 'EHOSTDEAD', 4000, 2000, true)
dump('hostdied-ascii', 'host process died', 4000, 2500, false)
dump('hostdied-utf16', 'host process died', 2000, 1500, true)
dump('saved-ascii', 'the conversation is saved', 2000, 1500, false)
dump('saved-utf16', 'the conversation is saved', 1500, 1000, true)
dump('restart-ascii', 'press Enter to restart', 2000, 1500, false)
dump('restart-utf16', 'press Enter to restart', 1500, 1000, true)
dump('regex-new', 'ESTALLED|EUNVERIFIED|EHOSTDEAD', 3000, 2000, false)
dump('output-gone-ascii', 'its output is gone', 2000, 1500, false)
dump('output-gone-utf16', 'its output is gone', 1500, 1000, true)

// look for JS-like function fragments near EHOSTDEAD
const ehostHits = findAll(buf247, 'EHOSTDEAD')
console.log('EHOSTDEAD ascii hits', ehostHits)

// extract 200 bytes of high-ascii-ratio windows around each hit
for (const [idx, hit] of ehostHits.entries()) {
  const start = Math.max(0, hit - 12000)
  const end = Math.min(buf247.length, hit + 4000)
  const window = buf247.subarray(start, end)
  // collect longest printable runs
  const runs = []
  let cur = ''
  let curStart = 0
  for (let i = 0; i < window.length; i++) {
    const c = window[i]
    if (c >= 32 && c <= 126) {
      if (!cur) curStart = start + i
      cur += String.fromCharCode(c)
    } else {
      if (cur.length >= 40) runs.push({ start: curStart, s: cur })
      cur = ''
    }
  }
  if (cur.length >= 40) runs.push({ start: curStart + window.length, s: cur })
  console.log(`\n--- hit ${idx} @ ${hit} long-runs ${runs.length} ---`)
  for (const r of runs.slice(0, 40)) {
    if (
      /EHOSTDEAD|ehostdead|host process|opening|attach|ENOJOB|ESTALLED|function |return |error/.test(
        r.s,
      )
    ) {
      console.log(r.start, r.s.slice(0, 300))
    }
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-host-died-peel.txt',
  dumps.join('\n====\n'),
)
console.log('wrote gold-host-died-peel.txt', dumps.length)
