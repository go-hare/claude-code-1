// Type declarations for custom Ink JSX elements
// Note: The detailed prop types are defined in ink-jsx.d.ts via React module augmentation.
// This file provides the global JSX namespace fallback declarations.
import type { ReactNode, Ref } from 'react'
import type {
  ClickEvent,
  FocusEvent,
  KeyboardEvent,
  PasteEvent,
  Styles,
  TextStyles,
  DOMElement,
} from '@anthropic/ink'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': {
        ref?: Ref<DOMElement>
        tabIndex?: number
        autoFocus?: boolean
        onClick?: (event: ClickEvent) => void
        onFocus?: (event: FocusEvent) => void
        onFocusCapture?: (event: FocusEvent) => void
        onBlur?: (event: FocusEvent) => void
        onBlurCapture?: (event: FocusEvent) => void
        onMouseEnter?: () => void
        onMouseLeave?: () => void
        onKeyDown?: (event: KeyboardEvent) => void
        onKeyDownCapture?: (event: KeyboardEvent) => void
        onPaste?: (event: PasteEvent) => void
        onPasteCapture?: (event: PasteEvent) => void
        style?: Styles
        stickyScroll?: boolean
        /** Official 2.1.207: default true; false disables non-sticky growth follow. */
        followGrowth?: boolean
        children?: ReactNode
      }
      'ink-text': {
        style?: Styles
        textStyles?: TextStyles
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
      }
    }
  }
}

export {}
