/**
 * Function hooks submodule: uiValidation
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { isG2eComponent } from '../pluginSiteHold.js'
import { isProxy } from 'node:util/types'
import {
  ENGINE_ALONE_UI_RENDER,
  UI_RENDER_COMPONENTS,
  UI_RENDER_COMPONENT_SURFACES,
  UI_SURFACES,
  UI_SURFACE_NAMES,
  isEventRecord,
} from './constants.js'
import type { HoverScopeKind } from './types.js'

export function isEngineDrawing(value: unknown): boolean {
  return isEventRecord(value) && value.type === 'engine'
}

export function pluginFromDrawing(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = pluginFromDrawing(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isEventRecord(node)) return undefined
  const raster = isEventRecord(node.raster) ? node.raster : undefined
  if (typeof raster?.plugin === 'string' && raster.plugin !== '') {
    return raster.plugin
  }
  const image = isEventRecord(node.image) ? node.image : undefined
  if (typeof image?.plugin === 'string' && image.plugin !== '') {
    return image.plugin
  }
  const press = isEventRecord(node.press) ? node.press : undefined
  if (typeof press?.plugin === 'string' && press.plugin !== '') {
    return press.plugin
  }
  const client = isEventRecord(node.client) ? node.client : undefined
  if (typeof client?.plugin === 'string' && client.plugin !== '') {
    return client.plugin
  }
  if (node.children !== undefined) return pluginFromDrawing(node.children)
  return undefined
}

const UI_RENDER_SHORT_STRING_MAX = 256 // XTo

const UI_RENDER_PROP_BUDGET = 100_000 // yVt

const UI_RENDER_PROP_MAX_DEPTH = 32 // Kke

function createUiRenderPropBudget() {
  let remaining = UI_RENDER_PROP_BUDGET
  let written = 0
  let drawn = 0
  let markedCut = false
  let wasCut = false
  return {
    written: () => written,
    drawn: () => drawn,
    isCut: () => wasCut,
    shown: (value: string, sep: string): string => {
      written += value.length
      if (value.length <= remaining) {
        remaining -= value.length
        drawn += value.length
        return value
      }
      const cut = value.slice(0, remaining)
      const firstCut = !markedCut
      drawn += cut.length
      remaining = 0
      markedCut = true
      wasCut = true
      return firstCut
        ? `${cut}${sep}… (${value.length - cut.length} more chars)`
        : cut
    },
  }
}

function measureShortStringsAndKeys(value: unknown, depth: number): number {
  if (typeof value === 'string') {
    return value.length <= UI_RENDER_SHORT_STRING_MAX ? value.length : 0
  }
  const isArr = Array.isArray(value)
  if (!isArr && !isEventRecord(value)) return 0
  if (depth > UI_RENDER_PROP_MAX_DEPTH) return Infinity
  if (isArr) {
    return value.reduce(
      (sum: number, item) => sum + measureShortStringsAndKeys(item, depth + 1),
      0,
    )
  }
  return Object.entries(value).reduce(
    (sum, [key, val]) =>
      sum + key.length + measureShortStringsAndKeys(val, depth + 1),
    0,
  )
}

function clipLongPropStrings(
  value: unknown,
  budget: ReturnType<typeof createUiRenderPropBudget>,
): unknown {
  if (typeof value === 'string') {
    return value.length <= UI_RENDER_SHORT_STRING_MAX
      ? value
      : budget.shown(value, ' ')
  }
  if (Array.isArray(value)) {
    const mapped = value.map(item => clipLongPropStrings(item, budget))
    return mapped.every((m, i) => m === value[i]) ? value : mapped
  }
  if (!isEventRecord(value)) return value
  const entries = Object.entries(value)
  const mapped = entries.map(
    ([k, v]) => [k, clipLongPropStrings(v, budget)] as const,
  )
  return mapped.every(([, v], i) => v === entries[i]?.[1])
    ? value
    : Object.fromEntries(mapped)
}

function totalPropTextLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) {
    return value.reduce((sum: number, v) => sum + totalPropTextLength(v), 0)
  }
  if (isEventRecord(value)) {
    return Object.entries(value).reduce(
      (sum, [k, v]) => sum + k.length + totalPropTextLength(v),
      0,
    )
  }
  return 0
}

/**
 * Official `EQi` — clip rewritten `ui.render` engine props > 256 chars under
 * the 100k prop budget, or restore original props when short strings/keys
 * exceed 100k or nesting exceeds 32.
 */
export function clipRewrittenUiRenderProps(
  tree: Record<string, unknown>,
  input: Record<string, unknown>,
  component: string,
): Record<string, unknown> {
  const treeProps = isEventRecord(tree.props) ? tree.props : undefined
  const origProps = isEventRecord(input.props) ? input.props : undefined
  if (!treeProps || !origProps) return tree
  const budget = createUiRenderPropBudget()
  const changes: Array<{ key: string; drawn: unknown; isOwn: boolean }> = []
  for (const [key, val] of Object.entries(treeProps)) {
    if (
      val === origProps[key] ||
      totalPropTextLength(val) <= totalPropTextLength(origProps[key])
    ) {
      continue
    }
    const isOwn = measureShortStringsAndKeys(val, 0) > UI_RENDER_PROP_BUDGET
    const drawn = isOwn ? origProps[key] : clipLongPropStrings(val, budget)
    if (drawn !== val) {
      changes.push({ key, drawn, isOwn })
    }
  }
  if (budget.isCut()) {
    logForDebugging(
      `ui.render (${component}): ${budget.written()} characters of text are drawn up to the first ${UI_RENDER_PROP_BUDGET}`,
      { level: 'warn' },
    )
  }
  const ownNames = changes.filter(c => c.isOwn).map(c => c.key)
  if (ownNames.length > 0) {
    logForDebugging(
      `ui.render (${component}): props.${ownNames.join(', props.')} rewritten with more than ${UI_RENDER_PROP_BUDGET} characters of keys and short strings, or nested past ${UI_RENDER_PROP_MAX_DEPTH} deep; the engine's own is drawn`,
      { level: 'warn' },
    )
  }
  if (changes.length === 0) return tree
  return {
    ...tree,
    props: {
      ...treeProps,
      ...Object.fromEntries(changes.map(c => [c.key, c.drawn])),
    },
  }
}

/**
 * Official `S8s` — valid theme color / name / hex pattern for `color`,
 * `backgroundColor`, and `borderColor` props.
 */
const THEME_COLOR_PROP_RE = /^[#a-zA-Z0-9_().,% -]{1,40}$/

function isValidThemeColorProp(value: unknown): boolean {
  return typeof value === 'string' && THEME_COLOR_PROP_RE.test(value)
}

/** densable `DBr` / `tBo` — refusal still lets the engine draw its own. */
export function logUiRenderRefused(component: string, problem: string): void {
  logForDebugging(
    `ui.render (${component}) refused: ${problem}; the engine drew its own`,
  )
}

/** densable q6t — Ink + dashed. Unknown names are stripped (Zmn / qmn). */
const KNOWN_BOX_BORDER_STYLES = new Set([
  'single',
  'double',
  'round',
  'bold',
  'singleDouble',
  'doubleSingle',
  'classic',
  'arrow',
  'dashed',
])

function isUnknownBoxBorderStyle(style: unknown): boolean {
  return typeof style !== 'string' || !KNOWN_BOX_BORDER_STYLES.has(style)
}

/** densable qmn — drop unknown Box borderStyle; the Box is drawn with no border. */
export function stripUnknownBoxBorderStyles(tree: unknown): unknown {
  if (!isEventRecord(tree)) return tree
  if (tree.type !== 'Box' && tree.type !== 'Text' && tree.type !== 'Link') {
    return tree
  }
  const children = Array.isArray(tree.children)
    ? tree.children.map(child =>
        typeof child === 'string' ? child : stripUnknownBoxBorderStyles(child),
      )
    : undefined
  let next: Record<string, unknown> = tree
  if (
    children !== undefined &&
    children.some((child, i) => child !== (tree.children as unknown[])[i])
  ) {
    next = { ...tree, children }
  }
  if (next.type !== 'Box') return next
  const props = isEventRecord(next.props) ? next.props : undefined
  const hover = isEventRecord(next.hover) ? next.hover : undefined
  if (
    props !== undefined &&
    props.borderStyle !== undefined &&
    isUnknownBoxBorderStyle(props.borderStyle)
  ) {
    const { borderStyle: _dropped, ...rest } = props
    next = { ...next, props: rest }
  }
  if (
    hover !== undefined &&
    hover.borderStyle !== undefined &&
    isUnknownBoxBorderStyle(hover.borderStyle)
  ) {
    const { borderStyle: _dropped, ...rest } = hover
    next = { ...next, hover: rest }
  }
  return next
}

/**
 * densable `YXe` / `Meo` — AskUserQuestion rewrite may relabel, not reshape.
 * Invalid rewrite logs unique English and keeps the original questions.
 */
export function acceptAskUserQuestionRewrite(
  tree: unknown,
  input: Record<string, unknown>,
  component: string,
): unknown {
  if (component !== 'AskUserQuestion' || !isEventRecord(tree)) return tree
  const props = isEventRecord(input.props) ? input.props : input
  const original = Array.isArray(props.questions) ? props.questions : undefined
  if (original === undefined) return tree
  const treeProps = isEventRecord(tree.props) ? tree.props : tree
  const rewritten = treeProps.questions
  if (rewritten === original || rewritten === undefined) return tree
  const problem = askUserQuestionRewriteProblem(rewritten, original)
  if (problem === 'schema') {
    logForDebugging(
      `ui.render (AskUserQuestion): rewritten questions do not match the tool's input schema (questions must be a list of questions); drawing the original`,
      { level: 'warn' },
    )
    return restoreAskUserQuestionQuestions(tree, original)
  }
  if (problem !== undefined) {
    logForDebugging(
      `ui.render (AskUserQuestion): a rewrite may relabel the questions but not ${problem}; drawing the original`,
      { level: 'warn' },
    )
    return restoreAskUserQuestionQuestions(tree, original)
  }
  return tree
}

function restoreAskUserQuestionQuestions(
  tree: Record<string, unknown>,
  original: unknown[],
): Record<string, unknown> {
  if (isEventRecord(tree.props)) {
    return { ...tree, props: { ...tree.props, questions: original } }
  }
  return { ...tree, questions: original }
}

function askUserQuestionRewriteProblem(
  rewritten: unknown,
  original: unknown[],
): string | undefined {
  if (!Array.isArray(rewritten)) return 'schema'
  if (rewritten.length !== original.length) {
    return `change how many questions there are (${original.length} asked, ${rewritten.length} drawn)`
  }
  const labelsOf = (question: unknown): string[] => {
    if (!isEventRecord(question) || !Array.isArray(question.options)) return []
    return question.options.map(option =>
      isEventRecord(option) ? String(option.label ?? '') : '',
    )
  }
  const previewsOf = (question: unknown): string[] => {
    if (!isEventRecord(question) || !Array.isArray(question.options)) return []
    return question.options.map(option =>
      isEventRecord(option) ? String(option.preview ?? '') : '',
    )
  }
  const stamp = (values: string[]): string => values.join('\0')
  for (const [index, asked] of original.entries()) {
    const drawn = rewritten[index]
    if (drawn === undefined) return `leave question ${index + 1} out`
    if (!isEventRecord(asked) || !isEventRecord(drawn)) return 'schema'
    if ((drawn.multiSelect ?? false) !== (asked.multiSelect ?? false)) {
      return `change whether question ${index + 1} is multi-select`
    }
    const askedLabels = labelsOf(asked)
    const drawnLabels = labelsOf(drawn)
    if (stamp(drawnLabels) !== stamp(askedLabels)) {
      return `change question ${index + 1}'s options (asked ${stamp(askedLabels)}, drawn ${stamp(drawnLabels)})`
    }
    if (stamp(previewsOf(drawn)) !== stamp(previewsOf(asked))) {
      return `change question ${index + 1}'s previews`
    }
    const text = String(drawn.question ?? '')
    const sameText = (row: unknown, skip: number): boolean => {
      if (skip === index || !isEventRecord(row)) return false
      return String(row.question ?? '') === text
    }
    if (rewritten.some((row, i) => i !== index && sameText(row, i))) {
      return `give two questions one text (${text})`
    }
    if (original.some((row, i) => i !== index && sameText(row, i))) {
      return `give question ${index + 1} another question's text (${text})`
    }
  }
  return undefined
}

export function blitPayload(input: unknown): Record<string, unknown> {
  const rec = isEventRecord(input) ? input : {}
  const size = {
    ...(rec.columns !== undefined && { columns: rec.columns }),
    ...(rec.rows !== undefined && { rows: rec.rows }),
  }
  const cellsOnly =
    isEventRecord(rec) &&
    typeof rec.cells === 'string' &&
    rec.source === undefined
  return cellsOnly
    ? { requestId: rec.requestId, key: rec.key, cells: rec.cells, ...size }
    : {
        requestId: rec.requestId,
        key: rec.key,
        source: rec.source,
        ...(Object.hasOwn(rec, 'cells') && { cells: rec.cells }),
        ...size,
      }
}

/** densable `xZ` — rewrite may not grow a prop past this many characters. */
const UI_RENDER_REWRITE_CHAR_CAP = 100_000

const USER_MESSAGE_PINNED_PROPS = [
  'origin',
  'isExpanded',
  'task',
  'from',
] as const

function uiRenderSame(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null) return left === right
  if (typeof left !== typeof right) return false
  if (typeof left !== 'object') return false
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function uiRenderStringChars(value: unknown): number {
  return uiRenderWalkTokens(value).reduce((sum, part) => sum + part.length, 0)
}

/** densable `Lz` — Hr class-count grow. */
const UI_RENDER_ESCAPE_CLASS = new RegExp(
  `[${String.raw`\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f`}]`,
  'u',
)

const UI_RENDER_PLACEHOLDER_CLASS = new RegExp(
  `[${String.raw`\u{10eeee}`}]`,
  'u',
)

const UI_RENDER_LONE_SURROGATE_CLASS = new RegExp(
  `[${String.raw`\ud800-\udfff`}]`,
  'u',
)

/** densable `Ve` — strings and object keys. */
function uiRenderWalkTokens(value: unknown): string[] {
  switch (typeof value) {
    case 'string':
      return [value]
    case 'object': {
      if (value === null) return []
      if (Array.isArray(value)) {
        return value.flatMap(uiRenderWalkTokens)
      }
      if (!isEventRecord(value)) return []
      return Object.entries(value).flatMap(([key, entry]) => [
        key,
        ...uiRenderWalkTokens(entry),
      ])
    }
    default:
      return []
  }
}

/** densable `ttr` — code points matching a class. */
function uiRenderClassHits(value: unknown, classify: RegExp): number {
  let hits = 0
  for (const part of uiRenderWalkTokens(value)) {
    for (const point of Array.from(part)) {
      if (classify.test(point)) hits += 1
    }
  }
  return hits
}

/** densable `_t` — rewrite grew a class vs the engine. */
function uiRenderClassGrew(
  rewritten: unknown,
  engine: unknown,
  classify: RegExp,
): boolean {
  return (
    uiRenderClassHits(rewritten, classify) > uiRenderClassHits(engine, classify)
  )
}

function uiRenderToolUseIds(calls: unknown): (string | null)[] | undefined {
  if (!Array.isArray(calls)) return undefined
  return calls.map(entry => {
    if (typeof entry === 'string') return entry
    if (isEventRecord(entry) && typeof entry.tool_use_id === 'string') {
      return entry.tool_use_id
    }
    return null
  })
}

function uiRenderPropKind(value: unknown): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (typeof value === 'string') return 'a string'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'boolean') return 'a boolean'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') return 'an object'
  return `a ${typeof value}`
}

const UI_RENDER_ON_SCREEN_KIND = ['an object', 'null', 'missing'] as const

const UI_RENDER_ANY_KIND = '*' as const

/** densable `Mr`. `*` = gold `We` (any type). */
const UI_RENDER_PROP_SCHEMA: Record<
  string,
  Record<string, readonly string[] | typeof UI_RENDER_ANY_KIND>
> = {
  AskUserQuestion: { metadataSource: ['a string', 'missing'] },
  UserMessage: { onScreen: UI_RENDER_ON_SCREEN_KIND },
  AssistantMessage: { onScreen: UI_RENDER_ON_SCREEN_KIND },
  ToolUse: {
    input: UI_RENDER_ANY_KIND,
    output: UI_RENDER_ANY_KIND,
    onScreen: UI_RENDER_ON_SCREEN_KIND,
  },
  ToolResult: {
    output: UI_RENDER_ANY_KIND,
    onScreen: UI_RENDER_ON_SCREEN_KIND,
  },
  ToolGroup: { onScreen: UI_RENDER_ON_SCREEN_KIND },
  CommandOutput: { onScreen: UI_RENDER_ON_SCREEN_KIND },
  Spinner: {
    message: ['a string', 'null'],
    suffix: ['a string', 'missing'],
  },
  TurnDuration: { onScreen: UI_RENDER_ON_SCREEN_KIND },
  InfoNotice: {
    command: ['a string', 'null'],
    onScreen: UI_RENDER_ON_SCREEN_KIND,
  },
  PromptHint: { tail: ['a string', 'missing'] },
}

/**
 * densable `nn` / `Yr`/`Jr`/`qr`/`Qr`/`en`/`tn`/`on`/`rn`/`Hr`/`Fr` —
 * engine-owned props a rewrite may not change.
 */
export function uiRenderEnginePropsCheck(
  rewritten: Record<string, unknown>,
  original: { component: string; props: Record<string, unknown> },
): string | undefined {
  const engine = original.props
  const component = original.component
  const schema = UI_RENDER_PROP_SCHEMA[component] ?? {}
  for (const [name, allowed] of Object.entries(schema)) {
    if (allowed === UI_RENDER_ANY_KIND) continue
    const kind = uiRenderPropKind(rewritten[name])
    if (!allowed.includes(kind)) {
      return `a props.${name} that is ${kind}, not ${allowed.join(' or ')}`
    }
  }
  for (const [name, orig] of Object.entries(engine)) {
    if (orig === undefined || Object.hasOwn(schema, name)) continue
    const nextKind = uiRenderPropKind(rewritten[name])
    const origKind = uiRenderPropKind(orig)
    if (nextKind !== origKind) {
      return `a props.${name} that is ${nextKind}, not ${origKind}`
    }
  }
  const grownControl = Object.keys(rewritten).find(name => {
    if (uiRenderSame(rewritten[name], engine[name])) return false
    return (
      uiRenderClassGrew(
        rewritten[name],
        engine[name],
        UI_RENDER_ESCAPE_CLASS,
      ) ||
      uiRenderClassGrew(
        rewritten[name],
        engine[name],
        UI_RENDER_PLACEHOLDER_CLASS,
      ) ||
      uiRenderClassGrew(
        rewritten[name],
        engine[name],
        UI_RENDER_LONE_SURROGATE_CLASS,
      )
    )
  })
  if (grownControl !== undefined) {
    return `a props.${grownControl} with a control character (an escape sequence the terminal would honour, an image placeholder, or an unpaired surrogate half out of reach); a rewrite the engine draws adds none`
  }
  const grown = Object.keys(rewritten).find(name => {
    if (uiRenderSame(rewritten[name], engine[name])) return false
    const next = uiRenderStringChars(rewritten[name])
    const prev = uiRenderStringChars(engine[name])
    return next > UI_RENDER_REWRITE_CHAR_CAP && next > prev
  })
  if (grown !== undefined) {
    return `a props.${grown} of more than ${UI_RENDER_REWRITE_CHAR_CAP} characters of text, more than the engine drew`
  }
  if (component === 'UserMessage') {
    const pinned = USER_MESSAGE_PINNED_PROPS.find(
      key => !uiRenderSame(rewritten[key], engine[key]),
    )
    if (pinned !== undefined) {
      return `a props.${pinned} other than the engine drew (the row names its message's origin, sender and task and how the view draws it; a rewrite changes the text alone)`
    }
  }
  if (
    (component === 'ToolUse' ||
      component === 'ToolResult' ||
      component === 'ToolProgress') &&
    rewritten.tool_use_id !== engine.tool_use_id
  ) {
    return 'a props.tool_use_id other than the engine drew (the id names the call; a rewrite changes the row alone)'
  }
  if (component === 'ToolProgress' && rewritten.kind !== engine.kind) {
    return 'a props.kind other than the engine drew (the kind names the row; a rewrite changes its text alone)'
  }
  if (
    component === 'ToolGroup' &&
    (engine.calls !== undefined || rewritten.calls !== undefined)
  ) {
    const originalIds = uiRenderToolUseIds(engine.calls) ?? []
    const rewrittenIds = uiRenderToolUseIds(rewritten.calls)
    if (
      rewrittenIds === undefined ||
      rewrittenIds.length !== originalIds.length ||
      rewrittenIds.some((id, index) => id === null || id !== originalIds[index])
    ) {
      return "props.calls whose tool_use_ids are not the ones the engine drew (each call keeps the id tool.call carried; the group's calls are its own)"
    }
  }
  if (component === 'CommandOutput' && rewritten.command !== engine.command) {
    return 'a props.command other than the engine drew (the name is the command that printed the row; a rewrite changes the row alone)'
  }
  if (component === 'Pane' && rewritten.placement !== engine.placement) {
    return 'a props.placement other than the surface drew (the surface places the pane; a rewrite changes the drawing alone)'
  }
  if (
    (component === 'Pane' || component === 'AbovePrompt') &&
    !uiRenderSame(rewritten.view, engine.view)
  ) {
    return 'a props.view other than the surface drew (the person chooses the transcript in view; a rewrite changes the drawing alone)'
  }
  if (isG2eComponent(component)) {
    const rewrittenOnScreen = Object.hasOwn(engine, 'onScreen')
      ? engine.onScreen
      : undefined
    if (!uiRenderSame(rewritten.onScreen, rewrittenOnScreen)) {
      return 'a props.onScreen other than the surface reported (the surface says what its viewport shows; a rewrite changes the drawing alone)'
    }
  }
  return undefined
}

/** densable `di` — ui.render / $.ui.resolve argument. */
export function uiRenderArgCheck(input: unknown): string | undefined {
  if (
    !isEventRecord(input) ||
    typeof input.surface !== 'string' ||
    !Object.hasOwn(UI_SURFACES, input.surface)
  ) {
    return 'takes a ui.render argument (e.surface names the surface)'
  }
  const component = String(input.component)
  return Object.hasOwn(UI_RENDER_COMPONENTS, component)
    ? undefined
    : `takes a ui.render argument (e.component "${component}" is not a component the engine draws)`
}

/**
 * densable `Li.check` — ui.render answer is a tree element (`{ type }`).
 */
export function uiRenderTreeCheck(tree: unknown): string | undefined {
  return isEventRecord(tree) && typeof tree.type === 'string'
    ? undefined
    : 'something that is not a tree element'
}

const UI_LARGE_SURFACES = new Set(['desktop', 'vscode', 'mobile'])

const UI_DIALOG_ROWS_MAX_LARGE = 48

const UI_DIALOG_ROWS_MAX_DEFAULT = 12

const UI_DIALOG_COLUMN_WIDTH = 40

const UI_BOX_BORDER_ROWS = 2

const UI_BOX_ROW_MULTIPLIER: Record<string, number> = {
  padding: 2,
  paddingY: 2,
  paddingTop: 1,
  paddingBottom: 1,
  margin: 2,
  marginY: 2,
  marginTop: 1,
  marginBottom: 1,
}

const UI_INLINE_ELEMENTS = new Set(['Text', 'Link', 'Button'])

/** densable `C8s` — 48 rows on desktop/vscode/mobile, 12 otherwise. */
export function getSurfaceUiRenderCaps(surface?: string): {
  rowsMax: number
  isMarkdownDrawn: boolean
} {
  const isLarge = surface !== undefined && UI_LARGE_SURFACES.has(surface)
  return {
    rowsMax: isLarge ? UI_DIALOG_ROWS_MAX_LARGE : UI_DIALOG_ROWS_MAX_DEFAULT,
    isMarkdownDrawn: isLarge,
  }
}

function countWrappedTextRows(
  text: string,
  width: number,
  rowsMax: number,
): number {
  let newlines = 0
  let idx = text.indexOf('\n')
  while (idx !== -1) {
    newlines += 1
    if (newlines > rowsMax) return newlines
    idx = text.indexOf('\n', idx + 1)
  }
  const budgetChars = width * (rowsMax + 1)
  const sampleLen = Math.min(text.length, budgetChars)
  return newlines + Math.floor(sampleLen / width)
}

/**
 * densable `I0e` row cap — enforces `C8s(surface).rowsMax` (48 or 12) around
 * `AskUserQuestion` dialogs, refusing `more than ${rowsMax} rows around the dialog`.
 */
export function uiRenderDialogRowsCheck(
  tree: unknown,
  component: string,
  surface?: string,
): string | undefined {
  if (component !== ENGINE_ALONE_UI_RENDER) return undefined
  const caps = getSurfaceUiRenderCaps(surface)
  let rows = 0

  function visit(
    node: unknown,
    inInline: boolean,
    inButton: boolean,
  ): string | undefined {
    if (typeof node === 'string') {
      if (!inButton) {
        rows +=
          (inInline ? 0 : 1) +
          countWrappedTextRows(node, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      }
      return undefined
    }
    if (!isEventRecord(node) || typeof node.type !== 'string') {
      return undefined
    }
    const { type, props, children } = node
    if (type === 'engine') return undefined
    if (type === 'Markdown') {
      if (!caps.isMarkdownDrawn) {
        return 'Markdown around the dialog (its rows are not bounded there)'
      }
      const text =
        isEventRecord(props) && typeof props.text === 'string' ? props.text : ''
      rows +=
        1 + countWrappedTextRows(text, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      return undefined
    }
    if (type === 'Raster' || type === 'Image') {
      if (isEventRecord(props) && typeof props.rows === 'number') {
        rows += props.rows
      }
      return undefined
    }
    if (type === 'Input') {
      const baseRows =
        isEventRecord(props) && typeof props.rows === 'number' ? props.rows : 1
      const label =
        isEventRecord(props) && typeof props.label === 'string'
          ? props.label
          : ''
      rows +=
        baseRows +
        countWrappedTextRows(label, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      return undefined
    }
    if (type === 'Progress') {
      const hasVal = isEventRecord(props) && props.value !== undefined
      const label =
        isEventRecord(props) && typeof props.label === 'string'
          ? props.label
          : ''
      rows +=
        (hasVal ? 2 : 1) +
        countWrappedTextRows(label, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      return undefined
    }
    if (type === 'Code') {
      const source =
        isEventRecord(props) && typeof props.source === 'string'
          ? props.source
          : ''
      rows +=
        1 + countWrappedTextRows(source, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      return undefined
    }
    if (type === 'Svg') {
      const alt =
        isEventRecord(props) && typeof props.alt === 'string' ? props.alt : ''
      rows +=
        1 + countWrappedTextRows(alt, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      return undefined
    }
    if (type === 'Button') {
      const label =
        isEventRecord(props) && typeof props.label === 'string'
          ? props.label
          : ''
      rows +=
        1 + countWrappedTextRows(label, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      if (Array.isArray(children)) {
        for (const child of children) {
          const err = visit(child, true, true)
          if (err !== undefined) return err
        }
      }
      return undefined
    }
    if (type === 'Link') {
      const label =
        isEventRecord(props) && typeof props.label === 'string'
          ? props.label
          : isEventRecord(props) && typeof props.href === 'string'
            ? props.href
            : ''
      rows += countWrappedTextRows(label, UI_DIALOG_COLUMN_WIDTH, caps.rowsMax)
      if (Array.isArray(children)) {
        for (const child of children) {
          const err = visit(child, true, inButton)
          if (err !== undefined) return err
        }
      }
      return undefined
    }
    const nextInline = inInline || UI_INLINE_ELEMENTS.has(type)
    if (!inInline && UI_INLINE_ELEMENTS.has(type)) {
      rows += 1
    }
    let gapMultiplier = 0
    if (isEventRecord(props)) {
      for (const [key, val] of Object.entries(props)) {
        let numVal: number | undefined
        if (typeof val === 'number') {
          numVal = Math.abs(val)
        } else if (
          typeof val === 'string' &&
          Object.hasOwn(UI_BOX_NAMED_SPACING, val)
        ) {
          numVal =
            UI_BOX_NAMED_SPACING[val as keyof typeof UI_BOX_NAMED_SPACING].down
        }
        if (numVal !== undefined) {
          rows += numVal * (UI_BOX_ROW_MULTIPLIER[key] ?? 0)
          if (key === 'gap' || key === 'rowGap') {
            gapMultiplier += numVal
          }
        } else if (key === 'borderStyle') {
          rows += UI_BOX_BORDER_ROWS
        }
      }
    }
    if (Array.isArray(children)) {
      rows += gapMultiplier * children.length
      for (const child of children) {
        const err = visit(child, nextInline, inButton)
        if (err !== undefined) return err
      }
    }
    return undefined
  }

  const problem = visit(tree, false, false)
  if (problem !== undefined) return problem
  if (rows > caps.rowsMax) {
    return `more than ${caps.rowsMax} rows around the dialog`
  }
  return undefined
}

function valueIsProxy(value: unknown): boolean {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return false
  }
  // densable `ge(p)` — Node util.types.isProxy.
  return isProxy(value)
}

function isPlainDataObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const HOVER_BOX_PROPS = new Set([
  'borderStyle',
  'borderColor',
  'borderDimColor',
  'backgroundColor',
  'display',
  'top',
  'left',
  'right',
  'bottom',
])

const HOVER_TEXT_PROPS = new Set([
  'color',
  'backgroundColor',
  'dimColor',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'inverse',
  'mono',
  'tabular',
])

export const UI_TEXT_SIZES = new Set([
  'caption',
  'footnote',
  'body',
  'heading',
  'title',
])

export const UI_TEXT_WEIGHTS = new Set([
  'regular',
  'medium',
  'semibold',
  'bold',
])

export const UI_TEXT_DIRS = new Set(['ltr', 'rtl'])

/** Official 2.1.326 #10: mod Box `overflowX` allowed values. */
export const UI_BOX_OVERFLOW_X_VALUES = new Set(['visible', 'hidden', 'scroll'])

/** Official 2.1.326 #10: mod Text `wrap` allowed values (including `'clip'`). */
export const UI_TEXT_WRAP_VALUES = new Set([
  'wrap',
  'end',
  'middle',
  'truncate',
  'truncate-end',
  'truncate-middle',
  'truncate-start',
  'clip',
])

/** Official 2.1.326 #10: upper bound for mod Text `maxLines` (`W4e = 10_000`). */
export const UI_TEXT_MAX_LINES_LIMIT = 10_000

export function validateModBoxOverflowX(value: unknown): string | undefined {
  return typeof value === 'string' && UI_BOX_OVERFLOW_X_VALUES.has(value)
    ? undefined
    : `must be one of ${[...UI_BOX_OVERFLOW_X_VALUES].join(', ')}`
}

export function validateModTextWrap(value: unknown): string | undefined {
  return typeof value === 'string' && UI_TEXT_WRAP_VALUES.has(value)
    ? undefined
    : `must be one of ${[...UI_TEXT_WRAP_VALUES].join(', ')}`
}

export function validateModTextMaxLines(value: unknown): string | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= UI_TEXT_MAX_LINES_LIMIT
    ? undefined
    : `must be a whole number from 1 to ${UI_TEXT_MAX_LINES_LIMIT}`
}

/**
 * Official 2.1.326 #10: validate mod UI `Box.overflowX`, `Text.wrap`, and
 * `Text.maxLines` props across a rendered drawing tree.
 */
export function uiRenderModPropsCheck(tree: unknown): string | undefined {
  const walk = (node: unknown): string | undefined => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const reason = walk(child)
        if (reason !== undefined) return reason
      }
      return undefined
    }
    if (!isEventRecord(node)) return undefined
    const type = typeof node.type === 'string' ? node.type : undefined
    const drawn = isEventRecord(node.props) ? node.props : node
    if (type === 'Box' && drawn.overflowX !== undefined) {
      const err = validateModBoxOverflowX(drawn.overflowX)
      if (err !== undefined) {
        return `Box prop "overflowX" ${err}`
      }
    }
    if (type === 'Text') {
      if (drawn.wrap !== undefined) {
        const err = validateModTextWrap(drawn.wrap)
        if (err !== undefined) {
          return `Text prop "wrap" ${err}`
        }
      }
      if (drawn.maxLines !== undefined) {
        const err = validateModTextMaxLines(drawn.maxLines)
        if (err !== undefined) {
          return `Text prop "maxLines" ${err}`
        }
      }
    }
    if (node.children !== undefined) {
      const reason = walk(node.children)
      if (reason !== undefined) return reason
    }
    const props = isEventRecord(node.props) ? node.props : undefined
    if (props?.children !== undefined) {
      const reason = walk(props.children)
      if (reason !== undefined) return reason
    }
    return undefined
  }
  return walk(tree)
}

/**
 * Official 2.1.326 #10 (`uMn`): resolve precedence when both `maxLines` and
 * `wrap` are present on a mod `Text` element.
 */
export function normalizeModTextWrapAndMaxLines(
  props: Record<string, unknown>,
): Record<string, unknown> {
  if (props.maxLines === undefined || props.wrap === undefined) return props
  const { maxLines, wrap, ...rest } = props
  switch (wrap) {
    case 'wrap':
    case 'end':
    case 'truncate':
    case 'truncate-end':
      return { ...rest, maxLines }
    default:
      return { ...rest, wrap }
  }
}

/**
 * Official 2.1.326 #10 (`Den`): normalize a mod UI tree for `Box`
 * `overflowX="scroll"` containers (`flexWrap: "nowrap"`, `minWidth: 0`, and
 * single-line `truncate-end` fallback for nested `Text` children).
 */
export function normalizeModScrollXTree<T>(node: T, inScrollX = false): T {
  if (Array.isArray(node)) {
    return node.map(child => {
      if (
        inScrollX &&
        (typeof child === 'string' ||
          (isEventRecord(child) && child.type === 'Link'))
      ) {
        return {
          type: 'Text',
          props: { wrap: 'truncate-end' },
          children: [child],
        }
      }
      return normalizeModScrollXTree(child, inScrollX)
    }) as T
  }
  if (!isEventRecord(node)) return node
  if (node.type === 'Text' && inScrollX) {
    const rawProps = isEventRecord(node.props) ? node.props : {}
    const { maxLines: _dropMaxLines, ...restProps } = rawProps
    const shouldTruncate =
      restProps.wrap === undefined || restProps.wrap === 'wrap'
    return {
      ...node,
      props: shouldTruncate
        ? { ...restProps, wrap: 'truncate-end' }
        : restProps,
    } as T
  }
  if (node.type !== 'Box') return node
  const rawProps = isEventRecord(node.props) ? node.props : {}
  const { overflowX, ...restProps } = rawProps
  const nextInScrollX =
    overflowX === 'scroll' || (inScrollX && restProps.width === undefined)
  const mapChildren = (list: unknown[]): unknown[] =>
    list.map(child => {
      if (
        typeof child === 'string' ||
        (isEventRecord(child) && child.type === 'Link')
      ) {
        return nextInScrollX
          ? {
              type: 'Text',
              props: { wrap: 'truncate-end' },
              children: [child],
            }
          : child
      }
      return normalizeModScrollXTree(child, nextInScrollX)
    })
  const baseNextProps = nextInScrollX
    ? {
        flexWrap: 'nowrap',
        minWidth: 0,
        ...restProps,
        ...(overflowX !== undefined ? { overflowX } : {}),
      }
    : rawProps
  const nextProps =
    !Array.isArray(node.children) && Array.isArray(baseNextProps.children)
      ? { ...baseNextProps, children: mapChildren(baseNextProps.children) }
      : baseNextProps
  const children = Array.isArray(node.children)
    ? mapChildren(node.children)
    : node.children
  return {
    ...node,
    props: nextProps,
    ...(children !== undefined ? { children } : {}),
  } as T
}

export const UI_BOX_NAMED_SPACING = {
  xs: { across: 1, down: 0 },
  sm: { across: 1, down: 0 },
  md: { across: 2, down: 1 },
  lg: { across: 3, down: 1 },
  xl: { across: 4, down: 2 },
} as const

export const UI_BOX_SPACING_AXES: Record<string, 'across' | 'down'> = {
  columnGap: 'across',
  rowGap: 'down',
  marginX: 'across',
  marginY: 'down',
  marginLeft: 'across',
  marginRight: 'across',
  marginTop: 'down',
  marginBottom: 'down',
  paddingX: 'across',
  paddingY: 'down',
  paddingLeft: 'across',
  paddingRight: 'across',
  paddingTop: 'down',
  paddingBottom: 'down',
}

export const UI_BOX_SHORTHAND_SPACING: Record<string, [string, string]> = {
  gap: ['columnGap', 'rowGap'],
  margin: ['marginX', 'marginY'],
  padding: ['paddingX', 'paddingY'],
}

export const PROMPT_DECORATION_STYLE_KEYS = new Set([
  'color',
  'backgroundColor',
  'dimColor',
  'bold',
  'italic',
  'underline',
  'strikethrough',
])

export const PROMPT_DECORATION_VIRTUAL_TEXT = 'virtualText'

export const PROMPT_DECORATION_KEYS = new Set([
  'start',
  'end',
  ...PROMPT_DECORATION_STYLE_KEYS,
  PROMPT_DECORATION_VIRTUAL_TEXT,
])

export function validatePromptDecorations(
  decorations: unknown,
): string | undefined {
  if (decorations === undefined) return undefined
  if (!Array.isArray(decorations)) {
    return 'decorations must be an array of { start, end } runs'
  }
  for (let i = 0; i < decorations.length; i++) {
    const run = decorations[i]
    if (!isEventRecord(run)) {
      return `decorations[${i}] must be an object with start and end`
    }
    const badKey = Object.keys(run).find(k => !PROMPT_DECORATION_KEYS.has(k))
    if (badKey !== undefined) {
      return `decorations[${i}].${badKey} is not a decoration key (${[...PROMPT_DECORATION_KEYS].join(', ')})`
    }
    if (!Number.isInteger(run.start)) {
      return `decorations[${i}].start must be an integer (a UTF-16 offset)`
    }
    if (!Number.isInteger(run.end)) {
      return `decorations[${i}].end must be an integer (a UTF-16 offset)`
    }
    if (
      run[PROMPT_DECORATION_VIRTUAL_TEXT] !== undefined &&
      typeof run[PROMPT_DECORATION_VIRTUAL_TEXT] !== 'string'
    ) {
      return `decorations[${i}].${PROMPT_DECORATION_VIRTUAL_TEXT} must be a string`
    }
  }
  return undefined
}

export function resolveModBoxSpacingProp(
  prop: string,
  value: unknown,
): number | { across: number; down: number } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Object.hasOwn(UI_BOX_NAMED_SPACING, value)) {
    const step =
      UI_BOX_NAMED_SPACING[value as keyof typeof UI_BOX_NAMED_SPACING]
    const axis = UI_BOX_SPACING_AXES[prop]
    if (axis !== undefined) return step[axis]
    if (prop in UI_BOX_SHORTHAND_SPACING) return step
  }
  return undefined
}

export function normalizeModTextProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  if (props.bold === true && props.weight === undefined) {
    return { ...props, weight: 'bold' }
  }
  return props
}

const HOVER_SHIFT_PROPS = new Set(['top', 'left', 'right', 'bottom'])

const HOVER_SCOPE_MAX = 64

function hoverScopeLabel(value: unknown): string {
  let raw = ''
  for (const ch of String(value)) {
    raw += ch.charCodeAt(0) < 32 ? '?' : ch
  }
  return raw.length <= 40 ? raw : `${raw.slice(0, 40)}...`
}

function hoverScopeHoldsControl(value: string): boolean {
  for (const ch of value) {
    if (ch.charCodeAt(0) < 32) {
      return true
    }
  }
  return false
}

/**
 * densable `pBr` unique English. Plugin-chain stamp (`SUe`) is minify
 * collision — omit that arm unless press/group is a string list.
 */
function hoverScopeCheck(
  scope: unknown,
  held: unknown,
  label: string,
): string | undefined {
  const quoted = hoverScopeLabel(scope)
  const lead = `${label} hover scope "${quoted}"`
  if (
    typeof scope !== 'string' ||
    scope === '' ||
    scope.length > HOVER_SCOPE_MAX
  ) {
    return `${lead} is not a string of 1 to ${HOVER_SCOPE_MAX} characters`
  }
  if (hoverScopeHoldsControl(scope)) {
    return `${lead} holds a control character`
  }
  if (Array.isArray(held) && !held.includes(scope)) {
    return `${lead} is not held by a plugin of this chain`
  }
  return undefined
}

/**
 * densable drawing-plainness walker (`i`/`n` next to Te).
 * Unique English: Proxy / function-not-plain / class instance.
 */
export function uiRenderDrawingPlainCheck(
  tree: unknown,
  plugin: string,
): string | undefined {
  const seen = new WeakMap<object, true>()
  const lead = plugin === '' ? 'ui.render' : plugin
  const stack: Array<{ value: unknown; key: string | undefined }> = [
    { value: tree, key: undefined },
  ]
  while (stack.length > 0) {
    const { value, key } = stack.pop()!
    if (value === null || value === undefined) continue
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      continue
    }
    if (valueIsProxy(value)) {
      return `${lead}: returned a drawing that holds a Proxy; an element, its props and its hover are plain objects and arrays`
    }
    if (typeof value === 'function') {
      if (key === 'onPress' || key === 'onEvent') continue
      return `${lead}: returned a drawing with a function where plain data goes; a closure rides only in an element's onPress or onEvent`
    }
    if (typeof value !== 'object') continue
    if (seen.has(value)) continue
    seen.set(value, true)
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        let child: unknown
        try {
          child = value[i]
        } catch (err) {
          if (err instanceof RangeError) {
            return `${lead}: returned a drawing whose index ${i} getter threw RangeError`
          }
          throw err
        }
        stack.push({ value: child, key: undefined })
      }
      continue
    }
    if (!isPlainDataObject(value)) {
      return `${lead}: returned a drawing that holds an object that is not plain data (a class instance); an element, its props and its hover are plain objects and arrays`
    }
    if (Object.hasOwn(value, '__proto__')) {
      return `${lead}: returned a drawing that holds a __proto__ key; an element, its props and its hover are plain objects without __proto__`
    }
    const entries = Object.keys(value)
    for (let i = entries.length - 1; i >= 0; i--) {
      const field = entries[i]!
      if (field === '__proto__') {
        return `${lead}: returned a drawing that holds a __proto__ key; an element, its props and its hover are plain objects without __proto__`
      }
      let child: unknown
      try {
        child = (value as Record<string, unknown>)[field]
      } catch (err) {
        if (err instanceof RangeError) {
          return `${lead}: returned a drawing whose "${field}" getter threw RangeError`
        }
        throw err
      }
      stack.push({ value: child, key: field })
    }
  }
  return undefined
}

/**
 * densable `q9n` hover-prop deny unique English. Walks Box/Text/Button hover.
 */
export function uiRenderHoverCheck(tree: unknown): string | undefined {
  const walk = (
    node: unknown,
    hoverScope: HoverScopeKind,
  ): string | undefined => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const reason = walk(child, hoverScope)
        if (reason !== undefined) return reason
      }
      return undefined
    }
    if (!isEventRecord(node)) return undefined
    const type = typeof node.type === 'string' ? node.type : undefined
    const drawn = isEventRecord(node.props) ? node.props : node
    const hover = isEventRecord(node.hover)
      ? node.hover
      : isEventRecord(drawn.hover)
        ? drawn.hover
        : undefined
    const boxKey = type === 'Box' ? drawn.key : undefined
    const skipHidden =
      isEventRecord(hover) &&
      hover.scope !== undefined &&
      hover.display !== undefined
    // densable `mr`: keyed Box computes scope for **this** node and children.
    const nodeScope: HoverScopeKind =
      typeof boxKey !== 'string'
        ? hoverScope
        : drawn.display === 'none' && !skipHidden
          ? 'hidden'
          : 'live'
    if (hover !== undefined) {
      const label = type ?? 'Box'
      if (!(type === 'Box' || type === 'Text' || type === 'Button')) {
        return `${label} takes no hover; Box, Text and Button do`
      }
      if (!isEventRecord(hover)) {
        return `${label} hover is ${typeof hover}, not an object of style props`
      }
      if (hover.scope !== undefined) {
        const held = type === 'Button' ? node.press : node.group
        const scopeDeny = hoverScopeCheck(hover.scope, held, label)
        if (scopeDeny !== undefined) return scopeDeny
      } else if (nodeScope === 'none') {
        return `${label} hover has no Box with a key around it; the nearest keyed Box is what the pointer hovers, or a scope names its group`
      } else if (nodeScope === 'hidden') {
        return `${label} hover is scoped to a keyed Box drawn display "none", which the pointer can never be over; keep the keyed Box visible and put display "none" with hover { display: "flex" } on a Box inside it`
      }
      const allowed = type === 'Box' ? HOVER_BOX_PROPS : HOVER_TEXT_PROPS
      for (const [field, value] of Object.entries(hover)) {
        if (field === 'scope') continue
        const propLabel = `${label} hover prop "${field}"`
        if (!allowed.has(field)) return `${propLabel} is not allowed`
        if (
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          typeof value !== 'boolean'
        ) {
          return `${propLabel} is ${typeof value}`
        }
        if (field === 'display' && value !== 'flex') {
          return `${label} hover display "${String(value)}" would hide it under the pointer; a hover only reveals (display "flex" on a Box drawn display "none")`
        }
        if (field === 'display' && drawn.display !== 'none') {
          return `${label} hover display "flex" reveals a Box drawn display "none"; this Box is already shown`
        }
        if (field === 'borderStyle' && drawn.borderStyle === undefined) {
          return `${label} hover borderStyle would add a border and move what is around it; give the Box a borderStyle for the hover to restyle`
        }
        if (HOVER_SHIFT_PROPS.has(field) && drawn.position !== 'absolute') {
          return `${propLabel} would shift a Box still in the flow over its siblings; a hover moves only a Box drawn position "absolute"`
        }
        if (
          (field === 'color' ||
            field === 'backgroundColor' ||
            field === 'borderColor') &&
          !isValidThemeColorProp(value)
        ) {
          return `${propLabel} must be a color (a theme key, a name, or hex)`
        }
      }
    }
    const childScope = nodeScope
    if (node.children !== undefined) {
      const reason = walk(node.children, childScope)
      if (reason !== undefined) return reason
    }
    const props = isEventRecord(node.props) ? node.props : undefined
    if (props?.children !== undefined) return walk(props.children, childScope)
    return undefined
  }
  return walk(tree, 'none')
}

/**
 * densable `So` — session.compact messages (empty compaction is refused).
 * Per-row `cn` is not invented; unique English is the empty / not-a-list gate.
 */
export function sessionCompactMessagesCheck(
  messages: unknown,
): string | undefined {
  if (!Array.isArray(messages)) return 'messages that are not a list'
  if (messages.length === 0) {
    return 'an empty messages (a compaction leaves at least one)'
  }
  return undefined
}

function matcherNamedStrings(
  matcher: unknown,
  key: string,
): string[] | undefined {
  if (!isEventRecord(matcher) || !Object.hasOwn(matcher, key)) return undefined
  const value = matcher[key]
  if (typeof value === 'string') return [value]
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(item => typeof item === 'string')
  ) {
    return value
  }
  return undefined
}

function uiRenderSurfacePhrase(component: string): string {
  const surfaces =
    UI_RENDER_COMPONENT_SURFACES[
      component as keyof typeof UI_RENDER_COMPONENT_SURFACES
    ]
  if (surfaces === undefined) return 'every surface'
  const every = UI_SURFACE_NAMES.every(name => surfaces.includes(name))
  if (every) return 'every surface'
  if (surfaces.length === 1) return `the ${surfaces[0]} surface only`
  return `the ${surfaces.slice(0, -1).join(', ')} and ${surfaces.at(-1)} surfaces only`
}

/**
 * densable `BY` — Damerau–Levenshtein (insert/delete/replace + transposition).
 */
function namedEditDistance(left: string, right: string): number {
  if (left === right) return 0
  const rows = left.length
  const cols = right.length
  const table: number[][] = Array.from({ length: rows + 1 }, (_, row) =>
    Array.from({ length: cols + 1 }, (_, col) =>
      row === 0 ? col : col === 0 ? row : 0,
    ),
  )
  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= cols; col++) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      table[row]![col] = Math.min(
        table[row - 1]![col]! + 1,
        table[row]![col - 1]! + 1,
        table[row - 1]![col - 1]! + cost,
      )
      if (
        row > 1 &&
        col > 1 &&
        left[row - 1] === right[col - 2] &&
        left[row - 2] === right[col - 1]
      ) {
        table[row]![col] = Math.min(
          table[row]![col]!,
          table[row - 2]![col - 2]! + 1,
        )
      }
    }
  }
  return table[rows]![cols]!
}

/**
 * densable `JEe(e,n,s)` — names within edit distance 2, length delta ≤ 2.
 */
function nearestNamed(
  query: string,
  known: readonly string[],
  take = 1,
): string[] {
  const seen = new Set<string>()
  const hits: Array<{ name: string; distance: number }> = []
  for (const name of known) {
    if (seen.has(name)) continue
    seen.add(name)
    if (Math.abs(name.length - query.length) > 2) continue
    const distance = namedEditDistance(query, name)
    if (distance <= 2) hits.push({ name, distance })
  }
  return hits
    .sort((left, right) => left.distance - right.distance)
    .slice(0, take)
    .map(hit => hit.name)
}

function unknownNamedReason(
  named: readonly string[],
  known: readonly string[],
  kind: 'component' | 'surface',
): string[] {
  return [...new Set(named)]
    .filter(name => !known.includes(name))
    .map(name => {
      const hint = nearestNamed(name, known, 1)[0]
      const suffix = hint === undefined ? '' : ` (did you mean ${hint}?)`
      return `no ${kind} is named ${name}${suffix}`
    })
}

function matcherPairsOn(
  matcher: unknown,
): Array<{ component: string; surface: string }> {
  return Object.keys(UI_RENDER_COMPONENTS).flatMap(component => {
    const surfaces =
      UI_RENDER_COMPONENT_SURFACES[
        component as keyof typeof UI_RENDER_COMPONENT_SURFACES
      ] ?? []
    return surfaces
      .filter(
        surface =>
          matcherFieldAllows(matcher, 'component', component) &&
          matcherFieldAllows(matcher, 'surface', surface),
      )
      .map(surface => ({ component, surface }))
  })
}

function matcherFieldAllows(
  matcher: unknown,
  key: string,
  expected: string,
): boolean {
  if (!isEventRecord(matcher) || !Object.hasOwn(matcher, key)) return true
  const value = matcher[key]
  if (typeof value === 'string') return value === expected
  if (Array.isArray(value)) return value.includes(expected)
  return false
}

/**
 * densable `ltr` — ui.render matcher that can never run (wrong surface /
 * unknown name). Gold register warns; it does not fail the load.
 */
export function uiRenderMatcherNeverRuns(matcher: unknown): string | undefined {
  const matchers = Array.isArray(matcher) ? matcher : [matcher]
  const components = matchers.flatMap(
    row => matcherNamedStrings(row, 'component') ?? [],
  )
  const surfaces = matchers.flatMap(
    row => matcherNamedStrings(row, 'surface') ?? [],
  )
  const namedComponents = Object.keys(UI_RENDER_COMPONENTS).filter(name =>
    components.includes(name),
  )
  const namedSurfaces = UI_SURFACE_NAMES.filter(name => surfaces.includes(name))
  const noneRun = matchers.every(row => matcherPairsOn(row).length === 0)
  const crossed =
    noneRun && namedComponents.length > 0 && namedSurfaces.length > 0
      ? [
          `${namedComponents
            .map(name => `${name} is raised on ${uiRenderSurfacePhrase(name)}`)
            .join(', ')}; this hook names ${namedSurfaces.join(', ')}`,
        ]
      : []
  const parts = [
    ...unknownNamedReason(
      components,
      Object.keys(UI_RENDER_COMPONENTS),
      'component',
    ),
    ...unknownNamedReason(surfaces, UI_SURFACE_NAMES, 'surface'),
    ...crossed,
  ]
  return parts.length > 0
    ? `${parts.join('; ')}${noneRun ? ', so it never runs' : ''}`
    : undefined
}

/**
 * densable tn — rewrite of Pane/AbovePrompt must keep the surface's props.view.
 * Gold: Bn(e.view)!==Bn(t.props.view) → reject.
 */
export function uiRenderViewRewriteCheck(
  original: Record<string, unknown>,
  rewritten: Record<string, unknown>,
): string | undefined {
  const component = String(original.component ?? '')
  if (component !== 'Pane' && component !== 'AbovePrompt') return undefined
  const originalProps = isEventRecord(original.props) ? original.props : {}
  const originalView = originalProps.view
  const rewrittenView = Object.hasOwn(rewritten, 'view')
    ? rewritten.view
    : isEventRecord(rewritten.props)
      ? rewritten.props.view
      : undefined
  try {
    if (JSON.stringify(originalView) === JSON.stringify(rewrittenView)) {
      return undefined
    }
  } catch {
    if (originalView === rewrittenView) return undefined
  }
  return 'a props.view other than the surface drew (the person chooses the transcript in view; a rewrite changes the drawing alone)'
}

/**
 * densable `FCe(event).checkMatcher`. Field equality, plus ui.render's
 * engine-alone component (`AskUserQuestion`).
 */
export function checkMatcher(
  event: string,
  matcher: unknown,
  isBuiltin = false,
): string | undefined {
  if (!isEventRecord(matcher)) return undefined
  const body = event.startsWith('classic.')
    ? event.slice('classic.'.length)
    : event
  if (
    (body === 'ui.render' || event === 'ui.render') &&
    Object.hasOwn(matcher, 'component')
  ) {
    if (matcher.component === 'PermissionRequest') {
      return 'PermissionRequest is drawn by the engine alone; its answer authorises an action. A plugin adds context with $.ui.notice'
    }
    const isModHotReloadCard =
      isBuiltin ||
      (isEventRecord(matcher.props) &&
        matcher.props.metadataSource === 'mod_hot_reload')
    if (matcher.component === ENGINE_ALONE_UI_RENDER && !isModHotReloadCard) {
      return `${ENGINE_ALONE_UI_RENDER} is drawn by the engine alone; its answer authorises an action. A plugin adds context with $.ui.notice`
    }
  }
  return undefined
}

function matchFieldValue(expected: unknown, actual: unknown): boolean {
  if (expected instanceof RegExp) {
    if (typeof actual !== 'string') return false
    if (expected.flags.includes('g') || expected.flags.includes('y')) {
      expected.lastIndex = 0
    }
    return expected.exec(actual) !== null
  }
  if (Array.isArray(expected)) {
    return expected.some(item => matchFieldValue(item, actual))
  }
  if (isEventRecord(expected)) {
    if (!isEventRecord(actual)) return false
    return Object.entries(expected).every(([k, v]) =>
      matchFieldValue(v, actual[k]),
    )
  }
  return expected === actual
}

/** A non-object matcher matches everything. Object/array/RegExp fields match gold `vSt`. */
export function matcherAllows(
  matcher: unknown,
  event: Record<string, unknown>,
  eventName?: string,
  isBuiltin = false,
): boolean {
  // Official 2.1.323 #2039: non-builtin mods may never intercept Claude Code's
  // own AskUserQuestion confirmations (`confirm_*`, `mod_hot_reload`,
  // `plugin_authoring_hand_over_check`).
  if (
    !isBuiltin &&
    (eventName === 'ui.render' || eventName === 'classic.ui.render') &&
    event.component === 'AskUserQuestion'
  ) {
    const reqId =
      typeof event.requestId === 'string' ? event.requestId : undefined
    const props = isEventRecord(event.props) ? event.props : undefined
    const metaSource =
      typeof props?.metadataSource === 'string'
        ? props.metadataSource
        : undefined
    if (
      (reqId !== undefined && reqId.startsWith('confirm_')) ||
      metaSource === 'mod_hot_reload' ||
      metaSource === 'plugin_authoring_hand_over_check'
    ) {
      return false
    }
  }
  if (Array.isArray(matcher)) {
    return matcher.some(entry =>
      matcherAllows(entry, event, eventName, isBuiltin),
    )
  }
  if (!isEventRecord(matcher)) return true
  if (
    eventName !== undefined &&
    checkMatcher(eventName, matcher, isBuiltin) !== undefined
  ) {
    return false
  }
  return Object.entries(matcher).every(([key, expected]) =>
    matchFieldValue(expected, event[key]),
  )
}
