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

// _582 export table
for (const n of [
  ' as xIb}',
  ' as xIb,',
  'ee as xIb',
  'function ee(e)',
  'xIb as ee',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 10))
  for (const i of hits.slice(0, 3)) console.log('  ', i, ascii(i - 80, i + 60))
}

// _582.js module
const m582 = allHits('root/_582.js')
console.log('_582 imports', m582.length)
const exp582 = buf.indexOf(Buffer.from('from"B:/~BUN/root/_582.js"'))
// find export of _582 itself
const bun582 = []
for (const i of allHits('// @bun')) {
  /* skip */
}
const file582 = buf.indexOf(Buffer.from('_582.js'))
console.log('first _582.js', file582)

// export{ ... as xIb
const asXib = allHits('as xIb')
console.log('as xIb', asXib)
for (const i of asXib) console.log(i, ascii(i - 100, i + 20))
