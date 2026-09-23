// Extract Pmr callees ov / Pi / tr / SI / dn / Pqt / Nj-callers from official-248 SEA.
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b = readFileSync(exe)

function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b2 = Math.min(buf.length, end)
  for (let j = a; j < b2; j++) {
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

function extractFnAt(buf, i, maxLen = 12000) {
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

function lastHitBefore(needle, before, window = 4000000) {
  const n = Buffer.from(needle)
  let best = -1
  let i = Math.max(0, before - window)
  while (i < before) {
    const k = b.indexOf(n, i)
    if (k < 0 || k >= before) break
    best = k
    i = k + n.length
  }
  return best
}

const lines = [
  '# gold-248-27-pmr-callees',
  `exe=${exe}`,
  `bytes=${b.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

const pmr = b.indexOf(Buffer.from('async function Pmr('))
lines.push(`Pmr @${pmr}`)
const pmrExt = extractFnAt(b, pmr, 4000)
lines.push(`Pmr len=${pmrExt.len} sha=${pmrExt.sha}`)
lines.push(pmrExt.body || `MISS ${JSON.stringify(pmrExt)}`)
lines.push('')

function dumpHits(label, needle, cap = 8, around = 90) {
  const hits = allHits(b, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    const near = Math.abs(i - pmr) < 2_500_000 ? ' NEAR' : ''
    lines.push(
      `- #${idx} @${i}${near} ${asciiSlice(b, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractFnAt(b, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

// ov / Pi / tr / SI / dn / Pqt nearest-before Pmr
const needles = [
  'async function ov(',
  'function ov(',
  'function Pi(',
  'async function Pi(',
  'function tr(',
  'async function tr(',
  'function SI(',
  'async function dn(',
  'function dn(',
  'function Pqt(',
  'async function Pqt(',
  'function Ns(',
  'async function Ns(',
  'function En(',
  'async function En(',
  'function Ig(',
  'Pmr as logsHandler',
  'as logsHandler',
  'export{',
]

for (const n of needles) dumpHits(n, n, 6, 70)

const callees = [
  ['ov-async', 'async function ov('],
  ['ov', 'function ov('],
  ['Pi', 'function Pi('],
  ['Pi-async', 'async function Pi('],
  ['tr', 'function tr('],
  ['tr-async', 'async function tr('],
  ['SI', 'function SI('],
  ['dn', 'async function dn('],
  ['dn-sync', 'function dn('],
  ['Pqt', 'function Pqt('],
  ['Ns', 'async function Ns('],
  ['En', 'async function En('],
  ['Ig', 'function Ig('],
]

for (const [name, needle] of callees) {
  const i = lastHitBefore(needle, pmr, 5_000_000)
  lines.push(`## nearest-before-Pmr ${name} @${i} delta=${pmr - i}`)
  dumpFn(`extract ${name}`, i, name === 'tr' || name === 'Pqt' ? 20000 : 8000)
}

// ov stdout-write we already know
dumpFn('ov-stdout-write @187616405', 187616405, 400)

// Pi near that ov
const piNearOv = lastHitBefore('function Pi(', 187616405 + 20000, 50000)
dumpFn('Pi-near-ov-write', piNearOv, 4000)
const piAfterOv = (() => {
  const n = Buffer.from('function Pi(')
  const k = b.indexOf(n, 187616405)
  return k > 0 && k < 187616405 + 200000 ? k : -1
})()
dumpFn('Pi-after-ov-write', piAfterOv, 4000)

// window after Pmr — next functions
lines.push('## after-Pmr-400')
lines.push(asciiSlice(b, pmr, pmr + 900))
lines.push('')

// Nj callers
dumpHits('Nj()', 'Nj()', 10, 50)
dumpHits('cleanupTerminalModes', 'cleanupTerminalModes', 8, 60)

// logsHandler export
dumpHits('logsHandler ident', 'logsHandler', 8, 80)

writeFileSync(`${outDir}/gold-248-27-pmr-callees.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-27-pmr-callees.txt`, 'lines', lines.length)
