/**
 * densable 2.1.289 `Z1` / `ae` surface viewport client registry + `Epn` + CLI
 * `Fco` / `ui_attach` / `U9t` `ui_detach` / `GAn` `ui_render` / `zAn`
 * `ui_press` / `XAn` `ui_input` / `okn` `ui_prompt_edit` / `JAn`
 * `ui_select` / `QAn` `ui_panes` / `ZAn` `ui_pane_show` / `ekn`
 * `ui_pane_focus` / `tkn` `ui_close` / `nkn` `ui_scroll` / `rkn`
 * `ui_focus` / `VAn` `ui_client_module` / `qAn` `ui_client_press` /
 * `KAn` `ui_message` / `YAn` `ui_client_fault` (print.ts
 * control_request host).
 *
 * Overlay footer is Desktop-only — do **not** invent it.
 * Do **not** export minify `Z1` / `Epn` / `xe` / `Spn` / `Fco` / `U9t`
 * / `zAn` / `XAn` / `okn` / `JAn` / `QAn` / `ck` / `wd` / `JC` / `vC`
 * / `E1e`.
 */

import { createSignal } from '../signal.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'

export type SurfaceViewport = {
  columns?: number
  rows?: number
  /** densable Spn: key presence (not truthiness) marks pane-placing surface. */
  isFullscreen?: boolean
}

export type SurfaceViewportClient = {
  clientId: string
  surface: 'desktop' | 'mobile' | 'vscode' | string
  viewport?: SurfaceViewport
  answers?: unknown
  attachedAt?: number
}

/** densable `W` — wire surfaces on `ui_attach`. */
export const UI_ATTACH_SURFACES = ['desktop', 'mobile', 'vscode'] as const
export type UiAttachSurface = (typeof UI_ATTACH_SURFACES)[number]

/**
 * densable `eR` / `lVt` — answers a client may name on attach.
 */
export const UI_ATTACH_ANSWERS = [
  'ui_copy',
  'ui_prompt_read',
  'ui_prompt_fill',
  'ui_prompt_suggest',
  'ui_read_selection',
] as const
export type UiAttachAnswer = (typeof UI_ATTACH_ANSWERS)[number]

/** densable `xW` — client_id 1–64 of letters, digits, `.`, `_`, `-`. */
const UI_ATTACH_CLIENT_ID = /^[A-Za-z0-9._-]{1,64}$/

/**
 * densable `jAn` fail copy interpolated with `lVt().options`.
 */
export const UI_ATTACH_PARSE_ERROR =
  'ui_attach: surface must be "desktop", "mobile" or "vscode", client_id 1-64 of letters, digits, . _ - (the colon is the engine\'s), viewport (when given) positive integer columns and rows with isFullscreen (when given) a boolean, and answers (when given) a list of ' +
  UI_ATTACH_ANSWERS.map(name => `"${name}"`).join(', ')

/**
 * densable `WAn` fail copy — `client_id` uses the same `xW` charset as attach.
 */
export const UI_DETACH_PARSE_ERROR =
  "ui_detach: client_id must be 1-64 of letters, digits, . _ - (the colon is the engine's)"

/**
 * densable `lr` — `ui_render` `component` is a render-site name.
 */
export const UI_RENDER_SITES = [
  'AskUserQuestion',
  'UserMessage',
  'AssistantMessage',
  'ToolUse',
  'ToolResult',
  'ToolGroup',
  'ToolProgress',
  'CommandOutput',
  'Spinner',
  'TurnDuration',
  'InfoNotice',
  'SessionMode',
  'PromptHint',
  'AbovePrompt',
  'Pane',
] as const
export type UiRenderSite = (typeof UI_RENDER_SITES)[number]

/**
 * densable `GAn` fail copy (keyed / bench / content_rows fail with this too).
 */
export const UI_RENDER_PARSE_ERROR =
  'ui_render: surface must be "desktop", "mobile" or "vscode", component a render site name, instance_id a string, props an object, client_id (when given) 1-64 safe characters, viewport (when given) positive integer columns and rows with isFullscreen (when given) a boolean, and on_screen (when given) null or integers first <= last < of'

/**
 * densable `zAn` fail copy (print.ts `Qe` after `ui_render`).
 */
export const UI_PRESS_PARSE_ERROR =
  'ui_press: plugin must be a string, handle an integer, key (when given) a string, surface (when given) "desktop", "mobile" or "vscode" and href (when given) a string of at most 2048 characters'

/**
 * densable `XAn` fail copy.
 */
export const UI_INPUT_PARSE_ERROR =
  'ui_input: plugin must be a string, handle an integer, kind "change" or "submit", value a string of at most 16384 characters, key (when given) a string, component (when given) a render site name, instance_id (when given) a string and surface (when given) "desktop", "mobile" or "vscode"'

/**
 * densable `JAn` fail copy.
 */
export const UI_SELECT_PARSE_ERROR =
  'ui_select: plugin must be a string, handle an integer, value a string of at most 16384 characters, key (when given) a string, component (when given) a render site name, instance_id (when given) a string and surface (when given) "desktop", "mobile" or "vscode"'

/**
 * densable `okn` fail copy.
 */
export const UI_PROMPT_EDIT_PARSE_ERROR =
  'ui_prompt_edit: text must be a string of at most 1000000 characters, cursor an integer >= 0, key (when given) an object with key a string of 1-32 characters and ctrl, shift, meta each true when present, by (when given) "person" or "app", surface (when given) "desktop", "mobile" or "vscode" and client_id (when given) 1-64 of letters, digits, . _ -'

/**
 * densable `QAn` fail copy.
 */
export const UI_PANES_PARSE_ERROR =
  'ui_panes: client_id (when given) 1-64 safe characters'

/**
 * densable `ZAn` fail copy (`XF` pane id, no dots).
 */
export const UI_PANE_SHOW_PARSE_ERROR =
  'ui_pane_show: id must be 1-64 of letters, digits, _ or -'

/**
 * densable `ekn` fail copy.
 */
export const UI_PANE_FOCUS_PARSE_ERROR =
  'ui_pane_focus: id must be null or 1-64 of letters, digits, _ or -, surface (when given) "desktop", "mobile" or "vscode"'

/**
 * densable `tkn` fail copy.
 */
export const UI_CLOSE_PARSE_ERROR =
  'ui_close: id must be 1-64 of letters, digits, _ or -'

/**
 * densable `nkn` fail copy.
 */
export const UI_SCROLL_PARSE_ERROR =
  'ui_scroll: component must be "Pane" or "AbovePrompt", instance_id a string of at most 256 characters, offset, body_rows and content_rows non-negative integers, by an integer, pointer (when given) integer column and row, keyed (when given) at most 512 of {plugin, key, top, bottom}, surface (when given) "desktop", "mobile" or "vscode"'

/**
 * densable `rkn` fail copy.
 */
export const UI_FOCUS_PARSE_ERROR =
  'ui_focus: component must be "Pane" or "AbovePrompt", instance_id a string of at most 256 characters, is_held a boolean, element (when given) null or {plugin, key} of at most 256 characters each, by (when given) "person" or "auto", surface (when given) "desktop", "mobile" or "vscode"'

/**
 * densable `VAn` fail copy.
 */
export const UI_CLIENT_MODULE_PARSE_ERROR =
  'ui_client_module: plugin must be a string'

/**
 * densable `Yt` analog — sanitize then truncate 1024. **No quotes**
 * (`JSON.stringify` is not gold).
 */
export function uiControlPluginName(plugin: string): string {
  if (typeof plugin !== 'string') return ''
  let n = plugin.length > 4096 ? plugin.slice(0, 4096) : plugin
  for (let i = 0; i < 64; i++) {
    let next = ''
    for (const ch of n) {
      const cp = ch.codePointAt(0) ?? 0
      if (cp <= 0x08) continue
      if (cp === 0x0b || cp === 0x0c) continue
      if (cp >= 0x0e && cp <= 0x1f) continue
      if (cp >= 0x7f && cp <= 0x9f) continue
      next += ch
    }
    if (next === n) break
    n = next
  }
  return n.length > 1024 ? n.slice(0, 1024) : n
}

/** densable print `Qe` when `E1e.clientModule` is undefined. */
export function uiClientModuleMissingError(plugin: string): string {
  return `ui_client_module: plugin ${uiControlPluginName(plugin)} is not loaded or its hooks module names no surface module`
}

/**
 * densable `qAn` fail copy.
 */
export const UI_CLIENT_PRESS_PARSE_ERROR =
  'ui_client_press: plugin, instance_id, client, module and element must be strings, component a render site name, and event {type: "press"} | {type: "input", kind, value} | {type: "select", value}'

/**
 * densable `KAn` fail copy.
 */
export const UI_MESSAGE_PARSE_ERROR =
  'ui_message: plugin, instance_id, client and module must be strings, component a render site name, and data present (plain JSON)'

/**
 * densable `yv` — gold `_v` throws `Rr(yv(zod))`. Empty issues →
 * `ui_client_fault: malformed`; else `ui_client_fault: ${path}: ${message}`.
 */
export const UI_CLIENT_FAULT_MALFORMED = 'ui_client_fault: malformed'

export function uiClientFaultYV(path?: string, message?: string): string {
  if (path === undefined || path === '') return UI_CLIENT_FAULT_MALFORMED
  return `ui_client_fault: ${path}: ${message ?? 'Required'}`
}

/** densable `Y` — keyed plugin/key max. */
const UI_RENDER_KEYED_STRING_MAX = 256
/** densable `ir`. */
const UI_INPUT_VALUE_MAX = 16384
/** densable `o().max(2048)` on `ui_press.href`. */
const UI_PRESS_HREF_MAX = 2048
/** densable `cr=1e6`. */
const UI_PROMPT_EDIT_TEXT_MAX = 1_000_000
/** densable `e1=32`. */
const UI_PROMPT_EDIT_KEY_MAX = 32
/** densable `Jw`. */
const UI_RENDER_KEYED_MAX = 512

export type ParsedUiAttachRequest =
  | {
      ok: true
      surface: UiAttachSurface
      clientId: string
      viewport?: SurfaceViewport
      answers?: readonly UiAttachAnswer[]
    }
  | { ok: false; error: string }

export type ParsedUiDetachRequest =
  | { ok: true; clientId: string }
  | { ok: false; error: string }

export type UiRenderOnScreen = {
  first: number
  last: number
  of: number
}

export type UiRenderKeyedRow = {
  plugin: string
  key: string
  top: number
  bottom: number
}

export type UiRenderBench = {
  seq: number
  t0: number
}

export type ParsedUiRenderRequest =
  | {
      ok: true
      surface: UiAttachSurface
      component: UiRenderSite
      instanceId: string
      props: Record<string, unknown>
      clientId?: string
      viewport?: SurfaceViewport
      onScreen?: UiRenderOnScreen | null
      contentRows?: number
      keyed?: readonly UiRenderKeyedRow[]
      bench?: UiRenderBench
    }
  | { ok: false; error: string }

export type ParsedUiPressRequest =
  | {
      ok: true
      plugin: string
      handle: number
      surface: UiAttachSurface
      key?: string
      href?: string
      clientId?: string
    }
  | { ok: false; error: string }

export type UiInputKind = 'change' | 'submit'

export type ParsedUiInputRequest =
  | {
      ok: true
      plugin: string
      handle: number
      kind: UiInputKind
      value: string
      surface: UiAttachSurface
      key?: string
      component?: UiRenderSite
      instanceId?: string
      clientId?: string
    }
  | { ok: false; error: string }

export type ParsedUiSelectRequest =
  | {
      ok: true
      plugin: string
      handle: number
      value: string
      surface: UiAttachSurface
      key?: string
      component?: UiRenderSite
      instanceId?: string
      clientId?: string
    }
  | { ok: false; error: string }

export type UiPromptEditKey = {
  key: string
  ctrl?: true
  shift?: true
  meta?: true
}

export type UiPromptEditBy = 'person' | 'app'

export type ParsedUiPromptEditRequest =
  | {
      ok: true
      text: string
      cursor: number
      surface: UiAttachSurface
      by: UiPromptEditBy
      key?: UiPromptEditKey
      clientId?: string
    }
  | { ok: false; error: string }

/** densable `XF` — pane id, no dots. */
const UI_PANE_WIRE_ID = /^[A-Za-z0-9_-]{1,64}$/

export const UI_SCROLL_SITES = ['Pane', 'AbovePrompt'] as const
export type UiScrollSite = (typeof UI_SCROLL_SITES)[number]

export const UI_FOCUS_BY = ['person', 'auto'] as const
export type UiFocusBy = (typeof UI_FOCUS_BY)[number]

export const UI_CLIENT_FAULT_PHASES = ['load', 'render', 'run'] as const
export type UiClientFaultPhase = (typeof UI_CLIENT_FAULT_PHASES)[number]

/** densable `HW=200`. */
const UI_CLIENT_FAULT_REASON_MAX = 200

export type ParsedUiPanesRequest =
  | { ok: true; clientId?: string }
  | { ok: false; error: string }

export type ParsedUiPaneShowRequest =
  | {
      ok: true
      id: string
      surface: UiAttachSurface
      clientId?: string
    }
  | { ok: false; error: string }

export type ParsedUiPaneFocusRequest =
  | {
      ok: true
      id: string | null
      surface: UiAttachSurface
      clientId?: string
    }
  | { ok: false; error: string }

export type ParsedUiCloseRequest =
  | { ok: true; id: string; clientId?: string }
  | { ok: false; error: string }

export type UiScrollPointer = { column: number; row: number }

export type ParsedUiScrollRequest =
  | {
      ok: true
      component: UiScrollSite
      instanceId: string
      offset: number
      by: number
      bodyRows: number
      contentRows: number
      surface: UiAttachSurface
      pointer?: UiScrollPointer
      keyed?: readonly UiRenderKeyedRow[]
      clientId?: string
    }
  | { ok: false; error: string }

export type UiFocusElement = { plugin: string; key: string }

export type ParsedUiFocusRequest =
  | {
      ok: true
      component: UiScrollSite
      instanceId: string
      isHeld: boolean
      surface: UiAttachSurface
      by: UiFocusBy
      element?: UiFocusElement | null
      clientId?: string
    }
  | { ok: false; error: string }

export type ParsedUiClientModuleRequest =
  | { ok: true; plugin: string }
  | { ok: false; error: string }

export type UiClientPressEvent =
  | { type: 'press' }
  | { type: 'input'; kind: UiInputKind; value: string }
  | { type: 'select'; value: string }

export type ParsedUiClientPressRequest =
  | {
      ok: true
      plugin: string
      component: UiRenderSite
      instanceId: string
      client: string
      module: string
      element: string
      event: UiClientPressEvent
    }
  | { ok: false; error: string }

export type ParsedUiMessageRequest =
  | {
      ok: true
      plugin: string
      component: UiRenderSite
      instanceId: string
      client: string
      module: string
      data: unknown
    }
  | { ok: false; error: string }

export type ParsedUiClientFaultRequest =
  | {
      ok: true
      plugin: string
      component: UiRenderSite
      instanceId: string
      client: string
      module: string
      phase: UiClientFaultPhase
      reason: string
    }
  | { ok: false; error: string }

const clients = new Map<string, SurfaceViewportClient>()
const detachSignal = createSignal<[clientId: string]>()

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function parseViewport(
  rawViewport: unknown,
  error: string,
): SurfaceViewport | { error: string } | undefined {
  if (rawViewport === undefined) return undefined
  if (rawViewport === null || typeof rawViewport !== 'object') {
    return { error }
  }
  const raw = rawViewport as Record<string, unknown>
  if (!isPositiveInt(raw.columns) || !isPositiveInt(raw.rows)) {
    return { error }
  }
  if (raw.isFullscreen !== undefined && typeof raw.isFullscreen !== 'boolean') {
    return { error }
  }
  return {
    columns: raw.columns,
    rows: raw.rows,
    ...(Object.hasOwn(raw, 'isFullscreen') && {
      isFullscreen: raw.isFullscreen as boolean,
    }),
  }
}

/**
 * densable `jAn().safeParse` for CLI `control_request` `ui_attach`.
 */
export function parseUiAttachControlRequest(
  request: Record<string, unknown>,
): ParsedUiAttachRequest {
  const surface = request.surface
  if (
    typeof surface !== 'string' ||
    !(UI_ATTACH_SURFACES as readonly string[]).includes(surface)
  ) {
    return { ok: false, error: UI_ATTACH_PARSE_ERROR }
  }
  const clientId = request.client_id
  if (typeof clientId !== 'string' || !UI_ATTACH_CLIENT_ID.test(clientId)) {
    return { ok: false, error: UI_ATTACH_PARSE_ERROR }
  }
  const viewportParsed = parseViewport(request.viewport, UI_ATTACH_PARSE_ERROR)
  if (viewportParsed && 'error' in viewportParsed) {
    return { ok: false, error: viewportParsed.error }
  }
  const viewport = viewportParsed
  let answers: readonly UiAttachAnswer[] | undefined
  if (request.answers !== undefined) {
    if (!Array.isArray(request.answers)) {
      return { ok: false, error: UI_ATTACH_PARSE_ERROR }
    }
    if (request.answers.length > UI_ATTACH_ANSWERS.length) {
      return { ok: false, error: UI_ATTACH_PARSE_ERROR }
    }
    const allowed = new Set<string>(UI_ATTACH_ANSWERS)
    const parsed: UiAttachAnswer[] = []
    for (const item of request.answers) {
      if (typeof item !== 'string' || !allowed.has(item)) {
        return { ok: false, error: UI_ATTACH_PARSE_ERROR }
      }
      parsed.push(item as UiAttachAnswer)
    }
    answers = parsed
  }
  return {
    ok: true,
    surface,
    clientId,
    ...(viewport !== undefined && { viewport }),
    ...(answers !== undefined && { answers }),
  }
}

/**
 * densable `WAn().safeParse` for CLI `control_request` `ui_detach`.
 */
export function parseUiDetachControlRequest(
  request: Record<string, unknown>,
): ParsedUiDetachRequest {
  const clientId = request.client_id
  if (typeof clientId !== 'string' || !UI_ATTACH_CLIENT_ID.test(clientId)) {
    return { ok: false, error: UI_DETACH_PARSE_ERROR }
  }
  return { ok: true, clientId }
}

function parseOnScreen(
  rawOnScreen: unknown,
): UiRenderOnScreen | null | { error: string } | undefined {
  if (rawOnScreen === undefined) return undefined
  if (rawOnScreen === null) return null
  if (typeof rawOnScreen !== 'object') {
    return { error: UI_RENDER_PARSE_ERROR }
  }
  const raw = rawOnScreen as Record<string, unknown>
  if (
    !isNonNegativeInt(raw.first) ||
    !isNonNegativeInt(raw.last) ||
    !isPositiveInt(raw.of)
  ) {
    return { error: UI_RENDER_PARSE_ERROR }
  }
  if (!(raw.first <= raw.last && raw.last < raw.of)) {
    return { error: UI_RENDER_PARSE_ERROR }
  }
  return { first: raw.first, last: raw.last, of: raw.of }
}

function parseKeyed(
  rawKeyed: unknown,
  error: string = UI_RENDER_PARSE_ERROR,
): readonly UiRenderKeyedRow[] | { error: string } | undefined {
  if (rawKeyed === undefined) return undefined
  if (!Array.isArray(rawKeyed) || rawKeyed.length > UI_RENDER_KEYED_MAX) {
    return { error }
  }
  const parsed: UiRenderKeyedRow[] = []
  for (const item of rawKeyed) {
    if (item === null || typeof item !== 'object') {
      return { error }
    }
    const row = item as Record<string, unknown>
    if (
      typeof row.plugin !== 'string' ||
      row.plugin.length > UI_RENDER_KEYED_STRING_MAX ||
      typeof row.key !== 'string' ||
      row.key.length > UI_RENDER_KEYED_STRING_MAX ||
      !isNonNegativeInt(row.top) ||
      !isNonNegativeInt(row.bottom)
    ) {
      return { error }
    }
    parsed.push({
      plugin: row.plugin,
      key: row.key,
      top: row.top,
      bottom: row.bottom,
    })
  }
  return parsed
}

function parseBench(
  rawBench: unknown,
): UiRenderBench | { error: string } | undefined {
  if (rawBench === undefined) return undefined
  if (rawBench === null || typeof rawBench !== 'object') {
    return { error: UI_RENDER_PARSE_ERROR }
  }
  const raw = rawBench as Record<string, unknown>
  if (!isInt(raw.seq) || typeof raw.t0 !== 'number' || Number.isNaN(raw.t0)) {
    return { error: UI_RENDER_PARSE_ERROR }
  }
  return { seq: raw.seq, t0: raw.t0 }
}

/**
 * densable `GAn().safeParse` for CLI `control_request` `ui_render`.
 */
export function parseUiRenderControlRequest(
  request: Record<string, unknown>,
): ParsedUiRenderRequest {
  const surface = request.surface
  if (
    typeof surface !== 'string' ||
    !(UI_ATTACH_SURFACES as readonly string[]).includes(surface)
  ) {
    return { ok: false, error: UI_RENDER_PARSE_ERROR }
  }
  const component = request.component
  if (
    typeof component !== 'string' ||
    !(UI_RENDER_SITES as readonly string[]).includes(component)
  ) {
    return { ok: false, error: UI_RENDER_PARSE_ERROR }
  }
  const instanceId = request.instance_id
  if (typeof instanceId !== 'string') {
    return { ok: false, error: UI_RENDER_PARSE_ERROR }
  }
  if (
    request.props === null ||
    typeof request.props !== 'object' ||
    Array.isArray(request.props)
  ) {
    return { ok: false, error: UI_RENDER_PARSE_ERROR }
  }
  let clientId: string | undefined
  if (request.client_id !== undefined) {
    if (
      typeof request.client_id !== 'string' ||
      !UI_ATTACH_CLIENT_ID.test(request.client_id)
    ) {
      return { ok: false, error: UI_RENDER_PARSE_ERROR }
    }
    clientId = request.client_id
  }
  const viewportParsed = parseViewport(request.viewport, UI_RENDER_PARSE_ERROR)
  if (viewportParsed && 'error' in viewportParsed) {
    return { ok: false, error: viewportParsed.error }
  }
  const onScreenParsed = parseOnScreen(request.on_screen)
  if (
    onScreenParsed &&
    typeof onScreenParsed === 'object' &&
    'error' in onScreenParsed
  ) {
    return { ok: false, error: onScreenParsed.error }
  }
  let contentRows: number | undefined
  if (request.content_rows !== undefined) {
    if (!isNonNegativeInt(request.content_rows)) {
      return { ok: false, error: UI_RENDER_PARSE_ERROR }
    }
    contentRows = request.content_rows
  }
  const keyedParsed = parseKeyed(request.keyed)
  if (keyedParsed && 'error' in keyedParsed) {
    return { ok: false, error: keyedParsed.error }
  }
  const benchParsed = parseBench(request.bench)
  if (benchParsed && 'error' in benchParsed) {
    return { ok: false, error: benchParsed.error }
  }
  return {
    ok: true,
    surface,
    component: component as UiRenderSite,
    instanceId,
    props: request.props as Record<string, unknown>,
    ...(clientId !== undefined && { clientId }),
    ...(viewportParsed !== undefined && { viewport: viewportParsed }),
    ...(onScreenParsed !== undefined && { onScreen: onScreenParsed }),
    ...(contentRows !== undefined && { contentRows }),
    ...(keyedParsed !== undefined && { keyed: keyedParsed }),
    ...(benchParsed !== undefined && { bench: benchParsed }),
  }
}

const UI_INPUT_KINDS = ['change', 'submit'] as const
const UI_PROMPT_EDIT_BY = ['person', 'app'] as const

function parseOptionalSurface(
  raw: unknown,
  error: string,
): UiAttachSurface | { error: string } {
  if (raw === undefined) return 'desktop'
  if (
    typeof raw !== 'string' ||
    !(UI_ATTACH_SURFACES as readonly string[]).includes(raw)
  ) {
    return { error }
  }
  return raw as UiAttachSurface
}

function parseOptionalClientId(
  raw: unknown,
  error: string,
): string | undefined | { error: string } {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !UI_ATTACH_CLIENT_ID.test(raw)) {
    return { error }
  }
  return raw
}

function parseOptionalRenderSite(
  raw: unknown,
  error: string,
): UiRenderSite | undefined | { error: string } {
  if (raw === undefined) return undefined
  if (
    typeof raw !== 'string' ||
    !(UI_RENDER_SITES as readonly string[]).includes(raw)
  ) {
    return { error }
  }
  return raw as UiRenderSite
}

function parseOptionalElementKey(
  raw: unknown,
  error: string,
): string | undefined | { error: string } {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') return { error }
  return raw
}

function parseOptionalInstanceId(
  raw: unknown,
  error: string,
): string | undefined | { error: string } {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || raw.length > UI_RENDER_KEYED_STRING_MAX) {
    return { error }
  }
  return raw
}

function parsePromptEditKey(
  raw: unknown,
): UiPromptEditKey | undefined | { error: string } {
  if (raw === undefined) return undefined
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: UI_PROMPT_EDIT_PARSE_ERROR }
  }
  const rec = raw as Record<string, unknown>
  if (
    typeof rec.key !== 'string' ||
    rec.key.length < 1 ||
    rec.key.length > UI_PROMPT_EDIT_KEY_MAX
  ) {
    return { error: UI_PROMPT_EDIT_PARSE_ERROR }
  }
  for (const mod of ['ctrl', 'shift', 'meta'] as const) {
    if (rec[mod] !== undefined && rec[mod] !== true) {
      return { error: UI_PROMPT_EDIT_PARSE_ERROR }
    }
  }
  return {
    key: rec.key,
    ...(rec.ctrl === true && { ctrl: true as const }),
    ...(rec.shift === true && { shift: true as const }),
    ...(rec.meta === true && { meta: true as const }),
  }
}

/**
 * densable `zAn().safeParse` for CLI `control_request` `ui_press`.
 */
export function parseUiPressControlRequest(
  request: Record<string, unknown>,
): ParsedUiPressRequest {
  if (typeof request.plugin !== 'string') {
    return { ok: false, error: UI_PRESS_PARSE_ERROR }
  }
  if (!isInt(request.handle)) {
    return { ok: false, error: UI_PRESS_PARSE_ERROR }
  }
  const key = parseOptionalElementKey(request.key, UI_PRESS_PARSE_ERROR)
  if (key && typeof key === 'object' && 'error' in key) {
    return { ok: false, error: key.error }
  }
  const surface = parseOptionalSurface(request.surface, UI_PRESS_PARSE_ERROR)
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  let href: string | undefined
  if (request.href !== undefined) {
    if (
      typeof request.href !== 'string' ||
      request.href.length > UI_PRESS_HREF_MAX
    ) {
      return { ok: false, error: UI_PRESS_PARSE_ERROR }
    }
    href = request.href
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_PRESS_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    plugin: request.plugin,
    handle: request.handle,
    surface,
    ...(key !== undefined && { key }),
    ...(href !== undefined && { href }),
    ...(clientId !== undefined && { clientId }),
  }
}

/**
 * densable `XAn().safeParse` for CLI `control_request` `ui_input`.
 */
export function parseUiInputControlRequest(
  request: Record<string, unknown>,
): ParsedUiInputRequest {
  if (
    typeof request.plugin !== 'string' ||
    request.plugin.length > UI_RENDER_KEYED_STRING_MAX
  ) {
    return { ok: false, error: UI_INPUT_PARSE_ERROR }
  }
  if (!isInt(request.handle)) {
    return { ok: false, error: UI_INPUT_PARSE_ERROR }
  }
  const kind = request.kind
  if (
    typeof kind !== 'string' ||
    !(UI_INPUT_KINDS as readonly string[]).includes(kind)
  ) {
    return { ok: false, error: UI_INPUT_PARSE_ERROR }
  }
  if (
    typeof request.value !== 'string' ||
    request.value.length > UI_INPUT_VALUE_MAX
  ) {
    return { ok: false, error: UI_INPUT_PARSE_ERROR }
  }
  const key = parseOptionalElementKey(request.key, UI_INPUT_PARSE_ERROR)
  if (key && typeof key === 'object' && 'error' in key) {
    return { ok: false, error: key.error }
  }
  const component = parseOptionalRenderSite(
    request.component,
    UI_INPUT_PARSE_ERROR,
  )
  if (component && typeof component === 'object' && 'error' in component) {
    return { ok: false, error: component.error }
  }
  const instanceId = parseOptionalInstanceId(
    request.instance_id,
    UI_INPUT_PARSE_ERROR,
  )
  if (instanceId && typeof instanceId === 'object' && 'error' in instanceId) {
    return { ok: false, error: instanceId.error }
  }
  const surface = parseOptionalSurface(request.surface, UI_INPUT_PARSE_ERROR)
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_INPUT_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    plugin: request.plugin,
    handle: request.handle,
    kind: kind as UiInputKind,
    value: request.value,
    surface,
    ...(key !== undefined && { key }),
    ...(component !== undefined && { component }),
    ...(instanceId !== undefined && { instanceId }),
    ...(clientId !== undefined && { clientId }),
  }
}

/**
 * densable `JAn().safeParse` for CLI `control_request` `ui_select`.
 */
export function parseUiSelectControlRequest(
  request: Record<string, unknown>,
): ParsedUiSelectRequest {
  if (
    typeof request.plugin !== 'string' ||
    request.plugin.length > UI_RENDER_KEYED_STRING_MAX
  ) {
    return { ok: false, error: UI_SELECT_PARSE_ERROR }
  }
  if (!isInt(request.handle)) {
    return { ok: false, error: UI_SELECT_PARSE_ERROR }
  }
  if (
    typeof request.value !== 'string' ||
    request.value.length > UI_INPUT_VALUE_MAX
  ) {
    return { ok: false, error: UI_SELECT_PARSE_ERROR }
  }
  const key = parseOptionalElementKey(request.key, UI_SELECT_PARSE_ERROR)
  if (key && typeof key === 'object' && 'error' in key) {
    return { ok: false, error: key.error }
  }
  const component = parseOptionalRenderSite(
    request.component,
    UI_SELECT_PARSE_ERROR,
  )
  if (component && typeof component === 'object' && 'error' in component) {
    return { ok: false, error: component.error }
  }
  const instanceId = parseOptionalInstanceId(
    request.instance_id,
    UI_SELECT_PARSE_ERROR,
  )
  if (instanceId && typeof instanceId === 'object' && 'error' in instanceId) {
    return { ok: false, error: instanceId.error }
  }
  const surface = parseOptionalSurface(request.surface, UI_SELECT_PARSE_ERROR)
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_SELECT_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    plugin: request.plugin,
    handle: request.handle,
    value: request.value,
    surface,
    ...(key !== undefined && { key }),
    ...(component !== undefined && { component }),
    ...(instanceId !== undefined && { instanceId }),
    ...(clientId !== undefined && { clientId }),
  }
}

/**
 * densable `okn().safeParse` for CLI `control_request` `ui_prompt_edit`.
 */
export function parseUiPromptEditControlRequest(
  request: Record<string, unknown>,
): ParsedUiPromptEditRequest {
  if (
    typeof request.text !== 'string' ||
    request.text.length > UI_PROMPT_EDIT_TEXT_MAX
  ) {
    return { ok: false, error: UI_PROMPT_EDIT_PARSE_ERROR }
  }
  if (!isNonNegativeInt(request.cursor)) {
    return { ok: false, error: UI_PROMPT_EDIT_PARSE_ERROR }
  }
  const key = parsePromptEditKey(request.key)
  if (key && typeof key === 'object' && 'error' in key) {
    return { ok: false, error: key.error }
  }
  let by: UiPromptEditBy = 'person'
  if (request.by !== undefined) {
    if (
      typeof request.by !== 'string' ||
      !(UI_PROMPT_EDIT_BY as readonly string[]).includes(request.by)
    ) {
      return { ok: false, error: UI_PROMPT_EDIT_PARSE_ERROR }
    }
    by = request.by as UiPromptEditBy
  }
  const surface = parseOptionalSurface(
    request.surface,
    UI_PROMPT_EDIT_PARSE_ERROR,
  )
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_PROMPT_EDIT_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    text: request.text,
    cursor: request.cursor,
    surface,
    by,
    ...(key !== undefined && { key }),
    ...(clientId !== undefined && { clientId }),
  }
}

function parsePaneWireId(
  raw: unknown,
  error: string,
): string | { error: string } {
  if (typeof raw !== 'string' || !UI_PANE_WIRE_ID.test(raw)) {
    return { error }
  }
  return raw
}

function parseScrollSite(
  raw: unknown,
  error: string,
): UiScrollSite | { error: string } {
  if (
    typeof raw !== 'string' ||
    !(UI_SCROLL_SITES as readonly string[]).includes(raw)
  ) {
    return { error }
  }
  return raw as UiScrollSite
}

function parseRequiredRenderSite(
  raw: unknown,
  error: string,
): UiRenderSite | { error: string } {
  if (
    typeof raw !== 'string' ||
    !(UI_RENDER_SITES as readonly string[]).includes(raw)
  ) {
    return { error }
  }
  return raw as UiRenderSite
}

function parseRequiredBoundedString(
  raw: unknown,
  error: string,
  max: number = UI_RENDER_KEYED_STRING_MAX,
): string | { error: string } {
  if (typeof raw !== 'string' || raw.length > max) {
    return { error }
  }
  return raw
}

function parseClientAddress(
  request: Record<string, unknown>,
  error: string,
):
  | {
      plugin: string
      component: UiRenderSite
      instanceId: string
      client: string
      module: string
    }
  | { error: string } {
  const plugin = parseRequiredBoundedString(request.plugin, error)
  if (typeof plugin !== 'string') return plugin
  const component = parseRequiredRenderSite(request.component, error)
  if (typeof component !== 'string') return component
  const instanceId = parseRequiredBoundedString(request.instance_id, error)
  if (typeof instanceId !== 'string') return instanceId
  const client = parseRequiredBoundedString(request.client, error)
  if (typeof client !== 'string') return client
  const module = parseRequiredBoundedString(request.module, error)
  if (typeof module !== 'string') return module
  return { plugin, component, instanceId, client, module }
}

/**
 * densable `QAn().safeParse` for CLI `control_request` `ui_panes`.
 */
export function parseUiPanesControlRequest(
  request: Record<string, unknown>,
): ParsedUiPanesRequest {
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_PANES_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return { ok: true, ...(clientId !== undefined && { clientId }) }
}

/**
 * densable `ZAn().safeParse` for CLI `control_request` `ui_pane_show`.
 */
export function parseUiPaneShowControlRequest(
  request: Record<string, unknown>,
): ParsedUiPaneShowRequest {
  const id = parsePaneWireId(request.id, UI_PANE_SHOW_PARSE_ERROR)
  if (typeof id !== 'string') return { ok: false, error: id.error }
  const surface = parseOptionalSurface(
    request.surface,
    UI_PANE_SHOW_PARSE_ERROR,
  )
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_PANE_SHOW_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    id,
    surface,
    ...(clientId !== undefined && { clientId }),
  }
}

/**
 * densable `ekn().safeParse` for CLI `control_request` `ui_pane_focus`.
 */
export function parseUiPaneFocusControlRequest(
  request: Record<string, unknown>,
): ParsedUiPaneFocusRequest {
  let id: string | null
  if (request.id === null) {
    id = null
  } else {
    const parsed = parsePaneWireId(request.id, UI_PANE_FOCUS_PARSE_ERROR)
    if (typeof parsed !== 'string') {
      return { ok: false, error: parsed.error }
    }
    id = parsed
  }
  const surface = parseOptionalSurface(
    request.surface,
    UI_PANE_FOCUS_PARSE_ERROR,
  )
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_PANE_FOCUS_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    id,
    surface,
    ...(clientId !== undefined && { clientId }),
  }
}

/**
 * densable `tkn().safeParse` for CLI `control_request` `ui_close`.
 */
export function parseUiCloseControlRequest(
  request: Record<string, unknown>,
): ParsedUiCloseRequest {
  const id = parsePaneWireId(request.id, UI_CLOSE_PARSE_ERROR)
  if (typeof id !== 'string') return { ok: false, error: id.error }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_CLOSE_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return { ok: true, id, ...(clientId !== undefined && { clientId }) }
}

/**
 * densable `nkn().safeParse` for CLI `control_request` `ui_scroll`.
 */
export function parseUiScrollControlRequest(
  request: Record<string, unknown>,
): ParsedUiScrollRequest {
  const component = parseScrollSite(request.component, UI_SCROLL_PARSE_ERROR)
  if (typeof component !== 'string') {
    return { ok: false, error: component.error }
  }
  if (
    typeof request.instance_id !== 'string' ||
    request.instance_id.length > UI_RENDER_KEYED_STRING_MAX
  ) {
    return { ok: false, error: UI_SCROLL_PARSE_ERROR }
  }
  if (
    !isNonNegativeInt(request.offset) ||
    !isInt(request.by) ||
    !isNonNegativeInt(request.body_rows) ||
    !isNonNegativeInt(request.content_rows)
  ) {
    return { ok: false, error: UI_SCROLL_PARSE_ERROR }
  }
  let pointer: UiScrollPointer | undefined
  if (request.pointer !== undefined) {
    if (request.pointer === null || typeof request.pointer !== 'object') {
      return { ok: false, error: UI_SCROLL_PARSE_ERROR }
    }
    const raw = request.pointer as Record<string, unknown>
    if (!isInt(raw.column) || !isInt(raw.row)) {
      return { ok: false, error: UI_SCROLL_PARSE_ERROR }
    }
    pointer = { column: raw.column, row: raw.row }
  }
  const keyed = parseKeyed(request.keyed, UI_SCROLL_PARSE_ERROR)
  if (keyed && 'error' in keyed) {
    return { ok: false, error: keyed.error }
  }
  const surface = parseOptionalSurface(request.surface, UI_SCROLL_PARSE_ERROR)
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_SCROLL_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    component,
    instanceId: request.instance_id,
    offset: request.offset,
    by: request.by,
    bodyRows: request.body_rows,
    contentRows: request.content_rows,
    surface,
    ...(pointer !== undefined && { pointer }),
    ...(keyed !== undefined && { keyed }),
    ...(clientId !== undefined && { clientId }),
  }
}

/**
 * densable `rkn().safeParse` for CLI `control_request` `ui_focus`.
 */
export function parseUiFocusControlRequest(
  request: Record<string, unknown>,
): ParsedUiFocusRequest {
  const component = parseScrollSite(request.component, UI_FOCUS_PARSE_ERROR)
  if (typeof component !== 'string') {
    return { ok: false, error: component.error }
  }
  if (
    typeof request.instance_id !== 'string' ||
    request.instance_id.length > UI_RENDER_KEYED_STRING_MAX
  ) {
    return { ok: false, error: UI_FOCUS_PARSE_ERROR }
  }
  if (typeof request.is_held !== 'boolean') {
    return { ok: false, error: UI_FOCUS_PARSE_ERROR }
  }
  let element: UiFocusElement | null | undefined
  if (request.element === null) {
    element = null
  } else if (request.element !== undefined) {
    if (typeof request.element !== 'object') {
      return { ok: false, error: UI_FOCUS_PARSE_ERROR }
    }
    const raw = request.element as Record<string, unknown>
    if (
      typeof raw.plugin !== 'string' ||
      raw.plugin.length > UI_RENDER_KEYED_STRING_MAX ||
      typeof raw.key !== 'string' ||
      raw.key.length > UI_RENDER_KEYED_STRING_MAX
    ) {
      return { ok: false, error: UI_FOCUS_PARSE_ERROR }
    }
    element = { plugin: raw.plugin, key: raw.key }
  }
  let by: UiFocusBy = 'person'
  if (request.by !== undefined) {
    if (
      typeof request.by !== 'string' ||
      !(UI_FOCUS_BY as readonly string[]).includes(request.by)
    ) {
      return { ok: false, error: UI_FOCUS_PARSE_ERROR }
    }
    by = request.by as UiFocusBy
  }
  const surface = parseOptionalSurface(request.surface, UI_FOCUS_PARSE_ERROR)
  if (typeof surface !== 'string') {
    return { ok: false, error: surface.error }
  }
  const clientId = parseOptionalClientId(
    request.client_id,
    UI_FOCUS_PARSE_ERROR,
  )
  if (clientId && typeof clientId === 'object' && 'error' in clientId) {
    return { ok: false, error: clientId.error }
  }
  return {
    ok: true,
    component,
    instanceId: request.instance_id,
    isHeld: request.is_held,
    surface,
    by,
    ...(element !== undefined && { element }),
    ...(clientId !== undefined && { clientId }),
  }
}

/**
 * densable `VAn().safeParse` for CLI `control_request` `ui_client_module`.
 */
export function parseUiClientModuleControlRequest(
  request: Record<string, unknown>,
): ParsedUiClientModuleRequest {
  if (typeof request.plugin !== 'string') {
    return { ok: false, error: UI_CLIENT_MODULE_PARSE_ERROR }
  }
  return { ok: true, plugin: request.plugin }
}

function parseClientPressEvent(
  raw: unknown,
): UiClientPressEvent | { error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: UI_CLIENT_PRESS_PARSE_ERROR }
  }
  const rec = raw as Record<string, unknown>
  if (rec.type === 'press') {
    return { type: 'press' }
  }
  if (rec.type === 'input') {
    if (
      (rec.kind !== 'change' && rec.kind !== 'submit') ||
      typeof rec.value !== 'string' ||
      rec.value.length > UI_INPUT_VALUE_MAX
    ) {
      return { error: UI_CLIENT_PRESS_PARSE_ERROR }
    }
    return { type: 'input', kind: rec.kind, value: rec.value }
  }
  if (rec.type === 'select') {
    if (
      typeof rec.value !== 'string' ||
      rec.value.length > UI_INPUT_VALUE_MAX
    ) {
      return { error: UI_CLIENT_PRESS_PARSE_ERROR }
    }
    return { type: 'select', value: rec.value }
  }
  return { error: UI_CLIENT_PRESS_PARSE_ERROR }
}

/**
 * densable `qAn().safeParse` for CLI `control_request` `ui_client_press`.
 */
export function parseUiClientPressControlRequest(
  request: Record<string, unknown>,
): ParsedUiClientPressRequest {
  const address = parseClientAddress(request, UI_CLIENT_PRESS_PARSE_ERROR)
  if ('error' in address) return { ok: false, error: address.error }
  const element = parseRequiredBoundedString(
    request.element,
    UI_CLIENT_PRESS_PARSE_ERROR,
  )
  if (typeof element !== 'string') {
    return { ok: false, error: element.error }
  }
  const event = parseClientPressEvent(request.event)
  if ('error' in event) return { ok: false, error: event.error }
  return { ok: true, ...address, element, event }
}

/**
 * densable `KAn().safeParse` for CLI `control_request` `ui_message`.
 */
export function parseUiMessageControlRequest(
  request: Record<string, unknown>,
): ParsedUiMessageRequest {
  const address = parseClientAddress(request, UI_MESSAGE_PARSE_ERROR)
  if ('error' in address) return { ok: false, error: address.error }
  if (!Object.hasOwn(request, 'data')) {
    return { ok: false, error: UI_MESSAGE_PARSE_ERROR }
  }
  return { ok: true, ...address, data: request.data }
}

/**
 * densable `YAn().safeParse` + `yv` for CLI `control_request` `ui_client_fault`.
 */
export function parseUiClientFaultControlRequest(
  request: Record<string, unknown>,
): ParsedUiClientFaultRequest {
  if (typeof request.plugin !== 'string') {
    return { ok: false, error: uiClientFaultYV('plugin', 'Required') }
  }
  if (request.plugin.length > UI_RENDER_KEYED_STRING_MAX) {
    return {
      ok: false,
      error: uiClientFaultYV(
        'plugin',
        `String must contain at most ${UI_RENDER_KEYED_STRING_MAX} character(s)`,
      ),
    }
  }
  const component = parseRequiredRenderSite(
    request.component,
    uiClientFaultYV('component', 'Required'),
  )
  if (typeof component !== 'string') {
    return { ok: false, error: component.error }
  }
  if (typeof request.instance_id !== 'string') {
    return { ok: false, error: uiClientFaultYV('instance_id', 'Required') }
  }
  if (request.instance_id.length > UI_RENDER_KEYED_STRING_MAX) {
    return {
      ok: false,
      error: uiClientFaultYV(
        'instance_id',
        `String must contain at most ${UI_RENDER_KEYED_STRING_MAX} character(s)`,
      ),
    }
  }
  if (typeof request.client !== 'string') {
    return { ok: false, error: uiClientFaultYV('client', 'Required') }
  }
  if (request.client.length > UI_RENDER_KEYED_STRING_MAX) {
    return {
      ok: false,
      error: uiClientFaultYV(
        'client',
        `String must contain at most ${UI_RENDER_KEYED_STRING_MAX} character(s)`,
      ),
    }
  }
  if (typeof request.module !== 'string') {
    return { ok: false, error: uiClientFaultYV('module', 'Required') }
  }
  if (request.module.length > UI_RENDER_KEYED_STRING_MAX) {
    return {
      ok: false,
      error: uiClientFaultYV(
        'module',
        `String must contain at most ${UI_RENDER_KEYED_STRING_MAX} character(s)`,
      ),
    }
  }
  if (
    typeof request.phase !== 'string' ||
    !(UI_CLIENT_FAULT_PHASES as readonly string[]).includes(request.phase)
  ) {
    return {
      ok: false,
      error: uiClientFaultYV(
        'phase',
        `Invalid enum value. Expected 'load' | 'render' | 'run', received ${JSON.stringify(request.phase)}`,
      ),
    }
  }
  if (typeof request.reason !== 'string') {
    return { ok: false, error: uiClientFaultYV('reason', 'Required') }
  }
  if (request.reason.length > UI_CLIENT_FAULT_REASON_MAX) {
    return {
      ok: false,
      error: uiClientFaultYV(
        'reason',
        `String must contain at most ${UI_CLIENT_FAULT_REASON_MAX} character(s)`,
      ),
    }
  }
  return {
    ok: true,
    plugin: request.plugin,
    component,
    instanceId: request.instance_id,
    client: request.client,
    module: request.module,
    phase: request.phase as UiClientFaultPhase,
    reason: request.reason,
  }
}

/**
 * densable `hrt` — engine default client when `ui_render` omits `client_id`.
 * Wire ids cannot spell the colon (`xW`).
 */
export function defaultClientIdForSurface(surface: string): string {
  return `${surface}:default`
}

/**
 * densable `ae().attach` — first attach returns true; later viewport/answers merge
 * returns false. Repeat merge does **not** spread a new surface/clientId
 * (gold `{...i, viewport?, answers?}`).
 */
export function attachSurfaceViewportClient(
  client: SurfaceViewportClient,
): boolean {
  const prior = clients.get(client.clientId)
  if (prior === undefined) {
    clients.set(client.clientId, { ...client })
    return true
  }
  if (client.viewport !== undefined || client.answers !== undefined) {
    clients.set(client.clientId, {
      ...prior,
      ...(client.viewport !== undefined && {
        viewport: { ...prior.viewport, ...client.viewport },
      }),
      ...(client.answers !== undefined && { answers: client.answers }),
    })
  }
  return false
}

/** densable `ae().detach`. */
export function detachSurfaceViewportClient(
  clientId: string,
): SurfaceViewportClient | undefined {
  const prior = clients.get(clientId)
  if (prior === undefined) return undefined
  clients.delete(clientId)
  detachSignal.emit(clientId)
  return prior
}

/** densable `ae().list`. */
export function listSurfaceViewportClients(): SurfaceViewportClient[] {
  return [...clients.values()]
}

/** densable `ae().hasSurface`. */
export function hasSurfaceViewportClient(surface: string): boolean {
  return listSurfaceViewportClients().some(c => c.surface === surface)
}

/** densable `ae().surfaces`. */
export function listAttachedSurfaces(): string[] {
  return [
    ...new Set(
      listSurfaceViewportClients()
        .map(c => c.surface)
        .filter(Boolean),
    ),
  ]
}

/**
 * densable `Y7` without a bound terminal composer (`px()?.surface==="terminal"`).
 * Remote surfaces in attach order, each once. Terminal is not invented.
 */
export function listDrawingSurfaces(): string[] {
  return listAttachedSurfaces().filter(surface => surface !== 'terminal')
}

/** densable `ae().onDetach`. */
export function onSurfaceViewportClientDetach(
  listener: (clientId: string) => void,
): () => void {
  return detachSignal.subscribe(listener)
}

/** densable `xe` — clients with a viewport object present. */
export function clientsWithViewport(): SurfaceViewportClient[] {
  return listSurfaceViewportClients().filter(c => c.viewport !== undefined)
}

/**
 * densable `Spn` — clients where `viewport.isFullscreen` **key** is present
 * (presence, not truthiness).
 */
export function clientsWithFullscreenKey(): SurfaceViewportClient[] {
  return listSurfaceViewportClients().filter(
    c => c.viewport !== undefined && Object.hasOwn(c.viewport, 'isFullscreen'),
  )
}

/**
 * densable `Epn` — remote placement when terminal columns unknown.
 * - no viewport clients → undefined (caller places)
 * - any fullscreen-key client → placed
 * - else deny with gold reason string
 */
export function placementFromAttachedSurfaces():
  | { isPlaced: true }
  | { isPlaced: false; reason: string }
  | undefined {
  const sized = clientsWithViewport()
  if (sized.length === 0) return undefined
  if (clientsWithFullscreenKey().length > 0) return { isPlaced: true }
  const ids = sized.map(c => c.clientId).join(', ')
  return {
    isPlaced: false,
    reason: `no attached surface places panes (${ids}): placed when a surface that does attaches, or once they detach`,
  }
}

/**
 * densable `Fco` — first `Z1.attach` raises `session.attach`; repeats merge and
 * skip the hook. Hook failure is logged, still true.
 */
export async function attachRemoteUiSurface(
  client: {
    surface: string
    clientId: string
    viewport?: SurfaceViewport
  },
  answers?: unknown,
): Promise<boolean> {
  const first = attachSurfaceViewportClient({
    ...client,
    attachedAt: Date.now(),
    ...(answers !== undefined && { answers }),
  })
  if (!first) return false
  logForDebugging(`session.attach: ${client.clientId} on ${client.surface}`)
  try {
    const { runFunctionHookChain } = await import('./functionHooksModules.js')
    await runFunctionHookChain(
      'session.attach',
      {
        surface: client.surface,
        clientId: client.clientId,
        ...(client.viewport !== undefined && { viewport: client.viewport }),
      },
      async () => {},
    )
  } catch (err) {
    logForDebugging(`session.attach: failed: ${errorMessage(err)}`, {
      level: 'error',
    })
  }
  return true
}

/**
 * densable `U9t` — `Z1.detach` then `session.detach` with reason.
 * Missing client is a no-op (`undefined`). Hook failure is logged.
 */
export async function detachRemoteUiSurface(
  clientId: string,
  reason = 'detach',
): Promise<SurfaceViewportClient | undefined> {
  const prior = detachSurfaceViewportClient(clientId)
  if (prior === undefined) return undefined
  logForDebugging(`session.detach: ${clientId} (${reason})`)
  try {
    const { runFunctionHookChain } = await import('./functionHooksModules.js')
    await runFunctionHookChain(
      'session.detach',
      {
        surface: prior.surface,
        clientId,
        reason,
      },
      async () => {},
    )
  } catch (err) {
    logForDebugging(`session.detach: failed: ${errorMessage(err)}`, {
      level: 'error',
    })
  }
  return prior
}

/** Test / dispose — clear registry. */
export function resetSurfaceViewportClientsForTests(): void {
  clients.clear()
  detachSignal.clear()
}
