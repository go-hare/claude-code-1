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
    if (hits.length > 40) break
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

console.log('=== 6f counts ===')
const needles = [
  'AD as je',
  'function AD(',
  ']=An(',
  ']=vm(',
  'he[tt()]',
  'he[B()]',
  'Ie[ce()]',
  'r[ke().focus]',
  'i[P]',
  'An(0)',
  'vm(0)',
  'B:/~BUN/root/_283.js',
  'return[e,t,()=>',
  'return[n,r,()=>',
  'return[t,n,()=>',
  '.current=typeof',
  'getState:()=>',
]

for (const n of needles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) console.log(`${a}->${b}\t${JSON.stringify(n)}`)
}

dump(247, 'ad-je', 'AD as je', 200, 200, 0)
dump(247, 'mod-283', 'B:/~BUN/root/_283.js', 80, 2500, 0)
dump(247, 'an0', 'An(0)', 400, 800, 0)
dump(247, 'vm0', 'vm(0)', 400, 800, 0)
dump(247, 'he-tt', 'he[tt()]', 1500, 800)
dump(246, 'mcp-js', '"MCP dialog dismissed"', 800, 1500)
dump(246, 'cfg-js', '"Config dialog dismissed"', 800, 1500)
dump(246, 'view-agent-js', '"Viewing agent"', 800, 1500)
dump(247, 'skills-vo', '"select:accept"', 200, 800, 0)
