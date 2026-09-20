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

function at(name, offset, before, after) {
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${offset}\n\n${ascii(offset - before, offset + after)}\n`,
  )
  console.log('OK', name, offset)
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

at('gold-11-osLinked-sbx.txt', 210377089, 400, 1200)
at('gold-11-gitignore-sbx.txt', 210379483, 400, 800)
at('gold-11-Ji-sbx.txt', 210376923, 300, 200)
at('gold-11-if-Vm-wz.txt', 210418508, 80, 400)
at('gold-2-pe-ctx.txt', 222293933, 400, 400)
at('gold-2-ie-return.txt', 234108505, 80, 400)
at('gold-2-isrelevant-pi.txt', 222293670, 500, 200)

for (const n of ['function Ie()', 'function Lo(', 'function Pe()', 'function Do(']) {
  const hits = allHits(n).filter(i => i > 222200000 && i < 222400000)
  console.log(n, 'near Pi', hits)
}

for (const n of ['function Vm(', 'function Ji(', 'function Qi(', 'Vm=function', 'let Vm=', 'var Vm=']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 15), 'n', hits.length)
}

// imports used by WZ module: look back from 210375000 for Vm Ji Qi
at('gold-11-before-sbx-imports.txt', 210375200, 800, 200)
