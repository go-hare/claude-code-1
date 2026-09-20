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

for (const [name, i, before, after] of [
  ['gold-dig-kB-call-214646314.txt', 214646314, 400, 200],
  ['gold-dig-kB-call-214646651.txt', 214646651, 400, 250],
  ['gold-dig-kB-call-215606444.txt', 215606444, 400, 200],
]) {
  dump(name, i, before, after)
}

// clean single-module gold
dump('gold-dig-kB-512-full.txt', 211619229, 0, 420)
dump('gold-dig-kB-import-line.txt', 212810236, 0, 120)
