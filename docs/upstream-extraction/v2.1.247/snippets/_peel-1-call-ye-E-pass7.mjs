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

function extractFnAt(buf, i, maxLen = 3000) {
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

const lines = ['# gold-1-call-ye-E-pass7 247', '']

function dumpHits(label, needle, around = 80) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 8).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

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
  lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

dumpHits('function aLt(', 'function aLt(')
dumpHits('function Ufs(', 'function Ufs(')
dumpHits('function Ffs(', 'function Ffs(')
dumpHits('aLt as hCa', 'aLt as hCa')
dumpHits('Ufs as gCa', 'Ufs as gCa')
dumpHits('DISABLE_FEEDBACK_COMMAND', 'DISABLE_FEEDBACK_COMMAND')
dumpHits('DISABLE_BUG_COMMAND', 'DISABLE_BUG_COMMAND')

const aLt = b247.indexOf(Buffer.from('function aLt('))
const Ufs = b247.indexOf(Buffer.from('function Ufs('))
dumpFn('aLt', aLt, 2500)
dumpFn('Ufs', Ufs, 2500)
dumpAround('Ufs-win', Ufs, 20, 800)
dumpAround('aLt-win', aLt, 20, 800)

// _158 module: find export Ps
dumpHits('export from 158-ish', 'export{Ps as')
dumpHits('_158 export Ps Qs', 'Ps as')
dumpAround('_158-module-search', 237069251, 0, 0)

// find _158 source by unique export pair
dumpHits('Qs as Jt', 'Qs as Jt')
dumpHits('function that exports Ps Qs', 'export{')

// look for _158 file content via Os/Ps/Qs together
dumpHits('Os,Ps,Qs', 'Os as')
dumpHits('_158 Ps def via survey', 'surveyFeedbackSource')

// Ht usage besides jr
dumpHits('!Ht()', '!Ht()')
dumpHits('Ht()', 'Ht()')

writeFileSync(`${outDir}/gold-1-call-ye-E-pass7.txt`, lines.join('\n'))
console.log('WROTE gold-1-call-ye-E-pass7.txt', lines.join('\n').length)
