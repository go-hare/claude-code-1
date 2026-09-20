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

function extractFnAt(buf, i, maxLen = 16000) {
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
  `# gold-1-call-ye-E-pass2 247`,
  `exe=${sz247}`,
  '',
]

function dumpHits(label, needle, around = 90) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 16).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > 16) lines.push(`- ... +${hits.length - 16} more`)
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 12000) {
  lines.push(`## function ${label} @${i}`)
  const ext = extractFnAt(b247, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
    lines.push(asciiSlice(b247, i, i + 500))
  }
  lines.push('')
}

for (const n of [
  'function xSa(',
  'async function xSa(',
  'xSa=function',
  'function _Ba(',
  'async function _Ba(',
  '_Ba=function',
  'function Fkd(',
  'async function Fkd(',
  'Fkd=function',
  'function Nw(',
  'async function Nw(',
  'var Nw=',
  'Nw=',
  'async function Dfs(',
  'function Dfs(',
  'onWriteNew',
  'export{xSa',
  'xSa as ye',
  '_Ba as _e',
  'Fkd as E',
  'Nw as q',
]) {
  dumpHits(n, n, 70)
}

for (const n of [
  'function xSa(',
  'async function xSa(',
  'function _Ba(',
  'async function _Ba(',
  'function Fkd(',
  'async function Fkd(',
  'async function Dfs(',
  'function Dfs(',
]) {
  const hits = allHits(b247, n)
  for (const i of hits.slice(0, 4)) dumpFn(n, i, 14000)
}

// Dfs window already found
dumpFn('Dfs@216521705', 216521650, 8000)

// _448 module: find export of xSa/_Ba
dumpHits('_448-root-marker', 'B:/~BUN/root/_448.js', 40)
const m448 = allHits(b247, '// Version: 2.1.247\nimport')
lines.push(`## version-headers count=${m448.length}`)
lines.push('')

// bounded read unique
for (const n of [
  'bytesRead,bytesTotal',
  '{content:',
  'bytesTotal:',
  'gN(',
  'session_file',
  'project_dir_key',
  'getTranscriptPathForSession',
  'getProjectsDir',
]) {
  dumpHits(`read-${n}`, n, 60)
}

// call host: T( after Rs import — search T({messages and o(T
dumpHits('T({', 'T({', 50)
dumpHits('o(T,', 'o(T,', 80)
dumpHits('m(T,', 'm(T,', 80)
dumpHits('S(T,', 'S(T,', 80)
dumpHits('return T(', 'return T(', 80)
dumpHits('children:T(', 'children:T(', 80)

// feedback/bug load assignment later
dumpHits('zHs.load=', 'zHs.load')
dumpHits('HHs.load=', 'HHs.load')
dumpHits('KGt.load=', 'KGt.load')
dumpHits('YGt.load=', 'YGt.load')
dumpHits('zHs,load', 'load:()=>import')

writeFileSync(`${outDir}/gold-1-call-ye-E-pass2.txt`, lines.join('\n'))
console.log('WROTE gold-1-call-ye-E-pass2.txt', lines.join('\n').length)
