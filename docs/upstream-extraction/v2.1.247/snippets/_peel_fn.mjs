import { existsSync, readFileSync, writeFileSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

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
  }
  return hits
}

function dump(buf, name, needle, before, after, which = 0) {
  const hits = allHits(buf, needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return hits
  }
  const i = hits[which] ?? hits[0]
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i, `${which + 1}/${hits.length}`, s.length)
  return hits
}

const b247 = readFileSync(p247)
const b246 = existsSync(p246) ? readFileSync(p246) : null

const needles = [
  'showEnableAutoModeOption',
  'enableAutoModeDescription',
  'sW.workflow',
  'function NX',
  'var UNe=',
  'i(NX',
  'NX()',
  "Couldn't read your Zed keymap, so it was left unchanged",
  'Your Zed keymap isn',
  'function install',
  'allowTrailingComma:!0',
  'jsonc',
  'applyEdits',
  'right after the escape prefix',
  '\\x1b[<[\\d;]*',
  'INCOMPLETE_SGR',
  'droppedMousePrefix+',
  'base-layout-key',
  'shifted-key',
  'unicode-key-code',
  'traditionalCtrl',
  'mods.ctrl',
  'cleanupAfterCommand',
  'settings.json',
  'isSymbolicLink()',
  'lstatSync(',
  'getSettingsFilePathForSource',
]

console.log('==== counts ====')
for (const n of needles) {
  const a = b246 ? allHits(b246, n).length : -1
  const b = allHits(b247, n).length
  if (a !== b || b > 0)
    console.log(`${a !== b ? 'DIFF' : 'same'} ${a}->${b} ${JSON.stringify(n)}`)
}

// #3 wiring
dump(b247, 'gold-showEnable.txt', 'showEnableAutoModeOption', 5000, 4000, 0)
dump(b247, 'gold-showEnable-1.txt', 'showEnableAutoModeOption', 5000, 4000, 1)
dump(b247, 'gold-showEnable-2.txt', 'showEnableAutoModeOption', 5000, 4000, 2)
dump(b247, 'gold-sW-workflow.txt', 'sW.workflow', 3000, 2000, 0)
dump(b247, 'gold-UNe.txt', 'var UNe=', 2000, 4000, 0)

// #12 JS (2nd hit of unique string — skip string table)
dump(
  b247,
  'gold-zed-js.txt',
  "Couldn't read your Zed keymap, so it was left unchanged",
  8000,
  6000,
  1,
)
dump(b247, 'gold-zed-js-0.txt', 'Failed to edit Zed keymap', 6000, 5000, 1)

// mouse unique 247 changelog
dump(
  b247,
  'gold-mouse-esc-prefix.txt',
  'right after the escape prefix',
  2000,
  1500,
  0,
)
if (b246)
  dump(
    b246,
    'gold246-mouse-esc-prefix.txt',
    'right after the escape prefix',
    500,
    200,
    0,
  )
