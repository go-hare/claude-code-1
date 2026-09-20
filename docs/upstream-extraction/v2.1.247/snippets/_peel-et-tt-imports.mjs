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

const xt = buf.indexOf(Buffer.from('class Xt{knownMarketplaces=void 0'))
const head = asciiWindow(buf, xt - 12000, xt)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-Xt-imports.txt',
  `# 247 Xt-12k imports offset=${xt}\n\n${head}\n`,
)

const etImps = [...head.matchAll(/\{[^}]{0,400}as et[,}][^}]{0,80}from"[^"]+"/g)]
console.log('et-imports', etImps.map((m) => m[0]))

const ttImps = [...head.matchAll(/\{[^}]{0,400}as tt[,}][^}]{0,80}from"[^"]+"/g)]
console.log('tt-imports', ttImps.map((m) => m[0]))

// also scan whole import block for as et / as tt
for (const name of ['et', 'tt', 'Je', 'Ze', 'w']) {
  const re = new RegExp(`as ${name}[,}]`, 'g')
  const hits = [...head.matchAll(re)]
  console.log(name, 'count', hits.length, hits.slice(0, 5).map((h) => head.slice(Math.max(0, h.index - 80), h.index + 40)))
}

// dump full build body (longer)
const build = buf.indexOf(Buffer.from('async buildMarketplacePluginTips(e,t,n){'))
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-buildMkt-full.txt',
  `# offset=${build}\n\n${asciiWindow(buf, build, build + 4500)}\n`,
)
console.log('build dumped', build)
