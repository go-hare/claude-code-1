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

const body =
  'function Ji(e){let t=W();return(t==="windows"||t==="wsl")&&e.replaceAll("\\\\","/").split("/").some((i)=>i.includes(":")||/[. ]$/.test(i))}'
const needle = 't==="windows"||t==="wsl")&&e.replaceAll'
const hits = allHits(needle)
console.log('body hits', hits)
for (const i of hits) {
  console.log(i, ascii(i - 80, i + 200))
}

const ji = buf.indexOf(Buffer.from('function Ji(e){let t=W();return(t==="windows"'))
console.log('function Ji start', ji)
writeFileSync(`${outDir}/gold-11-Ji-210738-full.txt`, extractFrom(ji, 400))
writeFileSync(`${outDir}/gold-11-Ji-210738-nbhd.txt`, ascii(ji - 1500, ji + 2500))

console.log('\n==== functions around Ji ====')
console.log(ascii(ji - 800, ji + 900))

console.log('\n==== Ji( call sites in sandbox window 210300-210450 ====')
for (const n of ['if(Ji(', 'Ji(e)', 'Ji(t)', 'Ji(n)', 'Ji(s)', 'Ji(d)', '||Ji(', '&&Ji(']) {
  const hs = allHits(n).filter(x => x > 210300000 && x < 210450000)
  console.log(n, hs)
  for (const i of hs.slice(0, 8)) console.log('  ', i, ascii(i - 40, i + 80))
}

console.log('\n==== all if(Ji( in exe (first 20) ====')
for (const i of allHits('if(Ji(').slice(0, 25)) {
  console.log(i, ascii(i, i + 70))
}

console.log('\n==== W() near this Ji ====')
for (const n of ['function W()', 'W=function', 'function W(e)']) {
  const hs = allHits(n).filter(x => x > ji - 80000 && x < ji)
  console.log(n, hs.slice(-5))
  for (const i of hs.slice(-2)) console.log('  ', i, ascii(i, i + 80))
}

const lastFrom = buf.lastIndexOf(Buffer.from('from"'), ji)
console.log('\nlast from before Ji', lastFrom, ascii(lastFrom - 180, lastFrom + 40))
const bun = buf.lastIndexOf(Buffer.from('// @bun'), ji)
console.log('last @bun before Ji', bun, ascii(bun, bun + 80))
