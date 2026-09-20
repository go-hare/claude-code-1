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

function lastBefore(buf, needle, before) {
  const n = Buffer.from(needle)
  let found = -1
  let from = 0
  while (from < before) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= before) break
    found = i
    from = i + 1
  }
  return found
}

function dumpAt(name, buf, i, before, after, which, needle) {
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

const pm = first(buf247, 'function pm(){return H("policySettings")===null')
dumpAt('gold-pm-helpers.txt', buf247, pm, 2000, 800, '247', 'pm helpers')

const pm246 = first(
  buf246,
  'function pm(){return H("policySettings")===null',
)
dumpAt('gold-pm-246.txt', buf246, pm246, 2000, 800, '246', 'pm 246')

dumpAt(
  'gold-fr-before-pm.txt',
  buf247,
  lastBefore(buf247, 'function fr(){', pm),
  40,
  400,
  '247',
  'function fr( lastBefore pm',
)
dumpAt(
  'gold-_m-before-pm.txt',
  buf247,
  lastBefore(buf247, 'function _m(){', pm),
  40,
  400,
  '247',
  'function _m( lastBefore pm',
)
dumpAt(
  'gold-Bt-before-pm.txt',
  buf247,
  lastBefore(buf247, 'function Bt(){', pm),
  40,
  600,
  '247',
  'function Bt( lastBefore pm',
)

const ip = first(
  buf247,
  'function IP(){return c.CLAUDE_CODE_CUSTOM_OAUTH_URL',
)
dumpAt(
  'gold-IP-246.txt',
  buf246,
  first(buf246, 'function IP(){return c.CLAUDE_CODE_CUSTOM_OAUTH_URL'),
  200,
  400,
  '246',
  'IP 246',
)
dumpAt('gold-IP-module.txt', buf247, ip, 400, 200, '247', 'IP 247')
