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
    if (hits.length > 60) break
  }
  return hits
}

function dump(ver, tag, needle, before, after, which = 0) {
  const buf = bufs[ver]
  const hits = allHits(buf, needle)
  if (hits.length === 0) {
    console.log('MISS', ver, tag, JSON.stringify(needle))
    return
  }
  const i = hits[Math.min(which, hits.length - 1)]
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-6-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, tag, `${which + 1}/${hits.length}`, i, 'len', s.length)
}

function dumpBoth(tag, needle, before, after, which = 0) {
  dump(246, tag, needle, before, after, which)
  dump(247, tag, needle, before, after, which)
}

function lastBefore(buf, needle, before) {
  const n = Buffer.from(needle)
  let found = -1
  let from = 0
  while (from < before) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= before) break
    found = i
    from = i + 1
  }
  return found
}

console.log('=== js-ish counts ===')
const needles = [
  'getFocusedValue:',
  'getFocusedValue()',
  '.getFocusedValue(',
  'selectFocusedOption:',
  '.state.focusedValue',
  'focusedValue,t)',
  'placeholder:"Filter history',
  'placeholder:"Type to search',
  'selectAction:"use"',
  'selectAction:"invoke skill"',
  'title:"Skills"',
  'function axe(',
  'function ARe(',
  'backspaceExitsOnEmpty:!1',
  'resetKey:',
  'previewPosition:',
  'direction:"up"',
  'onTab:{',
  'skillOverrides',
  'selectableIndex',
  'currentSelectionId',
  'allSelectableItems',
  'filteredSettingsItems[',
  'toggleSetting',
  'qb=',
  'function qb(',
  'qF=',
  'function qF(',
  'blu',
  'Slu',
]

for (const n of needles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) console.log(`${a}->${b}\t${JSON.stringify(n)}`)
}

dumpBoth('gfv-prop', 'getFocusedValue:', 200, 800)
dumpBoth('gfv-call', '.getFocusedValue(', 400, 800, 0)
dumpBoth('gfv-call-1', '.getFocusedValue(', 400, 800, 1)
dumpBoth('gfv-call-2', '.getFocusedValue(', 400, 800, 2)
dumpBoth('state-fv', '.state.focusedValue', 400, 800, 0)
dumpBoth('state-fv-1', '.state.focusedValue', 400, 800, 1)
dumpBoth('ph-search', 'placeholder:"Type to search', 2500, 3500, 0)
dumpBoth('ph-search-1', 'placeholder:"Type to search', 2500, 3500, 1)
dumpBoth('sel-use', 'selectAction:"use"', 800, 400)
dumpBoth('title-skills', 'title:"Skills"', 2000, 2500)
dumpBoth('invoke-js', 'selectAction:"invoke skill"', 2000, 2500)
dumpBoth('dir-up-js', 'direction:"up"', 1500, 2000)
dumpBoth('bs-empty-0', 'backspaceExitsOnEmpty:!1', 2000, 3000, 0)
dumpBoth('bs-empty-1', 'backspaceExitsOnEmpty:!1', 2000, 3000, 1)
dumpBoth('bs-empty-2', 'backspaceExitsOnEmpty:!1', 2000, 3000, 2)
dumpBoth('bs-empty-3', 'backspaceExitsOnEmpty:!1', 2000, 3000, 3)
dumpBoth('selectableIdx', 'selectableIndex', 2000, 2500)
dumpBoth('selId', 'currentSelectionId', 2000, 2500)

const hist247 = bufs[247].indexOf(Buffer.from('placeholder:"Filter history'))
const hist246 = bufs[246].indexOf(Buffer.from('placeholder:"Filter history'))
for (const [ver, pos] of [
  [247, hist247],
  [246, hist246],
]) {
  const buf = bufs[ver]
  const fn = lastBefore(buf, 'function ', pos)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-6-hist-fn-${ver}.txt`,
    `# last function before Filter history offset=${fn} hist=${pos} ver=${ver}\n\n${asciiWindow(buf, Math.max(0, fn - 80), pos + 200)}\n`,
  )
  console.log('hist-fn', ver, fn)
}
