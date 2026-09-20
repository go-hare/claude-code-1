import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

if (!existsSync(p247) || !existsSync(p246)) {
  console.log('MISSING SEA')
  process.exit(1)
}

const b247 = readFileSync(p247)
const b246 = readFileSync(p246)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
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
      if (depth === 0) {
        return { start: bracePos, end: i + 1 }
      }
    }
    i++
  }
  return null
}

function extractNamedFunction(buf, pos) {
  const searchFrom = Math.max(0, pos - 200000)
  const fnAt = findLast(buf, 'function ', pos, searchFrom)
  if (fnAt < 0) return null
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
  if (pos < start || pos >= braced.end) return null
  const src = buf.toString('ascii', start, braced.end)
  return {
    start,
    end: braced.end,
    name,
    async: start !== fnAt,
    len: braced.end - start,
    src,
    sha: createHash('sha256').update(src).digest('hex').slice(0, 16),
  }
}

function extractInnermostFunction(buf, pos) {
  const searchFrom = Math.max(0, pos - 200000)
  let from = searchFrom
  const needle = Buffer.from('function ')
  let best = null
  while (from < pos) {
    const i = buf.indexOf(needle, from)
    if (i < 0 || i >= pos) break
    const cand = extractNamedFunction(buf, i + 9)
    if (cand && cand.start <= pos && pos < cand.end) best = cand
    from = i + 1
  }
  return best
}

function dump(name, text) {
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name, text.length)
}

function summarizeFn(fn) {
  if (!fn) return 'NONE'
  return `${fn.async ? 'async ' : ''}function ${fn.name}() start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha}`
}

const needles = [
  'scrub write-root derivation failed',
  'scrubbed replaced symlinked-deny path',
  'tengu_sandbox_scrub_removed_non_symlink',
  'symlinkedDenyScrubPaths',
  'denyLiteralSymlinkCandidates',
  'hopDirectories',
  'danglingBaseline',
  'stillSymlink',
  'currentHopDirectories',
  'observedEnd',
  'runtimeAllowWriteDirectories',
  'function UZ(',
  'function pv(',
  'function $Z(',
  'function bu(',
  'function yu(',
  'function BZ(',
  'function RZ(',
  'function Wr(',
  'function gs(',
  'function Vt(',
  'function Te(',
]

const lines = ['# gold-11-unk-helpers counts + extracted fns', '']

for (const needle of needles) {
  const h246 = allHits(b246, needle)
  const h247 = allHits(b247, needle)
  lines.push(
    `${h246.length === h247.length ? 'same' : 'DIFF'} 246=${h246.length} 247=${h247.length} ${JSON.stringify(needle)}`,
  )
  for (const [ver, buf, hits] of [
    ['246', b246, h246],
    ['247', b247, h247],
  ]) {
    hits.slice(0, 6).forEach((i, idx) => {
      const fn = extractInnermostFunction(buf, i)
      lines.push(`  ${ver}#${idx} @${i} → ${summarizeFn(fn)}`)
      if (fn && fn.len < 8000) {
        dump(
          `gold-11-unk-fn-${ver}-${fn.name || 'anon'}-${fn.start}.txt`,
          `# ${ver} ${summarizeFn(fn)} needle=${JSON.stringify(needle)}\n\n${fn.src}\n`,
        )
      } else if (!fn) {
        dump(
          `gold-11-unk-win-${ver}-${needle.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}-${idx}.txt`,
          `# ${ver} NO_FN ${JSON.stringify(needle)} @${i}\n\n${asciiWindow(buf, i - 400, i + 1600)}\n`,
        )
      }
    })
  }
}

dump('gold-11-unk-helpers.txt', lines.join('\n'))

// Large neighborhood around 247 LZ / 246 TZ
dump(
  'gold-11-unk-247-lz-neighborhood.txt',
  `# 247 neighborhood around PZ/LZ\n\n${asciiWindow(b247, 210410000, 210420000)}\n`,
)
dump(
  'gold-11-unk-246-tz-neighborhood.txt',
  `# 246 neighborhood around xZ/TZ\n\n${asciiWindow(b246, 209156000, 209165000)}\n`,
)

// Builder: first JS hit of hopDirectories / danglingBaseline / symlinkedDenyScrubPaths.push
for (const needle of [
  'hopDirectories:',
  'danglingBaseline:',
  'symlinkedDenyScrubPaths.push',
  'denyLiteralSymlinkCandidates.push',
]) {
  for (const [ver, buf] of [
    ['246', b246],
    ['247', b247],
  ]) {
    const hits = allHits(buf, needle)
    lines.push(`BUILD ${ver} ${JSON.stringify(needle)} ${hits.length} ${hits.slice(0, 6).join(',')}`)
    hits.slice(0, 4).forEach((i, idx) => {
      const fn = extractInnermostFunction(buf, i)
      dump(
        `gold-11-unk-build-${ver}-${idx}-${fn?.name || 'x'}.txt`,
        `# ${ver} ${JSON.stringify(needle)} @${i} ${summarizeFn(fn)}\n\n${fn ? fn.src : asciiWindow(buf, i - 800, i + 2500)}\n`,
      )
    })
  }
}

console.log('DONE 11b')
