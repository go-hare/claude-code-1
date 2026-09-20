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

function findAll(needle, limit = 25) {
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

// plugin-id module around k/v
dump('gold-dig-pluginId-k-v.txt', 210752850, 400, 900)

// marketplace module import of ho — search import{ near 21452xxxx
for (const n of [
  'ho as ',
  ',ho,',
  '{ho}',
  'k as ho',
  'v as ho',
  'X as ho',
]) {
  const hits = findAll(n, 20)
  console.log(n, hits)
  for (const i of hits) {
    if (i > 214400000 && i < 214600000) {
      dump(`gold-dig-ho-import-${i}.txt`, i, 80, 200)
    }
    if (i > 210700000 && i < 210800000) {
      dump(`gold-dig-ho-export-${i}.txt`, i, 80, 250)
    }
  }
}

// plugin-id module exports
dump('gold-dig-pluginId-exports.txt', 210753400, 0, 800)

// mza full
dump('gold-dig-mza-full.txt', 214547233, 20, 2800)

// callers
for (const n of [
  'hza(',
  'await hza(',
  'yza(',
  'fza(',
  'await fza(',
  'mBo(',
  'await mBo(',
]) {
  const hits = findAll(n, 20)
  console.log('\nCALL', n, hits)
  for (const i of hits) {
    const win = asciiWindow(buf, i - 40, i + 70)
    console.log(' ', i, win.replace(/\n/g, ' ').slice(0, 160))
  }
}

// qb factory bodies near plugin/storage
for (const i of [207000591, 208566880, 209336757, 211021159]) {
  const win = asciiWindow(buf, i, i + 220)
  console.log('\nqb', i, win.replace(/\n/g, ' ').slice(0, 200))
}

dump('gold-dig-qb-208566880.txt', 208566880, 40, 600)
dump('gold-dig-qb-211021159.txt', 211021159, 40, 600)

// Ne() near marketplace
for (const n of ['function Ne(){', 'function Ne(){return']) {
  const hits = findAll(n, 10)
  console.log('Ne', n, hits)
  for (const i of hits) {
    if (i > 210000000 && i < 215000000) {
      dump(`gold-dig-Ne-${i}.txt`, i, 20, 200)
    }
  }
}

// plugin loader NSt call
dump('gold-dig-NSt-caller-214691149.txt', 214691149, 200, 250)
