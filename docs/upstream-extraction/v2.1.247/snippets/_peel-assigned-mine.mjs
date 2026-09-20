import { existsSync, readFileSync, writeFileSync } from 'fs'

const paths = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}

function load(ver) {
  const p = paths[ver]
  if (!existsSync(p)) {
    console.log('MISSING', ver, p)
    return null
  }
  const buf = readFileSync(p)
  console.log('loaded', ver, buf.length)
  return buf
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

function looksJs(s) {
  return (
    s.includes('function ') ||
    s.includes('=>') ||
    s.includes('if(') ||
    s.includes('return ') ||
    s.includes('const ') ||
    s.includes('var ')
  )
}

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function dumpJsHits(ver, buf, name, needle, before, after, maxHits = 6) {
  const hits = allHits(buf, needle)
  console.log(`hits ${ver} ${JSON.stringify(needle)} => ${hits.length}`)
  let dumped = 0
  for (let i = 0; i < hits.length && dumped < maxHits; i++) {
    const off = hits[i]
    const s = asciiWindow(buf, Math.max(0, off - before), off + after)
    const js = looksJs(s)
    const fname = `${name}-h${i}${js ? '-js' : '-tbl'}.txt`
    writeFileSync(
      `${outDir}/${fname}`,
      `# ver=${ver} offset=${off} hit=${i + 1}/${hits.length} js=${js} needle=${JSON.stringify(needle)}\n\n${s}\n`,
    )
    console.log('  dump', fname, 'js', js, 'off', off, 'len', s.length)
    dumped++
  }
  return hits
}

const b247 = load(247)
const b246 = load(246)

const needles = [
  // #3
  'choose "switch to auto mode" below',
  'auto mode handles these prompts for you',
  'showEnableAutoModeOption',
  'enableAutoModeDescription',
  'yes-enable-auto-mode',
  'function NX(',
  'function KNe(',
  'sW.workflow',
  'var UNe=',
  // #9
  'base-layout-key',
  'baseLayoutKey',
  'shifted-key',
  'unicode-key-code',
  'traditionalCtrl',
  'keycodeToName',
  'decodeModifier',
  // #10
  'droppedMousePrefix',
  'flushedEscapePrefix',
  'mousePrefixDropAt',
  'INCOMPLETE_SGR',
  'isHeldSgrMousePrefix',
  'parkIncomplete',
  '^\\[<\\d+;\\d+;\\d+[Mm]$',
  // #11
  'settings.json',
  'cleanupAfterCommand',
  'isSymbolicLink',
  'home-manager',
  'dotfile-managed',
  'getSettingsFilePathForSource',
  'scrubbed planted',
  // #12
  "Couldn't read your Zed keymap, so it was left unchanged",
  'Your Zed keymap isn',
  'allowTrailingComma:!0',
  'isArrayInsertion:!0',
  'function ut(',
  'function me(',
  // #29
  'network or automounter',
  'automounter',
  'lead with an invisible',
  'file://',
  'stripMarkdownHref',
  'isMarkdownInvisible',
  'createHyperlink',
  'case"link"',
  'case "link"',
]

console.log('\n==== counts ====')
for (const n of needles) {
  const a = b246 ? allHits(b246, n).length : -1
  const b = b247 ? allHits(b247, n).length : -1
  if (a > 0 || b > 0) {
    console.log(`${a !== b ? 'DIFF' : 'same'} ${a}->${b} ${JSON.stringify(n)}`)
  }
}

if (b247) {
  dumpJsHits(247, b247, 'gold-3-tip', 'choose "switch to auto mode" below', 2000, 4000, 3)
  dumpJsHits(247, b247, 'gold-3-kne', 'function KNe(', 200, 2500, 3)
  dumpJsHits(247, b247, 'gold-3-nx', 'function NX(', 200, 800, 6)
  dumpJsHits(247, b247, 'gold-3-une', 'var UNe=', 200, 400, 4)
  dumpJsHits(247, b247, 'gold-3-show', 'showEnableAutoModeOption', 1500, 2500, 4)
  dumpJsHits(247, b247, 'gold-12-ut', 'async function ut(', 200, 4000, 2)
  dumpJsHits(247, b247, 'gold-12-me', 'function me(t){return T(t)&&t.context==="Terminal"', 100, 400, 2)
  dumpJsHits(247, b247, 'gold-10-drop', 'droppedMousePrefix', 800, 1500, 6)
  dumpJsHits(247, b247, 'gold-10-flush', 'flushedEscapePrefix', 800, 1500, 4)
  dumpJsHits(247, b247, 'gold-11-cleanup', 'cleanupAfterCommand', 1500, 2500, 4)
  dumpJsHits(247, b247, 'gold-11-symlink', 'isSymbolicLink()', 800, 1500, 6)
  dumpJsHits(247, b247, 'gold-29-link', 'case"link"', 400, 1500, 6)
  dumpJsHits(247, b247, 'gold-29-link2', 'case "link"', 400, 1500, 4)
}

if (b246) {
  dumpJsHits(246, b246, 'gold246-3-show', 'showEnableAutoModeOption', 1500, 2500, 4)
  dumpJsHits(246, b246, 'gold246-12-ut', 'async function ut(', 200, 4000, 2)
  dumpJsHits(246, b246, 'gold246-10-drop', 'droppedMousePrefix', 800, 1500, 6)
  dumpJsHits(246, b246, 'gold246-11-cleanup', 'cleanupAfterCommand', 1500, 2500, 4)
  dumpJsHits(246, b246, 'gold246-29-link', 'case"link"', 400, 1500, 6)
}
