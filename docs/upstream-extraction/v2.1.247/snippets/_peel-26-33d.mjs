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
  console.log(
    'DUMP',
    label,
    '247',
    o247.length,
    o247,
    '246',
    o246.length,
    o246,
  )
}

dumpBoth('gold-sonnet-5-window.txt', 'claude-sonnet-5', 200, 800, 8)
dumpBoth('gold-remote-cowork.txt', 'remote_cowork', 400, 1500, 4)
dumpBoth('gold-replacesDefault.txt', 'replacesDefault', 2000, 2500, 2)
dumpBoth('gold-model-default.txt', 'source:"model-default"', 2500, 1500, 2)
dumpBoth('gold-failed_mcp_servers.txt', 'failed_mcp_servers', 2000, 1500, 3)
dumpBoth('gold-mapFailedMcp.txt', 'UNCONFIGURED', 1500, 2000, 4)
dumpBoth('gold-Message-from-at.txt', 'Message from @', 1500, 2000, 4)
dumpBoth('gold-from-at-colon.txt', 'from @:', 1500, 2000, 4)
dumpBoth('gold-cross-session-message-ui.txt', 'cross-session-message', 400, 2500, 6)
dumpBoth('gold-prStatusFooter.txt', 'prStatusFooterEnabled', 2000, 2500, 3)
dumpBoth('gold-fetchPrStatus.txt', 'fetchPrStatus', 2000, 2500, 4)
dumpBoth('gold-CUSTOM_OAUTH_URL.txt', 'CLAUDE_CODE_CUSTOM_OAUTH_URL', 2000, 2500, 4)
dumpBoth('gold-forceLogin-gateway.txt', 'forceLoginMethod:"gateway"', 1500, 2000, 4)
dumpBoth('gold-host-supplied.txt', 'host-supplied', 2000, 2000, 2)
dumpBoth(
  'gold-managed-cannot-read.txt',
  "managed settings cannot",
  2000,
  2000,
  2,
)
dumpBoth(
  'gold-administrator-managed.txt',
  "administrator's managed",
  2000,
  2000,
  2,
)
