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

function allOffsets(buf, needle, max = 8) {
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

function dumpBoth(label, needle, before, after, max = 3) {
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
  console.log(label, '247', o247, '246', o246)
}

const needles = [
  ['gold-y3n-table.txt', 'y3n={', 100, 800, 2],
  ['gold-LYn-table.txt', 'LYn={', 100, 800, 2],
  ['gold-default-500000.txt', 'default:500000', 400, 800, 4],
  [
    'gold-surface-failed-flag.txt',
    'tengu_surface_failed_mcp_servers',
    200,
    1500,
    4,
  ],
  ['gold-from-at-space.txt', ' from @', 2000, 2500, 4],
  ['gold-Message-from-at2.txt', 'Message from @', 500, 1500, 2],
  ['gold-usePrStatus-fn.txt', 'function usePrStatus', 200, 2500, 2],
  ['gold-lastFetchRef.txt', 'lastFetchRef', 1500, 2500, 3],
  ['gold-USE-BEDROCK-analytics.txt', 'CLAUDE_CODE_USE_BEDROCK', 200, 2000, 6],
  ['gold-forceLoginOrgUUID-fn.txt', 'forceLoginOrgUUID', 1500, 2500, 6],
  ['gold-policySettingsOrigin.txt', 'policySettingsOrigin', 800, 2000, 4],
  [
    'gold-managed-settings-unreadable.txt',
    'managed settings',
    200,
    400,
    8,
  ],
]

for (const [label, needle, before, after, max] of needles) {
  dumpBoth(label, needle, before, after, max)
}
