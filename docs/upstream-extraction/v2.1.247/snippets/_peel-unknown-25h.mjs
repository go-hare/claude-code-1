/**
 * Phase 8 leftover 247 #25 — extract ie/Be/Rt/Ot around oKc and compare 246.
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

function findLast(buf, needle, before, afterFrom) {
  const n = Buffer.from(needle)
  let found = -1
  let from = Math.max(0, afterFrom)
  while (from < before) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= before) break
    found = i
    from = i + 1
  }
  return found
}

function extractFunctionByNameNear(buf, name, near, radius = 80000) {
  const needle = `function ${name}(`
  const hits = allHits(buf, needle)
  let best = null
  let bestDist = Infinity
  for (const i of hits) {
    const fn = extractNamedFunction(buf, i)
    if (!fn || fn.name !== name) continue
    const dist = Math.abs(i - near)
    if (dist < bestDist && dist <= radius) {
      best = fn
      bestDist = dist
    }
  }
  return { best, hits: hits.length, bestDist }
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
        'trim',
        'codePointAt',
        'fromCodePoint',
        'charCodeAt',
        'includes',
        'length',
        'keepEmojiJoiners',
        'keepNewlines',
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

const near247 = 207953491
const near246 = 206352567

dump(
  'gold-25-escape-247-around-re.txt',
  `# around re\n\n${asciiSlice(b247, near247 - 4000, near247 + 2500)}\n`,
)
dump(
  'gold-25-escape-246-around-re.txt',
  `# around re\n\n${asciiSlice(b246, near246 - 4000, near246 + 2500)}\n`,
)

const lines = ['# ie/Be/Rt/Ot around re', '']
for (const [ver, buf, near] of [
  ['247', b247, near247],
  ['246', b246, near246],
]) {
  for (const name of [
    'ie',
    'Be',
    'Rt',
    'Ot',
    're',
    'Io',
    'se',
    'Ve',
    'Wr',
    'zt',
    'Rt',
    'Vr',
    'Fr',
    'Mt',
    'Pt',
  ]) {
    const { best, hits, bestDist } = extractFunctionByNameNear(buf, name, near, 12000)
    if (!best) {
      lines.push(`${ver} MISS ${name} hits=${hits}`)
      continue
    }
    lines.push(
      `${ver} ${name} @${best.start} len=${best.len} dist=${bestDist} sha=${best.sha} hits=${hits}`,
    )
    if (best.len < 20000) {
      dump(
        `gold-25-escape-fn-${ver}-${name}-${best.start}.txt`,
        `# ${ver} function ${name} start=${best.start} end=${best.end} len=${best.len} sha=${best.sha} dist=${bestDist}\n\n${best.src}\n`,
      )
    }
  }
}

// string counts for the fallback copy
for (const n of [
  '(unprintable plugin name)',
  'keepEmojiJoiners',
  'keepNewlines',
  'unprintable plugin',
]) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  lines.push(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} ${JSON.stringify(n)}`)
}

dump('gold-25-escape-ie-index.txt', lines.join('\n'))
console.log('phase8 done')
