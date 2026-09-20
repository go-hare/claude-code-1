import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function at(name, offset, before, after) {
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${offset}\n\n${ascii(Math.max(0, offset - before), offset + after)}\n`,
  )
  console.log('OK', name, offset)
}

function dump(name, needle, before, after, which = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[which] ?? hits[0]
  at(name, i, before, after)
  console.log('  hit', `${which + 1}/${hits.length}`)
}

for (const n of [
  'function wv(e,t,n',
  'function wv(e,t',
  'async function kv(',
  'function kv(e,t',
  'function Lo(e){',
  'advertisedCommand===void',
  'failedTipIds=new Set',
  'this.failedTipIds',
  'getMarketplacePluginTips',
]) {
  console.log(n, allHits(n).slice(0, 8), 'n', allHits(n).length)
}

at('gold-2-Lo-near-Pi.txt', 222272743, 80, 600)
at('gold-11-gitignore-208.txt', 208313737, 500, 800)
at('gold-11-osLinked-203.txt', 203145929, 400, 900)
at('gold-2-Vm-223.txt', 223315866, 80, 400)

// Ie/Pe imports in tips module
dump('gold-2-import-Ie.txt', 'Ie as', 80, 120)
dump('gold-2-Whe-import.txt', 'Wd as Whe', 80, 200)
dump('gold-2-Pe-import.txt', 'Pe as', 40, 80)

// extract functions by walking braces from known unique starts
function extractFrom(offset, max = 2500) {
  let i = offset
  let depth = 0
  let seen = false
  while (i < offset + max && i < buf.length) {
    if (buf[i] === 123) {
      depth++
      seen = true
    } else if (buf[i] === 125) {
      depth--
      if (seen && depth === 0) return ascii(offset, i + 1)
    }
    i++
  }
  return ascii(offset, Math.min(offset + max, buf.length))
}

// Find "function Lo(" at 222272743 and extract
writeFileSync(`${outDir}/gold-2-Lo-fn.txt`, extractFrom(222272743 - 20, 1500))
console.log('extracted Lo')

// gitignore writer near 208313737 — walk back to function
{
  const i = 208313737
  const back = ascii(i - 1500, i)
  const idx = back.lastIndexOf('function ')
  console.log('gitignore back fn snippet', back.slice(Math.max(0, idx), idx + 200))
  if (idx >= 0) {
    const start = i - 1500 + idx
    writeFileSync(`${outDir}/gold-11-kv-fn.txt`, extractFrom(start, 3000))
    console.log('extracted kv-like', start)
  }
}
