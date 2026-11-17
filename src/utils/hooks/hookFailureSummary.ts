import stripAnsi from 'strip-ansi'
import { truncateCodeUnitsSafe } from '../stringUtils.js'

const QUOTES =
  /[\p{Pi}\p{Pf}‚„‟⸲⸴⹁⹉⹂〃「-』﹁-﹄〝-〟❛-❠❮❯\u{1f676}-\u{1f678}′-‷⁗ʹʺʹʽ-ʿˈ˒˓ˊˎˏ˝˴-˶ˮ´΄΅᾽᾿῍-῏῝-῟´῾׳״ՙ-՛ߴߵꙿꞋꞌ＂＇｢｣]/gu

/** Gold td(head:60, tail:100): quoted, normalized first useful failure line. */
export function formatHookFailureSummaryLine(line: string): string {
  const clean = stripAnsi(
    line.replace(/[\uD800-\uDFFF]/gu, '').replace(/\s+/g, ' '),
  )
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .replace(QUOTES, "'")
    .replace(/["ʻʼ]/g, "'")
    .replace(/(?<![^\s\p{P}])\p{M}+/gu, '')
    .trim()
  if (!clean) return ''
  if (clean.length <= 160) return `“${clean}”`
  const head = truncateCodeUnitsSafe(clean, 60)
  let tail = clean.slice(-100)
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1)
  return `“${head}…${tail}”`
}
