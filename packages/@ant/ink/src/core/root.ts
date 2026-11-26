import type { ReactNode } from 'react'
import { Stream } from 'stream'
import type { FrameEvent } from './frame.js'
import Ink, { type Options as InkOptions } from './ink.js'
import { inkSessionHost, Ns, runWithInkSessionHost } from './instances.js'
import { isNativeCursorEnabled } from './terminal.js'

export type RenderOptions = {
  /**
   * Output stream where app will be rendered.
   *
   * @default process.stdout
   */
  stdout?: NodeJS.WriteStream
  /**
   * Input stream where app will listen for input.
   *
   * @default process.stdin
   */
  stdin?: NodeJS.ReadStream
  /**
   * Error stream.
   * @default process.stderr
   */
  stderr?: NodeJS.WriteStream
  /**
   * Configure whether Ink should listen to Ctrl+C keyboard input and exit the app. This is needed in case `process.stdin` is in raw mode, because then Ctrl+C is ignored by default and process is expected to handle it manually.
   *
   * @default true
   */
  exitOnCtrlC?: boolean

  /**
   * Patch console methods to ensure console output doesn't mix with Ink output.
   *
   * @default true
   */
  patchConsole?: boolean

  /**
   * Called after each frame render with timing and flicker information.
   */
  onFrame?: (event: FrameEvent) => void

  /**
   * Official isScreenReaderEnabled — when true, Ink prefers screen-reader
   * friendly rendering (keep native cursor; full onRenderScreenReader denser).
   * Set by getBaseRenderOptions from CLAUDE_AX_SCREEN_READER / --ax-screen-reader / settings.
   */
  isScreenReaderEnabled?: boolean
  /** densable `eD()` — `et()` / createRoot pin. */
  nativeCursor?: boolean
  /** Official 2.1.328 (`pressClock`) — monotonic clock for InputGate press timing. */
  pressClock?: () => number
  /** Official 2.1.328 (`timesPresses`) — enables early-key InputGate dropping when true. */
  timesPresses?: () => boolean
  /** Official 2.1.328 (`newRenderer`) — enables the covering/inline/fullscreen byte renderer + IncrementalPainter. */
  newRenderer?: boolean
}

export type Instance = {
  /**
   * Replace previous root node with a new one or update props of the current root node.
   */
  rerender: Ink['render']
  /**
   * Manually unmount the whole Ink app.
   */
  unmount: Ink['unmount']
  /**
   * Returns a promise, which resolves when app is unmounted.
   */
  waitUntilExit: Ink['waitUntilExit']
  cleanup: () => void
  /**
   * Prevent unmount from disabling raw mode (caller will take over stdin).
   */
  handoffRawMode: Ink['handoffRawMode']
}

/**
 * A managed Ink root, similar to react-dom's createRoot API.
 * Separates instance creation from rendering so the same root
 * can be reused for multiple sequential screens.
 */
export type Root = {
  render: (node: ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
  handoffRawMode: () => void
  handoffAltScreen: () => void
}

/**
 * Mount a component and render the output.
 */
export const renderSync = (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Instance => {
  const opts = getOptions(options)
  const inkOptions: InkOptions = {
    stdout: process.stdout,
    stdin: process.stdin,
    stderr: process.stderr,
    exitOnCtrlC: true,
    patchConsole: true,
    ...opts,
    nativeCursor: opts.nativeCursor ?? isNativeCursorEnabled(),
  }

  const mountedHost = inkSessionHost()
  const registry = Ns()
  const instance: Ink = getInstance(
    inkOptions.stdout,
    () => new Ink(inkOptions),
    registry,
  )

  instance.render(node)

  return {
    rerender: instance.render,
    unmount(error?: Error | number | null) {
      runWithInkSessionHost(mountedHost, () => instance.unmount(error))
    },
    waitUntilExit: instance.waitUntilExit,
    cleanup: () => registry.delete(inkOptions.stdout),
    handoffRawMode: () => instance.handoffRawMode(),
  }
}

const wrappedRender = async (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> => {
  // densable pAS: wait out claimed standalone consent render before mounting.
  while (Ns().pendingStandaloneRender) {
    await Ns().pendingStandaloneRender
  }
  // Preserve the microtask boundary that `await loadYoga()` used to provide.
  // Without it, the first render fires synchronously before async startup work
  // (e.g. useReplBridge notification state) settles, and the subsequent Static
  // write overwrites scrollback instead of appending below the logo.
  await Promise.resolve()
  const instance = renderSync(node, options)
  if (process.env.CLAUDE_CODE_DEBUG_REPAINTS === '1') {
    console.warn(
      `[render] first ink render: ${Math.round(process.uptime() * 1000)}ms since process start`,
    )
  }
  return instance
}

export default wrappedRender

/**
 * Create an Ink root without rendering anything yet.
 * Like react-dom's createRoot — call root.render() to mount a tree.
 */
export async function createRoot({
  stdout = process.stdout,
  stdin = process.stdin,
  stderr = process.stderr,
  exitOnCtrlC = true,
  patchConsole = true,
  onFrame,
  isScreenReaderEnabled,
  nativeCursor,
  pressClock,
  timesPresses,
  newRenderer,
}: RenderOptions = {}): Promise<Root> {
  // See wrappedRender — preserve microtask boundary from the old WASM await.
  await Promise.resolve()
  // densable createRoot: while (Yp.pendingStandaloneRender) await …
  while (Ns().pendingStandaloneRender) {
    await Ns().pendingStandaloneRender
  }
  const mountedHost = inkSessionHost()
  const registry = Ns()
  const instance = new Ink({
    stdout,
    stdin,
    stderr,
    exitOnCtrlC,
    patchConsole,
    onFrame,
    isScreenReaderEnabled,
    nativeCursor: nativeCursor ?? isNativeCursorEnabled(),
    pressClock,
    timesPresses,
    newRenderer,
  })

  // Register in the active host's Ns() map so that code that looks up the Ink
  // instance by stdout (e.g. external editor pause/resume) can find it.
  registry.set(stdout, instance)

  return {
    render: node => instance.render(node),
    unmount: () => runWithInkSessionHost(mountedHost, () => instance.unmount()),
    waitUntilExit: () => instance.waitUntilExit(),
    handoffRawMode: () => instance.handoffRawMode(),
    handoffAltScreen: () => instance.handoffAltScreen(),
  }
}

const getOptions = (
  stdout: NodeJS.WriteStream | RenderOptions | undefined = {},
): RenderOptions => {
  if (stdout instanceof Stream) {
    return {
      stdout,
      stdin: process.stdin,
    }
  }

  return stdout
}

const getInstance = (
  stdout: NodeJS.WriteStream,
  createInstance: () => Ink,
  registry = Ns(),
): Ink => {
  let instance = registry.get(stdout)

  if (!instance) {
    instance = createInstance()
    registry.set(stdout, instance)
  }

  return instance
}
