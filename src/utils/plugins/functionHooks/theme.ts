/**
 * Function hooks submodule: theme
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { BUILTIN_MARKETPLACE_NAME } from '../../../plugins/builtinPlugins.js'
import { createHash, createHmac, randomBytes } from 'crypto'
import {
  lstat as fsLstat,
  open as fsOpen,
  realpath as fsRealpath,
} from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import { isDeepStrictEqual } from 'util'
import { isEventRecord } from './constants.js'
import { fhState } from './state.js'
import type { SessionThemeState } from './types.js'

// ============================================================================
// $.theme.set / $.theme.clear (v2.1.325 1:1)
// ============================================================================

const THEME_TOP_KEYS = ['backdrop', 'overrideColorScheme', 'colors'] as const

const THEME_BACKDROP_GROUNDS = [
  'scene',
  'color',
  'gradient',
  'vector',
  'image',
] as const

const THEME_BACKDROP_GROUND_SET = new Set<string>(THEME_BACKDROP_GROUNDS)

const THEME_BACKDROP_NESTED: Record<string, string> = {
  stops: 'gradient',
  angle: 'gradient',
  shape: 'gradient',
  viewBox: 'vector',
  paths: 'vector',
  colors:
    "the set itself: a look's theme is the colors attribute, beside backdrop",
  size: 'gradient, vector or image: a color or a scene takes none',
  repeat: 'gradient, vector or image: a color or a scene takes none',
}

const THEME_BACKDROP_GROUND_SHAPES: Record<string, string> = {
  gradient: '{ stops, angle?, shape?, size?, repeat? }',
  vector: '{ viewBox, paths, color?, size?, repeat? }',
  image: '{ source, size?, repeat? }',
}

const THEME_BACKDROP_USAGE =
  'backdrop is a scene, { scene, glass? }, or a still ground: { color }, { gradient: { stops } }, { vector: { viewBox, paths } } or { image: { source } }'

const THEME_PROTO_KEYS = Object.freeze([
  '__proto__',
  'constructor',
  'prototype',
])

const THEME_COLORS_MAX_CHARS = 65536

const THEME_COLORS_MAX_NODES = 1500

const THEME_COLORS_START_DEPTH = 3

const THEME_JSON_MAX_DEPTH = 32

const THEME_BACKDROP_MAX_NODES = 480

const THEME_IMAGE_SOURCE_MAX = 256

const THEME_GLASS_BLUR_MAX = 64

const THEME_GLASS_TINT_MAX = 64

const THEME_IMAGE_MAX_BYTES = 1048576

const THEME_IMAGE_MAX_SIDE = 4096

const THEME_IMAGE_CHUNK_BYTES = 40960

const THEME_GLASS_DEFAULT = { blur: 16, opacity: 0.6 }

const THEME_RAW_COLOR_RE =
  /^(#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})|(rgb|hsl)a?\( *(\d+(\.\d+)?|\.\d+)%?( *, *| +)(\d+(\.\d+)?|\.\d+)%?( *, *| +)(\d+(\.\d+)?|\.\d+)%?( *[,/] *(\d+(\.\d+)?|\.\d+)%?)? *\))$/

const themeImageKey = randomBytes(32)

function setSessionThemeState(
  updater: (
    prev: SessionThemeState | undefined,
  ) => SessionThemeState | undefined,
): void {
  const next = updater(fhState().sessionTheme)
  fhState().sessionTheme = next
  for (const listener of fhState().sessionThemeListeners) {
    try {
      listener()
    } catch {
      // ignore listener errors
    }
  }
}

export function getSessionTheme(): SessionThemeState | undefined {
  return fhState().sessionTheme
}

export function subscribeSessionTheme(listener: () => void): () => void {
  const listeners = fhState().sessionThemeListeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetSessionThemeForTests(): void {
  fhState().sessionTheme = undefined
  fhState().themeTurns.taken = 0
  fhState().themeTurns.landed = 0
  fhState().themeTurns.gone.clear()
}

export function getBackdropRenderProps(
  instanceId: string,
): Record<string, unknown> | undefined {
  const theme = fhState().sessionTheme
  const backdrop = theme?.backdrop
  if (
    theme !== undefined &&
    backdrop !== undefined &&
    backdrop.scene !== undefined &&
    instanceId === 'backdrop'
  ) {
    return {
      scene: backdrop.scene,
      plugin: theme.plugin,
      glass: backdrop.glass,
      ...(theme.overrideColorScheme !== undefined && {
        overrideColorScheme: theme.overrideColorScheme,
      }),
    }
  }
  return undefined
}

export function getThemeRenderProps(
  instanceId: string,
): Record<string, unknown> | undefined {
  const theme = fhState().sessionTheme
  if (theme === undefined) return undefined
  if (instanceId.startsWith('image:')) {
    const img = theme.image
    if (img === undefined) return undefined
    const [, id, idxStr, ...rest] = instanceId.split(':')
    const index = Number(idxStr)
    const of = Math.ceil(img.data.length / THEME_IMAGE_CHUNK_BYTES)
    if (
      id === img.id &&
      rest.length === 0 &&
      /^\d+$/.test(idxStr ?? '') &&
      index < of
    ) {
      return {
        data: img.data
          .subarray(
            index * THEME_IMAGE_CHUNK_BYTES,
            (index + 1) * THEME_IMAGE_CHUNK_BYTES,
          )
          .toString('base64'),
        index,
        of,
        hash: img.hash,
        bytes: img.data.length,
      }
    }
    return undefined
  }
  if (instanceId !== 'theme') return undefined
  const hasScene = theme.backdrop?.scene !== undefined
  if (hasScene && theme.colors === undefined) return undefined
  return {
    plugin: theme.plugin,
    ...(theme.overrideColorScheme !== undefined && {
      overrideColorScheme: theme.overrideColorScheme,
    }),
    ...(theme.colors !== undefined && { colors: theme.colors }),
    ...(theme.backdrop !== undefined &&
      !hasScene && { backdrop: theme.backdrop }),
  }
}

function themeFindForbiddenKey(
  value: unknown,
  seen = new WeakSet<object>(),
): string | undefined {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return undefined
  }
  seen.add(value)
  if (Array.isArray(value)) {
    const extraKey = Object.keys(value)[value.length]
    if (extraKey !== undefined) return String(extraKey)
    for (const item of value) {
      const hit = themeFindForbiddenKey(item, seen)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const protoHit = THEME_PROTO_KEYS.find(k => Object.hasOwn(value, k))
  if (protoHit !== undefined) return protoHit
  for (const [, v] of Object.entries(value)) {
    const hit = themeFindForbiddenKey(v, seen)
    if (hit !== undefined) return hit
  }
  return undefined
}

function isPlainThemeObject(value: unknown): value is Record<string, unknown> {
  if (!isEventRecord(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function measurePlainJson(
  value: unknown,
  depth: number,
  state: { nodes: number; chars: number; seen: WeakSet<object> },
): string | undefined {
  if (depth > THEME_JSON_MAX_DEPTH) {
    return `nests deeper than ${THEME_JSON_MAX_DEPTH}`
  }
  state.nodes += 1
  if (value === null || typeof value === 'boolean') {
    state.chars += value === null ? 4 : value ? 4 : 5
    return undefined
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `holds ${String(value)}`
    state.chars += String(value).length
    return undefined
  }
  if (typeof value === 'string') {
    state.chars += value.length + 2
    return undefined
  }
  if (value === undefined) {
    return 'holds undefined (an array hole, a missing value)'
  }
  if (typeof value !== 'object') {
    return `holds a ${typeof value}`
  }
  if (state.seen.has(value)) {
    return 'contains a cycle'
  }
  state.seen.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const err = measurePlainJson(value[i], depth + 1, state)
      if (err !== undefined) return err
    }
    return undefined
  }
  if (!isPlainThemeObject(value)) {
    return 'is not plain JSON data'
  }
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue
    state.chars += k.length + 3
    const err = measurePlainJson(v, depth + 1, state)
    if (err !== undefined) return err
  }
  return undefined
}

function validateThemeColors(colors: unknown): string | undefined {
  const maxDepth = THEME_JSON_MAX_DEPTH - THEME_COLORS_START_DEPTH
  const prefix = `colors must be a plain JSON object, a whole palette, of at most ${THEME_COLORS_MAX_NODES} values in about ${THEME_COLORS_MAX_CHARS} characters, nested at most ${maxDepth} deep`
  if (!isPlainThemeObject(colors)) return prefix
  const state = { nodes: 0, chars: 0, seen: new WeakSet<object>() }
  const err = measurePlainJson(colors, THEME_COLORS_START_DEPTH, state)
  if (err?.startsWith('nests deeper') === true) {
    return `${prefix}: this one nests too deep`
  }
  if (err !== undefined) return `${prefix}: this one ${err}`
  if (
    state.nodes > THEME_COLORS_MAX_NODES ||
    state.chars > THEME_COLORS_MAX_CHARS
  ) {
    return `${prefix}: this one holds ${state.nodes} values in about ${state.chars} characters`
  }
  const forbidden = themeFindForbiddenKey(colors)
  if (forbidden !== undefined) {
    return `colors may hold no key named ${forbidden} here: a list holds no named key, and a surface that merges colors reaches a prototype through __proto__, constructor or prototype`
  }
  return undefined
}

function validateThemeBackdrop(backdrop: unknown): string | undefined {
  if (!isPlainThemeObject(backdrop)) return THEME_BACKDROP_USAGE
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(backdrop)) {
    if (v !== null && v !== undefined) clean[k] = v
  }
  const { scene, glass } = clean
  const grounds = THEME_BACKDROP_GROUNDS.filter(g => clean[g] !== undefined)
  const nestedKey = Object.keys(THEME_BACKDROP_NESTED).find(
    k => clean[k] !== undefined,
  )
  if (nestedKey !== undefined) {
    return `backdrop.${nestedKey} goes inside ${THEME_BACKDROP_NESTED[nestedKey]}`
  }
  if (grounds.length > 1) {
    return `backdrop takes just one of scene, color, gradient, vector or image, and this names ${grounds.join(' and ')}`
  }
  if (grounds.length === 0) return THEME_BACKDROP_USAGE

  if (scene === undefined) {
    const shaped = grounds.find(g =>
      Object.hasOwn(THEME_BACKDROP_GROUND_SHAPES, g),
    )
    if (shaped !== undefined && !isPlainThemeObject(clean[shaped])) {
      return `backdrop.${shaped} is ${THEME_BACKDROP_GROUND_SHAPES[shaped]}`
    }
    if (isPlainThemeObject(clean.image)) {
      const src = clean.image.source
      const srcValid =
        typeof src === 'string' &&
        src !== '' &&
        src.length <= THEME_IMAGE_SOURCE_MAX &&
        !src.includes('\0') &&
        !src.includes('\\') &&
        !src.startsWith('/') &&
        !src.split('/').includes('..')
      if (!srcValid) {
        return `backdrop.image.source is a path of 1 to ${THEME_IMAGE_SOURCE_MAX} characters, relative to the mod's folder, with / between folders and no ".." in it`
      }
    }
    if (glass !== undefined) {
      return 'backdrop.glass is for a scene: a still ground has none'
    }
    const state = { nodes: 0, chars: 0, seen: new WeakSet<object>() }
    const err = measurePlainJson(backdrop, THEME_COLORS_START_DEPTH, state)
    if (err !== undefined) {
      return `backdrop must be plain JSON data of at most ${THEME_BACKDROP_MAX_NODES} values: this one ${err}`
    }
    if (state.nodes > THEME_BACKDROP_MAX_NODES) {
      return `backdrop may hold at most ${THEME_BACKDROP_MAX_NODES} values: this holds ${state.nodes}`
    }
    const forbidden = themeFindForbiddenKey(backdrop)
    if (forbidden !== undefined) {
      return THEME_PROTO_KEYS.includes(forbidden)
        ? `backdrop may hold no key named ${forbidden}: a surface's merge of it would reach a prototype`
        : `backdrop may hold no named key on a list, and a list here has one named ${forbidden}`
    }
    return undefined
  }

  if (
    typeof scene !== 'string' ||
    scene.length < 1 ||
    scene.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(scene)
  ) {
    return 'backdrop needs a scene: 1 to 64 of letters, digits, _ or -'
  }
  if (glass === undefined || glass === false) return undefined
  if (typeof glass !== 'object' || glass === null || Array.isArray(glass)) {
    return 'glass is { blur?, tint?, opacity? } or false'
  }
  const glassRec = glass as Record<string, unknown>
  const blur = 'blur' in glassRec ? glassRec.blur : undefined
  const opacity = 'opacity' in glassRec ? glassRec.opacity : undefined
  const tint = 'tint' in glassRec ? glassRec.tint : undefined
  if (
    blur !== undefined &&
    !(typeof blur === 'number' && blur >= 0 && blur <= THEME_GLASS_BLUR_MAX)
  ) {
    return `glass.blur is a number of points, 0 to ${THEME_GLASS_BLUR_MAX}`
  }
  if (
    opacity !== undefined &&
    !(typeof opacity === 'number' && opacity >= 0 && opacity <= 1)
  ) {
    return 'glass.opacity is a number, 0 to 1'
  }
  if (
    tint !== undefined &&
    !(
      typeof tint === 'string' &&
      tint.length <= THEME_GLASS_TINT_MAX &&
      THEME_RAW_COLOR_RE.test(tint)
    )
  ) {
    return `glass.tint is a raw color, #hex or rgb(), rgba(), hsl() or hsla() of numbers, at most ${THEME_GLASS_TINT_MAX} characters`
  }
  return undefined
}

export function themeSetCheck(input: unknown): string | undefined {
  if (!isPlainThemeObject(input)) {
    return `the argument is an object with any of ${THEME_TOP_KEYS.join(', ')}`
  }
  const unknownKey = Reflect.ownKeys(input).find(
    k =>
      typeof k !== 'string' ||
      !(THEME_TOP_KEYS as readonly string[]).includes(k),
  )
  if (unknownKey !== undefined) {
    return `theme.set does not know the attribute "${String(unknownKey)}": this build takes ${THEME_TOP_KEYS.join(', ')}`
  }
  const { backdrop, overrideColorScheme, colors } = input
  if (THEME_TOP_KEYS.every(k => input[k] === undefined)) {
    return `theme.set needs at least one of ${THEME_TOP_KEYS.join(', ')}; $.theme.clear() clears the theme`
  }
  if (
    overrideColorScheme !== undefined &&
    overrideColorScheme !== 'light' &&
    overrideColorScheme !== 'dark'
  ) {
    return 'overrideColorScheme is light or dark'
  }
  return (
    (backdrop === undefined ? undefined : validateThemeBackdrop(backdrop)) ??
    (colors === undefined ? undefined : validateThemeColors(colors))
  )
}

function normalizeThemeGlass(
  glass: unknown,
): false | { blur: number; opacity: number; tint?: string } {
  if (glass === false) return false
  const rec = isEventRecord(glass) ? glass : {}
  return {
    blur: typeof rec.blur === 'number' ? rec.blur : THEME_GLASS_DEFAULT.blur,
    opacity:
      typeof rec.opacity === 'number'
        ? rec.opacity
        : THEME_GLASS_DEFAULT.opacity,
    ...(typeof rec.tint === 'string' && { tint: rec.tint }),
  }
}

function parsePngDimensions(
  buf: Buffer,
): { width: number; height: number } | undefined {
  if (buf.length < 33) return undefined
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!sig.every((b, i) => buf[i] === b)) return undefined
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return undefined
  if (!buf.toString('latin1', buf.length - 8).startsWith('IEND'))
    return undefined
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function parseJpegDimensions(
  buf: Buffer,
): { width: number; height: number } | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined
  let i = 2
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) {
      i = buf.indexOf(0xff, i)
      if (i === -1 || i + 3 >= buf.length) break
    }
    const marker = buf[i + 1] ?? 0
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd9) break
    if (marker <= 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2
      continue
    }
    const len = buf.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > buf.length) break
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (i + 8 < buf.length && buf[i + 4] === 8) {
        return {
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        }
      }
      return undefined
    }
    i += 2 + len
  }
  return undefined
}

function validateThemeImageBytes(bytes: Buffer):
  | {
      facts: { type: 'jpeg' | 'png'; width: number; height: number }
      bytes: Buffer
    }
  | string {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  const isJpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
  if (!isPng && !isJpeg) {
    return 'it has to be a JPEG or PNG file'
  }
  const dims = isJpeg ? parseJpegDimensions(bytes) : parsePngDimensions(bytes)
  if (!dims || dims.width < 1 || dims.height < 1) {
    return isJpeg
      ? "it's a JPEG that can't be read here: save it again as a standard JPEG"
      : "it isn't a whole JPEG or PNG file"
  }
  if (dims.width > THEME_IMAGE_MAX_SIDE || dims.height > THEME_IMAGE_MAX_SIDE) {
    return `it's ${dims.width} by ${dims.height}: at most ${THEME_IMAGE_MAX_SIDE} on a side, so save it smaller`
  }
  return {
    facts: {
      type: isJpeg ? 'jpeg' : 'png',
      width: dims.width,
      height: dims.height,
    },
    bytes,
  }
}

async function readThemeImage(
  source: string,
  pluginName: string,
  pluginRoot: string,
): Promise<{
  wire: { type: 'jpeg' | 'png'; width: number; height: number; id: string }
  hash: string
  data: Buffer
}> {
  const realRoot = await fsRealpath(pluginRoot)
  const target = resolve(realRoot, source)
  const rel = relative(realRoot, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `${pluginName}: theme.set: ${source} is outside the mod's folder`,
    )
  }
  const realTarget = await fsRealpath(target)
  const realRel = relative(realRoot, realTarget)
  if (realRel === '' || realRel.startsWith('..') || isAbsolute(realRel)) {
    throw new Error(
      `${pluginName}: theme.set: ${source} escapes the mod's folder`,
    )
  }
  const st = await fsLstat(realTarget, { bigint: true })
  if (!st.isFile()) {
    throw new Error(`${pluginName}: theme.set: ${source} is not a file`)
  }
  if (st.nlink > 1n) {
    throw new Error(
      `${pluginName}: theme.set: ${source} has a second name (a hard link), so it isn't read: copy it to a file of its own`,
    )
  }
  if (st.size > BigInt(THEME_IMAGE_MAX_BYTES)) {
    throw new Error(
      `${pluginName}: theme.set: ${source} is too big: at most ${THEME_IMAGE_MAX_BYTES} bytes, so save it about 2560 wide as a JPEG`,
    )
  }
  const handle = await fsOpen(realTarget, 'r')
  let buf: Buffer
  try {
    buf = await handle.readFile()
  } finally {
    await handle.close()
  }
  if (buf.length > THEME_IMAGE_MAX_BYTES) {
    throw new Error(
      `${pluginName}: theme.set: ${source} is too big: at most ${THEME_IMAGE_MAX_BYTES} bytes, so save it about 2560 wide as a JPEG`,
    )
  }
  const validated = validateThemeImageBytes(buf)
  if (typeof validated === 'string') {
    throw new Error(`${pluginName}: theme.set: ${source}: ${validated}`)
  }
  const id = createHmac('sha256', themeImageKey)
    .update(validated.bytes)
    .digest('hex')
  const hash = createHash('sha256').update(validated.bytes).digest('hex')
  return {
    wire: { ...validated.facts, id },
    hash,
    data: validated.bytes,
  }
}

async function themeUndrawnReason(): Promise<string | undefined> {
  const { listSurfaceViewportClients } = await import(
    '../surfaceViewportClients.js'
  )
  const drawn = listSurfaceViewportClients().some(c => {
    const rec = c as { surface?: string; draws?: unknown }
    return (
      (rec.surface === 'desktop' || rec.surface === 'mobile') &&
      Array.isArray(rec.draws) &&
      rec.draws.includes('Theme')
    )
  })
  return drawn
    ? undefined
    : 'no attached desktop or mobile client draws themes yet; the theme stands and draws when one attaches'
}

export async function runThemeSet(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<{ isDrawn: boolean; requestId?: string; reason?: string }> {
  const pluginName = plugin && plugin !== '' ? plugin : 'unattributed'
  const mod = fhState().loadedModules.find(m => m.name === pluginName)
  const turn = (fhState().themeTurns.taken += 1)
  const backdropRec = isEventRecord(input.backdrop) ? input.backdrop : undefined
  const imageRec =
    backdropRec && isEventRecord(backdropRec.image)
      ? backdropRec.image
      : undefined
  const imageSource =
    imageRec && typeof imageRec.source === 'string'
      ? imageRec.source
      : undefined

  let loadedImage:
    | {
        wire: {
          type: 'jpeg' | 'png'
          width: number
          height: number
          id: string
        }
        hash: string
        data: Buffer
      }
    | undefined
  if (imageSource !== undefined) {
    const root = mod?.root
    if (!root || root === BUILTIN_MARKETPLACE_NAME) {
      throw new Error(
        `${pluginName}: theme.set: ${imageSource} isn't read, so nothing was set: an image is read only through a safe handle on the mod's folder`,
      )
    }
    loadedImage = await readThemeImage(imageSource, pluginName, root)
  }

  const goneTurn = fhState().themeTurns.gone.get(pluginName) ?? 0
  if (turn < fhState().themeTurns.landed || turn < goneTurn) {
    return {
      isDrawn: false,
      reason:
        'nothing was set: a later $.theme.set or $.theme.clear came first, this mod unloaded, or the call was aborted',
    }
  }
  fhState().themeTurns.landed = turn

  const scene =
    backdropRec && typeof backdropRec.scene === 'string'
      ? backdropRec.scene
      : undefined
  const requestId = scene === undefined ? 'theme' : 'backdrop'
  const nextState: SessionThemeState = {
    plugin: pluginName,
    ...(backdropRec !== undefined && {
      backdrop:
        scene === undefined
          ? {
              ...backdropRec,
              scene: undefined,
              ...(loadedImage !== undefined && {
                image: {
                  ...loadedImage.wire,
                  size: imageRec?.size,
                  repeat: imageRec?.repeat,
                },
              }),
            }
          : {
              scene,
              glass: normalizeThemeGlass(backdropRec.glass),
            },
    }),
    ...(loadedImage !== undefined && {
      image: {
        id: loadedImage.wire.id,
        hash: loadedImage.hash,
        data: loadedImage.data,
      },
    }),
    ...(input.overrideColorScheme !== undefined && {
      overrideColorScheme: input.overrideColorScheme as 'light' | 'dark',
    }),
    ...(input.colors !== undefined && {
      colors: input.colors as Record<string, unknown>,
    }),
  }

  if (!isDeepStrictEqual(fhState().sessionTheme, nextState)) {
    setSessionThemeState(() => nextState)
  }

  const undrawn = await themeUndrawnReason()
  if (undrawn === undefined) {
    return { isDrawn: true, requestId }
  }
  return { isDrawn: false, requestId, reason: undrawn }
}

export function runThemeClear(): { isDrawn: false; reason: string } {
  fhState().themeTurns.taken += 1
  fhState().themeTurns.landed = fhState().themeTurns.taken
  const stood = fhState().sessionTheme !== undefined
  if (stood) {
    setSessionThemeState(() => undefined)
  }
  return {
    isDrawn: false,
    reason: stood
      ? 'the theme is cleared'
      : 'no theme stood, so nothing was cleared',
  }
}

export function themeClearOnUnload(pluginName: string): void {
  fhState().themeTurns.taken += 1
  fhState().themeTurns.gone.set(pluginName, fhState().themeTurns.taken)
  if (fhState().sessionTheme?.plugin === pluginName) {
    setSessionThemeState(prev =>
      prev?.plugin === pluginName ? undefined : prev,
    )
  }
}
