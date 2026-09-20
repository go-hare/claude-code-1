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
  console.log('OK', name, i, 'hits', hits.length, 'len', s.length)
  return hits
}

const needles = [
  'tip.priority',
  'tip.priority??',
  '.priority??0',
  'spinnerTip',
  'Tip: ',
  '`: ${',
  'label??',
  '.label??',
  'tip.label',
  'failedTipIds',
  'tip content threw',
  'tips_spinner_show',
  'FORCE_TIP_ID',
  'qhe',
  'Vhe',
  'org-tip',
]

for (const n of needles) {
  const hits = findAll(n)
  console.log(String(hits.length).padStart(4), JSON.stringify(n), hits.slice(0, 6).join(','))
}

dump('gold-priority-tie.txt', '.priority??0', 1500, 2500, 0)
dump('gold-tip-content-threw.txt', 'tip content threw', 2000, 2500)
dump('gold-failed-tip-ids.txt', 'failedTipIds', 2000, 2500)
dump('gold-tips-spinner-show.txt', 'tips_spinner_show', 2500, 3000)
dump('gold-spinner-tip-state.txt', 'spinnerTip', 2000, 2500, 0)
dump('gold-force-tip-js.txt', 'FORCE_TIP_ID', 2000, 2000, 1)
