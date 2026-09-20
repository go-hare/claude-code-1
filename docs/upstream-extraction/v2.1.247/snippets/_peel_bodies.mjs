import { existsSync, readFileSync, writeFileSync } from 'fs'

const paths = {
  '247':
    'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  '246':
    'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
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
  }
  return hits
}

function dump(ver, buf, name, needle, before, after, which = 0) {
  const hits = allHits(buf, needle)
  if (hits.length === 0) {
    console.log('MISS', ver, name, JSON.stringify(needle))
    return hits
  }
  const i = hits[which] ?? hits[0]
  const start = Math.max(0, i - before)
  const s = asciiWindow(buf, start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ver=${ver} offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, name, 'offset', i, `${which + 1}/${hits.length}`, 'len', s.length)
  return hits
}

const bufs = {}
for (const [ver, p] of Object.entries(paths)) {
  if (!existsSync(p)) continue
  bufs[ver] = readFileSync(p)
}
const b247 = bufs['247']
const b246 = bufs['246']

const extra = [
  'auto mode handles these prompts for you',
  'Tip: auto mode handles these prompts',
  'choose "switch to auto mode" below',
  'showEnableAutoModeOption',
  "Couldn't read your Zed keymap",
  "isn't a readable list of keybindings",
  "Couldn't back up your Zed keymap",
  'Failed to back up Zed keymap',
  'Failed to edit Zed keymap',
  "Couldn't update your Zed keymap",
  'To add the binding yourself',
  'Error backing up existing Zed keymap. Bailing out',
  'allowTrailingComma',
  'isArrayInsertion',
  'formattingOptions',
  '57399',
  'traditionalCtrl',
  'decodeModifier',
  'keycodeToName',
  'outside the sandbox',
  'writable area',
  'repointed',
  'home-manager',
  'isSymbolicLink',
  'settings.json symlink',
  '.claude/settings.json',
  'scrubbed planted',
  'bare-repo',
  'droppedMousePrefix',
  'mousePrefixDropAt',
  '35;150;7M',
  'parkIncomplete',
  'INCOMPLETE_SGR',
  'HeldSgr',
  'heldSgr',
  'incomplete mouse',
]

console.log('\n==== extra counts ====')
for (const needle of extra) {
  const a = b246 ? allHits(b246, needle).length : -1
  const b = b247 ? allHits(b247, needle).length : -1
  const mark = a !== b ? 'DIFF' : 'same'
  if (b > 0 || a > 0) console.log(`${mark} ${a} -> ${b}  ${JSON.stringify(needle)}`)
}

// #3 unique
dump('247', b247, 'gold-bash-auto-tip.txt', 'auto mode handles these prompts for you', 6000, 4000, 0)
dump('247', b247, 'gold-bash-auto-tip-js.txt', 'choose "switch to auto mode" below', 8000, 4000, 0)

// #12 unique
dump('247', b247, 'gold-zed-couldnt-read.txt', "Couldn't read your Zed keymap", 8000, 5000, 0)
dump('247', b247, 'gold-zed-not-list.txt', "isn't a readable list of keybindings", 4000, 2500, 0)
dump('247', b247, 'gold-zed-add-block.txt', 'To add the binding yourself', 6000, 4000, 0)
dump('246', b246, 'gold246-zed-bail.txt', 'Error backing up existing Zed keymap. Bailing out', 6000, 4000, 0)

// #10
dump('247', b247, 'gold-mouse-prefix.txt', 'droppedMousePrefix', 4000, 2500, 0)
dump('246', b246, 'gold246-mouse-prefix.txt', 'droppedMousePrefix', 4000, 2500, 0)
dump('247', b247, 'gold-mouse-dropat.txt', 'mousePrefixDropAt', 4000, 2500, 0)
dump('246', b246, 'gold246-mouse-dropat.txt', 'mousePrefixDropAt', 4000, 2500, 0)

// kitty / ctrl
dump('247', b247, 'gold-kp0.txt', '57399', 3000, 2000, 0)
dump('246', b246, 'gold246-kp0.txt', '57399', 3000, 2000, 0)
