/**
 * densable 2.1.289 tot leftover Pe = Ye.reduce(SR).
 * Gold @207810241: `SR(El,Hm)=El+Hm.rows()-Hm.owed`.
 */
import { describe, expect, test } from 'bun:test'
import { stringWidth, type DOMElement } from '@anthropic/ink'
import {
  leftoverChromeLatch,
  leftoverChromeQ,
  leftoverChromeReduce,
  leftoverChromeWalkParents,
  leftoverFHostHeight,
  leftoverInnerOverflowHint,
  leftoverInnerWindow,
  leftoverLatchRows,
  leftoverListVisibleCount,
  leftoverListVisibleCountIdle,
  leftoverListVisibleCountModal,
  leftoverSelectVisibleCount,
  leftoverDollarTt,
  leftoverDollarTtLayout,
  leftoverGhOn,
  leftoverGhLine,
  leftoverSelectArrowOn,
  leftoverSelectIsLo,
  leftoverCompactVerticalColumnWidth,
  leftoverVdeTint,
  leftoverVdePointer,
  leftoverVdeInverse,
  leftoverPluginBandBudget,
  leftoverGxtHeight,
  leftoverJePressEnabled,
  leftoverMoreRowLines,
  leftoverOverflowHint,
  leftoverChildRows,
  leftoverGxtClearHover,
  leftoverGxtPaintBar,
  leftoverArrowDownOn,
  leftoverArrowUpOn,
  leftoverGxtShowTrack,
  leftoverJeDropsClick,
  leftoverWheelOn,
  leftoverFttWheelOn,
  leftoverFttHitMiss,
  leftoverFttStopImmediate,
  leftoverScrollViewportFrom,
  leftoverScrollViewportWalk,
  leftoverNavigableCount,
  type LeftoverScrollViewportNode,
  leftoverLineCount,
  leftoverLineWindowSlice,
  leftoverWindowStartLine,
  leftoverNavToLine,
  leftoverMarkerLines,
  leftoverPnWindow,
  leftoverRowClip,
  leftoverG5DrawLabels,
  leftoverG5Index,
  leftoverG5Headings,
  leftoverG5Prompt,
  leftoverG5Dze,
  leftoverG5HaSelect,
  leftoverG5Refuse,
  leftoverG5ShowPrompt,
  leftoverVmnHa,
  leftoverVmnToken,
  leftoverVmnParse,
  leftoverVmnParseOptions,
  leftoverVmnPrompt,
  leftoverVmnTwoInputs,
  leftoverVmnJoinThen,
  leftoverVmnInputPrompt,
  leftoverVmnRace,
  leftoverVmnCursorOn,
  leftoverVmnRn,
  leftoverVmnEscapeTyped,
  leftoverVmnSpaceToggle,
  leftoverVmnKs,
  leftoverVmnPaintSelected,
  leftoverVmnToggleSet,
  leftoverNnBudget,
  leftoverNnItemLines,
  leftoverNnFit,
  leftoverNnFacts,
  leftoverNnFromOptions,
  leftoverNnLiveWidth,
  leftoverNnIconWidth,
  leftoverNnStatusIconWidth,
  leftoverNnSrLine,
  leftoverNnNameColor,
  leftoverG5Digit,
  leftoverG5ParseIndex,
  leftoverG5Invalid,
  leftoverG5Disabled,
  leftoverG5EmptyInput,
  leftoverG5SubmitKind,
  leftoverG5FocusTyped,
  leftoverG5PromptCursorOn,
  leftoverG5PromptColumn,
  leftoverPnPin,
  leftoverPnCursorInView,
  leftoverPnFits,
  leftoverPnSpareLines,
  leftoverPnScrollOn,
  leftoverPnBarVisible,
  leftoverLineToNav,
  LEFTOVER_FE_CLICK_MS,
  LEFTOVER_FE_REPEAT_INITIAL_MS,
  LEFTOVER_FE_REPEAT_MS,
  leftoverIheHoverOn,
  leftoverIheHoverClear,
  leftoverIheWindowValue,
  leftoverBindAcceptOn,
  leftoverScreenReaderRadio,
  leftoverScrollbarHidden,
  leftoverBgOn,
  leftoverScreenReaderEatKey,
  leftoverHeadingOccupiesLine,
  leftoverThumbColor,
  leftoverThumbPointerOn,
  leftoverOwedRows,
  leftoverScrollbarPointer,
  leftoverScrollOffsetFromThumb,
  leftoverScrollThumb,
  leftoverSpareLines,
  leftoverXor,
} from '../FullscreenLayout.js'

function yogaEl(height: number, parentNode?: DOMElement): DOMElement {
  return {
    yogaNode: { getComputedHeight: () => height },
    parentNode,
  } as unknown as DOMElement
}

describe('densable 2.1.289 leftover Pe SR', () => {
  test('SR is acc + rows() - owed', () => {
    expect(leftoverChromeReduce(10, { rows: () => 8, owed: 5 })).toBe(13)
    expect(leftoverChromeReduce(10, { rows: () => 5, owed: 5 })).toBe(10)
    expect(leftoverChromeReduce(10, { rows: () => 3, owed: 5 })).toBe(8)
  })

  test('Lo leftover path H is max(1, leftover+hostH-Q); qe=3 when leftover or Q is null', () => {
    expect(leftoverListVisibleCount(null, 8, 0)).toBe(3)
    expect(leftoverListVisibleCount(10, 8, null)).toBe(3)
    expect(leftoverListVisibleCount(10, 8, 0)).toBe(18)
    expect(leftoverListVisibleCount(10, 8, 5)).toBe(13)
    expect(leftoverListVisibleCount(0, 0, 0)).toBe(1)
    expect(leftoverChromeQ(null)).toBeNull()
    expect(leftoverChromeQ(yogaEl(0), yogaEl(20))).toBeNull()
    expect(leftoverChromeQ(yogaEl(8), yogaEl(20))).toBe(12)
    expect(leftoverChromeQ(yogaEl(0))).toBe(0)
    const idleUnmeasured = yogaEl(0, yogaEl(24))
    expect(leftoverChromeQ(idleUnmeasured, null, true)).toBeNull()
    expect(leftoverChromeQ(yogaEl(10, yogaEl(24)), null, true)).toBe(14)
    expect(leftoverPluginBandBudget(null, null, null, 0, undefined, 24)).toBe(
      24,
    )
    expect(leftoverPluginBandBudget(() => 10, 10, {}, 8, undefined, 24)).toBe(
      18,
    )
    expect(leftoverPluginBandBudget(() => null, null, null, 0, 12, 24)).toBe(12)
  })

  test('Lo idle/modal Select uses caller visibleOptionCount; leftover xor uses computed H', () => {
    expect(leftoverSelectVisibleCount(true, 1, 9)).toBe(1)
    expect(leftoverSelectVisibleCount(false, 1, 9)).toBe(9)
    expect(leftoverSelectVisibleCount(false, 24, 9)).toBe(9)
    expect(leftoverSelectVisibleCount(false, 3, 5)).toBe(5)
  })

  test('$e $Tt is min(requested, max(1, floor((rows-8)/layoutRows)))', () => {
    expect(leftoverDollarTt(5, 'compact', 24)).toBe(5)
    expect(leftoverDollarTt(20, 'compact', 24)).toBe(16)
    expect(leftoverDollarTt(9, 'expanded', 24)).toBe(5)
    expect(leftoverDollarTt(9, 'compact-vertical', 24)).toBe(8)
    expect(leftoverDollarTt(5, 'compact', 8)).toBe(1)
    expect(leftoverDollarTtLayout('compact', false, false, true)).toBe(
      'compact-vertical',
    )
    expect(leftoverDollarTtLayout('compact', true, false, true)).toBe('compact')
    expect(leftoverDollarTtLayout('compact', false, true, true)).toBe('compact')
    expect(leftoverDollarTtLayout('expanded', false, false, true)).toBe(
      'expanded',
    )
    expect(leftoverDollarTtLayout('compact-vertical', false, false, true)).toBe(
      'compact-vertical',
    )
  })

  test('$e gh hiddenBelow and $e arrows have no leftover glyph gate', () => {
    expect(leftoverGhOn(undefined, 0, 5, 9)).toBe(false)
    expect(leftoverGhOn('line', 0, 5, 9)).toBe(true)
    expect(leftoverGhOn('line', 0, 9, 9)).toBe(false)
    expect(leftoverGhLine(3, 'line')).toBe('… +3 lines')
    expect(leftoverGhLine(1, 'line')).toBe('… +1 line')
    expect(leftoverGhLine(0, 'line')).toBe('')
    expect(leftoverSelectArrowOn(false, undefined, true, true)).toBe(true)
    expect(leftoverSelectArrowOn(false, 'glyph', true, true)).toBe(true)
    expect(leftoverSelectArrowOn(true, undefined, true, true)).toBe(false)
    expect(leftoverSelectArrowOn(true, 'glyph', true, true)).toBe(true)
    expect(leftoverSelectArrowOn(true, 'glyph', true, false)).toBe(false)
  })

  test('$e VDe tint/pointer/inverse is hover, not keyboard focus', () => {
    expect(leftoverVdeTint(true, true, 'tint')).toBe(true)
    expect(leftoverVdeTint(true, false, 'tint')).toBe(false)
    expect(leftoverVdeTint(false, true, 'tint')).toBe(false)
    expect(leftoverVdeTint(true, true, 'inverse')).toBe(false)
    expect(leftoverVdePointer(true, true, 'pointer')).toBe(true)
    expect(leftoverVdePointer(true, false, 'pointer')).toBe(false)
    expect(leftoverVdeInverse(true, true, 'inverse')).toBe(true)
    expect(leftoverVdeInverse(true, false, 'inverse')).toBe(false)
  })

  test('leftover Select Lo host is visibleCount===void 0, not $e default 5', () => {
    expect(leftoverSelectIsLo(undefined)).toBe(true)
    expect(leftoverSelectIsLo(5)).toBe(false)
    expect(leftoverSelectIsLo(1)).toBe(false)
  })

  test('Lo idle H is max(1, min(max(7, floor(rows/2)), q-Q))', () => {
    expect(leftoverListVisibleCountIdle(24, 0)).toBe(12)
    expect(leftoverListVisibleCountIdle(10, 0)).toBe(7)
    expect(leftoverListVisibleCountIdle(24, null)).toBe(3)
  })

  test('Lo chrome latch Q is max on same size, else S', () => {
    const first = leftoverChromeLatch(null, 24, 80, 2)
    expect(first.q).toBe(2)
    expect(first.latch).toEqual({ rows: 24, width: 80, chrome: 2 })
    const same = leftoverChromeLatch(first.latch, 24, 80, 1)
    expect(same.q).toBe(2)
    const resized = leftoverChromeLatch(first.latch, 30, 80, 1)
    expect(resized.q).toBe(1)
  })

  test('Lo leftover overflowHint G is none at H=1, glyph below qe', () => {
    expect(leftoverOverflowHint(1, undefined)).toBe('none')
    expect(leftoverOverflowHint(2, undefined)).toBe('glyph')
    expect(leftoverOverflowHint(5, undefined)).toBeUndefined()
    expect(leftoverOverflowHint(2, 'none')).toBe('none')
    expect(leftoverOverflowHint(5, 'count')).toBeUndefined()
  })

  test('Select leftover chrome claim is inside tot We', async () => {
    const src = await Bun.file(
      new URL('../CustomSelect/select.tsx', import.meta.url),
    ).text()
    expect(src).toContain('useLeftoverChromeClaim')
    expect(src).toContain('leftoverHostRef')
    expect(src).toContain('options.length')
    expect(src).toContain('AbovePromptLeftoverContext')
    expect(src).toContain('leftoverAwareVisible')
    expect(src).toContain('leftoverListVisibleCount')
    expect(src).toContain('leftoverLoOn ? subscribeLayout')
    expect(src).toContain('leftoverLoOn && leftoverLatchNow.latch')
    expect(src).toContain('leftoverSelectIsLo')
    expect(src).toContain('leftoverSelectIsLo(visibleOptionCount)')
    expect(src).not.toContain('const leftoverLoOn = true')
    expect(src).toContain('leftoverSelectVisibleCount')
    expect(src).toContain('leftoverDollarTt')
    expect(src).toContain('leftoverDollarTtLayout')
    expect(src).toContain('leftoverGhOn')
    expect(src).toContain('leftoverGhLine')
    expect(src).toContain('leftoverSelectArrowOn')
    expect(src).toContain('leftoverHiddenBelow')
    expect(src).toContain('fttInner: !leftoverLoOn')
    expect(src).toContain('leftoverXeFrame')
    expect(src).toContain('if (leftoverSrRadio)')
    expect(src).not.toContain('leftoverSrRadio ? leftoverG5Children')
    expect(src).not.toContain('screenReaderRadio: leftoverSrRadio')
    expect(src).toContain('if (fttInner)')
    expect(src).toContain('leftoverDollarWt')
    expect(src).toContain('leftoverLoFrame')
    expect(src).toContain('selectedValue')
    expect(src).toContain('visibleOptionCount: leftoverWindow')
    expect(src).toContain('leftoverChromeLatch')
    expect(src).toContain('leftoverOverflowHint')
    expect(src).toContain('leftoverChromeQ')
    expect(src).toContain('subscribeLayout')
    expect(src).toContain('leftoverInnerWindow')
    expect(src).toContain('leftoverInnerOverflowHint')
    expect(src).toContain('LeftoverModalHostContext')
    expect(src).toContain('LeftoverCountHint')
    expect(src).toContain('{count} more')
    expect(src).toContain("innerHint === 'count'")
    expect(src).toContain('leftoverSelectArrowOn')
    expect(src).toContain('leftoverModal?.box.current')
    expect(src).toContain('leftoverLoOn')
    expect(src).toContain('leftoverChromeWalkParents')
    expect(src).toContain('leftoverFHostHeight')
    expect(src).toContain('leftoverLatchRows')
    expect(src).toContain('leftoverMoreRowLines')
    expect(src).toContain('leftoverJePress')
    expect(src).toContain('scrollToEdge')
    expect(src).toContain('overflowHintProp')
    expect(src).toContain('leftoverListFrame')
    expect(src).toContain('gxtHeight: leftoverAwareVisible')
    expect(src).toContain('option.lines')
    expect(src).toContain('emptyMessage')
    expect(src).toContain('paddingX={1}')
    expect(src).toContain('moreRowLines,')
    expect(src).toContain('leftoverOwedRows')
    expect(src).toContain('leftoverPnSpareLines')
    expect(src).toContain('leftoverG5Digit')
    expect(src).toContain('leftoverG5ParseIndex')
    expect(src).toContain('leftoverG5Invalid')
    expect(src).toContain('leftoverG5SubmitKind')
    expect(src).toContain('leftoverPnFits')
    expect(src).toContain('leftoverPnScrollOn')
    expect(src).toContain('leftoverPnBarVisible')
    expect(src).toContain('leftoverLineToNav')
    expect(src).toContain('LEFTOVER_FE_CLICK_MS')
    expect(src).toContain('LEFTOVER_FE_REPEAT_INITIAL_MS')
    expect(src).toContain('LEFTOVER_FE_REPEAT_MS')
    expect(src).toContain('leftoverGxtHeight')
    expect(src).toContain('leftoverJePressEnabled')
    expect(src).toContain('LeftoverScrollbar')
    expect(src).toContain('leftoverScrollbarPointer')
    expect(src).toContain('leftoverGxtPaintBar')
    expect(src).toContain('leftoverGxtShowTrack')
    expect(src).toContain('leftoverThumbColor')
    expect(src).toContain('leftoverThumbPointerOn')
    expect(src).toContain('onWheel')
    expect(src).toContain('wheelOn: leftoverWheel')
    expect(src).toContain('leftoverFttWheelOn')
    expect(src).toContain('leftoverFttHitMiss')
    expect(src).toContain('leftoverFttStopImmediate')
    expect(src).toContain('scrollViewport: state.scrollViewport')
    expect(src).toContain('shouldDropWheel: leftoverShouldDropWheel')
    expect(src).toContain('hitTest')
    const navSrc = await Bun.file(
      new URL('../CustomSelect/use-select-navigation.ts', import.meta.url),
    ).text()
    expect(navSrc).toContain("type: 'scroll-viewport'")
    expect(navSrc).toContain('leftoverScrollViewportFrom')
    expect(navSrc).toContain('leftoverScrollViewportWalk')
    expect(navSrc).toContain('scrollViewport')
    expect(navSrc).toContain('visibleCountChanged')
    expect(navSrc).toContain('notifiedFocusRef')
    expect(navSrc).toContain('navigate')
    const straySrc = await Bun.file(
      new URL('../CustomSelect/use-stray-click.ts', import.meta.url),
    ).text()
    expect(straySrc).toContain('useShouldDropWheel')
    expect(straySrc).toContain('isMountSettle')
    expect(src).toContain('leftoverArrowUpOn')
    expect(src).toContain('leftoverBindKeyDown')
    expect(src).toContain('leftoverIheWindowValue')
    expect(src).toContain('leftoverBindAcceptOn')
    expect(src).toContain('leftoverScreenReaderRadio')
    expect(src).toContain('leftoverScrollbarHidden')
    expect(src).toContain('leftoverBgOn')
    expect(src).toContain('leftoverLineCount')
    expect(src).toContain('leftoverHeadingOccupiesLine')
    expect(src).toContain('LeftoverIheWindowContext')
    expect(src).toContain('useFocusReclaim')
    expect(src).toContain('leftoverSrRadio')
    expect(src).toContain('leftoverScreenReaderEatKey')
    expect(src).toContain('leftoverG5Prompt')
    expect(src).toContain('leftoverG5Dze')
    expect(src).toContain('leftoverG5HaSelect')
    expect(src).toContain('leftoverG5Refuse')
    expect(src).toContain('leftoverG5ShowPrompt')
    expect(src).toContain('leftoverArrowNav')
    expect(src).toContain('g5ShowPrompt')
    const inputSrc = await Bun.file(
      new URL('../CustomSelect/use-select-input.ts', import.meta.url),
    ).text()
    expect(inputSrc).toContain('leftoverG5HaSelect')
    const multi = await Bun.file(
      new URL('../CustomSelect/use-multi-select-state.ts', import.meta.url),
    ).text()
    expect(multi).toContain('leftoverVmnHa')
    expect(multi).toContain('leftoverVmnParse')
    expect(multi).toContain('leftoverVmnToken')
    expect(multi).toContain('leftoverG5Refuse')
    expect(multi).toContain("useRegisterOverlay('multi-select'")
    expect(src).toContain('leftoverG5Children')
    expect(src).toContain('leftoverG5Headings')
    expect(src).toContain('leftoverG5DrawLabels')
    expect(src).toContain('leftoverRowClip')
    expect(src).toContain('if (!leftoverLoOn) return node')
    expect(src).toContain('overflow="hidden"')
    const nav = await Bun.file(
      new URL('../CustomSelect/use-select-navigation.ts', import.meta.url),
    ).text()
    expect(nav).toContain('if (!moreRowLines)')
    expect(nav).toContain('options.slice(from, to)')
    expect(src).toContain('LeftoverIheHoverTrack')
    expect(src).toContain('leftoverIheHoverOn')
    expect(src).toContain('leftoverIheHoverClear')
    expect(src).toContain('leftoverMarkerLines')
    expect(src).toContain('leftoverPnWindow')
    expect(nav).toContain('leftoverLineWindowSlice')
    expect(nav).toContain('leftoverWindowStartLine')
    expect(nav).toContain('leftoverMarkerLines')
    expect(nav).toContain('leftoverPnWindow')
    expect(src).toContain('startHold')
    expect(src).toContain('leftoverGxtClearHover')
    expect(src).toContain('LeftoverJeDropsContext')
    expect(src).toContain('useHoverTracked')
    expect(src).toContain('jeDropsRef: jePressedRef')
    expect(src).toContain('leftoverJeDropsClick')
    expect(src).toContain('leftoverScrollThumb')
    expect(src).toContain('option.heading')
    expect(src).toContain('onPointer')
    expect(src).toContain('onScrollTo: leftoverScrollOn')
    expect(src).toContain('leftoverLineToNav')
    expect(src).toContain('leftoverG5Commit')
    expect(src).toContain('leftoverG5FocusTyped')
    expect(src).toContain('leftoverG5PromptCursorOn')
    expect(src).toContain('leftoverG5PromptColumn')
    expect(src).toContain('leftoverPnPin')
    expect(src).toContain('leftoverPnCursorInView')
    expect(src).toContain('leftoverPin')
    expect(src).toContain('g5CursorActive')
    expect(src).toContain('useDeclaredCursor')
    expect(src).toContain('leftoverLoOn')
    expect(src).toContain('useLeftoverChromeClaim')
    expect(src).not.toContain('inLeftoverXorClaim')
    expect(src).toContain('scrollBar = true')
    expect(src).toContain('leftoverLoOn && scrollBar')
    expect(src).toContain('onDisabledRowClick')
    expect(src).toContain('aboveCount: state.visibleFromIndex')
    expect(src).toContain('onJePress: leftoverJePress')
    expect(src.split('leftoverListFrame({').length - 1).toBeGreaterThanOrEqual(
      4,
    )
    expect(src).not.toContain('void moreRowLines')
    expect(src).not.toContain(
      'leftover === null ? 3 : Math.max(1, leftover + hostH)',
    )
    expect(src).not.toContain(
      'useLeftoverChromeClaim(leftoverHostRef, visibleOptionCount)',
    )
  })

  test('$e SelectOption VDe is per-row hover; ihe only clears on window rotate', async () => {
    const optionSrc = await Bun.file(
      new URL('../CustomSelect/select-option.tsx', import.meta.url),
    ).text()
    expect(optionSrc).toContain('leftoverVdeTint')
    expect(optionSrc).toContain('leftoverVdePointer')
    expect(optionSrc).toContain('leftoverVdeInverse')
    expect(optionSrc).toContain('LeftoverIheWindowContext')
    expect(optionSrc).toContain('const [hovered, setHovered] = useState(false)')
    expect(optionSrc).toContain('leftoverIheRef.current !== leftoverIhe')
    expect(optionSrc).toContain('isFocused={isFocused}')
    expect(optionSrc).toContain('hovered={leftoverHoverPointer}')
    expect(optionSrc).toContain('backgroundColor={leftoverHoverTint}')
    expect(optionSrc).toContain('if (!nn) return item')
    expect(optionSrc).not.toContain('width="100%"')
    expect(optionSrc).not.toContain('hoverFollowsPaint')
    expect(optionSrc).not.toContain('leftoverIheHoverOn')
    expect(optionSrc).not.toContain('leftoverIheHoverClear')
    expect(optionSrc).not.toContain('leftoverVdeExclusiveOn')
    expect(optionSrc).not.toContain('LeftoverVdeHoverContext')
    expect(optionSrc).not.toContain('hovered || isFocused')
    expect(optionSrc).not.toContain('setHoveredId')
    const listItem = await Bun.file(
      new URL(
        '../../../packages/@ant/ink/src/theme/ListItem.tsx',
        import.meta.url,
      ),
    ).text()
    expect(listItem).not.toContain('hoverFollowsPaint')
    expect(listItem).not.toContain('width="100%"')
    expect(listItem).toContain('<Box flexShrink={0}>{renderIndicator()}</Box>')
    // densable IC: no alignItems/alignSelf stretch on the hover Box.
    expect(listItem).not.toContain('alignItems="stretch"')
    expect(listItem).not.toContain('alignSelf="stretch"')
    const selectSrc = await Bun.file(
      new URL('../CustomSelect/select.tsx', import.meta.url),
    ).text()
    const loStart = selectSrc.indexOf('function leftoverLoFrame')
    const loEnd = selectSrc.indexOf('function LeftoverCountHint', loStart)
    const loBody = selectSrc.slice(loStart, loEnd)
    expect(loBody).not.toContain('screenReaderRadio')
    expect(loBody).not.toContain('g5Prompt')
    expect(loBody).not.toContain('g5CursorActive')
    expect(loBody).not.toContain('g5ShowPrompt')
    const wtStart = selectSrc.indexOf('function leftoverDollarWt')
    const wtEnd = selectSrc.indexOf('function leftoverLoFrame', wtStart)
    const wtBody = selectSrc.slice(wtStart, wtEnd)
    expect(wtBody).toContain('leftoverIheWindowValue')
    expect(wtBody).toContain('alignItems="stretch"')
    expect(wtBody).not.toContain('width="100%"')
  })

  test('$e compact-vertical description is gold t7 sibling, not inside hover Box', async () => {
    const src = await Bun.file(
      new URL('../CustomSelect/select.tsx', import.meta.url),
    ).text()
    const compact = src.indexOf("if (layout === 'compact-vertical')")
    expect(compact).toBeGreaterThan(0)
    const nextLayout = src.indexOf(
      '// Check if any visible options have descriptions',
      compact,
    )
    const body = src.slice(compact, nextLayout)
    expect(body).toContain('</SelectOption>')
    expect(body).toContain('{!leftoverNn && option.description && (')
    expect(body).toContain('paddingLeft={hideIndexes ? 4 : maxIndexWidth + 4}')
    expect(body.indexOf('</SelectOption>')).toBeLessThan(
      body.indexOf('{!leftoverNn && option.description && ('),
    )
    expect(body).not.toContain('flexShrink={0} width="100%"')
    // DualInk analog: pin option column to longest title/desc (not terminal).
    expect(body).toContain('width={leftoverColumnWidth}')
    expect(body).toContain('leftoverCompactVerticalColumnWidth')
    expect(body).toContain('alignItems="stretch"')
  })

  test('leftoverCompactVerticalColumnWidth is longest title/desc, not terminal', () => {
    const w = leftoverCompactVerticalColumnWidth(
      [
        { label: '1', description: '第一个选项' },
        { label: '2', description: '第二个选项' },
        { label: '3', description: '第三个选项' },
        { type: 'input', label: 'Other', placeholder: 'Type something.' },
      ],
      false,
      1,
    )
    // pointer+gap+`1. `+label vs descPad+CJK, vs input `4. Type something.`
    expect(w).toBeGreaterThan(6)
    expect(w).toBeLessThan(40)
    expect(w).toBe(
      Math.max(
        2 + 2 + 1, // ❯ + "1." pad + "1"
        5 + 5, // padLeft 5 + 第一个选项 (5 cells)
        2 + 2 + 1,
        5 + 5,
        2 + 2 + 1,
        5 + 5,
        2 + stringWidth('4. ') + stringWidth('Type something.'),
      ),
    )
  })

  test('Ask QuestionView wraps $e like gold: marginTop 1, no width 100%', async () => {
    const src = await Bun.file(
      new URL(
        '../permissions/AskUserQuestionPermissionRequest/QuestionView.tsx',
        import.meta.url,
      ),
    ).text()
    expect(src).toContain(
      '<Box flexDirection="column" marginTop={0} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>',
    )
    expect(src).toContain('<Box marginTop={1}>')
    expect(src).toContain('layout="compact-vertical"')
    expect(src).not.toContain('width={minContentWidth}')
    expect(src).not.toContain('width="100%"')
  })

  test('PromptInput leftover host pins leftover columns, not yoga 100%', async () => {
    const src = await Bun.file(
      new URL('../PromptInput/PromptInput.tsx', import.meta.url),
    ).text()
    const host = src.indexOf('{...(hostBlocksKeys')
    expect(host).toBeGreaterThan(0)
    const hostEnd = src.indexOf('<PromptInputModeIndicator', host)
    const body = src.slice(host, hostEnd)
    expect(body).toContain('width={promptInputColumns}')
    expect(body).toContain('flexShrink={0}')
    expect(body).not.toContain('width="100%"')
    expect(src).toContain(
      'const promptInputColumns = columns - companionReservedColumns(columns, companionSpeaking)',
    )
  })

  test('KEEP companion idle wrapper is flexShrink 0 like speaking path', async () => {
    const src = await Bun.file(
      new URL('../../buddy/CompanionSprite.tsx', import.meta.url),
    ).text()
    expect(src).toContain(
      '<Box paddingX={1} flexShrink={0}>\n        {spriteColumn}\n      </Box>',
    )
    expect(src).toContain(
      '<Box flexDirection="row" alignItems="flex-end" paddingX={1} flexShrink={0}>',
    )
  })

  test('Lo modal d path H is max(1, k-Q)', () => {
    expect(leftoverListVisibleCountModal(20, 0)).toBe(20)
    expect(leftoverListVisibleCountModal(20, 5)).toBe(15)
    expect(leftoverListVisibleCountModal(20, null)).toBe(3)
    expect(leftoverListVisibleCountModal(0, 0)).toBe(1)
  })

  test('inner oo Z is count when hint is undefined or glyph at H=1; B-2 when undefined and h>H', () => {
    expect(leftoverInnerOverflowHint(undefined, 5)).toBe('count')
    expect(leftoverInnerOverflowHint('glyph', 1)).toBe('count')
    expect(leftoverInnerOverflowHint('glyph', 2)).toBe('glyph')
    expect(leftoverInnerOverflowHint('none', 1)).toBe('none')
    expect(leftoverInnerWindow(undefined, 5, 10)).toBe(3)
    expect(leftoverInnerWindow(undefined, 5, 5)).toBe(5)
    expect(leftoverInnerWindow('glyph', 5, 10)).toBe(5)
    expect(leftoverInnerWindow(undefined, 1, 10)).toBe(1)
  })

  test('Lo chrome T walks parentNode when idle; leftover/modal skip', () => {
    const root = yogaEl(40)
    const mid = yogaEl(30, root)
    const list = yogaEl(10, mid)
    const modal = yogaEl(25)
    expect(leftoverChromeQ(list, null, true)).toBe(30)
    expect(leftoverChromeQ(list, null, false)).toBe(0)
    expect(leftoverChromeQ(list, modal, false)).toBe(15)
    expect(leftoverChromeQ(null, modal, true)).toBeNull()
  })

  test('Lo leftover xor is leftover AND NOT modal', () => {
    expect(leftoverXor(true, false)).toBe(true)
    expect(leftoverXor(true, true)).toBe(false)
    expect(leftoverXor(false, true)).toBe(false)
    expect(leftoverXor(false, false)).toBe(false)
  })

  test('Lo chrome T walks when p5 is null and leftover xor is off', () => {
    expect(leftoverChromeWalkParents(false, false)).toBe(true)
    expect(leftoverChromeWalkParents(true, false)).toBe(false)
    expect(leftoverChromeWalkParents(false, true)).toBe(false)
    expect(leftoverChromeWalkParents(true, true)).toBe(false)
  })

  test('Lo latch k is modal t.rows else terminal rows', () => {
    expect(leftoverLatchRows(true, 18, 20, 40)).toBe(18)
    expect(leftoverLatchRows(true, undefined, 20, 40)).toBe(20)
    expect(leftoverLatchRows(false, 18, 20, 40)).toBe(40)
  })

  test('leftover F host is p5.box else list', () => {
    const list = yogaEl(10)
    const modal = yogaEl(25)
    expect(leftoverFHostHeight(modal, list)).toBe(25)
    expect(leftoverFHostHeight(null, list)).toBe(10)
    expect(leftoverFHostHeight(null, null)).toBe(0)
  })

  test('inner moreRowLines is true only when hint is undefined and window is B-2', () => {
    expect(leftoverMoreRowLines(undefined, 5, 10)).toBe(true)
    expect(leftoverMoreRowLines(undefined, 5, 5)).toBe(false)
    expect(leftoverMoreRowLines('glyph', 5, 10)).toBe(false)
    expect(leftoverMoreRowLines(undefined, 1, 10)).toBe(false)
  })

  test('idle leftover q uses p5 reserve', () => {
    expect(leftoverListVisibleCountIdle(24, 0, 1)).toBe(12)
    expect(leftoverListVisibleCountIdle(24, 0, 4)).toBe(12)
    expect(leftoverListVisibleCountIdle(10, 0, 4)).toBe(6)
  })

  test('leftover owed L is children Oo row sum', () => {
    expect(leftoverOwedRows(0)).toBe(0)
    expect(leftoverOwedRows(5)).toBe(5)
    expect(leftoverOwedRows(2, [2, 3])).toBe(5)
    expect(leftoverChildRows(2.9)).toBe(2)
    expect(leftoverChildRows(undefined)).toBe(1)
    expect(leftoverOwedRows(2, [1, 1], [true, true], 'empty')).toBe(1)
    expect(leftoverOwedRows(2, [1, 1], [true, true], undefined)).toBe(0)
    expect(leftoverOwedRows(2, [2, 3], [true, false], 'empty')).toBe(5)
  })

  test('leftover $e ho/un thumb math', () => {
    expect(leftoverScrollThumb(0, 5, 20, 10)).toEqual({ top: 0, size: 3 })
    expect(leftoverScrollThumb(15, 5, 20, 10).top).toBe(7)
    expect(leftoverScrollOffsetFromThumb(0, 5, 20, 10)).toBe(0)
    expect(leftoverScrollOffsetFromThumb(7, 5, 20, 10)).toBe(15)
  })

  test('je kTt dropsClick is same-row within 1s', () => {
    expect(leftoverJeDropsClick({ at: 1000, row: 3 }, 3, 1500)).toBe(true)
    expect(leftoverJeDropsClick({ at: 1000, row: 3 }, 3, 2000)).toBe(false)
    expect(leftoverJeDropsClick({ at: 1000, row: 3 }, 4, 1500)).toBe(false)
    expect(leftoverJeDropsClick(null, 3, 1500)).toBe(false)
  })

  test('GXt paints $e only when hover-tracked, hovered, and overflowing', () => {
    expect(leftoverGxtPaintBar(true, true, true)).toBe(true)
    expect(leftoverGxtPaintBar(false, true, true)).toBe(false)
    expect(leftoverGxtPaintBar(true, false, true)).toBe(false)
    expect(leftoverGxtPaintBar(true, true, false)).toBe(false)
    expect(leftoverGxtShowTrack(true, true)).toBe(true)
    expect(leftoverGxtShowTrack(false, true)).toBe(false)
    expect(leftoverThumbColor(true, false)).toBe('suggestion')
    expect(leftoverThumbColor(false, true)).toBe('suggestion')
    expect(leftoverThumbColor(false, false)).toBeUndefined()
    expect(leftoverThumbPointerOn(true, false)).toBe(true)
    expect(leftoverThumbPointerOn(false, true)).toBe(true)
    expect(leftoverThumbPointerOn(false, false)).toBe(false)
    expect(leftoverNavigableCount([{ heading: true }, {}, {}])).toBe(2)
    expect(leftoverArrowUpOn(0)).toBe(false)
    expect(leftoverArrowUpOn(1)).toBe(true)
    expect(leftoverArrowDownOn(0, 5, 5)).toBe(false)
    expect(leftoverArrowDownOn(0, 5, 10)).toBe(true)
    expect(leftoverWheelOn(true, false)).toBe(false)
    expect(leftoverWheelOn(false, true)).toBe(false)
    expect(leftoverWheelOn(false, false)).toBe(true)
    // densable `$e` `FTt` `if(o||i-t>=a)`
    expect(leftoverFttWheelOn(true, 0, 5, 50)).toBe(false)
    expect(leftoverFttWheelOn(false, 0, 50, 50)).toBe(false)
    expect(leftoverFttWheelOn(false, 0, 8, 50)).toBe(true)
    expect(leftoverFttHitMiss(null, 1, 2, null)).toBe(false)
    expect(leftoverFttHitMiss({}, undefined, 2, null)).toBe(false)
    expect(leftoverFttHitMiss({}, 1, 2, null)).toBe(true)
    expect(leftoverFttHitMiss({}, 1, 2, {})).toBe(false)
    expect(leftoverFttStopImmediate(true)).toBe(true)
    expect(leftoverFttStopImmediate(false)).toBe(false)
    expect(leftoverScrollViewportFrom(0, 1, 50, 8)).toBe(1)
    expect(leftoverScrollViewportFrom(0, -1, 50, 8)).toBe(0)
    expect(leftoverScrollViewportFrom(42, 1, 50, 8)).toBe(42)
    const a: LeftoverScrollViewportNode<string> = { index: 0, value: 'a' }
    const b: LeftoverScrollViewportNode<string> = { index: 1, value: 'b' }
    const c: LeftoverScrollViewportNode<string> = { index: 2, value: 'c' }
    a.next = b
    b.previous = a
    b.next = c
    c.previous = b
    expect(leftoverScrollViewportWalk(a, 1, 3)).toBe('b')
    expect(leftoverScrollViewportWalk(c, 0, 2)).toBe('b')
    expect(leftoverScrollViewportWalk(b, 0, 2)).toBe('b')
  })

  test('$e grab: thumb-inside down skips onScrollTo; up clears', () => {
    const thumb = leftoverScrollThumb(0, 5, 20, 10)
    const bar = { visible: 5, total: 20, height: 10, offset: 0 }
    const downInside = leftoverScrollbarPointer(
      { type: 'mousedown', button: 0, row: 10, localRow: thumb.top },
      thumb,
      bar,
      null,
    )
    expect(downInside.scrollTo).toBeUndefined()
    expect(downInside.grab).not.toBeNull()
    const up = leftoverScrollbarPointer(
      { type: 'mouseup', button: 0, row: 10, localRow: thumb.top },
      thumb,
      bar,
      downInside.grab,
    )
    expect(up.grab).toBeNull()
    const downOutside = leftoverScrollbarPointer(
      { type: 'mousedown', button: 0, row: 20, localRow: 9 },
      thumb,
      bar,
      null,
    )
    expect(downOutside.scrollTo).toBeDefined()
    const drag = leftoverScrollbarPointer(
      { type: 'mousedrag', button: 0, row: 18, localRow: 8 },
      thumb,
      bar,
      downInside.grab,
    )
    expect(drag.scrollTo).toBeDefined()
  })

  test('GXt clears local hover when hover-tracked is off', () => {
    expect(leftoverGxtClearHover(true, false)).toBe(true)
    expect(leftoverGxtClearHover(true, true)).toBe(false)
    expect(leftoverGxtClearHover(false, false)).toBe(false)
  })

  test('inner spareLines and GXt height follow U', () => {
    expect(leftoverSpareLines(5, 3)).toBe(2)
    expect(leftoverSpareLines(5, 5)).toBe(0)
    expect(leftoverGxtHeight(true, 7)).toBe(7)
    expect(leftoverGxtHeight(false, 7)).toBeUndefined()
  })

  test('je Ae onPress is empty when disabled and no onDisabledRowClick', () => {
    expect(leftoverJePressEnabled(true, undefined)).toBe(false)
    expect(leftoverJePressEnabled(true, () => undefined)).toBe(true)
    expect(leftoverJePressEnabled(false, undefined)).toBe(true)
  })

  test('ihe windowStart identity, de overlay gate, Bg, En Xe, ZM, heading lineCount', () => {
    expect(leftoverIheWindowValue(undefined, 'a,b')).toBe('0 a,b')
    expect(leftoverIheWindowValue(3, 'a,b')).toBe('3 a,b')
    expect(leftoverBindAcceptOn(true, false)).toBe(true)
    expect(leftoverBindAcceptOn(true, true)).toBe(false)
    expect(leftoverBindAcceptOn(false, false)).toBe(false)
    expect(leftoverScreenReaderRadio(true, true)).toBe(true)
    expect(leftoverScreenReaderRadio(true, false)).toBe(false)
    expect(leftoverScreenReaderRadio(false, true)).toBe(false)
    expect(leftoverScrollbarHidden(true)).toBe(true)
    expect(leftoverScrollbarHidden(false)).toBe(false)
    expect(leftoverBgOn(true, false)).toBe(true)
    expect(leftoverBgOn(true, true)).toBe(true)
    expect(leftoverBgOn(false, false)).toBe(false)
    expect(leftoverScreenReaderEatKey('return')).toBe(true)
    expect(leftoverScreenReaderEatKey(' ')).toBe(true)
    expect(leftoverScreenReaderEatKey('down')).toBe(false)
    expect(leftoverHeadingOccupiesLine(true)).toBe(true)
    expect(leftoverHeadingOccupiesLine(false)).toBe(false)
    expect(leftoverLineCount([{ heading: true }, { lines: 2 }, {}])).toBe(4)
    expect(leftoverLineCount([{}, {}, {}])).toBe(3)
    expect(leftoverLineCount([{ heading: true }, { heading: true }])).toBe(2)
  })

  test('g5 radio, pn line window, markerLines, row clip, VDe ihe hover', () => {
    expect(leftoverG5DrawLabels(true)).toBe(true)
    expect(leftoverG5DrawLabels(false)).toBe(false)
    expect(leftoverG5Index(0)).toBe(1)
    expect(
      leftoverG5Headings([
        { heading: true, label: 'H' },
        { label: 'a' },
        { heading: true, label: 'T' },
      ]).get(0),
    ).toEqual(['H'])
    expect(
      leftoverG5Headings([
        { heading: true, label: 'H' },
        { label: 'a' },
        { heading: true, label: 'T' },
      ]).get(1),
    ).toEqual(['T'])
    expect(leftoverG5Prompt(0, true)).toBe(
      'Nothing to select. Escape to cancel',
    )
    expect(leftoverG5Prompt(3, false)).toBe(
      'Select with numbers [1-3]. Then Enter to submit',
    )
    expect(leftoverG5Prompt(3, false, true)).toContain(
      'or up / down arrow keys',
    )
    expect(leftoverG5Dze(false)).toBe(false)
    expect(leftoverG5Dze(true)).toBe(true)
    expect(leftoverG5HaSelect(true, false)).toBe(true)
    expect(leftoverG5HaSelect(true, true)).toBe(false)
    expect(leftoverG5HaSelect(false, false)).toBe(false)
    expect(leftoverG5Refuse(() => true)).toBe(true)
    expect(leftoverG5Refuse(undefined)).toBe(false)
    expect(leftoverG5ShowPrompt(false, true, true)).toBe(false)
    expect(leftoverG5ShowPrompt(false, true, false)).toBe(true)
    expect(leftoverG5ShowPrompt(true, false, true)).toBe(false)
    expect(leftoverMarkerLines(true)).toBe(1)
    expect(leftoverMarkerLines(false)).toBe(0)
    expect(leftoverPnWindow(5, 1)).toBe(7)
    expect(leftoverRowClip(true, 2, 5)).toBeUndefined()
    expect(leftoverRowClip(false, 2, 5)).toBe(2)
    expect(leftoverRowClip(false, 10, 3)).toBe(3)
    expect(leftoverNavToLine([{ heading: true }, {}], 0)).toBe(1)
    expect(leftoverWindowStartLine([{ heading: true }, {}, {}], 0)).toBe(0)
    expect(
      leftoverLineWindowSlice([{ heading: true }, {}, {}], 0, 2).map(
        row => row.heading === true,
      ),
    ).toEqual([true, false])
    expect(leftoverIheHoverOn('3 a,b', '3 a,b')).toBe(true)
    expect(leftoverIheHoverOn('3 a,b', '0 a,b')).toBe(false)
    expect(leftoverIheHoverClear('3 a,b', '0 a,b')).toBe(true)
    expect(leftoverIheHoverClear(null, '0 a,b')).toBe(false)
  })

  test('g5 keyboard radio, pn spare/fits/bar, fe delay, g5 Bg', () => {
    expect(leftoverG5Digit('1')).toBe(true)
    expect(leftoverG5Digit('a')).toBe(false)
    expect(leftoverG5ParseIndex('2', 3)).toBe(1)
    expect(leftoverG5ParseIndex('9', 3)).toBeNull()
    expect(leftoverG5Invalid('9', 3)).toContain('between 1 and 3')
    expect(leftoverG5Disabled(2)).toBe('Option 2 is disabled.')
    expect(leftoverG5EmptyInput()).toContain('Enter some text')
    expect(leftoverG5SubmitKind('12', false)).toBe('typed')
    expect(leftoverG5SubmitKind('', true)).toBe('focus')
    expect(leftoverG5SubmitKind('', false)).toBe('none')
    expect(
      leftoverG5FocusTyped(
        [{ heading: true, value: 'h' }, { value: 'a' }, { value: 'b' }],
        'b',
      ),
    ).toBe('2')
    expect(leftoverG5FocusTyped([{ value: 'a' }], 'z')).toBeNull()
    expect(leftoverPnFits(5, 5)).toBe(true)
    expect(leftoverPnFits(6, 5)).toBe(false)
    expect(leftoverPnSpareLines(true, 7, 3)).toBe(0)
    expect(leftoverPnSpareLines(false, 7, 3)).toBe(4)
    expect(leftoverPnScrollOn(true)).toBe(false)
    expect(leftoverPnScrollOn(false)).toBe(true)
    expect(leftoverPnBarVisible(0, 5, 2)).toBe(7)
    expect(leftoverLineToNav([{ heading: true }, {}, {}], 0)).toBe(0)
    expect(leftoverLineToNav([{ heading: true }, {}, {}], 1)).toBe(0)
    expect(LEFTOVER_FE_CLICK_MS).toBe(150)
    expect(LEFTOVER_FE_REPEAT_INITIAL_MS).toBe(400)
    expect(LEFTOVER_FE_REPEAT_MS).toBe(60)
    expect(leftoverBgOn(true, true)).toBe(true)
    expect(leftoverG5PromptCursorOn(false, false, false)).toBe(true)
    expect(leftoverG5PromptCursorOn(false, false, true)).toBe(false)
    expect(leftoverG5PromptCursorOn(true, false, false)).toBe(false)
    expect(leftoverG5PromptColumn('ab')).toBe(2)
    expect(leftoverPnCursorInView(1, 0, 3)).toBe(true)
    expect(leftoverPnCursorInView(3, 0, 3)).toBe(false)
    expect(leftoverPnPin(0, true, 5)).toBe(0)
    expect(leftoverPnPin(0, false, 5)).toBe(5)
    expect(leftoverVmnHa(true, false)).toBe(true)
    expect(leftoverVmnHa(true, true)).toBe(false)
    expect(leftoverVmnToken('1')).toBe(true)
    expect(leftoverVmnToken(',')).toBe(true)
    expect(leftoverVmnToken('a')).toBe(false)
    expect(leftoverVmnParse('1,3', 5)).toEqual({ indexes: [0, 2] })
    expect(leftoverVmnParse('', 5)).toEqual({ indexes: [] })
    expect(leftoverVmnParse('9', 3)).toHaveProperty('error')
    expect(leftoverVmnPrompt(3, false, false)).toContain(
      'comma- or space-separated',
    )
    expect(leftoverVmnPrompt(3, false, false)).toContain(
      'Then Enter to submit:',
    )
    expect(
      leftoverVmnPrompt(3, true, false, undefined, '', true, false),
    ).toContain('bare Enter for defaults')
    expect(
      leftoverVmnPrompt(3, false, true, undefined, '1,2', false, true),
    ).toContain('Space to toggle')
    expect(
      leftoverVmnPrompt(3, false, true, undefined, '1,2', false, true),
    ).toContain(': 1,2')
    expect(leftoverVmnJoinThen(['a', 'b', 'c'])).toBe('a, b, or c')
    expect(leftoverVmnInputPrompt(2, 'Name', 'x')).toContain('option 2')
    expect(leftoverVmnTwoInputs()).toContain('Only one free-text option')
    expect(leftoverVmnRace()).toContain('list was ready')
    expect(leftoverVmnCursorOn(false, false)).toBe(true)
    expect(leftoverVmnCursorOn(false, true)).toBe(false)
    expect(leftoverVmnRn(1, 'a', 'd', true, false)).toContain('(selected)')
    expect(leftoverVmnSpaceToggle(true, true, ' ')).toBe(true)
    expect(leftoverVmnSpaceToggle(false, true, ' ')).toBe(false)
    expect(
      leftoverVmnParseOptions('1,2', [
        { type: 'text' },
        { type: 'input' },
        { type: 'text' },
      ]),
    ).toEqual({ indexes: [0], inputIndex: 1 })
    expect(
      leftoverVmnParseOptions('2,3', [
        { type: 'text' },
        { type: 'input' },
        { type: 'input' },
      ]),
    ).toHaveProperty('error')
    expect(leftoverNnItemLines('x')).toBe(2)
    expect(leftoverNnItemLines(undefined)).toBe(1)
    expect(leftoverNnBudget(80, 0, 20, 10).nameWidth).toBeGreaterThan(0)
    expect(leftoverNnBudget(14, 0, 50, 50).factsWidth).toBe(0)
    expect(leftoverNnFit(['aa', 'bbbb'], 2)).toBe('aa')
    expect(leftoverNnFacts(['a', 1, ''])).toEqual(['a', '1'])
    expect(
      leftoverNnFromOptions(80, [{ iconWidth: 0, name: 'x', facts: ['a'] }])
        ?.nameWidth,
    ).toBeGreaterThan(0)
    expect(
      leftoverNnFromOptions(80, [{ iconWidth: 0, name: 'x', facts: [] }]),
    ).toBeNull()
    expect(leftoverNnLiveWidth(40, 80)).toBe(38)
    expect(leftoverNnLiveWidth(0, 80)).toBe(78)
    expect(leftoverNnLiveWidth(40, 80, 12)).toBe(12)
    expect(leftoverNnNameColor(true)).toBe('suggestion')
    expect(leftoverNnNameColor(false)).toBeUndefined()
    expect(leftoverVmnEscapeTyped(true, '1,2')).toBe('1,2')
    expect(leftoverVmnEscapeTyped(false, '1,2')).toBe('')
    expect(leftoverVmnRn(1, 'a', 'd', true, false, true)).toBe(
      '1. (selected)a — d',
    )
    expect(leftoverNnIconWidth('ab')).toBe(2)
    expect(leftoverNnIconWidth({ props: { status: 'success' } })).toBe(
      leftoverNnStatusIconWidth(),
    )
    expect(leftoverNnSrLine('n', ['a', 'b'], 'd')).toBe('n, a · b. d')
    expect(leftoverVmnKs('x'.repeat(10))).toBe('x'.repeat(10))
    expect(leftoverVmnKs('x'.repeat(301)).length).toBeGreaterThan(300)
    expect(leftoverVmnKs('x'.repeat(301))).toContain('more characters')
    expect(leftoverVmnPaintSelected(null, 0, true)).toBe(true)
    expect(leftoverVmnPaintSelected(new Set([1]), 0, true)).toBe(false)
    expect(leftoverVmnPaintSelected(new Set([1]), 1, false)).toBe(true)
    expect([...leftoverVmnToggleSet(null, [0], 1)].sort()).toEqual([0, 1])
    expect([...leftoverVmnToggleSet(new Set([0, 1]), [0], 1)].sort()).toEqual([
      0,
    ])
  })
})
