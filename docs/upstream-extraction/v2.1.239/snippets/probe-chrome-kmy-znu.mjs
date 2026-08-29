import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-239-pkg/package/claude.exe'
const buf = readFileSync(exe)
const text = buf.toString('latin1')

function asciiSlice(start, end) {
  let s = ''
  for (let k = start; k < end && k < text.length; k++) {
    const c = text.charCodeAt(k)
    s += c >= 0x20 && c <= 0x7e ? text[k] : '\n'
  }
  return s.replace(/\n+/g, '\n')
}

const kmy = text.indexOf('function Kmy({payload:e,answer:t})')
const znu = text.indexOf('function znu(')
const xmy = text.indexOf('Xmy=[{value:"install"')
console.log({ kmy, znu, xmy })

const out = [
  '==== Kmy ====',
  asciiSlice(kmy, kmy + 4500),
  '\n==== znu ====',
  asciiSlice(znu, znu + 3500),
  '\n==== Xmy ====',
  asciiSlice(xmy, xmy + 900),
].join('\n')

const path = join(import.meta.dir, 'gold-win-Kmy-znu.txt')
writeFileSync(path, out)
console.log('wrote', path, 'chars', out.length)
console.log(out.slice(0, 8000))
