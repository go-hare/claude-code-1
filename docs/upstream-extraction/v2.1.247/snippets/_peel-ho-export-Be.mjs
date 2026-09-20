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
    from = i + 1
  }
  return hits
}

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

// plugin-id module export after W=S
dump('gold-dig-pluginId-after-W.txt', 210753400, 0, 2500)

// marketplace factory that closes nme/XFe — search var ...=w(() near 214521000
dump('gold-dig-mkt-before-nme.txt', 214521154, 1500, 80)

for (const n of [
  'k as ho',
  'v as ho',
  'X as ho',
  ' as ho,nme',
  ' as ho,XFe',
  'ho as k',
  'export{k as',
  'k as hi',
  'function k(e){if(e.includes("@"))',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits) {
    console.log(' ', asciiWindow(buf, i, i + 120).replace(/\n/g, ' '))
    dump(`gold-dig-bind-${n.replace(/[^A-Za-z0-9]/g, '_')}-${i}.txt`, i, 40, 200)
  }
}

// Be() hover-rest near CLAUDE_CODE_HOVER_REST 220100463
dump('gold-dig-hover-220100463.txt', 220100463, 200, 800)
dump('gold-dig-hover-207184732.txt', 207184732, 200, 600)
dump('gold-dig-hover-209224774.txt', 209224774, 200, 600)

for (const n of [
  'function Be(){',
  'function Be(){return',
  'qb=function',
  'function qb(){return}',
  'function qb(){}',
]) {
  const hits = findAll(n, 12)
  console.log(n, hits)
  for (const i of hits) {
    if (i > 206000000 && i < 221000000) {
      const win = asciiWindow(buf, i, i + 160)
      console.log(' ', i, win.replace(/\n/g, ' ').slice(0, 160))
    }
  }
}

// official plugin marketplace update calling hza/yza
for (const n of [
  'Updating marketplace',
  'Updating ',
  'plugin marketplace update',
  'tengu_marketplace_updated',
]) {
  const hits = findAll(n, 6)
  console.log('str', n, hits)
  for (const i of hits) {
    if (i > 210000000 && i < 220000000) {
      dump(
        `gold-dig-upd-${n.replace(/[^A-Za-z0-9]/g, '_').slice(0, 20)}-${i}.txt`,
        i,
        80,
        250,
      )
    }
  }
}
