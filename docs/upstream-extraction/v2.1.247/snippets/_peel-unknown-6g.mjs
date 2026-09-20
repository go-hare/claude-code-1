import { readFileSync, writeFileSync } from 'fs'

const bufs = {
  246: readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
  ),
  247: readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  ),
}

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

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
    if (hits.length > 20) break
  }
  return hits
}

function dump(ver, tag, needle, before, after, which = 0) {
  const buf = bufs[ver]
  const hits = allHits(buf, needle)
  if (!hits.length) {
    console.log('MISS', ver, tag, JSON.stringify(needle))
    return
  }
  const i = hits[Math.min(which, hits.length - 1)]
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-6-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', ver, tag, `${which + 1}/${hits.length}`, i)
}

console.log('=== AD / getter inits ===')
for (let i = 0; i < 5; i++) dump(247, `ad-fn-${i}`, 'function AD(', 80, 800, i)
dump(247, 'tt-init', 'he[tt()]', 4000, 200)
dump(247, 'cfg-tuple', 'tt()]', 2500, 200)
dump(247, 'skills-accept', '"select:accept":vo', 2000, 1500)
dump(246, 'fuzzy-enter', 'i[P]', 400, 400, 0)
dump(247, 'fuzzy-enter', 'r[ke().focus]', 200, 200, 0)
dump(246, 'mcp-accept', 'W[O]', 200, 400, 0)
dump(247, 'mcp-accept', 'he[B()]', 200, 400)
dump(246, 'bg-accept', 'Ce[N]', 200, 400, 0)
dump(247, 'bg-accept', 'Ie[ce()]', 200, 400, 0)
