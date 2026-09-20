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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

const head = asciiWindow(buf, 211415952, 211438300)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-tI-hfb-head22k.txt',
  `# hfb-mod 211415952..211438300\n\n${head}\n`,
)

for (const n of [' as F,', ' as F}', 'Hyd as F', 'as F,', 'F=class', 'F=h', 'extends Error']) {
  const hits = []
  let from = 0
  while (hits.length < 8) {
    const i = head.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  console.log(JSON.stringify(n), hits)
  for (const i of hits.slice(0, 3)) {
    console.log(' ', head.slice(Math.max(0, i - 70), i + 90).replace(/\n/g, ' '))
  }
}

// dump z wrapper at computed offset
dump('gold-dig-Ar-z-body.txt', 206447190 + 6228, 40, 280)
dump('gold-dig-tI-class-body.txt', 211438284, 20, 80)
dump('gold-dig-tI-throw-dd.txt', 211437368, 40, 280)

// all new ce( in hfb — dump first and policy ones
dump('gold-dig-tI-throw-consent.txt', 211433948, 80, 220)

// F assignment before ce class
const beforeCe = asciiWindow(buf, 211415952, 211438284)
const fAssign = Math.max(
  beforeCe.lastIndexOf('F=class'),
  beforeCe.lastIndexOf('var F='),
  beforeCe.lastIndexOf(',F='),
  beforeCe.lastIndexOf('F=h'),
)
console.log('F assign last', fAssign)
if (fAssign >= 0) {
  const abs = 211415952 + fAssign
  console.log(asciiWindow(buf, abs, abs + 200))
  dump('gold-dig-tI-F-parent.txt', abs, 40, 220)
}

// import as F in head
const re = [...head.matchAll(/([A-Za-z0-9_$]+) as F[,}]/g)]
console.log('import as F', re.map((m) => m[0] + ' @' + m.index))
