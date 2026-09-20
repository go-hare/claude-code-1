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

const lines = ['# gold-1-Ht-Lfs-rgr 247', '']

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

function dumpFn(label, i, maxLen = 2500) {
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
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

// _158 module header near jr import
const hdr = b247.indexOf(Buffer.from('import{Ps as Ht,Qs as Jt}from"B:/~BUN/root/_158.js"'))
dumpAround('_157-imports-158', hdr, 40, 80)

// find _158 export list: unique pair Ps,Qs from same small module
dumpHits('export{Ps,', 'export{Ps')
dumpHits(' as Ps,Qs as ', ' as Ps,Qs as ')
dumpHits('Ps as Ht,Qs', 'Ps as Ht,Qs')
dumpHits('_158.js export map', 'B:/~BUN/root/_158.js')

// bun root table often has export names glued
dumpHits('PsQs _158 table', 'PsHtQsJt')
dumpHits('table 158 names', 'OsYne')

// Lfs / rgr next to Nfs @216526035
dumpAround('Nfs-before-Lfs', 216526035, 2500, 80)
dumpHits('function Lfs(', 'function Lfs(')
dumpHits('Lfs as ', 'Lfs as ')
dumpHits('var rgr=', 'var rgr=')
dumpHits('rgr=', 'rgr=')
dumpHits('function Lfs', 'function Lfs')
dumpHits('Lfs(n,s())', 'Lfs(')

// Qi readTail
dumpHits('readTail(', 'readTail(')
dumpHits('function z_e(', 'function z_e(')
dumpHits('z_e as ', 'z_e as ')

writeFileSync(`${outDir}/gold-1-Ht-Lfs-rgr-247.txt`, lines.join('\n'))
console.log('WROTE', lines.join('\n').length)
