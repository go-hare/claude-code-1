import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

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

function allOffsets(buf, needle, max = 12) {
  const n = Buffer.from(needle)
  const out = []
  let i = 0
  while (out.length < max) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    out.push(j)
    i = j + n.length
  }
  return out
}

function dumpBoth(label, needle, before, after, max = 4) {
  const o247 = allOffsets(buf247, needle, max)
  const o246 = allOffsets(buf246, needle, max)
  let body = `# needle=${JSON.stringify(needle)}\n# 247=${o247.join(',')}\n# 246=${o246.join(',')}\n`
  for (const [tag, buf, offs] of [
    ['247', buf247, o247],
    ['246', buf246, o246],
  ]) {
    for (const i of offs) {
      body += `\n===== ${tag} offset=${i} =====\n`
      body += asciiWindow(buf, Math.max(0, i - before), i + after)
      body += '\n'
    }
  }
  writeFileSync(`docs/upstream-extraction/v2.1.247/snippets/${label}`, body)
  console.log('DUMP', label, '247', o247.length, '246', o246.length)
}

dumpBoth('gold-967000-246.txt', '967000', 2500, 1500, 2)
dumpBoth('gold-autoCompactThreshold.txt', 'autoCompactThreshold', 800, 2500, 6)
dumpBoth('gold-COMPACT_THRESHOLD.txt', 'COMPACT_THRESHOLD', 1500, 1500, 2)
dumpBoth('gold-do-not-conclude.txt', 'do not conclude', 800, 2500, 3)
dumpBoth(
  'gold-failedMcpServers.txt',
  'failedMcpServers',
  800,
  2500,
  6,
)
dumpBoth('gold-PeerMessage.txt', 'PeerMessage', 400, 1500, 8)
dumpBoth(
  'gold-forceLoginMethod-fn.txt',
  'forceLoginMethod',
  400,
  2000,
  8,
)
dumpBoth(
  'gold-CUSTOM_OAUTH.txt',
  'CLAUDE_CODE_CUSTOM_OAUTH',
  800,
  2000,
  6,
)
dumpBoth(
  'gold-analyticsDisabled.txt',
  'analyticsDisabled',
  1500,
  2000,
  4,
)
dumpBoth('gold-60_000.txt', '60_000', 2000, 2000, 2)
dumpBoth(
  'gold-organization-requires.txt',
  'organization requires',
  1500,
  2000,
  4,
)
dumpBoth(
  'gold-managed-settings-json.txt',
  'managed-settings.json',
  400,
  2000,
  6,
)
