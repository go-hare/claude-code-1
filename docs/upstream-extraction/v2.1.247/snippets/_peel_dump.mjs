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
    return
  }
  const i = hits[which] ?? hits[0]
  const start = Math.max(0, i - before)
  const s = asciiWindow(buf, start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ver=${ver} offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, name, 'offset', i, `${which + 1}/${hits.length}`, 'len', s.length)
}

const bufs = {}
for (const [ver, p] of Object.entries(paths)) {
  if (!existsSync(p)) continue
  bufs[ver] = readFileSync(p)
}

const extraNeedles = [
  'workflows run best',
  'yes-enable-auto-mode',
  'auto (no routine prompts',
  'Try auto mode',
  'one-keystroke',
  'base-layout',
  'baseLayoutKey',
  'layout-key',
  'traditionalCtrl',
  'keycodeToName',
  'unicode-key-code',
  'shifted-key',
  'Ctrl+C',
  'ctrl+c',
  '.claude/settings.json',
  'settings.json symlink',
  'isSymbolicLink()',
  'lstatSync',
  'writable area',
  'after-command',
  'afterCommand',
  'Found existing Zed',
  'Error backing up existing Zed',
  'Installed Zed Shift+Enter',
  'Failed to install Zed',
  'context: "Terminal"',
  '"Terminal"',
  'terminal::SendText',
  '35;150;7M',
  'droppedMousePrefix',
  'mousePrefixDropAt',
  'INCOMPLETE_SGR',
  'parkIncomplete',
  'Qpr',
  'Jyf',
]

console.log('\n==== extra needle counts ====')
for (const needle of extraNeedles) {
  const a = bufs['246'] ? allHits(bufs['246'], needle).length : -1
  const b = bufs['247'] ? allHits(bufs['247'], needle).length : -1
  if (a !== b) console.log(`DIFF ${a} -> ${b}  ${JSON.stringify(needle)}`)
  else if (b > 0) console.log(`same ${b}  ${JSON.stringify(needle)}`)
}

const b247 = bufs['247']
const b246 = bufs['246']

// #3 new "switch to auto mode" is hit 2 (0-indexed) — the extra one
dump('247', b247, 'gold-auto-mode-new.txt', 'switch to auto mode', 4000, 2500, 2)
dump('247', b247, 'gold-yes-switch-auto-0.txt', 'Yes, and switch to auto mode', 2500, 1500, 0)
dump('247', b247, 'gold-yes-switch-auto-1.txt', 'Yes, and switch to auto mode', 2500, 1500, 1)
dump('246', b246, 'gold246-yes-switch-auto-0.txt', 'Yes, and switch to auto mode', 2500, 1500, 0)
dump('246', b246, 'gold246-yes-switch-auto-1.txt', 'Yes, and switch to auto mode', 2500, 1500, 1)

// extra Bash permission
dump('247', b247, 'gold-bash-perm-new.txt', 'Bash permission', 2000, 1500, 4)
dump('246', b246, 'gold246-bash-perm-3.txt', 'Bash permission', 1500, 800, 3)

// #10
dump('247', b247, 'gold-mouse-35.txt', '35;150;7M', 5000, 2500, 0)
dump('246', b246, 'gold246-mouse-35.txt', '35;150;7M', 5000, 2500, 0)

// #12
dump('247', b247, 'gold-keymap-0.txt', 'keymap.json', 4000, 2500, 0)
dump('247', b247, 'gold-keymap-1.txt', 'keymap.json', 4000, 2500, 1)
dump('246', b246, 'gold246-keymap-0.txt', 'keymap.json', 4000, 2500, 0)
dump('246', b246, 'gold246-keymap-1.txt', 'keymap.json', 4000, 2500, 1)
dump('247', b247, 'gold-sendtext-0.txt', 'terminal::SendText', 2500, 1500, 0)
dump('247', b247, 'gold-sendtext-1.txt', 'terminal::SendText', 2500, 1500, 1)
dump('247', b247, 'gold-sendtext-2.txt', 'terminal::SendText', 2500, 1500, 2)
dump('247', b247, 'gold-sendtext-3.txt', 'terminal::SendText', 2500, 1500, 3)

// extra shift-enter in 247 — hits 2+ are new-ish
dump('247', b247, 'gold-shift-enter-2.txt', 'shift-enter', 2000, 1500, 2)
dump('247', b247, 'gold-shift-enter-3.txt', 'shift-enter', 2000, 1500, 3)

// cleanup
dump('247', b247, 'gold-cleanup-0.txt', 'cleanupAfterCommand', 4000, 2500, 0)
dump('247', b247, 'gold-cleanup-2.txt', 'cleanupAfterCommand', 4000, 2500, 2)
dump('246', b246, 'gold246-cleanup-0.txt', 'cleanupAfterCommand', 4000, 2500, 0)
dump('246', b246, 'gold246-cleanup-2.txt', 'cleanupAfterCommand', 4000, 2500, 2)
