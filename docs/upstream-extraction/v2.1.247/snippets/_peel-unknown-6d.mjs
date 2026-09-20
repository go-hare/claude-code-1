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

function dumpBoth(tag, needle, before, after, which = 0) {
  dump(246, tag, needle, before, after, which)
  dump(247, tag, needle, before, after, which)
}

console.log('=== 6d counts ===')
const needles = [
  'function je(',
  'function Qr(',
  'ke().focus',
  'x().focusedValue',
  ').focus]',
  '["select:accept"]',
  'filteredSettingsItems[',
  'selectableItems[',
  'allSelectableItems[',
  'confirm:yes',
  'function Zr(',
  'function Qr({visibleOptionCount',
  'function Vt(',
  'function $t(',
  'let[r,a,x]=Qr(',
  'let[vn,c,ke]=je(',
  'let[fn,ee]=z(',
]

for (const n of needles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) console.log(`${a}->${b}\t${JSON.stringify(n)}`)
}

dumpBoth('je-fn', 'function je(', 80, 1200, 0)
dumpBoth('je-fn-1', 'function je(', 80, 1200, 1)
dumpBoth('qr-fn', 'function Qr(', 80, 1500, 0)
dumpBoth('qr-fn-1', 'function Qr(', 80, 1500, 1)
dumpBoth('qr-fn-2', 'function Qr(', 80, 1500, 2)
dumpBoth('kefocus', 'ke().focus', 200, 200)
dumpBoth('zr-fn', 'function Zr({visibleOptionCount', 40, 2500)
dumpBoth('fuzzy-247', 'function $t(gn){', 40, 500)
dumpBoth('fuzzy-246', 'function Vt(ln){', 40, 500)
dumpBoth('cfg-items', 'filteredSettingsItems[', 800, 1500)
dumpBoth('mcp-items', 'selectableItems[', 800, 1500)
dumpBoth('bg-items', 'allSelectableItems[', 800, 1500)
dumpBoth('confirm-yes-0', 'confirm:yes', 400, 800, 0)
dumpBoth('confirm-yes-1', 'confirm:yes', 400, 800, 1)
