/**
 * densable 2.1.283 timeFormat / timeZone (VZe / P5t / wdr / qZe / bdr).
 * Semantic names only — minified gold symbols stay in comments.
 */
import stripAnsi from 'strip-ansi'
import { getInitialSettings } from './settings/settings.js'

export const TIME_FORMAT_PRESETS = [
  'auto',
  '12-hour',
  '24-hour',
  '24-hour-utc',
] as const

export type TimeFormatPreset = (typeof TIME_FORMAT_PRESETS)[number]

export type ResolvedTimeFormat =
  | { kind: 'preset'; preset: TimeFormatPreset; timeZone?: string }
  | { kind: 'pattern'; pattern: string; timeZone?: string }

const DATE_TIME_STAMP: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
}

const WEEKDAY_SHORT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  calendar: 'gregory',
}
const WEEKDAY_LONG: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  calendar: 'gregory',
}
const MONTH_SHORT: Intl.DateTimeFormatOptions = {
  month: 'short',
  calendar: 'gregory',
}
const MONTH_LONG: Intl.DateTimeFormatOptions = {
  month: 'long',
  calendar: 'gregory',
}

const PATTERN_MAX = 100

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>()
const posixLocaleCache = new Map<string, string | undefined>()

function withTimeZone(
  options: Intl.DateTimeFormatOptions,
  timeZone?: string,
): Intl.DateTimeFormatOptions {
  return timeZone ? { ...options, timeZone } : options
}

function cachedDateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  let formatter = dateTimeFormatCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    dateTimeFormatCache.set(key, formatter)
  }
  return formatter
}

function stripControlChars(input: string): string {
  return Array.from(input)
    .filter(ch => {
      const cp = ch.codePointAt(0) ?? 0
      return cp >= 0x20 && cp !== 0x7f && cp !== 0x2028 && cp !== 0x2029
    })
    .join('')
}

/** densable bdr — sanitize a user timeFormat string. */
export function sanitizeTimeFormatSetting(value: string): string {
  return stripControlChars(stripAnsi(value)).slice(0, PATTERN_MAX)
}

function posixLocaleTag(): string | undefined {
  const raw =
    process.env.LC_ALL || process.env.LC_TIME || process.env.LANG || ''
  if (posixLocaleCache.has(raw)) return posixLocaleCache.get(raw)
  const locale = parsePosixLocale(raw)
  posixLocaleCache.set(raw, locale)
  return locale
}

function parsePosixLocale(raw: string): string | undefined {
  if (!raw || raw === 'C' || raw === 'POSIX') return undefined
  const withoutCharset = raw.split('.')[0]?.split('@')[0]
  if (!withoutCharset) return undefined
  const tag = withoutCharset.replaceAll('_', '-')
  try {
    new Intl.DateTimeFormat(tag)
    return tag
  } catch {
    return undefined
  }
}

function pad2(n: number, dash: string): string {
  return dash ? String(n) : String(n).padStart(2, '0')
}

function pad3(n: number, dash: string): string {
  return dash ? String(n) : String(n).padStart(3, '0')
}

function padSpace(n: number, dash: string): string {
  return dash ? String(n) : String(n).padStart(2, ' ')
}

function dayOfYear(year: number, month: number, day: number): number {
  return (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000 + 1
}

function formatNamedPart(
  date: Date,
  locale: string | undefined,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  return cachedDateTimeFormat(locale, withTimeZone(options, timeZone)).format(
    date,
  )
}

function formatOffset(
  date: Date,
  year: number,
  month: number,
  day: number,
  hour: number,
  parts: Record<string, string>,
): string {
  const utc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    Number(parts.minute),
    Number(parts.second),
  )
  const local = Math.floor(date.getTime() / 1000) * 1000
  const minutes = Math.round((utc - local) / 60000)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`
}

/** densable y() — strftime subset used by timeFormat patterns. */
export function formatStrftime(
  pattern: string,
  date: Date,
  options: { locale?: string; timeZone?: string },
): string {
  const { locale, timeZone } = options
  const partsList = cachedDateTimeFormat(
    'en-US',
    withTimeZone(DATE_TIME_STAMP, timeZone),
  ).formatToParts(date)
  const parts: Record<string, string> = {}
  for (const part of partsList) parts[part.type] = part.value
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour)
  const hour12 = ((hour + 11) % 12) + 1
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return pattern.replace(/%(-?)([\s\S])/g, (match, dash: string, spec: string) => {
    switch (spec) {
      case 'Y':
        return String(year)
      case 'y':
        return pad2(year % 100, dash)
      case 'C':
        return pad2(Math.floor(year / 100), dash)
      case 'm':
        return pad2(month, dash)
      case 'd':
        return pad2(day, dash)
      case 'e':
        return padSpace(day, dash)
      case 'j':
        return pad3(dayOfYear(year, month, day), dash)
      case 'u':
        return String(weekday === 0 ? 7 : weekday)
      case 'w':
        return String(weekday)
      case 'H':
        return pad2(hour, dash)
      case 'k':
        return padSpace(hour, dash)
      case 'I':
        return pad2(hour12, dash)
      case 'l':
        return padSpace(hour12, dash)
      case 'M':
        return pad2(Number(parts.minute), dash)
      case 'S':
        return pad2(Number(parts.second), dash)
      case 'p':
        return hour < 12 ? 'AM' : 'PM'
      case 'P':
        return hour < 12 ? 'am' : 'pm'
      case 's':
        return String(Math.floor(date.getTime() / 1000))
      case 'a':
        return formatNamedPart(date, locale, timeZone, WEEKDAY_SHORT)
      case 'A':
        return formatNamedPart(date, locale, timeZone, WEEKDAY_LONG)
      case 'b':
      case 'h':
        return formatNamedPart(date, locale, timeZone, MONTH_SHORT)
      case 'B':
        return formatNamedPart(date, locale, timeZone, MONTH_LONG)
      case 'Z':
        return parts.timeZoneName ?? ''
      case 'z':
        return formatOffset(date, year, month, day, hour, parts)
      case 'F':
        return `${year}-${pad2(month, '')}-${pad2(day, '')}`
      case 'D':
        return `${pad2(month, '')}/${pad2(day, '')}/${pad2(year % 100, '')}`
      case 'T':
        return `${pad2(hour, '')}:${parts.minute}:${parts.second}`
      case 'R':
        return `${pad2(hour, '')}:${parts.minute}`
      case 'r':
        return `${pad2(hour12, '')}:${parts.minute}:${parts.second} ${hour < 12 ? 'AM' : 'PM'}`
      case '%':
        return '%'
      default:
        return match
    }
  })
}

function settingsTimeZone(): string | undefined {
  const value = getInitialSettings().timeZone ?? ''
  if (!value) return undefined
  try {
    cachedDateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return undefined
  }
}

/** densable VZe — resolve settings.timeFormat + timeZone. */
export function resolveTimeFormat(): ResolvedTimeFormat {
  const raw = getInitialSettings().timeFormat ?? 'auto'
  const preset = TIME_FORMAT_PRESETS.find(p => p === raw)
  if (preset === '24-hour-utc') {
    return { kind: 'preset', preset, timeZone: 'UTC' }
  }
  const timeZone = settingsTimeZone()
  if (preset) {
    return { kind: 'preset', preset, timeZone }
  }
  const pattern = sanitizeTimeFormatSetting(raw)
  return pattern.includes('%')
    ? { kind: 'pattern', pattern, timeZone }
    : { kind: 'preset', preset: 'auto', timeZone }
}

function hourCycleOptions(
  base: Intl.DateTimeFormatOptions,
  preset: TimeFormatPreset,
  timeZone?: string,
): Intl.DateTimeFormatOptions {
  switch (preset) {
    case 'auto':
      return withTimeZone(base, timeZone)
    case '12-hour':
      return withTimeZone({ ...base, hourCycle: 'h12' }, timeZone)
    case '24-hour':
    case '24-hour-utc':
      return withTimeZone({ ...base, hourCycle: 'h23' }, timeZone)
  }
}

/** densable P5t — format a Date with a resolved preset. */
export function formatPresetTime(
  resolved: Extract<ResolvedTimeFormat, { kind: 'preset' }>,
  options: Intl.DateTimeFormatOptions,
  locale: string | undefined,
  date: Date,
): string {
  const formatter = cachedDateTimeFormat(
    locale,
    hourCycleOptions(options, resolved.preset, resolved.timeZone),
  )
  if (resolved.preset !== '24-hour-utc') return formatter.format(date)
  const parts = formatter.formatToParts(date)
  const zIndex = parts.findLastIndex(
    p => p.type === 'minute' || p.type === 'second',
  )
  return parts
    .map((part, i) => (i === zIndex ? `${part.value}Z` : part.value))
    .join('')
}

/** densable qZe — format a strftime pattern (capped). */
export function formatPatternTime(
  pattern: string,
  timeZone: string | undefined,
  date: Date,
): string {
  return formatStrftime(pattern, date, {
    locale: posixLocaleTag(),
    timeZone,
  }).slice(0, PATTERN_MAX)
}

const CLOCK_STAMP: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
}

const FULL_STAMP: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
}

export function formatClockTime(date: Date, timeZoneOverride?: string): string {
  const resolved = resolveTimeFormat()
  const timeZone = timeZoneOverride ?? resolved.timeZone
  if (resolved.kind === 'pattern') {
    return formatPatternTime(resolved.pattern, timeZone, date)
  }
  return formatPresetTime(
    { ...resolved, timeZone },
    CLOCK_STAMP,
    undefined,
    date,
  )
}

export function formatFullTimestamp(
  date: Date,
  timeZoneOverride?: string,
): string {
  const resolved = resolveTimeFormat()
  const timeZone = timeZoneOverride ?? resolved.timeZone
  if (resolved.kind === 'pattern') {
    return formatPatternTime(resolved.pattern, timeZone, date)
  }
  return formatPresetTime({ ...resolved, timeZone }, FULL_STAMP, 'en-US', date)
}
