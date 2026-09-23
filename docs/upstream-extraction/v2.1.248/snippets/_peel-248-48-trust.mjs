// densable 2.1.248 #48 overflowuid trust apply extract
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe248 =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b248 = readFileSync(exe248)

function asciiSlice(buf, start, end) {
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

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

function extractFnAt(buf, i, maxLen = 20000) {
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { i, missEnd: true }
  let depth = 0
  let inStr = null
  let esc = false
  let closeParen = -1
  for (let p = paren; p < win.length; p++) {
    const c = win[p]
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
        closeParen = p
        break
      }
    }
  }
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  depth = 0
  inStr = null
  esc = false
  for (let p = bodyStart; p < win.length; p++) {
    const c = win[p]
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
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 280) }
}

const lines = [
  '# gold-248-48-trust  densable 2.1.248 #48',
  `# when=${new Date().toISOString()}`,
  '',
]

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

function dumpHits(label, needle, max = 8) {
  const hits = allHits(b248, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h} ${asciiSlice(b248, h - 80, h + 160)}`)
  }
  lines.push('')
}

dumpWin('#48 y=65534 wide', 182939595, 200, 4000)
dumpFn('#48 v uid_map', b248.indexOf(Buffer.from('function v(e){let n=[];for(let t of e.split')), 4000)
dumpFn('#48 N identity', b248.indexOf(Buffer.from('function N(e){return e.length===1&&e[0].innerStart===0')), 400)
dumpFn('#48 C overflowuid', 182940100, 400)
dumpFn('#48 P parse', 182940157, 400)
dumpFn('#48 r4n getuid', b248.indexOf(Buffer.from('async function r4n(){let e=process.getuid')), 400)
dumpFn('#48 F1t uidsCollapse', b248.indexOf(Buffer.from('function F1t(){return qce.uidsCollapse')), 400)
dumpFn('#48 M stub', b248.indexOf(Buffer.from('function M(e){return!1}')), 200)

const needles = [
  '/proc/self/uid_map',
  'uid_map',
  'overflowuid',
  'innerStart',
  'hostStart',
  'uidsCollapse',
  'canonical',
  'root-equivalent',
  'root equivalent',
  'nobody',
  'unmapped',
  'overflow',
  '/proc/sys/kernel/overflowuid',
]
for (const n of needles) dumpHits(n, n, 6)

writeFileSync(`${outDir}/gold-248-48-trust.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-48-trust.txt`, lines.length)
