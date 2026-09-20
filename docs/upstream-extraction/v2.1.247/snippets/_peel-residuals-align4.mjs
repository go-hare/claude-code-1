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

// WZ module imports just before Zt @210375224
writeFileSync(
  `${outDir}/gold-11-WZ-mod-imports.txt`,
  ascii(210370000, 210375400),
)

// Scan function Vm near sandbox
const vm = allHits('function Vm')
console.log('function Vm', vm.length)
for (const h of vm) {
  if (h > 206000000 && h < 211000000) {
    console.log('Vm sandbox-range', h, ascii(h, h + 220))
  }
}

// Ji/Qi in sandbox range
for (const name of ['function Ji', 'function Qi', 'function Vm']) {
  for (const h of allHits(name)) {
    if (h > 209800000 && h < 210420000) {
      console.log(name, h, ascii(h, h + 250))
    }
  }
}

// as Whe near tip
writeFileSync(
  `${outDir}/gold-2-as-Whe-232.txt`,
  `# 232025933\n\n${ascii(232025800, 232026200)}\n`,
)
writeFileSync(
  `${outDir}/gold-2-as-Whe-212.txt`,
  `# 212824392\n\n${ascii(212824200, 212824600)}\n`,
)

// wrap init windows pN fN
writeFileSync(
  `${outDir}/gold-11-init-win-fN-pN.txt`,
  ascii(210429700, 210430200),
)

// mZ pZ near Fm
writeFileSync(`${outDir}/gold-11-Fm-uu.txt`, ascii(210378345, 210378560))
