import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

const startHfb = 211415952
const endHfb = 211612842
const span = asciiWindow(buf, startHfb, endHfb)

function allInSpan(n) {
  const hits = []
  let from = 0
  while (true) {
    const i = span.indexOf(n, from)
    if (i < 0) break
    hits.push(startHfb + i)
    from = i + n.length
  }
  return hits
}

for (const n of [
  'new ce(',
  'new ce`',
  'instanceof ce',
  'ce=class',
  'var ce=',
  'var ce,',
  ',ce,',
  'cd=class',
  'ld=class',
  'pd=class',
  'CliUserError',
  'command-source-refused',
  'Command-sourced plugins are disabled',
]) {
  const hits = allInSpan(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 6))
  for (const i of hits.slice(0, 3)) {
    console.log(' ', asciiWindow(buf, i - 60, i + 180).replace(/\n/g, ' '))
  }
}

// factory around ce=class
dump('gold-dig-tI-ce-class.txt', 211438284, 400, 200)

// marketplace gUe
const gUe = buf.indexOf(Buffer.from(' as gUe'), 212803258)
console.log('as gUe', gUe, gUe >= 0 ? asciiWindow(buf, gUe - 100, gUe + 80) : '')

const gUe2 = buf.indexOf(Buffer.from('as gUe,'), 212803258)
console.log('as gUe,', gUe2, gUe2 >= 0 ? asciiWindow(buf, gUe2 - 80, gUe2 + 80) : '')

// who throws tI-shaped command source
for (const n of [
  'Command-sourced plugins are disabled',
  'plugin command source disabled',
  'throw new g(',
  'name="CliUserError"',
]) {
  let from = 0
  let c = 0
  const needle = Buffer.from(n)
  while (c < 6) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    console.log(JSON.stringify(n), i, asciiWindow(buf, i - 80, i + 160).replace(/\n/g, ' '))
    from = i + n.length
    c++
  }
}

// dump locked bodies
dump('gold-dig-tI-ye-TelemetrySafeError.txt', 206454728, 20, 220)
dump('gold-dig-Ar-withTelemetryMessage.txt', 206454240, 20, 280)
dump('gold-dig-N0-trunc.txt', 217552688, 20, 120)
dump('gold-dig-JT-ur-full.txt', 209388952, 20, 220)
