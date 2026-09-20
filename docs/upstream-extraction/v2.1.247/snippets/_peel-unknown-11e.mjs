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

function dump(name, start, end) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ${start}-${end}\n\n${asciiWindow(b247, start, end)}\n`,
  )
  console.log('WROTE', name)
}

// just before Zt / bu
dump('gold-11-unk-pre-Zt.txt', 210374800, 210375700)
// search CZ= in 210360000-210376000
const n = Buffer.from('CZ=')
let i = 210360000
let c = 0
while (i < 210420000 && c < 8) {
  const j = b247.indexOf(n, i)
  if (j < 0 || j > 210420000) break
  console.log('CZ=', j, asciiWindow(b247, j - 40, j + 40))
  i = j + 2
  c++
}
const n2 = Buffer.from(',CZ=')
console.log('comma CZ', b247.indexOf(n2, 210360000))
const n3 = Buffer.from('var CZ=')
console.log('var CZ', b247.indexOf(n3))
const n4 = Buffer.from('i=CZ')
console.log('i=CZ', b247.indexOf(n4, 210375000), asciiWindow(b247, 210376000, 210376080))

// or()&&so() near UZ
const orso = b247.indexOf(Buffer.from('if(or()&&so())return null'), 210415000)
console.log('orso', orso)

// function or( / function so(
function findFn(name) {
  const needle = Buffer.from(`function ${name}(`)
  const hits = []
  let from = 210370000
  while (from < 210440000) {
    const j = b247.indexOf(needle, from)
    if (j < 0 || j > 210440000) break
    hits.push(j)
    from = j + 1
  }
  console.log('fn', name, hits)
}

findFn('or')
findFn('so')
dump('gold-11-unk-wrap-init-VZ-FZ.txt', 210427400, 210427800)
