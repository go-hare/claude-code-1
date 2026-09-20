/**
 * Phase 4 leftover 247 #25 — all function ke() bodies + plugin-chunk ke binding.
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
  const limit = Math.min(buf.length, bracePos + 80000)
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
  while (i < buf.length && i < fnAt + 400) {
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
    len: braced.end - start,
    src,
    sha: sha(src),
  }
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

function collectKe(buf, ver) {
  const hits = allHits(buf, 'function ke(')
  const fns = []
  for (const i of hits) {
    const fn = extractNamedFunction(buf, i)
    if (!fn || fn.name !== 'ke') continue
    fns.push(fn)
  }
  return { hits: hits.length, fns }
}

const a = collectKe(b246, '246')
const b = collectKe(b247, '247')
console.log('ke extracted', a.fns.length, '/', a.hits, 'vs', b.fns.length, '/', b.hits)

const small246 = a.fns.filter((f) => f.len < 4000)
const small247 = b.fns.filter((f) => f.len < 4000)
console.log('small ke', small246.length, small247.length)

const norm246 = new Map()
for (const f of small246) {
  const n = normalizeJs(f.src)
  const list = norm246.get(n) || []
  list.push(f)
  norm246.set(n, list)
}

const unique247 = []
for (const f of small247) {
  const n = normalizeJs(f.src)
  if (!norm246.has(n)) unique247.push(f)
}

console.log('unique small ke 247', unique247.length)
const lines = [
  `# ke inventory 246 extracted=${a.fns.length}/${a.hits} 247=${b.fns.length}/${b.hits}`,
  `small 246=${small246.length} 247=${small247.length} uniqueNorm247=${unique247.length}`,
  '',
]
for (const f of unique247) {
  lines.push(`UNIQUE 247 ke @${f.start} len=${f.len} sha=${f.sha}`)
  dump(
    `gold-25-escape-ke-unique-${f.start}.txt`,
    `# 247 function ke start=${f.start} end=${f.end} len=${f.len} sha=${f.sha}\n\n${f.src}\n`,
  )
}

// size histogram
const hist = (fns) => {
  const h = {}
  for (const f of fns) {
    const bucket = f.len < 80 ? '<80' : f.len < 200 ? '<200' : f.len < 800 ? '<800' : f.len < 4000 ? '<4k' : 'big'
    h[bucket] = (h[bucket] || 0) + 1
  }
  return h
}
lines.push(`hist246 ${JSON.stringify(hist(a.fns))}`)
lines.push(`hist247 ${JSON.stringify(hist(b.fns))}`)

// dump all small ke from 247 that contain replace/x1b/FFFD/control
const interesting = small247.filter((f) =>
  /replace|\\\\x1b|\\\\u001b|FFFD|\\\\x00|inspect|stringify|Cc|bidi|OSC|escape|sanitize|unprintable/i.test(
    f.src,
  ),
)
lines.push(`interesting247=${interesting.length}`)
for (const f of interesting) {
  lines.push(`INT 247 ke @${f.start} len=${f.len} sha=${f.sha}`)
  dump(
    `gold-25-escape-ke-int-${f.start}.txt`,
    `# 247 function ke start=${f.start} end=${f.end} len=${f.len} sha=${f.sha}\n\n${f.src}\n`,
  )
}

const interesting246 = small246.filter((f) =>
  /replace|\\\\x1b|\\\\u001b|FFFD|\\\\x00|inspect|stringify|Cc|bidi|OSC|escape|sanitize|unprintable/i.test(
    f.src,
  ),
)
lines.push(`interesting246=${interesting246.length}`)
for (const f of interesting246) {
  lines.push(`INT 246 ke @${f.start} len=${f.len} sha=${f.sha}`)
}

// plugin-chunk ke binding: search backward from U for ke=
const u247 = 233803353
const win = asciiSlice(b247, u247 - 80000, u247 + 200)
const bindNeedles = ['ke=', 'ke =', ',ke,', '{ke}', 'ke as ', 'ke,', 'ke}']
lines.push('', '## plugin chunk ke binding probes in 80k before U')
for (const n of bindNeedles) {
  let idx = 0
  let count = 0
  while (true) {
    const j = win.indexOf(n, idx)
    if (j < 0) break
    count++
    idx = j + n.length
  }
  lines.push(`${count}\t${JSON.stringify(n)}`)
}

// dump chunk header-ish: first function before Er
dump(
  'gold-25-escape-247-before-Er.txt',
  `# before Er\n\n${asciiSlice(b247, 233787886 - 4000, 233787886 + 200)}\n`,
)

// D( near plugin details
const dHits = allHits(b247, 'function D(')
const nearD = dHits
  .map((i) => ({ i, dist: Math.abs(i - u247) }))
  .sort((x, y) => x.dist - y.dist)
  .slice(0, 8)
lines.push('', '## nearest function D(')
for (const { i, dist } of nearD) {
  const fn = extractNamedFunction(b247, i)
  lines.push(
    `D @${i} dist=${dist} ${fn ? `name=${fn.name} len=${fn.len} sha=${fn.sha}` : 'NOFN'}`,
  )
  if (fn && fn.len < 4000) {
    dump(
      `gold-25-escape-fn-D-${fn.start}.txt`,
      `# 247 function D start=${fn.start} len=${fn.len} sha=${fn.sha} dist=${dist}\n\n${fn.src}\n`,
    )
  }
}

// also search ke=e=> and ke=function
for (const n of ['ke=e=>', 'ke=(e)=>', 'ke=function', 'var ke=', 'let ke=', 'const ke=']) {
  const h247 = allHits(b247, n)
  const h246 = allHits(b246, n)
  lines.push(`assign ${JSON.stringify(n)} 246=${h246.length} 247=${h247.length}`)
  for (const i of h247.slice(0, 5)) {
    dump(
      `gold-25-escape-ke-assign-${n.replace(/[^A-Za-z0-9]+/g, '_')}-${i}.txt`,
      `# 247 @${i}\n\n${asciiSlice(b247, Math.max(0, i - 200), i + 600)}\n`,
    )
  }
}

dump('gold-25-escape-ke-inventory.txt', lines.join('\n'))
console.log('phase4 done')
