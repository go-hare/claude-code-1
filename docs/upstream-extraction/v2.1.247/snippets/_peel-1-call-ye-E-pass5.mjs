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

const lines = ['# gold-1-call-ye-E-pass5 247', '']

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

function dumpHits(label, needle, around = 70, from = 0, until = b247.length) {
  const hits = allHits(b247, needle, from, until)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 8).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b247, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

// _157 module header (jr lives here)
const jr = b247.indexOf(Buffer.from('async function jr(l,n,c)'))
let hdr = -1
for (const i of allHits(b247, '// Version: 2.1.247\nimport')) {
  if (i < jr && i > jr - 200000) hdr = i
}
dumpAround('_157-header', hdr, 20, 2500)
dumpHits('as zt}', ' as zt}', 50, hdr, jr)
dumpHits('as Ht}', ' as Ht}', 50, hdr, jr)
dumpHits('zt as', 'zt as', 40, hdr, jr + 200)
dumpHits('Ht as', 'Ht as', 40, hdr, jr + 200)

dumpFn('Nfs', 216526035, 2500)
dumpAround('Nfs-win', 216526035, 20, 800)

// kb export module — find function kb just before 219710851
dumpHits('function kb( before xSa export', 'function kb(', 60, 219600000, 219710851)
dumpAround('kb-export-mod', 219710851, 400, 80)

// Es as Nw at 222041092
dumpAround('Es-as-Nw-export', 222041092, 200, 200)
dumpHits('function Es(', 'function Es(', 50, 221900000, 222041200)
dumpHits('var Es=', 'var Es=', 40, 221900000, 222041200)
dumpHits('Es=', 'Es=', 30, 222030000, 222041200)

// next module after jr uses Ns as c
dumpAround('after-jr-importer', 237085165, 20, 4000)
dumpHits('c as call', 'c as call')
dumpHits(',c as ', ',c as ', 40, 237085000, 237200000)
dumpHits('call:c', 'call:c')
dumpHits('load:c', 'load:c')
dumpHits('Ns}', 'Ns}', 40, 237084500, 237200000)

// zHs / HHs later get call from imported chunk
dumpHits('name:"feedback",load', 'name:"feedback"')
dumpHits('HHs={aliases', 'HHs={aliases')
dumpHits('.call=c', '.call=c')
dumpHits('.call=b', '.call=b')
dumpHits('call:b', 'call:b,')
dumpHits('call:c,', 'call:c,')

writeFileSync(`${outDir}/gold-1-call-ye-E-pass5.txt`, lines.join('\n'))
console.log('WROTE gold-1-call-ye-E-pass5.txt', lines.join('\n').length)
