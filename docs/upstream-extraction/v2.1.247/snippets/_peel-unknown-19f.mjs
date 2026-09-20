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
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

function extractCovering(buf, needle, tag, back = 120000, after = 40000) {
  const pos = buf.indexOf(Buffer.from(needle, 'ascii'))
  if (pos < 0) {
    console.log('MISS', tag, needle)
    return null
  }
  const start = Math.max(0, pos - back)
  const src = ascii(buf.subarray(start, Math.min(buf.length, pos + after)))
  const rel = pos - start
  const re = /async function [A-Za-z_$][\w$]*\(/g
  const starts = []
  let m
  while ((m = re.exec(src.slice(0, rel)))) starts.push(m.index)
  console.log(tag, 'pos', pos, 'starts', starts.length)
  for (let i = starts.length - 1; i >= 0; i--) {
    const body = extractFnAt(src, starts[i])
    const end = starts[i] + body.length
    if (end > rel && body.length > 500) {
      const header = body.slice(0, 120).replace(/\n/g, ' ')
      writeFileSync(
        join(outDir, `gold-19-${tag}.txt`),
        `# pos=${pos} fnRel=${starts[i]} len=${body.length}\n${body}\n`,
      )
      console.log(
        '  HIT',
        tag,
        'len',
        body.length,
        'header',
        header.slice(0, 90),
      )
      return body
    }
  }
  console.log('  no covering fn', tag)
  return null
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

const a = extractCovering(buf247, 'else await Yjo(h.path,E,', '247-install-move')
const b = extractCovering(buf246, 'else await s0o(', '246-install-move')

if (a && b) {
  const sa = shape(a)
  const sb = shape(b)
  console.log('install-move shape same', sa === sb, sa.length, sb.length)
  if (sa !== sb) {
    let i = 0
    while (i < Math.min(sa.length, sb.length) && sa[i] === sb[i]) i++
    writeFileSync(
      join(outDir, 'gold-19-shape-diff-install-move.txt'),
      `# mismatch@${i}\n---247---\n${sa.slice(Math.max(0, i - 250), i + 500)}\n---246---\n${sb.slice(Math.max(0, i - 250), i + 500)}\n`,
    )
    console.log('install-move mismatch@', i)
    // also write a focused window of the real source around first textual unknown/rm
    for (const [tag, src] of [
      ['247', a],
      ['246', b],
    ]) {
      for (const n of [
        '==="unknown"',
        '!=="unknown"',
        'Yjo',
        's0o',
        'recursive:!0,force:!0',
      ]) {
        const p = src.indexOf(n)
        console.log(tag, n, p)
      }
    }
  }
}

// evict / removeFresh function bodies via export map in _448
// search "as evictCachedVersionDir" already have; find function y / A9n by
// looking at import {Ufa as y} — find export {..., Ufa as
const exp448 = buf247.indexOf(Buffer.from('Ufa as y', 'ascii'))
console.log('Ufa as y', exp448)
if (exp448 > 0) {
  writeFileSync(
    join(outDir, 'gold-19-247-Ufa-export.txt'),
    ascii(buf247.subarray(exp448 - 400, exp448 + 400)),
  )
}

// dump 246 install move callsite
const s0oCall = buf246.indexOf(Buffer.from('else await s0o(', 'ascii'))
console.log('246 else await s0o', s0oCall)
if (s0oCall > 0) {
  writeFileSync(
    join(outDir, 'gold-19-246-s0o-callsite.txt'),
    ascii(buf246.subarray(s0oCall - 900, s0oCall + 400)),
  )
}
