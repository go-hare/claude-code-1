import { isDeepStrictEqual } from 'node:util'
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { useApp } from '@anthropic/ink'
import { logForDebugging } from '../../utils/debug.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import * as functionHooksModules from '../../utils/plugins/functionHooksModules.js'
import {
  evaluateUiRender,
  getLastUiRenderPlugin,
  hasMatchingFunctionHook,
} from '../../utils/plugins/functionHooksModules.js'
import {
  RZ,
  isEngineFallback,
  isG2eComponent,
  noteHeldRows,
  siteIsOff,
  useHeldSiteRows,
  useSiteMeasure,
} from '../../utils/plugins/pluginSiteHold.js'
import {
  getRenderVersion,
  subscribeRenderInvalidation,
} from '../../utils/render/invalidateAllRenders.js'
import { StaticRenderContext } from '../../utils/staticRender.js'
import { extractDrawnPlugin } from '../PluginRasterPanes.js'

function getUiRenderVersion(): number {
  return getRenderVersion('ui.render')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasRenderablePluginNode(value: unknown): boolean {
  if (typeof value === 'string') return true
  if (Array.isArray(value)) {
    return value.some(hasRenderablePluginNode)
  }
  return (
    isPlainRecord(value) &&
    typeof value.type === 'string' &&
    value.type !== 'engine'
  )
}

const noopSubscribePanes =
  (_listener: () => void): (() => void) =>
  () => {}
const noopGetPanesSize = (): undefined => undefined

export function enginePropsFromTree(
  node: unknown,
): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = enginePropsFromTree(child)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (!isPlainRecord(node)) return undefined
  if (node.type === 'engine') {
    return isPlainRecord(node.props) ? node.props : undefined
  }
  if (node.children !== undefined) {
    const hit = enginePropsFromTree(node.children)
    if (hit !== undefined) return hit
  }
  if (isPlainRecord(node.props) && node.props.children !== undefined) {
    return enginePropsFromTree(node.props.children)
  }
  return undefined
}

export type UiRenderHostResult = {
  props: Record<string, unknown>
  pluginTree?: unknown
  pluginName?: string
  /** densable t7t `drawPending` — true on initial mount when `hasHook && !staticFrame` until first evaluation settles. */
  drawPending: boolean
  /** densable t7t `minHeight` — held row height when off-screen (`onScreen === null`). */
  minHeight?: number
  /** densable t7t `ref:u` — attach to the card Box for g2e onScreen. */
  hostRef: RefObject<unknown>
}

/**
 * densable `ac.useRenderInput` + `ac.useRenderHook` analog: evaluateUiRender
 * for a terminal ui.render component, then expose rewritten engine props or
 * a plugin tree. When no hook matches, returns the engine props unchanged.
 */
export function useUiRenderHost(opts: {
  component: string
  requestId: string
  props: Record<string, unknown>
  viewport: { columns: number; rows: number; isFullscreen?: boolean }
}): UiRenderHostResult {
  const staticFrame = useContext(StaticRenderContext)
  const isFullscreen = opts.viewport.isFullscreen ?? isFullscreenEnvEnabled()
  const panesViewport = useSyncExternalStore(
    typeof functionHooksModules.subscribePanes === 'function'
      ? functionHooksModules.subscribePanes
      : noopSubscribePanes,
    typeof functionHooksModules.getPanesTerminalSize === 'function'
      ? functionHooksModules.getPanesTerminalSize
      : noopGetPanesSize,
    typeof functionHooksModules.getPanesTerminalSize === 'function'
      ? functionHooksModules.getPanesTerminalSize
      : noopGetPanesSize,
  )
  const effectiveColumns =
    panesViewport?.conversationColumns ?? opts.viewport.columns
  const effectiveRows = panesViewport?.rows ?? opts.viewport.rows
  const hasHook = hasMatchingFunctionHook('ui.render', {
    component: opts.component,
    surface: 'terminal',
    props: opts.props,
  })
  const engineDrewRef = useRef(false)
  if (!hasHook) {
    engineDrewRef.current = true
  }
  const { subscribeFrames } = useApp()
  const measure =
    !staticFrame && isFullscreen && isG2eComponent(opts.component) && hasHook
  const siteId = `${opts.component}\0${opts.requestId}`
  const {
    ref: hostRef,
    lastRows,
    contentRows,
    onScreen,
  } = useSiteMeasure(measure, siteId, subscribeFrames)
  const renderProps =
    onScreen !== undefined ? { ...opts.props, onScreen } : opts.props
  const renderVer = useSyncExternalStore(
    subscribeRenderInvalidation,
    getUiRenderVersion,
    getUiRenderVersion,
  )
  const propsRef = useRef(renderProps)
  // Only compare when a plugin consumes this card. Cyclic objects and BigInt
  // are valid engine inputs and must not pass through JSON serialization.
  if (!hasHook || !isDeepStrictEqual(propsRef.current, renderProps)) {
    propsRef.current = renderProps
  }
  const stableProps = propsRef.current
  const evalKey = useMemo(
    () => (hasHook ? {} : null),
    [
      hasHook,
      opts.component,
      opts.requestId,
      effectiveColumns,
      effectiveRows,
      isFullscreen,
      renderVer,
      hasHook ? stableProps : null,
    ],
  )
  const [settled, setSettled] = useState<
    | {
        drawn: unknown
        engineProps?: Record<string, unknown>
        pluginTree?: unknown
        pluginName?: string
      }
    | undefined
  >(undefined)

  const hadHookRef = useRef(false)

  useEffect(() => {
    if (!hasHook) {
      if (hadHookRef.current) {
        hadHookRef.current = false
        setSettled(undefined)
      }
      return
    }
    hadHookRef.current = true
    if (staticFrame) return
    let cancelled = false
    const abort = new AbortController()
    const eventPayload: Record<string, unknown> = {
      surface: 'terminal',
      component: opts.component,
      requestId: opts.requestId,
      viewport: {
        columns: effectiveColumns,
        rows: effectiveRows,
        isFullscreen,
      },
      props: renderProps,
    }
    void evaluateUiRender(eventPayload, abort.signal).then(
      answer => {
        if (cancelled) return
        const engineProps = enginePropsFromTree(answer)
        const pluginTree = hasRenderablePluginNode(answer) ? answer : undefined
        const drawn = pluginTree !== undefined ? answer : RZ
        setSettled({
          drawn,
          engineProps,
          pluginTree,
          pluginName:
            extractDrawnPlugin(answer, opts.component, opts.requestId) ??
            (getLastUiRenderPlugin() || undefined),
        })
      },
      err => {
        logForDebugging(
          `ui.render (${opts.component} ${opts.requestId}): site failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        )
        if (!cancelled) {
          setSettled({ drawn: RZ })
        }
      },
    )
    return () => {
      cancelled = true
      abort.abort()
    }
    // evalKey identifies component/requestId/viewport/props/version together.
  }, [evalKey, hasHook, staticFrame])

  if (isEngineFallback(settled?.drawn)) {
    engineDrewRef.current = true
  }
  const canDrawFallback = engineDrewRef.current || staticFrame
  const drawPending = hasHook && settled === undefined && !canDrawFallback
  const minHeight = useHeldSiteRows({
    isOff: siteIsOff(hasHook, { props: renderProps }),
    input: hasHook ? stableProps : undefined,
    drawn: settled?.drawn,
    isFallback: isEngineFallback(settled?.drawn),
    lastRows,
    contentRows,
  })
  useEffect(() => {
    if (minHeight !== undefined) {
      noteHeldRows(siteId, onScreen, minHeight)
    }
  }, [minHeight, settled?.drawn, siteId, onScreen])

  return {
    props:
      hasHook && settled?.engineProps !== undefined
        ? settled.engineProps
        : renderProps,
    ...(hasHook && settled !== undefined
      ? {
          pluginTree: settled.pluginTree,
          pluginName: settled.pluginName,
        }
      : {}),
    drawPending,
    minHeight,
    hostRef,
  }
}
