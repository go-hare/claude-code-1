// densable 2.1.248 #48 — UDS client ownership + linux SEA hunt
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe',
)
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

const lines = ['# gold-248-48-uds', '']

function dumpWin(label, buf, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
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

// UDS client ownership
const udsNeedle = 'connected endpoint is owned by uid'
for (const [lab, buf] of [
  ['248', b248],
  ['247', b247],
]) {
  const hits = allHits(buf, udsNeedle)
  lines.push(`## ${lab} ${udsNeedle} hits=${hits.length}`)
  for (const h of hits) {
    dumpWin(`${lab} uds-owned`, buf, h, 2500, 1500)
  }
}

// walk back from 181014450 to function start
dumpWin('248 uds-fn walk', b248, 181014450, 4000, 800)

const fnStarts = [
  181010000, 181011000, 181012000, 181012500, 181013000, 181013500,
]
for (const i of fnStarts) {
  const ext = extractFnAt(b248, i, 12000)
  if (ext.body && ext.body.includes('owned by uid')) {
    lines.push(`## fn from ${i} len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body.slice(0, 4000))
    lines.push('')
  }
}

// hunt linux binaries
const huntRoots = [
  'C:/Users/Administrator/AppData/Local/Temp',
  'C:/Users/Administrator/AppData/Roaming/npm',
  'C:/Users/Administrator/AppData/Local/npm-cache',
  'D:/work/py/claude',
]
const found = []
function walk(dir, depth) {
  if (depth > 4) return
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (
        /official|claude-code|2\.1\.248|linux|darwin/i.test(name) ||
        depth < 2
      ) {
        walk(p, depth + 1)
      }
    } else if (
      /claude/i.test(name) &&
      !name.endsWith('.exe') &&
      st.size > 50_000_000
    ) {
      found.push(`${p} size=${st.size}`)
    }
  }
}
for (const r of huntRoots) walk(r, 0)
lines.push('## linux-ish binaries')
lines.push(found.join('\n') || '(none)')
lines.push('')

writeFileSync(`${outDir}/gold-248-48-uds.txt`, lines.join('\n'))
console.log('WROTE uds', lines.length, 'found', found.length)
