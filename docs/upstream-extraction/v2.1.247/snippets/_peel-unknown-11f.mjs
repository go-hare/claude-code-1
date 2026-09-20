import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
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

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-11-unk-CZ.txt',
  asciiWindow(b247, 210431400, 210431650) + '\n',
)
console.log('CZ win', asciiWindow(b247, 210431400, 210431650))

// find ,CZ=8 or CZ=32 etc in mN / adapter vars
const hits = []
const n = Buffer.from('CZ=')
let i = 0
while (hits.length < 12) {
  const j = b247.indexOf(n, i)
  if (j < 0) break
  const win = asciiWindow(b247, j, j + 20)
  if (j > 210000000 && j < 211000000) hits.push([j, win])
  i = j + 2
}
console.log('CZ near sandbox', hits)

// or() definition: search "function or(" globally count
function count(s) {
  const n2 = Buffer.from(s)
  let c = 0
  let from = 0
  const offs = []
  while (c < 8) {
    const j = b247.indexOf(n2, from)
    if (j < 0) break
    offs.push(j)
    c++
    from = j + n2.length
  }
  console.log(JSON.stringify(s), c, offs)
}
count('function or(')
count('function so(')
count('or()&&so()')
count('$r()&&mu()')
