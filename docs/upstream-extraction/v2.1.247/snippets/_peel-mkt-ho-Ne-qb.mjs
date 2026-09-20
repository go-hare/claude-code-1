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

// marketplace module factory start — search backward from U$ 214524794
dump('gold-dig-mkt-mod-U-start.txt', 214524794, 2500, 200)

for (const n of [
  'as ho,',
  'as ho}',
  'k as ho',
  ',ho as',
  'ho as Eea',
  'k as ',
]) {
  const hits = findAll(n, 20)
  console.log(n, hits)
}

// plugin-id export block
for (const n of [
  'k as ',
  'v as ',
  'X as ',
  'Z as ',
]) {
  const hits = findAll(n, 8).filter((i) => i > 210750000 && i < 210760000)
  console.log('pluginId-export', n, hits)
  for (const i of hits) {
    console.log(' ', i, asciiWindow(buf, i, i + 80).replace(/\n/g, ' '))
  }
}

// marketplace-local Ne
const neHits = findAll('function Ne(){', 20)
for (const i of neHits) {
  if (i > 214000000 && i < 215000000) {
    dump(`gold-dig-mkt-Ne-${i}.txt`, i, 20, 180)
  }
}

// hover-rest Ne used by U$ — already known pattern Ne()&&e!==void 0
// find function Ne in same chunk as XFe
for (const n of ['function XFe(', 'function Ne(){return']) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits) {
    if (Math.abs(i - 214524794) < 800000) {
      dump(
        `gold-dig-${n.replace(/[^A-Za-z0-9]/g, '_')}-${i}.txt`,
        i,
        40,
        300,
      )
    }
  }
}

// exported aliases callers
for (const n of [
  'Gea(',
  'await Gea(',
  'Hea(',
  'xea(',
  'wea(',
  'Eea(',
  'Fea(',
  'zea(',
]) {
  const hits = findAll(n, 15)
  console.log('alias', n, hits)
  for (const i of hits.slice(0, 6)) {
    console.log(' ', i, asciiWindow(buf, i - 30, i + 60).replace(/\n/g, ' '))
  }
}

// storage FromEnv empty factory — search unique strings from local comments
for (const n of [
  'function qb(){return{',
  'qb=()=>',
  'createBackend',
  'tryCreateV5Backend',
  'CLAUDE_CODE_HOVER_REST',
]) {
  const hits = findAll(n, 8)
  console.log('sv5', n, hits)
  if (hits[0] != null && n.includes('HOVER')) {
    dump('gold-dig-hover-rest-env.txt', hits[0], 80, 400)
  }
}

// Qx / cacheMarketplaceFromGit storage 3rd
for (const n of ['async function Qx(', 'function Qx(']) {
  const hits = findAll(n, 6)
  console.log(n, hits)
  for (const i of hits) {
    if (i > 214500000 && i < 214560000) {
      dump(`gold-dig-Qx-${i}.txt`, i, 20, 400)
    }
  }
}

// find ho(e) in marketplace cluster only
const hoCall = findAll('=ho(e)', 10)
console.log('=ho(e)', hoCall)
for (const i of hoCall) {
  dump(`gold-dig-ho-call-${i}.txt`, i, 60, 80)
}
