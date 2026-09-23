// densable 2.1.248 #48 — dump linux apply around 178758000
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const bL = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248-linux/package/claude',
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

const lines = ['# gold-248-48-linux2', '']
const start = 178757800
const chunk = asciiSlice(bL, start, start + 12000)
writeFileSync(`${outDir}/gold-248-48-linux-apply.txt`, chunk)
lines.push(`window @${start} len=${chunk.length}`)
lines.push(chunk)
lines.push('')

const fnNeedles = [
  'async function D()',
  'function F(e)',
  'function h(e)',
  'async function S()',
  'function R(e)',
  'function A(e,t)',
  'async function tGn()',
  'async function L(',
  'async function GWe()',
  'function eGn()',
  'function M$t()',
  'function j(e)',
]

for (const n of fnNeedles) {
  const i = bL.indexOf(Buffer.from(n), start)
  lines.push(`## ${n} @${i}`)
  const ext = extractFnAt(bL, i, 8000)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

writeFileSync(`${outDir}/gold-248-48-linux2.txt`, lines.join('\n'))
console.log('WROTE linux2', lines.length)
