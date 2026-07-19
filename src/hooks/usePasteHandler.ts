import { basename } from 'path'
import React from 'react'
import { logError } from 'src/utils/log.js'
import { useDebounceCallback } from 'usehooks-ts'
import { KeyboardEvent } from '@anthropic/ink'
import type { ParsedKey } from '@anthropic/ink'
import {
  getImageFromClipboard,
  isImageFilePath,
  PASTE_THRESHOLD,
  tryReadImageFromPath,
} from '../utils/imagePaste.js'
import type { ImageDimensions } from '../utils/imageResizer.js'
import { getPlatform } from '../utils/platform.js'

const CLIPBOARD_CHECK_DEBOUNCE_MS = 50
/** If pastePending sticks (async image hang / cancelled debounce), free Enter. */
const PASTE_PENDING_SAFETY_MS = 2000

type PasteHandlerProps = {
  onPaste?: (text: string) => void
  /** Official densable d7r: underlying KeyboardEvent handler after paste guards. */
  handleKeyDown: (event: KeyboardEvent) => void
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void
}

/**
 * Official densable 2.1.210 `d7r`:
 *   { handleKeyDown, handlePaste, isPasting } = d7r({ onPaste, handleKeyDown, onImagePaste })
 *
 * - handlePaste(PasteEvent): bracketed paste → image paths / clipboard / onPaste
 * - handleKeyDown wraps typed keys: swallow return while pasting; large
 *   non-bracketed key payloads (>pkt=800) route as paste
 * - empty paste → macOS/WSL clipboard image
 * - mid-paste Enter deferred then replayed via `_()` after text paste
 *
 * Fork hardening: pastePending must never stick forever — that silently
 * swallows every subsequent Enter (onSubmit never runs).
 */
export function usePasteHandler({
  onPaste,
  handleKeyDown: innerHandleKeyDown,
  onImagePaste,
}: PasteHandlerProps): {
  handleKeyDown: (event: KeyboardEvent) => void
  handlePaste: (event: { text: string; preventDefault: () => void }) => void
  isPasting: boolean
} {
  const [isPasting, setIsPasting] = React.useState(false)
  const isMountedRef = React.useRef(true)
  // Official d7r: l.current = paste pending; c.current = deferred return
  const pastePendingRef = React.useRef(false)
  const deferredReturnRef = React.useRef(false)
  const pastePendingSinceRef = React.useRef(0)
  const safetyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const innerKeyDownRef = React.useRef(innerHandleKeyDown)
  innerKeyDownRef.current = innerHandleKeyDown

  // Official: Mt()==="macos" / Mt()==="wsl"
  const isMacOS = React.useMemo(() => getPlatform() === 'macos', [])
  const isWsl = React.useMemo(() => getPlatform() === 'wsl', [])
  const canClipboardImage = isMacOS || isWsl

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current)
        safetyTimerRef.current = null
      }
    }
  }, [])

  const clearSafetyTimer = React.useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
  }, [])

  /** Always clear pending refs (even if unmounted); setState only when mounted. */
  const finishPaste = React.useCallback(() => {
    pastePendingRef.current = false
    deferredReturnRef.current = false
    pastePendingSinceRef.current = 0
    clearSafetyTimer()
    if (isMountedRef.current) {
      setIsPasting(false)
    }
  }, [clearSafetyTimer])

  const markPastePending = React.useCallback(() => {
    pastePendingRef.current = true
    pastePendingSinceRef.current = Date.now()
    clearSafetyTimer()
    // Hard upper bound so a hung clipboard/image path cannot swallow Enter forever.
    safetyTimerRef.current = setTimeout(() => {
      if (pastePendingRef.current) {
        pastePendingRef.current = false
        deferredReturnRef.current = false
        pastePendingSinceRef.current = 0
        if (isMountedRef.current) {
          setIsPasting(false)
        }
      }
    }, PASTE_PENDING_SAFETY_MS)
  }, [clearSafetyTimer])

  const checkClipboardForImageImpl = React.useCallback(() => {
    if (!onImagePaste) {
      finishPaste()
      return
    }
    if (!isMountedRef.current) {
      finishPaste()
      return
    }

    void getImageFromClipboard()
      .then(imageData => {
        if (imageData && isMountedRef.current) {
          onImagePaste(
            imageData.base64,
            imageData.mediaType,
            undefined,
            imageData.dimensions,
          )
        }
      })
      .catch(error => {
        if (isMountedRef.current) {
          logError(error as Error)
        }
      })
      .finally(() => {
        finishPaste()
      })
  }, [onImagePaste, finishPaste])

  const checkClipboardForImage = useDebounceCallback(
    checkClipboardForImageImpl,
    CLIPBOARD_CHECK_DEBOUNCE_MS,
  )

  /**
   * Official d7r `g(w)`:
   *   if (onPaste) onPaste(w)
   *   else innerHandleKeyDown(new KeyboardEvent({ sequence:w, isPasted:true, name:undefined }))
   */
  const deliverText = React.useCallback(
    (text: string) => {
      if (onPaste) {
        onPaste(text)
        return
      }
      // No onPaste → synthesize paste-as-key for inner handleKeyDown (insert path).
      const pasteKey: ParsedKey = {
        kind: 'key',
        name: undefined,
        sequence: text,
        raw: text,
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        super: false,
        fn: false,
        isPasted: true,
      }
      innerKeyDownRef.current(new KeyboardEvent(pasteKey))
    },
    [onPaste],
  )

  /**
   * Official d7r `_()`: after text paste, re-fire return if Enter arrived mid-paste.
   * Clears pastePending inside the timeout (same tick semantics as densable).
   */
  const maybeReplayReturn = React.useCallback(() => {
    clearSafetyTimer()
    if (isMountedRef.current) {
      setIsPasting(false)
    }
    // Defer so React state for the pasted text commits first.
    setTimeout(() => {
      // Official: l.current = !1 always; then if c.current → replay return
      pastePendingRef.current = false
      pastePendingSinceRef.current = 0
      if (!isMountedRef.current) {
        deferredReturnRef.current = false
        return
      }
      if (!deferredReturnRef.current) return
      deferredReturnRef.current = false
      const returnKey: ParsedKey = {
        kind: 'key',
        name: 'return',
        sequence: '\r',
        raw: '\r',
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        super: false,
        fn: false,
        isPasted: false,
      }
      innerKeyDownRef.current(new KeyboardEvent(returnKey))
    }, 0)
  }, [clearSafetyTimer])

  const processPastedText = React.useCallback(
    (rawText: string) => {
      markPastePending()
      try {
        const pastedText = rawText.replace(/\[I$/, '').replace(/\[O$/, '')

        // Empty bracketed paste → clipboard image (macOS / WSL official).
        if (pastedText.length === 0 && canClipboardImage && onImagePaste) {
          checkClipboardForImage()
          return
        }

        const lines = pastedText
          .split(/ (?=\/|[A-Za-z]:\\)/)
          .flatMap(part => part.split('\n'))
          .filter(line => line.trim())
        const imagePaths = lines.filter(line => isImageFilePath(line))

        if (onImagePaste && imagePaths.length > 0) {
          const isTempScreenshot =
            /\/TemporaryItems\/.*screencaptureui.*\/Screenshot/i.test(
              pastedText,
            )

          void Promise.all(
            imagePaths.map(imagePath => tryReadImageFromPath(imagePath)),
          )
            .then(results => {
              if (!isMountedRef.current) {
                finishPaste()
                return
              }

              const validImages = results.filter(
                (r): r is NonNullable<typeof r> => r !== null,
              )

              if (validImages.length > 0) {
                for (const imageData of validImages) {
                  const filename = basename(imageData.path)
                  onImagePaste(
                    imageData.base64,
                    imageData.mediaType,
                    filename,
                    imageData.dimensions,
                    imageData.path,
                  )
                }
                const nonImageLines = lines.filter(
                  line => !isImageFilePath(line),
                )
                if (nonImageLines.length > 0) {
                  deliverText(nonImageLines.join('\n'))
                }
                finishPaste()
              } else if (isTempScreenshot && isMacOS) {
                checkClipboardForImage()
              } else {
                try {
                  deliverText(pastedText)
                } finally {
                  finishPaste()
                }
              }
            })
            .catch(error => {
              if (isMountedRef.current) {
                logError(error as Error)
                try {
                  deliverText(pastedText)
                } finally {
                  finishPaste()
                }
              } else {
                finishPaste()
              }
            })
          return
        }

        // Official: g(x), _() — text paste may re-fire return that arrived mid-paste.
        // pastePending is cleared inside maybeReplayReturn's timeout (not here).
        try {
          deliverText(pastedText)
        } catch (error) {
          logError(error as Error)
          finishPaste()
          return
        }
        maybeReplayReturn()
      } catch (error) {
        logError(error as Error)
        finishPaste()
      }
    },
    [
      canClipboardImage,
      checkClipboardForImage,
      deliverText,
      finishPaste,
      isMacOS,
      markPastePending,
      maybeReplayReturn,
      onImagePaste,
    ],
  )

  // Official d7r handlePaste S(w)
  const handlePaste = React.useCallback(
    (event: { text: string; preventDefault: () => void }) => {
      event.preventDefault()
      if (isMountedRef.current) {
        setIsPasting(true)
      }
      processPastedText(event.text)
    },
    [processPastedText],
  )

  // Official d7r handleKeyDown b(w):
  //   if (l.current && w.key === "return") { prevent; c.current = true; return }
  //   if ((onPaste||onImagePaste) && !ctrl && !meta && w.key.length > pkt && !defaultPrevented)
  //     → treat as paste
  //   else inner(w)
  const handleKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      // Stuck-pending safety: if async paste never finished, release Enter.
      if (
        pastePendingRef.current &&
        pastePendingSinceRef.current > 0 &&
        Date.now() - pastePendingSinceRef.current > PASTE_PENDING_SAFETY_MS
      ) {
        finishPaste()
      }

      // Official densable uses event.key === "return" (KeyboardEvent.key from fag).
      if (pastePendingRef.current && event.key === 'return') {
        event.preventDefault()
        deferredReturnRef.current = true
        return
      }
      // Non-bracketed large payload → treat as paste (official pkt=800).
      // Empty key (SGR residue emptied by fag) never enters pastePending —
      // that path would swallow subsequent Enter until safety timeout.
      if (
        (onPaste || onImagePaste) &&
        !event.ctrl &&
        !event.meta &&
        event.key.length > PASTE_THRESHOLD &&
        !event.defaultPrevented
      ) {
        event.preventDefault()
        if (isMountedRef.current) {
          setIsPasting(true)
        }
        processPastedText(event.key)
        return
      }
      innerHandleKeyDown(event)
    },
    [finishPaste, innerHandleKeyDown, onImagePaste, onPaste, processPastedText],
  )

  return {
    handleKeyDown,
    handlePaste,
    isPasting,
  }
}
