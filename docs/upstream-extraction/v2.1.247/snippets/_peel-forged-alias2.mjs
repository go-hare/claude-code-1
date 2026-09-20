import { readFileSync, writeFileSync, existsSync } from 'fs'

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

function extractFrom(offset, max = 6000) {
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

const leave = allHits('leaveOutUncommittedCredentialFiles')
console.log('leaveOut', leave)
for (const i of leave) console.log(i, ascii(i - 80, i + 160))

const yi = buf.indexOf(Buffer.from('function Yi({staged:e,working:t})'))
console.log('Yi', yi)
writeFileSync(`${outDir}/gold-forged-Yi.txt`, extractFrom(yi, 1500))

const wi = buf.indexOf(Buffer.from('async function Wi(e,{staged:t,working:i}'))
console.log('Wi', wi)
writeFileSync(`${outDir}/gold-forged-Wi.txt`, extractFrom(wi, 4000))

// function ee used by le — imported xIb as ee from _582
console.log('\n==== G3a / H3a importers ====')
for (const n of [
  'as G3a}',
  'as G3a,',
  'G3a as',
  'as H3a}',
  'as H3a,',
  'H3a as',
]) {
  const hits = allHits(n)
  console.log(n, hits)
  for (const i of hits.slice(0, 6)) console.log('  ', i, ascii(i - 50, i + 40))
}

// unique error strings
for (const n of [
  'could not compare the built',
  'leaveOutUncommitted',
  'credential file',
  'forged path',
  'Windows short name',
]) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 5))
  for (const i of hits.slice(0, 3)) console.log('  ', ascii(i, i + 120))
}

// 246 le/be bodies
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
if (existsSync(p246)) {
  const b = readFileSync(p246)
  const le = 'function le(e){return ee(Vi(e))&&!Ji(e)}'
  const be =
    'function be(e){let t=W();return(t==="windows"||t==="wsl")&&e.replaceAll'
  console.log('246 le', b.indexOf(Buffer.from(le)))
  console.log('246 be', b.indexOf(Buffer.from(be)))
  console.log('246 Yi', b.indexOf(Buffer.from('function Yi({staged:e,working:t})')))
  console.log(
    '246 nn',
    b.indexOf(Buffer.from('async function nn(e,t,i,n){let r=await e(["diff-tree"')),
  )
}
