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

function first(buf, needle) {
  return buf.indexOf(Buffer.from(needle))
}

function dump(name, needle, before, after, which = '247') {
  const buf = which === '247' ? buf247 : buf246
  const i = first(buf, needle)
  if (i < 0) {
    console.log('MISS', name, which, JSON.stringify(needle))
    return
  }
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ${which} offset=${i} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, which, i)
}

dump(
  'gold-user-cross-session-247.txt',
  'function xt(ote){let Va=R(18)',
  200,
  3500,
)
dump(
  'gold-user-cross-session-246.txt',
  'function Ar(sre){let Kf=R(13)',
  200,
  2500,
  '246',
)
dump('gold-ly-preview.txt', 'function ly(', 100, 1500)
dump('gold-cy-label.txt', 'function cy(', 100, 800)
dump(
  'gold-UserCrossSessionMessage-fn.txt',
  'UserCrossSessionMessage',
  200,
  4000,
)
dump(
  'gold-fetchPrStatus-call.txt',
  'await fetchPrStatus()',
  2500,
  2500,
)
dump('gold-subscribeTerminalFocus-pr.txt', 'subscribeTerminalFocus', 800, 2000)
dump(
  'gold-analytics-hs.txt',
  'USE_BEDROCK',
  200,
  2500,
)
dump(
  'gold-forceLoginOrg-247.txt',
  'forceLoginOrgUUID',
  2000,
  3000,
)
