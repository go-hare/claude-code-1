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
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 160) }
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
  return { i, missEnd: true, preview: win.slice(0, 200) }
}

const lines = ['# gold-1-call-ye-E-pass4 247', '']

function dumpHits(label, needle, around = 70) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 10).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 6000) {
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

for (const n of [
  'Ns as ',
  'Ms as ',
  'Ls as ',
  'jr as Ns',
  'en as Ms',
  'function zt(',
  'function Ht(',
  'zt()&&',
  'function kb(',
  'kb as xSa',
  'async function Nfs(',
  'Nw,',
  'export{Nw',
  'var Nw=',
]) {
  dumpHits(n, n)
}

// jr is at ~237084800 from previous dump — peel zt/Ht near that module
dumpAround('jr-module-imports', 237083200, 2500, 200)

const jr = b247.indexOf(Buffer.from('async function jr(l,n,c)'))
dumpAround('jr-full', jr, 40, 400)

const kbHits = allHits(b247, 'function kb(')
for (const i of kbHits.slice(0, 6)) dumpFn(`kb@${i}`, i, 4000)

const ztHits = allHits(b247, 'function zt(')
for (const i of ztHits.slice(0, 8)) dumpFn(`zt@${i}`, i, 1500)

const htHits = allHits(b247, 'function Ht(')
for (const i of htHits.slice(0, 8)) dumpFn(`Ht@${i}`, i, 1500)

dumpFn('Nfs@216526035', 216526035, 2500)

// kb as xSa export site
const kbAs = b247.indexOf(Buffer.from('kb as xSa'))
dumpAround('kb-as-xSa', kbAs, 80, 80)

// _205 exports around Nw
const nwExport = b247.indexOf(Buffer.from('Nw as q,Ow as F'))
dumpAround('_205-import-list', nwExport, 20, 40)

// find _205 module export{ ... Nw
const expNw = allHits(b247, 'Nw as')
for (const i of expNw) {
  lines.push(`## Nw-as @${i} ${asciiSlice(b247, i - 60, i + 80)}`)
}
lines.push('')

// command load: Ns / Ms assigned to zHs / HHs
dumpHits('zHs.call', 'zHs.')
dumpHits('load:Ns', 'load:()=>')
dumpHits('jr-call-assign', 'call:jr')
dumpHits('call:Ns', 'call:c')

writeFileSync(`${outDir}/gold-1-call-ye-E-pass4.txt`, lines.join('\n'))
console.log('WROTE gold-1-call-ye-E-pass4.txt', lines.join('\n').length)
