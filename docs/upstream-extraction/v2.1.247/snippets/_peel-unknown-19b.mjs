import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sea247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const sea246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const buf247 = readFileSync(sea247)
const buf246 = readFileSync(sea246)

function ascii(raw) {
  let s = ''
  for (const b of raw) {
    s +=
      b === 10
        ? '\n'
        : b === 13
          ? '\r'
          : b === 9 || (b >= 32 && b < 127)
            ? String.fromCharCode(b)
            : '.'
  }
  return s
}

function idx(buf, s, from = 0) {
  return buf.indexOf(Buffer.from(s, 'ascii'), from)
}

function hits(buf, n, max = 20) {
  const out = []
  let p = 0
  while (out.length < max) {
    const i = idx(buf, n, p)
    if (i < 0) break
    out.push(i)
    p = i + n.length
  }
  return out
}

function walkBackToFn(src, needlePos) {
  const before = src.slice(0, needlePos)
  const re = /(?:async function|function) [A-Za-z_$][\w$]*\(/g
  let last = null
  let m
  while ((m = re.exec(before))) last = m
  if (!last) {
    const re2 = /(?:async )?[A-Za-z_$][\w$]*=(?:async )?function\(/g
    while ((m = re2.exec(before))) last = m
  }
  return last ? last.index : Math.max(0, needlePos - 4000)
}

function extractFromBrace(src, start) {
  const brace = src.indexOf('{', start)
  if (brace < 0) return src.slice(start, start + 200)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start, start + 12000) + '\n/*TRUNC*/'
}

function extractAround(buf, needle, tag, windowBefore = 8000, windowAfter = 16000) {
  const positions = hits(buf, needle, 4)
  const bodies = []
  for (const [k, pos] of positions.entries()) {
    const start = Math.max(0, pos - windowBefore)
    const end = Math.min(buf.length, pos + windowAfter)
    const src = ascii(buf.subarray(start, end))
    const rel = pos - start
    const fnStart = walkBackToFn(src, rel)
    const body = extractFromBrace(src, fnStart)
    const header = src.slice(fnStart, fnStart + 80).replace(/\n/g, ' ')
    writeFileSync(
      join(outDir, `gold-19-${tag}-${k}.txt`),
      `# pos=${pos} fnStartRel=${fnStart} header=${JSON.stringify(header)}\n${body}\n`,
    )
    bodies.push({ pos, header, body, len: body.length })
    console.log(tag, k, 'pos', pos, 'len', body.length, 'hdr', header.slice(0, 70))
  }
  return bodies
}

function norm(s) {
  return s
    .replace(/2\.1\.24[67]/g, 'VERSION')
    .replace(/2026-08-2[56]T[0-9:.Z]+/g, 'TIME')
    .replace(/GIT_SHA:"[0-9a-f]+"/g, 'GIT_SHA:"X"')
}

function diffBodies(a, b, name) {
  if (!a || !b) {
    console.log('DIFF', name, 'missing', !!a, !!b)
    return
  }
  const na = norm(a.body)
  const nb = norm(b.body)
  if (na === nb) {
    console.log('SAME', name, 'len', a.body.length)
    return
  }
  console.log('DIFF', name, '247', a.body.length, '246', b.body.length)
  // first mismatch
  const max = Math.min(na.length, nb.length)
  let i = 0
  while (i < max && na[i] === nb[i]) i++
  writeFileSync(
    join(outDir, `gold-19-diff-${name}.txt`),
    [
      `# mismatch@${i}`,
      '---247---',
      na.slice(Math.max(0, i - 180), i + 400),
      '---246---',
      nb.slice(Math.max(0, i - 180), i + 400),
    ].join('\n'),
  )
}

const sites = [
  ['concurrent', 'was cached concurrently', 12000, 18000],
  ['defer-overwrite', 'deferring overwrite until it exits', 10000, 14000],
  ['using-unknown', "using 'unknown'", 6000, 8000],
  ['no-version', 'No version found', 4000, 4000],
  ['temp-rename', '.claude-plugin-temp-', 12000, 16000],
  ['another-scope', 'another scope', 6000, 8000],
  ['already-cached', 'already cached at', 8000, 10000],
  ['in-use-live', 'in use by live session', 6000, 8000],
  ['incomplete-cache', 'incomplete"} cache directory', 8000, 8000],
  ['calc-export', 'calculatePluginVersion', 2000, 4000],
]

for (const [tag, needle, before, after] of sites) {
  console.log('\n====', tag, '====')
  const a = extractAround(buf247, needle, `247-${tag}`, before, after)
  const b = extractAround(buf246, needle, `246-${tag}`, before, after)
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diffBodies(a[i], b[i], `${tag}-${i}`)
}

// also dump calculatePluginVersion nearby for version==="unknown" minified
for (const n of [
  '==="unknown"',
  '!=="unknown"',
  '==="unknown"&&',
  '!=="unknown"?',
]) {
  const a = hits(buf247, n, 40)
  const b = hits(buf246, n, 40)
  console.log(`eqcount 247=${a.length} 246=${b.length}`, n)
}
