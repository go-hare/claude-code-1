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
    console.log('MISS', name, needle)
    return
  }
  const i = hits[which] ?? hits[0]
  const start = Math.max(0, i - before)
  const s = asciiWindow(start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} hit=${which}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length, 'len', s.length)
}

const needles = [
  'tengu_tip_shown',
  'spinnerTipsEnabled',
  'CLAUDE_CODE_FORCE_TIP_ID',
  'tipIdLength',
  'cooldownSessions',
  'providerAgnostic',
  'maxLifetimeShows',
  'tipsHistory',
  'selectTip',
  'longest',
  'never-shown',
  'never shown',
  'sessionsSince',
  'getSessionsSinceLastShown',
  'org-tip:',
  'custom-tip-',
  'trustedCount',
]

for (const n of needles) {
  const hits = findAll(n)
  console.log(String(hits.length).padStart(4), n, hits.slice(0, 8).join(','))
}

dump('gold-never-shown-0.txt', 'never-shown', 6000, 4000, 0)
dump('gold-never-shown-1.txt', 'never-shown', 6000, 4000, 1)
dump('gold-tip-shown-1.txt', 'tengu_tip_shown', 8000, 5000, 1)
dump('gold-sessions-since.txt', 'sessionsSince', 4000, 4000, 5)
dump('gold-cooldown-js.txt', 'cooldownSessions', 3000, 2500, 0)
