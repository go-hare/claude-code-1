import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function extractPrintable(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const c = buf[i]
    if (c === 10 || c === 13 || (c >= 32 && c <= 126)) {
      s += String.fromCharCode(c)
    } else if (c === 9) {
      s += '\t'
    } else {
      s += '\n'
    }
  }
  return s
}

function extractJsRuns(start, end, minLen = 80) {
  const runs = []
  let cur = ''
  let curStart = 0
  for (let i = start; i < end && i < buf.length; i++) {
    const c = buf[i]
    if (c >= 32 && c <= 126) {
      if (!cur) curStart = i
      cur += String.fromCharCode(c)
    } else {
      if (cur.length >= minLen) runs.push({ start: curStart, s: cur })
      cur = ''
    }
  }
  if (cur.length >= minLen) runs.push({ start: start, s: cur })
  return runs
}

// Official attach/host-death module around first function hit
const ANCHOR = 221617693
const start = ANCHOR - 2000
const end = ANCHOR + 40000
const runs = extractJsRuns(start, end, 60)

let out = `# peel attach/host-death JS around ${ANCHOR}\n\n`
for (const r of runs) {
  if (
    /EHOSTDEAD|ehostdead|host process|opening|attach|ENOJOB|ESTALLED|EUNVERIFIED|function |tengu_bg_attach|conversation is saved|press Enter/.test(
      r.s,
    )
  ) {
    out += `\n----- ${r.start} len=${r.s.length} -----\n${r.s}\n`
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-host-died-fn-js.txt',
  out,
)
console.log('wrote gold-host-died-fn-js.txt', out.length, 'runs', runs.length)

// Also extract around the string "This session's terminal host process died"
const s1 = buf.indexOf(Buffer.from("This session's terminal host process died"))
console.log('saved-string ascii @', s1)
const runs2 = extractJsRuns(s1 - 8000, s1 + 4000, 50)
let out2 = `# peel around This session's terminal host process died @ ${s1}\n\n`
for (const r of runs2) {
  out2 += `\n----- ${r.start} len=${r.s.length} -----\n${r.s}\n`
}
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-host-died-saved-js.txt',
  out2,
)
console.log('wrote gold-host-died-saved-js.txt', out2.length)

// Extract around ehostdead lowercase mapping
const s2 = buf.indexOf(Buffer.from('ehostdead'))
console.log('ehostdead first @', s2)
const runs3 = extractJsRuns(s2 - 4000, s2 + 3000, 40)
let out3 = `# peel around ehostdead @ ${s2}\n\n`
for (const r of runs3) {
  out3 += `\n----- ${r.start} len=${r.s.length} -----\n${r.s}\n`
}
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-ehostdead-map-js.txt',
  out3,
)
console.log('wrote gold-ehostdead-map-js.txt')

// opening… utf16 hits
function findUtf16(s) {
  const n = Buffer.from(s, 'utf16le')
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
const openHits = findUtf16('opening\u2026')
console.log('opening… utf16 hits', openHits)
for (const h of openHits) {
  const nearby = extractPrintable(h - 400, h + 400)
  console.log('\n==== opening @', h, '====\n', nearby.replace(/\n{2,}/g, '\n'))
}

// press Enter to restart contexts
const restartHits = []
let i = 0
const n = Buffer.from('press Enter to restart')
while (true) {
  const j = buf.indexOf(n, i)
  if (j < 0) break
  restartHits.push(j)
  i = j + 1
}
console.log('press Enter to restart ascii', restartHits)
for (const h of restartHits) {
  const nearby = extractPrintable(h - 200, h + 250)
  console.log('\n==== restart @', h, '====\n', nearby.replace(/\n{3,}/g, '\n'))
}
