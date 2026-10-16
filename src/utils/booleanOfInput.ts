/**
 * densable 2.1.289 Le / Ss / booleanOfInput (`_Ne`).
 *
 * `booleanOfInput` is Le ? true : Ss ? false : undefined — invalid
 * strings stay undefined (not coerced to false).
 */

/** densable Le */
export function isTruthyInput(value: unknown): boolean {
  if (!value) return false
  if (typeof value === 'boolean') return value
  const n = String(value).toLowerCase().trim()
  return ['1', 'true', 'yes', 'on'].includes(n)
}

/** densable Ss */
export function isFalsyInput(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return !value
  const n = String(value).toLowerCase().trim()
  return ['0', 'false', 'no', 'off'].includes(n)
}

/** densable booleanOfInput / `_Ne` */
export function booleanOfInput(value: unknown): boolean | undefined {
  return isTruthyInput(value) ? true : isFalsyInput(value) ? false : undefined
}

/** densable isHeldTrue / q1n */
export function isHeldTrue(value: unknown): boolean {
  return value === true || value === 'true'
}
