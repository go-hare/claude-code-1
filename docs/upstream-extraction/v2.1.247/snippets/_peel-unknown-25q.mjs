import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiSlice(buf, start, end) {
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

function dump(name, buf, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# @${i}\n\n${asciiSlice(buf, i - before, i + after)}\n`,
  )
}

const spots = [
  ['import-sKc', 235960795, 80, 250],
  ['import-vKc-212842902', 212842902, 80, 250],
  ['import-vKc-232063062', 232063062, 80, 250],
  ['import-vKc-233777861', 233777861, 80, 250],
  ['import-oKc-212842826', 212842826, 80, 250],
  ['import-oKc-209320020', 209320020, 80, 200],
  ['import-oKc-222876345', 222876345, 80, 200],
  ['return-Wr-208219423', 208219423, 250, 200],
  ['return-Wr-208308647', 208308647, 250, 200],
  ['Wr-208219347', 208219347, 150, 150],
  ['unprintable-204012605', 204012605, 80, 80],
]

for (const [name, i, b, a] of spots) {
  dump(`gold-25-escape-${name}.txt`, b247, i, b, a)
}

// 246 unprintable + plugin CLI U
function allHits(buf, needle) {
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
console.log('246 unprintable', allHits(b246, 'unprintable plugin name'))
console.log('246 e.map(ke)', allHits(b246, 'e.map(ke).join'))
console.log('247 e.map(ke)', allHits(b247, 'e.map(ke).join'))
