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

const lines = ['# gold-1-ye-Ht-Jt-DE 247', '']

function dumpHits(label, needle, around = 90, cap = 16) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
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
  return ext
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

function lastFnStart(before, names) {
  let best = -1
  let name = ''
  for (const n of names) {
    const needle = Buffer.from(n)
    let i = 0
    while (i < before) {
      const k = b247.indexOf(needle, i)
      if (k < 0 || k >= before) break
      if (k > best) {
        best = k
        name = n
      }
      i = k + needle.length
    }
  }
  return { i: best, name }
}

// --- ye = xSa = kb ---
dumpHits('xSa as ye', 'xSa as ye')
dumpHits('kb as xSa', 'kb as xSa')
dumpHits('export{kb', 'export{kb')
dumpHits(',kb,', ',kb,')
dumpHits('function kb(', 'function kb(')
dumpHits('async function kb(', 'async function kb(')
dumpHits('isSidechain===!0', 'isSidechain===!0')
dumpHits('sessionMessagesToDraft', 'sessionMessagesToDraft')
dumpHits('u=ye(m)', 'u=ye(m)')

const yeCall = b247.indexOf(Buffer.from('u=ye(m)'))
dumpAround('ot-ye-call', yeCall, 80, 80)

const xSaImport = b247.indexOf(Buffer.from('xSa as ye}from"B:/~BUN/root/_448.js"'))
dumpAround('_448-ye-import', xSaImport, 400, 80)

const kbAsXsa = b247.indexOf(Buffer.from('kb as xSa'))
dumpAround('leftover-kb-as-xSa', kbAsXsa, 200, 200)

// _448 export table / source
dumpHits('_448.js', 'B:/~BUN/root/_448.js', 40, 20)
dumpHits('xSa as', 'xSa as')
dumpHits('function xSa(', 'function xSa(')
dumpHits('xSa=', 'xSa=')

// kb defs that mention user/assistant / isSidechain — scan each kb
const kbHits = allHits(b247, 'function kb(')
lines.push('## kb-bodies-with-message-markers')
for (const i of kbHits) {
  const win = asciiSlice(b247, i, i + 900)
  if (
    win.includes('isSidechain') ||
    win.includes('type!=="user"') ||
    win.includes('type==="assistant"') ||
    win.includes('currentSession') ||
    win.includes('transcript')
  ) {
    lines.push(`- @${i} ${win.slice(0, 220)}`)
    dumpFn(`kb-msg @${i}`, i, 6000)
  }
}
lines.push('')

// --- Ht / Jt from _158 Ps / Qs ---
dumpHits('Ps as Ht,Qs as Jt', 'Ps as Ht,Qs as Jt')
dumpHits('export{Ps,', 'export{Ps')
dumpHits('export{Ps}', 'export{Ps}')
dumpHits('Ps,Qs', 'Ps,Qs')
dumpHits('function Ps(', 'function Ps(')
dumpHits('function Qs(', 'function Qs(')
dumpHits('surveyFeedbackSource', 'surveyFeedbackSource')
dumpHits('Jt()??', 'Jt()??')
dumpHits('Jt()', 'Jt()')

const jrHt = b247.indexOf(Buffer.from('!Ht()'))
dumpAround('jr-Ht-call', jrHt, 120, 80)

// _158 module table near Dyd...LsYoMsenNsjr
const table158 = b247.indexOf(
  Buffer.from('LsYoMsenNsjrB:/~BUN/root/_158.js'),
)
dumpAround('_158-table', table158, 400, 200)

// look for _158 source by unique nearby export names Os/Ps/Qs
dumpHits('function Os(', 'function Os(')
dumpHits('Os as Yne', 'Os as Yne')

// --- DE / ol / _r.transcript ---
dumpHits('DE(s)===void 0', 'DE(s)===void 0')
dumpHits('function DE(', 'function DE(')
dumpHits('function ol(', 'function ol(')
dumpHits('_r.transcript', '_r.transcript')
dumpHits('function Lfs(', 'function Lfs(')

const lfs = b247.indexOf(Buffer.from('function Lfs('))
dumpFn('Lfs', lfs, 1200)
dumpAround('Lfs-win', lfs, 20, 500)

const deHits = allHits(b247, 'function DE(')
for (const [idx, i] of deHits.slice(0, 20).entries()) {
  dumpFn(`DE#${idx}`, i, 2500)
}

const olHits = allHits(b247, 'function ol(')
for (const [idx, i] of olHits.slice(0, 12).entries()) {
  const win = asciiSlice(b247, i, i + 400)
  if (
    win.includes('storage') ||
    win.includes('segment') ||
    win.includes('A-Za-z') ||
    win.includes('relPath') ||
    win.includes('namespace')
  ) {
    dumpFn(`ol-storage#${idx}`, i, 2000)
  } else {
    lines.push(`## ol#${idx} @${i} skip ${win.slice(0, 120)}`)
    lines.push('')
  }
}

// DE used as reject-if-defined near transcript keys
const deCall = b247.indexOf(Buffer.from('DE(s)===void 0?s:void 0'))
dumpAround('Lfs-DE-call', deCall, 80, 80)
const deDefNear = lastFnStart(deCall, ['function DE(', 'function de('])
dumpAround('DE-def-before-Lfs-call', deDefNear.i, 20, 40)
if (deDefNear.i >= 0) dumpFn(`DE-before-call ${deDefNear.name}`, deDefNear.i, 4000)

writeFileSync(`${outDir}/gold-1-ye-Ht-Jt-DE-247.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-1-ye-Ht-Jt-DE-247.txt`, lines.join('\n').length)
