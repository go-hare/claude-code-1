import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
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

function allHits(buf, needle, from, to) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (i < to) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

function dumpHits(label, buf, needle, from, to, before = 60, after = 120) {
  const hits = allHits(buf, needle, from, to)
  let out = `# ${label} ${JSON.stringify(needle)} count=${hits.length}\n`
  for (const i of hits.slice(0, 30)) {
    out += `\n--- @${i} ---\n${asciiSlice(buf, i - before, i + after)}\n`
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${label}.txt`,
    out,
  )
  console.log(label, needle, hits.length, hits.slice(0, 15))
}

// plugin CLI module around import + U
dumpHits('gold-25-escape-cli-ke', b247, 'ke(', 233770000, 233900000)
dumpHits('gold-25-escape-cli-_n', b247, '_n(', 233770000, 233900000)
dumpHits('gold-25-escape-cli-D', b247, 'D(', 233770000, 233900000, 40, 80)
dumpHits('gold-25-escape-cli-U', b247, 'function U', 233770000, 233900000)

// /plugin UI module
dumpHits('gold-25-escape-ui-iG', b247, 'iG(', 212800000, 213200000)
dumpHits('gold-25-escape-ui-UXe', b247, 'UXe(', 212800000, 213200000)
dumpHits('gold-25-escape-ui-Aat', b247, 'Aat(', 212800000, 213200000)

// sKc as ah usage
dumpHits('gold-25-escape-ah', b247, 'ah(', 235950000, 236200000)

// 246 plugin CLI aliases
dumpHits('gold-25-escape-246-cli-ke', b246, 'ke(', 231760000, 231900000)
