/**
 * Replay peel for 247 #29 md-hyperlink-unsafe helpers.
 * Locked: byd=R, Txd=Zo, Fxd=P, Dtb=a, Etb=j, Zzd=P, markdown ut/pt.
 */
import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
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

function dump(name, off, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${off}\n\n${asciiWindow(b247, Math.max(0, off - before), off + after)}\n`,
  )
  console.log('OK', name, off)
}

dump('gold-29-helper-Fxd-P.txt', 206909356, 40, 400)
dump('gold-29-helper-Txd-Zo.txt', 206910729, 80, 200)
dump('gold-29-helper-byd-R.txt', 206911800, 40, 250)
dump('gold-29-helper-Dtb-a.txt', 210966317, 200, 800)
dump('gold-29-helper-Etb-j.txt', 210966340, 200, 900)
dump('gold-29-helper-Zzd-206472573.txt', 206472573, 200, 400)
dump('gold-29-helper-ut.txt', 221588200, 40, 900)
console.log('replay done')
