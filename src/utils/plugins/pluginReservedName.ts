/**
 * densable `fkt` / `spo` / `d` — reserved Anthropic-own plugin names.
 * Gold @207301700. Confusable fold is densable `DEe`/`uu`/`P` @180458013.
 */

const MARKS = ['claude', 'anthropic', 'anthropics'] as const
const BUILTIN_LEAD = 'cc-plugin'
const PRODUCTS = ['claude-code', 'claude-mods'] as const
const LEAD = [...MARKS, BUILTIN_LEAD]
const WHOLE = [...MARKS, ...PRODUCTS]

const OFFICIAL_BESIDE =
  /official[^a-z0-9]*(anthropic|claude)|(?:anthropic|claude)[^a-z0-9]*official/i
const NON_ASCII = /[^ -~]/

/** densable `P` — lookalike letters folded to ASCII. */
const CONFUSABLE: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  к: 'k',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  һ: 'h',
  ӏ: 'l',
  В: 'b',
  М: 'm',
  Н: 'h',
  Т: 't',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ϳ: 'j',
  Β: 'b',
  Ζ: 'z',
  Η: 'h',
  Μ: 'm',
  Ν: 'n',
  Υ: 'y',
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ꜰ: 'f',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
  ɑ: 'a',
  ɡ: 'g',
  ı: 'i',
  ѵ: 'v',
  т: 't',
  м: 'm',
  ꭰ: 'd',
  ꭱ: 'r',
  ꭲ: 't',
  ꭹ: 'y',
  ꭺ: 'a',
  ꭻ: 'j',
  ꭼ: 'e',
  ꮃ: 'w',
  ꮇ: 'm',
  ꮋ: 'h',
  ꮐ: 'g',
  ꮒ: 'h',
  ꮓ: 'z',
  ꮜ: 'u',
  ꮟ: 'b',
  ꮢ: 'r',
  ꮤ: 'w',
  ꮩ: 'v',
  ꮪ: 's',
  ꮮ: 'l',
  ꮯ: 'c',
  ꮲ: 'p',
  ꮶ: 'k',
  ꮷ: 'd',
  ᏼ: 'b',
  ꓐ: 'b',
  ꓑ: 'p',
  ꓓ: 'd',
  ꓔ: 't',
  ꓖ: 'g',
  ꓗ: 'k',
  ꓙ: 'j',
  ꓚ: 'c',
  ꓜ: 'z',
  ꓝ: 'f',
  ꓟ: 'm',
  ꓠ: 'n',
  ꓡ: 'l',
  ꓢ: 's',
  ꓣ: 'r',
  ꓦ: 'v',
  ꓧ: 'h',
  ꓪ: 'w',
  ꓫ: 'x',
  ꓬ: 'y',
  ꓮ: 'a',
  ꓰ: 'e',
  ꓲ: 'i',
  ꓳ: 'o',
  ꓴ: 'u',
  զ: 'q',
  հ: 'h',
  ո: 'n',
  ս: 'u',
  ց: 'g',
  օ: 'o',
  ϲ: 'c',
  ⲥ: 'c',
  ɩ: 'i',
  ⲁ: 'a',
  ⲃ: 'b',
  ⲉ: 'e',
  ⲏ: 'h',
  ⲓ: 'i',
  ⲕ: 'k',
  ⲙ: 'm',
  ⲛ: 'n',
  ⲟ: 'o',
  ⲣ: 'p',
  ⲧ: 't',
  ⲩ: 'y',
  ⲭ: 'x',
  ⲍ: 'z',
}

const CONFUSABLE_FOLD = (() => {
  const table: Record<string, string> = { ...CONFUSABLE }
  for (const [from, to] of Object.entries(CONFUSABLE)) {
    const upper = from.toUpperCase()
    if (
      upper !== from &&
      [...upper].length === 1 &&
      !(upper in table) &&
      !/^[A-Za-z]$/.test(upper)
    ) {
      table[upper] = to
    }
  }
  return {
    table,
    pattern: new RegExp(`[${Object.keys(table).join('')}]`, 'gu'),
  }
})()

function stripMarks(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '')
}

/** densable `DEe`. */
function foldConfusableName(value: string): string {
  const { table, pattern } = CONFUSABLE_FOLD
  const fold = (s: string) => s.replace(pattern, ch => table[ch] ?? ch)
  return fold(stripMarks(fold(value))).normalize('NFKC')
}

function nameTokens(value: string): string[] {
  return value.split(/[^a-z0-9]+/i).filter(t => t !== '')
}

function* prefixJoins(
  value: string,
  max: number,
): Generator<{ joined: string; isWhole: boolean }> {
  const parts = nameTokens(value)
  let joined = ''
  for (const [i, part] of parts.entries()) {
    joined += part
    yield { joined, isWhole: i === parts.length - 1 }
    if (joined.length > max) return
  }
}

function setOfJoined(names: readonly string[]): Set<string> {
  return new Set(names.map(n => nameTokens(n).join('')))
}

const LEAD_JOINED = setOfJoined(LEAD)
const WHOLE_JOINED = setOfJoined(WHOLE)
const JOIN_CAP = Math.max(
  ...[...LEAD_JOINED, ...WHOLE_JOINED].map(s => s.length),
)

function orList(items: readonly string[]): string {
  return new Intl.ListFormat('en', { type: 'disjunction' }).format(
    items.map(n => `"${n}"`),
  )
}

const THIRD_PARTY_RULE = `A third party's plugin name cannot start with ${orList(LEAD.map(n => `${n}-`))}, be ${orList(WHOLE)}, or put "official" beside "claude" or "anthropic".`
const NAME_IT = 'Name it for what it does.'

/** densable `spo`. */
export const ANTHROPIC_OWN_PLUGIN_VALIDATE_MARKETPLACE =
  "If this is one of Anthropic's own plugins, validate the marketplace that lists it."

export type ReservedPluginNameHit = {
  severity: 'error' | 'warning'
  message: string
}

/**
 * densable `fkt` — reserved / reads-as-own plugin name.
 */
export function checkAnthropicOwnPluginName(
  name: string,
): ReservedPluginNameHit | undefined {
  const folded = NON_ASCII.test(name) ? foldConfusableName(name) : name
  const lower = folded.toLowerCase()
  const shown = NON_ASCII.test(name)
    ? `"${name}" (read as "${lower}")`
    : `"${name}"`
  const tokens = nameTokens(lower)
  const reserved = [...prefixJoins(lower, JOIN_CAP)].some(
    ({ joined, isWhole }) => (isWhole ? WHOLE_JOINED : LEAD_JOINED).has(joined),
  )
  if (
    reserved ||
    OFFICIAL_BESIDE.test(lower) ||
    OFFICIAL_BESIDE.test(tokens.join(''))
  ) {
    return {
      severity: 'error',
      message: `Plugin name ${shown} is reserved: it passes as one of Anthropic's own. ${THIRD_PARTY_RULE} ${NAME_IT}`,
    }
  }
  if (MARKS.some(mark => tokens.includes(mark))) {
    return {
      severity: 'warning',
      message: `Plugin name ${shown} reads as one of Anthropic's own. ${NAME_IT}`,
    }
  }
  return undefined
}
