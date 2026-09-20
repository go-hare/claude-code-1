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

const lines = ['# gold-1-call-ye-E-pass6 247', '']

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
  lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

dumpHits('hCa as', 'hCa as')
dumpHits(' as hCa', ' as hCa')
dumpHits('Ps as Ht', 'Ps as Ht')
dumpHits(' as Ps}', ' as Ps}')
dumpHits('export{Ps', 'export{Ps')
dumpHits('function hCa', 'function hCa')
dumpHits('isSendFeedbackSessionEnabled', 'isSendFeedbackSessionEnabled')
dumpHits('Ufs', 'function Ufs')
dumpHits('feedbackDrafts:', 'feedbackDrafts:')
dumpHits('callLegacyFeedbackDialog', 'callLegacyFeedbackDialog')
dumpHits('renderFeedbackComponent', 'renderFeedbackComponent')
dumpHits('isSidechain===!0', 'isSidechain===!0')
dumpHits('isSidechain!==!0', 'isSidechain!==!0')
dumpHits('!.isSidechain', '!.isSidechain')
dumpHits('filter ye-ish', '.filter((e)=>e.type==="user"')
dumpHits('Es=4194304', 'Es=4194304')
dumpAround('Es-neighbors', 222030618, 80, 200)

// barrel source of kb
dumpHits('export{kb', 'export{kb')
dumpHits('kb as xSa already', 'kb as xSa')
dumpHits('p8 as wSa', 'p8 as wSa')

// _158 exports
dumpHits('_158.js', 'B:/~BUN/root/_158.js')
dumpAround('_158-Ps-Qs', b247.indexOf(Buffer.from('Ps as Ht,Qs as Jt')), 20, 80)

writeFileSync(`${outDir}/gold-1-call-ye-E-pass6.txt`, lines.join('\n'))
console.log('WROTE gold-1-call-ye-E-pass6.txt', lines.join('\n').length)
