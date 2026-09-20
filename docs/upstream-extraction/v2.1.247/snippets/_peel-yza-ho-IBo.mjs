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
  const text = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${text}\n`,
  )
  console.log('OK', name, i, 'len', text.length)
}

// yza is not async
dump('gold-dig-yza-full.txt', 214558866, 20, 4500)

// IBo called by yza — likely the actual refresh body
for (const n of [
  'async function IBo(',
  'function IBo(',
  'async function LSt(',
  'function LSt(',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits) {
    const win = asciiWindow(buf, i, i + 200)
    console.log(' ', i, win.slice(0, 180).replace(/\n/g, ' '))
    if (i > 214000000 && i < 215000000) {
      dump(
        `gold-dig-${n.includes('IBo') ? 'IBo' : 'LSt'}-${i}.txt`,
        i,
        20,
        4000,
      )
    }
  }
}

// parsePluginIdentifier near marketplace cluster (~2145xxxxx)
const clusterStart = 214500000
const clusterEnd = 214600000
const hoNeedle = Buffer.from('function ho(')
let from = clusterStart
const clusterHo = []
while (true) {
  const i = buf.indexOf(hoNeedle, from)
  if (i < 0 || i > clusterEnd) break
  clusterHo.push(i)
  from = i + 1
}
console.log('cluster ho', clusterHo)
for (const i of clusterHo) {
  dump(`gold-dig-ho-cluster-${i}.txt`, i, 40, 500)
}

// search unique parse patterns
for (const n of [
  'lastIndexOf("@")',
  'indexOf("@")',
  '{name:e.slice(0',
  'marketplace:e.slice',
  'split("@")',
  'function hi(',
  'function ho(e){let',
]) {
  const hits = findAll(n, 15)
  console.log(n, hits.slice(0, 12))
  for (const i of hits) {
    if (i > 214400000 && i < 214700000) {
      const win = asciiWindow(buf, i - 80, i + 200)
      console.log('  near-mkt', i, win.slice(0, 220).replace(/\n/g, ' '))
      dump(`gold-dig-at-${i}.txt`, i, 80, 400)
    }
  }
}

// export aliases already known: NSt as Eea — find import binding of ho
for (const n of [
  'ho as ',
  ' as ho,',
  ',ho as',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
}

// dump NSt + following sibling (cache-only vs get)
dump('gold-dig-NSt-sib.txt', 214556179, 20, 2500)
dump('gold-dig-B$-mkt.txt', 214556922, 20, 2500)
dump('gold-dig-hza-plus.txt', 214557317, 20, 5500)
