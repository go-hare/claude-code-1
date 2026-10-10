// Type declarations for custom Ink JSX elements
// Note: The detailed prop types are defined in ink-jsx.d.ts via React module augmentation.
// This file provides the global JSX namespace fallback declarations.
// Type declarations for custom Ink JSX elements
// Note: The detailed prop types are defined in ink-jsx.d.ts via React module augmentation.
// This file provides the global JSX namespace fallback declarations.
import type { ReactNode, Ref } from 'react'
import type {
  ClickEvent,
  DOMAccessibility,
  DOMElement,
  FocusEvent,
  KeyboardEvent,
  MouseActionEvent,
  PasteEvent,
  Styles,
  TextStyles,
  WheelEvent,
} from '@anthropic/ink'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': {
        ref?: Ref<DOMElement>
        tabIndex?: number
        autoFocus?: boolean
        /** densable 2.1.218 accessibility bag */
        accessibility?: DOMAccessibility
        onClick?: (event: ClickEvent) => void
        onMouseDown?: (event: MouseActionEvent) => void
        onMouseUp?: (event: MouseActionEvent) => void
        onMouseDrag?: (event: MouseActionEvent) => void
        onPointer?: (event: MouseActionEvent) => void
        onFocus?: (event: FocusEvent) => void
        onFocusCapture?: (event: FocusEvent) => void
        onBlur?: (event: FocusEvent) => void
        onBlurCapture?: (event: FocusEvent) => void
        onMouseEnter?: () => void
        onMouseLeave?: () => void
        hoverIgnoresBlankCells?: boolean
        hoverFollowsPaint?: boolean
        onKeyDown?: (event: KeyboardEvent) => void
        onKeyDownCapture?: (event: KeyboardEvent) => void
        onPaste?: (event: PasteEvent) => void
        onPasteCapture?: (event: PasteEvent) => void
        onWheel?: (event: WheelEvent) => void
        onWheelCapture?: (event: WheelEvent) => void
        elementKey?: string
        elementPlugin?: string
        style?: Styles
        stickyScroll?: boolean
        /** Official 2.1.207: default true; false disables non-sticky growth follow. */
        followGrowth?: boolean
        children?: ReactNode
      }
      'ink-text': {
        style?: Styles
        textStyles?: TextStyles
        /** densable 2.1.218 accessibility bag */
        accessibility?: DOMAccessibility
        onMouseEnter?: () => void
        onMouseLeave?: () => void
        hoverFollowsPaint?: boolean
        children?: ReactNode
      }
      'ink-link': {
        href?: string
        children?: ReactNode
      }
      'ink-raw-ansi': {
        rawText?: string
        rawWidth?: number
        rawHeight?: number
        ref?: unknown
      }
    }
  }
}

export {}
