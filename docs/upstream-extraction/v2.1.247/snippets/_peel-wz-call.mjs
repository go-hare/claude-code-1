import { existsSync, readFileSync, writeFileSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const buf = readFileSync(p247)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function ascii(start, end) {
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

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, needle, before, after, which = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[which] ?? hits[0]
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${ascii(Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, `${which + 1}/${hits.length}`, ascii(i, Math.min(i + 80, buf.length)))
}

for (const [name, needle] of [
  ['gold-11-WZ-jn.txt', 'WZ(jn())'],
  ['gold-11-WZ-L.txt', 'WZ(L)'],
  ['gold-11-WZ-G.txt', 'WZ(G)'],
  ['gold-11-let-e-WZ.txt', '=WZ('],
  ['gold-11-set-true.txt', 'builtConfigEnforcesAllowlist.set('],
]) {
  dump(name, needle, 120, 200)
}
