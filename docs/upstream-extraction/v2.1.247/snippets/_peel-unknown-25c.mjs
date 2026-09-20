/**
 * Phase 3 leftover 247 #25 — extract ke / 246 U+ke / plugin UI sanitizer.
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
  const limit = Math.min(buf.length, bracePos + 250000)
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
  while (i < buf.length) {
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
  return {
    start,
    end: braced.end,
    name,
    async: start !== fnAt,
    len: braced.end - start,
    src,
    sha: sha(src),
  }
}

function extractFunctionByNameNear(buf, name, near, radius = 200000) {
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
        'switch',
        'case',
        'break',
        'continue',
        'default',
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

const near247 = 233803353
const near246 = allHits(b246, 'function U(e){return e.map(')[0] || -1
console.log('246 U-map hit', near246)

for (const [ver, buf, near] of [
  ['247', b247, near247],
  ['246', b246, near246],
]) {
  if (near < 0) {
    console.log(ver, 'no U-map near')
    continue
  }
  dump(
    `gold-25-escape-${ver}-around-U.txt`,
    `# near=${near}\n\n${asciiSlice(buf, near - 2500, near + 1500)}\n`,
  )
  for (const name of ['ke', 'fn', 'Ge', 'U', 'he', 'k', 'A']) {
    const { best, hits, bestDist } = extractFunctionByNameNear(buf, name, near, 80000)
    if (!best) {
      console.log(ver, 'MISS', name, 'hits', hits)
      continue
    }
    console.log(
      ver,
      name,
      'start',
      best.start,
      'len',
      best.len,
      'dist',
      bestDist,
      'sha',
      best.sha,
    )
    if (best.len < 25000) {
      dump(
        `gold-25-escape-fn-${ver}-${name}-${best.start}.txt`,
        `# ${ver} function ${name} start=${best.start} end=${best.end} len=${best.len} sha=${best.sha} dist=${bestDist} hits=${hits}\n\n${best.src}\n`,
      )
    }
  }
}

// Also hunt e.map(ke) / e.map(XX) variants and replace control in plugin chunk
const mapNeedles = [
  'e.map(ke)',
  'e.map(ce)',
  'e.map(le)',
  'e.map(he)',
  'function ke(',
  'function ce(e){return',
  '.replace(/[\\x00',
  '.replace(/[\\u0000',
  'JSON.stringify(e.name',
  'JSON.stringify(n.name',
  'JSON.stringify(t.name',
]
const lines = ['# map/sanitize needles', '']
for (const n of mapNeedles) {
  const a = allHits(b246, n)
  const b = allHits(b247, n)
  lines.push(`${a.length === b.length ? 'same' : 'DIFF'} 246=${a.length} 247=${b.length} ${JSON.stringify(n)}`)
  if (b.length && b.length <= 8) {
    b.forEach((i, idx) => {
      dump(
        `gold-25-escape-map-${idx}-${n.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}.txt`,
        `# 247 @${i}\n\n${asciiSlice(b247, Math.max(0, i - 300), i + 400)}\n`,
      )
    })
  }
}
dump('gold-25-escape-map-counts.txt', lines.join('\n'))

// Compare Er vs br normalized
function loadSrc(name) {
  return readFileSync(`${outDir}/${name}`, 'utf8').split('\n').slice(2).join('\n')
}
try {
  const er = loadSrc('gold-25-escape-fn-list-Er-233787886.txt')
  const br = loadSrc('gold-25-escape-fn-list-246-br-231776794.txt')
  const ner = normalizeJs(er)
  const nbr = normalizeJs(br)
  dump(
    'gold-25-escape-list-compare.txt',
    `# Er vs br rawEq=${er === br} normEq=${ner === nbr} len=${er.length}/${br.length} norm=${ner.length}/${nbr.length} sha=${sha(ner)}/${sha(nbr)}\n`,
  )
  if (ner !== nbr) {
    let firstDiff = -1
    const lim = Math.min(ner.length, nbr.length)
    for (let i = 0; i < lim; i++) {
      if (ner[i] !== nbr[i]) {
        firstDiff = i
        break
      }
    }
    dump(
      'gold-25-escape-list-diffwin.txt',
      `# firstDiff=${firstDiff}\n\n---246---\n${nbr.slice(Math.max(0, firstDiff - 250), firstDiff + 400)}\n\n---247---\n${ner.slice(Math.max(0, firstDiff - 250), firstDiff + 400)}\n`,
    )
  }
} catch (e) {
  console.log('compare fail', e)
}

console.log('phase3 done')
