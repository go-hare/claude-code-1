/* eslint-disable custom-rules/no-top-level-side-effects */

import createReconciler from 'react-reconciler'
import {
  appendChildNode,
  clearYogaNodeReferences,
  createNode,
  createTextNode,
  type DOMElement,
  type DOMNode,
  type DOMNodeAttribute,
  type ElementNames,
  insertBeforeNode,
  markDirty,
  removeChildNode,
  setAccessibility,
  setAttribute,
  setStyle,
  setTextNodeValue,
  setTextStyles,
  type DOMAccessibility,
  type TextNode,
} from './dom.js'
import { Dispatcher } from './events/dispatcher.js'
import {
  EVENT_HANDLER_PROPS,
  type EventHandlerProps,
} from './events/event-handlers.js'
import { getFocusManager, getRootNode } from './focus.js'
import { LayoutDisplay } from './layout/node.js'
import applyStyles, { type Styles, type TextStyles } from './styles.js'

// We need to conditionally perform devtools connection to avoid
// accidentally breaking other third-party code.
// See https://github.com/vadimdemedes/ink/issues/384
if (process.env.NODE_ENV === 'development') {
  try {
    // eslint-disable-next-line custom-rules/no-top-level-dynamic-import -- dev-only; NODE_ENV check is DCE'd in production
    void import('./devtools.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
    ) {
      console.warn(
        `
The environment variable DEV is set to true, so Ink tried to import \`react-devtools-core\`,
but this failed as it was not installed. Debugging with React Devtools requires it.

To install use this command:

$ npm install --save-dev react-devtools-core
				`.trim() + '\n',
      )
    } else {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw error
    }
  }
}

// --

type AnyObject = Record<string, unknown>

const diff = (before: AnyObject, after: AnyObject): AnyObject | undefined => {
  if (before === after) {
    return
  }

  if (!before) {
    return after
  }

  const changed: AnyObject = {}
  let isChanged = false

  for (const key of Object.keys(before)) {
    const isDeleted = after ? !Object.hasOwn(after, key) : true

    if (isDeleted) {
      changed[key] = undefined
      isChanged = true
    }
  }

  if (after) {
    for (const key of Object.keys(after)) {
      if (after[key] !== before[key]) {
        changed[key] = after[key]
        isChanged = true
      }
    }
  }

  return isChanged ? changed : undefined
}

const cleanupYogaNode = (node: DOMNode): void => {
  const yogaNode = node.yogaNode
  if (yogaNode) {
    yogaNode.unsetMeasureFunc()
    // Clear all references BEFORE freeing to prevent other code from
    // accessing freed WASM memory during concurrent operations
    clearYogaNodeReferences(node)
    yogaNode.freeRecursive()
  }
}

// --

type Props = Record<string, unknown>

type HostContext = {
  isInsideText: boolean
}

function setEventHandler<K extends keyof EventHandlerProps>(
  node: DOMElement,
  key: K,
  value: EventHandlerProps[K],
): void {
  if (!node._eventHandlers) {
    node._eventHandlers = {}
  }
  node._eventHandlers[key] = value
}

/** densable `ad` — handlers that hold stdin raw mode. */
const RAW_MODE_HANDLER_PROPS = new Set<string>([
  'onKeyDown',
  'onKeyDownCapture',
  'onPaste',
  'onPasteCapture',
  'onWheel',
  'onWheelCapture',
])

/** densable `EE` — true if any `ad` handler is non-null. */
function nodeHoldsRawMode(node: DOMElement): boolean {
  const handlers = node._eventHandlers
  if (!handlers) return false
  for (const key of RAW_MODE_HANDLER_PROPS) {
    if (handlers[key as keyof EventHandlerProps] != null) return true
  }
  return false
}

/** densable `fy` — `setRawMode(delta>0)` or accrue `_pendingRawModeDelta`. */
function applyRawModeDelta(host: DOMElement, delta: number): void {
  if (host.setRawMode) host.setRawMode(delta > 0)
  else host._pendingRawModeDelta = (host._pendingRawModeDelta ?? 0) + delta
}

/**
 * densable `sy(n,u)` — sync this node's raw-mode hold against the root host.
 * Not exported (gold is a local helper, not a public API).
 */
function syncRawModeHold(node: DOMElement, host: DOMElement): void {
  const holds = nodeHoldsRawMode(node)
  if (holds === !!node._holdsRawModeRef) return
  node._holdsRawModeRef = holds
  applyRawModeDelta(host, holds ? 1 : -1)
}

/** densable `hy` — release this subtree's raw-mode holds on unmount. */
function releaseRawModeHoldTree(node: DOMElement, host: DOMElement): void {
  if (node._holdsRawModeRef) {
    node._holdsRawModeRef = false
    applyRawModeDelta(host, -1)
  }
  for (const child of node.childNodes) {
    if (child.nodeName !== '#text') {
      releaseRawModeHoldTree(child, host)
    }
  }
}

function applyProp(node: DOMElement, key: string, value: unknown): void {
  if (key === 'children') return

  if (key === 'style') {
    setStyle(node, value as Styles)
    if (node.yogaNode) {
      applyStyles(node.yogaNode, value as Styles)
    }
    return
  }

  if (key === 'textStyles') {
    node.textStyles = value as TextStyles
    return
  }

  // densable: accessibility is a separate DOM field (jus), not attributes
  if (key === 'accessibility') {
    setAccessibility(node, value as DOMAccessibility | undefined)
    return
  }

  if (EVENT_HANDLER_PROPS.has(key)) {
    setEventHandler(
      node,
      key as keyof EventHandlerProps,
      value as EventHandlerProps[keyof EventHandlerProps],
    )
    return
  }

  setAttribute(node, key, value as DOMNodeAttribute)
}

// --

// react-reconciler's Fiber shape — only the fields we walk. The 5th arg to
// createInstance is the Fiber (`workInProgress` in react-reconciler.dev.js).
// _debugOwner is the component that rendered this element (dev builds only);
// return is the parent fiber (always present). We prefer _debugOwner since it
// skips past Box/Text wrappers to the actual named component.
type FiberLike = {
  elementType?: { displayName?: string; name?: string } | string | null
  _debugOwner?: FiberLike | null
  return?: FiberLike | null
}

export function getOwnerChain(fiber: unknown): string[] {
  const chain: string[] = []
  const seen = new Set<unknown>()
  let cur = fiber as FiberLike | null | undefined
  for (let i = 0; cur && i < 50; i++) {
    if (seen.has(cur)) break
    seen.add(cur)
    const t = cur.elementType
    const name =
      typeof t === 'function'
        ? (t as { displayName?: string; name?: string }).displayName ||
          (t as { displayName?: string; name?: string }).name
        : typeof t === 'string'
          ? undefined // host element (ink-box etc) — skip
          : t?.displayName || t?.name
    if (name && name !== chain[chain.length - 1]) chain.push(name)
    cur = cur._debugOwner ?? cur.return
  }
  return chain
}

let debugRepaints: boolean | undefined
export function isDebugRepaintsEnabled(): boolean {
  if (debugRepaints === undefined) {
    debugRepaints = process.env.CLAUDE_CODE_DEBUG_REPAINTS === '1'
  }
  return debugRepaints
}

export const dispatcher = new Dispatcher()

// --- SCROLL PROFILING (bench/scroll-e2e.sh reads via getLastYogaMs) ---
// Set by onComputeLayout wrapper in ink.tsx; read by onRender for phases.
let _lastYogaMs = 0
let _lastCommitMs = 0
let _commitStart = 0
export function recordYogaMs(ms: number): void {
  _lastYogaMs = ms
}
export function getLastYogaMs(): number {
  return _lastYogaMs
}
export function markCommitStart(): void {
  _commitStart = performance.now()
}
export function getLastCommitMs(): number {
  return _lastCommitMs
}
export function resetProfileCounters(): void {
  _lastYogaMs = 0
  _lastCommitMs = 0
  _commitStart = 0
}
// --- END ---

const reconciler = createReconciler<
  ElementNames,
  Props,
  DOMElement,
  DOMElement,
  TextNode,
  DOMElement,
  unknown,
  unknown,
  DOMElement,
  HostContext,
  null, // UpdatePayload - not used in React 19
  NodeJS.Timeout,
  -1,
  null
>({
  getRootHostContext: () => ({ isInsideText: false }),
  prepareForCommit: () => null,
  preparePortalMount: () => null,
  clearContainer: () => false,
  resetAfterCommit(rootNode) {
    // densable: let u=n.scrollCommitStartedAt; n.lastCommitMs=u===void 0?0:now-u;
    // n.scrollCommitStartedAt=void 0, n.layoutStale=!1, onComputeLayout(); onRender?.()
    const startedAt = rootNode.scrollCommitStartedAt
    rootNode.lastCommitMs =
      startedAt === undefined ? 0 : performance.now() - startedAt
    _lastCommitMs = rootNode.lastCommitMs
    rootNode.scrollCommitStartedAt = undefined
    rootNode.layoutStale = false
    if (typeof rootNode.onComputeLayout === 'function') {
      rootNode.onComputeLayout()
    }
    rootNode.onRender?.()
  },
  getChildHostContext(
    parentHostContext: HostContext,
    type: ElementNames,
  ): HostContext {
    const previousIsInsideText = parentHostContext.isInsideText
    const isInsideText =
      type === 'ink-text' || type === 'ink-virtual-text' || type === 'ink-link'

    if (previousIsInsideText === isInsideText) {
      return parentHostContext
    }

    return { isInsideText }
  },
  shouldSetTextContent: () => false,
  createInstance(
    originalType: ElementNames,
    newProps: Props,
    _root: DOMElement,
    hostContext: HostContext,
    internalHandle?: unknown,
  ): DOMElement {
    if (hostContext.isInsideText && originalType === 'ink-box') {
      throw new Error(`<Box> can't be nested inside <Text> component`)
    }

    const type =
      originalType === 'ink-text' && hostContext.isInsideText
        ? 'ink-virtual-text'
        : originalType

    // densable: x=_r(g,f.yogaNode?.config) — inherit root Config.create()
    const node = createNode(type, _root.yogaNode?.config)

    for (const [key, value] of Object.entries(newProps)) {
      applyProp(node, key, value)
    }

    // densable: sy(x,f) — raw-mode hold against the root container
    syncRawModeHold(node, _root)

    if (isDebugRepaintsEnabled()) {
      node.debugOwnerChain = getOwnerChain(internalHandle)
    }

    return node
  },
  createTextInstance(
    text: string,
    _root: DOMElement,
    hostContext: HostContext,
  ): TextNode {
    if (!hostContext.isInsideText) {
      throw new Error(
        `Text string "${text}" must be rendered inside <Text> component`,
      )
    }

    return createTextNode(text)
  },
  resetTextContent() {},
  hideTextInstance(node) {
    setTextNodeValue(node, '')
  },
  unhideTextInstance(node, text) {
    setTextNodeValue(node, text)
  },
  getPublicInstance: (instance): DOMElement => instance as DOMElement,
  hideInstance(node) {
    node.isHidden = true
    node.yogaNode?.setDisplay(LayoutDisplay.None)
    markDirty(node)
  },
  unhideInstance(node) {
    node.isHidden = false
    node.yogaNode?.setDisplay(LayoutDisplay.Flex)
    markDirty(node)
  },
  appendInitialChild: appendChildNode,
  appendChild: appendChildNode,
  insertBefore: insertBeforeNode,
  finalizeInitialChildren(
    _node: DOMElement,
    _type: ElementNames,
    props: Props,
  ): boolean {
    return props['autoFocus'] === true
  },
  commitMount(node: DOMElement): void {
    getFocusManager(node).handleAutoFocus(node)
  },
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentUpdatePriority: () => dispatcher.currentUpdatePriority,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  getInstanceFromNode: () => null,
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  appendChildToContainer: appendChildNode,
  insertInContainerBefore: insertBeforeNode,
  removeChildFromContainer(node: DOMElement, removeNode: DOMNode): void {
    removeChildNode(node, removeNode)
    cleanupYogaNode(removeNode)
    if (removeNode.nodeName === '#text') return
    getFocusManager(node).handleNodeRemoved(removeNode, node)
    // densable: hy(u,f)
    releaseRawModeHoldTree(removeNode, getRootNode(node))
  },
  // React 19 commitUpdate receives old and new props directly instead of an updatePayload
  commitUpdate(
    node: DOMElement,
    _type: ElementNames,
    oldProps: Props,
    newProps: Props,
  ): void {
    const props = diff(oldProps, newProps)
    const style = diff(oldProps['style'] as Styles, newProps['style'] as Styles)

    if (props) {
      let rawModeHandlersChanged = false
      for (const [key, value] of Object.entries(props)) {
        if (key === 'style') {
          setStyle(node, value as Styles)
          continue
        }

        if (key === 'textStyles') {
          setTextStyles(node, value as TextStyles)
          continue
        }

        if (key === 'accessibility') {
          setAccessibility(node, value as DOMAccessibility | undefined)
          continue
        }

        if (EVENT_HANDLER_PROPS.has(key)) {
          setEventHandler(
            node,
            key as keyof EventHandlerProps,
            value as EventHandlerProps[keyof EventHandlerProps],
          )
          if (RAW_MODE_HANDLER_PROPS.has(key)) rawModeHandlersChanged = true
          continue
        }

        setAttribute(node, key, value as DOMNodeAttribute)
      }
      // densable: if(g)sy(n,R7t(n))
      if (rawModeHandlersChanged) {
        syncRawModeHold(node, getRootNode(node))
      }
    }

    if (style && node.yogaNode) {
      applyStyles(node.yogaNode, style, newProps['style'] as Styles)
    }
  },
  commitTextUpdate(node: TextNode, _oldText: string, newText: string): void {
    setTextNodeValue(node, newText)
  },
  removeChild(node, removeNode) {
    removeChildNode(node, removeNode)
    cleanupYogaNode(removeNode)
    if (removeNode.nodeName !== '#text') {
      const root = getRootNode(node)
      root.focusManager!.handleNodeRemoved(removeNode, root)
      // densable: hy(u,f)
      releaseRawModeHoldTree(removeNode, root)
    }
  },
  // React 19 required methods
  maySuspendCommit(): boolean {
    return false
  },
  preloadInstance(): boolean {
    return true
  },
  startSuspendingCommit(): void {},
  suspendInstance(): void {},
  waitForCommitToBeReady(): null {
    return null
  },
  NotPendingTransition: null,
  HostTransitionContext: {
    $$typeof: Symbol.for('react.context'),
    _currentValue: null,
  } as never,
  setCurrentUpdatePriority(newPriority: number): void {
    dispatcher.currentUpdatePriority = newPriority
  },
  resolveUpdatePriority(): number {
    return dispatcher.resolveEventPriority()
  },
  resetFormInstance(): void {},
  requestPostPaintCallback(): void {},
  shouldAttemptEagerTransition(): boolean {
    return false
  },
  trackSchedulerEvent(): void {},
  resolveEventType(): string | null {
    return dispatcher.currentEvent?.type ?? null
  },
  resolveEventTimeStamp(): number {
    return dispatcher.currentEvent?.timeStamp ?? -1.1
  },
})

// Wire the reconciler's discreteUpdates into the dispatcher.
// This breaks the import cycle: dispatcher.ts doesn't import reconciler.ts.
dispatcher.discreteUpdates = reconciler.discreteUpdates.bind(reconciler)

export default reconciler
