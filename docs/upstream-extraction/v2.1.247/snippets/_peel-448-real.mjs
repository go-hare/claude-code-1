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

function findAll(needle, limit = 20) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

// unique export names from _448
for (const needle of [
  'Cea as',
  'as Cea',
  'vea as',
  'as vea',
  'export{Cea',
  'Cea,vea',
  'vea,Cea',
]) {
  const hits = findAll(needle, 15)
  console.log(needle, hits)
}

// Search export blocks containing both Cea and vea
const exportAt = findAll('export{', 4000)
let both = 0
for (const i of exportAt) {
  const win = asciiWindow(buf, i, i + 1200)
  if (win.includes('Cea') && win.includes('vea')) {
    both++
    writeFileSync(
      'docs/upstream-extraction/v2.1.247/snippets/gold-dig-448-export-block.txt',
      `# offset=${i}\n\n${win}\n`,
    )
    console.log('BOTH-EXPORT', i, win.slice(0, 500))
    if (both >= 3) break
  }
}
console.log('both-count-stopped', both)
