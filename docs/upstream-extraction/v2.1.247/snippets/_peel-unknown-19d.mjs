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

function extractFnAt(src, start) {
  const brace = src.indexOf('{', start)
  if (brace < 0) return src.slice(start, start + 200)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start, start + 20000) + '\n/*TRUNC*/'
}

function walkBack(src, rel) {
  const before = src.slice(0, rel)
  const re = /async function [A-Za-z_$][\w$]*\(/g
  let last = null
  let m
  while ((m = re.exec(before))) last = m
  return last ? last.index : Math.max(0, rel - 8000)
}

function dumpFn(buf, needle, tag, before = 20000, after = 25000) {
  const pos = buf.indexOf(Buffer.from(needle, 'ascii'))
  if (pos < 0) {
    console.log('MISS', tag, needle)
    return null
  }
  const start = Math.max(0, pos - before)
  const src = ascii(buf.subarray(start, Math.min(buf.length, pos + after)))
  const rel = pos - start
  const fnStart = walkBack(src, rel)
  const body = extractFnAt(src, fnStart)
  const header = body.slice(0, 90).replace(/\n/g, ' ')
  writeFileSync(
    join(outDir, `gold-19-${tag}.txt`),
    `# pos=${pos} header=${JSON.stringify(header)} len=${body.length}\n${body}\n`,
  )
  console.log(tag, 'pos', pos, 'len', body.length, header.slice(0, 80))
  return body
}

function shape(s) {
  return s.replace(/[A-Za-z_$][\w$]*/g, (id) => {
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
      ].includes(id)
    )
      return id
    return 'I'
  })
}

const reg247 = dumpFn(
  buf247,
  'm!=="unknown"&&!dZ(e.source)',
  '247-cacheRegister',
  25000,
  20000,
)
const reg246 = dumpFn(
  buf246,
  'm!=="unknown"&&!N8(e.source)',
  '246-cacheRegister',
  25000,
  20000,
)

if (reg247 && reg246) {
  const a = shape(reg247)
  const b = shape(reg246)
  console.log('cacheRegister shape same', a === b, a.length, b.length)
  if (a !== b) {
    let i = 0
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
    writeFileSync(
      join(outDir, 'gold-19-shape-diff-cacheRegister.txt'),
      `# mismatch@${i}\n---247---\n${a.slice(Math.max(0, i - 220), i + 400)}\n---246---\n${b.slice(Math.max(0, i - 220), i + 400)}\n`,
    )
    console.log('cacheRegister mismatch@', i)
  }
}

// Yjo / s0o call sites
function callHits(buf, name) {
  const n = `${name}(`
  const out = []
  let p = 0
  const needle = Buffer.from(n, 'ascii')
  while (out.length < 12) {
    const i = buf.indexOf(needle, p)
    if (i < 0) break
    out.push(i)
    p = i + n.length
  }
  return out
}

for (const [tag, buf, name] of [
  ['247', buf247, 'Yjo'],
  ['246', buf246, 's0o'],
]) {
  const hs = callHits(buf, name)
  console.log(tag, name, 'hits', hs)
  for (const [k, pos] of hs.entries()) {
    writeFileSync(
      join(outDir, `gold-19-${tag}-call-${name}-${k}.txt`),
      `# pos=${pos}\n${ascii(buf.subarray(Math.max(0, pos - 250), Math.min(buf.length, pos + 180)))}\n`,
    )
  }
}

// evict / removeFresh: search export aliases in _448 by nearby unique-ish strings
for (const n of [
  'removeFreshCopyUnlessInUse',
  'evictCachedVersionDir',
  'clearOccupantForReplace',
  'FreshCopy',
  'unless in use',
  'fresh copy',
]) {
  const i247 = buf247.indexOf(Buffer.from(n, 'ascii'))
  const i246 = buf246.indexOf(Buffer.from(n, 'ascii'))
  console.log(JSON.stringify(n), i247, i246)
}

// BOe aside helper 247 vs 246 equivalent
const boe = dumpFn(buf247, 'function BOe(', '247-BOe', 200, 800)
const r_n = dumpFn(buf246, 'function r_n(', '246-r_n', 200, 400)

// Kjo / RNn unique 247?
console.log(
  'Kjo 247',
  buf247.indexOf(Buffer.from('function Kjo(', 'ascii')),
  '246',
  buf246.indexOf(Buffer.from('function Kjo(', 'ascii')),
)
console.log(
  'cannot be renamed aside 247',
  buf247.indexOf(Buffer.from('cannot be renamed aside', 'ascii')),
  '246',
  buf246.indexOf(Buffer.from('cannot be renamed aside', 'ascii')),
)
console.log(
  'removing it in place instead 247',
  buf247.indexOf(Buffer.from('removing it in place instead', 'ascii')),
  '246',
  buf246.indexOf(Buffer.from('removing it in place instead', 'ascii')),
)

void boe
void r_n
