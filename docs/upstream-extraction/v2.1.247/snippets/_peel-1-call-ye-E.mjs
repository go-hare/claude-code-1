import { readFileSync, writeFileSync, statSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const p247 = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const b247 = readFileSync(p247)
const sz247 = statSync(p247).size

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

function allHits(buf, needle, from = 0, until = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (i < until) {
    const k = buf.indexOf(n, i)
    if (k < 0 || k >= until) break
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
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 200) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true, preview: win.slice(0, 200) }
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
  return { i, missEnd: true, preview: win.slice(0, 400) }
}

const lines = [
  `# gold-1-call-ye-E 247`,
  `exe=${sz247} expect=253204128 match=${sz247 === 253204128}`,
  '',
]

function dumpHits(label, needle, from, until, around = 80) {
  const hits = allHits(b247, needle, from, until)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 20).entries()) {
    lines.push(`- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`)
  }
  if (hits.length > 20) lines.push(`- ... +${hits.length - 20} more`)
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## function ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractFnAt(b247, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS body ${JSON.stringify(ext)}`)
    lines.push(asciiSlice(b247, i, i + 400))
  }
  lines.push('')
}

const OT = 232017716
const SR_EXPORT = 237008279
const RS_IMPORT = 237009246

lines.push('## ot module header (20k before ot)')
lines.push(asciiSlice(b247, OT - 20000, OT + 40))
lines.push('')

dumpHits('ye-call-u=ye', 'u=ye(', OT - 5000, OT + 4000, 40)
dumpHits('ye-def-near-ot', 'function ye(', OT - 200000, OT + 50000, 60)
dumpHits('async-ye-near-ot', 'async function ye(', OT - 200000, OT + 50000, 60)
dumpHits('_e-call-await', 'await _e(', OT - 2000, OT + 4000, 40)
dumpHits('_e-def-near-ot', 'function _e(', OT - 200000, OT + 50000, 80)
dumpHits('async-_e-near-ot', 'async function _e(', OT - 400000, OT + 50000, 80)
dumpHits('E-call-E(f,q)', 'await E(f,q)', OT - 2000, OT + 4000, 40)
dumpHits('async-E-near-ot', 'async function E(', OT - 400000, OT + 100000, 80)
dumpHits('function-E-near-ot', 'function E(', OT - 200000, OT + 50000, 60)
dumpHits('var-q-near-ot', 'var q=', OT - 8000, OT + 2000, 40)
dumpHits('session_file-near-ot', 'session_file', OT - 200000, OT + 20000, 80)
dumpHits('bytesRead-near-ot', 'bytesRead', OT - 200000, OT + 20000, 50)
dumpHits('as-ye-import', ' as ye}', OT - 30000, OT + 5000, 80)
dumpHits('as-_e-import', ' as _e}', OT - 30000, OT + 5000, 80)
dumpHits('as-E-import', ' as E}', OT - 30000, OT + 5000, 80)

// extract likely defs
const yeHits = allHits(b247, 'function ye(', OT - 200000, OT + 50000)
for (const i of yeHits.slice(0, 8)) dumpFn(`ye@${i}`, i, 4000)
const _eHits = [
  ...allHits(b247, 'async function _e(', OT - 400000, OT + 50000),
  ...allHits(b247, 'function _e(', OT - 200000, OT + 50000),
]
for (const i of _eHits.slice(0, 8)) dumpFn(`_e@${i}`, i, 4000)
const EHits = allHits(b247, 'async function E(', OT - 400000, OT + 100000)
for (const i of EHits.slice(0, 8)) dumpFn(`E@${i}`, i, 6000)

// unique leftover strings for _e / E / ye
for (const n of [
  'transcript_ref?.session_file',
  'e.transcript_ref',
  'session_file??null',
  'session_file===',
  'bytesRead:M,bytesTotal',
  'content,bytesRead,bytesTotal',
  'isSidechain===!0||!t.message',
  'isSidechain===true',
]) {
  dumpHits(`uniq-${n.slice(0, 28)}`, n, 200000000, 240000000, 70)
}

lines.push('## Rs import host (8k after import)')
lines.push(asciiSlice(b247, RS_IMPORT - 200, RS_IMPORT + 8000))
lines.push('')

lines.push('## sr export tail + next module (4k after export)')
lines.push(asciiSlice(b247, SR_EXPORT - 80, SR_EXPORT + 4000))
lines.push('')

dumpHits('onWriteNew-set', 'onWriteNew:', 236990000, 237040000, 100)
dumpHits('t(T,{messages', 't(T,{', 237009000, 237040000, 80)
dumpHits('i(T,{messages', 'i(T,{', 237009000, 237040000, 80)
dumpHits('e(T,{messages', 'e(T,{', 237009000, 237040000, 80)
dumpHits('T({messages', 'T({messages', 237000000, 237050000, 120)
dumpHits('Rs-as-call-host', 'messages:u,onDone', 237009000, 237050000, 80)
dumpHits('zHs.load', 'zHs.load', 218000000, 220000000, 80)
dumpHits('KGt.load', 'KGt.load', 218000000, 220000000, 80)
dumpHits('HHs.load', 'HHs.load', 218000000, 220000000, 80)
dumpHits('YGt.load', 'YGt.load', 218000000, 220000000, 80)
dumpHits('feedback-load-chunk', 'name:"feedback"', 218600000, 218700000, 40)
dumpHits('import-feedback-chunk', 'chunk-', 237009200, 237012000, 40)

// call function after Rs import
const callNeedles = [
  'async function call(',
  'function call(',
  'export{call',
  'export{zo as call}',
  'onWriteNew:()=>',
  'onWriteNew:h',
  'setWriteNew',
  'Write new feedback',
]
for (const n of callNeedles) {
  dumpHits(`host-${n}`, n, 237009200, 237080000, 80)
}

writeFileSync(`${outDir}/gold-1-call-ye-E-247.txt`, lines.join('\n'))
console.log('WROTE gold-1-call-ye-E-247.txt', lines.join('\n').length)
