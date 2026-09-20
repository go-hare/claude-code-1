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

function findFnStartBefore(buf, hit, maxBack = 8000) {
  const start = Math.max(0, hit - maxBack)
  const win = asciiSlice(buf, start, hit + 8)
  let best = -1
  for (const pat of ['async function ', 'function ']) {
    let from = 0
    while (from < win.length) {
      const k = win.indexOf(pat, from)
      if (k < 0 || k > win.length - 8) break
      const after = win.slice(k + pat.length, k + pat.length + 80)
      if (/^[A-Za-z_$][\w$]*\(/.test(after) || after.startsWith('(')) {
        best = start + k
      }
      from = k + pat.length
    }
  }
  return best
}

function extractFnAt(buf, i, maxLen = 20000) {
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { i, missEnd: true, preview: win.slice(0, 200) }
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

const lines = ['# gold-1-call-ye-E-pass3 247', '']

function dumpHits(label, needle, around = 80) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 12).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

function dumpFnFromHit(label, hit, maxBack = 8000, maxLen = 16000) {
  const fnAt = findFnStartBefore(b247, hit, maxBack)
  lines.push(`## ${label} hit=${hit} fnAt=${fnAt}`)
  const ext = extractFnAt(b247, fnAt, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
    dumpAround('preview', hit, 2000, 800)
  }
  lines.push('')
}

dumpFnFromHit('feedback-host-onWriteNew', 237084287, 6000, 12000)
dumpFnFromHit('bug-or-sr-T-messages', 237023038, 4000, 8000)
dumpAround('onWriteNew-host-8k', 237084287, 4000, 1500)
dumpAround('T-messages-4k', 237023038, 2500, 800)

dumpFnFromHit('Ri-tail-read', 207054314, 200, 2500)
dumpAround('Ri-cluster', 207054161, 200, 2500)
dumpAround('Fw-or-export-after-Ri', 207054532, 80, 800)

for (const n of [
  ' as xSa}',
  'xSa as ',
  ' as _Ba}',
  '_Ba as ',
  ' as Fkd}',
  'Fkd as ',
  'Dfs as ',
  ' as Dfs}',
  'export{Dfs',
  'Nfs as ',
  ' as Nfs}',
  'async function Nfs(',
  'function Nfs(',
  'async function Lfs(',
  'function z_e(',
  'var q=1048576',
  'var q=65536',
  'q=1048576',
  'q=65536',
]) {
  dumpHits(n, n, 70)
}

// _205 Nw export window — find module that exports Nw
const nwAsQ = b247.indexOf(Buffer.from('Nw as q'))
dumpAround('Nw-as-q-import', nwAsQ, 200, 200)

const fkdAsE = b247.indexOf(Buffer.from('Fkd as E'))
dumpAround('Fkd-as-E-import', fkdAsE, 80, 200)

// search export lists containing xSa
dumpHits('export-xSa-comma', 'xSa,', 50)
dumpHits('export-_Ba-comma', '_Ba,', 50)
dumpHits('export-Fkd-comma', 'Fkd,', 50)
dumpHits('export-Nw-from205', 'Nw as', 40)

writeFileSync(`${outDir}/gold-1-call-ye-E-pass3.txt`, lines.join('\n'))
console.log('WROTE gold-1-call-ye-E-pass3.txt', lines.join('\n').length)
