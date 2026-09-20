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

const mr = 214541129
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-MR-full.txt',
  asciiWindow(buf, mr, mr + 800),
)
console.log('MR', asciiWindow(buf, mr, mr + 500))

// jS() used as ISt(r,jS()) — find function jS near MR
const region = asciiWindow(buf, 214500000, 214560000)
let idx = 0
let n = 0
while (n < 8) {
  const i = region.indexOf('function jS(', idx)
  if (i < 0) break
  console.log('jS-in-region', i, region.slice(i, i + 250))
  idx = i + 10
  n++
}

const mst = buf.indexOf(Buffer.from('function mSt(e,t){'), 214000000)
console.log('mSt', mst)
if (mst > 0) console.log(asciiWindow(buf, mst, mst + 400))

const ffe = buf.indexOf(Buffer.from('async function FFe(e,t,n){'), 214000000)
console.log('FFe', ffe)
if (ffe > 0) console.log(asciiWindow(buf, ffe, ffe + 450))

// WFe binding: Neb as WFe from earlier import
const wfeImp = buf.indexOf(Buffer.from('Neb as WFe'))
console.log('Neb as WFe', wfeImp, wfeImp > 0 ? asciiWindow(buf, wfeImp - 40, wfeImp + 20) : '')
