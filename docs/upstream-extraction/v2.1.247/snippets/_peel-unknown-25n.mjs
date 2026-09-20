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

const wrAs = [
  207022220, 207078914, 207812673, 208088694, 208262901, 208896567,
]
for (const i of wrAs) dump(`gold-25-escape-Wr-as-${i}.txt`, i, 80, 200)

dump('gold-25-escape-plugins-map-207876214.txt', 207876214, 200, 400)
dump('gold-25-escape-Vr-T-210381731.txt', 210381731, 300, 400)
dump('gold-25-escape-Vr-T-210382126.txt', 210382126, 200, 300)
dump('gold-25-escape-Vr-v-212559064.txt', 212559064, 200, 300)
dump('gold-25-escape-Wr-F-233656539.txt', 233656539, 200, 300)

// plugins.map near plugin CLI
for (const i of [233514396, 233742735]) {
  dump(`gold-25-escape-plugins-map-${i}.txt`, i, 150, 250)
}
