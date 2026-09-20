/**
 * Peel the 247 preflight step component's failure branch to settle whether
 * upstream exits or leaves the error screen up.
 */
import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
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

for (const needle of [
  'Unable to connect to Anthropic services',
  'preflight_endpoint',
  'Checking connectivity...',
]) {
  const hits = findAll(needle)
  console.log(`\n##### ${needle} — ${hits.length} hit(s): ${hits.join(', ')}`)
  for (const [n, at] of hits.entries()) {
    const win = ascii(at - 2200, at + 1400)
    console.log(`\n=== hit ${n} @${at} ===`)
    console.log(win)
    writeFileSync(
      `docs/upstream-extraction/v2.1.247/snippets/gold-22-failbranch-${needle.slice(0, 12).replace(/\W/g, '')}-${n}.txt`,
      `# offset=${at} hit=${n}/${hits.length} needle=${JSON.stringify(needle)}\n\n${win}\n`,
    )
  }
}
