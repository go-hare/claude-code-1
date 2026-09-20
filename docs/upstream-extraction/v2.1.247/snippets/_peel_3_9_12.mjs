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

function dump(name, buf, needle, before, after, which = 0) {
  const hits = allHits(buf, needle)
  if (hits.length === 0) {
    console.log('MISS', name, JSON.stringify(needle))
    return []
  }
  const i = hits[which] ?? hits[0]
  const start = Math.max(0, i - before)
  const s = asciiWindow(buf, start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} hits=${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, 'offset', i, 'hits', hits.length, 'len', s.length)
  return hits
}

const bufs = {}
for (const [ver, p] of Object.entries(paths)) {
  if (!existsSync(p)) {
    console.log('NOFILE', ver, p)
    continue
  }
  bufs[ver] = readFileSync(p)
  console.log('LOADED', ver, bufs[ver].length)
}

const needles = [
  'Yes, and switch to auto mode',
  'workflows run best with it on',
  'yes-enable-auto-mode',
  'switch to auto mode',
  'Bash permission',
  'permission_bash',
  'auto mode tip',
  'pointing to auto mode',
  'Cyrillic',
  'non-Latin',
  'non-latin',
  'base-layout-key',
  'baseLayout',
  '35;150;7M',
  'incomplete SGR',
  'HELD_SGR',
  'pendingSgr',
  'keymap.json',
  'shift-enter',
  'terminal::SendText',
  'Installed Zed',
  'home-manager',
  'settings.json',
  'cleanupAfterCommand',
  'isSymbolicLink',
  'dotfile',
]

for (const [ver, buf] of Object.entries(bufs)) {
  console.log('\n====', ver, '====')
  for (const needle of needles) {
    const hits = allHits(buf, needle)
    console.log(
      String(hits.length).padStart(4),
      JSON.stringify(needle),
      hits.slice(0, 5).join(','),
    )
  }
}
