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

const lines = ['# gold-1-ye-Ht-Jt-DE-pass5 247', '']

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
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

// DE = Ja @208170486
dumpFn('Ja-validateStorageKey', 208170486, 800)
dumpAround('Ja-neighbors', 208170486, 400, 80)

// qcd export from Ja
dumpAround('Ja-as-qcd', 208212142, 80, 200)

// kb as xSa: find the import{ ... }from of THIS occurrence
const kbXsa = 219710851
let importStart = -1
for (let i = kbXsa; i > kbXsa - 20000 && i > 0; i--) {
  if (asciiSlice(b247, i, i + 7) === 'import{') {
    importStart = i
    break
  }
}
dumpAround('kb-xSa-import-start', importStart, 20, 80)
const fromWin = asciiSlice(b247, kbXsa, kbXsa + 4000)
const fromIdx = fromWin.indexOf('}from"')
lines.push('## kb-xSa-from-clause')
lines.push(fromIdx < 0 ? `MISS ${fromWin.slice(-180)}` : fromWin.slice(fromIdx, fromIdx + 80))
lines.push('')

// _448 table export names around xSakb @137431544
dumpAround('_448-table-xSakb', 137431544, 200, 80)

// zI next to kb — is ye the normalize kb?
dumpFn('zI-219409445', 219409445, 400)
dumpAround('kb-then-zI', 219402110, 20, 80)

// _158 module: find Version header that imports little and exports Os,Ps,Qs
// Search unique string from jr import module's sibling
// Look at bun module that IS _158 — table often: <exports>B:/~BUN/root/_158.js
// Search names glued immediately before a lone _158.js (not in a list)
const needle = Buffer.from('B:/~BUN/root/_158.js')
let i = 0
let n = 0
while (n < 20 && i < b247.length) {
  const k = b247.indexOf(needle, i)
  if (k < 0) break
  const before = asciiSlice(b247, k - 80, k)
  const after = asciiSlice(b247, k + needle.length, k + needle.length + 40)
  if (!before.includes('_157.js') && !before.includes('_155.js')) {
    lines.push(`## _158-token-unique #${n} @${k}`)
    lines.push(`${before}|||${after}`)
    lines.push('')
  }
  i = k + needle.length
  n++
}

// Os as Yne usage in the importing module — find Yne( after that import
const yneImport = 232030386
dumpAround('Yne-import-module-use', yneImport, 40, 2500)

// Jt() in Yo already known. Search function that returns survey source near _158
dumpAround('jr-Yo-Jt', 237083451, 20, 200)

writeFileSync(`${outDir}/gold-1-ye-Ht-Jt-DE-pass5.txt`, lines.join('\n'))
console.log('WROTE', lines.join('\n').length)
