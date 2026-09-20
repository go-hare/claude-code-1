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

function first(needle, from = 0) {
  return buf.indexOf(Buffer.from(needle), from)
}

function dump(name, i, before, after, needle) {
  if (i < 0) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# 247 offset=${i} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

const xt = first('class Xt{knownMarketplaces=void 0')
console.log('Xt', xt)
dump('gold-dig-Xt-class.txt', xt, 800, 4000, 'class Xt{knownMarketplaces')

const getK = first('getKnownMarketplaces(e){return this.knownMarketplaces??=et(e)')
dump('gold-dig-getKnown.txt', getK, 100, 200, 'getKnownMarketplaces')

const build = first('async buildMarketplacePluginTips(e,t,n){')
dump('gold-dig-buildMkt.txt', build, 40, 2500, 'buildMarketplacePluginTips')

// et import near Xt
if (xt > 0) {
  const head = asciiWindow(buf, xt - 4000, xt)
  const m = head.match(/\{[^}]{0,200}as et[,}].{0,80}/g)
  console.log('et-import-near-Xt', m)
}

for (const needle of [
  'function et(e){',
  'async function et(e){',
  'function et(e,t){',
  'async function et(',
]) {
  let from = 0
  let n = 0
  while (n < 8) {
    const i = first(needle, from)
    if (i < 0) break
    const near = Math.abs(i - xt)
    console.log('et-hit', needle, i, 'dist', near)
    if (near < 800000) {
      dump(`gold-dig-et-${i}.txt`, i, 80, 600, needle)
    }
    from = i + needle.length
    n++
  }
}

// Does build use n after the signature?
const buildWin = asciiWindow(buf, build, build + 2200)
const nUses = [...buildWin.matchAll(/[^A-Za-z0-9_]n[^A-Za-z0-9_]/g)].map(
  (x) => x.index,
)
console.log('build-n-hits', nUses.slice(0, 20), 'len', buildWin.length)
console.log('build-has-getMarketplace', buildWin.includes('getMarketplace'))
console.log('build-sample', buildWin.slice(0, 800))
