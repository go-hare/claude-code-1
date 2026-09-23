// densable 2.1.248 #48 — linux SEA overflowuid apply
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const linux =
  'C:/Users/Administrator/AppData/Local/Temp/official-248-linux/package/claude'
const win =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const bL = readFileSync(linux)
const bW = readFileSync(win)

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
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
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

const lines = ['# gold-248-48-linux', `# linux=${bL.length} win=${bW.length}`, '']

function dumpHits(label, needle, max = 8) {
  const hits = allHits(bL, needle)
  lines.push(`## linux ${label} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h}`)
    lines.push(asciiSlice(bL, h - 200, h + 400))
    lines.push('')
  }
}

const needles = [
  'overflowuid',
  'uid_map',
  '/proc/self/uid_map',
  'innerStart',
  'hostStart',
  'var y=65534',
  'async function _(){return}',
  'async function _(){',
  'function v(e){let n=[];for(let t of e.split',
  'canonical',
  'root-equivalent',
  'system dir',
]

for (const n of needles) dumpHits(JSON.stringify(n), n)

const yHits = allHits(bL, 'var y=65534')
if (yHits.length) {
  const yOff = yHits[0]
  lines.push('## linux 6000 after y=65534')
  lines.push(asciiSlice(bL, yOff, yOff + 6000))
  lines.push('')

  const header = Buffer.from('// Version: 2.1.248\n')
  let chunkStart = -1
  for (let i = yOff; i > yOff - 8000; i--) {
    if (bL[i] === header[0] && bL.subarray(i, i + header.length).equals(header)) {
      chunkStart = i
      break
    }
  }
  const nextHeader = bL.indexOf(header, yOff + 20)
  lines.push(`chunkStart=${chunkStart} nextHeader=${nextHeader}`)
  if (chunkStart >= 0 && nextHeader > chunkStart) {
    const chunk = asciiSlice(bL, chunkStart, nextHeader)
    writeFileSync(`${outDir}/gold-248-48-linux-chunk.txt`, chunk)
    lines.push(`chunkLen=${chunk.length} sha=${sha(chunk)}`)
    const exp = chunk.lastIndexOf('export{')
    lines.push('## linux export')
    lines.push(chunk.slice(exp, exp + 500))
  }
}

writeFileSync(`${outDir}/gold-248-48-linux.txt`, lines.join('\n'))
console.log('WROTE linux gold', lines.length)
