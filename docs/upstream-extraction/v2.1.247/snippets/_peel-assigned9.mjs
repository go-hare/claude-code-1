import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
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

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = b247.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

function dump(name, needle, before, after, idx = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[Math.min(idx, hits.length - 1)]
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)}\n\n${asciiWindow(b247, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length)
}

for (const n of [
  'provision,clone,start_cc',
  'provision,start_cc',
  'Runner registered',
  'start_cc',
  'worker_status:"running"',
  ',"running",',
]) {
  console.log(allHits(n).length, JSON.stringify(n), allHits(n).slice(0, 4))
}

dump('gold-21-provision-clone.txt', 'provision,clone,start_cc', 4000, 4000)
dump('gold-22-yo-imports.txt', 'function Yo({host:i,onDone:s})', 6000, 200)
dump('gold-19-rm-versioned.txt', 'recursive:!0,force:!0', 400, 200, 0)
