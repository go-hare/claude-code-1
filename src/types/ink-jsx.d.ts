/**
 * Ink custom JSX intrinsic elements.
 *
 * With "jsx": "react-jsx", TypeScript resolves JSX types from react/jsx-runtime
 * whose IntrinsicElements extends React.JSX.IntrinsicElements. We augment the
 * 'react' module to inject our custom elements into React.JSX.IntrinsicElements.
 *
 * This file must be a module (have an import/export) for `declare module`
 * augmentation to work correctly.
 */
import type { ReactNode, Ref } from 'react'
import type {
  ClickEvent,
  DOMAccessibility,
  DOMElement,
  FocusEvent,
  KeyboardEvent,
  PasteEvent,
  Styles,
  TextStyles,
} from '@anthropic/ink'

declare module 'react' {
  // React 19: both React.JSX and global JSX are used depending on
  // jsxImportSource / tsc resolution. Augment both via this module.
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': {
        ref?: Ref<DOMElement>
        tabIndex?: number
        autoFocus?: boolean
        /** densable 2.1.218 accessibility bag (preserveWhitespace etc.) */
        accessibility?: DOMAccessibility
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
        /** densable 2.1.218 accessibility bag */
        accessibility?: DOMAccessibility
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

// Ensure this ambient module is pulled into the root program.
export {}
