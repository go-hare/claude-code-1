/**
 * Phase 2 leftover 247 #25 — unique 247 escape windows + plugin-print helpers.
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
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
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

function ctxKey(buf, i, before = 80, after = 80) {
  return asciiSlice(buf, Math.max(0, i - before), i + after)
}

function uniqueHits(needle, tag, maxDump = 12) {
  const a = allHits(b246, needle)
  const b = allHits(b247, needle)
  const keys246 = new Set(a.map((i) => ctxKey(b246, i)))
  const unique = []
  for (const i of b) {
    const k = ctxKey(b247, i)
    if (!keys246.has(k)) unique.push(i)
  }
  const lines = [
    `# unique 247 ${tag} needle=${JSON.stringify(typeof needle === 'string' ? needle : tag)}`,
    `246=${a.length} 247=${b.length} unique247=${unique.length}`,
    '',
  ]
  unique.slice(0, maxDump).forEach((i, idx) => {
    const win = asciiSlice(b247, Math.max(0, i - 400), i + 500)
    lines.push(`## u${idx} @${i} sha=${sha(win)}`)
    lines.push(win)
    lines.push('')
    dump(
      `gold-25-escape-unique-${tag}-${idx}.txt`,
      `# offset=${i} tag=${tag}\n\n${win}\n`,
    )
  })
  dump(`gold-25-escape-unique-${tag}-index.txt`, lines.join('\n'))
  console.log(
    `unique ${tag} 246=${a.length} 247=${b.length} unique=${unique.length}`,
  )
  return unique
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
      if (depth === 0) {
        return { start: bracePos, end: i + 1 }
      }
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

function extractInnermostFunction(buf, pos) {
  const searchFrom = Math.max(0, pos - 150000)
  let from = searchFrom
  const needle = Buffer.from('function ')
  let best = null
  while (from < pos) {
    const i = buf.indexOf(needle, from)
    if (i < 0 || i >= pos) break
    const cand = extractNamedFunction(buf, i)
    if (cand && cand.start <= pos && pos < cand.end) best = cand
    from = i + 1
  }
  return best
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
  return best
}

uniqueHits('\\x1b', 'x1b', 8)
uniqueHits('\\u001b', 'u001b', 8)
uniqueHits('unprintable', 'unprintable', 8)
uniqueHits('OSC', 'osc', 8)
uniqueHits('\\uFFFD', 'fffd', 8)
uniqueHits('\\p{Cc}', 'pcc', 8)

const listHit = b247.indexOf(Buffer.from('Installed plugins:'))
// JS hit is the 2nd occurrence from earlier dump @233790128
const jsListHits = allHits(b247, 'Installed plugins:')
console.log('Installed plugins hits', jsListHits)

for (const [idx, i] of jsListHits.entries()) {
  const fn = extractInnermostFunction(b247, i)
  if (fn) {
    dump(
      `gold-25-escape-fn-list-${fn.name}-${fn.start}.txt`,
      `# 247 ${fn.async ? 'async ' : ''}function ${fn.name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha} needle@${i}\n\n${fn.src}\n`,
    )
  } else {
    console.log('no fn around list hit', idx, i)
  }
}

const list246 = allHits(b246, 'Installed plugins:')
for (const [idx, i] of list246.entries()) {
  const fn = extractInnermostFunction(b246, i)
  if (fn && fn.len < 80000) {
    dump(
      `gold-25-escape-fn-list-246-${fn.name}-${fn.start}.txt`,
      `# 246 ${fn.async ? 'async ' : ''}function ${fn.name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha} needle@${i}\n\n${fn.src}\n`,
    )
  } else {
    console.log('246 list', idx, i, fn && `len=${fn.len} name=${fn.name}`)
  }
}

// helpers named U near JS list
const jsList = jsListHits.find((i) => i > 200000000) || jsListHits[1]
if (jsList) {
  for (const name of ['U', 'he', 'Pa', 'Sa']) {
    const fn = extractFunctionByNameNear(b247, name, jsList, 250000)
    if (fn) {
      console.log(
        `near-list ${name} start=${fn.start} len=${fn.len} dist=${Math.abs(fn.start - jsList)}`,
      )
      if (fn.len < 20000) {
        dump(
          `gold-25-escape-fn-${name}-${fn.start}.txt`,
          `# 247 function ${name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha} dist=${Math.abs(fn.start - jsList)}\n\n${fn.src}\n`,
        )
      }
    } else {
      console.log('MISS near-list', name)
    }
  }
}

const mktHits = allHits(b247, 'Configured marketplaces:')
console.log('Configured marketplaces hits', mktHits)
for (const i of mktHits) {
  const fn = extractInnermostFunction(b247, i)
  if (fn && fn.len < 80000) {
    dump(
      `gold-25-escape-fn-mktlist-${fn.name}-${fn.start}.txt`,
      `# 247 ${fn.async ? 'async ' : ''}function ${fn.name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha} needle@${i}\n\n${fn.src}\n`,
    )
  }
}

console.log('phase2 done')
