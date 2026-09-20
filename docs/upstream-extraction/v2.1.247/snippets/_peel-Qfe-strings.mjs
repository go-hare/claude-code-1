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

for (const n of [
  'can only be used with GitHub sources',
  'Only repositories from',
  'reserved for official Anthropic marketplaces. Only',
  'function Qfe',
  'Qfe(e,t.source)',
]) {
  const i = buf.indexOf(Buffer.from(n))
  console.log(JSON.stringify(n), i)
  if (i >= 0) {
    console.log(asciiWindow(buf, i - 250, i + 350))
    console.log('---')
  }
}

// WFe import near nme
const nme = 214521154
const head = asciiWindow(buf, nme - 80000, nme)
for (const alias of ['WFe', 'Qfe', 'J8', 'fPe']) {
  const i = head.lastIndexOf(`as ${alias}`)
  console.log('head', alias, i, i >= 0 ? head.slice(i - 60, i + 40) : '')
}
