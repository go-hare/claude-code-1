import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

if (!existsSync(p247) || !existsSync(p246)) {
  console.log('MISSING SEA', { p247: existsSync(p247), p246: existsSync(p246) })
  process.exit(1)
}

const b247 = readFileSync(p247)
const b246 = readFileSync(p246)
console.log('loaded', b247.length, b246.length)

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

function printableRun(buf, pos) {
  let a = pos
  let b = pos
  while (a > 0) {
    const c = buf[a - 1]
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) a--
    else break
  }
  while (b < buf.length) {
    const c = buf[b]
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) b++
    else break
  }
  return { start: a, end: b, len: b - a }
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
    if (hits.length > 80) break
  }
  return hits
}

function utf16le(s) {
  return Buffer.from(s, 'utf16le')
}

function classify(buf, i) {
  const run = printableRun(buf, i)
  const win = asciiWindow(buf, Math.max(0, i - 80), i + 80)
  const jsScore =
    (win.match(/[{}();=]/g) || []).length +
    (win.includes('function') ? 8 : 0) +
    (win.includes('return') ? 4 : 0)
  const kind = run.len >= 200 && jsScore >= 8 ? 'js' : 'tbl'
  return { ...run, kind, jsScore }
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
        return {
          start: bracePos,
          end: i + 1,
          body: buf.toString('ascii', bracePos, i + 1),
        }
      }
    }
    i++
  }
  return null
}

function extractNamedFunction(buf, pos) {
  const searchFrom = Math.max(0, pos - 120000)
  const fnAt = findLast(buf, 'function ', pos, searchFrom)
  if (fnAt < 0) return null
  let start = fnAt
  if (fnAt >= 6 && buf.toString('ascii', fnAt - 6, fnAt) === 'async ') {
    start = fnAt - 6
  }
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
  const searchFrom = Math.max(0, pos - 120000)
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
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    text.endsWith('\n') ? text : `${text}\n`,
  )
  console.log('WROTE', name, text.length)
}

function summarizeFn(fn) {
  if (!fn) return 'NONE'
  return `${fn.async ? 'async ' : ''}function ${fn.name}() start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha}`
}

const needles = [
  '[exited with code',
  '[exited with code -1]',
  'exited with code -1',
  'exited with code ${',
  'exited with code',
  '[exited with',
  'exited with signal',
  '(exit code',
  '(exit code ${',
  'Exit code ${',
  'Exit code ',
  'with exit code',
  'exit code ${',
  'exit code unknown',
  '[process exited',
  'process exited while detached',
  'internal error was logged',
  "Couldn't background this session",
  'carried over from the foreground',
  'from the foreground',
  'background sessions',
  'background session',
  'tasks carry',
  'task carries',
  'carry over to the background',
  'misleading',
  'code===-1',
  'code!==-1',
  'exitCode===-1',
  'exitCode!==-1',
  'code==-1',
  'code:-1',
  'code: -1',
  'exitCode:-1',
  'adopted handle',
  'adopted shell',
  'adopted handle released',
  'Command failed with exit code',
  'Background command "',
  'completed (exit code',
  'failed with exit code',
]

const countLines = [
  '# gold-18-counts 247 vs 246 fg-shell-bg-exit',
  '',
]
const jsHits = { 247: [], 246: [] }

for (const needle of needles) {
  const h246 = allHits(b246, needle)
  const h247 = allHits(b247, needle)
  const mark = h246.length === h247.length ? 'same' : 'DIFF'
  countLines.push(
    `${mark} 246=${h246.length} 247=${h247.length} ${JSON.stringify(needle)}`,
  )
  for (const [ver, buf, hits] of [
    ['246', b246, h246],
    ['247', b247, h247],
  ]) {
    hits.forEach((i, idx) => {
      const c = classify(buf, i)
      countLines.push(
        `  ${ver}#${idx} offset=${i} kind=${c.kind} run=${c.len} jsScore=${c.jsScore}`,
      )
      if (c.kind === 'js') jsHits[ver].push({ needle, idx, offset: i, ...c })
    })
  }
}

const u16Needles = [
  '[exited with code',
  'exited with code -1',
  'exited with code',
  'internal error was logged',
  'from the foreground',
  'background sessions',
]
countLines.push('', '## utf16le')
for (const needle of u16Needles) {
  const n = utf16le(needle)
  const h246 = allHits(b246, n)
  const h247 = allHits(b247, n)
  const mark = h246.length === h247.length ? 'same' : 'DIFF'
  countLines.push(
    `${mark} 246=${h246.length} 247=${h247.length} utf16le ${JSON.stringify(needle)}`,
  )
}

dump('gold-18-counts.txt', countLines.join('\n'))

const fnLines = [
  '# gold-18-functions innermost named function around JS hits',
  '',
]
const bodies = { 247: new Map(), 246: new Map() }

for (const ver of ['246', '247']) {
  const buf = ver === '247' ? b247 : b246
  fnLines.push(`## ${ver} JS hits=${jsHits[ver].length}`)
  const seen = new Set()
  for (const hit of jsHits[ver]) {
    const fn = extractInnermostFunction(buf, hit.offset)
    const key = fn ? `${fn.start}:${fn.end}:${fn.name}` : `miss:${hit.offset}`
    fnLines.push(
      `- needle=${JSON.stringify(hit.needle)} #${hit.idx} @${hit.offset} → ${summarizeFn(fn)}`,
    )
    if (!fn || seen.has(key)) continue
    seen.add(key)
    bodies[ver].set(key, { hit, fn })
    dump(
      `gold-18-fn-${ver}-${fn.name || 'anon'}-${fn.start}.txt`,
      `# ver=${ver} name=${fn.name} async=${fn.async} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha} needle=${JSON.stringify(hit.needle)}\n\n${fn.src}\n`,
    )
  }
  fnLines.push('')
}

dump('gold-18-functions.txt', fnLines.join('\n'))

const winNeedles = [
  ['exited with code ${', 2500, 2500],
  ['exited with code', 1500, 1500],
  ['Exit code ${', 1500, 1500],
  ['(exit code', 1500, 1500],
  ['internal error was logged', 2500, 2500],
  ["Couldn't background this session", 2500, 2500],
  ['process exited while detached', 2000, 2000],
  ['code===-1', 800, 800],
  ['exitCode===-1', 800, 800],
  ['adopted handle released', 2000, 2000],
  ['Background command "', 2000, 2000],
  ['completed (exit code', 2000, 2000],
  ['failed with exit code', 2000, 2000],
  ['Command failed with exit code', 1500, 1500],
  ['from the foreground', 1500, 1500],
  ['background sessions', 1500, 1500],
  ['task carries', 1500, 1500],
]

for (const [needle, before, after] of winNeedles) {
  for (const [ver, buf] of [
    ['246', b246],
    ['247', b247],
  ]) {
    const hits = allHits(buf, needle)
    hits.forEach((i, idx) => {
      const c = classify(buf, i)
      if (c.kind !== 'js' && idx > 2) return
      if (c.kind === 'js' && idx > 6) return
      const slug = needle
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
      dump(
        `gold-18-win-${ver}-${slug}-${idx}-${c.kind}.txt`,
        `# ver=${ver} offset=${i} kind=${c.kind} run=${c.len} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
      )
    })
  }
}

const sha246 = new Set([...bodies['246'].values()].map(x => x.fn.sha))
const sha247 = new Set([...bodies['247'].values()].map(x => x.fn.sha))
const only247 = [...bodies['247'].values()].filter(x => !sha246.has(x.fn.sha))
const only246 = [...bodies['246'].values()].filter(x => !sha247.has(x.fn.sha))

const cmp = [
  '# gold-18-compare 247 vs 246 extracted function SHAs',
  '',
  `246 functions: ${bodies['246'].size}`,
  `247 functions: ${bodies['247'].size}`,
  `shared sha: ${[...sha247].filter(s => sha246.has(s)).length}`,
  `247-only sha: ${only247.length}`,
  `246-only sha: ${only246.length}`,
  '',
  '## 247 functions',
]
for (const { hit, fn } of bodies['247'].values()) {
  cmp.push(
    `- ${summarizeFn(fn)} from ${JSON.stringify(hit.needle)} shared=${sha246.has(fn.sha)}`,
  )
}
cmp.push('', '## 246 functions')
for (const { hit, fn } of bodies['246'].values()) {
  cmp.push(
    `- ${summarizeFn(fn)} from ${JSON.stringify(hit.needle)} shared=${sha247.has(fn.sha)}`,
  )
}
cmp.push('', '## 247-only')
if (only247.length === 0) cmp.push('NONE')
for (const { hit, fn } of only247) {
  cmp.push(`- ${summarizeFn(fn)} from ${JSON.stringify(hit.needle)}`)
  dump(
    `gold-18-only247-${fn.name || 'anon'}-${fn.start}.txt`,
    `# 247-only name=${fn.name} start=${fn.start} len=${fn.len} sha=${fn.sha} needle=${JSON.stringify(hit.needle)}\n\n${fn.src}\n`,
  )
}
dump('gold-18-compare.txt', cmp.join('\n'))

console.log('DONE compare', {
  n246: bodies['246'].size,
  n247: bodies['247'].size,
  only247: only247.length,
  only246: only246.length,
})
