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

function dump(buf, pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(buf.length, pos + after)
  const s = ascii(buf.subarray(start, end))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
  return s
}

function hits(buf, n, max = 20) {
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

const unique247 = [
  'fresh copy',
  'cannot be renamed aside',
  'removing it in place instead',
  'removeFreshCopyUnlessInUse',
  'UnlessInUse',
  'freshCopy',
  'set aside',
  'renamed aside',
]

for (const n of unique247) {
  const a = hits(buf247, n)
  const b = hits(buf246, n)
  console.log(`247=${a.length} 246=${b.length}`, JSON.stringify(n), a, b)
}

for (const [k, pos] of hits(buf247, 'fresh copy', 6).entries()) {
  dump(buf247, pos, 2500, 2500, `gold-19-247-fresh-copy-${k}.txt`)
  console.log('fresh copy', k, pos)
}

// extract LARGE function containing m!=="unknown" by walking back more aggressively
function extractLarge(buf, needle, tag) {
  const pos = buf.indexOf(Buffer.from(needle, 'ascii'))
  if (pos < 0) return
  const start = Math.max(0, pos - 80000)
  const src = ascii(buf.subarray(start, Math.min(buf.length, pos + 30000)))
  const rel = pos - start
  const before = src.slice(0, rel)
  const re = /async function [A-Za-z_$][\w$]*\(/g
  const starts = []
  let m
  while ((m = re.exec(before))) starts.push(m.index)
  console.log(tag, 'async fn starts before needle', starts.length, 'last5', starts.slice(-5))
  // take the last function longer than 2000 chars if possible
  for (let i = starts.length - 1; i >= 0 && i >= starts.length - 8; i--) {
    const s = starts[i]
    const brace = src.indexOf('{', s)
    let depth = 0
    let end = -1
    for (let j = brace; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') {
        depth--
        if (depth === 0) {
          end = j
          break
        }
      }
    }
    const body = src.slice(s, end + 1)
    const header = body.slice(0, 100).replace(/\n/g, ' ')
    console.log('  cand', i, 'len', body.length, 'coversNeedle', rel < end, header.slice(0, 70))
    if (body.length > 800 && rel < end) {
      writeFileSync(
        join(outDir, `gold-19-${tag}-large.txt`),
        `# pos=${pos} fnRel=${s} len=${body.length}\n${body}\n`,
      )
      break
    }
  }
}

extractLarge(buf247, 'm!=="unknown"&&!dZ(e.source)', '247-reg')
extractLarge(buf246, 'm!=="unknown"&&!N8(e.source)', '246-reg')

// Yjo call (not def)
dump(buf247, 214610912, 800, 400, 'gold-19-247-Yjo-callsite.txt')

// also search 247-only strings that mention version + cache
for (const n of [
  'version === "unknown"',
  'version==="unknown"',
  'n==="unknown"',
  't==="unknown"',
  'e==="unknown"',
  '==="unknown"?',
  '==="unknown")',
]) {
  const a = hits(buf247, n, 30)
  const b = hits(buf246, n, 30)
  if (a.length !== b.length) {
    console.log('COUNTDIFF', n, a.length, b.length, a.slice(0, 5))
  }
}
