/**
 * User keybinding configuration loader with hot-reload support.
 *
 * Loads keybindings from ~/.claude/keybindings.json and watches
 * for changes to reload them automatically.
 *
 * NOTE: User keybinding customization is currently only available for
 * Anthropic employees (USER_TYPE === 'ant'). External users always
 * use the default bindings.
 */

import chokidar, { type FSWatcher } from 'chokidar'
import { readFileSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage, isENOENT } from '../utils/errors.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../utils/sessionHost.js'
import { createSignal, type Signal } from '../utils/signal.js'
import { jsonParse } from '../utils/slowOperations.js'
import { DEFAULT_BINDINGS } from './defaultBindings.js'
import { parseBindings, stripLostModifierBindings } from './parser.js'
import type { KeybindingBlock, ParsedBinding } from './types.js'
import {
  checkDuplicateKeysInJson,
  keepResolvedUserBindings,
  type KeybindingWarning,
  validateBindings,
} from './validate.js'

/**
 * Check if keybinding customization is enabled.
 *
 * Returns true if the tengu_keybinding_customization_release GrowthBook gate is enabled.
 *
 * This function is exported so other parts of the codebase (e.g., /doctor)
 * can check the same condition consistently.
 */
export function isKeybindingCustomizationEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_keybinding_customization_release',
    false,
  )
}

/**
 * Time in milliseconds to wait for file writes to stabilize.
 */
const FILE_STABILITY_THRESHOLD_MS = 500

/**
 * Polling interval for checking file stability.
 */
const FILE_STABILITY_POLL_INTERVAL_MS = 200

/**
 * Result of loading keybindings, including any validation warnings.
 */
export type KeybindingsLoadResult = {
  bindings: ParsedBinding[]
  warnings: KeybindingWarning[]
}

type KeybindingsHostState = {
  watcher: FSWatcher | null
  initialized: boolean
  disposed: boolean
  cachedBindings: ParsedBinding[] | null
  cachedWarnings: KeybindingWarning[]
  keybindingsChanged: Signal<[result: KeybindingsLoadResult]>
  /**
   * Tracks the date (YYYY-MM-DD) when we last logged a custom keybindings load event.
   * Used to ensure we fire the event at most once per day.
   */
  lastCustomBindingsLogDate: string | null
}

const keybindingsHostSlot = new HostSlot<KeybindingsHostState>(() => ({
  watcher: null,
  initialized: false,
  disposed: false,
  cachedBindings: null,
  cachedWarnings: [],
  keybindingsChanged: createSignal<[result: KeybindingsLoadResult]>(),
  lastCustomBindingsLogDate: null,
}))

function getKeybindingsHostState(): KeybindingsHostState {
  return keybindingsHostSlot.of(getBootstrapSessionHost())
}

/**
 * Log a telemetry event when custom keybindings are loaded, at most once per day.
 * This lets us estimate the percentage of users who customize their keybindings.
 */
function logCustomBindingsLoadedOncePerDay(userBindingCount: number): void {
  const state = getKeybindingsHostState()
  const today = new Date().toISOString().slice(0, 10)
  if (state.lastCustomBindingsLogDate === today) return
  state.lastCustomBindingsLogDate = today
  logEvent('tengu_custom_keybindings_loaded', {
    user_binding_count: userBindingCount,
  })
}

/**
 * Type guard to check if an object is a valid KeybindingBlock.
 */
function isKeybindingBlock(obj: unknown): obj is KeybindingBlock {
  if (typeof obj !== 'object' || obj === null) return false
  const b = obj as Record<string, unknown>
  return (
    typeof b.context === 'string' &&
    typeof b.bindings === 'object' &&
    b.bindings !== null
  )
}

/**
 * Type guard to check if an array contains only valid KeybindingBlocks.
 */
function isKeybindingBlockArray(arr: unknown): arr is KeybindingBlock[] {
  return Array.isArray(arr) && arr.every(isKeybindingBlock)
}

/**
 * Get the path to the user keybindings file.
 */
export function getKeybindingsPath(): string {
  return join(getClaudeConfigHomeDir(), 'keybindings.json')
}

/** densable 2.1.246 q — each issue under --debug. */
function logKeybindingValidationIssues(warnings: KeybindingWarning[]): void {
  if (warnings.length === 0) return
  logForDebugging(`[keybindings] Found ${warnings.length} validation issue(s)`)
  for (const warning of warnings) {
    logForDebugging(
      `[keybindings] [${warning.severity}] ${warning.message}${warning.suggestion ? ` \u2014 ${warning.suggestion}` : ''}`,
      { level: 'warn' },
    )
  }
}

/**
 * Parse default bindings (cached for performance).
 */
function getDefaultParsedBindings(): ParsedBinding[] {
  return parseBindings(DEFAULT_BINDINGS)
}

/**
 * Load and parse keybindings from user config file.
 * Returns merged default + user bindings along with validation warnings.
 *
 * For external users, always returns default bindings only.
 * User customization is currently gated to Anthropic employees.
 */
export async function loadKeybindings(): Promise<KeybindingsLoadResult> {
  const defaultBindings = getDefaultParsedBindings()

  // Skip user config loading for external users
  if (!isKeybindingCustomizationEnabled()) {
    return { bindings: defaultBindings, warnings: [] }
  }

  const userPath = getKeybindingsPath()

  try {
    const content = await readFile(userPath, 'utf-8')
    const parsed: unknown = jsonParse(content)

    // Extract bindings array from object wrapper format: { "bindings": [...] }
    let userBlocks: unknown
    if (typeof parsed === 'object' && parsed !== null && 'bindings' in parsed) {
      userBlocks = (parsed as { bindings: unknown }).bindings
    } else {
      // Invalid format - missing bindings property
      const errorMessage = 'keybindings.json must have a "bindings" array'
      const suggestion = 'Use format: { "bindings": [ ... ] }'
      logForDebugging(`[keybindings] Invalid keybindings.json: ${errorMessage}`)
      return {
        bindings: defaultBindings,
        warnings: [
          {
            type: 'parse_error',
            severity: 'error',
            message: errorMessage,
            suggestion,
          },
        ],
      }
    }

    // Validate structure - bindings must be an array of valid keybinding blocks
    if (!isKeybindingBlockArray(userBlocks)) {
      const errorMessage = !Array.isArray(userBlocks)
        ? '"bindings" must be an array'
        : 'keybindings.json contains invalid block structure'
      const suggestion = !Array.isArray(userBlocks)
        ? 'Set "bindings" to an array of keybinding blocks'
        : 'Each block must have "context" (string) and "bindings" (object)'
      logForDebugging(`[keybindings] Invalid keybindings.json: ${errorMessage}`)
      return {
        bindings: defaultBindings,
        warnings: [
          {
            type: 'parse_error',
            severity: 'error',
            message: errorMessage,
            suggestion,
          },
        ],
      }
    }

    const userParsed = keepResolvedUserBindings(
      parseBindings(stripLostModifierBindings(userBlocks)),
    )
    logForDebugging(
      `[keybindings] Loaded ${userParsed.length} user bindings from ${userPath}`,
    )

    // User bindings come after defaults, so they override
    const mergedBindings = [...defaultBindings, ...userParsed]

    logCustomBindingsLoadedOncePerDay(userParsed.length)

    // Run validation on user config
    // First check for duplicate keys in raw JSON (JSON.parse silently drops earlier values)
    const duplicateKeyWarnings = checkDuplicateKeysInJson(content)
    const warnings = [
      ...duplicateKeyWarnings,
      ...validateBindings(userBlocks, mergedBindings),
    ]

    logKeybindingValidationIssues(warnings)

    return { bindings: mergedBindings, warnings }
  } catch (error) {
    // File doesn't exist - use defaults (user can run /keybindings to create)
    if (isENOENT(error)) {
      return { bindings: defaultBindings, warnings: [] }
    }

    // Other error - log and return defaults with warning
    logForDebugging(
      `[keybindings] Error loading ${userPath}: ${errorMessage(error)}`,
    )
    return {
      bindings: defaultBindings,
      warnings: [
        {
          type: 'parse_error',
          severity: 'error',
          message: `Failed to parse keybindings.json: ${errorMessage(error)}`,
        },
      ],
    }
  }
}

/**
 * Load keybindings synchronously (for initial render).
 * Uses cached value if available.
 */
export function loadKeybindingsSync(): ParsedBinding[] {
  const state = getKeybindingsHostState()
  if (state.cachedBindings) {
    return state.cachedBindings
  }

  const result = loadKeybindingsSyncWithWarnings()
  return result.bindings
}

/**
 * Load keybindings synchronously with validation warnings.
 * Uses cached values if available.
 *
 * For external users, always returns default bindings only.
 * User customization is currently gated to Anthropic employees.
 */
export function loadKeybindingsSyncWithWarnings(): KeybindingsLoadResult {
  const state = getKeybindingsHostState()
  if (state.cachedBindings) {
    return { bindings: state.cachedBindings, warnings: state.cachedWarnings }
  }

  const defaultBindings = getDefaultParsedBindings()

  // Skip user config loading for external users
  if (!isKeybindingCustomizationEnabled()) {
    state.cachedBindings = defaultBindings
    state.cachedWarnings = []
    return { bindings: state.cachedBindings, warnings: state.cachedWarnings }
  }

  const userPath = getKeybindingsPath()

  try {
    // sync IO: called from sync context (React useState initializer)
    const content = readFileSync(userPath, 'utf-8')
    const parsed: unknown = jsonParse(content)

    // Extract bindings array from object wrapper format: { "bindings": [...] }
    let userBlocks: unknown
    if (typeof parsed === 'object' && parsed !== null && 'bindings' in parsed) {
      userBlocks = (parsed as { bindings: unknown }).bindings
    } else {
      // Invalid format - missing bindings property
      state.cachedBindings = defaultBindings
      state.cachedWarnings = [
        {
          type: 'parse_error',
          severity: 'error',
          message: 'keybindings.json must have a "bindings" array',
          suggestion: 'Use format: { "bindings": [ ... ] }',
        },
      ]
      return { bindings: state.cachedBindings, warnings: state.cachedWarnings }
    }

    // Validate structure - bindings must be an array of valid keybinding blocks
    if (!isKeybindingBlockArray(userBlocks)) {
      const errorMessage = !Array.isArray(userBlocks)
        ? '"bindings" must be an array'
        : 'keybindings.json contains invalid block structure'
      const suggestion = !Array.isArray(userBlocks)
        ? 'Set "bindings" to an array of keybinding blocks'
        : 'Each block must have "context" (string) and "bindings" (object)'
      state.cachedBindings = defaultBindings
      state.cachedWarnings = [
        {
          type: 'parse_error',
          severity: 'error',
          message: errorMessage,
          suggestion,
        },
      ]
      return { bindings: state.cachedBindings, warnings: state.cachedWarnings }
    }

    const userParsed = keepResolvedUserBindings(
      parseBindings(stripLostModifierBindings(userBlocks)),
    )
    logForDebugging(
      `[keybindings] Loaded ${userParsed.length} user bindings from ${userPath}`,
    )
    state.cachedBindings = [...defaultBindings, ...userParsed]

    logCustomBindingsLoadedOncePerDay(userParsed.length)

    // Run validation - check for duplicate keys in raw JSON first
    const duplicateKeyWarnings = checkDuplicateKeysInJson(content)
    state.cachedWarnings = [
      ...duplicateKeyWarnings,
      ...validateBindings(userBlocks, state.cachedBindings),
    ]
    logKeybindingValidationIssues(state.cachedWarnings)

    return { bindings: state.cachedBindings, warnings: state.cachedWarnings }
  } catch {
    // File doesn't exist or error - use defaults (user can run /keybindings to create)
    state.cachedBindings = defaultBindings
    state.cachedWarnings = []
    return { bindings: state.cachedBindings, warnings: state.cachedWarnings }
  }
}

/**
 * Initialize file watching for keybindings.json.
 * Call this once when the app starts.
 *
 * For external users, this is a no-op since user customization is disabled.
 */
export async function initializeKeybindingWatcher(): Promise<void> {
  const state = getKeybindingsHostState()
  if (state.initialized || state.disposed) return

  // Skip file watching for external users
  if (!isKeybindingCustomizationEnabled()) {
    logForDebugging(
      '[keybindings] Skipping file watcher - user customization disabled',
    )
    return
  }

  const userPath = getKeybindingsPath()
  const watchDir = dirname(userPath)

  // Only watch if parent directory exists
  try {
    const stats = await stat(watchDir)
    if (!stats.isDirectory()) {
      logForDebugging(
        `[keybindings] Not watching: ${watchDir} is not a directory`,
      )
      return
    }
  } catch {
    logForDebugging(`[keybindings] Not watching: ${watchDir} does not exist`)
    return
  }

  if (state.initialized || state.disposed) return

  // Set initialized only after we've confirmed we can watch
  state.initialized = true

  logForDebugging(`[keybindings] Watching for changes to ${userPath}`)

  const capturedSession = getActiveSessionFromAls()
  const runInHost = <T>(fn: () => T): T =>
    capturedSession !== undefined &&
    getActiveSessionFromAls() !== capturedSession
      ? runWithSession(capturedSession, fn)
      : fn()

  // densable: usePolling + interval:2000 (keybinding watcher always polls)
  const watcher = chokidar.watch(userPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: FILE_STABILITY_THRESHOLD_MS,
      pollInterval: FILE_STABILITY_POLL_INTERVAL_MS,
    },
    ignorePermissionErrors: true,
    usePolling: true,
    interval: 2000,
    atomic: true,
  })
  state.watcher = watcher

  watcher.on('add', p => void runInHost(() => handleChange(state, p)))
  watcher.on('change', p => void runInHost(() => handleChange(state, p)))
  watcher.on('unlink', p => runInHost(() => handleDelete(state, p)))
  // densable #14: unhandled chokidar 'error' can crash process
  watcher.on('error', (err: unknown) => {
    runInHost(() => {
      logForDebugging(`[keybindings] watcher error: ${errorMessage(err)}`, {
        level: 'warn',
      })
    })
  })

  // Register cleanup
  registerCleanup(async () => runInHost(() => disposeKeybindingWatcher()))
}

/**
 * Clean up the file watcher.
 * densable teardown: null ref before close to avoid race on concurrent error.
 */
export function disposeKeybindingWatcher(): void {
  const state = getKeybindingsHostState()
  state.disposed = true
  const previous = state.watcher
  state.watcher = null
  if (previous) {
    void previous.close()
  }
  state.keybindingsChanged.clear()
}

/**
 * Subscribe to keybinding changes.
 * The listener receives the new parsed bindings when the file changes.
 */
export function subscribeToKeybindingChanges(
  listener: (result: KeybindingsLoadResult) => void,
): () => void {
  return getKeybindingsHostState().keybindingsChanged.subscribe(listener)
}

async function handleChange(
  state: KeybindingsHostState,
  path: string,
): Promise<void> {
  logForDebugging(`[keybindings] Detected change to ${path}`)

  try {
    const result = await loadKeybindings()
    state.cachedBindings = result.bindings
    state.cachedWarnings = result.warnings

    // Notify all listeners with the full result
    state.keybindingsChanged.emit(result)
  } catch (error) {
    logForDebugging(`[keybindings] Error reloading: ${errorMessage(error)}`)
  }
}

function handleDelete(state: KeybindingsHostState, path: string): void {
  logForDebugging(`[keybindings] Detected deletion of ${path}`)

  // Reset to defaults when file is deleted
  const defaultBindings = getDefaultParsedBindings()
  state.cachedBindings = defaultBindings
  state.cachedWarnings = []

  state.keybindingsChanged.emit({ bindings: defaultBindings, warnings: [] })
}

/**
 * Get the cached keybinding warnings.
 * Returns empty array if no warnings or bindings haven't been loaded yet.
 */
export function getCachedKeybindingWarnings(): KeybindingWarning[] {
  return (
    keybindingsHostSlot.peek(getBootstrapSessionHost())?.cachedWarnings ?? []
  )
}
