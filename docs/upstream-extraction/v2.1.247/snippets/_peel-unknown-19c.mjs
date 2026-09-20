import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

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

function hits(buf, n, max = 80) {
  const out = []
  let p = 0
  const needle = Buffer.from(n, 'ascii')
  while (out.length < max) {
    const i = buf.indexOf(needle, p)
    if (i < 0) break
    out.push(i)
    p = i + needle.length
  }
  return out
}

function ctx(buf, pos, before = 220, after = 220) {
  const start = Math.max(0, pos - before)
  const end = Math.min(buf.length, pos + after)
  return ascii(buf.subarray(start, end)).replace(/\s+/g, ' ')
}

function shape(s) {
  return s
    .replace(/2\.1\.24[67]/g, 'V')
    .replace(/[A-Za-z_$][\w$]*/g, (id) => {
      if (
        [
          'async',
          'function',
          'await',
          'return',
          'throw',
          'new',
          'let',
          'const',
          'var',
          'if',
          'else',
          'try',
          'catch',
          'finally',
          'for',
          'while',
          'of',
          'in',
          'void',
          'typeof',
          'null',
          'true',
          'false',
          'undefined',
          'Promise',
          'Error',
          'Date',
          'Math',
          'JSON',
          'Object',
          'Array',
          'String',
          'Number',
          'Boolean',
          'Map',
          'Set',
          'Buffer',
          'process',
          'console',
        ].includes(id)
      )
        return id
      return 'I'
    })
}

function dumpEqUnknown(buf, tag) {
  const positions = hits(buf, '==="unknown"&&')
  const rows = []
  for (const [k, pos] of positions.entries()) {
    const c = ctx(buf, pos, 160, 200)
    rows.push({ pos, c })
    writeFileSync(
      join(outDir, `gold-19-${tag}-eq-unknown-and-${k}.txt`),
      `# pos=${pos}\n${ascii(buf.subarray(Math.max(0, pos - 400), Math.min(buf.length, pos + 500)))}\n`,
    )
  }
  console.log(tag, '==="unknown"&& count', positions.length)
  return rows
}

const a = dumpEqUnknown(buf247, '247')
const b = dumpEqUnknown(buf246, '246')

const shaped247 = new Map(a.map((r) => [shape(r.c), r]))
const shaped246 = new Map(b.map((r) => [shape(r.c), r]))

console.log('\n=== 247-only ==="unknown"&& shapes ===')
for (const [sh, r] of shaped247) {
  if (!shaped246.has(sh)) {
    console.log('UNIQUE247 pos', r.pos)
    console.log(r.c)
    console.log('---shape---')
    console.log(sh)
  }
}

console.log('\n=== 246-only ==="unknown"&& shapes ===')
for (const [sh, r] of shaped246) {
  if (!shaped247.has(sh)) {
    console.log('UNIQUE246 pos', r.pos)
    console.log(r.c)
  }
}

// identifier-normalized iZ vs O8
function extractNamed(buf, name) {
  const needle = Buffer.from(`async function ${name}(`, 'ascii')
  const pos = buf.indexOf(needle)
  if (pos < 0) return null
  const src = ascii(buf.subarray(pos, pos + 20000))
  let depth = 0
  const brace = src.indexOf('{')
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(0, i + 1)
    }
  }
  return src
}

const iZ = extractNamed(buf247, 'iZ')
const O8 = extractNamed(buf246, 'O8')
const Yjo = extractNamed(buf247, 'Yjo')
const s0o = extractNamed(buf246, 's0o')

function writeCmp(name, left, right) {
  const sl = shape(left)
  const sr = shape(right)
  writeFileSync(join(outDir, `gold-19-shape-${name}-247.txt`), sl)
  writeFileSync(join(outDir, `gold-19-shape-${name}-246.txt`), sr)
  if (sl === sr) {
    console.log('SHAPE SAME', name, left.length, right.length)
    return
  }
  let i = 0
  const max = Math.min(sl.length, sr.length)
  while (i < max && sl[i] === sr[i]) i++
  console.log('SHAPE DIFF', name, 'at', i, '247', sl.length, '246', sr.length)
  writeFileSync(
    join(outDir, `gold-19-shape-diff-${name}.txt`),
    [
      `# mismatch@${i}`,
      '---247---',
      sl.slice(Math.max(0, i - 200), i + 350),
      '---246---',
      sr.slice(Math.max(0, i - 200), i + 350),
    ].join('\n'),
  )
}

writeCmp('iZ-O8', iZ || '', O8 || '')
writeCmp('Yjo-s0o', Yjo || '', s0o || '')

// also evict / removeFresh by export aliases: y, k from _448
// find functions containing unique strings
for (const [tag, buf, needle, fnHint] of [
  ['247', buf247, 'removeFreshCopyUnlessInUse', ''],
  ['246', buf246, 'removeFreshCopyUnlessInUse', ''],
]) {
  void tag
  void buf
  void needle
  void fnHint
}

// search Yjo callers / cache register move helper name nearby
const yjoPos = buf247.indexOf(Buffer.from('async function Yjo(', 'ascii'))
console.log('Yjo pos', yjoPos)
if (yjoPos >= 0) {
  writeFileSync(
    join(outDir, 'gold-19-Yjo-neighbors.txt'),
    ascii(buf247.subarray(yjoPos - 2500, yjoPos + 2200)),
  )
}
const s0oPos = buf246.indexOf(Buffer.from('async function s0o(', 'ascii'))
console.log('s0o pos', s0oPos)
if (s0oPos >= 0) {
  writeFileSync(
    join(outDir, 'gold-19-s0o-neighbors.txt'),
    ascii(buf246.subarray(s0oPos - 2500, s0oPos + 1800)),
  )
}

// !=="unknown" windows in plugin-ish area (200m-220m)
function pluginish(buf, n) {
  return hits(buf, n, 40).filter((p) => p > 200000000 && p < 220000000)
}
console.log('\n=== pluginish !=="unknown" 247 ===')
for (const p of pluginish(buf247, '!=="unknown"')) {
  console.log(p, ctx(buf247, p, 80, 120))
}
console.log('\n=== pluginish !=="unknown" 246 ===')
for (const p of pluginish(buf246, '!=="unknown"')) {
  console.log(p, ctx(buf246, p, 80, 120))
}
