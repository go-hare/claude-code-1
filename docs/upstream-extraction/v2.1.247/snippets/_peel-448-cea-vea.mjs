import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

const chunkStart = 219716767
const chunkHead = asciiWindow(buf, chunkStart, chunkStart + 800)
console.log('chunk-head', chunkHead.slice(0, 400))

// Find export{ ... Cea ... vea ... } after chunk start, before next // _449
const nextChunk = buf.indexOf(Buffer.from('B:/~BUN/root/_449.js'), chunkStart)
console.log('next449', nextChunk, 'span', nextChunk - chunkStart)

const span = asciiWindow(buf, chunkStart, Math.min(chunkStart + 2_500_000, nextChunk > 0 ? nextChunk : chunkStart + 2_500_000))

const exportHits = []
let idx = 0
while (exportHits.length < 20) {
  const i = span.indexOf('export{', idx)
  if (i < 0) break
  const win = span.slice(i, i + 800)
  if (win.includes('Cea') || win.includes('vea')) {
    exportHits.push(win.slice(0, 500))
  }
  idx = i + 7
}
console.log('export-hits', exportHits.length)
for (const h of exportHits) console.log('EXP', h.slice(0, 400), '\n---')

// Find `as Cea` binding: typically `function ke(...)` ... `ke as Cea`
// Search unique strings near getMarketplace / knownMarketplaces in this chunk
for (const needle of [
  'function et(',
  'async function et(',
  'knownMarketplaces',
  'loadKnownMarketplaces',
  'getMarketplace(',
  'async function getMarketplace',
]) {
  const i = span.indexOf(needle)
  console.log('in-span', needle, i)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-448-exports.txt',
  exportHits.join('\n\n====\n\n'),
)
