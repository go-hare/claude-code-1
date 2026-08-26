/**
 * densable `ZFt` / `QFt` — slash typo suggestion (2.1.236 #28).
 * Suggests the closest visible command/alias; does not execute it.
 */

export type SlashSuggestable = {
  name: string
  aliases?: readonly string[]
}

/**
 * densable `QFt` — Damerau–Levenshtein (insert/delete/substitute + transpose).
 */
export function slashCommandEditDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + cost)
      }
    }
  }
  return d[m]![n]!
}

/**
 * densable `ZFt` — nearest name/alias within `maxEditDistance` (official 2).
 */
export function suggestSlashCommand(
  input: string,
  commands: readonly SlashSuggestable[],
  options: { maxEditDistance?: number } = {},
): string | undefined {
  const maxEditDistance = options.maxEditDistance ?? 1
  const names = commands.flatMap(cmd => [cmd.name, ...(cmd.aliases ?? [])])
  let best: string | undefined
  let bestDistance = maxEditDistance + 1
  for (const name of names) {
    if (Math.abs(name.length - input.length) > maxEditDistance) continue
    const distance = slashCommandEditDistance(input, name)
    if (distance < bestDistance) {
      bestDistance = distance
      best = name
    }
  }
  return best
}
