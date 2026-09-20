import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

function extractFnAt(buf, i, maxLen = 4000) {
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
  if (bodyStart < 0) return { i, missEnd: true }
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
  return { i, missEnd: true, preview: win.slice(0, 240) }
}

const lines = ['# gold-1-ye-Ht-Jt-DE-verdict 247', '']

function dumpFn(label, i, maxLen = 2000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b247, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

function dumpHits(label, needle, around = 80, cap = 10) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, off] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${off} ${asciiSlice(b247, off - around, off + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

const ja = b247.indexOf(Buffer.from('function Ja(e){if(typeof e!=="object"||e===null)return s("key"'))
dumpFn('Ja-DE-validateStorageKey', ja, 600)
dumpAround('Ja-export-qcd', 208212142, 40, 80)

// short boolean Ps() candidates
const psHits = allHits(b247, 'function Ps(){')
lines.push('## function Ps(){ all')
for (const off of psHits) {
  const ext = extractFnAt(b247, off, 1200)
  const body = ext.body ?? ext.preview ?? ''
  lines.push(`- @${off} len=${ext.len ?? 'miss'} ${body.slice(0, 180)}`)
}
lines.push('')

const qsHits = allHits(b247, 'function Qs(){')
lines.push('## function Qs(){ all')
for (const off of qsHits) {
  const ext = extractFnAt(b247, off, 1200)
  const body = ext.body ?? ext.preview ?? ''
  lines.push(`- @${off} len=${ext.len ?? 'miss'} ${body.slice(0, 180)}`)
}
lines.push('')

dumpHits('Ps=()=>{', 'Ps=()=>{')
dumpHits('Qs=()=>{', 'Qs=()=>{')
dumpHits('function Ps(){return', 'function Ps(){return')
dumpHits('function Qs(){return', 'function Qs(){return')

// survey getter near feedback
dumpHits('tengu_feedback_survey_config', 'tengu_feedback_survey_config')
dumpHits('good_feedback_survey', 'good_feedback_survey')

const survey = b247.indexOf(Buffer.from('tengu_feedback_survey_config'))
dumpAround('survey-config-fn', survey, 200, 200)

writeFileSync(`${outDir}/gold-1-ye-Ht-Jt-DE-verdict.txt`, lines.join('\n'))
console.log('WROTE', lines.join('\n').length, 'Ja@', ja)
