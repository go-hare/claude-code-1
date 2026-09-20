import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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
  const limit = Math.min(buf.length, bracePos + 80000)
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
      if (depth === 0) return { start: bracePos, end: i + 1 }
    }
    i++
  }
  return null
}

function extractFromKeyword(buf, fnAt) {
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
  const src = buf.toString('ascii', start, braced.end)
  return {
    start,
    end: braced.end,
    name,
    len: braced.end - start,
    src,
    sha: createHash('sha256').update(src).digest('hex').slice(0, 16),
  }
}

function dump(name, text) {
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name, text.length)
}

function walkChain(buf, start, count, tag) {
  const lines = [`# ${tag} walk from ${start}`, '']
  let pos = start
  for (let n = 0; n < count; n++) {
    const kw = buf.toString('ascii', pos, pos + 9)
    if (kw !== 'function ') {
      lines.push(`STOP n=${n} pos=${pos} next=${JSON.stringify(buf.toString('ascii', pos, pos + 40))}`)
      break
    }
    const fn = extractFromKeyword(buf, pos)
    if (!fn) {
      lines.push(`FAIL extract pos=${pos}`)
      break
    }
    lines.push(`n=${n} function ${fn.name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha}`)
    dump(
      `gold-11-unk-chain-${tag}-${n}-${fn.name}.txt`,
      `# ${tag} n=${n} function ${fn.name} start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha}\n\n${fn.src}\n`,
    )
    pos = fn.end
  }
  dump(`gold-11-unk-chain-${tag}.txt`, lines.join('\n'))
}

// 247: Zt ends 210375654 → bu should start there
walkChain(b247, 210375654, 20, '247-after-Zt')
// 247: LZ ends 210415029 → UZ already in neighborhood; walk to lock
walkChain(b247, 210415029, 16, '247-after-LZ')
// 246: Zt ends 209122769
walkChain(b246, 209122769, 12, '246-after-Zt')
// 246: TZ ends 209160257
walkChain(b246, 209160257, 8, '246-after-TZ')

console.log('DONE 11c')
