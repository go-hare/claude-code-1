import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 10) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

// full export maps
dump(
  'gold-j0n-export-IR-Yea.txt',
  `# IR as Yea @219687673\n${asciiWindow(219686800, 219688800)}\n`,
)
dump(
  'gold-yln-export-dPe-baa.txt',
  `# dPe as baa @219684806\n${asciiWindow(219683900, 219685900)}\n`,
)

// hashed import of Yea / baa
for (const n of [
  'Yea as ',
  ' as Yea',
  'baa as ',
  ' as baa',
  'Tea as ',
  'Uea as ',
  'Vea as ',
  'Wea as ',
  'Xea as ',
  'Zea as ',
  '_ea as ',
  'mvc as ',
  ' as mvc',
]) {
  const hits = findAll(n, 8)
  log(`H ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 50, i + n.length + 90).replace(/\n/g, ' ')}`)
  }
}

// search TB/j0n/N0n/yln/_0n/ame inside the export map windows by reading the ascii
const win1 = asciiWindow(219686000, 219690000)
for (const name of ['TB', 'j0n', 'N0n', 'yln', '_0n', 'ame', 'IR', 'dPe', 'KBo']) {
  log(`WIN1 has ${name}: ${win1.includes(name + ' as ') || win1.includes(' as ' + name)}`)
}
const win2 = asciiWindow(219683000, 219686000)
for (const name of ['TB', 'j0n', 'N0n', 'yln', '_0n', 'ame', 'IR', 'dPe', 'HP']) {
  log(`WIN2 has ${name}: ${win2.includes(name + ' as ') || win2.includes(' as ' + name)}`)
}

// find bun module header before sme — look for import{ ... Fs
const sme = 214568775
const before = asciiWindow(sme - 15000, sme)
const fsIdx = before.lastIndexOf(' as Fs')
const fsIdx2 = before.lastIndexOf('Fs as ')
log(`sme-15k last " as Fs" idxRel=${fsIdx}`)
log(`sme-15k last "Fs as " idxRel=${fsIdx2}`)
if (fsIdx >= 0) {
  const abs = sme - 15000 + fsIdx
  log(`  as Fs @${abs} ${asciiWindow(abs - 80, abs + 80)}`)
}

// gza uses _0n — confirm same-module (no import)
const gza = 214549449
log(`gza->_0n distance ${214579796 - gza}`)
dump(
  'gold-j0n-gza-to-_0n.txt',
  `# gza@${gza} to _0n@214579796\n${asciiWindow(gza, 214580200)}\n`,
)

// unique bind Fs used by sme: search plugins directory helpers near sme
for (const n of [
  'function Fs(){return',
  'getPluginsDirectory',
  '.claude/plugins',
  'plugins")',
  'function Fs(e){',
]) {
  const hits = findAll(n, 8)
  log(`P ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
}

dump('gold-j0n-yln-pass4.txt', report.join('\n') + '\n')
