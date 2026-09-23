// Extract tr helpers (bo/wo/ko/_o), SI, Ype, official logs entry.
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

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < b.length) {
    const k = b.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

const lines = ['# gold-248-27-tr-ype', `when=${new Date().toISOString()}`, '']

const tr = 189629037
lines.push('## tr-before-2500')
lines.push(asciiSlice(b, tr - 2500, tr + 500))
lines.push('')

lines.push('## tr-fn')
const trExt = extractFnAt(b, tr, 2000)
lines.push(`len=${trExt.len} sha=${trExt.sha}`)
lines.push(trExt.body || JSON.stringify(trExt))
lines.push('')

// Ype
for (const n of [
  'async function Ype(',
  'function Ype(',
  'Ype()',
  'await Ype()',
]) {
  const hits = allHits(n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    lines.push(`- @${i} ${asciiSlice(b, i - 80, i + n.length + 120)}`)
  }
  lines.push('')
}

const ype = b.indexOf(Buffer.from('async function Ype('))
const ype2 = b.indexOf(Buffer.from('function Ype('))
lines.push(`Ype async @${ype} sync @${ype2}`)
if (ype >= 0) {
  const ext = extractFnAt(b, ype, 4000)
  lines.push(`len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body || JSON.stringify(ext))
}
if (ype2 >= 0 && ype2 !== ype) {
  const ext = extractFnAt(b, ype2, 4000)
  lines.push(`sync len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body || JSON.stringify(ext))
}
lines.push('')

// SI CUP
const si = 181098470
lines.push('## SI-win @181098470')
lines.push(asciiSlice(b, si - 200, si + 400))
lines.push('')
const siExt = extractFnAt(b, si, 400)
lines.push(`SI len=${siExt.len} sha=${siExt.sha}`)
lines.push(siExt.body || '')
lines.push('')

// Rp used by SI
const rpHits = allHits('function Rp(')
lines.push(`## function Rp( hits=${rpHits.length}`)
for (const i of rpHits.slice(0, 6)) {
  if (Math.abs(i - si) < 500000) {
    const ext = extractFnAt(b, i, 800)
    lines.push(`NEAR SI @${i} len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body || JSON.stringify(ext))
  }
}
lines.push('')

// official logs entry
const entry = 178177471
lines.push('## official-logs-entry @178177471')
lines.push(asciiSlice(b, entry - 400, entry + 500))
lines.push('')
// covering fn
let best = -1
for (const n of ['async function ', 'function ']) {
  const needle = Buffer.from(n)
  let i = Math.max(0, entry - 8000)
  while (i < entry) {
    const k = b.indexOf(needle, i)
    if (k < 0 || k >= entry) break
    best = k
    i = k + needle.length
  }
}
lines.push(`## official-logs-covering @${best}`)
const cov = extractFnAt(b, best, 8000)
lines.push(`len=${cov.len} sha=${cov.sha}`)
lines.push(cov.body || JSON.stringify(cov))
lines.push('')

// ko / wo / bo / _o near tr
for (const n of [
  'function ko(',
  'var wo=',
  'var bo=',
  'wo=new Set',
  'var _o=',
  '_o=new Set',
  'function ko(',
]) {
  const hits = allHits(n).filter(i => Math.abs(i - tr) < 20000)
  lines.push(`## near-tr ${n} hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`- @${i} ${asciiSlice(b, i, i + 240)}`)
    const ext = extractFnAt(b, i, 1500)
    if (ext.body) {
      lines.push(`  FN len=${ext.len} sha=${ext.sha}`)
      lines.push(ext.body)
    }
  }
  lines.push('')
}

writeFileSync(`${outDir}/gold-248-27-tr-ype.txt`, lines.join('\n'))
console.log('WROTE', lines.length)
