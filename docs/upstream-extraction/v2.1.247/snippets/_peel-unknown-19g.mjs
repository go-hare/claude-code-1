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

function findEnclosingAsync(src, rel) {
  let depth = 0
  for (let i = rel; i >= 0; i--) {
    const c = src[i]
    if (c === '}') depth++
    else if (c === '{') {
      if (depth === 0) {
        const head = src.slice(Math.max(0, i - 80), i + 1)
        const m = /async function [A-Za-z_$][\w$]*\(/.exec(head)
        if (m) {
          return i - 80 + m.index
        }
        const m2 = /[A-Za-z_$][\w$]*=async function\(/.exec(head)
        if (m2) return i - 80 + m2.index
      } else depth--
    }
  }
  return -1
}

function extractFn(src, start) {
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

function dumpEnclosing(buf, needle, tag, back = 80000, after = 25000) {
  const pos = buf.indexOf(Buffer.from(needle, 'ascii'))
  const start = Math.max(0, pos - back)
  const src = ascii(buf.subarray(start, Math.min(buf.length, pos + after)))
  const rel = pos - start
  const fnStart = findEnclosingAsync(src, rel)
  console.log(tag, 'pos', pos, 'fnStartRel', fnStart)
  if (fnStart < 0) {
    writeFileSync(
      join(outDir, `gold-19-${tag}-window.txt`),
      `# pos=${pos}\n${src.slice(Math.max(0, rel - 4000), rel + 800)}\n`,
    )
    return null
  }
  const body = extractFn(src, fnStart)
  const header = body.slice(0, 140).replace(/\n/g, ' ')
  writeFileSync(
    join(outDir, `gold-19-${tag}.txt`),
    `# pos=${pos} fnStartRel=${fnStart} len=${body.length}\n${body}\n`,
  )
  console.log(tag, 'len', body.length, header.slice(0, 100))
  return body
}

const a = dumpEnclosing(buf247, 'else await Yjo(h.path,E,', '247-install-move')
const b = dumpEnclosing(buf246, 'else await s0o(', '246-install-move')

if (a && b) {
  const sa = shape(a)
  const sb = shape(b)
  console.log('shape same', sa === sb, sa.length, sb.length)
  if (sa !== sb) {
    let i = 0
    while (i < Math.min(sa.length, sb.length) && sa[i] === sb[i]) i++
    writeFileSync(
      join(outDir, 'gold-19-shape-diff-install-move.txt'),
      `# mismatch@${i}\n---247---\n${sa.slice(Math.max(0, i - 220), i + 450)}\n---246---\n${sb.slice(Math.max(0, i - 220), i + 450)}\n`,
    )
    console.log('mismatch@', i)
  }
  for (const [tag, src] of [
    ['247', a],
    ['246', b],
  ]) {
    console.log(
      tag,
      'unknown',
      src.indexOf('unknown'),
      'Yjo/s0o',
      src.indexOf('Yjo'),
      src.indexOf('s0o'),
    )
  }
}

// also dump a 6k window around both move sites for gold
const p247 = buf247.indexOf(Buffer.from('else await Yjo(h.path,E,', 'ascii'))
const p246 = buf246.indexOf(Buffer.from('else await s0o(', 'ascii'))
writeFileSync(
  join(outDir, 'gold-19-247-move-window.txt'),
  `# pos=${p247}\n${ascii(buf247.subarray(p247 - 2500, p247 + 1800))}\n`,
)
writeFileSync(
  join(outDir, 'gold-19-246-move-window.txt'),
  `# pos=${p246}\n${ascii(buf246.subarray(p246 - 2500, p246 + 1800))}\n`,
)
