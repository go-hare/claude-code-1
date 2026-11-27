/**
 * Function hooks submodule: uiResolve
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import {
  UI_RESOLVE_ELEMENT_NAMES,
  UI_SURFACES,
  isEventRecord,
} from './constants.js'
import { holdPress } from './press.js'
import { fhState } from './state.js'

export function flattenUiResolveChildren(input: unknown): unknown[] {
  if (input === undefined || input === null || typeof input === 'boolean') {
    return []
  }
  const raw = Array.isArray(input) ? input : [input]
  return raw
    .flat(Number.POSITIVE_INFINITY)
    .filter(c => c !== null && c !== undefined && typeof c !== 'boolean')
    .map(c => (typeof c === 'number' ? String(c) : c))
}

function extractUiChildText(item: unknown): string {
  if (typeof item === 'string' || typeof item === 'number') return String(item)
  if (isEventRecord(item) && Array.isArray(item.children)) {
    return item.children.map(extractUiChildText).join('')
  }
  return ''
}

function sanitizeHoverStyleRecord(
  hover: unknown,
): Record<string, unknown> | undefined {
  if (!isEventRecord(hover)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(hover)) {
    if (v === undefined || v === null || typeof v === 'function') continue
    out[k] = v
  }
  return out
}

/**
 * densable `Nr` / surface `elements[name]`: JSX pragma constructors.
 * Do not run Ink here — blit still mounts via `walkUiMounts`.
 */
function uiResolveH(
  name: string,
  props: Record<string, unknown>,
  ...childList: unknown[]
): Record<string, unknown> {
  const flat = flattenUiResolveChildren(childList)
  const node: Record<string, unknown> = { type: name }
  if (Object.keys(props).length > 0) node.props = props
  if (flat.length > 0) node.children = flat
  return node
}

function uiResolveElementNames(surface: string): readonly string[] {
  return Object.hasOwn(UI_SURFACES, surface)
    ? UI_SURFACES[surface as keyof typeof UI_SURFACES]
    : UI_RESOLVE_ELEMENT_NAMES
}

/** densable `ivo` / `du` — freeze table of `(props) => h(name, rest, children)`. */
export function makeUiResolveTable(
  surface: string,
  plugin = '',
): Readonly<Record<string, (props?: Record<string, unknown>) => unknown>> {
  const elements: Record<string, (props?: Record<string, unknown>) => unknown> =
    Object.create(null)
  for (const name of uiResolveElementNames(surface)) {
    elements[name] = Object.freeze((props?: Record<string, unknown>) => {
      const { children, ...rawRest } = (props ?? {}) as {
        children?: unknown
      } & Record<string, unknown>
      const childList = flattenUiResolveChildren(children)
      const rest: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rawRest)) {
        if (k === 'ref' || v === undefined || v === null) continue
        rest[k] = v
      }
      const takesHover = name === 'Box' || name === 'Text'
      const hover = takesHover
        ? sanitizeHoverStyleRecord(rest.hover)
        : undefined
      if (takesHover) delete rest.hover
      if (name === 'Box' && typeof rest.key === 'number') {
        rest.key = String(rest.key)
      }
      let pressStamp: { plugin: string; handle: number } | undefined
      let keepChildren = true
      if (name === 'Button') {
        for (const child of childList) {
          if (typeof child === 'string') continue
          if (
            isEventRecord(child) &&
            typeof child.type === 'string' &&
            child.type === 'Text'
          ) {
            continue
          }
          const childType =
            isEventRecord(child) && typeof child.type === 'string'
              ? child.type === 'engine'
                ? 'engine node'
                : child.type
              : typeof child
          const buttonLabel =
            typeof rest.key === 'string' && rest.key !== ''
              ? `Button "${rest.key}"`
              : 'Button'
          throw new Error(
            `${childType} inside ${buttonLabel} (a Button holds strings and Text)`,
          )
        }
        if (rest.label === undefined && childList.length > 0) {
          const joined = childList.map(extractUiChildText).join('')
          if (joined !== '') rest.label = joined
        }
        if (rest.key === undefined && typeof rest.label === 'string') {
          rest.key = rest.label
        }
        if (typeof rest.onPress === 'function') {
          const onPress = rest.onPress as (event: unknown) => unknown
          delete rest.onPress
          const handle = ++fhState().uiResolvePressCounter
          holdPress(plugin, handle, onPress)
          pressStamp = { plugin, handle }
        }
        keepChildren = true
      } else if (name === 'Select') {
        if (typeof rest.onSelect === 'function') {
          const onSelect = rest.onSelect as (
            value: string,
            event: unknown,
          ) => unknown
          delete rest.onSelect
          const handle = ++fhState().uiResolvePressCounter
          holdPress(plugin, handle, (e: unknown) => {
            const val =
              isEventRecord(e) && typeof e.value === 'string'
                ? e.value
                : String(e ?? '')
            return onSelect(val, e)
          })
          pressStamp = { plugin, handle }
        }
        keepChildren = false
      } else if (name === 'Input') {
        const onInput =
          typeof rest.onInput === 'function'
            ? (rest.onInput as (value: string, event: unknown) => unknown)
            : undefined
        const onSubmit =
          typeof rest.onSubmit === 'function'
            ? (rest.onSubmit as (value: string, event: unknown) => unknown)
            : undefined
        delete rest.onInput
        delete rest.onSubmit
        if (onInput !== undefined || onSubmit !== undefined) {
          const handle = ++fhState().uiResolvePressCounter
          holdPress(plugin, handle, (e: unknown) => {
            if (!isEventRecord(e)) return undefined
            const val = typeof e.value === 'string' ? e.value : ''
            if (e.kind === 'submit') return onSubmit?.(val, e)
            return onInput?.(val, e)
          })
          pressStamp = { plugin, handle }
        }
        keepChildren = false
      } else if (name === 'Markdown') {
        if (typeof rest.onLinkPress === 'function') {
          const onLinkPress = rest.onLinkPress as (
            link: unknown,
            event: unknown,
          ) => unknown
          delete rest.onLinkPress
          const handle = ++fhState().uiResolvePressCounter
          holdPress(plugin, handle, (e: unknown) => {
            if (!isEventRecord(e)) return undefined
            const link = isEventRecord(e.link)
              ? e.link
              : typeof e.href === 'string'
                ? { href: e.href }
                : undefined
            return onLinkPress(link, e)
          })
          pressStamp = { plugin, handle }
        }
        keepChildren = false
      }
      for (const [k, v] of Object.entries(rest)) {
        if (typeof v === 'function') delete rest[k]
      }
      const node = uiResolveH(name, rest, ...(keepChildren ? childList : []))
      if (hover !== undefined) node.hover = hover
      if (pressStamp !== undefined) node.press = pressStamp
      return node
    })
  }
  return Object.freeze(elements)
}

/** densable `svo` / `avo`: a hook may omit a name; it draws a fragment. */
export function fillWithheldUiResolveTable(
  table: unknown,
  surface: string,
  plugin?: string,
): unknown {
  if (!isEventRecord(table)) return table
  const names = uiResolveElementNames(surface)
  const next: Record<string, (props?: Record<string, unknown>) => unknown> =
    Object.create(null)
  const warned = new Set<string>()
  for (const [name, value] of Object.entries(table)) {
    if (typeof value === 'function') {
      next[name] = value as (props?: Record<string, unknown>) => unknown
    }
  }
  for (const name of names) {
    if (typeof next[name] === 'function') continue
    if (!warned.has(name)) {
      warned.add(name)
      const who = plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''
      console.warn(
        `${who}$.ui.resolve: <${name}> was withheld by a ui.resolve hook; it draws a fragment`,
      )
    }
    next[name] = Object.freeze((props?: Record<string, unknown>) => {
      const children = flattenUiResolveChildren(props?.children)
      return {
        type: 'Box',
        props: { flexDirection: 'column' },
        children,
      }
    })
  }
  return Object.freeze(next)
}
