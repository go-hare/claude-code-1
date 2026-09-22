/**
 * densable 2.1.248 #14 — wrap model names as markdown code so leftover
 * Markdown does not treat `[1m]` as a link. Toast path unwraps + chalk.bold.
 *
 * GOLD: gold-248-unk-wave9-14.txt
 *   em @183526444  (extractFnAt missEnd: nested backticks)
 *   c @183526668 sha=f0466ba60fccefca
 *   a @183527071 sha=4e24e4c0781f0baa
 *   d @183527151 sha=ab5b7c31d5507607
 *   cGn @183527207 sha=9366451a0055bd03
 *   Dv @202783798 sha=173112c5dbb75313
 */
import chalk from 'chalk'

/** densable i9 */
export const i9 = 'Set model to '
/** densable SZ */
export const SZ = 'Kept model as '
/** densable wNt */
export const wNt = 'Current model: '
/** densable ENt — no leftover cloud host; part of d() */
export const ENt = 'No response from the cloud session \u2014 the switch to '
/** densable kNt — no leftover cloud host; part of d() */
export const kNt = "Cloud session couldn't switch to "
/** densable $Ie */
export const $Ie = 'Fast mode ON'
/** densable FIe */
export const FIe = ' \xB7 model set to '

/** densable _ */
const _ = [i9, SZ, wNt, ENt, kNt]
/** densable E = /\x1b\[[0-9;]*m/g */
const E = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
/** densable p — Fast icon / ANSI prefix before $Ie$FIe` */
const p = 4

/** densable em — fence a model display name */
export function em(n: string): string {
  let t = n.replace(/\r\n?|\n/g, ' ')
  if (t === '') return '` `'
  let r = t.match(/`+/g)?.reduce((s, i) => Math.max(s, i.length), 0) ?? 0
  let o = '`'.repeat(r + 1)
  let e = t.startsWith('`') || t.endsWith('`') ? ' ' : ''
  return `${o}${e}${t}${e}${o}`
}

/** densable c — map fenced spans; strip wrap-spaces from em */
export function c(n: string, t: (inner: string) => string): string {
  return n.replace(/(`+)(.+?)\1/g, (r, o, e: string) => {
    let s = e.startsWith(' ') && e.endsWith(' ') && e.trim() !== ''
    return t(s ? e.slice(1, -1) : e)
  })
}

/** densable a */
export function a(n: string): boolean {
  let t = n.replace(E, '').indexOf(`${$Ie}${FIe}\``)
  return t >= 0 && t <= p
}

/** densable d */
export function d(n: string): boolean {
  return _.some(t => n.startsWith(t)) || a(n)
}

/** densable cGn */
export function cGn(n: string, t: (inner: string) => string): string {
  return d(n) ? c(n, t) : n
}

/** densable Dv — leftover toast Text (ae.bold) */
export function Dv(d: string): string {
  return cGn(d, C => chalk.bold(C))
}
