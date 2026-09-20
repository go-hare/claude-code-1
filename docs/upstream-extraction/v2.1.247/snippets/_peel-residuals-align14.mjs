import { readFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

console.log('=== function Qi(e){ ===')
for (const i of allHits('function Qi(e){').slice(0, 25)) {
  console.log(i, ascii(i, i + 140))
}

console.log('=== function Vm(e){ ===')
for (const i of allHits('function Vm(e){').slice(0, 15)) {
  const s = ascii(i, i + 120)
  if (/dir|lstat|stat|git|path|isDir/i.test(s)) console.log(i, s)
}

console.log('=== function Be(){ near 20856 ===')
for (const i of allHits('function Be(){')) {
  if (i > 208500000 && i < 208600000) console.log(i, ascii(i, i + 160))
}

console.log('Be hits', allHits('function Be(){').length)

console.log('=== getBuiltinCommands ===')
console.log(allHits('function getBuiltinCommands').slice(0, 5))
console.log(allHits('getBuiltinCommands').slice(0, 8))
