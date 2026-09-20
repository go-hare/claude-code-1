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

const He = [
  236006377, 236014926, 236076862, 236105164, 236111977, 236112586, 236114331,
  236114846, 236115919, 236117091, 236117852, 236118991,
]
let out = ''
for (const i of He) {
  out += `\n===== He @${i} =====\n${asciiSlice(b247, i - 80, i + 140)}\n`
}
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-25-escape-ui-He-all.txt',
  out,
)

const he = [
  236004060, 236004294, 236006442, 236006775, 236006862, 236014977, 236015329,
  236030854, 236031218, 236031518, 236031558, 236031942,
]
out = ''
for (const i of he) {
  out += `\n===== he @${i} =====\n${asciiSlice(b247, i - 70, i + 130)}\n`
}
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-25-escape-ui-he-all.txt',
  out,
)

dump('gold-25-escape-ui-zt.txt', 236031984, 80, 200)
dump('gold-25-escape-ui-lh.txt', 236115850, 80, 150)
dump('gold-25-escape-F0c-regex.txt', 207248800, 0, 800)
dump('gold-25-escape-cli-U-full.txt', 233803353, 0, 80)

// plugin list human - search Installed plugins
function find(n) {
  const b = Buffer.from(n)
  const hits = []
  let from = 0
  while (from < b247.length) {
    const i = b247.indexOf(b, from)
    if (i < 0) break
    hits.push(i)
    from = i + b.length
  }
  return hits
}
for (const n of [
  'Installed plugins:',
  'Available plugins:',
  'No plugins installed',
  'Successfully removed marketplace:',
]) {
  console.log(n, find(n))
}
