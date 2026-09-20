/**
 * Phase 7 leftover 247 #25 — resolve export aliases oKc/pKc/lJc/mJc.
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
function readIdentBack(buf, end) {
  let i = end
  while (i > 0 && isIdent(buf[i - 1])) i--
  if (i === end || !isIdentStart(buf[i])) return null
  return { name: buf.toString('ascii', i, end), start: i }
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

function readIdent(buf, i) {
  if (!isIdentStart(buf[i])) return null
  let j = i
  while (j < buf.length && isIdent(buf[j])) j++
  return buf.toString('ascii', i, j)
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

const pairs = [
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

const lines = ['# alias resolve', '']

for (const [ver, buf, alias] of pairs) {
  const hits = allHits(buf, ` as ${alias}`)
  lines.push(`${ver} as ${alias} hits=${hits.length} @${hits.slice(0, 8)}`)
  hits.slice(0, 6).forEach((i, idx) => {
    const win = asciiSlice(buf, Math.max(0, i - 200), i + 80)
    dump(
      `gold-25-escape-as-${ver}-${alias}-${idx}.txt`,
      `# ${ver} as ${alias} @${i}\n\n${win}\n`,
    )
    const back = readIdentBack(buf, i)
    lines.push(`  #${idx} @${i} local=${back && back.name}`)
    if (back) {
      const fnAt = findLast(buf, `function ${back.name}(`, i, Math.max(0, i - 200000))
      if (fnAt >= 0) {
        const fn = extractNamedFunction(buf, fnAt)
        if (fn && fn.name === back.name) {
          dump(
            `gold-25-escape-body-${ver}-${alias}-via-${fn.name}-${fn.start}.txt`,
            `# ${ver} ${alias} <= ${fn.name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha}\n\n${fn.src}\n`,
          )
          lines.push(
            `    body ${fn.name} start=${fn.start} len=${fn.len} sha=${fn.sha}`,
          )
        }
      }
    }
  })
}

// specifically dump the plugin-chunk import line fully
const imp247 = allHits(b247, 'oKc as ke,pKc as D,tKc as Wt,vKc as _n,yKc as Vt')
const imp246 = allHits(b246, 'lJc as ke,mJc as D,qJc as Wt,sJc as fn,vJc as Vt')
lines.push(`plugin import 247=${imp247} 246=${imp246}`)
for (const i of imp247) {
  dump(
    `gold-25-escape-plugin-import-247.txt`,
    `# @${i}\n\n${asciiSlice(b247, i - 400, i + 200)}\n`,
  )
}
for (const i of imp246) {
  dump(
    `gold-25-escape-plugin-import-246.txt`,
    `# @${i}\n\n${asciiSlice(b246, i - 400, i + 200)}\n`,
  )
}

dump('gold-25-escape-alias-index.txt', lines.join('\n'))
console.log('phase7 done')
