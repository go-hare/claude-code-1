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

function extractFrom(offset, max = 3500) {
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

function at(name, offset, before, after) {
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${offset}\n\n${ascii(Math.max(0, offset - before), offset + after)}\n`,
  )
}

at('gold-11-kv-217.txt', 217358620, 80, 40)
writeFileSync(`${outDir}/gold-11-kv-217-fn.txt`, extractFrom(217358620, 4000))
console.log('kv 217', ascii(217358620, 217358620 + 80))

at('gold-2-failedSet.txt', 222269510, 400, 400)

for (const n of ['function wv(', 'function wv(e)', 'wv(t,', 'function Ie(){', 'Ie=()=>', 'function Pe(){return']) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 10))
}

// Ie used in Pi: "||!Ie()"
at('gold-2-Ie-call-wide.txt', 222293950, 2000, 100)

// walk back from ||!Ie() for function Ie
{
  const i = buf.indexOf(Buffer.from('||!Ie()'))
  console.log('||!Ie()', i)
  const back = ascii(i - 8000, i)
  for (const needle of ['function Ie()', 'function Ie(e)', 'Ie=function', 'const Ie=', 'let Ie=']) {
    const idx = back.lastIndexOf(needle)
    console.log(' back', needle, idx)
  }
}

// Pe()!== 
{
  const i = buf.indexOf(Buffer.from('Pe()!=="firstParty"'))
  const back = ascii(i - 8000, i)
  for (const needle of ['function Pe()', 'Pe=function', 'const Pe=', 'let Pe=', 'Pe as']) {
    console.log('Pe back', needle, back.lastIndexOf(needle))
  }
}

// all function wv
for (const [k, i] of allHits('function wv(').entries()) {
  console.log('wv', k, i, ascii(i, i + 60))
}

// Qi/Ji 2-arg definitions near path: look at 210738867 Ji and 210542317 Qi
writeFileSync(`${outDir}/gold-11-Ji-210738.txt`, extractFrom(210738867, 2000))
writeFileSync(`${outDir}/gold-11-Qi-210542.txt`, extractFrom(210542317, 2000))
writeFileSync(`${outDir}/gold-11-Qi-210740.txt`, extractFrom(210740402, 2000))
writeFileSync(`${outDir}/gold-11-Vm-209394.txt`, extractFrom(209394928, 1500))
writeFileSync(`${outDir}/gold-11-Vm-223315.txt`, extractFrom(223315866, 1500))
console.log('extracted Ji Qi Vm candidates')
