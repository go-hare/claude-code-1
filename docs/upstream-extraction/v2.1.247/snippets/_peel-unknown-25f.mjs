/**
 * Phase 6 leftover 247 #25 — extract oKc/pKc vs lJc/mJc + unique _g( sites.
 */
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function asciiSlice(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function dump(name, text) {
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name, text.length)
}

function isIdentStart(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95
}
function isIdent(c) {
  return isIdentStart(c) || (c >= 48 && c <= 57)
}
function readIdent(buf, i) {
  if (!isIdentStart(buf[i])) return null
  let j = i
  while (j < buf.length && isIdent(buf[j])) j++
  return buf.toString('ascii', i, j)
}

function extractBraced(buf, bracePos) {
  if (buf[bracePos] !== 123) return null
  let depth = 0
  let i = bracePos
  let inStr = null
  let esc = false
  const limit = Math.min(buf.length, bracePos + 200000)
  while (i < limit) {
    const c = buf[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === 92) esc = true
      else if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inStr = c
      i++
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) return { start: bracePos, end: i + 1 }
    }
    i++
  }
  return null
}

function extractNamedFunction(buf, fnAt) {
  let start = fnAt
  if (fnAt >= 6 && buf.toString('ascii', fnAt - 6, fnAt) === 'async ') start = fnAt - 6
  let i = fnAt + 9
  const name = readIdent(buf, i) || ''
  if (name) i += name.length
  while (i < buf.length && (buf[i] === 32 || buf[i] === 10 || buf[i] === 13)) i++
  if (buf[i] !== 40) return null
  let depth = 0
  let inStr = null
  let esc = false
  while (i < buf.length && i < fnAt + 800) {
    const c = buf[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === 92) esc = true
      else if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inStr = c
      i++
      continue
    }
    if (c === 40) depth++
    else if (c === 41) {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
    i++
  }
  while (i < buf.length && (buf[i] === 32 || buf[i] === 10 || buf[i] === 13)) i++
  if (buf[i] !== 123) return null
  const braced = extractBraced(buf, i)
  if (!braced) return null
  const src = buf.toString('ascii', start, braced.end)
  return { start, end: braced.end, name, len: braced.end - start, src, sha: sha(src) }
}

function normalizeJs(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      let j = i + 1
      let esc = false
      while (j < src.length) {
        const d = src[j]
        if (esc) esc = false
        else if (d === '\\') esc = true
        else if (d === q) {
          j++
          break
        }
        j++
      }
      out += src.slice(i, j)
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++
      const id = src.slice(i, j)
      const keep = new Set([
        'function',
        'async',
        'return',
        'await',
        'const',
        'let',
        'var',
        'if',
        'else',
        'for',
        'of',
        'in',
        'while',
        'try',
        'catch',
        'finally',
        'throw',
        'new',
        'typeof',
        'void',
        'undefined',
        'null',
        'true',
        'false',
        'this',
        'JSON',
        'Object',
        'Array',
        'String',
        'RegExp',
        'map',
        'join',
        'replace',
        'test',
        'slice',
        'split',
        'codePointAt',
        'fromCodePoint',
        'charCodeAt',
        'includes',
        'length',
      ])
      out += keep.has(id) ? id : 'ID'
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

const names = [
  ['247', b247, 'oKc'],
  ['247', b247, 'pKc'],
  ['247', b247, 'tKc'],
  ['247', b247, 'vKc'],
  ['247', b247, 'yKc'],
  ['246', b246, 'lJc'],
  ['246', b246, 'mJc'],
  ['246', b246, 'qJc'],
  ['246', b246, 'sJc'],
  ['246', b246, 'vJc'],
]

const lines = ['# oKc/pKc vs lJc/mJc', '']

for (const [ver, buf, name] of names) {
  const fnHits = allHits(buf, `function ${name}(`)
  const varHits = allHits(buf, `var ${name}=`)
  const exportHits = allHits(buf, `${name} as `)
  lines.push(
    `${ver} ${name} function=${fnHits.length} var=${varHits.length} as=${exportHits.length} fn@${fnHits.slice(0, 6)} var@${varHits.slice(0, 4)}`,
  )
  for (const i of fnHits.slice(0, 4)) {
    const fn = extractNamedFunction(buf, i)
    if (fn) {
      dump(
        `gold-25-escape-${ver}-${name}-${fn.start}.txt`,
        `# ${ver} function ${name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha}\n\n${fn.src}\n`,
      )
      lines.push(`  FN ${name} @${fn.start} len=${fn.len} sha=${fn.sha}`)
    } else {
      dump(
        `gold-25-escape-${ver}-${name}-win-${i}.txt`,
        `# ${ver} ${name} @${i} NOFN\n\n${asciiSlice(buf, i, i + 800)}\n`,
      )
    }
  }
  for (const i of varHits.slice(0, 3)) {
    dump(
      `gold-25-escape-${ver}-var-${name}-${i}.txt`,
      `# ${ver} var ${name} @${i}\n\n${asciiSlice(buf, i, i + 800)}\n`,
    )
  }
}

// chunk file markers
for (const [ver, buf, chunk] of [
  ['247', b247, 'B:/~BUN/root/_712.js'],
  ['246', b246, 'B:/~BUN/root/_708.js'],
]) {
  const hits = allHits(buf, chunk)
  lines.push(`${ver} ${chunk} hits=${hits.length} @${hits.slice(0, 5)}`)
}

// unique _g( contexts
function uniqueCtx(needle, tag) {
  const a = allHits(b246, needle)
  const b = allHits(b247, needle)
  const keys246 = new Set(a.map((i) => asciiSlice(b246, Math.max(0, i - 40), i + 60)))
  const unique = []
  for (const i of b) {
    const k = asciiSlice(b247, Math.max(0, i - 40), i + 60)
    if (!keys246.has(k)) unique.push(i)
  }
  lines.push(`${tag} 246=${a.length} 247=${b.length} uniqueCtx=${unique.length}`)
  unique.slice(0, 20).forEach((i, idx) => {
    dump(
      `gold-25-escape-g-unique-${idx}.txt`,
      `# 247 _g( @${i}\n\n${asciiSlice(b247, Math.max(0, i - 250), i + 350)}\n`,
    )
  })
}
uniqueCtx('_g(', 'g-call')

// function _g(
const g247 = allHits(b247, 'function _g(')
const g246 = allHits(b246, 'function _g(')
lines.push(`function _g( 246=${g246.length} 247=${g247.length}`)
for (const [ver, buf, hits] of [
  ['247', b247, g247],
  ['246', b246, g246],
]) {
  for (const i of hits) {
    const fn = extractNamedFunction(buf, i)
    if (fn) {
      dump(
        `gold-25-escape-${ver}-_g-${fn.start}.txt`,
        `# ${ver} function _g start=${fn.start} len=${fn.len} sha=${fn.sha}\n\n${fn.src}\n`,
      )
      lines.push(`${ver} _g @${fn.start} len=${fn.len} sha=${fn.sha}`)
    } else {
      dump(
        `gold-25-escape-${ver}-_g-win-${i}.txt`,
        `# ${ver} function _g @${i}\n\n${asciiSlice(buf, i, i + 600)}\n`,
      )
    }
  }
}

dump('gold-25-escape-okc-index.txt', lines.join('\n'))
console.log('phase6 done')
