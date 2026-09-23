// densable 2.1.248 peel pass4 — #37 N() / #48 overflowuid+F1t
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe248 =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const exe247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const b248 = readFileSync(exe248)
const b247 = existsSync(exe247) ? readFileSync(exe247) : null

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

function extractFnAt(buf, i, maxLen = 8000) {
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
  '# gold-248-cache-4  densable 2.1.248 pass4',
  `# 247=${b247 ? b247.length : 'ABSENT'}`,
  `# when=${new Date().toISOString()}`,
  '# NEVER HAVE',
  '',
]

function dumpFn(label, i, maxLen) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

dumpWin('#48 overflowuid-C', 182940121, 400, 600)
dumpFn('#48 C overflowuid', 182940100, 400)
dumpFn('#48 P parse', b248.indexOf(Buffer.from('function P(e){let n=e.trim();if(!/^\\d+$/.test(n))return')), 400)
dumpWin('#48 y=65534', 182939595, 80, 200)
dumpFn('#48 F1t#1', 183796022, 2000)
dumpWin('#48 F1t#1-win', 183796022, 800, 800)

dumpWin('#37 N-invalidSetting', 196196061, 400, 400)
dumpFn('#37 N()', b248.indexOf(Buffer.from('function N(){return k_().errors.some')), 600)

dumpWin('#42 fn.has STREAM', 179035200, 20, 400)

writeFileSync(`${outDir}/gold-248-cache-4.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-cache-4.txt`, lines.length)
