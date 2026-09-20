import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# @${i}\n\n${asciiSlice(b247, i - before, i + after)}\n`,
  )
}

dump('gold-25-escape-cli-details-_n.txt', 233801400, 50, 900)
dump('gold-25-escape-ui-ah-manifest.txt', 236118800, 80, 800)
dump('gold-25-escape-cli-U-body.txt', 233803300, 20, 400)
dump('gold-25-escape-cli-ke-remove.txt', 233794500, 20, 200)

// search He( near ah - He is Vr in that module
function allHits(needle, from, to) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (i < to) {
    const j = b247.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

for (const n of ['He(', 'ah(', 'he(', 'zt(', 'lh(', 'Xd(']) {
  const hits = allHits(n, 236000000, 236250000)
  console.log(n, hits.length, hits.slice(0, 12))
}

dump('gold-25-escape-ui-He-first.txt', 236118900, 0, 400)
