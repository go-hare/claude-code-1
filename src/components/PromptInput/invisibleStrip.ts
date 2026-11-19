import type { PastedContent } from '../../utils/config.js'
import type { PromptInputMode } from '../../types/textInputTypes.js'

export type InvisibleRemovalCounts = {
  removedTotal: number
  removedByClass: {
    tags: number
    bidi: number
    zeroWidth: number
    selectors: number
    other: number
  }
}

const BIDI_RE = /[\u061C\u202A-\u202E\u2066-\u2069]/gu
const ZERO_WIDTH_RE =
  /(?:[\u200B-\u200F\u2060-\u2065\uFEFF\u00AD\u180E]|\u034F)/gu
const TAGS_RE = /[\u{E0000}-\u{E007F}]/gu
const SELECTORS_RE = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu
const OTHER_INVISIBLE_RE = /[\u2028\u2029\uFFF0-\uFFFB]/gu

export function stripInvisibleCharacters(text: string): {
  text: string
  removed: InvisibleRemovalCounts
} {
  const removedByClass = {
    tags: 0,
    bidi: 0,
    zeroWidth: 0,
    selectors: 0,
    other: 0,
  }

  let out = text.replace(TAGS_RE, () => {
    removedByClass.tags++
    return ''
  })
  out = out.replace(BIDI_RE, () => {
    removedByClass.bidi++
    return ''
  })
  out = out.replace(ZERO_WIDTH_RE, () => {
    removedByClass.zeroWidth++
    return ''
  })
  out = out.replace(SELECTORS_RE, () => {
    removedByClass.selectors++
    return ''
  })
  out = out.replace(OTHER_INVISIBLE_RE, () => {
    removedByClass.other++
    return ''
  })

  const removedTotal =
    removedByClass.tags +
    removedByClass.bidi +
    removedByClass.zeroWidth +
    removedByClass.selectors +
    removedByClass.other

  return {
    text: out,
    removed: { removedTotal, removedByClass },
  }
}

export function stripInvisibleFromPromptInput(
  input: string,
  pastedContents: Record<number, PastedContent>,
): {
  input: string
  pastedContents: Record<number, PastedContent>
  removed: InvisibleRemovalCounts
} {
  const top = stripInvisibleCharacters(input)
  let nextPastes = pastedContents
  const total = { ...top.removed.removedByClass }
  let removedTotal = top.removed.removedTotal

  for (const [idStr, item] of Object.entries(pastedContents)) {
    if (item.type !== 'text') continue
    const stripped = stripInvisibleCharacters(item.content)
    if (stripped.removed.removedTotal > 0) {
      if (nextPastes === pastedContents) {
        nextPastes = { ...pastedContents }
      }
      const id = Number(idStr)
      nextPastes[id] = { ...item, content: stripped.text }
      removedTotal += stripped.removed.removedTotal
      total.tags += stripped.removed.removedByClass.tags
      total.bidi += stripped.removed.removedByClass.bidi
      total.zeroWidth += stripped.removed.removedByClass.zeroWidth
      total.selectors += stripped.removed.removedByClass.selectors
      total.other += stripped.removed.removedByClass.other
    }
  }

  return {
    input: top.text,
    pastedContents: nextPastes,
    removed: { removedTotal, removedByClass: total },
  }
}

export function shouldHoldInvisibleRemovalForReview(
  cleanedInput: string,
  removed: InvisibleRemovalCounts,
  mode: PromptInputMode,
): boolean {
  const trimmed = cleanedInput.trim()
  return (
    mode !== 'prompt' ||
    trimmed === '' ||
    removed.removedByClass.bidi > 0 ||
    /^[/!]/.test(trimmed)
  )
}

export function formatInvisibleRemovedNotice(
  removedTotal: number,
  reason: 'review' | 'empty' | 'cleaned',
): string {
  const prefix =
    removedTotal === 1
      ? 'Removed 1 invisible character'
      : `Removed ${removedTotal} invisible characters`
  switch (reason) {
    case 'review':
      return `${prefix} \xB7 review and press Enter to send`
    case 'empty':
      return `${prefix} \xB7 nothing left to send`
    case 'cleaned':
      return `${prefix} from your prompt`
  }
}
