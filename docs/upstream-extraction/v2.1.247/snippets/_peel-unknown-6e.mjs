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
    if (hits.length > 50) break
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

function dumpBoth(tag, needle, before, after, which = 0) {
  dump(246, tag, needle, before, after, which)
  dump(247, tag, needle, before, after, which)
}

console.log('=== 6e counts ===')
const needles = [
  ']=je(',
  ']=Qr(',
  'as je}',
  'as je,',
  ' as je',
  'as Qr}',
  ' as Qr',
  'ke().focus',
  'x().focusedValue',
  '().focus;',
  '().focus]',
  '"Viewing agent"',
  '"MCP dialog dismissed"',
  '"Config dialog dismissed"',
  '"Skills dialog dismissed"',
  'tengu_config_changed',
  'config_toggle',
  'qb()',
  'function qb(',
  'qF()',
  'function qF(',
  'blu!==Slu',
  'blu!=Slu',
  'Slu!==blu',
]

for (const n of needles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) console.log(`${a}->${b}\t${JSON.stringify(n)}`)
}

dump(247, 'fuzzy-imports', 'function $t(gn){', 2500, 200)
dump(247, 'zr-imports', 'function Zr({visibleOptionCount', 2500, 200)
dumpBoth('je-assign', ']=je(', 200, 400, 0)
dumpBoth('je-assign-1', ']=je(', 200, 400, 1)
dumpBoth('qr-assign', ']=Qr(', 400, 600, 0)
dumpBoth('qr-assign-1', ']=Qr(', 400, 600, 1)
dump(247, 'as-je-0', ' as je', 200, 200, 0)
dump(247, 'as-je-1', ' as je', 200, 200, 1)
dump(247, 'as-qr-0', ' as Qr', 200, 200, 0)
dump(247, 'as-qr-1', ' as Qr', 200, 200, 1)
dumpBoth('view-agent-js', '"Viewing agent"', 2000, 2000)
dumpBoth('mcp-js', '"MCP dialog dismissed"', 2000, 2000)
dumpBoth('cfg-js', '"Config dialog dismissed"', 2000, 2000)
dumpBoth('skills-js2', '"Skills dialog dismissed"', 2000, 2000)
