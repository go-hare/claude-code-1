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

function extractNamedAsync(src, name) {
  const start = src.indexOf(`async function ${name}(`)
  if (start < 0) return null
  const openParen = src.indexOf('(', start)
  let pdepth = 0
  let i = openParen
  for (; i < src.length; i++) {
    if (src[i] === '(') pdepth++
    else if (src[i] === ')') {
      pdepth--
      if (pdepth === 0) break
    }
  }
  const brace = src.indexOf('{', i)
  let depth = 0
  for (let j = brace; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) return src.slice(start, j + 1)
    }
  }
  return src.slice(start, start + 40000)
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

function loadAround(buf, needle, back, after) {
  const pos = buf.indexOf(Buffer.from(needle, 'ascii'))
  return {
    pos,
    src: ascii(buf.subarray(Math.max(0, pos - back), Math.min(buf.length, pos + after))),
  }
}

const w247 = loadAround(buf247, 'async function Fjo(', 100, 50000)
const w246 = loadAround(buf246, 'async function YLo(', 100, 50000)
const Fjo = extractNamedAsync(w247.src, 'Fjo')
const YLo = extractNamedAsync(w246.src, 'YLo')

console.log('Fjo', Fjo && Fjo.length, 'YLo', YLo && YLo.length)
if (Fjo) {
  writeFileSync(
    join(outDir, 'gold-19-247-Fjo.txt'),
    `# pos=${w247.pos} len=${Fjo.length}\n${Fjo}\n`,
  )
}
if (YLo) {
  writeFileSync(
    join(outDir, 'gold-19-246-YLo.txt'),
    `# pos=${w246.pos} len=${YLo.length}\n${YLo}\n`,
  )
}

if (Fjo && YLo) {
  const a = shape(Fjo)
  const b = shape(YLo)
  console.log('Fjo/YLo shape same', a === b, a.length, b.length)
  if (a !== b) {
    let i = 0
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
    writeFileSync(
      join(outDir, 'gold-19-shape-diff-Fjo-YLo.txt'),
      `# mismatch@${i}\n---247---\n${a.slice(Math.max(0, i - 250), i + 500)}\n---246---\n${b.slice(Math.max(0, i - 250), i + 500)}\n`,
    )
    console.log('mismatch@', i)
  }
  console.log('247 Yjo', Fjo.includes('Yjo'), 'unknown', Fjo.includes('unknown'))
  console.log('246 s0o', YLo.includes('s0o'), 'unknown', YLo.includes('unknown'))
}

const iZ = extractNamedAsync(
  ascii(
    buf247.subarray(
      buf247.indexOf(Buffer.from('async function iZ(', 'ascii')),
      buf247.indexOf(Buffer.from('async function iZ(', 'ascii')) + 20000,
    ),
  ),
  'iZ',
)
const O8 = extractNamedAsync(
  ascii(
    buf246.subarray(
      buf246.indexOf(Buffer.from('async function O8(', 'ascii')),
      buf246.indexOf(Buffer.from('async function O8(', 'ascii')) + 20000,
    ),
  ),
  'O8',
)
const Yjo = extractNamedAsync(
  ascii(
    buf247.subarray(
      buf247.indexOf(Buffer.from('async function Yjo(', 'ascii')),
      buf247.indexOf(Buffer.from('async function Yjo(', 'ascii')) + 8000,
    ),
  ),
  'Yjo',
)
const s0o = extractNamedAsync(
  ascii(
    buf246.subarray(
      buf246.indexOf(Buffer.from('async function s0o(', 'ascii')),
      buf246.indexOf(Buffer.from('async function s0o(', 'ascii')) + 8000,
    ),
  ),
  's0o',
)
const j$ = extractNamedAsync(
  ascii(
    buf247.subarray(
      buf247.indexOf(Buffer.from('async function j$(', 'ascii')),
      buf247.indexOf(Buffer.from('async function j$(', 'ascii')) + 4000,
    ),
  ),
  'j$',
)

writeFileSync(join(outDir, 'gold-19-247-iZ.txt'), iZ || 'MISS')
writeFileSync(join(outDir, 'gold-19-246-O8.txt'), O8 || 'MISS')
writeFileSync(join(outDir, 'gold-19-247-Yjo.txt'), Yjo || 'MISS')
writeFileSync(join(outDir, 'gold-19-246-s0o.txt'), s0o || 'MISS')
writeFileSync(join(outDir, 'gold-19-247-j$.txt'), j$ || 'MISS')

console.log(
  'iZ/O8 shape',
  shape(iZ || '') === shape(O8 || ''),
  iZ && iZ.length,
  O8 && O8.length,
)
console.log(
  'Yjo/s0o shape',
  shape(Yjo || '') === shape(s0o || ''),
  Yjo && Yjo.length,
  s0o && s0o.length,
)
console.log('j$ len', j$ && j$.length)
