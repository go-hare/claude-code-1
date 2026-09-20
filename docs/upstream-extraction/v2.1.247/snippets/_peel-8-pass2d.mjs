/**
 * #8 pass2d — Mue (Zvb import) uses; uD vs zO persist-dir; local persist miss.
 */
import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 80) break
  }
  return hits
}

function isIdentChar(c) {
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 36 ||
    c === 95
  )
}

function identHits(buf, ident) {
  const n = Buffer.from(ident)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    const prev = j > 0 ? buf[j - 1] : 0
    const next = buf[j + n.length]
    if (!isIdentChar(prev) && !isIdentChar(next)) hits.push(j)
    i = j + n.length
    if (hits.length > 60) break
  }
  return hits
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

function extractFn(buf, off, maxLen = 4000) {
  const src = asciiWindow(buf, off, off + maxLen)
  const paren = src.indexOf('(')
  let depth = 0
  let i = paren
  let inStr = null
  let esc = false
  for (; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
  }
  const brace = src.indexOf('{', i)
  depth = 0
  inStr = null
  esc = false
  for (let j = brace; j < src.length; j++) {
    const c = src[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(0, j + 1)
    }
  }
  return src.slice(0, 240)
}

// Mue uses
{
  const hits = identHits(buf247, 'Mue')
  console.log('Mue hits', hits.length)
  const lines = [`# Mue hits=${hits.length}`]
  hits.forEach((off, i) => {
    const s = asciiWindow(buf247, Math.max(0, off - 120), off + 200)
    const ratio = (s.match(/[\t\n\r\x20-\x7e]/g) || []).length / s.length
    lines.push(`# h${i} off=${off} ratio=${ratio.toFixed(3)} ${JSON.stringify(s.replace(/\s+/g, ' ').slice(0, 180))}`)
    if (ratio >= 0.8 && i < 16) {
      dump(`gold-8-pass2-Mue-h${i}-247.txt`, `# off=${off}\n\n${s}\n`)
    }
  })
  dump('gold-8-pass2-Mue-index-247.txt', lines.join('\n') + '\n')
}

for (const n of [
  'Mue as ',
  'threshold:r=Mue',
  'length<=Mue',
  'slice(0,Mue',
  'Mue)',
  ',Mue)',
  ',Mue,',
]) {
  const hits = allHits(buf247, n)
  console.log('247', JSON.stringify(n), hits.length, hits.slice(0, 6))
  hits.slice(0, 3).forEach((off, i) => {
    dump(
      `gold-8-pass2-Mueuse-${n.replace(/[^A-Za-z0-9]+/g, '')}-h${i}-247.txt`,
      `# off=${off}\n\n${asciiWindow(buf247, Math.max(0, off - 150), off + 250)}\n`,
    )
  })
}

// uD / zO — persist dir ensure
function findFn(buf, name, near) {
  const needles = [`async function ${name}(`, `function ${name}(`]
  let best = -1
  for (const n of needles) {
    const hits = allHits(buf, n)
    for (const h of hits) {
      if (h < near && h > best) best = h
    }
  }
  return best
}

const vpOff = 213663198
const apOff = 212296306
const uD = findFn(buf247, 'uD', vpOff)
const zO = findFn(buf246, 'zO', apOff)
console.log({ uD, zO })
if (uD >= 0) dump('gold-8-pass2-uD-247.txt', `# off=${uD}\n\n${extractFn(buf247, uD, 3000)}\n`)
if (zO >= 0) dump('gold-8-pass2-zO-246.txt', `# off=${zO}\n\n${extractFn(buf246, zO, 3000)}\n`)

// also dump first async function uD / function uD
for (const n of ['async function uD(', 'function uD(', 'async function zO(', 'function zO(']) {
  console.log(JSON.stringify(n), '247', allHits(buf247, n), '246', allHits(buf246, n))
}

// Normalize VP vs AP for the uD(n,r) vs zO(n) only
const vp = asciiWindow(buf247, vpOff, vpOff + 900)
const ap = asciiWindow(buf246, apOff, apOff + 900)
dump('gold-8-pass2-VP-AP-head.txt', `# 247 VP\n${vp.slice(0, 220)}\n\n# 246 AP\n${ap.slice(0, 220)}\n`)

// 246 twin of Mue? search sibling import of last family const
// 246 family last is Bs=1e4 → lHb → BBr (persist). No extra 1e4.
// Confirm no 246 export of a second 1e4 from that var list.

// bg-agent: look at LocalAgentTask error attach strings unique?
const more = [
  'subagent error',
  'Subagent error',
  'agent output',
  'Agent output',
  'background task error',
  'task error:',
  'error text',
  'errorText',
  'stderr to the conversation',
  'into the conversation',
]
console.log('\n=== more bg ===')
for (const n of more) {
  const a = allHits(buf246, n).length
  const b = allHits(buf247, n).length
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

// Confirm persist kinds still no stderr
for (const n of [
  ',"stderr",{storageV5',
  'blockingError:await',
  'lre(he.stderr',
  'Rne(ye.stderr',
]) {
  console.log(JSON.stringify(n), allHits(buf246, n).length, allHits(buf247, n).length)
}

console.log('DONE pass2d')
