import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
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

function findAll(needle) {
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
  const hits = findAll(needle)
  if (hits.length === 0) {
    console.log('MISS', name, JSON.stringify(needle))
    return hits
  }
  const i = hits[which] ?? hits[0]
  const start = Math.max(0, i - before)
  const s = asciiWindow(start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} hit=${which}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length)
  return hits
}

const needles = [
  '??"Tip"',
  ".label??",
  'label??"Tip"',
  '": "+',
  '+"\\x3a "+',
  'Tip: ${',
  '`Tip: ',
  'children:"Tip: ',
  'Use /clear to start fresh',
  'Use /btw to ask',
  'spinnerTip:',
  'e.label',
  't.label',
  'n.label',
  'o.label',
  'r.label',
  'process.env.CLAUDE_CODE_FORCE_TIP_ID',
  'Hc()',
  'getForceTipId',
]

for (const n of needles) {
  const hits = findAll(n)
  console.log(String(hits.length).padStart(4), JSON.stringify(n), hits.slice(0, 8).join(','))
}

dump('gold-tip-template.txt', 'Tip: ${', 3000, 2500, 0)
dump('gold-tip-backtick-0.txt', '`Tip: ', 2500, 2000, 0)
dump('gold-tip-backtick-1.txt', '`Tip: ', 2500, 2000, 1)
dump('gold-tip-backtick-2.txt', '`Tip: ', 2500, 2000, 2)
dump('gold-tip-children.txt', 'children:"Tip: ', 2000, 2000, 0)
dump('gold-spinner-tip-assign.txt', 'spinnerTip:', 4000, 3500, 0)
dump('gold-spinner-tip-assign-1.txt', 'spinnerTip:', 3000, 2500, 1)
dump('gold-clear-tip-js.txt', 'Use /clear to start fresh', 4000, 4000, 1)
dump('gold-olabel-org.txt', 'o.label', 1500, 2000, 3)
