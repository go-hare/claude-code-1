import { useCallback, useEffect, useRef } from 'react'
import type { InputEvent } from '../core/events/input-event.js'
import { type Key } from '../core/events/input-event.js'
import useInput from '../hooks/use-input.js'
import { useOptionalKeybindingContext } from './KeybindingContext.js'
import type { KeybindingContextName } from './types.js'

type Options = {
  /** Which context this binding belongs to (default: 'Global') */
  context?: KeybindingContextName
  /** Only handle when active (like useInput's isActive) */
  isActive?: boolean
}

/**
 * Ink-native hook for handling a keybinding.
 *
 * The handler stays in the component (React way).
 * The binding (keystroke → action) comes from config.
 *
 * Supports chord sequences (e.g., "ctrl+k ctrl+s"). When a chord is started,
 * the hook will manage the pending state automatically.
 *
 * Uses stopImmediatePropagation() to prevent other handlers from firing
 * once this binding is handled.
 *
 * densable En: registry registration uses handler ref + singleKey:true so
 * ChordInterceptor can invoke without re-register thrash on every render.
 * Fork still keeps useInput for non-interceptor dispatch (TextInput paths).
 *
 * @example
 * ```tsx
 * useKeybinding('app:toggleTodos', () => {
 *   setShowTodos(prev => !prev)
 * }, { context: 'Global' })
 * ```
 */
export function useKeybinding(
  action: string,
  handler: () => void | false | Promise<void>,
  options: Options = {},
): void {
  const { context = 'Global', isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  // densable En: stable handler ref — register effect deps omit handler
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!keybindingContext || !isActive) return
    return keybindingContext.registerHandler({
      action,
      context,
      handler: () => handlerRef.current(),
      singleKey: true,
    })
  }, [action, context, keybindingContext, isActive])

  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      // If no keybinding context available, skip resolution
      if (!keybindingContext) return

      // Build context list: registered active contexts + this context + Global
      // More specific contexts (registered ones) take precedence over Global
      const contextsToCheck: KeybindingContextName[] = [
        ...keybindingContext.activeContexts,
        context,
        'Global',
      ]
      // Deduplicate while preserving order (first occurrence wins for priority)
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

      switch (result.type) {
        case 'match':
          // Chord completed (if any) - clear pending state
          keybindingContext.setPendingChord(null)
          if (result.action === action) {
            if (handlerRef.current() !== false) {
              event.stopImmediatePropagation()
            }
          }
          break
        case 'chord_started':
          // User started a chord sequence - update pending state
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case 'chord_cancelled':
          // Chord was cancelled (escape or invalid key)
          keybindingContext.setPendingChord(null)
          break
        case 'unbound':
          // Explicitly unbound - clear any pending chord
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case 'none':
          // No match - let other handlers try
          break
      }
    },
    [action, context, keybindingContext],
  )

  useInput(handleInput, { isActive })
}

/**
 * Handle multiple keybindings in one hook (reduces useInput calls).
 *
 * Supports chord sequences. When a chord is started, the hook will
 * manage the pending state automatically.
 *
 * densable no: re-register only when action key set changes (sorted join),
 * handlers via ref; singleKey:true for interceptor dispatch.
 *
 * @example
 * ```tsx
 * useKeybindings({
 *   'chat:submit': () => handleSubmit(),
 *   'chat:cancel': () => handleCancel(),
 * }, { context: 'Chat' })
 * ```
 */
export function useKeybindings(
  // Handler returning `false` means "not consumed" — the event propagates
  // to later useInput/useKeybindings handlers. Useful for fall-through:
  // e.g. ScrollKeybindingHandler's scroll:line* returns false when the
  // ScrollBox content fits (scroll is a no-op), letting a child component's
  // handler take the wheel event for list navigation instead. Promise<void>
  // is allowed for fire-and-forget async handlers (the `!== false` check
  // only skips propagation for a sync `false`, not a pending Promise).
  handlers: Record<string, () => void | false | Promise<void>>,
  options: Options = {},
): void {
  const { context = 'Global', isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  // densable no: handlers ref + action-key fingerprint
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const actionKeys = Object.keys(handlers).sort().join('|')

  useEffect(() => {
    if (!keybindingContext || !isActive) return

    const unregisterFns: Array<() => void> = []
    for (const action of Object.keys(handlersRef.current)) {
      unregisterFns.push(
        keybindingContext.registerHandler({
          action,
          context,
          handler: () => handlersRef.current[action]?.(),
          singleKey: true,
        }),
      )
    }

    return () => {
      for (const unregister of unregisterFns) {
        unregister()
      }
    }
  }, [context, actionKeys, keybindingContext, isActive])

  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      // If no keybinding context available, skip resolution
      if (!keybindingContext) return

      // Build context list: registered active contexts + this context + Global
      // More specific contexts (registered ones) take precedence over Global
      const contextsToCheck: KeybindingContextName[] = [
        ...keybindingContext.activeContexts,
        context,
        'Global',
      ]
      // Deduplicate while preserving order (first occurrence wins for priority)
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

      switch (result.type) {
        case 'match':
          // Chord completed (if any) - clear pending state
          keybindingContext.setPendingChord(null)
          if (result.action in handlersRef.current) {
            const handler = handlersRef.current[result.action]
            if (handler && handler() !== false) {
              event.stopImmediatePropagation()
            }
          }
          break
        case 'chord_started':
          // User started a chord sequence - update pending state
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case 'chord_cancelled':
          // Chord was cancelled (escape or invalid key)
          keybindingContext.setPendingChord(null)
          break
        case 'unbound':
          // Explicitly unbound - clear any pending chord
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case 'none':
          // No match - let other handlers try
          break
      }
    },
    [context, keybindingContext],
  )

  useInput(handleInput, { isActive })
}
