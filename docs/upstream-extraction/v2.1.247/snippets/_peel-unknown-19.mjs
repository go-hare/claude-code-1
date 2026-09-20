/**
 * #19 mkt-versionless-cache — lock peel (247 vs 246).
 * Re-dumps the locked install/cache bodies. Does not invent skip-rm.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
  return null
}

function dumpNamed(buf, name, file, pad = 40000) {
  const pos = buf.indexOf(Buffer.from(`async function ${name}(`, 'ascii'))
  if (pos < 0) {
    console.log('MISS', name)
    return
  }
  const src = ascii(buf.subarray(pos, Math.min(buf.length, pos + pad)))
  const body = extractNamedAsync(src, name)
  writeFileSync(
    join(outDir, file),
    `# pos=${pos} len=${body?.length ?? 0}\n${body ?? 'MISS'}\n`,
  )
  console.log('OK', name, pos, body?.length)
}

dumpNamed(buf247, 'iZ', 'gold-19-247-iZ.txt')
dumpNamed(buf246, 'O8', 'gold-19-246-O8.txt')
dumpNamed(buf247, 'Yjo', 'gold-19-247-Yjo.txt', 8000)
dumpNamed(buf246, 's0o', 'gold-19-246-s0o.txt', 8000)
dumpNamed(buf247, 'Fjo', 'gold-19-247-Fjo.txt')
dumpNamed(buf246, 'YLo', 'gold-19-246-YLo.txt')

for (const n of [
  'version==="unknown"',
  'cannot be renamed aside',
  'removing it in place instead',
  'was cached concurrently',
  'using \'unknown\'',
]) {
  const a = buf247.indexOf(Buffer.from(n, 'ascii'))
  const b = buf246.indexOf(Buffer.from(n, 'ascii'))
  console.log(JSON.stringify(n), '247', a, '246', b)
}
